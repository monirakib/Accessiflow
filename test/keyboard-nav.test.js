// Keyboard-only mode, under jsdom.
//
// The mode takes single letter keys away from the page, which is only
// acceptable because it gives them back the moment the user is typing. Those
// cases are tested as hard as the commands themselves: a J swallowed out of
// someone's email is a worse bug than a J that fails to scroll.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

const PAGE = `<!DOCTYPE html><html lang="en"><body>
  <h1 id="h-top">Welcome</h1>
  <button id="save">Save</button>
  <a id="docs" href="#docs-section">Documentation</a>
  <input id="name" type="text" aria-label="Your name">
  <input id="agree" type="checkbox" aria-label="I agree">
  <h2 id="h-mid">Details</h2>
  <textarea id="notes" aria-label="Notes"></textarea>
  <h2 id="h-end">The end</h2>
  <button id="offscreen">Far down</button>
  <nav>
    <a id="urgent" tabindex="0">Urgent applications</a>
    <div id="self" role="button" tabindex="0">Handles its own keys</div>
    <div id="prevent" role="tab" tabindex="0">Prevents the default</div>
    <div id="spacebtn" role="button" tabindex="0">Space button</div>
    <div id="scroller" tabindex="0">A scrollable panel</div>
  </nav>
</body></html>`;

const RECTS = {
  'h-top': { top: 10, left: 10, width: 400, height: 40 },
  save: { top: 60, left: 10, width: 80, height: 30 },
  docs: { top: 100, left: 10, width: 200, height: 20 },
  name: { top: 140, left: 10, width: 200, height: 24 },
  agree: { top: 180, left: 10, width: 16, height: 16 },
  'h-mid': { top: 220, left: 10, width: 400, height: 30 },
  notes: { top: 260, left: 10, width: 300, height: 80 },
  'h-end': { top: 400, left: 10, width: 400, height: 30 },
  offscreen: { top: 2000, left: 10, width: 80, height: 30 }
};

const dom = new JSDOM(PAGE, { runScripts: 'outside-only', url: 'https://example.com/' });
const { window } = dom;
const doc = window.document;
window.console.log = () => {};
window.console.warn = () => {};

window.Element.prototype.getBoundingClientRect = function () {
  const r = RECTS[this.id] || { top: 0, left: 0, width: 0, height: 0 };
  return Object.assign({}, r, { right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top });
};
window.Element.prototype.getClientRects = function () {
  return RECTS[this.id] ? [this.getBoundingClientRect()] : [];
};
window.Element.prototype.scrollIntoView = function () {};
Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
let scrolled = 0;
window.scrollBy = (a, b) => { scrolled += typeof a === 'object' ? a.top : b; };
let wentBack = 0;
Object.defineProperty(window.history, 'back', { value: () => { wentBack++; }, configurable: true });

