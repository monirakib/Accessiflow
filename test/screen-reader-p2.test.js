// The screen reader, part two, under jsdom: what the page announces by itself,
// single-page route changes and in-page links, tables cell by cell, the
// Elements List, Find, verbosity, punctuation and key help.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

const PAGE = `<!DOCTYPE html><html lang="en"><head><title>Market</title></head><body>
<a id="skip" href="#content">Skip to main content</a>
<nav aria-label="Site"><a href="/fruit">Fruit</a> <a href="/veg">Vegetables</a></nav>
<main id="content">
  <h1>Today's prices</h1>
  <p id="intro">Email us at shop@example.com, or call.</p>
  <table id="prices">
    <tr><th>Item</th><th>Price</th><th>Stock</th></tr>
    <tr><th>Tea</th><td>3 taka</td><td>Plenty</td></tr>
    <tr><th>Rice</th><td colspan="2">Sold out</td></tr>
    <tr><th>Salt</th><td>1 taka</td><td></td></tr>
  </table>
  <ul><li>First</li><li>Second</li><li>Third</li></ul>
  <h2>Order</h2>
  <form>
    <label for="qty">Quantity</label><input id="qty">
    <button id="add" type="button">Add to cart</button>
    <button id="pay" type="button">Pay</button>
  </form>
  <div id="cart" role="status"></div>
  <div id="log" aria-live="polite" aria-busy="false"></div>
  <p id="err" role="alert" hidden>Quantity must be a number</p>
  <div id="loud" aria-live="assertive"></div>
  <p id="banana">Bananas are yellow.</p>
</main>
<div aria-live="polite" id="accessiflow-announcer"></div>
</body></html>`;

