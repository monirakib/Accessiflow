// What AccessiFlow's screen reader says for a page, all of it, to a file.
//
//   cd test/browser && node transcript.js <url> [out.txt]
//
// The same words reading everything (Insert+Down) would speak, one line per
// line, taken straight from the reader's own buffer inside the extension, so
// it is complete and repeatable, and needs no speech. Compare it with NVDA's
// Speech Viewer using test/eval/compare-nvda.js.
//
// Frames from other sites are included: the transcript waits for their agents.
'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const wait = ms => new Promise(r => setTimeout(r, ms));

// Evaluated inside the extension's content-script world.
const EXTRACT = `(() => {
  const r = window.AccessiFlowScreenReader && window.AccessiFlowScreenReader._current;
  if (!r) return { error: 'the screen reader is not running on this page' };
  const buf = r._buffer(true);
  let prev = null;
  const lines = buf.items.map(it => { const s = r._speechFor(it, prev, !!prev); prev = it; return s; });
  return { title: document.title, lines: lines };
})()`;

(async () => {
  const url = process.argv[2];
  if (!url) {
    console.error('usage: node transcript.js <url> [out.txt]');
    process.exit(2);
  }
  const host = (() => { try { return new URL(url).hostname || 'page'; } catch (e) { return 'page'; } })();
  const out = process.argv[3] || path.join(ROOT, 'test', 'eval', 'transcripts', host + '-accessiflow.txt');

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    enableExtensions: [ROOT],
    pipe: true,
    args: ['--no-first-run', '--no-default-browser-check', '--mute-audio']
  });
  try {
    const swTarget = await browser.waitForTarget(t => t.type() === 'service_worker' &&
      t.url().endsWith('/background.js'), { timeout: 20000 });
    const sw = await swTarget.worker();
    await sw.evaluate(() => chrome.storage.local.set({ accessiflowScreenReader: true }));

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const cdp = await page.createCDPSession();
    const contexts = [];
    cdp.on('Runtime.executionContextCreated', e => contexts.push(e.context));
    await cdp.send('Runtime.enable');
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await wait(4000);    // the repairs, the reader, and the frames' agents

    const { frameTree } = await cdp.send('Page.getFrameTree');
    const ours = contexts.filter(c => c.auxData && c.auxData.type === 'isolated' &&
      c.auxData.frameId === frameTree.frame.id && c.name === MANIFEST.name);
    if (!ours.length) throw new Error('the extension is not running in this page');
    const reply = await cdp.send('Runtime.evaluate', {
      expression: EXTRACT, contextId: ours[ours.length - 1].id, returnByValue: true
    });
    const value = reply.result && reply.result.value;
    if (!value || value.error) throw new Error((value && value.error) || 'nothing came back');

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, value.lines.join('\n') + '\n');
    console.log('Wrote ' + value.lines.length + ' lines for "' + value.title + '" to ' + out);
  } catch (e) {
    console.error('transcript failed: ' + e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