for (const f of ['modules/color.js', 'modules/overlay.js', 'modules/naming.js',
  'modules/page-actions.js', 'modules/keyboard-nav.js', 'modules/motor.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const el = id => doc.getElementById(id);
const press = (key, target, opts) => {
  const e = new window.KeyboardEvent('keydown',
    Object.assign({ key: key, bubbles: true, cancelable: true }, opts || {}));
  (target || doc.body).dispatchEvent(e);
  return e;
};
const legend = () => doc.getElementById('accessiflow-kbnav-legend');
const hintHost = () => doc.getElementById('accessiflow-kbnav-hints');
const hints = () => Array.from(hintHost().shadowRoot.querySelectorAll('.hint'));
const statusText = () => legend().shadowRoot.querySelector('.status').textContent;

// ── Labels ──────────────────────────────────────────────────────────────────
{
  const Nav = window.AccessiFlowKeyboardNav;
  const few = Nav.makeLabels(5);
  check(few.every(l => l.length === 1), 'five targets need one letter each: ' + few.join(' '));
  const many = Nav.makeLabels(40);
  check(many.every(l => l.length === 2), 'forty targets get two letters each');
  check(new Set(many).size === 40, 'and every label is different');
  check(!many.some(a => many.some(b => a !== b && b.indexOf(a) === 0)),
    'no label is the start of another, so the last letter always acts at once');
  check(few[0][0] === 'A' && few[1][0] === 'S', 'labels start on the home row');
}

// ── Switching on through the motor module ──────────────────────────────────
const motor = new window.MotorModule();
motor.apply({ keyboardOnly: true });
check(!!legend(), 'turning the mode on puts the key guide on the page');
{
  const text = legend().shadowRoot.textContent;
  check(/Scroll down/.test(text) && /Label everything you can click/.test(text) && /Next heading/.test(text),
    'the guide lists the scrolling, clicking and heading keys');
  check(/Alt\+Shift\+E/.test(text), 'and says how to turn the mode off');
  check(!legend().shadowRoot.querySelector('.panel').hidden,
    'the guide starts open the first time, so the keys can be found');
}

// ── Scrolling ───────────────────────────────────────────────────────────────
{
  scrolled = 0;
  const e = press('j');
  check(scrolled > 0 && e.defaultPrevented, 'J scrolls down and the page does not also get it');
  press('k');
  check(scrolled === 0, 'K scrolls back up by the same amount');
}

// ── Typing is never taken ──────────────────────────────────────────────────
{
  scrolled = 0;
  el('name').focus();
  const e = press('j', el('name'));
  check(!e.defaultPrevented && scrolled === 0, 'J typed into a text box is left alone');
  const f = press('f', el('notes'));
  check(!f.defaultPrevented && !hintHost(), 'F typed into a textarea does not open labels');

  el('name').focus();
  press('Escape', el('name'));
  check(doc.activeElement !== el('name'), 'Esc leaves the text box, so the keys work again');
  check(/Left the text box/.test(statusText()), 'and says so');
}

// Browser and AccessiFlow shortcuts pass through untouched.
{
  const e = press('j', doc.body, { ctrlKey: true });
  check(!e.defaultPrevented, 'Ctrl+J still belongs to the browser');
  const s = press(' ', doc.body, { shiftKey: true });
  check(!s.defaultPrevented, 'Shift+Space is left to scroll up natively');
}

// ── Headings ────────────────────────────────────────────────────────────────
{
  doc.body.focus();
  press('n');
  check(doc.activeElement === el('h-top'), 'N goes to the first heading on screen');
  press('n');
  check(doc.activeElement === el('h-mid'), 'N again goes to the next');
  press('p');
  check(doc.activeElement === el('h-top'), 'P goes back');
  press('p');
  check(/No more headings above/.test(statusText()), 'and says when there are none left');
}

// ── Text boxes ──────────────────────────────────────────────────────────────
{
  doc.activeElement.blur();
  press('i');
  check(doc.activeElement === el('name'), 'I jumps to the first text box, skipping the checkbox');
}

// ── Back ────────────────────────────────────────────────────────────────────
{
  doc.activeElement.blur();
  press('b');
  check(wentBack === 1, 'B goes back a page');
}

// ── Letter labels ───────────────────────────────────────────────────────────
{
  press('f');
  check(!!hintHost(), 'F shows the letter labels');
  const labelled = hints().length;
  check(labelled === 5, 'every clickable thing on screen is labelled, and nothing off screen: ' + labelled);

  let saved = 0;
  el('save').addEventListener('click', () => { saved++; });
  const e = press('a');
  check(e.defaultPrevented, 'the letter is taken while labels are open');
  check(saved === 1, 'typing the first label clicks the Save button');
  check(!hintHost(), 'and the labels close');

  // A text box is focused, not clicked.
  press('f');
  const nameLabel = hints().find((h, i) => i === 2).textContent;
  press(nameLabel.toLowerCase());
  check(doc.activeElement === el('name'), 'choosing a text box puts the keyboard in it, ready to type');

  // Esc closes without choosing.
  doc.activeElement.blur();
  saved = 0;
  press('f');
  press('Escape');
  check(!hintHost() && saved === 0, 'Esc closes the labels without clicking anything');

  // Another key closes and is let through.
  press('f');
  const tab = press('Tab');
  check(!hintHost() && !tab.defaultPrevented, 'Tab closes the labels and still moves on as normal');

  // Scrolling makes the labels wrong, so they go.
  press('f');
  window.dispatchEvent(new window.Event('scroll'));
  check(!hintHost(), 'scrolling closes the labels');
}

// ── The guide can be hidden and brought back ────────────────────────────────
{
  const panel = () => legend().shadowRoot.querySelector('.panel');
  const pill = () => legend().shadowRoot.querySelector('.pill');
  press('h');
  check(panel().hidden && !pill().hidden, 'H hides the guide, leaving a small button to bring it back');
  press('?', doc.body, { shiftKey: true });
  check(!panel().hidden, '? shows it again');
  pill().click();
  check(!panel().hidden, 'the button opens it too');

  // Rebuilt when settings change, and remembers whether it was open.
  press('h');
  motor.destroy();
  motor.apply({ keyboardOnly: true });
  check(panel().hidden, 'the guide stays hidden when settings change');
}

// ── Enter on controls that only listen for the mouse ────────────────────────
const clicks = {};
['urgent', 'self', 'prevent', 'spacebtn', 'scroller', 'save'].forEach(id => {
  clicks[id] = 0;
  el(id).addEventListener('click', () => { clicks[id]++; });
});
// A well-built control that already answers the key, two ways.
el('self').addEventListener('keydown', e => { if (e.key === 'Enter') el('self').click(); });
el('prevent').addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
{
  el('urgent').focus();
  const e = press('Enter', el('urgent'));
  check(clicks.urgent === 1, 'Enter on a link with no href, which a site only wired for the mouse, clicks it');
  check(e.defaultPrevented, 'and the page gets no second go at the key');

  press('Enter', el('self'));
  check(clicks.self === 1, 'a control that clicks itself on Enter is clicked once, not twice');

  press('Enter', el('prevent'));
  check(clicks.prevent === 0, 'a control that handles Enter itself is left to it');

  const space = press(' ', el('spacebtn'));
  check(clicks.spacebtn === 1 && space.defaultPrevented,
    'Space presses a role="button", without also scrolling the page');

  const spaceOnPanel = press(' ', el('scroller'));
  check(clicks.scroller === 0 && !spaceOnPanel.defaultPrevented,
    'Space on a plain focusable panel still scrolls, as it should');
  press('Enter', el('scroller'));
  check(clicks.scroller === 1, 'while Enter on it counts as a click');

  press('Enter', el('save'));
  check(clicks.save === 0, 'a real button is left to the browser, which clicks it by itself');

  press('Enter', el('urgent'), { ctrlKey: true });
  check(clicks.urgent === 1, 'Ctrl+Enter is not turned into a click');
}

// ── Off means off ───────────────────────────────────────────────────────────
motor.destroy();
{
  press('Enter', el('urgent'));
  check(clicks.urgent === 1, 'with the mode off, Enter on a fake button goes back to doing nothing');
}
check(!legend() && !hintHost(), 'switching off removes the guide');
{
  scrolled = 0;
  const e = press('j');
  check(!e.defaultPrevented && scrolled === 0, 'and the single keys go back to the page');
}
check(!el('h-top').hasAttribute('tabindex'), 'headings made focusable along the way are put back');

finish();

function finish() {
  console.log('\n=== PASS (' + ok.length + ') ===');
  ok.forEach(m => console.log('  + ' + m));
  if (errors.length) {
    console.log('\n=== FAIL (' + errors.length + ') ===');
    errors.forEach(m => console.log('  ! ' + m));
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}
