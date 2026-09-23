// NVDA's keys, everywhere AccessiFlow is.
//
// A blind tester found that with the screen reader on, AccessiFlow's own
// panel and setup page could only be moved through with Tab: the arrow keys,
// H and B did nothing there, because the reader only ran on websites. These
// checks cover both halves of the fix:
//
//   1. the browse mode keys from NVDA's browseMode.py that the reader lacked
//      (S M O N P, 7 to 9, comma, Page Down, Insert+Shift+Space, the laptop
//      Insert+A and Insert+L), on an ordinary page;
//   2. the same reader running in popup.html and welcome.html, where the
//      pages' own keys (the setup page's number keys) still come first.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }
const wait = ms => new Promise(r => setTimeout(r, ms || 0));

function codeFor(key) {
  if (/^[a-z]$/i.test(key)) return 'Key' + key.toUpperCase();
  if (/^[0-9]$/.test(key)) return 'Digit' + key;
  if (key === ',') return 'Comma';
  if (key === ' ') return 'Space';
  return key;
}

/** Key presses on one window, as a person makes them. */
function keyboard(window) {
  const doc = window.document;
  const target = t => t || doc.activeElement || doc.body;
  function press(key, opts, on) {
    opts = opts || {};
    const e = new window.KeyboardEvent('keydown', Object.assign({
      key: opts.shiftKey && key.length === 1 ? (key === ',' ? '<' : key.toUpperCase()) : key,
      code: codeFor(key), bubbles: true, cancelable: true, composed: true
    }, opts));
    target(on).dispatchEvent(e);
    return e;
  }
  function release(key, on) {
    target(on).dispatchEvent(new window.KeyboardEvent('keyup', { key: key, code: key, bubbles: true, cancelable: true }));
  }
  function withInsert(key, opts) {
    press('Insert');
    const e = press(key, opts);
    release('Insert');
    return e;
  }
  return { press, release, withInsert };
}

// ════ 1. The new browse mode keys, on a website ═══════════════════════════════

const LINES = Array.from({ length: 30 }, (_, i) => '<p>Filler line ' + (i + 1) + '.</p>').join('');

const PAGE = `<!DOCTYPE html><html lang="en"><head><title>Daily News</title></head><body>
<nav aria-label="Top"><a href="/1">One</a> | <a href="/2">Two</a> | <a href="/3">Three</a></nav>
<p id="intro">This is the opening paragraph of the story, long enough to count.</p>
<a id="more" href="/more">Read more</a>
<ul id="fruit"><li>Apple</li><li>Pear</li><li>Plum</li></ul>
<p id="after">After the list.</p>
<hr id="rule">
<h1>Top story</h1>
<div role="heading" aria-level="7" id="deep">Deep heading</div>
<p id="menuish">Home</p>
<video id="clip" aria-label="Weather clip" controls></video>
<iframe id="map" title="Map"></iframe>
<p id="prose">Rain is expected. Bring a coat.</p>
<button id="save" type="button" aria-describedby="saveHelp">Save</button>
<p id="saveHelp">Keeps your changes for next time.</p>
<input id="wifi" type="checkbox" role="switch" aria-label="Wi-Fi" checked>
<div id="filler">${LINES}</div>
<p id="last">The very end.</p>
</body></html>`;

const dom = new JSDOM(PAGE, { runScripts: 'outside-only', url: 'https://news.example/', pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;
window.console.log = () => {};
window.Element.prototype.scrollIntoView = function () {};
window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });

// A frame from the same site, with something in it to read.
doc.getElementById('map').contentDocument.body.innerHTML = '<p>Inside the map frame.</p>';