const dom = new JSDOM(PAGE, { runScripts: 'outside-only', url: 'https://market.example/', pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;
window.console.log = () => {};
window.console.warn = () => {};
window.Element.prototype.scrollIntoView = function () {};
window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
window.scrollBy = () => {};

for (const f of ['modules/color.js', 'modules/overlay.js', 'modules/naming.js', 'modules/page-actions.js',
  'modules/keyboard-nav.js', 'modules/sr-buffer.js', 'modules/sr-speech.js', 'modules/sr-live.js',
  'modules/sr-table.js', 'modules/sr-dialogs.js', 'modules/screen-reader.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const el = id => doc.getElementById(id);
const tick = ms => new Promise(r => setTimeout(r, ms || 0));

function codeFor(key) {
  if (/^[a-z]$/i.test(key)) return 'Key' + key.toUpperCase();
  if (/^[0-9]$/.test(key)) return 'Digit' + key;
  return key;
}
function deepActive() {
  let a = doc.activeElement;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  return a;
}
function press(key, opts, target) {
  opts = opts || {};
  const e = new window.KeyboardEvent('keydown', Object.assign({
    key: opts.shiftKey && key.length === 1 ? key.toUpperCase() : key,
    code: codeFor(key), bubbles: true, cancelable: true, composed: true
  }, opts));
  (target || deepActive() || doc.body).dispatchEvent(e);
  return e;
}
function withInsert(key, opts) {
  press('Insert');
  const e = press(key, opts);
  doc.body.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Insert', code: 'Insert', bubbles: true }));
  return e;
}

// Speech that takes a moment, like a real voice, so queueing is visible.
const spoken = [];
const backend = {
  speak(text) { spoken.push(text); return new Promise(r => setTimeout(() => r(true), 5)); },
  stop() {}
};
const last = () => spoken[spoken.length - 1];
const Reader = window.AccessiFlowScreenReader;
const reader = new Reader();
reader.enable(backend, {});

(async () => {
  await tick(20);

  // ── Live regions ──────────────────────────────────────────────────────────
  {
    spoken.length = 0;
    el('cart').textContent = 'Added to cart. 2 items.';
    await tick(30);
    check(spoken.indexOf('Added to cart. 2 items.') > -1, 'a status message is read without the user moving: ' + spoken.join(' | '));

    spoken.length = 0;
    el('cart').textContent = 'Added to cart. 2 items.';
    await tick(30);
    check(spoken.length === 0, 'the same message set again at once is not read twice');

    spoken.length = 0;
    press('ArrowDown');
    const reading = last();
    el('log').appendChild(doc.createTextNode('New message from Rahim'));
    await tick(1);
    check(last() === reading, 'a polite message waits while a line is still being read');
    await tick(40);
    check(last() === 'New message from Rahim', 'and is read once the line finishes');

    spoken.length = 0;
    el('log').setAttribute('aria-busy', 'true');
    el('log').appendChild(doc.createTextNode(' part one'));
    await tick(20);
    check(!spoken.some(t => /part one/.test(t)), 'a region marked busy is not read while it is being filled');
    el('log').setAttribute('aria-busy', 'false');
    await tick(20);
    check(spoken.some(t => /part one/.test(t)), 'and is read when it says it is done: ' + last());

    spoken.length = 0;
    el('err').hidden = false;
    await tick(20);
    check(last() === 'Quantity must be a number', 'an alert shown on the page is read at once: ' + last());
    el('err').hidden = true;
    await tick(20);
    el('err').hidden = false;
    await tick(1100);
    check(spoken.filter(t => t === 'Quantity must be a number').length === 2, 'and again if it is hidden and shown again');

    spoken.length = 0;
    const toast = doc.createElement('div');
    toast.setAttribute('role', 'alert');
    toast.textContent = 'Session expires in one minute';
    doc.body.appendChild(toast);
    await tick(20);
    check(last() === 'Session expires in one minute', 'an alert added to the page is read: ' + last());

    spoken.length = 0;
    el('accessiflow-announcer').textContent = 'Landmark navigation opened';
    await tick(20);
    check(spoken.length === 0, 'AccessiFlow\'s own announcer is not read twice by its own reader');
  }

  // ── In-page links ─────────────────────────────────────────────────────────
  {
    press('Home', { ctrlKey: true });
    check(/Skip to main content/.test(last()), 'the first line is the skip link');
    window.location.hash = '#content';
    await tick(30);
    check(/main landmark, heading level 1, Today's prices/.test(last()),
      'following it moves the reading cursor to the main content and reads it: ' + last());
    check(reader._item().el === el('content').querySelector('h1'), 'the cursor really is there');
  }

  // ── Tables ────────────────────────────────────────────────────────────────
  {
    press('t');
    check(/^table with 4 rows and 3 columns, Item$/.test(last()), 'T lands on the table: ' + last());
    press('ArrowDown', { ctrlKey: true, altKey: true });
    check(last() === 'row 2, Tea', 'down a row in the header column: ' + last());
    press('ArrowRight', { ctrlKey: true, altKey: true });
    check(last() === 'Price, column 2, 3 taka', 'right a column says the column header first: ' + last());
    press('ArrowDown', { ctrlKey: true, altKey: true });
    check(last() === 'Rice, row 3, Sold out', 'down a row says the row header: ' + last());
    press('ArrowRight', { ctrlKey: true, altKey: true });
    check(/Edge of table/.test(last()), 'a cell spanning two columns is one cell: right of it is the edge: ' + last());
    press('ArrowDown', { ctrlKey: true, altKey: true });
    check(last() === 'Salt, row 4, 1 taka', 'down from a spanning cell lands in its first column: ' + last());
    press('ArrowRight', { ctrlKey: true, altKey: true });
    check(last() === 'Stock, column 3, blank', 'an empty cell is said to be blank: ' + last());
    press('ArrowUp', { ctrlKey: true, altKey: true });
    check(last() === 'Rice, row 3, Sold out', 'and moving on from it works, up into the span: ' + last());
    press('ArrowDown', { ctrlKey: true, altKey: true });
    press('ArrowDown', { ctrlKey: true, altKey: true });
    check(last() === 'Edge of table', 'below the last row is the edge');
    press('h');
    press('ArrowRight', { ctrlKey: true, altKey: true });
    check(last() === 'Not in a table', 'outside a table it says so');
  }

  // ── Verbosity and punctuation ─────────────────────────────────────────────
  {
    press('Home', { ctrlKey: true });
    press('l');
    check(/(^|, )list, 3 items, First$/.test(last()), 'normal verbosity names the list: ' + last());
    press('ArrowDown');
    check(last() === 'Second', 'and not each item: ' + last());

    reader.configure({ verbosity: 'high' });
    press('l', { shiftKey: true });
    press('ArrowDown');
    check(last() === 'item 2 of 3, Second', 'high verbosity gives each item its position: ' + last());

    reader.configure({ verbosity: 'low' });
    press('ArrowDown');
    press('ArrowDown');
    check(/^heading level 2, Order$/.test(last()), 'low verbosity leaves out "out of list": ' + last());
    press('l', { shiftKey: true });
    check(/^list, 3 items/.test(last()), 'but still names what the user jumped to');
    reader.configure({ verbosity: 'normal' });

    press('h', { shiftKey: true });
    press('ArrowDown');
    check(last() === 'Email us at shop@example.com, or call.', 'some punctuation leaves text as it is: ' + last());
    reader.configure({ punctuation: 'all' });
    withInsert('ArrowUp');
    check(/shop at example dot com comma or call dot/.test(last()), 'all punctuation names every symbol: ' + last());
    reader.configure({ punctuation: 'none' });
    withInsert('ArrowUp');
    check(last() === 'Email us at shop example.com, or call.', 'none drops the symbols a voice would read as words: ' + last());
    reader.configure({ punctuation: 'some' });
  }

  // ── The Elements List ─────────────────────────────────────────────────────
  {
    const host = () => doc.getElementById('accessiflow-sr-elements');
    const shadow = () => host().shadowRoot;
    const e = withInsert('F7');
    check(e.defaultPrevented && !!host(), 'Insert+F7 opens the elements list');
    check(/^Elements list\. Headings, 2 items\. Today's prices, heading level 1, 1 of 2$/.test(last()),
      'it says what it lists and the first entry: ' + last());
    check(shadow().activeElement && shadow().activeElement.getAttribute('role') === 'listbox', 'the keyboard is in the list');

    press('ArrowDown');
    check(last() === 'Order, heading level 2, 2 of 2', 'down moves through the list: ' + last());

    const links = shadow().querySelector('input[value="link"]');
    links.focus();
    links.checked = true;
    links.dispatchEvent(new window.Event('change'));
    check(/^Links, \d+ items$/.test(last()), 'choosing Links lists the links: ' + last());
    const count = shadow().querySelectorAll('li[role="option"]').length;
    check(count === 3, 'the skip link and both menu links: ' + count);

    const filter = shadow().querySelector('input[type="text"]');
    filter.focus();
    filter.value = 'veg';
    filter.dispatchEvent(new window.Event('input'));
    await tick(400);
    check(last() === '1 item', 'typing in the filter narrows it, and says how many are left: ' + last());

    const pageKeys = [];
    doc.addEventListener('keydown', ev => pageKeys.push(ev.key));
    press('s', {}, filter);
    check(pageKeys.length === 0, 'keys typed in the list never reach the page\'s own shortcuts');

    press('Enter', {}, filter);
    check(!host(), 'Enter closes the list');
    check(last() === 'Site, navigation landmark, Vegetables, link', 'and moves to the chosen link, reading it: ' + last());
    check(reader._item().link.el.textContent === 'Vegetables', 'the cursor is on it');

    withInsert('F7');
    press('Escape');
    check(!host(), 'Escape closes the list');
    check(/Vegetables, link/.test(last()), 'without moving, and says where the user still is: ' + last());

    withInsert('F7');
    const buttons = shadow().querySelector('input[value="button"]');
    buttons.checked = true;
    buttons.dispatchEvent(new window.Event('change'));
    const list = shadow().querySelector('[role="listbox"]');
    list.focus();
    press('ArrowDown', {}, list);
    check(last() === 'Pay, button, 2 of 2', 'buttons are listed: ' + last());
    let paid = 0;
    el('pay').addEventListener('click', () => paid++);
    press('Enter', { shiftKey: true }, list);
    check(paid === 1 && !host(), 'Shift+Enter presses the chosen button');
  }

  // ── Find ──────────────────────────────────────────────────────────────────
  {
    press('Home', { ctrlKey: true });
    withInsert('f', { ctrlKey: true });
    const box = doc.getElementById('accessiflow-sr-find');
    check(!!box, 'Insert+Control+F opens find');
    check(/^Find, edit, blank/.test(last()), 'and says what to do: ' + last());
    const input = box.shadowRoot.querySelector('input');
    input.value = 'bananas';
    press('Enter', {}, input);
    check(!doc.getElementById('accessiflow-sr-find'), 'Enter searches and closes it');
    check(/(^|, )Bananas are yellow\.$/.test(last()), 'the cursor lands on the match, found ignoring case: ' + last());
    check(reader._cursor.offset === 0, 'at the start of the word found');
    withInsert('F3');
    check(last() === 'Not found: bananas', 'Insert+F3 finds the next one, or says there is none: ' + last());
    press('Home', { ctrlKey: true });
    withInsert('F3');
    check(/Bananas are yellow\.$/.test(last()), 'searching again from the top finds it again');
    withInsert('F3', { shiftKey: true });
    check(last() === 'Not found: bananas', 'Insert+Shift+F3 looks backwards');
  }

  // ── Key help ──────────────────────────────────────────────────────────────
  {
    const before = reader._cursor.index;
    withInsert('1');
    check(/^Key help on/.test(last()), 'Insert+1 turns key help on');
    press('h');
    check(last() === 'H, next heading', 'H is described: ' + last());
    press('k', { shiftKey: true });
    check(last() === 'K with Shift, previous link', 'with Shift too: ' + last());
    press('ArrowDown', { ctrlKey: true, altKey: true });
    check(/in a table, moves to the next row/.test(last()), 'table keys are described: ' + last());
    withInsert('F7');
    check(last() === 'Insert F7, Opens the elements list', 'reader keys are described: ' + last());
    check(!doc.getElementById('accessiflow-sr-elements'), 'without doing anything');
    const z = press('z');
    check(z.defaultPrevented && last() === 'Z, no command', 'keys with no command say so, and do not reach the page');
    check(reader._cursor.index === before, 'the cursor never moved');
    withInsert('1');
    check(last() === 'Key help off', 'Insert+1 again leaves key help');
    press('h', { shiftKey: true });
    check(/heading level/.test(last()), 'and the keys work again');
  }

  // ── Single-page route changes ─────────────────────────────────────────────
  {
    window.history.pushState({}, '', '/fruit');
    doc.title = 'Fruit - Market';
    el('content').innerHTML = '<h1>Fruit</h1><p>Mangoes are in season.</p>';
    await tick(700);
    check(/^Fruit - Market\. 1 headings, \d+ links\. main landmark, heading level 1, Fruit$/.test(last()),
      'a route change says the new title and reads from the start of the new content: ' + last());
    press('ArrowDown');
    check(last() === 'Mangoes are in season.', 'and reading carries on in the new page');

    // An app that moves focus itself is left to do so.
    spoken.length = 0;
    window.history.pushState({}, '', '/veg');
    doc.title = 'Vegetables - Market';
    el('content').innerHTML = '<h1 tabindex="-1" id="vh">Vegetables</h1><p>Onions.</p>';
    el('vh').focus();
    await tick(700);
    check(spoken[0] === 'heading level 1, Vegetables' && last() === 'Vegetables - Market',
      'when the app moves focus itself, that is read and the title follows: ' + spoken.join(' | '));
  }

  reader.disable();
  check(!doc.getElementById('accessiflow-sr-elements') && !doc.getElementById('accessiflow-sr-find'),
    'switching off leaves no dialog behind');

  console.log('=== ' + (errors.length ? 'FAIL' : 'PASS') + ' (' + ok.length + ') ===');
  ok.forEach(m => console.log('  + ' + m));
  errors.forEach(m => console.log('  - ' + m));
  console.log(errors.length ? '\n' + errors.length + ' check(s) failed.' : '\nAll checks passed.');
  process.exit(errors.length ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
