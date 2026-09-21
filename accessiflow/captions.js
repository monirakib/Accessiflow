// AccessiFlow live captions: the capture side
//
// Runs in the offscreen document, which belongs to the extension and outlives
// any one page. Captures a tab's sound, sends it straight back out so the tab
// can still be heard, and in parallel turns it into captions and sound cues
// for the page to show.
//
// Capturing a tab silences it: Chrome hands the extension the stream instead
// of playing it. Re-connecting the stream to the speakers is the step that is
// easy to forget, and forgetting it means turning captions on mutes the video
// the user wanted captions for.
import { configure, load, isDownloaded, CaptionPipeline, MODEL } from './caption-engine.js';

configure(chrome.runtime.getURL(''));

const A = globalThis.AccessiFlowAudio;

let engine = null;          // loaded once, kept for the life of the document
let loading = null;
let session = null;         // the capture in progress

function log(msg) { console.log('[AccessiFlow][Captions] ' + msg); }
function warn(msg) { console.warn('[AccessiFlow][Captions] ' + msg); }

/** Something for the page in the captured tab: a caption, a cue, a level. */
function emit(tabId, event) {
  chrome.runtime.sendMessage({ action: 'captionEvent', tabId: tabId, event: event },
    () => { void chrome.runtime.lastError; });
}

function progress(percent) {
  chrome.runtime.sendMessage({ action: 'captionProgress', percent: percent },
    () => { void chrome.runtime.lastError; });
}

function getEngine(onProgress) {
  if (engine) return Promise.resolve(engine);
  if (!loading) {
    loading = load(onProgress).then(e => { engine = e; loading = null; return e; },
      err => { loading = null; throw err; });
  }
  return loading;
}

async function download(respond) {
  try {
    let last = -1;
    await getEngine(fraction => {
      const percent = Math.floor(fraction * 100);
      if (percent === last || percent % 5) return;
      last = percent;
      progress(percent);
    });
    respond({ success: true });
  } catch (e) {
    warn('model download failed: ' + e.message);
    respond({ success: false, error: 'The caption engine could not be downloaded. Check the connection and try again.' });
  }
}

async function start(message, respond) {
  if (session) await stop('replaced');

  if (!engine && !(await isDownloaded())) {
    respond({ success: false, code: 'model_missing',
      error: 'The caption engine is not downloaded yet (' + MODEL.megabytes + ' MB, once).' });
    return;
  }

  const tabId = message.tabId;
  emit(tabId, { type: 'state', state: 'starting' });

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId } },
      video: false
    });
  } catch (e) {
    warn('capture refused: ' + e.message);
    emit(tabId, { type: 'state', state: 'stopped', reason: 'refused' });
    respond({ success: false, code: 'capture_refused', error: 'Chrome did not allow this tab to be captured.' });
    return;
  }

  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  // The tab is silent from the moment it is captured. This puts its sound back.
  source.connect(context.destination);

  const current = {
    tabId: tabId, stream: stream, context: context, source: source,
    node: null, pipeline: null, detector: new A.TransientDetector(),
    lastLevel: 0, clock: 0, startedAt: Date.now()
  };
  session = current;

  // Answer now: the popup should not wait ten seconds for the model to warm
  // up before it can say "starting".
  respond({ success: true, starting: true });

  try {
    const loaded = await getEngine();
    if (session !== current) return;          // stopped while loading

    await context.audioWorklet.addModule(chrome.runtime.getURL('capture-worklet.js'));
    if (session !== current) return;

    current.pipeline = new CaptionPipeline(loaded, context.sampleRate, caption => {
      emit(tabId, { type: 'caption', text: caption.text, final: caption.final, id: caption.id });
    });

    const node = new AudioWorkletNode(context, 'accessiflow-capture', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]
    });
    // A node only runs while the graph pulls on it, so it is connected to the
    // speakers through a gain of zero: pulled, and never heard.
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute).connect(context.destination);
    current.node = node;

    const blockSeconds = 2048 / context.sampleRate;
    node.port.onmessage = event => {
      if (session !== current) return;
      const data = event.data;
      current.pipeline.push(data.channels);

      const left = data.rms[0] || 0;
      const right = data.rms.length > 1 ? data.rms[1] : left;
      current.clock += blockSeconds;
      const cue = current.detector.update(left, right, current.clock, blockSeconds);
      if (cue) emit(tabId, { type: 'soundCue', pan: cue.pan, strength: cue.strength, source: 'capture' });

      // A level about ten times a second is plenty for a meter, and keeps the
      // message traffic to the page small.
      if (current.clock - current.lastLevel >= 0.1) {
        current.lastLevel = current.clock;
        emit(tabId, { type: 'level', left: left, right: right });
      }
    };

    // The tab was closed, or Chrome ended the capture for its own reasons.
    stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
      if (session === current) stop('ended');
    }));

    emit(tabId, { type: 'state', state: 'running' });
    log('captioning tab ' + tabId + ' at ' + context.sampleRate + ' Hz');
  } catch (e) {
    warn('could not start: ' + e.message);
    if (session === current) await stop('failed');
  }
}

async function stop(reason) {
  const current = session;
  if (!current) return;
  session = null;

  try { if (current.node) current.node.port.onmessage = null; } catch (e) { /* ok */ }
  try { current.stream.getTracks().forEach(t => t.stop()); } catch (e) { /* ok */ }
  try { await current.context.close(); } catch (e) { /* ok */ }

  // Whatever was being said when captions stopped still gets captioned.
  if (current.pipeline && reason !== 'replaced') {
    try { await current.pipeline.finish(); } catch (e) { /* ok */ }
  }
  emit(current.tabId, { type: 'state', state: 'stopped', reason: reason || 'user' });
  log('stopped (' + (reason || 'user') + ')');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return;

  switch (message.action) {
    case 'startCapture':
      start(message, sendResponse);
      return true;

    case 'stopCapture':
      stop(message.reason || 'user').then(() => sendResponse({ success: true }));
      return true;

    case 'captureStatus':
      sendResponse({ success: true, running: !!session, tabId: session ? session.tabId : null });
      return;

    case 'captionModelStatus':
      isDownloaded().then(downloaded => sendResponse({
        success: true, downloaded: downloaded || !!engine, megabytes: MODEL.megabytes
      }));
      return true;

    case 'downloadCaptionModel':
      download(sendResponse);
      return true;
  }
});

log('ready');
