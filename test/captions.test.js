// Live captions and sound cues, everywhere but inside Whisper itself (which
// test/browser/run.js checks on real speech in Chrome).
//
//   * the caption box: interim and final text, how many lines stay, moving it
//     without a mouse, and that it survives settings changes but not "off"
//   * sound cues: which edge they appear on, where an element's sound appears,
//     calm cues under reduced motion, and no double cues while capturing
//   * the sound meter: nothing drawn until there is a real level
//   * the page bridge: commands sent before the hook has loaded still arrive
//   * the page hook's sound watcher, and that it restores what it patched
//   * the service worker: who may start captions, where events go
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

const dom = new JSDOM(`<!DOCTYPE html><html lang="en"><body>
  <main><p>Article text.</p>
    <audio id="ping" src="/ping.mp3"></audio>
    <audio id="silent" src="/x.mp3" muted></audio>
    <video id="clip" src="/clip.mp4"></video>
  </main>
</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://news.example/story' });
const { window } = dom;
const doc = window.document;
window.console.log = () => {};
window.console.warn = () => {};
const RECTS = { ping: { top: 300, left: 50, width: 0, height: 0 }, clip: { top: 100, left: 100, width: 640, height: 360 } };
window.Element.prototype.getBoundingClientRect = function () {
  const r = RECTS[this.id] || { top: 20, left: 20, width: 300, height: 120 };
  return Object.assign({}, r, { right: r.left + r.width, bottom: r.top + r.height });
};
Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };

// jsdom delivers window.postMessage with event.source set to null; Chrome sets
// it to the window. The bridge and the hook both check the source, which is
// the right guard on a real page, so the test is made to behave like Chrome
// rather than the check being weakened.
window.postMessage = function (data) {
  setTimeout(() => window.dispatchEvent(new window.MessageEvent('message', { data: data, source: window })), 0);
};

const sent = [];
const storage = {};
window.chrome = {
  runtime: {
    lastError: null,
    getURL: p => 'chrome-extension://test/' + p,
    sendMessage: (msg, cb) => { sent.push(msg); if (cb) cb({ success: true }); }
  },
  storage: { local: {
    get: (k, cb) => cb({ [k]: storage[k] }),
    set: (o, cb) => { Object.assign(storage, o); if (cb) cb(); }
  } }
};

for (const f of ['modules/page-bridge.js', 'modules/hearing.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const settle = ms => new Promise(r => setTimeout(r, ms === undefined ? 30 : ms));
const q = s => doc.querySelector(s);
const qa = s => Array.from(doc.querySelectorAll(s));

(async () => {
  const hearing = new window.HearingModule();
  hearing.apply({ captionLines: 2, captionFontSize: 30, captionColor: 'yellow', captionBg: 'solid' });

  // ── The caption box ──────────────────────────────────────────────────────
  hearing.onCaptionEvent({ type: 'state', state: 'starting' });
  const box = doc.getElementById('accessiflow-live-captions');
  check(box && !box.hidden, 'starting captions opens the caption box straight away');
  check(/ten seconds/.test(q('.accessiflow-live-captions-status').textContent),
    'and says the first caption can take about ten seconds, rather than looking broken while Whisper loads');
  check(box.getAttribute('role') === 'region' && !box.hasAttribute('aria-live'),
    'a labelled region, not a live region: a screen reader reading every revision aloud would talk over the audio');
  check(box.style.getPropertyValue('--accessiflow-caption-size') === '30px' &&
    box.style.getPropertyValue('--accessiflow-caption-colour') === '#ffe14d',
    'the size and colour settings reach the box');

  hearing.onCaptionEvent({ type: 'caption', text: 'Your appointment is', final: false, id: 1 });
  check(q('.accessiflow-live-captions-interim').textContent === 'Your appointment is',
    'an interim caption shows while the sentence is still being spoken');
  hearing.onCaptionEvent({ type: 'caption', text: 'Your appointment is on Tuesday.', final: true, id: 1 });
  check(q('.accessiflow-live-captions-interim').textContent === '' &&
    qa('.accessiflow-live-captions-line').map(n => n.textContent).join('|') === 'Your appointment is on Tuesday.',
    'the final replaces the interim, as a finished line');
  hearing.onCaptionEvent({ type: 'caption', text: 'Please bring your card.', final: true, id: 2 });
  hearing.onCaptionEvent({ type: 'caption', text: 'And your medicines.', final: true, id: 3 });
  check(qa('.accessiflow-live-captions-line').map(n => n.textContent).join('|') ===
    'Please bring your card.|And your medicines.',
    'only the configured number of lines stay, newest last');
  hearing.onCaptionEvent({ type: 'caption', text: 'um', final: false, id: 4 });
  hearing.onCaptionEvent({ type: 'caption', text: '', final: true, id: 4 });
  check(q('.accessiflow-live-captions-interim').textContent === '' && qa('.accessiflow-live-captions-line').length === 2,
    'an empty final (music, or nothing said) clears the interim and adds no line');

  // Moving without a mouse.
  const grip = q('.accessiflow-live-captions-grip');
  check(grip.tagName === 'BUTTON' && /arrow keys/.test(grip.getAttribute('aria-label')),
    'the move handle is a real button that says how to use it');
  grip.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  check(box.style.getPropertyValue('top') !== '' && box.style.getPropertyPriority('top') === 'important',
    'an arrow key moves the box, with an important inline style so the page reset cannot pin it in place');
  check(storage.accessiflow_caption_position && typeof storage.accessiflow_caption_position.top === 'number',
    'and the position is remembered for the next page');

  // Settings changes must not tear it down; turning AccessiFlow off must.
  hearing.destroy();
  hearing.apply({ captionLines: 2 });
  check(doc.getElementById('accessiflow-live-captions') === box,
    'the caption box survives a settings change, since the capture behind it keeps running');

  q('.accessiflow-live-captions-close').click();
  check(sent.some(m => m.action === 'stopCaptions'), 'the Stop captions button asks the service worker to stop');

  hearing.onCaptionEvent({ type: 'state', state: 'stopped' });
  check(!doc.getElementById('accessiflow-live-captions'), 'stopping removes the box');

  hearing.onCaptionEvent({ type: 'state', state: 'stopped', reason: 'model_missing',
    message: 'The caption engine is not downloaded yet.' });
  check(/not downloaded/.test((q('.accessiflow-live-captions-status') || {}).textContent || ''),
    'a failure from the keyboard shortcut is shown on the page, where the user is looking');
  hearing.destroyCaptions();

  // ── The sound meter ──────────────────────────────────────────────────────
  hearing.apply({ soundVisualization: true });
  check(!doc.getElementById('accessiflow-sound-meter'),
    'switching the meter on draws nothing until there is a real level: no more random bars');
  hearing.onCaptionEvent({ type: 'level', left: 0.1, right: 0.001 });
  const fills = qa('.accessiflow-sound-meter-fill');
  check(fills.length === 2, 'a real level draws the meter, left and right');
  const w = n => parseFloat(n.style.getPropertyValue('width'));
  check(w(fills[0]) > w(fills[1]) && w(fills[0]) > 50,
    'loud on the left shows as loud on the left: ' + Math.round(w(fills[0])) + '% against ' + Math.round(w(fills[1])) + '%');
  hearing.apply({ soundVisualization: false });
  hearing.onCaptionEvent({ type: 'level', left: 0.1, right: 0.1 });
  check(!doc.getElementById('accessiflow-sound-meter'), 'switched off, levels draw nothing');

  // ── The page bridge, and the hook it talks to ────────────────────────────
  const bridge = window.AccessiFlowPageBridge;
  const heard = [];
  bridge.on('sound', data => heard.push(data));
  bridge.send('watchSound');
  check(bridge.injected && !bridge.ready, 'the hook is injected on first use, not ready yet');

  // In the browser the <script> loads the hook in the page world. Here the
  // page world is this window, so it is run directly, after the command was sent.
  window.eval(fs.readFileSync(path.join(ROOT, 'page-hook.js'), 'utf8'));
  await settle();
  check(bridge.ready, 'the hook announces itself');
  check(window.__accessiflowHook.watchingSound,
    'and the command sent before it had loaded was delivered, not lost -- the bug the interceptor had');

  doc.getElementById('ping').play();
  await settle();
  check(heard.length === 1 && heard[0].kind === 'audio', 'an <audio> starting is reported as a sound');
  doc.getElementById('silent').play();
  await settle();
  check(heard.length === 1, 'a muted element is not a sound');
  doc.getElementById('clip').play();
  await settle();
  check(heard.length === 1, 'a video visibly playing on screen is not a cue: it is its own visual signal');

  const before = sent.length;
  await settle();
  check(sent.length === before && !window.__accessiflowHook.frozen,
    'the hook ignores its own events on the shared channel, so there is no loop');

  // An extension reload leaves the old hook in the page world. A fresh
  // bridge must still get its ready, or it would queue commands forever.
  const readies = [];
  const onReady = e => { if (e.data && e.data.action === 'ready') readies.push(e); };
  window.addEventListener('message', onReady);
  window.eval(fs.readFileSync(path.join(ROOT, 'page-hook.js'), 'utf8'));
  await settle();
  window.removeEventListener('message', onReady);
  check(readies.length === 1,
    'a second injection, as after the extension is reloaded, re-announces the hook instead of staying silent');

  bridge.send('unwatchSound');
  await settle();
  check(!window.__accessiflowHook.watchingSound, 'unwatching restores the original play()');

  // ── Sound cues ──────────────────────────────────────────────────────────
  hearing.apply({ visualAlerts: true });
  await settle();
  check(window.__accessiflowHook.watchingSound, 'turning sound cues on starts the watcher');

  hearing.onCaptionEvent({ type: 'soundCue', pan: -0.8, strength: 0.9 });
  check(qa('.accessiflow-sound-cue--left').length === 1, 'a sound from the left glows on the left edge');
  check(/on the left/.test(q('.accessiflow-sound-cue--left').textContent), 'and says so in words');
  hearing.onCaptionEvent({ type: 'soundCue', pan: 0.7, strength: 0.9 });
  check(qa('.accessiflow-sound-cue--right').length === 1, 'the right, on the right');
  hearing.onCaptionEvent({ type: 'soundCue', pan: 0.05, strength: 0.5 });
  check(qa('.accessiflow-sound-cue--bottom').length === 1, 'a centred sound at the bottom');
  check(qa('.accessiflow-sound-cue').every(n => n.getAttribute('aria-hidden') === 'true'),
    'cues are visual only and hidden from screen readers');

  hearing.showSoundCue({ rect: { top: 300, left: 400, width: 100, height: 40 } });
  const at = q('.accessiflow-sound-cue--at');
  check(at && at.style.getPropertyPriority('left') === 'important' && parseInt(at.style.getPropertyValue('left'), 10) > 350,
    'a sound with a place on the page ripples there, positioned so the page reset cannot move it');

  hearing.apply({ visualAlerts: true, reduceMotion: true });
  hearing.showSoundCue({ pan: -1 });
  check(qa('.accessiflow-sound-cue--calm').length === 1,
    'with Reduce motion on, the ripple becomes a still glow, because an expanding ring is itself motion');

  // While the capture runs, the page hook's report would be a duplicate.
  qa('.accessiflow-sound-cue').forEach(n => n.remove());
  hearing.onCaptionEvent({ type: 'state', state: 'running' });
  doc.getElementById('ping').play();
  await settle();
  check(qa('.accessiflow-sound-cue').length === 0,
    'while captions capture the tab, the page hook stands aside, so one sound is one cue');
  hearing.destroyCaptions();

  // Cues remove themselves.
  hearing.showSoundCue({ pan: 0 });
  await settle(1700);
  check(qa('.accessiflow-sound-cue').length === 0, 'a cue is gone within two seconds');

  hearing.apply({ visualAlerts: false });
  await settle();
  check(!window.__accessiflowHook.watchingSound, 'turning cues off stops the watcher and restores the page');

  // ── Caption styling for the page's own subtitles ─────────────────────────
  hearing.applyCaptionStyling(true, { captionFontSize: 28, captionColor: 'cyan', captionBg: 'blue' });
  const cueCss = (doc.getElementById('accessiflow-hearing-extra-style') || {}).textContent || '';
  check(/font-size: 28px/.test(cueCss) && /#7df9ff/.test(cueCss),
    'video subtitles take the same size and colour as live captions');
  hearing.applyCaptionStyling(false);

  await backgroundTests();
  dom.window.close();
  finish();
})().catch(err => { errors.push('threw: ' + err.stack); finish(); });

// ── The service worker ─────────────────────────────────────────────────────
async function backgroundTests() {
  const calls = { streamIds: [], offscreen: [], tabs: [], closed: 0, created: [] };
  let listener = null;
  let commandListener = null;
  let offscreenExists = true;          // as if an older version had made one
  const session = {};
  const local = {};
  let capture = { running: false, tabId: null };

  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener: fn => { listener = fn; } },
      onInstalled: { addListener() {} },
      getContexts: async () => (offscreenExists ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []),
      sendMessage: async msg => {
        if (msg.target !== 'offscreen') return undefined;
        calls.offscreen.push(msg);
        if (msg.action === 'captureStatus') return { success: true, running: capture.running, tabId: capture.tabId };
        if (msg.action === 'startCapture') { capture = { running: true, tabId: msg.tabId }; return { success: true, starting: true }; }
        if (msg.action === 'stopCapture') { capture = { running: false, tabId: null }; return { success: true }; }
        if (msg.action === 'captionModelStatus') return { success: true, downloaded: true, megabytes: 41 };
        return { success: true };
      }
    },
    tabCapture: { getMediaStreamId: async opts => { calls.streamIds.push(opts.targetTabId); return 'stream-' + opts.targetTabId; } },
    offscreen: {
      createDocument: async opts => { calls.created.push(opts); offscreenExists = true; },
      closeDocument: async () => { calls.closed++; offscreenExists = false; }
    },
    commands: { onCommand: { addListener: fn => { commandListener = fn; } } },
    tabs: {
      query: (q, cb) => cb([{ id: 7 }]),
      sendMessage: (id, msg, cb) => { calls.tabs.push({ id: id, msg: msg }); if (cb) cb(); },
      create() {}
    },
    storage: {
      local: {
        get: (k, cb) => { const o = {}; [].concat(k).forEach(x => { if (x in local) o[x] = local[x]; }); cb(o); },
        set: (o, cb) => { Object.assign(local, o); if (cb) cb(); }
      },
      session: {
        get: (k, cb) => { const o = {}; [].concat(k).forEach(x => { if (x in session) o[x] = session[x]; }); cb(o); },
        set: (o, cb) => { Object.assign(session, o); if (cb) cb(); }
      }
    }
  };

  const sandbox = {
    chrome: chrome, console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, URL, Promise, JSON, Math, Date, Object, Array, String,
    fetch: async () => { throw new Error('no network in this test'); },
    Response, Headers, Request, crypto: require('crypto').webcrypto, TextEncoder
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.importScripts = (...files) => files.forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox));
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), sandbox);

  const send = (msg, sender) => new Promise(resolve => {
    if (listener(msg, sender || {}, resolve) !== true) resolve(undefined);
  });

  // A page tries to start captions on its own.
  let reply = await send({ action: 'startCaptions', tabId: 7 }, { tab: { id: 7 }, url: 'https://evil.example/' });
  check(reply && reply.success === false && calls.streamIds.length === 0,
    'a web page cannot start capturing its own tab; only AccessiFlow’s own popup or shortcut can');

  // The popup starts them.
  reply = await send({ action: 'startCaptions', tabId: 7 }, {});
  check(reply && reply.success, 'the popup can start captions');
  check(calls.streamIds.join() === '7', 'the stream is requested for exactly the tab the popup was opened on');
  const start = calls.offscreen.find(m => m.action === 'startCapture');
  check(start && start.streamId === 'stream-7' && start.tabId === 7, 'and handed to the offscreen document with that tab');

  const made = calls.created[0];
  check(calls.closed === 1 && made,
    'an offscreen document left by an older version is replaced once, because it was made for playback alone');
  check(made && made.reasons.indexOf('USER_MEDIA') !== -1 && made.reasons.indexOf('AUDIO_PLAYBACK') !== -1,
    'the new one is made for both speech and capture: ' + (made ? made.reasons.join(', ') : 'none'));

  await send({ action: 'startCaptions', tabId: 7 }, {});
  check(calls.closed === 1 && calls.created.length === 1,
    'once replaced, it is kept, not recreated on every start');
  check(calls.offscreen.filter(m => m.action === 'stopCapture').length === 1,
    'starting again on a captured tab stops the old capture first, which Chrome would otherwise refuse');

  // Events go to the captured tab and nowhere else.
  await send({ action: 'captionEvent', tabId: 7, event: { type: 'caption', text: 'Hello', final: true } }, {});
  check(calls.tabs.length === 1 && calls.tabs[0].id === 7 && calls.tabs[0].msg.event.text === 'Hello',
    'a caption goes to the captured tab');

  let status = await send({ action: 'captionsStatus' }, { tab: { id: 7 } });
  check(status.running === true, 'the captured tab is told captions are running for it');
  status = await send({ action: 'captionsStatus' }, { tab: { id: 9 } });
  check(status.running === false, 'another tab is told nothing is running for it');

  // The keyboard command toggles.
  commandListener('toggle-captions');
  await new Promise(r => setTimeout(r, 30));
  check(capture.running === false, 'Alt+Shift+W on the captured tab stops captions');
  commandListener('toggle-captions');
  await new Promise(r => setTimeout(r, 30));
  check(capture.running === true && capture.tabId === 7, 'and pressed again starts them');
}

function finish() {
  console.log('\n=== PASS (' + ok.length + ') ===');
  ok.forEach(m => console.log('  + ' + m));
  if (errors.length) {
    console.log('\n=== FAIL (' + errors.length + ') ===');
    errors.forEach(m => console.log('  ! ' + m));
    process.exit(1);
  }
  console.log('\nAll checks passed.');
  process.exit(0);
}
