// The built-in screen reader with the extension actually installed.
//
//   cd test/browser && node reader.js
//
// jsdom cannot answer the questions that decide whether this works for a blind
// user in Chrome: whether the arrow keys really stop scrolling the page,
// whether Chrome's own Tab moves on from where the reader put focus, and
// whether the reading cursor is drawn with the CSS highlight API. This drives
// real key presses into a real page and reads the answers off the speech
// viewer, the caption box that shows what the reader says.
//
// The voice itself is not checked: headless Chrome has no speech output.
'use strict';

const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..', '..');
const passes = [];
const failures = [];
const check = (cond, msg) => (cond ? passes : failures).push(msg);
const wait = ms => new Promise(r => setTimeout(r, ms));

const PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Corner Shop</title></head>
<body style="font:16px sans-serif">
  <nav aria-label="Main"><a href="#a">About</a> <a href="#b">Blog</a></nav>
  <main>
    <h1>Welcome</h1>
    <p id="intro">We sell tea and bread.</p>
    <button id="one">One</button>
    <p id="mid">Some text between the buttons.</p>
    <button id="two">Two</button>
    <label>Your name <input id="name"></label>
    <table><tr><th>Item</th><th>Price</th></tr><tr><th>Tea</th><td>3 taka</td></tr></table>
    <button id="add" onclick="document.getElementById('cart').textContent = 'Added to cart'">Add</button>
    <div id="cart" role="status"></div>
    <a id="toend" href="#end">Jump to the end</a>
    <div style="height:3000px"></div>
    <h2 id="end">The end</h2>
  </main>
