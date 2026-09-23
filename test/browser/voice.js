// Voice control with the extension actually installed.
//
//   cd test/browser && node voice.js
//
// Opens a site and the voice panel, then drives the panel with the words a
// recogniser would hand it, and checks the site responds: the whole route
// from panel to service-worker-free tab messaging to the content script and
// back, under the extension's real origin and Chrome's real tab APIs.
//
// Speech itself is not tested here. Chrome's fake-microphone switch corrupts
// audio on its way to the speech service, so recognition accuracy has to be
// checked by a person with a real microphone.
'use strict';

const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..', '..');
const passes = [];
const failures = [];
const check = (cond, msg) => (cond ? passes : failures).push(msg);
const wait = ms => new Promise(r => setTimeout(r, ms));

const PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Passport portal</title></head>
<body style="font:16px sans-serif">
  <nav>
    <a href="#apply" id="apply">Apply online</a>
    <a id="urgent" tabindex="0" onclick="document.title='urgent clicked'">Urgent applications</a>
    <a href="#fees" id="fees">Passport fees</a>
  </nav>
  <h1>Welcome</h1>
  <form onsubmit="event.preventDefault(); document.title='sent ' + document.getElementById('name').value">
    <label>Full name <input id="name" required></label>
    <button>Send</button>
  </form>
  <div style="height:3000px"></div>
  <h2 id="end">The end</h2>
</body></html>`;

// Like the passport site's warning: a dimmed backdrop over the whole page,
// and a close ✕ that is a <span> with a click handler, not a button.
const POPUP = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Notice</title>
<style>
  #backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: grid; place-items: center; }
  #box { background: #fff; width: 600px; padding: 30px; position: relative; }
  #x { position: absolute; top: 8px; right: 12px; cursor: pointer; font-size: 22px; }
</style></head>
<body>
  <nav><a href="/">Home</a> <a href="/second">Second page</a> <a href="#c">Contact</a></nav>
  <div id="backdrop"><div id="box"><span id="x">✕</span><h2>Special warning</h2><p>Never pay anyone.</p></div></div>
  <script>document.getElementById('x').onclick = () => document.getElementById('backdrop').remove();</script>
</body></html>`;

