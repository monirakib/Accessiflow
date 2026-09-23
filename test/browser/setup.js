// First run, end to end, with the extension really installed.
//
//   cd test/browser && node setup.js
//
// A fresh profile each time, so Chrome installs AccessiFlow from scratch and
// the install event fires, as it does for a new user. Checks that:
//
//   1. the setup page opens by itself and starts talking with no click
//      (chrome.tts reports it is speaking)
//   2. it can be finished with the keyboard alone: 2, Enter, Enter, Enter
//   3. a website opened afterwards follows the setup, with no popup opened:
//      the built-in reader is on, typed keys are spoken, a password says star
//   4. the floating Stop button appears during long speech, is really
//      visible, and Ctrl on its own stops the speech
//   5. the popup's Home screen lays out in the real CSS cascade: four large
//      buttons, no sideways scrolling, All settings one press away
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const passes = [];
const failures = [];
const check = (cond, msg) => (cond ? passes : failures).push(msg);
const wait = ms => new Promise(r => setTimeout(r, ms));

function serve() {
  const page = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Clinic booking</title></head>' +
    '<body><main><h1>Book an appointment</h1>' +
    '<p>' + 'Choose a day and a time that suits you, and we will send a reminder the day before. '.repeat(8) + '</p>' +
    '<form id="signup"><label for="name">Your name</label> <input id="name" type="text" required> ' +
    '<label for="pw">Password</label> <input id="pw" type="password"></form>' +
    '</main></body></html>';
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Runs an expression in AccessiFlow's own world inside a page. */
async function inExtensionWorld(page, expression) {
  const cdp = await page.createCDPSession();
  const contexts = [];
  cdp.on('Runtime.executionContextCreated', e => contexts.push(e.context));
  await cdp.send('Runtime.enable');
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const ours = contexts.filter(c => c.auxData && c.auxData.type === 'isolated' &&
    c.auxData.frameId === frameTree.frame.id && c.name === MANIFEST.name);
  if (!ours.length) throw new Error('the extension is not running in this page');
  const reply = await cdp.send('Runtime.evaluate', {
    expression: expression, contextId: ours[ours.length - 1].id, returnByValue: true, awaitPromise: true
  });
  await cdp.detach();
  if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.text + ' ' + JSON.stringify(reply.exceptionDetails.exception || ''));
  return reply.result && reply.result.value;
}

