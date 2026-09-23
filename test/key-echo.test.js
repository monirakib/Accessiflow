// Key echo: what a blind user hears as they type. Driven with the same
// beforeinput and input events the browser sends, since those, not keydown,
// are what the module listens to.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <input id="name" type="text">
  <input id="pin" type="password">
  <textarea id="note"></textarea>
  <input id="agree" type="checkbox">
  <input id="volume" type="range">
  <div id="rich" contenteditable="true">hello</div>
  <p id="plain">not editable</p>
</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;

for (const f of ['modules/sr-speech.js', 'modules/key-echo.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const said = [];
const echo = new window.AccessiFlowKeyEcho();
echo.setSpeaker(text => said.push(text));

const byId = id => doc.getElementById(id);

/** Types one character the way the browser reports it. */
function type(el, ch) {
  el.focus();
  if ('value' in el && el.tagName !== 'DIV') {
    const at = el.selectionStart != null ? el.selectionStart : el.value.length;
    el.value = el.value.slice(0, at) + ch + el.value.slice(at);
    try { el.setSelectionRange(at + 1, at + 1); } catch (e) { /* ok */ }
  } else {
    el.firstChild.data += ch;
    const range = doc.createRange();
    range.setStart(el.firstChild, el.firstChild.data.length);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  el.dispatchEvent(new window.InputEvent('input', { inputType: 'insertText', data: ch, bubbles: true }));
}

function typeAll(el, text) { for (const ch of text) type(el, ch); }

function backspace(el) {
  el.dispatchEvent(new window.InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }));
  const at = el.selectionStart;
  el.value = el.value.slice(0, at - 1) + el.value.slice(at);
  el.setSelectionRange(at - 1, at - 1);
  el.dispatchEvent(new window.InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }));
}

// ── Off by default ──────────────────────────────────────────────────────────
typeAll(byId('name'), 'ab');
check(said.length === 0, 'nothing is said while key echo is off');

// ── Letters ─────────────────────────────────────────────────────────────────
echo.apply('letters');
byId('name').value = '';
typeAll(byId('name'), 'Hi 5@');
check(said.join('|') === 'cap H|i|space|5|at',
  'letters: each key, with capitals and symbols named: ' + said.join(' | '));

said.length = 0;
backspace(byId('name'));
check(said[0] === 'at deleted', 'backspace names what it removed: ' + said[0]);

said.length = 0;
byId('name').setSelectionRange(0, 0);
byId('name').dispatchEvent(new window.InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true }));
check(said.length === 0, 'backspace at the very start, with nothing to remove, says nothing');

said.length = 0;
typeAll(byId('pin'), 'secret');
check(said.length === 6 && said.every(s => s === 'star'),
  'a password box says star for every key, never the letter: ' + said.join(' '));
said.length = 0;
byId('pin').setSelectionRange(6, 6);
backspace(byId('pin'));
check(said[0] === 'star deleted', 'and never names a deleted password character either');

// ── Not a text box ──────────────────────────────────────────────────────────
said.length = 0;
byId('agree').dispatchEvent(new window.InputEvent('input', { inputType: 'insertText', data: 'x', bubbles: true }));
byId('volume').dispatchEvent(new window.InputEvent('input', { bubbles: true }));
byId('plain').dispatchEvent(new window.InputEvent('input', { inputType: 'insertText', data: 'x', bubbles: true }));
check(said.length === 0, 'check boxes, sliders and ordinary text never echo');

// ── Words ───────────────────────────────────────────────────────────────────
echo.apply('words');
said.length = 0;
byId('note').value = '';
typeAll(byId('note'), "don't stop.");
check(said.join('|') === "don't|stop dot",
  'words: each word as it ends, an apostrophe inside a word does not split it: ' + said.join(' | '));

said.length = 0;
typeAll(byId('pin'), 'abc ');
check(said.length === 0, 'in words mode a password is not spoken at all');

said.length = 0;
byId('note').value = 'last line';
byId('note').setSelectionRange(9, 9);
byId('note').value += '\n';
byId('note').setSelectionRange(10, 10);
byId('note').dispatchEvent(new window.InputEvent('input', { inputType: 'insertLineBreak', bubbles: true }));
check(said[0] === 'line, new line', 'Enter says the word it finished, then "new line": ' + said[0]);

// ── Both ────────────────────────────────────────────────────────────────────
echo.apply('both');
said.length = 0;
byId('name').value = '';
typeAll(byId('name'), 'go ');
check(said.join('|') === 'g|o|go', 'both: the letters, then the word in place of "space": ' + said.join(' | '));

// ── Content editable ────────────────────────────────────────────────────────
echo.apply('letters');
said.length = 0;
type(byId('rich'), '!');
check(said[0] === 'bang', 'rich text editors echo too: ' + said[0]);

// ── Input methods: said once, when the character is complete ────────────────
said.length = 0;
const box = byId('name');
box.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true }));
box.dispatchEvent(new window.InputEvent('input', { inputType: 'insertCompositionText', data: 'ক', isComposing: true, bubbles: true }));
box.dispatchEvent(new window.InputEvent('input', { inputType: 'insertCompositionText', data: 'কা', isComposing: true, bubbles: true }));
box.dispatchEvent(new window.CompositionEvent('compositionend', { data: 'কা', bubbles: true }));
check(said.length === 1 && said[0] === 'কা',
  'a Bangla syllable typed through an input method is said once, whole: ' + said.join(' | '));

// ── Paste, and switching off ────────────────────────────────────────────────
said.length = 0;
box.dispatchEvent(new window.InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }));
check(said[0] === 'Pasted', 'a paste is announced, not read letter by letter');

echo.apply('off');
said.length = 0;
typeAll(byId('name'), 'xyz');
check(said.length === 0, 'switching it off stops it completely');
echo.apply('nonsense');
check(echo.mode === 'off', 'an unknown mode counts as off');

console.log('\n=== PASS (' + ok.length + ') ===');
ok.forEach(m => console.log('  + ' + m));
if (errors.length) {
  console.log('\n=== FAIL (' + errors.length + ') ===');
  errors.forEach(m => console.log('  ! ' + m));
  process.exit(1);
}
console.log('\nAll checks passed.');