for (const f of ['modules/naming.js', 'modules/page-actions.js', 'modules/sr-buffer.js', 'modules/sr-speech.js',
  'modules/sr-table.js', 'modules/sr-dialogs.js', 'modules/screen-reader.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const el = id => doc.getElementById(id);
const { press, withInsert } = keyboard(window);
const spoken = [];
const backend = {
  speak(text) { spoken.push(text); return new Promise(r => setTimeout(() => r(true), 1)); },
  stop() {}
};
const last = () => spoken[spoken.length - 1] || '';
const reader = new window.AccessiFlowScreenReader();

(async () => {
  reader.enable(backend, {});
  const buf = reader._buffer();
  const lineOf = id => buf.lineOf(el(id));
  const at = () => reader._cursor.index;
  const home = () => { press('Home', { ctrlKey: true }); };

  // ── N: past a block of links ──────────────────────────────────────────────
  home();
  press('n');
  check(at() === lineOf('intro') && /opening paragraph/.test(last()),
    'N skips the menu of links to the text after it, as NVDA does: ' + last());
  press('n');
  check(/No next text after a block of links/.test(last()),
    'and says so when there is no more: ' + last());
  press('k'); press('k');
  press('n', { shiftKey: true });
  check(at() === lineOf('intro'), 'Shift+N goes back to it');

  // ── P: a paragraph of prose ───────────────────────────────────────────────
  home();
  press('p');
  check(at() === lineOf('intro'), 'P lands on the first paragraph of prose: ' + last());
  press('p');
  check(at() === lineOf('after'), 'then the next one');
  press('p');
  check(at() === lineOf('prose') || at() === buf.lineOf(el('map').contentDocument.body.firstChild),
    'skipping the heading and a one-word menu item: ' + last());

  // ── S, M, O and heading level 7 ───────────────────────────────────────────
  home();
  press('s');
  check(at() === lineOf('rule') && /separator/.test(last()), 'S finds the separator: ' + last());
  press('7');
  check(at() === lineOf('deep') && /^heading level 7, Deep heading/.test(last()),
    '7 finds a level 7 heading, as NVDA goes to 9: ' + last());
  home();
  press('o');
  check(at() === lineOf('clip'), 'O finds the video, an embedded object: ' + last());
  press('o');
  check(buf.items[at()].containers.some(c => c.kind === 'frame'), 'and then the frame');
  home();
  press('m');
  check(buf.items[at()].containers.some(c => c.kind === 'frame') && /frame, Map/.test(last()),
    'M finds the frame and names it: ' + last());

  // ── Comma and Shift+comma: out of the list ────────────────────────────────
  home();
  press('i'); press('i');
  check(/Pear/.test(last()), 'I moves to the second list item');
  press(',', { shiftKey: true });
  check(at() === buf.lineOf(el('fruit')) && /list, 3 items/.test(last()),
    'Shift+comma goes back to the start of the list, saying which: ' + last());
  press(',');
  check(at() === lineOf('after') && /out of list/.test(last()) && /After the list/.test(last()),
    'comma moves past its end: ' + last());
  const commaAgain = press(',');
  check(/Not in a container/.test(last()) && commaAgain.defaultPrevented,
    'and outside any list or table, says it is not in one');

  // ── Page Down and Page Up ─────────────────────────────────────────────────
  home();
  press('PageDown');
  check(at() === 25, 'Page Down moves 25 lines, NVDA\'s lines per page: line ' + at());
  press('PageUp');
  check(at() === 0, 'Page Up moves back');
  press('PageUp');
  check(/Top/.test(last()), 'and at the top says so');
  const tabSwitch = press('PageDown', { ctrlKey: true });
  check(!tabSwitch.defaultPrevented && at() === 0, 'Control+Page Down is left to Chrome, which changes tab');

  // ── U and V ───────────────────────────────────────────────────────────────
  press('u');
  check(/Visited links cannot be told apart/.test(last()),
    'U says honestly that a page cannot tell visited links apart: ' + last());

  // ── Insert+Shift+Space: single letter navigation off ──────────────────────
  home();
  withInsert(' ', { shiftKey: true });
  check(/Single letter navigation off/.test(last()), 'Insert+Shift+Space turns single letter navigation off');
  const h = press('h');
  check(!h.defaultPrevented && at() === 0, 'then H goes to the site, for its own shortcuts');
  const down = press('ArrowDown');
  check(down.defaultPrevented && at() === 1, 'while the arrows still read');
  withInsert(' ', { shiftKey: true });
  press('h');
  check(/Single letter navigation on/.test(spoken[spoken.length - 2] || '') && /Top story/.test(last()),
    'and pressed again, H jumps to headings again');

  // ── Insert+A and Insert+L, the laptop layout ──────────────────────────────
  home();
  press('ArrowDown');
  spoken.length = 0;
  const lineNow = reader._lineText(reader._item());
  withInsert('l');
  check(spoken.length === 1 && last() === lineNow,
    'Insert+L says the current line again, as NVDA+L does on a laptop: ' + last());
  spoken.length = 0;
  withInsert('a');
  await wait(20);
  check(spoken.length > 2, 'Insert+A reads on from here, as NVDA+A does: ' + spoken.length + ' lines so far');
  press('Control');
  const heardSoFar = spoken.length;
  await wait(20);
  check(spoken.length === heardSoFar, 'and Control stops it');

  // ── Key help knows the new keys ───────────────────────────────────────────
  withInsert('1');
  press('n');
  check(/^N, next text after a block of links/.test(last()), 'key help describes N: ' + last());
  press(',');
  check(/^Comma, moves past the end of the list, table or landmark/.test(last()), 'and comma: ' + last());
  press('PageDown');
  check(/Moves 25 lines on/.test(last()), 'and Page Down: ' + last());
  withInsert('1');

  // ── What focus landing says: state words and descriptions ─────────────────
  el('save').focus();
  check(/^Save, button\. Keeps your changes for next time\.$/.test(last()),
    'focus on a control says its description after its name, as NVDA does: ' + last());
  el('wifi').focus();
  check(/^Wi-Fi, switch, on/.test(last()), 'a switch is on or off, not checked: ' + last());

  // ── Names leave out what is hidden from speech ────────────────────────────
  const N = window.AccessiFlowNaming;
  const probe = doc.createElement('div');
  probe.innerHTML = '<button id="minus"><span aria-hidden="true">−</span><span>Smaller</span></button>' +
    '<label id="wrap"><input id="pick" type="checkbox"><span aria-hidden="true">3</span>Bangla</label>' +
    '<label for="size">Size <select id="size"><option>Small</option><option>Large</option></select></label>' +
    '<button id="tip">Share<span hidden>Opens a menu</span></button>' +
    '<button id="lines"><div>Two</div><div>lines</div></button>';
  doc.body.appendChild(probe);
  check(N.accessibleName(el('minus')) === 'Smaller', 'an aria-hidden icon is not part of a button name: ' + N.accessibleName(el('minus')));
  check(N.accessibleName(el('pick')) === 'Bangla', 'nor a hidden number of a label: ' + N.accessibleName(el('pick')));
  check(N.accessibleName(el('size')) === 'Size', 'a list box inside its label is not named by its options: ' + N.accessibleName(el('size')));
  check(N.accessibleName(el('tip')) === 'Share', 'hidden text is left out: ' + N.accessibleName(el('tip')));
  check(N.accessibleName(el('lines')) === 'Two lines', 'and blocks are separate words: ' + N.accessibleName(el('lines')));
  probe.remove();

  reader.disable();

  // ════ 2. The reader in AccessiFlow's own pages ══════════════════════════════

  await popupChecks();
  await setupChecks();

  console.log('\n=== PASS (' + ok.length + ') ===');
  ok.forEach(m => console.log('  + ' + m));
  if (errors.length) {
    console.log('\n=== FAIL (' + errors.length + ') ===');
    errors.forEach(m => console.log('  ! ' + m));
    process.exit(1);
  }
  console.log('\nAll checks passed.');
})().catch(e => { console.error(e); process.exit(1); });

/** chrome.* for an extension page: storage, tabs and a chrome.tts that records what it says. */
function fakeChrome(store, spokenList) {
  return {
    storage: { local: {
      get: (keys, cb) => {
        const list = typeof keys === 'string' ? [keys] : [].concat(keys);
        const out = {};
        list.forEach(k => { if (k in store) out[k] = JSON.parse(JSON.stringify(store[k])); });
        cb(out);
      },
      set: (obj, cb) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); if (cb) cb(); },
      remove: (k, cb) => { delete store[k]; if (cb) cb(); }
    } },
    tabs: {
      query: (q, cb) => cb([{ id: 7, url: 'https://example.com/page' }]),
      sendMessage: (id, msg, cb) => { if (cb) cb({ success: true }); },
      create: () => {}
    },
    tts: {
      speak: (text, opts) => {
        spokenList.push(text);
        // A real voice reports the end; this one does at once.
        if (opts && opts.onEvent) setTimeout(() => opts.onEvent({ type: 'end' }), 1);
      },
      stop: () => {},
      pause: () => {},
      resume: () => {},
      isSpeaking: cb => cb(false)
    },
    runtime: {
      lastError: null,
      getURL: p => 'chrome-extension://test/' + p,
      sendMessage: (msg, cb) => { if (cb) cb({ success: true }); },
      onMessage: { addListener() {} }
    }
  };
}

