// The hold-click menu, the on-screen keyboard, and the actions behind them.
//
// The ring takes over a held mouse button, which is exactly the kind of help
// that becomes sabotage if it fires when it should not. So the cases where it
// must stay out of the way (a quick click, a drag, a slider, a modified
// click, touch) are tested as hard as the ones where it opens. The keyboard
// is tested for what makes it usable at all: keys never take focus, a held
// Ctrl waits for Do it, and a click into its search box does not lose the
// user's place on the page.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }
const wait = ms => new Promise(r => setTimeout(r, ms));

const PAGE = `<!DOCTYPE html><html lang="en"><body>
  <main>
    <p id="para">Some text to hold the button down on.</p>
    <a id="link" href="#somewhere">A link</a>
    <form id="form"><input id="name" type="text" aria-label="Your name"><button id="send">Send</button></form>
    <textarea id="notes" aria-label="Notes"></textarea>
    <select id="country"><option>UK</option><option>BD</option></select>
    <input id="volume" type="range" min="0" max="10" value="5">
    <div id="panel" style="overflow:auto"><p>Inner</p></div>
  </main>
</body></html>`;

const dom = new JSDOM(PAGE, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/page' });
const { window } = dom;
const doc = window.document;
window.console.log = () => {};
window.console.warn = () => {};
Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
// jsdom lays nothing out; everything connected counts as on screen.
window.Element.prototype.getClientRects = function () { return this.isConnected ? [{}] : []; };
const windowScrolls = [];
window.scrollBy = (a, b) => { windowScrolls.push(typeof a === 'object' ? a.top : b); };

const sent = [];
const storage = {};
let tabReply = null;
window.chrome = {
  runtime: {
    lastError: null,
    sendMessage(msg, cb) {
      sent.push(msg);
      const reply = tabReply ? tabReply(msg) : { ok: true };
      setTimeout(() => cb && cb(reply), 0);
    }
  },
  storage: {
    local: {
      get(key, cb) { cb({ [key]: storage[key] }); },
      set(items) { Object.assign(storage, items); }
    }
  }
};

for (const f of ['modules/color.js', 'modules/overlay.js', 'modules/naming.js', 'modules/page-actions.js',
  'modules/motor.js', 'modules/hand-actions.js', 'modules/pointer-dial.js', 'modules/onscreen-keyboard.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const A = window.AccessiFlowHandActions;
const el = id => doc.getElementById(id);

/** A mouse pointer event, which jsdom has no class for. */
function pointer(type, target, x, y, opts) {
  const o = Object.assign({ button: 0, pointerType: 'mouse', pointerId: 1 }, opts || {});
  const ev = new window.MouseEvent(type, {
    bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: o.button,
    ctrlKey: !!o.ctrlKey, shiftKey: !!o.shiftKey, altKey: !!o.altKey, metaKey: !!o.metaKey
  });
  Object.defineProperty(ev, 'pointerType', { value: o.pointerType });
  Object.defineProperty(ev, 'pointerId', { value: o.pointerId });
  target.dispatchEvent(ev);
  return ev;
}
function mouse(type, target, x, y, opts) {
  const ev = new window.MouseEvent(type, Object.assign({
    bubbles: true, cancelable: true, composed: true, clientX: x || 0, clientY: y || 0
  }, opts || {}));
  target.dispatchEvent(ev);
  return ev;
}
function key(type, keyName, target) {
  const ev = new window.KeyboardEvent(type, { key: keyName, bubbles: true, cancelable: true });
  (target || doc).dispatchEvent(ev);
  return ev;
}

(async () => {
  // ══ The actions ═══════════════════════════════════════════════════════════
  {
    check(A.normalise('win shift s') === 'Win+Shift+S' && A.normalise('Shift+Win+S') === 'Win+Shift+S',
      'combinations are written one way however they are typed: ' + A.normalise('shift + win + s'));
    check(A.forCombo('Ctrl+Shift+Tab').id === 'prevTab' && A.forCombo('ctrl+pageup').id === 'prevTab',
      'Ctrl+Shift+Tab and Ctrl+Page Up both mean the previous tab');
    check(A.forCombo('Win+Shift+S').id === 'screenshot',
      'Win+Shift+S, which a web page cannot press, is answered with a screenshot of the page');
    check(A.explain('Alt+Tab').reach === false && /Windows/.test(A.explain('Alt+Tab').text),
      'Alt+Tab is explained as out of reach rather than sent into the void');
    check(A.explain('Win+R').reach === false, 'so is any other Windows key shortcut');
    check(/Sends Ctrl \+ K/.test(A.explain('Ctrl+K').text), 'an unknown one says it will go to the page');
    check(A.display('Ctrl+Left') === 'Ctrl + Left arrow', 'keys are written out for people: ' + A.display('Ctrl+Left'));

    const ids = A.ACTIONS.map(a => a.id);
    check(new Set(ids).size === ids.length, 'every action has its own id');
    const combos = A.ACTIONS.reduce((all, a) => all.concat(a.keys.map(k => A.normalise(k))), []);
    check(new Set(combos).size === combos.length, 'no combination means two different actions');
    check(A.ACTIONS.filter(a => a.confirm).map(a => a.id).join() === 'closeTab',
      'closing the tab, which cannot be undone, is the one action that asks twice');

    const first = text => (A.search(text)[0] || {}).id;
    check(first('take a screenshot') === 'screenshot', 'search: "take a screenshot" finds Screenshot');
    check(first('make it bigger') === 'zoomIn', 'search: "make it bigger" finds Zoom in');
    check(first('I want to go back') === 'back', 'search: "I want to go back" finds Back');
    check(first('close this tab') === 'closeTab', 'search: "close this tab" finds Close this tab, not New tab');
    check(first('open a new tab') === 'newTab', 'search: "open a new tab" finds New tab');
    check(first('ctrl c') === 'copy', 'search: keys typed as words, "ctrl c", find Copy');
    check(first('scree') === 'screenshot', 'search: a word half typed already finds its action');
    check(first('স্ক্রিনশট') === 'screenshot', 'search: Bangla words are understood too');
    check(A.search('xyzzy').length === 0, 'search: nonsense finds nothing, rather than a guess');
    check(A.search('').length === A.ACTIONS.length, 'search: nothing typed lists everything');

    tabReply = () => ({ ok: true });
    sent.length = 0;
    await A.run('nextTab');
    check(sent.length === 1 && sent[0].action === 'handTab' && sent[0].op === 'nextTab',
      'tab actions go to the service worker, since a page cannot switch tabs itself');
  }

  // ══ The ring ══════════════════════════════════════════════════════════════
  const ran = [];
  const dial = new window.AccessiFlowPointerDial({ run: id => ran.push(id) });
  dial.apply({ enabled: true, delay: 200 });
  const para = el('para');
  let pageClicks = 0;
  para.addEventListener('click', () => { pageClicks++; });
  const ring = () => doc.getElementById('accessiflow-dial');

  // A quick click is the page's.
  pointer('pointerdown', para, 400, 300);
  await wait(60);
  pointer('pointerup', para, 400, 300);
  const quick = mouse('click', para, 400, 300);
  await wait(220);
  check(!dial.isOpen && !quick.defaultPrevented && pageClicks === 1,
    'a quick click is an ordinary click: the ring stays shut and the page gets it');

  // Holding opens it.
  pointer('pointerdown', para, 400, 300);
  await wait(260);
  check(dial.isOpen && ring() && ring().style.display !== 'none', 'holding the button still opens the ring');
  check(ring() && ring().shadowRoot.querySelectorAll('[role="menuitem"]').length === 8,
    'with eight choices, no more: a crowded ring is a hard one to aim at');
  check(!!doc.getElementById('accessiflow-dial-noselect'),
    'text selection is switched off while it is open, so moving to a choice does not select the page');
  pointer('pointermove', doc.documentElement, 340, 300);
  pointer('pointermove', doc.documentElement, 300, 302);
  pointer('pointerup', doc.documentElement, 300, 302);
  const after = mouse('click', para, 300, 302);
  check(ran.join() === 'back', 'moving left and letting go chooses Back: ' + ran.join());
  check(!dial.isOpen, 'and the ring closes');
  check(after.defaultPrevented && pageClicks === 1,
    'the click that follows is swallowed, so letting go over a link does not also follow it');
  check(!doc.getElementById('accessiflow-dial-noselect'), 'text selection is back once it has closed');

  // Pressing on the page takes focus out of a text box, and the box's blur
  // must not be mistaken for the window losing focus.
  ran.length = 0;
  el('name').focus();
  pointer('pointerdown', para, 400, 300);
  el('name').blur();
  await wait(260);
  check(dial.isOpen, 'it opens when the press takes focus out of a text box');
  key('keydown', 'Escape');
  pointer('pointerup', doc.documentElement, 400, 300);
  window.dispatchEvent(new window.FocusEvent('blur'));
  pointer('pointerdown', para, 400, 300);
  window.dispatchEvent(new window.FocusEvent('blur'));
  await wait(260);
  check(!dial.isOpen, 'but not when the whole window loses focus while the button is down');
  pointer('pointerup', para, 400, 300);
  await wait(850);

  // Moving before the delay is a drag or a selection, not a hold.
  ran.length = 0;
  pointer('pointerdown', para, 400, 300);
  await wait(50);
  pointer('pointermove', para, 430, 300);
  await wait(250);
  check(!dial.isOpen, 'moving while holding cancels the ring, so dragging and selecting text still work');
  pointer('pointerup', para, 430, 300);

  // A little tremor is not a drag.
  pointer('pointerdown', para, 400, 300);
  pointer('pointermove', para, 406, 304);
  pointer('pointermove', para, 397, 296);
  await wait(260);
  check(dial.isOpen, 'a few pixels of shake while holding still opens it');
  // Letting go without moving leaves it open for clicking.
  pointer('pointerup', doc.documentElement, 400, 300);
  mouse('click', para, 400, 300);
  check(dial.isOpen, 'letting go without moving keeps it open, for someone who cannot keep a button down');
  const down = pointer('pointerdown', doc.documentElement, 500, 300);
  pointer('pointerup', doc.documentElement, 500, 300);
  check(down.defaultPrevented, 'a click on the open ring is kept from the page');
  check(ran.join() === 'forward' && !dial.isOpen, 'a click to the right chooses Forward: ' + ran.join());
  mouse('click', para, 500, 300);

  // Clicking the middle closes it with nothing done.
  ran.length = 0;
  pointer('pointerdown', para, 400, 300);
  await wait(260);
  pointer('pointerup', doc.documentElement, 400, 300);
  pointer('pointerdown', doc.documentElement, 402, 301);
  pointer('pointerup', doc.documentElement, 402, 301);
  check(!dial.isOpen && ran.length === 0, 'a click in the middle closes it and does nothing');
  await wait(850);

  // Escape, and the keyboard, work while it is open.
  pointer('pointerdown', para, 400, 300);
  await wait(260);
  key('keydown', 'ArrowRight');
  key('keydown', 'ArrowRight');
  key('keydown', 'Enter');
  check(ran.join() === 'nextTab', 'arrow keys move round the ring and Enter chooses: ' + ran.join());
  pointer('pointerup', doc.documentElement, 400, 300);
  pointer('pointerdown', para, 400, 300);
  await wait(260);
  const esc = key('keydown', 'Escape');
  check(!dial.isOpen && esc.defaultPrevented, 'Escape closes it, and the page does not also see the Escape');
  pointer('pointerup', doc.documentElement, 400, 300);
  await wait(850);

  // Places and presses where holding is already the gesture.
  ran.length = 0;
  const neverOpens = [
    ['a list box', el('country'), {}],
    ['a slider', el('volume'), {}],
    ['a click with Ctrl held', para, { ctrlKey: true }],
    ['a touch screen', para, { pointerType: 'touch' }],
    ['the right button, with the left chosen', para, { button: 2 }]
  ];
  for (const [what, target, opts] of neverOpens) {
    pointer('pointerdown', target, 400, 300, opts);
    await wait(240);
    check(!dial.isOpen, 'holding on ' + what + ' never opens the ring');
    pointer('pointerup', target, 400, 300, opts);
  }
  {
    const ours = doc.createElement('div');
    ours.id = 'accessiflow-test-furniture';
    doc.body.appendChild(ours);
    pointer('pointerdown', ours, 400, 300);
    await wait(240);
    check(!dial.isOpen, 'nor on AccessiFlow’s own furniture, such as the on-screen keyboard');
    pointer('pointerup', ours, 400, 300);
    ours.remove();
  }
  {
    // The browser starting to drag what was pressed.
    pointer('pointerdown', el('link'), 400, 300);
    el('link').dispatchEvent(new window.MouseEvent('dragstart', { bubbles: true, cancelable: true }));
    await wait(240);
    check(!dial.isOpen, 'a drag the browser starts cancels the hold');
    pointer('pointerup', el('link'), 400, 300);
  }

  // The right button.
  dial.apply({ enabled: true, delay: 200, button: 'right' });
  {
    const quickMenu = (() => {
      pointer('pointerdown', para, 400, 300, { button: 2 });
      pointer('pointerup', para, 400, 300, { button: 2 });
      return mouse('contextmenu', para, 400, 300, { button: 2 });
    })();
    check(!quickMenu.defaultPrevented, 'with the right button chosen, a quick right-click still opens the page’s menu');
    pointer('pointerdown', para, 400, 300);
    await wait(240);
    check(!dial.isOpen, 'and holding the left button is left alone');
    pointer('pointerup', para, 400, 300);

    pointer('pointerdown', para, 400, 300, { button: 2 });
    await wait(260);
    check(dial.isOpen, 'holding the right button opens it');
    pointer('pointermove', doc.documentElement, 400, 360, { button: 2 });
    pointer('pointermove', doc.documentElement, 330, 370, { button: 2 });
    pointer('pointerup', doc.documentElement, 330, 370, { button: 2 });
    const menu = mouse('contextmenu', para, 330, 370, { button: 2 });
    check(ran.pop() === 'keyboard', 'down and to the left is the Keyboard');
    check(menu.defaultPrevented, 'and the right-click menu that Windows opens on letting go is held back');
  }
  dial.apply({ enabled: true, delay: 200 });
  await wait(850);

  // Holding on a scroll choice scrolls until let go.
  {
    const panel = el('panel');
    const scrolls = [];
    const realScrollerAt = A.scrollerAt;
    const realScrollBy = A.scrollBy;
    A.scrollerAt = () => panel;
    A.scrollBy = (target, dy) => { scrolls.push([target, dy]); };

    pointer('pointerdown', para, 400, 300);
    await wait(260);
    pointer('pointermove', doc.documentElement, 400, 350);
    pointer('pointermove', doc.documentElement, 402, 400);
    await wait(90);
    check(scrolls.length === 0, 'passing over Scroll down does not jerk the page straight away');
    await wait(300);
    const moved = scrolls.reduce((sum, s) => sum + s[1], 0);
    check(scrolls.length > 3 && moved > 0 && scrolls.every(s => s[0] === panel),
      'holding on Scroll down keeps scrolling what is under the pointer: ' + moved + 'px in ' + scrolls.length + ' steps');
    pointer('pointerup', doc.documentElement, 402, 400);
    const count = scrolls.length;
    await wait(120);
    check(scrolls.length === count && !dial.isOpen, 'letting go stops it at once');
    mouse('click', para, 400, 400);

    // A quick flick to Scroll up scrolls one screen.
    windowScrolls.length = 0;
    A.scrollerAt = () => doc.scrollingElement || doc.documentElement;
    pointer('pointerdown', para, 400, 300);
    await wait(260);
    pointer('pointermove', doc.documentElement, 400, 250);
    pointer('pointerup', doc.documentElement, 400, 250);
    check(windowScrolls.length === 1 && windowScrolls[0] < -400,
      'a quick flick to Scroll up moves the page up by a screen: ' + windowScrolls.join());
    mouse('click', para, 400, 250);

    A.scrollerAt = realScrollerAt;
    A.scrollBy = realScrollBy;
  }

  // Selection is put back.
  {
    const text = para.firstChild;
    const range = doc.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 4);
    doc.getSelection().removeAllRanges();
    doc.getSelection().addRange(range);
    pointer('pointerdown', para, 400, 300);
    await wait(260);
    doc.getSelection().collapse(text, 10);    // what dragging over text would do
    key('keydown', 'Escape');
    check(String(doc.getSelection()) === 'Some', 'whatever was selected before the ring opened is selected again after');
    pointer('pointerup', doc.documentElement, 400, 300);
  }

  dial.apply({ enabled: false });
  pointer('pointerdown', para, 400, 300);
  await wait(260);
  check(!dial.isOpen, 'switched off, holding does nothing');
  pointer('pointerup', para, 400, 300);
  dial.destroy();
  check(!ring(), 'and nothing is left on the page');

  // ══ The keyboard ══════════════════════════════════════════════════════════
  let hidden = 0;
  const board = new window.AccessiFlowScreenKeyboard({ onHide: () => { hidden++; } });
  board.show();
  await wait(10);
  const host = doc.getElementById('accessiflow-keyboard');
  const root = host.shadowRoot;
  const keys = label => Array.from(root.querySelectorAll('.key')).filter(b => b.getAttribute('aria-label') === label);
  // A real press: down, up, click, all crossing out of the shadow root.
  const tap = button => {
    const downEv = mouse('mousedown', button);
    mouse('mouseup', button);
    mouse('click', button);
    return downEv;
  };
  const press = (...labels) => labels.forEach(l => {
    const found = keys(l);
    if (!found.length) throw new Error('no key ' + l);
    tap(found[0]);
  });
  const status = () => root.querySelector('.status').textContent;
  const comboBox = () => root.querySelector('.combo');
  const settle = () => wait(20);

  check(host && host.style.display !== 'none', 'the keyboard shows');
  check(keys('Ctrl').length === 1 && keys('Windows key').length === 1 && keys('Shift').length === 2,
    'it has Ctrl, Alt, Shift and the Windows key');

  const name = el('name');
  name.focus();
  press('h', 'i');
  check(name.value === 'hi', 'keys type into the box that has focus: "' + name.value + '"');
  check(doc.activeElement === name, 'and focus stays in that box');
  check(tap(keys('j')[0]).defaultPrevented, 'because pressing a key never takes focus');
  press('Backspace');
  check(name.value === 'hi', 'Backspace deletes: "' + name.value + '"');
  check(/typing into .*Your name/.test(root.querySelector('.into').textContent),
    'the bar says where typing is going: ' + root.querySelector('.into').textContent);

  press('Shift', 'A', 'b');
  check(name.value === 'hiAb', 'Shift makes the next letter a capital, then lets go: "' + name.value + '"');
  press('Shift', '!');
  check(name.value === 'hiAb!', 'and gives the symbol above a number: "' + name.value + '"');
  press('Caps Lock', 'C', 'Caps Lock');
  check(name.value === 'hiAb!C', 'Caps Lock holds capitals until pressed again: "' + name.value + '"');
  press('Space');
  check(name.value === 'hiAb!C ', 'Space types a space');
  press('Left arrow', 'Left arrow', 'x');
  check(name.value === 'hiAb!xC ', 'the arrows move the caret: "' + name.value + '"');

  let pageClicksOnKeys = 0;
  const countClicks = () => { pageClicksOnKeys++; };
  doc.addEventListener('click', countClicks);
  press('z');
  doc.removeEventListener('click', countClicks);
  check(pageClicksOnKeys === 0,
    'the page never hears a click on a key, so its suggestions and pop-ups do not close as you type');

  // Enter
  {
    const notes = el('notes');
    notes.focus();
    press('o', 'k', 'Enter', 'y');
    check(notes.value === 'ok\ny', 'Enter starts a new line in a text area: ' + JSON.stringify(notes.value));
    let submitted = 0;
    el('form').addEventListener('submit', e => { e.preventDefault(); submitted++; });
    name.focus();
    press('Enter');
    check(submitted === 1, 'and sends a one-line box’s form, as a real Enter would');
  }

  // Tab
  name.focus();
  press('Tab');
  check(doc.activeElement === el('send'), 'Tab moves to the next thing on the page');
  press('Shift', 'Tab');
  check(doc.activeElement === name, 'and Shift then Tab moves back');

  // Arrows on list boxes and sliders, which script cannot fake with key events.
  el('country').focus();
  press('Down arrow');
  check(el('country').selectedIndex === 1, 'the arrows choose in a list box');
  el('volume').focus();
  press('Right arrow');
  check(el('volume').value === '6', 'and move a slider: ' + el('volume').value);

  // ── Shortcuts, one key at a time ──
  name.value = 'hello';
  name.focus();
  name.setSelectionRange(0, 5);
  press('Ctrl');
  check(!comboBox().hidden, 'pressing Ctrl shows the shortcut being built');
  check(root.querySelector('.doit').disabled, 'with Do it waiting for a key');
  check(keys('Ctrl')[0].getAttribute('aria-pressed') === 'true' && /held/.test(keys('Ctrl')[0].textContent),
    'Ctrl stays down, and says so in words as well as colour');
  press('c');
  check(name.value === 'hello', 'a letter pressed with Ctrl held is not typed');
  check(/Copy/.test(root.querySelector('.means').textContent),
    'the line says what the shortcut will do before it is done: ' + root.querySelector('.means').textContent);
  tap(root.querySelector('.doit'));
  await settle();
  check(status() === 'Copied.', 'Do it runs it: ' + status());
  check(comboBox().hidden && keys('Ctrl')[0].getAttribute('aria-pressed') === 'false', 'and lets go of Ctrl');

  el('notes').value = '';
  el('notes').focus();
  press('Ctrl', 'v');
  tap(root.querySelector('.doit'));
  await settle();
  check(el('notes').value === 'hello',
    'Paste works where Chrome will not share the clipboard, from what was copied with AccessiFlow: ' + el('notes').value);

  // Unknown ones go to the page, as key events.
  const heard = [];
  const listen = e => { heard.push((e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + e.key); };
  doc.addEventListener('keydown', listen);
  press('Ctrl', 'k');
  tap(root.querySelector('.doit'));
  await settle();
  check(heard.join() === 'Ctrl+k', 'a shortcut AccessiFlow does not know is pressed on the page: ' + heard.join());
  heard.length = 0;
  press('Alt', 'Shift', 'R');
  tap(root.querySelector('.doit'));
  await settle();
  check(heard.join() === 'Alt+Shift+R', 'including AccessiFlow’s own Alt+Shift keys, one key at a time: ' + heard.join());
  doc.removeEventListener('keydown', listen);

  // A page that handles the keys itself keeps them.
  {
    const own = e => { if (e.ctrlKey && e.key === 'z') e.preventDefault(); };
    doc.addEventListener('keydown', own);
    name.focus();
    press('Ctrl', 'z');
    tap(root.querySelector('.doit'));
    await settle();
    check(status() === 'Done.', 'a page with its own Ctrl+Z gets it, as it would from a real keyboard');
    doc.removeEventListener('keydown', own);
  }

  // What cannot be done is said, before and after.
  press('Windows key', 'r');
  check(root.querySelector('.means').classList.contains('cannot') && /Windows/.test(root.querySelector('.means').textContent),
    'a Windows key shortcut is marked as out of reach before Do it');
  tap(root.querySelector('.combo .tool'));
  check(comboBox().hidden, 'Clear lets go of everything held');

  // Win+Shift+S: a screenshot, with AccessiFlow's own furniture out of the picture.
  {
    let keyboardDuringCapture = null;
    tabReply = msg => {
      if (msg.op === 'screenshot') {
        keyboardDuringCapture = host.style.getPropertyValue('visibility');
        return { ok: true, image: 'data:image/png;base64,iVBORw0KGgo=' };
      }
      return { ok: true };
    };
    press('Windows key', 'Shift', 'S');
    check(/Screenshot/.test(root.querySelector('.means').textContent), 'Win+Shift+S reads as a screenshot');
    tap(root.querySelector('.doit'));
    await wait(200);
    check(keyboardDuringCapture === 'hidden', 'the keyboard is hidden while the picture is taken');
    check(host.style.getPropertyValue('visibility') === '', 'and back straight afterwards');
    check(!!doc.getElementById('accessiflow-hand-preview'),
      'where the clipboard will not take a picture, it is shown on the page to copy or save instead');
    A.destroy();
    tabReply = () => ({ ok: true });
  }

  // ── Shortcuts panel and the plain-words search ──
  {
    tap(Array.from(root.querySelectorAll('.tool')).find(b => b.textContent === 'Shortcuts'));
    const panel = root.querySelector('.panel');
    const search = root.getElementById('accessiflow-ask');
    check(!panel.hidden, 'Shortcuts opens the list');
    check(root.querySelectorAll('.act').length === A.ACTIONS.length && root.querySelectorAll('.results h3').length === 4,
      'which shows every action, in groups');

    // Typing into the search box with the keyboard itself.
    name.value = 'hello world';
    name.focus();
    name.setSelectionRange(6, 11);
    mouse('mousedown', search);
    search.focus();
    press('c', 'o', 'p', 'y');
    check(search.value === 'copy', 'the keys type into the search box once it is clicked: ' + search.value);
    const top = root.querySelector('.act');
    check(top && top.dataset.id === 'copy' && top.classList.contains('first'), 'and the best match comes first');
    el('notes').value = '';
    tap(top);
    await settle();
    check(doc.activeElement === name && name.selectionStart === 6 && name.selectionEnd === 11,
      'choosing an action puts the user back where they were on the page, selection and all');
    el('notes').focus();
    press('Ctrl', 'v');
    tap(root.querySelector('.doit'));
    await settle();
    check(el('notes').value === 'world', 'so Copy copied what was selected there, not the search box: ' + el('notes').value);

    search.value = 'close this tab';
    search.dispatchEvent(new window.Event('input'));
    const closer = root.querySelector('.act');
    sent.length = 0;
    tap(closer);
    await settle();
    check(sent.length === 0 && closer.classList.contains('armed') && /Click again/.test(closer.textContent),
      'Close this tab asks for a second click first');
    tap(closer);
    await settle();
    check(sent.length === 1 && sent[0].op === 'closeTab', 'and closes on the second');

    search.value = 'xyzzy';
    search.dispatchEvent(new window.Event('input'));
    check(/Nothing matches/.test(root.querySelector('.results').textContent), 'no match says so, with a hint');
    tap(Array.from(root.querySelectorAll('.tool')).find(b => b.textContent === 'Shortcuts'));
    check(panel.hidden, 'Shortcuts again closes the list');
  }

  // ── Size, place and Hide ──
  {
    const before = storage.accessiflow_keyboard ? storage.accessiflow_keyboard.w : board._geo.w;
    tap(Array.from(root.querySelectorAll('.tool')).find(b => b.textContent === 'A+'));
    await wait(450);
    const saved = storage.accessiflow_keyboard;
    check(saved && saved.w > before, 'A+ makes it bigger, and the size is remembered: ' + before + ' to ' + (saved && saved.w));

    // Picked up with one click and put down with another.
    const grip = root.querySelector('.grip');
    const x0 = board._geo.x;
    pointer('pointerdown', grip, 100, 700);
    pointer('pointerup', grip, 100, 700);
    check(/Move the pointer/.test(status()), 'a click on the handle picks it up, and says what to do next');
    pointer('pointermove', doc.documentElement, 60, 700);
    const drop = pointer('pointerdown', doc.documentElement, 60, 700);
    pointer('pointerup', doc.documentElement, 60, 700);
    const dropClick = mouse('click', para, 60, 700);
    check(board._geo.x === Math.max(0, x0 - 40) && drop.defaultPrevented && dropClick.defaultPrevented,
      'it follows the pointer, and the click that puts it down does not reach the page');

    tap(Array.from(root.querySelectorAll('.tool')).find(b => b.textContent === 'Hide'));
    check(hidden === 1, 'Hide asks for the setting to go off, so it stays hidden on the next page too');
  }

  // ── With other motor settings on ──
  {
    const motor = new window.MotorModule();
    motor.applyTremorFilter(true, 300);
    name.value = '';
    name.focus();
    press('a', 'b');
    check(name.value === 'ab',
      'Steady my clicks tells two different keys apart, rather than taking the second for a shake: "' + name.value + '"');
    press('b');
    check(name.value === 'ab', 'and still catches the same key pressed twice in a shake');
    motor.destroy();

    // Click by hovering, resting on a key.
    const target = keys('q')[0];
    const realFromPoint = doc.elementFromPoint;
    doc.elementFromPoint = () => host;
    root.elementFromPoint = () => target;
    motor.applyDwellClick(true, 400);
    name.focus();
    doc.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 300, clientY: 700 }));
    await wait(480);
    check(name.value === 'abq', 'Click by hovering presses the key it rests on: "' + name.value + '"');
    check(doc.activeElement === name, 'without pulling focus out of the box being typed in');
    motor.destroy();
    doc.elementFromPoint = realFromPoint;
  }

  board.destroy();
  check(!doc.getElementById('accessiflow-keyboard'), 'destroy leaves no keyboard behind');

  await backgroundTests();
  finish();
})().catch(err => { errors.push('threw: ' + err.stack); finish(); });

