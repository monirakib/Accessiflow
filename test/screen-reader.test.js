// The built-in screen reader, under jsdom.
//
// What a blind user hears is the whole interface, so most checks here are on
// the exact words: a line read in the wrong order, a heading level missing, a
// hidden paragraph read aloud, are each as bad as a button that does not work.
// The other half is the keys: in browse mode the reader owns them, in focus
// mode it must give every one back.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

const LONG = 'This sentence is here to make a long paragraph. '.repeat(12).trim();

const PAGE = `<!DOCTYPE html><html lang="en"><head><title>Corner Shop</title></head><body>
<header><a id="home" href="/">Home</a>
  <nav aria-label="Main"><ul><li><a href="/a">About</a></li><li><a href="/b">Blog</a></li></ul></nav>
</header>
<main>
  <h1>Welcome to the shop</h1>
  <p id="para">First paragraph with <strong>bold</strong> words. Second sentence here.</p>
  <h2><a id="news" href="/news">Latest news</a></h2>
  <p hidden>Secret one</p>
  <p style="display:none">Secret two</p>
  <p aria-hidden="true">Secret three</p>
  <img id="bike" src="bike.png" alt="A red bicycle">
  <img src="line.png" alt="">
  <form>
    <label for="q">Search</label><input id="q" type="text">
    <input id="agree" type="checkbox" aria-label="I agree">
    <button id="go" type="button">Go</button>
  </form>
  <table><tr><th>Name</th><th>Price</th></tr><tr><td>Tea</td><td>3</td></tr></table>
  <blockquote>Quoted words</blockquote>
  <div id="fake" role="button" tabindex="0" aria-expanded="false">Fake menu</div>
  <details><summary>More</summary><p>Hidden detail</p></details>
  <p id="long">${LONG}</p>
  <span id="host"></span>
  <p id="last">The last line</p>
</main>
<footer>Footer text</footer>
</body></html>`;