(async () => {
  const server = await serve();
  const port = server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'accessiflow-setup-'));

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    userDataDir: profile,
    enableExtensions: [ROOT],
    pipe: true,
    args: ['--no-first-run', '--no-default-browser-check']
  });

  try {
    const swTarget = await browser.waitForTarget(t => t.type() === 'service_worker' &&
      t.url().endsWith('/background.js'), { timeout: 20000 });
    const sw = await swTarget.worker();
    const extensionId = new URL(swTarget.url()).host;

    // ── 1. It opens by itself, and talks ────────────────────────────────────
    const welcomeTarget = await browser.waitForTarget(t => t.type() === 'page' &&
      t.url().startsWith('chrome-extension://' + extensionId + '/welcome.html'), { timeout: 15000 })
      .catch(() => null);
    check(Boolean(welcomeTarget), 'installing AccessiFlow opens the setup page by itself');
    if (!welcomeTarget) throw new Error('no setup page');
    const welcome = await welcomeTarget.page();
    const welcomeErrors = [];
    welcome.on('pageerror', err => welcomeErrors.push(err.message));
    await welcome.waitForFunction(() => document.getElementById('btnVoice').getAttribute('aria-pressed') === 'true',
      { timeout: 10000 });
    const voices = await welcome.evaluate(() => new Promise(r => chrome.tts.getVoices(v => r(v.length))));
    let speaking = false;
    for (let i = 0; i < 20 && !speaking; i++) {
      speaking = await welcome.evaluate(() => new Promise(r => chrome.tts.isSpeaking(r)));
      if (!speaking) await wait(100);
    }
    check(speaking, 'and it is speaking straight away, with no click (chrome.tts, ' + voices + ' voices on this computer)');

    // ── 2. Keys only ────────────────────────────────────────────────────────
    await welcome.bringToFront();
    await welcome.keyboard.press('2');
    check(await welcome.evaluate(() => document.getElementById('need-blind').checked), 'pressing 2 chooses "Blind"');
    await welcome.keyboard.press('Enter');
    await welcome.keyboard.press('Enter');
    await welcome.keyboard.press('Enter');
    await welcome.waitForFunction(() => !document.getElementById('step-saved').hidden, { timeout: 5000 })
      .catch(() => {});
    const stored = await welcome.evaluate(() => new Promise(r => chrome.storage.local.get(null, r)));
    const setup = stored.accessiflow_setup;
    check(setup && setup.needs.join(',') === 'blind' && stored.accessiflowScreenReader === true &&
      setup.settings.keyEcho === 'letters',
      'Enter three times finishes it: a blind setup, the built-in reader on, key echo on');
    check(welcomeErrors.length === 0, 'with no errors on the setup page' + (welcomeErrors.length ? ': ' + welcomeErrors.join('; ') : ''));
    await welcome.evaluate(() => chrome.tts.stop());

    // ── 3. A website opened afterwards follows the setup ────────────────────
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });
    await wait(1500);

    // Record what AccessiFlow says, in its own world, where it says it.
    await inExtensionWorld(page, `(() => {
      window.__said = [];
      const synth = window.speechSynthesis;
      synth.speak = u => { window.__said.push(u.text); window.__held = u; };
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (msg, cb) => {
        if (msg && msg.action === 'speakSystem') { window.__said.push(msg.text); if (cb) cb({ success: true }); return; }
        return send(msg, cb);
      };
      return true;
    })()`);

    const readerOn = await inExtensionWorld(page,
      'Boolean(window.AccessiFlowScreenReader && window.AccessiFlowScreenReader._current && window.AccessiFlowScreenReader._current.active)');
    check(readerOn, 'a website opened after setup has the built-in reader running, with no popup opened');

    // Entering a form: its summary appears above it and, with the built-in
    // reader on, is read after the field's name. This profile has not agreed
    // to automatic Smart help, so the summary is the one made on this computer.
    await inExtensionWorld(page, 'window.__said.length = 0');
    await page.click('#name');
    await wait(400);
    await inExtensionWorld(page, 'window.__held && window.__held.onend && window.__held.onend()');
    await wait(300);
    const entered = await inExtensionWorld(page, 'window.__said.slice()');
    const brief = await page.evaluate(() => {
      const panel = document.querySelector('#signup').previousElementSibling;
      return panel && panel.classList.contains('accessiflow-form-brief')
        ? { text: panel.querySelector('.accessiflow-form-brief-text').textContent, source: panel.dataset.source } : null;
    });
    check(brief && brief.source === 'local' && /It has 2 questions\. It asks for: Your name and a password \(optional\)\./.test(brief.text),
      'entering a form shows its summary, made on this computer with nothing sent: ' + JSON.stringify(brief));
    const nameAt = entered.findIndex(t => /Your name/.test(t) && !/Before you start/.test(t));
    const briefAt = entered.findIndex(t => /^Before you start this form/.test(t));
    check(nameAt > -1 && briefAt > nameAt,
      'and with the built-in reader on it is read out, after the field\'s name: ' + entered.join(' | '));
    await page.keyboard.press('Control');
    await wait(100);
    await inExtensionWorld(page, 'window.__said.length = 0');
    await page.keyboard.type('Hi', { delay: 60 });
    await wait(300);
    let said = await inExtensionWorld(page, 'window.__said.slice()');
    check(said.includes('cap H') && said.includes('i'), 'typed keys are spoken as they are typed: ' + said.join(' | '));

    await page.click('#pw');
    await wait(200);
    await inExtensionWorld(page, 'window.__said.length = 0');
    await page.keyboard.type('ab', { delay: 60 });
    await wait(300);
    said = await inExtensionWorld(page, 'window.__said.slice()');
    check(said.filter(s => s === 'star').length === 2 && !said.includes('a') && !said.includes('b'),
      'a password box says star, never the letter: ' + said.join(' | '));

    // ── 3b. Shift pauses the reader's read-all, and it carries on ──────────
    // The recorder above never finishes a sentence by itself; finishing one
    // is done by hand, which is how "the voice got to the end" is simulated.
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.down('Control');
    await page.keyboard.press('Home');
    await page.keyboard.up('Control');
    await wait(300);
    await inExtensionWorld(page, 'window.__said.length = 0');
    await page.keyboard.down('Insert');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Insert');
    await wait(400);
    const firstLine = await inExtensionWorld(page, 'window.__said.slice()');
    await page.keyboard.press('Shift');                 // pause
    await wait(300);
    const whilePaused = await inExtensionWorld(page, 'window.__said.length');
    await inExtensionWorld(page, 'window.__said.length = 0');
    await page.keyboard.press('Shift');                 // carry on
    await wait(300);
    await inExtensionWorld(page, 'window.__held && window.__held.onend && window.__held.onend()');
    await wait(400);
    const afterResume = await inExtensionWorld(page, 'window.__said.slice()');
    check(firstLine.length === 1 && whilePaused === 1,
      'Shift pauses the built-in reader\'s read-all: nothing more is said while paused: ' + firstLine.join(' | '));
    check(afterResume.length >= 2 && afterResume[0] === firstLine[0] && afterResume[1] !== firstLine[0],
      'Shift again carries on with that line, and read-all goes on to the next: ' + afterResume.slice(0, 2).join(' | '));
    await page.keyboard.press('Control');

    // ── 4. Stop ─────────────────────────────────────────────────────────────
    // The button is for people reading without the built-in reader, whose
    // own Ctrl already stops it; switch the reader off first.
    await sw.evaluate(() => chrome.storage.local.set({ accessiflowScreenReader: false }));
    await wait(400);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.down('Alt');
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyR');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Alt');
    await wait(1400);
    const stop = await page.evaluate(() => {
      const host = document.getElementById('accessiflow-sr-stop');
      if (!host || host.style.display === 'none') return null;
      const button = host.shadowRoot.querySelector('button[data-action="stop"]');
      const pause = host.shadowRoot.querySelector('button[data-action="pause"]');
      const r = button.getBoundingClientRect();
      const q = pause.getBoundingClientRect();
      return { w: r.width, h: r.height, right: innerWidth - r.right, bottom: innerHeight - r.bottom,
        text: button.textContent, pause: pause.textContent, pauseH: q.height, pauseLeftOfStop: q.right <= r.left };
    });
    check(stop && stop.h >= 44 && stop.w > 100 && stop.right >= 0 && stop.bottom >= 0,
      'during a long read a Stop button appears in the corner, at least 44 px tall: ' + JSON.stringify(stop));
    check(stop && stop.pauseH >= 44 && stop.pauseLeftOfStop && /^Pause/.test(stop.pause),
      'with a Pause button beside it, just as large');

    const pillLabel = () => page.evaluate(() => {
      const host = document.getElementById('accessiflow-sr-stop');
      return host && host.style.display !== 'none'
        ? host.shadowRoot.querySelector('button[data-action="pause"]').textContent : 'hidden';
    });
    await page.keyboard.press('Shift');
    await wait(200);
    const pausedLabel = await pillLabel();
    await page.keyboard.press('Shift');
    await wait(200);
    const resumedLabel = await pillLabel();
    check(/^Carry on/.test(pausedLabel) && /^Pause/.test(resumedLabel),
      'Shift pauses and the button offers to carry on; Shift again carries on: ' + pausedLabel + ' / ' + resumedLabel);
    await page.keyboard.press('Control');
    await wait(200);
    const afterCtrl = await page.evaluate(() => {
      const host = document.getElementById('accessiflow-sr-stop');
      return host ? host.style.display : 'none';
    });
    const reading = await inExtensionWorld(page, 'document.getElementById("accessiflow-sr-stop") && true');
    check(afterCtrl === 'none' && reading, 'Ctrl on its own stops it, and the button goes away');
    check(pageErrors.length === 0, 'with no errors on the website' + (pageErrors.length ? ': ' + pageErrors.join('; ') : ''));

    // ── 5. The popup, in the real cascade ───────────────────────────────────
    const popup = await browser.newPage();
    await popup.setViewport({ width: 420, height: 600 });
    const popupErrors = [];
    popup.on('pageerror', err => popupErrors.push(err.message));
    await popup.goto('chrome-extension://' + extensionId + '/popup.html', { waitUntil: 'load' });
    await wait(500);
    const layout = await popup.evaluate(() => {
      const shown = el => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
      const actions = Array.from(document.querySelectorAll('.action-btn')).filter(shown).map(b => {
        const r = b.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
      });
      return {
        actions: actions,
        home: shown(document.getElementById('homeView')),
        all: shown(document.getElementById('allView')),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        needs: document.getElementById('setupNeeds').textContent,
        quick: document.querySelectorAll('#homeControls .row').length
      };
    });
    check(layout.home && !layout.all, 'the popup opens on Home, with All settings out of sight');
    check(layout.actions.length === 4 && layout.actions.every(a => a.h >= 44 && a.w >= 150),
      'four large buttons, each well over the 44 px minimum: ' + JSON.stringify(layout.actions));
    check(layout.actions.length === 4 && layout.actions[0].top === layout.actions[1].top &&
      layout.actions[2].top === layout.actions[3].top && layout.actions[2].top > layout.actions[0].top,
      'laid out two by two');
    check(layout.overflow <= 0, 'nothing on Home scrolls sideways: ' + layout.overflow + ' px');
    check(/Screen reader/.test(layout.needs) && layout.quick > 0,
      'Home shows the setup and its settings: ' + layout.needs + ', ' + layout.quick + ' settings');

    await popup.click('#btnAllSettings');
    await wait(200);
    const allShown = await popup.evaluate(() => ({
      home: getComputedStyle(document.getElementById('homeView')).display,
      sections: Array.from(document.querySelectorAll('#sections .section')).filter(s => s.getBoundingClientRect().height > 0).length,
      focus: document.activeElement && document.activeElement.id
    }));
    check(allShown.home === 'none' && allShown.sections === 9 && allShown.focus === 'allTitle',
      'All settings replaces Home, shows every group, and takes focus: ' + JSON.stringify(allShown));
    check(popupErrors.length === 0, 'with no errors in the popup' + (popupErrors.length ? ': ' + popupErrors.join('; ') : ''));
  } catch (e) {
    failures.push('the run stopped: ' + e.message);
  } finally {
    await browser.close();
    server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Chrome may still hold a file */ }
  }

  console.log('\n=== PASS (' + passes.length + ') ===');
  passes.forEach(m => console.log('  + ' + m));
  if (failures.length) {
    console.log('\n=== FAIL (' + failures.length + ') ===');
    failures.forEach(m => console.log('  ! ' + m));
    process.exit(1);
  }
  console.log('\nAll checks passed.');
})();
