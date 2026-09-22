// The real-speech check for live captions.
//
//   cd test/browser && npm install && node run.js
//
// Everything else in the test suite runs the caption code under node with
// synthetic tones. This runs the shipped engine -- vendor/transformers, the
// real Whisper model, the real resampler and segmenter -- in headless Chrome,
// on recorded speech, fed in at the speed a live tab delivers it, and checks
// three claims the extension makes about captions, after first checking the
// caption box, sound cues and meter against the real CSS cascade (ui.html):
//
//   1. captions are accurate enough to rely on (word error rate)
//   2. they keep up with live audio (real-time factor below 1)
//   3. silence and music produce no captions at all
//
// The page is served with the same content security policy the manifest gives
// extension pages, and without cross-origin isolation, so it runs under the
// same limits as the offscreen document: no remote code, no SharedArrayBuffer.
//
// The first run downloads the 41 MB model into ./profile; later runs reuse it.
// Needs Windows (the speech clips are made with the built-in SAPI voices) and
// Google Chrome.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');
const AUDIO = path.join(HERE, 'audio');
const EXPECTED = require('./expected.json');

// Must match manifest.json content_security_policy.extension_pages.
const CSP = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'))
  .content_security_policy.extension_pages;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.wasm': 'application/wasm', '.wav': 'audio/wav'
};

// ── Test audio ──────────────────────────────────────────────────────────────

function ensureAudio() {
  fs.mkdirSync(AUDIO, { recursive: true });
  const speech = Object.keys(EXPECTED).filter(name => !fs.existsSync(path.join(AUDIO, name + '.wav')));
  if (speech.length) {
    console.log('making speech clips with SAPI: ' + speech.join(', '));
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(HERE, 'make-speech.ps1'), '-Out', AUDIO], { stdio: 'inherit' });
  }
  // Non-speech: silence, and a tone sequence with no words in it. Whisper
  // famously "hears" things in both.
  writeWav(path.join(AUDIO, 'silence.wav'), 48000, [new Float32Array(48000 * 6), new Float32Array(48000 * 6)]);
  const music = new Float32Array(48000 * 6);
  const notes = [262, 330, 392, 523, 392, 330];
  for (let i = 0; i < music.length; i++) {
    const f = notes[Math.floor(i / 48000) % notes.length];
    music[i] = 0.2 * Math.sin(2 * Math.PI * f * i / 48000) + 0.1 * Math.sin(2 * Math.PI * f * 2 * i / 48000);
  }
  writeWav(path.join(AUDIO, 'music.wav'), 48000, [music, music]);
}

function writeWav(file, rate, channels) {
  const frames = channels[0].length;
  const data = Buffer.alloc(frames * channels.length * 2);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels.length; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      data.writeInt16LE(Math.round(v * 32767), (i * channels.length + c) * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels.length, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels.length * 2, 28); header.writeUInt16LE(channels.length * 2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

// ── Scoring ─────────────────────────────────────────────────────────────────

const NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50
};

/** Lowercase words, with "3:30" and "three thirty" both becoming "3 30". */
function words(text) {
  return String(text).toLowerCase()
    .replace(/(\d+):(\d+)/g, '$1 $2')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\b(\w+)ise\b/g, '$1ize')     // apologise / apologize
    .split(/\s+/).filter(Boolean)
    .map(w => (w in NUMBERS ? String(NUMBERS[w]) : w));
}

/** Word error rate: edits needed to turn what was said into what was captioned. */
function wer(reference, hypothesis) {
  const r = words(reference);
  const h = words(hypothesis);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i].concat(new Array(h.length).fill(0)));
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) {
    for (let j = 1; j <= h.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    }
  }
  return r.length ? d[r.length][h.length] / r.length : (h.length ? 1 : 0);
}

// ── Serving the repo as if it were the extension ────────────────────────────

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = url.startsWith('/audio/')
      ? path.join(AUDIO, url.slice('/audio/'.length))
      : path.join(ROOT, url);
    if (!file.startsWith(ROOT) && !file.startsWith(AUDIO)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Content-Security-Policy': CSP,
        'Cache-Control': 'no-store'
      });
      res.end(body);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p));
}

// ── The run ─────────────────────────────────────────────────────────────────

