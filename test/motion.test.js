// The micro-animation interceptor, and the page-world hook it drives.
//
// page-hook.js is the only AccessiFlow code that runs in the page's own
// JavaScript world, replacing globals the site itself depends on. If it gets
// this wrong it does not degrade an accessibility feature, it breaks the
// website. So the property under test is not only "does it stop the movement"
// but "does turning it off put everything back exactly as it was".
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

const PAGE = `<!DOCTYPE html><html lang="en"><body>
  <main>
    <p id="ticker">100.00</p>
    <p id="prose">Ordinary text that does not change.</p>
    <div id="status" role="status">Saved</div>
    <div aria-live="polite"><span id="live">3 new messages</span></div>
    <input id="typed" value="">
    <canvas id="scene" width="200" height="100"></canvas>
  </main>
</body></html>`;

const dom = new JSDOM(PAGE, {
  runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/prices'
});
const { window } = dom;
const doc = window.document;
window.console.log = () => {};
window.console.warn = () => {};
window.chrome = { runtime: { getURL: p => 'chrome-extension://test/' + p } };

const settle = ms => new Promise(r => setTimeout(r, ms === undefined ? 60 : ms));
const el = id => doc.getElementById(id);

// ── The page hook, on its own ───────────────────────────────────────────────
//
// Run directly in the jsdom window, which is what the page world is here.
{
  const nativeRaf = window.requestAnimationFrame;
  const nativeScrollTo = window.scrollTo;

  // jsdom has no canvas 2D context, so stand in a prototype with the same
  // method names. The hook only cares that drawing calls pass through it.
  window.CanvasRenderingContext2D = function () {};
  window.CanvasRenderingContext2D.prototype.fillRect = function () { this._painted = true; };
  const nativeFillRect = window.CanvasRenderingContext2D.prototype.fillRect;

  // Installed before the hook loads, because the hook captures the originals
  // at load time and always calls those. That is the behaviour we want (a page
  // wrapping a global afterwards cannot confuse it), so to observe what it
  // passes through, the recorder has to be the original.
  let sawBehavior = 'never called';
  window.Element.prototype.scrollIntoView = function (options) {
    sawBehavior = options && options.behavior;
  };

  window.eval(fs.readFileSync(path.join(ROOT, 'page-hook.js'), 'utf8'));
  const hook = window.__accessiflowHook;

  check(typeof hook === 'object', 'the hook installs itself');
  check(window.requestAnimationFrame === nativeRaf,
    'and patches nothing at all until it is asked to, so a user who never turns this on never has it in their pages');

  hook.freeze({ canvas: true, scroll: true });
  check(window.requestAnimationFrame !== nativeRaf, 'freeze installs the patch');
  check(window.scrollTo !== nativeScrollTo, 'including the smooth-scroll override');

  // Smooth scrolling forced to instant. A stylesheet cannot do this, because a
  // behavior passed in JavaScript wins over `scroll-behavior: auto`.
  el('prose').scrollIntoView({ behavior: 'smooth', block: 'center' });
  check(sawBehavior === 'auto',
    'a smooth scroll requested in JavaScript arrives as an instant one: behavior was "' +
    sawBehavior + '"');

  // A loop that paints a canvas gets stopped; one that does not is left alone.
  const context = new window.CanvasRenderingContext2D();
  let painterRuns = 0;
  let workerRuns = 0;

  const painter = function () {
    painterRuns++;
    context.fillRect(0, 0, 10, 10);       // marks this callback as a canvas animator
    window.requestAnimationFrame(painter);
  };
  const worker = function () {
    workerRuns++;
    window.requestAnimationFrame(worker);
  };

  window.requestAnimationFrame(painter);
  window.requestAnimationFrame(worker);

  (async () => {
    await settle(120);

    check(painterRuns >= 1, 'the canvas loop runs at least once, which is how it is identified');
    const painterAtFreeze = painterRuns;
    const workerAtFreeze = workerRuns;
    await settle(120);

    check(painterRuns === painterAtFreeze,
      'the canvas loop stops once it has been recognised: ' + painterRuns + ' frames then nothing');
    check(workerRuns > workerAtFreeze,
      'a loop that never paints a canvas keeps running, so layout and input code is untouched: ' +
      workerRuns + ' frames');
    check(hook.stalled >= 1, 'the stopped loop is kept so it can be restarted');

    // Thaw has to put the page back exactly, and restart what it stopped.
    const beforeThaw = painterRuns;
    hook.thaw();
    check(window.requestAnimationFrame === nativeRaf, 'thaw restores the original requestAnimationFrame');
    check(window.scrollTo === nativeScrollTo, 'and the original scrollTo');
    check(window.CanvasRenderingContext2D.prototype.fillRect === nativeFillRect,
      'and every drawing method it instrumented');

    await settle(120);
    check(painterRuns > beforeThaw,
      'the animation the hook stopped starts again, rather than staying dead until the page is reloaded: ' +
      beforeThaw + ' frames to ' + painterRuns);

    await interceptorTests();
  })();
}

