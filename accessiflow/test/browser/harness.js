// Runs in headless Chrome, under the extension's own content security policy.
// Imports the shipped caption engine, feeds it recorded speech at the speed a
// live tab would deliver it, and reports what came out.
import { configure, load, CaptionPipeline, MODEL } from '/caption-engine.js';

const CHUNK = 2048;   // what the capture worklet posts at a time

function log(message) {
  const line = document.createElement('div');
  line.textContent = message;
  document.getElementById('log').appendChild(line);
  console.log(message);
}

/** 16-bit PCM WAV to one Float32Array per channel. */
function parseWav(buffer) {
  const view = new DataView(buffer);
  let offset = 12;
  let format = null;
  while (offset < view.byteLength - 8) {
    const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3));
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      format = {
        channels: view.getUint16(offset + 10, true),
        rate: view.getUint32(offset + 12, true),
        bits: view.getUint16(offset + 22, true)
      };
    } else if (id === 'data' && format) {
      const frames = size / (format.channels * 2);
      const channels = Array.from({ length: format.channels }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < format.channels; c++) {
          channels[c][i] = view.getInt16(offset + 8 + (i * format.channels + c) * 2, true) / 32768;
        }
      }
      return { rate: format.rate, channels: channels };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('not a 16-bit PCM WAV');
}

async function runClip(engine, name, realTime) {
  const wav = parseWav(await (await fetch('/audio/' + name + '.wav')).arrayBuffer());
  const captions = [];
  const pipeline = new CaptionPipeline(engine, wav.rate, caption => captions.push(caption));

  // A second of quiet either side, as a real tab would have around speech.
  const pad = new Float32Array(wav.rate);
  const withPad = wav.channels.map(ch => {
    const out = new Float32Array(ch.length + pad.length * 2);
    out.set(ch, pad.length);
    return out;
  });

  const started = performance.now();
  const frames = withPad[0].length;
  for (let at = 0; at < frames; at += CHUNK) {
    pipeline.push(withPad.map(ch => ch.subarray(at, at + CHUNK)));
    if (realTime) {
      const due = started + ((at + CHUNK) / wav.rate) * 1000;
      const wait = due - performance.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
  const fedAt = performance.now();
  await pipeline.finish();
  const doneAt = performance.now();

  const finals = captions.filter(c => c.final && c.text);
  return {
    name: name,
    audioSeconds: wav.channels[0].length / wav.rate,
    text: finals.map(c => c.text).join(' '),
    finals: finals.length,
    interims: captions.filter(c => !c.final).length,
    firstInterimMs: (captions.find(c => !c.final) || {}).lagMs || null,
    finalLagsMs: finals.map(c => c.lagMs),
    tailMs: Math.round(doneAt - fedAt),
    busyMs: pipeline.stats.busyMs,
    transcribedSeconds: pipeline.stats.audioSeconds
  };
}

(async () => {
  try {
    const params = new URLSearchParams(location.search);
    const clips = (params.get('clips') || '').split(',').filter(Boolean);
    configure(location.origin + '/');

    log('crossOriginIsolated=' + self.crossOriginIsolated + ' model=' + MODEL.id);
    const loadStart = performance.now();
    let lastPercent = -1;
    const engine = await load(fraction => {
      const percent = Math.floor(fraction * 10) * 10;
      if (percent !== lastPercent) { lastPercent = percent; log('model ' + percent + '%'); }
    });
    const loadMs = Math.round(performance.now() - loadStart);
    log('model ready in ' + loadMs + ' ms');

    const results = [];
    for (const name of clips) {
      const result = await runClip(engine, name, params.get('realtime') !== '0');
      log(name + ': ' + result.text);
      results.push(result);
    }
    window.__result = { ok: true, loadMs: loadMs, results: results };
  } catch (e) {
    window.__result = { ok: false, error: String(e && e.stack || e) };
  }
})();
