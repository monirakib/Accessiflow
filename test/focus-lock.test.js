// Keyboard focus lock, under jsdom.
//
// Two things have to be true at once, and they pull against each other: the
// keyboard must be held inside a real dialog, and it must NOT be held inside
// something that merely looks like one. A tool that locks the user into a
// cookie strip is worse than one that does nothing, so the false-positive
// cases are tested as carefully as the true ones.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

const PAGE = `<!DOCTYPE html><html lang="en"><body>
  <header id="site-header"><a id="home" href="/">Home</a></header>
  <main id="content">
    <h1>Account</h1>
    <button id="opener">Delete account</button>
    <a id="help" href="/help">Help</a>
  </main>
  <footer id="site-footer"><a id="terms" href="/terms">Terms</a></footer>
  <div id="accessiflow-shortcut-announce"></div>
</body></html>`;

const dom = new JSDOM(PAGE, { runScripts: 'outside-only', url: 'https://example.com/account' });
const { window } = dom;
const doc = window.document;
window.console.log = () => {};
window.console.warn = () => {};

// jsdom does no layout. Size things by what the test needs each one to be:
// a dialog is a big centred box, the cookie strip is a short wide band.
const RECTS = {
  'the-dialog': { top: 100, left: 300, width: 400, height: 300 },
  'cookie-strip': { top: 700, left: 0, width: 1024, height: 90 },
  'tiny-popover': { top: 100, left: 20, width: 180, height: 80 },
  'undeclared-modal': { top: 80, left: 262, width: 500, height: 400 }
};
window.Element.prototype.getBoundingClientRect = function () {
  const r = RECTS[this.id] || { top: 0, left: 0, width: 200, height: 40 };
  return Object.assign({}, r, { right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top });
};
Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });

for (const f of ['modules/focus-lock.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const el = id => doc.getElementById(id);
const settle = ms => new Promise(r => setTimeout(r, ms === undefined ? 220 : ms));

// inert is reflected by newer jsdom and not by older; the module has a
// fallback, so the test accepts either signal.
const isInert = node =>
  node.hasAttribute('inert') ||
  node.getAttribute('data-accessiflow-inert-fallback') === 'true';

const backgroundIds = ['site-header', 'content', 'site-footer'];

(async () => {
  const lock = new window.FocusLockModule();
  const pristine = doc.body.innerHTML;

  lock.apply({ focusLock: true });

  // ── A dialog opens the way most sites open one: a div, no focus moved ─────
  el('opener').focus();
  check(doc.activeElement === el('opener'), 'the keyboard starts on the button that opens the dialog');

  const dialog = doc.createElement('div');
  dialog.id = 'the-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.innerHTML = '<h2>Are you sure?</h2>' +
    '<button id="confirm">Yes, delete it</button>' +
    '<button id="cancel">Cancel</button>';
  doc.body.appendChild(dialog);

  await settle();

  check(lock.isLocked, 'the dialog was detected and locked into');
  check(doc.activeElement === el('confirm'),
    'the keyboard was moved to the first control inside the dialog, which the page failed to do');

  const inerted = backgroundIds.filter(id => isInert(el(id)));
  check(inerted.length === backgroundIds.length,
    'everything behind the dialog is inert, so Tab cannot walk into it: ' + inerted.join(', '));
  check(!isInert(dialog), 'the dialog itself is not inert');
  check(!isInert(el('accessiflow-shortcut-announce')),
    'the extension never makes its own live region inert, or it would stop announcing');

  check(dialog.getAttribute('aria-modal') === 'true',
    'aria-modal is added, so a screen reader announces it as a dialog');
  check(dialog.getAttribute('aria-labelledby') !== null,
    'the dialog is named from its own heading rather than left anonymous');
  const labelId = dialog.getAttribute('aria-labelledby');
  check(labelId && doc.getElementById(labelId) &&
    doc.getElementById(labelId).textContent === 'Are you sure?',
    'the name points at the real heading text: "' +
    (labelId && doc.getElementById(labelId) ? doc.getElementById(labelId).textContent : 'none') + '"');

  // ── The dialog closes ────────────────────────────────────────────────────
  dialog.remove();
  await settle(60);

  check(!lock.isLocked, 'removing the dialog releases the lock');
  check(backgroundIds.every(id => !isInert(el(id))),
    'every inert attribute is taken back off, so the page is usable again');
  check(doc.activeElement === el('opener'),
    'the keyboard goes back to the button that opened the dialog, not to the top of the page');

  // ── A dialog that already handles its own focus ──────────────────────────
  el('help').focus();
  const polite = doc.createElement('div');
  polite.id = 'the-dialog';
  polite.setAttribute('role', 'dialog');
  polite.innerHTML = '<h2>Notice</h2><button id="first">First</button><button id="second">Second</button>';
  doc.body.appendChild(polite);
  el('second').focus();              // the page places focus itself, deliberately not on the first control

  await settle();

  check(lock.isLocked, 'a well-built dialog is still protected from Tab escaping');
  check(doc.activeElement === el('second'),
    'but its own focus choice is left alone rather than being overridden');
  polite.remove();
  await settle(60);

  // ── Things that must NOT be locked into ──────────────────────────────────
  const cookie = doc.createElement('div');
  cookie.id = 'cookie-strip';
  cookie.style.cssText = 'position: fixed; z-index: 9999';
  cookie.innerHTML = '<p>We use cookies.</p><button id="accept">Accept</button>';
  doc.body.appendChild(cookie);
  await settle();
  check(!lock.isLocked,
    'a wide short cookie strip at the bottom of the page is not treated as a dialog');
  cookie.remove();

  const tiny = doc.createElement('div');
  tiny.id = 'tiny-popover';
  tiny.className = 'popup';
  tiny.style.cssText = 'position: absolute; z-index: 500';
  tiny.innerHTML = '<button id="pick">Pick</button>';
  doc.body.appendChild(tiny);
  await settle();
  check(!lock.isLocked, 'a small popover is too small to be a modal dialog');
  tiny.remove();

  const backdrop = doc.createElement('div');
  backdrop.id = 'the-dialog';
  backdrop.setAttribute('role', 'dialog');
  backdrop.innerHTML = '<p>Loading...</p>';      // nothing focusable
  doc.body.appendChild(backdrop);
  await settle();
  check(!lock.isLocked,
    'a dialog with nothing focusable in it is not locked into, because there would be no way out');
  // ...but once its content arrives, it is picked up. Dialogs that render a
  // spinner first and their buttons a moment later are common.
  const laterButton = doc.createElement('button');
  laterButton.id = 'retry';
  laterButton.textContent = 'Retry';
  backdrop.appendChild(laterButton);
  await settle();
  check(lock.isLocked,
    'the same dialog is locked into once it has something focusable in it');
  check(doc.activeElement === el('retry'),
    'and the keyboard lands on the control that just appeared');
  backdrop.remove();
  await settle(60);

  // ── An undeclared div that really is a modal ─────────────────────────────
  el('opener').focus();
  const undeclared = doc.createElement('div');
  undeclared.id = 'undeclared-modal';
  undeclared.className = 'c-modal__panel';       // no role, no aria-modal
  undeclared.style.cssText = 'position: fixed; z-index: 1000';
  undeclared.innerHTML = '<h2>Subscribe</h2><input id="email"><button id="go">Go</button>';
  doc.body.appendChild(undeclared);
  await settle();

  check(lock.isLocked,
    'a plain div with no ARIA at all is recognised as a modal from how it behaves');
  check(undeclared.getAttribute('role') === 'dialog',
    'it is given role=dialog, which is what makes a screen reader treat it as one');
  check(doc.activeElement === el('email'), 'the keyboard is placed in its first field');

  // ── Alt+Shift+U, for when the guess was wrong ────────────────────────────
  const released = lock.release();
  check(released === 'div', 'release() reports what it let go of');
  check(!lock.isLocked, 'the lock is gone after the user asks to be let out');
  check(backgroundIds.every(id => !isInert(el(id))), 'the page is fully usable again');
  check(undeclared.getAttribute('role') === null,
    'the role we added is taken back off, leaving the page markup as we found it');

  // Once released, the same element must not immediately grab the keyboard
  // back, or Alt+Shift+U would do nothing the user can perceive.
  undeclared.style.cssText = 'position: fixed; z-index: 1001';
  await settle();
  check(!lock.isLocked, 'a released dialog is not re-locked while it stays on screen');
  undeclared.remove();
  await settle(60);

  // ── Off means off ────────────────────────────────────────────────────────
  const late = doc.createElement('div');
  late.id = 'the-dialog';
  late.setAttribute('role', 'dialog');
  late.innerHTML = '<h2>Hello</h2><button id="ok">OK</button>';

  lock.apply({ focusLock: false });
  doc.body.appendChild(late);
  await settle();
  check(!lock.isLocked, 'with the setting off, a dialog opening is ignored');
  late.remove();

  lock.destroy();
  await settle(60);
  check(doc.body.innerHTML === pristine,
    'after destroy the DOM is byte-identical to how it started');

  finish();
})().catch(err => {
  errors.push('threw: ' + err.stack);
  finish();
});

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