// ── The interceptor in the content script ───────────────────────────────────
async function interceptorTests() {
  for (const f of ['modules/color.js', 'modules/overlay.js', 'modules/naming.js',
    'modules/motor.js', 'modules/seizure.js']) {
    window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  }

  const seizure = new window.SeizureModule();
  const pristine = el('prose').textContent;

  seizure.applyMotionInterceptor(true, { motionInterceptor: true });

  // A ticker rewriting itself several times a second gets pinned.
  for (let i = 0; i < 5; i++) {
    el('ticker').textContent = (100 + i).toFixed(2);
    await settle(10);
  }
  await settle(80);

  check(el('ticker').hasAttribute('data-accessiflow-frozen-ticker'),
    'text that rewrites itself several times a second is recognised as a ticker');

  const pinned = el('ticker').textContent;
  el('ticker').textContent = '999.99';
  await settle(60);
  check(el('ticker').textContent === pinned,
    'and is held at its value even though the page keeps writing to it: still ' + el('ticker').textContent);

  // A live region must never be frozen: announcing changes is its whole job,
  // and pinning it would silence a screen reader.
  for (let i = 0; i < 6; i++) { el('live').textContent = i + ' new messages'; await settle(10); }
  await settle(80);
  check(!el('live').hasAttribute('data-accessiflow-frozen-ticker'),
    'a live region is never frozen, because pinning it would silence the announcements it exists for');

  for (let i = 0; i < 6; i++) { el('status').textContent = 'Saving ' + i; await settle(10); }
  await settle(80);
  check(!el('status').hasAttribute('data-accessiflow-frozen-ticker'),
    'role=status is left alone for the same reason');

  check(el('prose').textContent === pristine,
    'text that never changes is untouched');

  // Off puts everything back.
  seizure.applyMotionInterceptor(false);
  await settle(60);
  check(!el('ticker').hasAttribute('data-accessiflow-frozen-ticker'),
    'switching off releases the ticker');
  el('ticker').textContent = '123.45';
  await settle(60);
  check(el('ticker').textContent === '123.45',
    'and the page can write to it freely again');

  check(doc.querySelectorAll('[data-accessiflow-frozen-ticker]').length === 0,
    'no marker attributes are left behind anywhere');

  // ── The animation-play-state fix ──────────────────────────────────────────
  {
    // Checked against what is actually emitted, not against the source text,
    // which still mentions the old property in a comment explaining why it went.
    const emitted = new window.MotorModule().buildCSS({ stopAnimations: true });
    check(emitted.indexOf('animation-play-state') === -1,
      'Stop animations no longer emits animation-play-state, which froze fade-ins at opacity 0 for good');
    check(/animation-duration:\s*0\.001ms/.test(emitted),
      'it collapses the duration instead, so animations jump to their finished state');
  }

  finish();
}

function finish() {
  // pretendToBeVisual keeps a requestAnimationFrame loop running for the life
  // of the window, so node never sees the event loop drain. Without this the
  // test passes and then hangs forever.
  try { dom.window.close(); } catch (e) { /* already gone */ }

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