function openPage(file, query, store, spokenList) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const page = new JSDOM(html, {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'chrome-extension://test/' + file + (query || '')
  });
  const w = page.window;
  const uncaught = [];
  w.addEventListener('error', e => uncaught.push(e.message));
  w.console.log = () => {};
  w.close = () => {};
  w.Element.prototype.scrollIntoView = function () {};
  w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  w.speechSynthesis = { getVoices: () => [], addEventListener() {}, cancel() {}, speak() {} };
  w.chrome = fakeChrome(store, spokenList);
  Array.from(w.document.querySelectorAll('script[src]')).map(s => s.getAttribute('src'))
    .forEach(f => w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return { window: w, doc: w.document, uncaught: uncaught };
}

// ── The popup ─────────────────────────────────────────────────────────────────
async function popupChecks() {
  const said = [];
  const heard = () => said[said.length - 1] || '';
  const page = openPage('popup.html', '', { accessiflowScreenReader: true }, said);
  await wait(30);
  const w = page.window;
  const pd = page.doc;
  const Voice = w.AccessiFlowUiVoice;
  const keys = keyboard(w);

  check(page.uncaught.length === 0, 'the popup loads without errors' + (page.uncaught.length ? ': ' + page.uncaught.join('; ') : ''));
  check(Voice.readerOn(), 'with the built-in reader on, the reader runs inside the popup');
  check(said.some(t => /^AccessiFlow panel\./.test(t) && /arrow keys read the panel/.test(t)),
    'which introduces itself and says the arrow keys read it: ' + (said[0] || '').slice(0, 60));

  keys.press('Home', { ctrlKey: true });
  const down = keys.press('ArrowDown');
  check(down.defaultPrevented && heard() !== '', 'the down arrow reads the popup line by line: ' + heard());
  check(/heading level 1, AccessiFlow/.test(heard()), 'the first lines are the heading of the popup: ' + heard());
  keys.press('h');
  check(/heading level 2, Your setup/.test(heard()), 'H jumps to the next heading: ' + heard());
  keys.press('h');
  check(/heading level 2, Quick settings/.test(heard()), 'and again to the one after: ' + heard());
  keys.press('h', { shiftKey: true });
  check(/heading level 2, Your setup/.test(heard()), 'Shift+H goes back: ' + heard());
  keys.press('b');
  check(heard() === pd.getElementById('btnChangeSetup').getAttribute('aria-label') + ', button',
    'B jumps to the next button, the one beside the setup: ' + heard());
  keys.press('h'); keys.press('b');
  check(/^Less text size, button/.test(heard()),
    'and an icon button is named without its hidden "−" sign: ' + heard());

  // X to the site switch, Space to press it: as in NVDA's browse mode.
  keys.press('Home', { ctrlKey: true });
  keys.press('x');
  check(/On for this site, switch, on/.test(heard()), 'X finds the site switch, and it says on: ' + heard());
  keys.press(' ');
  await wait(90);
  check(!pd.getElementById('siteOn').checked, 'Space on it switches it, without Tab');
  check(said.some(t => /AccessiFlow is off for example\.com/.test(t)), 'and the popup says what that did');

  const esc = keys.press('Escape');
  check(!esc.defaultPrevented, 'Escape in browse mode is left to Chrome, which closes the popup');

  // The popup's own switch turns the reader off here too.
  const sr = pd.getElementById('screenReader');
  if (sr) {
    sr.checked = false;
    sr.dispatchEvent(new w.Event('change', { bubbles: true }));
    await wait(10);
    check(!Voice.readerOn(), 'switching the reader off in the popup stops it there');
    const after = keys.press('ArrowDown');
    check(!after.defaultPrevented, 'and the arrow keys are the page\'s again');
  } else {
    check(false, 'the popup has a screen reader switch');
  }

  // Off, the popup stays as it was: no reader, Tab only.
  const quiet = [];
  const off = openPage('popup.html', '', {}, quiet);
  await wait(30);
  check(!off.window.AccessiFlowUiVoice.readerOn() && quiet.length === 0,
    'with the reader off the popup neither reads nor takes the arrow keys');
}