</body></html>`;

(async () => {
  const server = http.createServer((q, s) => {
    s.writeHead(200, { 'Content-Type': 'text/html' });
    s.end(PAGE);
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
    const sw = await swTarget.worker();
    // On, as the popup switch would leave it, with the speech viewer showing.
    await sw.evaluate(() => chrome.storage.local.set({
      accessiflowScreenReader: true,
      'settings_127.0.0.1': { srSpeechViewer: true }
    }));

    const site = await browser.newPage();
    site.on('pageerror', e => pageErrors.push(e.message));
    await site.goto(url);
    await wait(1200);                     // content scripts run at document_idle

    const said = () => site.evaluate(() => {
      const host = document.getElementById('accessiflow-sr-viewer');
      return host ? host.shadowRoot.textContent : null;
    });
    const key = async (k, opts) => {
      if (opts && opts.shift) await site.keyboard.down('Shift');
      await site.keyboard.press(k);
      if (opts && opts.shift) await site.keyboard.up('Shift');
      await wait(120);
    };
    const withInsert = async k => {
      await site.keyboard.down('Insert');
      await site.keyboard.press(k);
      await site.keyboard.up('Insert');
      await wait(120);
    };

    const first = await said();
    check(first !== null && /Corner Shop/.test(first), 'on page load the reader is on and says the title: ' + first);

    // ── The arrows read instead of scrolling ──
    // The first line is AccessiFlow's own skip link, which blind.js adds.
    const y0 = await site.evaluate(() => window.scrollY);
    await key('ArrowDown');
    const line = await said();
    check(/Main, navigation landmark, About, link/.test(line),
      'down arrow reads the next line, saying it is in the menu: ' + line);
    await key('ArrowDown');
    check(/Blog, link/.test(await said()), 'and the one after: ' + await said());
    await key('ArrowDown'); await key('ArrowDown');
    check(await site.evaluate(() => window.scrollY) === y0, 'and the page does not scroll under it');

    // ── Quick navigation, and the highlight ──
    await site.keyboard.down('Control'); await site.keyboard.press('Home'); await site.keyboard.up('Control');
    await wait(120);
    await key('h');
    check(/heading level 1, Welcome/.test(await said()), 'H reads the heading: ' + await said());
    check(await site.evaluate(() => CSS.highlights.has('accessiflow-sr')),
      'the line being read is highlighted on the page with the CSS highlight API');
    await key('h');
    check(/heading level 2, The end/.test(await said()), 'H again reaches the heading far below');
    check(await site.evaluate(() => window.scrollY) > 1000, 'and the page scrolls to show it');
    await key('h', { shift: true });

    // ── Tab moves on from the reading cursor ──
    await key('b');
    check(/One, button/.test(await said()), 'B reaches the first button: ' + await said());
    await key('ArrowDown');
    check(/Some text between/.test(await said()), 'down reads the text after it');
    await key('Tab');
    const focused = await site.evaluate(() => document.activeElement && document.activeElement.id);
    check(focused === 'two', 'Tab moves to the next control after the text being read, not after the last focused one: ' + focused);
    check(/Two, button/.test(await said()), 'and says where it landed: ' + await said());
    check(await site.evaluate(() => !document.getElementById('mid').hasAttribute('tabindex')),
      'the text it started from is not left focusable');

    // ── Focus mode ──
    await key('e');
    check(/Your name, edit, blank/.test(await said()), 'E finds the text box by its label: ' + await said());
    await key('Enter');
    await site.keyboard.type('hb');
    check(await site.$eval('#name', n => n.value) === 'hb',
      'Enter puts the keyboard in the box, and letters type instead of jumping');
    await key('Escape');
    await key('h', { shift: true });
    check(/heading level 1, Welcome/.test(await said()), 'Escape gives the letters back to the reader: ' + await said());
    check(await site.$eval('#name', n => n.value) === 'hb', 'without typing into the box');

    await withInsert('t');
    check(/Title: Corner Shop/.test(await said()), 'Insert+T reads the title: ' + await said());

    // ── Part two ──
    const withInsertChord = async (mods, k) => {
      await site.keyboard.down('Insert');
      for (const m of mods) await site.keyboard.down(m);
      await site.keyboard.press(k);
      for (const m of mods.slice().reverse()) await site.keyboard.up(m);
      await site.keyboard.up('Insert');
      await wait(150);
    };

    // A status message, read though nothing moved.
    await key('b'); await key('b'); await key('b');
    check(/Add, button/.test(await said()), 'B reaches the Add button: ' + await said());
    await key('Enter');
    // Polite: it waits for "Add, button" to finish. Headless Chrome has no
    // audio, so that only ends when the engine's own time limit runs out.
    for (let i = 0; i < 40 && !/Added to cart/.test(await said()); i++) await wait(150);
    check(/Added to cart/.test(await said()), 'the status message it causes is read out: ' + await said());

    // Tables. The table is above the button, so Shift+T.
    await key('t', { shift: true });
    check(/table with 2 rows and 2 columns, Item/.test(await said()), 'T lands on the table: ' + await said());
    await withInsertChord([], 'ArrowUp');
    await site.keyboard.down('Control'); await site.keyboard.down('Alt');
    await site.keyboard.press('ArrowDown'); await wait(120);
    const row = await said();
    await site.keyboard.press('ArrowRight'); await wait(120);
    const cell = await said();
    await site.keyboard.up('Alt'); await site.keyboard.up('Control');
    check(/row 2, Tea/.test(row) && /Price, column 2, 3 taka/.test(cell),
      'Control+Alt+arrows move cell by cell with the headers: ' + row + ' / ' + cell);

    // In-page link.
    await key('k');
    let guard = 0;
    while (!/Jump to the end/.test(await said()) && guard++ < 6) await key('k');
    await key('Enter');
    await wait(300);
    check(/heading level 2, The end/.test(await said()), 'following an in-page link moves the reading cursor there: ' + await said());

    // The Elements List, with real keys into its shadow-root filter.
    await site.keyboard.down('Control'); await site.keyboard.press('Home'); await site.keyboard.up('Control');
    await wait(120);
    await withInsertChord([], 'F7');
    const listOpen = await site.evaluate(() => !!document.getElementById('accessiflow-sr-elements'));
    check(listOpen, 'Insert+F7 opens the elements list, rather than Chrome taking F7 for caret browsing');
    check(/^Browse mode.*Elements list\. Headings, 2 items/.test(await said()), 'it says what it lists: ' + await said());
    // Typing in the list goes to its filter.
    await site.keyboard.type('end');
    await wait(500);
    check(/1 item/.test(await said()), 'typing in the filter narrows the list: ' + await said());
    await site.keyboard.press('Enter');
    await wait(200);
    check(await site.evaluate(() => !document.getElementById('accessiflow-sr-elements')) &&
      /The end/.test(await said()), 'Enter goes to the heading chosen: ' + await said());

    // Find.
    await site.keyboard.down('Control'); await site.keyboard.press('Home'); await site.keyboard.up('Control');
    await wait(120);
    await withInsertChord(['Control'], 'f');
    check(await site.evaluate(() => !!document.getElementById('accessiflow-sr-find')),
      'Insert+Control+F opens find, not Chrome\'s find bar');
    await site.keyboard.type('bread');
    await site.keyboard.press('Enter');
    await wait(200);
    check(/We sell tea and bread\./.test(await said()), 'and finds the text: ' + await said());
    await withInsertChord([], 'F3');
    check(/Not found: bread/.test(await said()), 'Insert+F3 finds the next, or says there is none: ' + await said());

    // ── Off ──
    await site.keyboard.down('Alt'); await site.keyboard.down('Shift');
    await site.keyboard.press('z');
    await site.keyboard.up('Shift'); await site.keyboard.up('Alt');
    await wait(300);
    const stored = await sw.evaluate(() => chrome.storage.local.get('accessiflowScreenReader'));
    check(stored.accessiflowScreenReader === false, 'Alt+Shift+Z turns it off for every site');
    check(await said() === null, 'and its caption box goes');
    const y1 = await site.evaluate(() => window.scrollY);
    await key('PageDown');
    await key('ArrowDown');
    check(await site.evaluate(() => window.scrollY) > y1, 'the keys scroll the page again');

    check(pageErrors.length === 0, 'no errors on the page' + (pageErrors.length ? ': ' + pageErrors.join('; ') : ''));
  } catch (e) {
    failures.push('crashed: ' + e.stack);
  } finally {
    await browser.close();
    server.close();
  }

  console.log('=== ' + (failures.length ? 'FAIL' : 'PASS') + ' (' + passes.length + ') ===');
  passes.forEach(m => console.log('  + ' + m));
  failures.forEach(m => console.log('  - ' + m));
  process.exit(failures.length ? 1 : 0);
})();