const SECOND = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Second</title></head>
<body><a href="/">Back home</a> <button>One</button> <button>Two</button></body></html>`;

(async () => {
  const server = http.createServer((q, s) => {
    s.writeHead(200, { 'Content-Type': 'text/html' });
    s.end(q.url === '/popup' ? POPUP : q.url === '/second' ? SECOND : PAGE);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/';

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
    const id = new URL(swTarget.url()).host;
    const sw = await swTarget.worker();

    // A fresh install opens the setup page by itself, at a moment of its own
    // choosing. Left open, it can become the "most recent" tab that voice
    // commands are sent to, and every command gets Chrome's refusal. It is
    // closed first, as a user would once they had finished with it.
    const setupTab = await browser.waitForTarget(t => t.type() === 'page' &&
      t.url().startsWith('chrome-extension://' + id + '/welcome.html'), { timeout: 5000 }).catch(() => null);
    if (setupTab) await (await setupTab.page()).close();

    const options = await sw.evaluate(() => chrome.sidePanel.getOptions({}));
    check(options && options.path === 'voice-panel.html' && options.enabled !== false,
      'the voice panel is registered as the side panel: ' + JSON.stringify(options));

    const site = await browser.newPage();
    site.on('pageerror', e => pageErrors.push('site: ' + e.message));
    await site.goto(url);
    await wait(800);                      // content scripts run at document_idle

    const panel = await browser.newPage();
    panel.on('pageerror', e => pageErrors.push('panel: ' + e.message));
    await panel.goto('chrome-extension://' + id + '/voice-panel.html');
    await wait(300);

    const state = await panel.$eval('#stateLabel', n => n.textContent);
    check(state === 'Microphone needed', 'with no microphone permission the panel asks for it: ' + state);

    const say = async text => {
      await panel.evaluate(t => window.__accessiflowVoiceHear(t), text);
      return panel.$eval('#reply', n => n.textContent);
    };

    let reply = await say('click urgent applications');
    check(await site.title() === 'urgent clicked',
      'saying "click urgent applications" clicks the link that only listens for the mouse: ' + reply);

    const numberCount = () => site.evaluate(() => {
      const host = document.getElementById('accessiflow-voice-numbers');
      return host ? host.shadowRoot.querySelectorAll('.hint').length : 0;
    });
    reply = await say('show numbers');
    const numbered = await numberCount();
    check(numbered >= 4, 'show numbers numbers the page\u2019s controls: ' + numbered + ' (' + reply + ')');
    reply = await say('no numbers');
    check(await numberCount() === 0, 'no numbers removes them: ' + reply);

    reply = await say('type Akib Monir');
    check(await site.$eval('#name', n => n.value) === 'Akib Monir', 'type fills the text box: ' + reply);

    reply = await say('submit');
    check(/Say yes or no/.test(reply) && await site.title() === 'urgent clicked', 'submit asks first: ' + reply);
    reply = await say('yes');
    check(await site.title() === 'sent Akib Monir', 'yes sends the form: ' + reply);

    reply = await say('bottom');
    await wait(900);
    check(await site.evaluate(() => window.scrollY) > 1000, 'bottom scrolls to the end: ' + reply);
    reply = await say('top');
    await wait(900);
    check(await site.evaluate(() => window.scrollY) < 50, 'top scrolls back up: ' + reply);

    await say('click passport fees');
    await wait(200);
    check(site.url().endsWith('#fees'), 'click passport fees follows the link');
    reply = await say('go back');
    await wait(500);
    check(!site.url().endsWith('#fees'), 'go back goes back, through the browser: ' + reply);

    // ── A pop-up in the way ──
    await site.goto(url + 'popup');
    await wait(800);
    reply = await say('show numbers');
    const labelled = await site.evaluate(() => {
      const host = document.getElementById('accessiflow-voice-numbers');
      if (!host) return [];
      return Array.from(host.shadowRoot.querySelectorAll('.hint')).map(h => [h.textContent, h.style.left, h.style.top]);
    });
    const xBox = await site.$eval('#x', n => { const r = n.getBoundingClientRect(); return [r.left, r.top]; });
    check(labelled.length === 1,
      'behind a pop-up, only the pop-up’s own ✕ is numbered, not the covered links: ' + JSON.stringify(labelled) + ' ' + reply);
    check(labelled.length && Math.abs(parseFloat(labelled[0][1]) - (xBox[0] - 4)) < 2,
      'and the number sits on the ✕, a <span> found by its pointer cursor');

    reply = await say('close pop up');
    await wait(300);
    check(await site.evaluate(() => !document.getElementById('backdrop')), 'close pop up closes it: ' + reply);
    await wait(700);
    check(await numberCount() === 3, 'with it gone, the page behind is numbered, since numbers stayed on: ' + await numberCount());

    // ── Numbers stay on through a click and a new page ──
    const secondLabel = await site.evaluate(() => {
      const host = document.getElementById('accessiflow-voice-numbers');
      const links = Array.from(document.querySelectorAll('nav a'));
      const target = links.find(a => a.textContent === 'Second page').getBoundingClientRect();
      return Array.from(host.shadowRoot.querySelectorAll('.hint'))
        .find(h => Math.abs(parseFloat(h.style.left) - (target.left - 4)) < 2).textContent;
    });
    reply = await say(secondLabel);
    await site.waitForFunction(() => document.title === 'Second', { timeout: 5000 });
    await wait(1800);
    check(await numberCount() === 3,
      'after saying a number that opens a new page, the new page is numbered too, with no "show numbers": ' + await numberCount());
    reply = await say('disable numbers');
    check(await numberCount() === 0, 'disable numbers turns them off: ' + reply);
    await site.goto(url);
    await wait(1500);
    check(await numberCount() === 0, 'and they stay off on the next page');

    reply = await say('go to sleep');
    await say('show numbers');
    check(await site.evaluate(() => !document.getElementById('accessiflow-voice-numbers')),
      'asleep, show numbers does nothing');
    await say('wake up');
    reply = await say('the weather is lovely today, is it not');
    check(!/Chose|numbered|Scrolled/.test(reply), 'chatter does nothing: ' + reply);

    check(pageErrors.length === 0, 'no errors on the page or in the panel' + (pageErrors.length ? ': ' + pageErrors.join('; ') : ''));
  } catch (e) {
    failures.push('crashed: ' + e.stack);
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
})();