// ── The setup page ────────────────────────────────────────────────────────────
async function setupChecks() {
  const said = [];
  const heard = () => said[said.length - 1] || '';
  const all = () => said.join(' ');
  const page = openPage('welcome.html', '', {}, said);
  await wait(30);
  const w = page.window;
  const sd = page.doc;
  const Voice = w.AccessiFlowUiVoice;
  const keys = keyboard(w);
  const shown = step => !sd.getElementById('step-' + step).hidden;

  check(page.uncaught.length === 0, 'the setup page loads without errors' + (page.uncaught.length ? ': ' + page.uncaught.join('; ') : ''));
  check(Voice.readerOn(), 'on first install the reader runs on the setup page, which talks at once');
  check(/The arrow keys read the page line by line/.test(all()), 'and it says the arrow keys read it');
  check(sd.activeElement && sd.activeElement.id === 'h-needs' &&
    w.AccessiFlowUiVoice.reader._cursor.index === w.AccessiFlowUiVoice.reader._buffer().lineOf(sd.getElementById('h-needs')),
    'the reading cursor starts on the first question, where focus is');

  // The page's own keys come first.
  keys.press('2');
  check(sd.getElementById('need-blind').checked, '2 still chooses "Blind", not heading level 2');
  said.length = 0;
  keys.press('r');
  check(/^Question 1 of 3/.test(all()), 'R still repeats the question');

  // And NVDA's around them.
  keys.press('ArrowDown');
  check(/Choose as many as fit you/.test(heard()), 'the down arrow reads on from the question: ' + heard());
  keys.press('x');
  check(/^Low vision, check box, not checked/.test(heard()),
    'X jumps to the first check box, named by its need alone: ' + heard());
  sd.getElementById('need-senior').focus();
  check(/^Easier all round, check box, not checked\. /.test(heard()) && heard().split('Key 7').length === 2,
    'Tab onto one says its help once, after the name: ' + heard());
  Voice.focusQuietly(sd.getElementById('need-visual'));
  keys.press(' ');
  await wait(10);
  check(sd.getElementById('need-visual').checked && /Low vision, chosen/.test(all()),
    'Space ticks it, and the page says so');
  keys.press('x', { shiftKey: true });
  check(/No previous check box/.test(heard()), 'Shift+X goes back, and says when there is no more');

  // Enter: on a check box or text it moves on, as the page promises.
  keys.press('ArrowUp');
  keys.press('Enter');
  check(shown('details'), 'Enter moves on to the next question, as the page says it will');
  check(sd.activeElement.id === 'h-details' &&
    Voice.reader._cursor.index === Voice.reader._buffer().lineOf(sd.getElementById('h-details')),
    'and the reading cursor moves there with focus');

  // Escape on the speed slider leaves focus mode, not the voice.
  const rate = sd.getElementById('rate');
  rate.focus();
  check(Voice.mode() === 'focus', 'on the speed slider the reader is in focus mode, so the arrows move the slider');
  keys.press('Escape');
  check(Voice.mode() === 'browse' && sd.getElementById('btnVoice').getAttribute('aria-pressed') === 'true',
    'Escape there goes back to browse mode and leaves the voice on');

  // B to the Next button, and Enter presses it.
  keys.press('Home', { ctrlKey: true });
  keys.press('h'); keys.press('h');
  let guard = 0;
  while (!/^Next, button/.test(heard()) && guard++ < 12) keys.press('b');
  check(/^Next, button/.test(heard()), 'B reaches the Next button: ' + heard());
  keys.press('Enter');
  check(shown('review'), 'and Enter presses it');

  // In browse mode, Escape still silences the page for an NVDA user.
  keys.press('Escape');
  check(sd.getElementById('btnVoice').getAttribute('aria-pressed') === 'false' && !Voice.readerOn(),
    'Escape in browse mode turns the voice, and the reader, off');
  const free = keys.press('ArrowDown');
  check(!free.defaultPrevented, 'after which the arrow keys are the page\'s again');
}
