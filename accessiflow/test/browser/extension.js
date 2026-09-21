// The whole chain, with the extension actually installed.
//
//   cd test/browser && node extension.js
//
// Loads AccessiFlow unpacked into Chrome, opens a page that plays recorded
// speech through an <audio> element, starts live captions from the service
// worker, and waits for the captions to arrive back in that page's caption
// box. Every piece the other checks exercise separately runs here together:
// manifest, service worker, offscreen document, tab capture, the audio
// worklet, the caption engine under the extension's real origin and CSP, the
// relay back to the tab, and the content script's overlay.
//
// Tab capture normally needs the user to have clicked AccessiFlow's toolbar
// button on the tab, which automation cannot do. Chrome's testing switch
// --allowlisted-extension-id lifts that one requirement for this extension
// only; nothing else about the path is bypassed.
//
// The first run downloads the 41 MB model into ./profile-ext; later runs
// reuse it.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');
const AUDIO = path.join(HERE, 'audio');
const EXPECTED = require('./expected.json');

const passes = [];
const failures = [];
const check = (cond, msg) => (cond ? passes : failures).push(msg);

function words(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
}

// A plain page that plays one clip when asked. Served over http so the
// content script runs on it as it would on any site.
function serve() {
  const page = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Appointment video</title></head>' +
    '<body><main><h1>Your appointment</h1><p>A recorded message from the clinic.</p>' +
    '<audio id="message" src="/audio/appointment.wav" preload="auto"></audio></main></body></html>';
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/audio/')) {
      const file = path.join(AUDIO, path.basename(req.url));
      return fs.readFile(file, (err, body) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'audio/wav' });
        res.end(body);
      });
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  if (!fs.existsSync(path.join(AUDIO, 'appointment.wav'))) {
    throw new Error('Run node run.js once first; it makes the speech clips.');
  }
  const server = await serve();
  const port = server.address().port;

  // The unpacked extension's id is derived from its path, so it is known
  // only after a first launch. Launch, read it, and relaunch with the switch.
  const launch = extraArgs => puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir: path.join(HERE, 'profile-ext'),
    // Official Chrome builds ignore --load-extension since Chrome 137, so the
    // extension is installed over the DevTools protocol instead.
    enableExtensions: [ROOT],
    pipe: true,
    ignoreDefaultArgs: ['--mute-audio'],
    args: ['--no-first-run', '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required'].concat(extraArgs || [])
  });

  let browser = await launch();
  const worker = await browser.waitForTarget(t => t.type() === 'service_worker' &&
    t.url().endsWith('/background.js'), { timeout: 20000 });
  const extensionId = new URL(worker.url()).host;
  await browser.close();
  check(/^[a-p]{32}$/.test(extensionId), 'the extension installs and its service worker starts: ' + extensionId);

  browser = await launch(['--allowlisted-extension-id=' + extensionId]);
  try {
    const swTarget = await browser.waitForTarget(t => t.type() === 'service_worker' &&
      t.url().startsWith('chrome-extension://' + extensionId), { timeout: 20000 });
    const sw = await swTarget.worker();

    // A message sent from the worker to itself is not delivered, so the
    // worker's own handler is invoked through the same functions it exposes.
    const call = (name, arg) => sw.evaluate((n, a) => globalThis[n](a), name, arg);

    let status = await call('relayToOffscreen', { action: 'captionModelStatus' });
    check(status && status.megabytes === 41,
      'the offscreen document starts, and the caption engine module loads inside the extension: ' + JSON.stringify(status));

    if (!status.downloaded) {
      console.log('downloading the caption model into the test profile (41 MB, first run only)...');
      const got = await call('relayToOffscreen', { action: 'downloadCaptionModel' });
      check(got && got.success, 'the model downloads through the extension: ' + JSON.stringify(got));
      status = await call('relayToOffscreen', { action: 'captionModelStatus' });
    }
    check(status.downloaded, 'and is found in the cache afterwards');

    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));
    await page.goto('http://127.0.0.1:' + port + '/');
    await page.waitForFunction(() => document.querySelector('audio').readyState >= 3, { timeout: 15000 });

    const tabId = await sw.evaluate(url => new Promise(resolve =>
      chrome.tabs.query({}, tabs => resolve((tabs.find(t => t.url && t.url.startsWith(url)) || {}).id))),
      'http://127.0.0.1:' + port);
    check(typeof tabId === 'number', 'the service worker can see the test tab');

    const started = await call('startCaptions', tabId);
    check(started && started.success, 'live captions start on the tab: ' + JSON.stringify(started));

    await page.waitForSelector('#accessiflow-live-captions', { timeout: 10000 });
    check(true, 'the caption box appears in the captured page');

    // Wait for the engine to be listening before playing, as a user would.
    await page.waitForFunction(() => /Listening/.test((document.querySelector('.accessiflow-live-captions-status') || {}).textContent || ''),
      { timeout: 60000 });
    const playedAt = Date.now();
    await page.evaluate(() => document.querySelector('audio').play());

    await page.waitForFunction(() => document.querySelectorAll('.accessiflow-live-captions-line').length > 0 &&
      document.querySelector('audio').ended, { timeout: 60000, polling: 250 });
    await new Promise(r => setTimeout(r, 4000));    // the last caption

    const lines = await page.$$eval('.accessiflow-live-captions-line', ns => ns.map(n => n.textContent));
    const text = lines.join(' ');
    console.log('\ncaptured tab said:  ' + EXPECTED.appointment);
    console.log('captions on page:   ' + text + '\n');

    const heard = new Set(words(text));
    const key = ['appointment', 'tuesday', 'insurance', 'card', 'medicines'];
    const found = key.filter(w => heard.has(w));
    check(found.length === key.length,
      'the captions carry what was said, end to end: ' + found.length + ' of ' + key.length + ' key words (' + found.join(', ') + ')');

    check(pageErrors.length === 0, 'the page threw nothing' + (pageErrors.length ? ': ' + pageErrors[0] : ''));
    console.log('first caption line arrived; total ' + ((Date.now() - playedAt) / 1000).toFixed(1) + ' s from play to settled');

    await call('relayToOffscreen', { action: 'stopCapture', reason: 'user' });
    await page.waitForFunction(() => !document.getElementById('accessiflow-live-captions'), { timeout: 10000 });
    check(true, 'stopping removes the caption box from the page');
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