(async () => {
  ensureAudio();
  const server = await serve();
  const port = server.address().port;
  const chrome = findChrome();
  if (!chrome) throw new Error('Google Chrome was not found; set CHROME_PATH');

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    userDataDir: path.join(HERE, 'profile'),     // keeps the model cached between runs
    args: ['--no-first-run', '--no-default-browser-check']
  });

  const failures = [];
  const passes = [];
  const check = (cond, msg) => (cond ? passes : failures).push(msg);

  try {
    // ── The overlays, under a hostile page stylesheet ────────────────────
    {
      const ui = await browser.newPage();
      await ui.setViewport({ width: 1280, height: 800 });
      // Headless Chrome reports prefers-reduced-motion: reduce by default. The
      // ripple is checked with the preference unset, and the reduced case
      // separately below, so neither is left to whatever the browser assumes.
      await ui.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
      ui.on('pageerror', err => failures.push('overlay page error: ' + err.message));
      ui.on('console', msg => { if (/Refused to/i.test(msg.text())) failures.push('overlay CSP: ' + msg.text()); });
      await ui.goto('http://127.0.0.1:' + port + '/test/browser/ui.html');
      await ui.waitForFunction('window.__result', { timeout: 30000 });
      const r = await ui.evaluate(() => window.__result);
      if (!r.ok) failures.push('overlay check threw: ' + r.error);
      r.results.forEach(x => check(x.ok, 'overlay: ' + x.msg));

      // The operating system's own preference, with no AccessiFlow setting.
      await ui.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      const still = await ui.evaluate(async () => {
        const h = new HearingModule();
        h.apply({ visualAlerts: true });
        h.showSoundCue({ rect: { top: 500, left: 600, width: 100, height: 40 }, strength: 1 });
        const ring = Array.from(document.querySelectorAll('.accessiflow-sound-cue--at')).pop();
        await new Promise(res => setTimeout(res, 300));
        return { calm: ring.classList.contains('accessiflow-sound-cue--calm'), transform: getComputedStyle(ring).transform };
      });
      check(still.calm && still.transform === 'none',
        'overlay: when the operating system asks for reduced motion, cues keep still with no setting needed: transform ' +
        still.transform);
      await ui.close();
    }
    if (!process.argv.includes('--ui-only')) await whisperCheck(browser, port, check, failures);
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n=== PASS (' + passes.length + ') ===');
  passes.forEach(m => console.log('  + ' + m));
  if (failures.length) {
    console.log('\n=== FAIL (' + failures.length + ') ===');
    failures.forEach(m => console.log('  ! ' + m));
    process.exit(1);
  }
  console.log('\nAll checks passed.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});

// ── Whisper on real speech ──────────────────────────────────────────────────

async function whisperCheck(browser, port, check, failures) {
  {
    const page = await browser.newPage();
    const cspErrors = [];
    page.on('console', msg => {
      const text = msg.text();
      if (/Content Security Policy|Refused to/i.test(text)) cspErrors.push(text);
      if (process.env.VERBOSE) console.log('  [page] ' + text);
    });
    page.on('pageerror', err => failures.push('page error: ' + err.message));

    const clips = Object.keys(EXPECTED).concat(['silence', 'music']);
    await page.goto('http://127.0.0.1:' + port + '/test/browser/harness.html?clips=' + clips.join(','));
    await page.waitForFunction('window.__result', { timeout: 15 * 60 * 1000, polling: 500 });
    const result = await page.evaluate(() => window.__result);
    if (!result.ok) throw new Error(result.error);

    check(cspErrors.length === 0,
      'nothing was blocked by the extension\u2019s content security policy' +
      (cspErrors.length ? ': ' + cspErrors[0] : ''));
    console.log('\nmodel loaded in ' + (result.loadMs / 1000).toFixed(1) + ' s\n');

    let busy = 0;
    let audio = 0;
    let fed = 0;
    result.results.forEach(r => {
      busy += r.busyMs;
      audio += r.transcribedSeconds;
      fed += r.audioSeconds + 2;          // the clip, plus a second of quiet either side
      const expected = EXPECTED[r.name];
      if (expected) {
        const rate = wer(expected, r.text);
        console.log(r.name.padEnd(12) + 'WER ' + (rate * 100).toFixed(1).padStart(5) + '%   ' + r.text);
        console.log(' '.repeat(12) + 'said:      ' + expected);
        console.log(' '.repeat(12) + 'first interim ' + (r.firstInterimMs === null ? 'none' : r.firstInterimMs + ' ms') +
          ', final caption lag ' + r.finalLagsMs.join('/') + ' ms after the pause was heard\n');
        check(rate <= 0.15, r.name + ': word error rate ' + (rate * 100).toFixed(1) + '% is within 15%');
        check(r.interims > 0, r.name + ': captions appeared while the sentence was still being spoken');
        check(r.finalLagsMs.every(ms => ms < 4000),
          r.name + ': each final caption arrived within 4 s of the speaker pausing');
      } else {
        console.log(r.name.padEnd(12) + (r.text ? 'CAPTIONED: "' + r.text + '"' : 'no captions') + '\n');
        check(!r.text, r.name + ': produced no captions, rather than invented ones');
      }
    });

    // What matters for live captions is whether Whisper's working time fits
    // inside the time the audio took to play. Interims re-transcribe the
    // growing segment, so the audio *transcribed* is more than the audio played.
    const load = (busy / 1000) / fed;
    console.log('Whisper busy ' + (busy / 1000).toFixed(1) + ' s during ' + fed.toFixed(1) +
      ' s of live audio (load ' + (load * 100).toFixed(0) + '%); ' + audio.toFixed(1) +
      ' s of audio transcribed, interims included');
    check(load < 1, 'transcription keeps up with live audio: busy ' + (load * 100).toFixed(0) + '% of the time');
  }
}