const dom = new JSDOM(PAGE, { runScripts: 'outside-only', url: 'https://example.com/', pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;
window.console.log = () => {};
window.console.warn = () => {};
window.Element.prototype.scrollIntoView = function () {};
window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
window.scrollBy = () => {};

// A shadow root, which a real site's web components put buttons inside.
doc.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<button id="inner">Shadow button</button>';

for (const f of ['modules/color.js', 'modules/overlay.js', 'modules/naming.js', 'modules/page-actions.js',
  'modules/keyboard-nav.js', 'modules/motor.js', 'modules/sr-buffer.js', 'modules/sr-speech.js',
  'modules/screen-reader.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const el = id => doc.getElementById(id);
const tick = (ms) => new Promise(r => setTimeout(r, ms || 0));

function codeFor(key) {
  if (/^[a-z]$/i.test(key)) return 'Key' + key.toUpperCase();
  if (/^[0-9]$/.test(key)) return 'Digit' + key;
  return key;
}
function press(key, opts, target) {
  opts = opts || {};
  const e = new window.KeyboardEvent('keydown', Object.assign({
    key: opts.shiftKey && key.length === 1 ? key.toUpperCase() : key,
    code: codeFor(key), bubbles: true, cancelable: true, composed: true
  }, opts));
  (target || doc.activeElement || doc.body).dispatchEvent(e);
  return e;
}
function release(key, target) {
  const e = new window.KeyboardEvent('keyup', { key: key, code: key, bubbles: true, cancelable: true });
  (target || doc.activeElement || doc.body).dispatchEvent(e);
}
function withInsert(key, opts) {
  press('Insert');
  const e = press(key, opts);
  release('Insert');
  return e;
}

// ── The buffer ──────────────────────────────────────────────────────────────
const Buf = window.AccessiFlowSRBuffer;
const buf = Buf.build(doc);
const texts = buf.items.map(it => it.text);
{
  check(!texts.some(t => /Secret/.test(t)), 'hidden, display:none and aria-hidden text is never in the buffer');
  check(texts.indexOf('First paragraph with bold words. Second sentence here.') > -1,
    'inline markup inside a paragraph stays one line: ' + texts.find(t => /First/.test(t)));
  const bike = buf.items.find(it => it.el === el('bike'));
  check(bike && bike.role === 'graphic' && bike.text === 'A red bicycle', 'a picture with alt text is a graphic line');
  check(!buf.items.some(it => it.el && it.el.getAttribute && it.el.getAttribute('src') === 'line.png'),
    'a picture marked alt="" is left out');
  const news = buf.items.find(it => it.text === 'Latest news');
  check(news && news.heading && news.heading.level === 2 && news.link && news.link.el === el('news'),
    'a link inside a heading carries both, so H and K both land on it');
  check(texts.indexOf('More') > -1 && texts.indexOf('Hidden detail') === -1,
    'a closed <details> shows only its summary');
  check(buf.items.some(it => it.text === 'Shadow button' && it.role === 'button'),
    'a button inside a shadow root is read');
  const longLines = buf.items.filter(it => it.el === el('long'));
  check(longLines.length > 1 && longLines.every(it => it.text.length <= Buf.MAX_LINE),
    'a long paragraph is cut into lines no longer than ' + Buf.MAX_LINE + ': ' + longLines.length + ' lines');
  check(longLines.every(it => /\.$/.test(it.text)), 'and cut at sentence ends');
  check(buf.count('landmark') === 4, 'banner, navigation, main and footer are landmarks: ' + buf.count('landmark'));
  check(buf.count('heading') === 2 && buf.count('heading2') === 1, 'both headings are found, one of them level 2');
  check(buf.count('list') === 1 && buf.count('listitem') === 2, 'one list with two items');
  check(buf.count('table') === 1 && buf.count('blockquote') === 1, 'the table and the quote are found');
  check(buf.count('field') === 5,
    'form fields are the box, the check box and the three buttons, one in a shadow root: ' + buf.count('field'));
  check(buf.lineOf(el('go')) === buf.items.findIndex(it => it.el === el('go')), 'an element finds its own line');
  check(buf.lineOf(el('agree').parentElement) > -1, 'and a container finds the first line inside it');
  check(buf.items[buf.lineOf(el('q'))].el === el('q'),
    'a text box after its label finds its own line, not the label line, so focus lands on the right line');
  const para = buf.items.find(it => it.el === el('para'));
  check(para.range && para.range.startNode.data.indexOf('First') === 0, 'a text line knows where it starts on the page');
}

// ── Switching on ────────────────────────────────────────────────────────────
const spoken = [];
let stops = 0;
const backend = {
  speak(text) { spoken.push(text); return new Promise(r => setTimeout(() => r(true), 1)); },
  stop() { stops++; }
};
const last = () => spoken[spoken.length - 1];
const Reader = window.AccessiFlowScreenReader;

// Keyboard-only mode is on too: the reader must win the single letters.
const motor = new window.MotorModule();
motor.apply({ keyboardOnly: true });

const reader = new Reader();
reader.enable(backend, { intro: true });

(async () => {
  check(/^Screen reader on\. Corner Shop\. 2 headings, \d+ links\./.test(spoken[0]),
    'switching on says so, then the title and the headings and links: ' + spoken[0]);
  check(Reader.ownsKeys(), 'while on, it owns the single keys');
  check(reader.mode === 'browse', 'and starts in browse mode');

  // ── Reading line by line ──────────────────────────────────────────────────
  {
    const e = press('ArrowDown');
    check(e.defaultPrevented, 'the down arrow is kept from the page, which would scroll');
    check(/navigation landmark/.test(last()) && /list, 2 items/.test(last()) && /About, link$/.test(last()),
      'moving into the menu says the landmark and the list: ' + last());
    press('ArrowUp');
    check(last() === 'out of list, Home, link', 'up goes back to the first line, out of the list: ' + last());
    press('ArrowUp');
    check(last() === 'Top', 'and above the first line it says so');
  }

  // ── Quick navigation ──────────────────────────────────────────────────────
  {
    press('h');
    check(last() === 'main landmark, heading level 1, Welcome to the shop',
      'H goes to the first heading, saying it is in the main landmark: ' + last());
    press('h');
    check(last() === 'heading level 2, Latest news, link', 'and again to the next, a link in a heading: ' + last());
    press('h');
    check(last() === 'No next heading', 'past the last heading it says there are no more');
    press('h', { shiftKey: true });
    check(last() === 'heading level 1, Welcome to the shop', 'Shift+H goes back: ' + last());
    press('2');
    check(/heading level 2, Latest news/.test(last()), '2 goes to the next level-2 heading');
    press('g');
    check(last() === 'A red bicycle, graphic', 'G finds the picture: ' + last());
    press('f');
    check(last() === 'Search, edit, blank', 'F finds the search box, with its label: ' + last());
    press('x');
    check(last() === 'I agree, check box, not checked', 'X finds the check box: ' + last());
    press('t');
    check(/^table with 2 rows and 2 columns/.test(last()), 'T announces the table size: ' + last());
    press('q');
    check(/^block quote, Quoted words/.test(last()), 'Q finds the quote');
    press('d', { shiftKey: true });
    check(last() === 'main landmark, heading level 1, Welcome to the shop',
      'Shift+D names the landmark it lands on, though the cursor was already inside it: ' + last());
    press('k');
    check(/Latest news, link/.test(last()), 'K finds the next link');
  }

  // ── Keys that are not the reader's ────────────────────────────────────────
  {
    const z = press('z');
    check(z.defaultPrevented, 'a letter with no command is still kept from the page, so its shortcuts cannot fire');
    const copy = press('c', { ctrlKey: true });
    check(!copy.defaultPrevented, 'but Control+C still reaches the browser');
    const alt = press('r', { altKey: true, shiftKey: true });
    check(!alt.defaultPrevented, 'and AccessiFlow\'s own Alt+Shift shortcuts pass through');
    const legend = doc.getElementById('accessiflow-kbnav-legend');
    const before = legend.shadowRoot.querySelector('.panel').hidden;
    press('h');
    check(legend.shadowRoot.querySelector('.panel').hidden === before,
      'keyboard-only mode stands aside: H means heading, not its key guide');
  }

  // ── Letters and words ─────────────────────────────────────────────────────
  {
    press('h', { shiftKey: true }); press('h', { shiftKey: true });   // back to the top heading
    press('ArrowDown');
    check(/^First paragraph/.test(last()), 'the line after the heading is the paragraph');
    press('ArrowRight');
    check(last() === 'i', 'right arrow reads the next letter: ' + last());
    press('ArrowLeft');
    check(last() === 'cap F', 'left arrow reads the one before, saying it is a capital: ' + last());
    press('ArrowRight', { ctrlKey: true });
    check(last() === 'paragraph', 'Control+right reads the next word: ' + last());
    press('End');
    check(last() === 'dot', 'End reads the last character by name: ' + last());
  }

  // ── Pressing things ───────────────────────────────────────────────────────
  {
    press('x');
    press('Enter');
    check(el('agree').checked, 'Enter on the check box ticks it');
    await tick(80);
    check(last() === 'I agree, check box, checked', 'and the new state is said: ' + last());

    press('b', { shiftKey: true });
    const back = last();
    press('b');
    press('b');
    check(/Fake menu, button, collapsed/.test(last()), 'B finds a button made of a div: ' + last() + ' (after ' + back + ')');
    let clicked = 0;
    el('fake').addEventListener('click', () => { clicked++; el('fake').setAttribute('aria-expanded', 'true'); });
    const e = press(' ');
    check(e.defaultPrevented && clicked === 1, 'Space presses it, once');
    await tick(80);
    check(/expanded/.test(last()), 'and says it opened: ' + last());
  }

  // ── Focus mode ────────────────────────────────────────────────────────────
  {
    press('e', { shiftKey: true });
    check(last() === 'Search, edit, blank', 'Shift+E goes back to the search box');
    press('Enter');
    check(doc.activeElement === el('q'), 'Enter on a text box puts the keyboard in it');
    check(reader.mode === 'focus', 'and switches to focus mode');
    const typed = press('h', {}, el('q'));
    check(!typed.defaultPrevented, 'in focus mode a letter is typed, not a command');
    const arrow = press('ArrowDown', {}, el('q'));
    check(!arrow.defaultPrevented, 'and the arrows belong to the page');
    press('Escape', {}, el('q'));
    check(reader.mode === 'browse', 'Escape goes back to browse mode');
    withInsert(' ');
    check(reader.mode === 'focus' && last() === 'Focus mode', 'Insert+Space switches to focus mode by hand');
    withInsert(' ');
    check(reader.mode === 'browse' && last() === 'Browse mode', 'and back');
  }

  // ── Following focus ───────────────────────────────────────────────────────
  {
    el('go').focus();
    check(last() === 'Go, button', 'focus moved by Tab or the page is announced: ' + last());
    check(reader._item().el === el('go'), 'and the reading cursor moves with it');
    el('q').focus();
    check(reader.mode === 'focus', 'focus landing in a text box switches to focus mode by itself');
    el('go').focus();
    check(reader.mode === 'browse', 'and landing on a button switches back');
  }

  // ── Tab starts from the reading cursor ────────────────────────────────────
  {
    press('h', { shiftKey: true }); press('h', { shiftKey: true });
    press('ArrowDown');
    const count = spoken.length;
    const tab = press('Tab');
    check(!tab.defaultPrevented, 'Tab is left to the browser');
    check(doc.activeElement === el('para'), 'but focus is first put where the reader is, so Tab moves on from there');
    check(spoken.length === count, 'silently');
    el('go').focus();
    check(!el('para').hasAttribute('tabindex'), 'and the paragraph is not left focusable afterwards');
  }

  // ── Reading everything ────────────────────────────────────────────────────
  {
    press('Home', { ctrlKey: true });
    const from = spoken.length;
    withInsert('ArrowDown');
    await tick(40);
    const read = spoken.slice(from);
    check(read.length >= 4, 'Insert+Down reads on line after line by itself: ' + read.length + ' lines');
    check(read[0] === 'banner landmark, Home, link', 'starting from the cursor: ' + read[0]);
    press('Control');
    const stopped = spoken.length;
    await tick(40);
    check(spoken.length === stopped, 'Control stops it');
    check(reader._cursor.index > 0, 'and the cursor stays where the reading got to');
  }

  // ── Pages that change ─────────────────────────────────────────────────────
  {
    press('Home', { ctrlKey: true });
    const h = doc.createElement('h2');
    h.textContent = 'Arrived later';
    el('last').before(h);
    await tick(450);
    press('h'); press('h'); press('h');
    check(last() === 'heading level 2, Arrived later', 'a heading added after load is found: ' + last());
    check(!reader._dirty, 'the buffer was rebuilt by itself once the page settled');
  }

  // ── Our own keys ──────────────────────────────────────────────────────────
  {
    withInsert('t');
    check(last() === 'Title: Corner Shop', 'Insert+T reads the title');
    withInsert('h');
    check(/^Screen reader keys\./.test(last()), 'Insert+H reads the list of keys');
    withInsert('F2');
    const passed = press('z');
    check(!passed.defaultPrevented, 'Insert+F2 lets the next key through to the page');
    check(press('z').defaultPrevented, 'only the next one');
  }

  // ── The speech viewer ─────────────────────────────────────────────────────
  {
    reader.configure({ viewer: true });
    withInsert('ArrowUp');
    const viewer = doc.getElementById('accessiflow-sr-viewer');
    check(viewer && viewer.getAttribute('aria-hidden') === 'true', 'the speech viewer is on screen, hidden from other screen readers');
    check(viewer && viewer.shadowRoot.textContent.indexOf(last()) > -1, 'and shows what was said: ' + last());
    reader.configure({ viewer: false });
    check(!doc.getElementById('accessiflow-sr-viewer'), 'and goes when switched off');
  }

  // ── Switching off ─────────────────────────────────────────────────────────
  {
    reader.disable();
    check(!Reader.ownsKeys(), 'switched off, it owns no keys');
    const e = press('ArrowDown', {}, doc.body);
    check(!e.defaultPrevented, 'the arrows are the page\'s again');
    check(!doc.getElementById('accessiflow-sr-style') && !doc.querySelector('.accessiflow-sr-cursor'),
      'and nothing of it is left on the page');
  }

  // ── Speech ────────────────────────────────────────────────────────────────
  {
    const S = window.AccessiFlowSRSpeech;
    const said = [];
    const resolvers = [];
    const s = new S({ speak(t) { said.push(t); return new Promise(r => resolvers.push(r)); }, stop() {} });
    const first = s.say('one');
    s.say('two');
    resolvers[0](true);
    check(await first === false, 'a line cut off by the next reports that it was not finished');
    s.queue('three');
    check(said.length === 2, 'a queued line waits for the current one');
    resolvers[1](true);
    await tick(0);
    check(said[2] === 'three', 'and then is said');
    check(S.characterName('.') === 'dot' && S.characterName('A') === 'cap A' && S.characterName(' ') === 'space',
      'single characters are named, not left silent');
  }

  motor.destroy && motor.destroy();

  console.log('=== ' + (errors.length ? 'FAIL' : 'PASS') + ' (' + ok.length + ') ===');
  ok.forEach(m => console.log('  + ' + m));
  errors.forEach(m => console.log('  - ' + m));
  console.log(errors.length ? '\n' + errors.length + ' check(s) failed.' : '\nAll checks passed.');
  process.exit(errors.length ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
