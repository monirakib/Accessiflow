// The screen reader's third part with the extension installed, in real Chrome:
// speech before the user has pressed anything, and frames from another site.
//
//   cd test/browser && node reader-frames.js
//
// Two servers on two ports are two origins, so the payment frame here really
// is out of the page's reach, as a bank's or a card processor's would be. The
// reader can only read it through the agent the service worker injects.
'use strict';

const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..', '..');
const passes = [];
const failures = [];
const check = (cond, msg) => (cond ? passes : failures).push(msg);
const wait = ms => new Promise(r => setTimeout(r, ms));

const PAY = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Pay</title></head>
<body style="font:16px sans-serif">
  <h2>Card details</h2>
  <label for="card">Card number</label> <input id="card">
  <button id="payb" onclick="document.body.dataset.paid = (Number(document.body.dataset.paid || 0) + 1)">Pay now</button>
  <p>Secure payment</p>
  <div id="msg" role="alert"></div>
</body></html>`;

const shop = payUrl => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Checkout</title></head>
<body style="font:16px sans-serif">
  <h1>Checkout</h1>
  <p>Your basket: 2 items.</p>
  <iframe id="pay" title="Payment" src="${payUrl}" style="width:500px;height:260px"></iframe>
  <iframe id="notes" title="Delivery notes" srcdoc="<h2>Delivery notes</h2><p>Leave at the door.</p>" style="width:500px;height:120px"></iframe>
  <p>Thank you for shopping.</p>
</body></html>`;

function serve(body) {
  return new Promise(resolve => {
    const server = http.createServer((q, s) => {
      s.writeHead(200, { 'Content-Type': 'text/html' });
      s.end(typeof body === 'function' ? body() : body);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const payServer = await serve(PAY);
  const payUrl = 'http://127.0.0.1:' + payServer.address().port + '/';
  const shopServer = await serve(() => shop(payUrl));
  // "localhost" and "127.0.0.1" are different origins, as two companies' sites are.
  const url = 'http://localhost:' + shopServer.address().port + '/';

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    enableExtensions: [ROOT],
    pipe: true,
    args: ['--no-first-run', '--no-default-browser-check']
  });

  const pageErrors = [];
  try {
    const swTarget = await browser.waitForTarget(t => t.type() === 'service_worker' &&
      t.url().endsWith('/background.js'), { timeout: 20000 });
    const sw = await swTarget.worker();
    await sw.evaluate(() => chrome.storage.local.set({
      accessiflowScreenReader: true,
      'settings_localhost': { srSpeechViewer: true }
    }));
    // Everything the page asks the computer's voices to say, through chrome.tts.
    await sw.evaluate(() => {
      self.__systemSpoken = [];
      const real = chrome.tts.speak.bind(chrome.tts);
      chrome.tts.speak = (text, options, cb) => { self.__systemSpoken.push(text); return real(text, options, cb); };
    });

    const site = await browser.newPage();
    site.on('pageerror', e => pageErrors.push(e.message));
    await site.goto(url);
    await wait(3000);    // content scripts, the agent injected into the frame, its first lines

    const systemSpoken = await sw.evaluate(() => self.__systemSpoken.slice());
    check(systemSpoken.some(t => /Checkout/.test(t)),
      'on arrival, before any key press, the title is spoken through the computer\'s voices: ' + JSON.stringify(systemSpoken.slice(0, 2)));

    const said = () => site.evaluate(() => {
      const host = document.getElementById('accessiflow-sr-viewer');
      return host ? host.shadowRoot.textContent.replace(/^(Browse|Focus) mode/, '') : null;
    });
    const key = async (k, mods) => {
      for (const m of mods || []) await site.keyboard.down(m);
      await site.keyboard.press(k);
      for (const m of (mods || []).slice().reverse()) await site.keyboard.up(m);
      await wait(250);
    };
    const payFrame = () => site.frames().find(f => f.url().startsWith(payUrl));

    check(await site.evaluate(() => { try { return !document.getElementById('pay').contentDocument; } catch (e) { return true; } }),
      'the payment frame really is out of the page\'s reach');

    // The first line is AccessiFlow's skip link, so H goes to Checkout first.
    await key('h');
    await key('h');
    check(/frame, Payment, heading level 2, Card details/.test(await said()),
      'H finds the heading inside the other site\'s frame, named as being in it: ' + await said());
    await key('ArrowDown'); await key('ArrowDown');
    check(/Card number, edit, blank/.test(await said()), 'the frame\'s field reads like the page\'s own: ' + await said());

    await key('Enter');
    await wait(300);
    const focused = await payFrame().evaluate(() => document.activeElement && document.activeElement.id);
    check(focused === 'card', 'Enter puts the keyboard in the card box, inside the frame: ' + focused);
    check(/Card number, edit/.test(await said()), 'and says where it is: ' + await said());
    await site.keyboard.type('4242', { delay: 30 });
    await wait(200);
    check(await payFrame().$eval('#card', n => n.value) === '4242', 'digits typed go into the card box');

    await key('Escape');
    await wait(200);
    await key('ArrowDown');
    await wait(200);
    check(/Pay now, button/.test(await said()), 'Escape, then the down arrow, pressed inside the frame, move the reader on: ' + await said());
    await key('Enter');
    await wait(300);
    check(await payFrame().evaluate(() => document.body.dataset.paid) === '1', 'Enter presses the frame\'s button');

    await payFrame().evaluate(() => { document.getElementById('msg').textContent = 'Card declined'; });
    for (let i = 0; i < 20 && !/Card declined/.test(await said()); i++) await wait(200);
    check(/Card declined/.test(await said()), 'an alert inside the frame is read out: ' + await said());

    // The same-site frame is read directly.
    await site.keyboard.down('Control'); await site.keyboard.press('Home'); await site.keyboard.up('Control');
    await wait(200);
    await key('2'); await key('2');
    check(/frame, Delivery notes, heading level 2, Delivery notes/.test(await said()),
      'a frame from the same site is read as part of the page too: ' + await said());
    await key('ArrowDown');
    check(/Leave at the door/.test(await said()), 'line by line: ' + await said());

    // Off: the frame gives its keys back.
    await site.keyboard.down('Alt'); await site.keyboard.down('Shift');
    await site.keyboard.press('z');
    await site.keyboard.up('Shift'); await site.keyboard.up('Alt');
    await wait(500);
    const handled = await payFrame().evaluate(() => new Promise(resolve => {
      const input = document.getElementById('card');
      input.focus();
      const e = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      input.dispatchEvent(e);
      resolve(e.defaultPrevented);
    }));
    check(handled === false, 'switched off, the frame\'s keys are its own again');

    check(pageErrors.length === 0, 'no errors on the page' + (pageErrors.length ? ': ' + pageErrors.join('; ') : ''));
  } catch (e) {
    failures.push('crashed: ' + e.stack);
  } finally {
    await browser.close();
    payServer.close();
    shopServer.close();
  }

  console.log('=== ' + (failures.length ? 'FAIL' : 'PASS') + ' (' + passes.length + ') ===');
  passes.forEach(m => console.log('  + ' + m));
  failures.forEach(m => console.log('  - ' + m));
  process.exit(failures.length ? 1 : 0);
})();