// ══ The service worker ═══════════════════════════════════════════════════════
async function backgroundTests() {
  let listener = null;
  const tabs = [{ id: 1, index: 0, windowId: 9 }, { id: 2, index: 1, windowId: 9 }, { id: 3, index: 2, windowId: 9 }];
  const calls = { active: [], created: [], removed: [], zoom: [], windows: 0 };
  let zoomNow = 1;
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener: fn => { listener = fn; } },
      onInstalled: { addListener() {} },
      getContexts: async () => [],
      sendMessage: async () => undefined
    },
    commands: { onCommand: { addListener() {} } },
    tabs: {
      query: async q => tabs.filter(t => t.windowId === q.windowId),
      update: async (id, props) => { calls.active.push(id); return props; },
      create: async props => { calls.created.push(props); },
      remove: async id => { calls.removed.push(id); },
      getZoom: async () => zoomNow,
      setZoom: async (id, z) => { calls.zoom.push(z); zoomNow = z || 1; },
      captureVisibleTab: async (windowId, opts) => 'data:image/' + opts.format + ';base64,AAAA',
      sendMessage() {}
    },
    windows: { create: async () => { calls.windows++; } },
    storage: {
      local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() },
      session: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() }
    }
  };
  const sandbox = {
    chrome: chrome, console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, URL, Promise, JSON, Math, Date, Object, Array, String,
    fetch: async () => { throw new Error('no network in this test'); },
    Response, Headers, Request, crypto: require('crypto').webcrypto, TextEncoder
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.importScripts = (...files) => files.forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox));
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), sandbox);

  const ask = (op, tab) => new Promise(resolve => {
    if (listener({ action: 'handTab', op: op }, tab ? { tab: tab } : {}, resolve) !== true) {
      // Answered synchronously.
    }
  });

  let reply = await ask('nextTab', tabs[2]);
  check(reply.ok && calls.active.pop() === 1, 'Next tab from the last tab wraps round to the first');
  reply = await ask('prevTab', tabs[0]);
  check(reply.ok && calls.active.pop() === 3, 'Previous tab from the first wraps round to the last');
  tabs.length = 1;
  reply = await ask('nextTab', tabs[0]);
  check(!reply.ok && /only tab/.test(reply.message), 'with one tab, it says so instead of doing nothing');

  reply = await ask('zoomIn', tabs[0]);
  check(calls.zoom.pop() === 1.1 && /110%/.test(reply.message), 'Zoom in takes Chrome’s next step: ' + reply.message);
  zoomNow = 1;
  await ask('zoomOut', tabs[0]);
  check(calls.zoom.pop() === 0.9, 'Zoom out takes the step below');
  await ask('zoomReset', tabs[0]);
  check(calls.zoom.pop() === 0, 'Normal size goes back to the user’s own default zoom');

  reply = await ask('screenshot', tabs[0]);
  check(reply.ok && /^data:image\/png/.test(reply.image), 'a screenshot comes back to the page as a picture');
  await ask('history', tabs[0]);
  check(calls.created.pop().url === 'chrome://history/', 'History opens Chrome’s history page');
  await ask('closeTab', tabs[0]);
  check(calls.removed.pop() === tabs[0].id, 'Close this tab closes the tab that asked, and only that one');

  reply = await ask('closeTab', null);
  check(reply && !reply.ok && calls.removed.length === 0,
    'a message from anywhere but a page is refused, so nothing can close a tab without one');
}

function finish() {
  console.log('\n=== PASS (' + ok.length + ') ===');
  ok.forEach(m => console.log('  + ' + m));
  if (errors.length) {
    console.log('\n=== FAIL (' + errors.length + ') ===');
    errors.forEach(m => console.log('  ! ' + m));
    process.exit(1);
  }
  console.log('\nAll checks passed.');
  process.exit(0);
}
