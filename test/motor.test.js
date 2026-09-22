// The pointer and keyboard features in MotorModule: the focus halo, click
// snapping, tremor filtering and the pointer smoothing behind them.
//
// Click snapping is the one worth being careful about. It redirects a click to
// somewhere the user did not press, which is exactly the kind of help that
// becomes sabotage if it fires when it should not. The cases where it must
// stay out of the way are tested at least as hard as the cases where it acts.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

const PAGE = `<!DOCTYPE html><html lang="en"><body style="background-color:#ffffff">
  <main>
    <button id="save">Save</button>
    <button id="cancel">Cancel</button>
    <a id="docs" href="/docs">Documentation</a>
    <input id="agree" type="checkbox">
    <input id="name" type="text">
    <input id="volume" type="range">
    <select id="country"><option>UK</option></select>
    <textarea id="notes"></textarea>
    <button id="shortcut" accesskey="s">Quick save</button>
    <p id="prose">Just some text, nothing to click.</p>
    <div id="far-away"><button id="remote">Remote</button></div>
  </main>
</body></html>`;

// Laid out so the geometry under test is explicit. #save sits at x 100-160;
// a press at x=170 is 10px past its edge, inside the default 28px radius.
// #remote is far from everything, so it must never be snapped to.
const RECTS = {
  save: { top: 100, left: 100, width: 60, height: 30 },
  cancel: { top: 100, left: 300, width: 60, height: 30 },
  docs: { top: 200, left: 100, width: 400, height: 20 },
  agree: { top: 260, left: 100, width: 16, height: 16 },
  name: { top: 300, left: 100, width: 200, height: 24 },
  volume: { top: 340, left: 100, width: 200, height: 20 },
  country: { top: 380, left: 100, width: 120, height: 24 },
  notes: { top: 420, left: 100, width: 200, height: 80 },
  shortcut: { top: 520, left: 100, width: 100, height: 30 },
  prose: { top: 600, left: 100, width: 400, height: 20 },
  remote: { top: 900, left: 900, width: 60, height: 30 }
};

const dom = new JSDOM(PAGE, { runScripts: 'outside-only', url: 'https://example.com/form' });
const { window } = dom;
const doc = window.document;
window.console.log = () => {};
window.console.warn = () => {};

window.Element.prototype.getBoundingClientRect = function () {
  const r = RECTS[this.id] || { top: 0, left: 0, width: 200, height: 40 };
  return Object.assign({}, r, { right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top });
};
Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
window.requestAnimationFrame = fn => setTimeout(() => fn(Date.now()), 0);
window.cancelAnimationFrame = id => clearTimeout(id);
window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });

for (const f of ['modules/color.js', 'modules/overlay.js', 'modules/naming.js', 'modules/motor.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const el = id => doc.getElementById(id);
const motor = new window.MotorModule();

// ── The activation hint: what to press, per kind of control ─────────────────
const hintFor = id => motor._activationHint(el(id));
check(/Enter/.test(hintFor('docs')), 'a link says Enter: ' + hintFor('docs'));
check(/Enter or Space/.test(hintFor('save')), 'a button says Enter or Space: ' + hintFor('save'));
check(/Space/.test(hintFor('agree')), 'a checkbox says Space: ' + hintFor('agree'));
check(/Arrow keys/.test(hintFor('volume')), 'a slider says Arrow keys: ' + hintFor('volume'));
check(/Arrow keys/.test(hintFor('country')), 'a select says Arrow keys: ' + hintFor('country'));
check(/Type here/.test(hintFor('notes')), 'a textarea says Type here: ' + hintFor('notes'));
check(/Alt\+S/.test(hintFor('shortcut')),
  'an accesskey is surfaced, which almost nothing else does: ' + hintFor('shortcut'));
check(/Save/.test(hintFor('save')),
  'the hint names the control as well as the key, using the same accessible name that gets spoken');

// ── The halo colour adapts to the page ──────────────────────────────────────
const C = window.ACCESSIFLOW_COLOR;
{
  const colour = motor._haloColour(el('save'));
  check(C.contrastRatio(colour.ring, '#ffffff') >= 3,
    'on a white page the ring is chosen to stand out from white: ' + colour.ring +
    ' at ' + Math.round(C.contrastRatio(colour.ring, '#ffffff') * 100) / 100 + ':1');
  check(C.contrastRatio(colour.ring, colour.text) >= 4.5,
    'the tooltip text is readable on the ring colour behind it');
}

// ── The halo itself ─────────────────────────────────────────────────────────
motor.applyFocusHalo(true, { focusHalo: true, focusHaloSize: 4 });
el('save').focus();
{
  const halo = doc.getElementById('accessiflow-focus-halo');
  check(halo !== null, 'a halo element is created');
  check(halo && halo.getAttribute('aria-hidden') === 'true',
    'the halo is aria-hidden, or a screen reader would announce every control twice');
  const style = halo ? halo.getAttribute('style') : '';
  check(/position:\s*fixed/.test(style),
    'the halo is fixed-position, so page overflow and stacking cannot clip it');
  const tip = doc.getElementById('accessiflow-focus-halo-tip');
  check(tip && /Save/.test(tip.textContent),
    'the tooltip names the focused control: ' + (tip ? tip.textContent : 'none'));
}

// Motion has to yield to the settings that ask for less of it.
check(motor._motionOK({}) === true, 'the pulse is allowed by default');
check(motor._motionOK({ reduceMotion: true }) === false,
  'Reduce motion switches the pulse off, because a pulsing ring is itself a trigger');
check(motor._motionOK({ stopAnimations: true }) === false,
  'Stop animations does too');
check(motor.buildCSS({ focusHalo: true, focusHaloPulse: true, reduceMotion: true })
  .indexOf('accessiflow-halo-pulse') === -1,
  'and no pulse keyframes are emitted at all in that case');
check(motor.buildCSS({ focusHalo: true, focusHaloPulse: true })
  .indexOf('@keyframes accessiflow-halo-pulse') !== -1,
  'the keyframes are emitted when motion is welcome');

// The halo supersedes the three older focus rings rather than stacking on them.
check(motor.buildCSS({ enhancedFocus: true, focusHalo: true }).indexOf('*:focus {') === -1,
  'the old outline rule stands down when the halo is on');
check(motor.buildCSS({ enhancedFocus: true }).indexOf('*:focus {') !== -1,
  'and is still there when it is not');

motor.applyFocusHalo(false);
check(doc.getElementById('accessiflow-focus-halo') === null, 'the halo is removed when switched off');

// ── Click snapping: the geometry ────────────────────────────────────────────
motor.applyClickSnapping(true, { clickSnapping: true, clickSnapRadius: 28 });

check(motor._nearestTarget(130, 115) === el('save'),
  'a press inside a button finds that button');
check(motor._nearestTarget(170, 115) === el('save'),
  'a press 10px past its right edge still finds it');
check(motor._nearestTarget(250, 115) === null,
  'a press 90px away finds nothing, rather than dragging the click across the page');
check(motor._nearestTarget(500, 700) === null,
  'empty space finds nothing');

// Edge distance, not centre distance. A press at x=290 is 10px from #cancel's
// left edge but 180px from #docs's centre; #docs is the wider element, so a
// centre-based measure would wrongly prefer it.
check(motor._nearestTarget(290, 112) === el('cancel'),
  'the nearest edge wins, so a wide element does not swallow presses aimed past a small one');

// ── Click snapping: the behaviour ───────────────────────────────────────────
const fire = (target, x, y) => {
  const event = new window.MouseEvent('click', {
    bubbles: true, cancelable: true, clientX: x, clientY: y
  });
  target.dispatchEvent(event);
  return event;
};
const move = (x, y) => {
  doc.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
};

let saveClicks = 0;
el('save').addEventListener('click', () => { saveClicks++; });
let proseClicks = 0;
el('prose').addEventListener('click', () => { proseClicks++; });

// A near miss: the pointer is beside the button, the press lands on the page.
move(170, 115);
const missed = fire(el('prose'), 170, 115);
check(missed.defaultPrevented, 'a near miss is intercepted');
check(saveClicks === 1, 'and is delivered to the button the user was aiming at');
check(proseClicks === 0, 'the paragraph that was actually pressed does not receive it');

// A deliberate press on something else must be left completely alone.
let cancelClicks = 0;
el('cancel').addEventListener('click', () => { cancelClicks++; });
move(330, 115);
const deliberate = fire(el('cancel'), 330, 115);
check(!deliberate.defaultPrevented, 'a press that lands on a real button is not intercepted');
check(cancelClicks === 1, 'and reaches it directly');

// Far from anything, the page behaves exactly as it would without us.
move(500, 700);
const nowhere = fire(el('prose'), 500, 700);
check(!nowhere.defaultPrevented, 'a press in empty space is left alone');
check(proseClicks === 1, 'and still reaches whatever was under it');

motor.applyClickSnapping(false);
check(doc.getElementById('accessiflow-snap-halo') === null, 'the snap halo is removed when switched off');
{
  move(170, 115);
  const after = fire(el('prose'), 170, 115);
  check(!after.defaultPrevented, 'with snapping off, nothing is intercepted any more');
}

// ── The tremor filter ───────────────────────────────────────────────────────
{
  const fresh = new window.MotorModule();
  fresh.applyTremorFilter(true, 300);

  const t0 = Date.now();
  const first = fire(el('save'), 130, 115);
  check(!first.defaultPrevented, 'the first click always gets through');

  const shake = fire(el('save'), 130, 115);
  check(shake.defaultPrevented,
    'a second click on the same control milliseconds later is treated as a shake');

  // Moving to a different control is intent, not tremor. Swallowing it would
  // make the page feel dead to someone whose hand is simply fast.
  const elsewhere = fire(el('cancel'), 330, 115);
  check(!elsewhere.defaultPrevented,
    'but a quick click on a different control is let through');

  void t0;
  fresh.destroy();
  const afterDestroy = fire(el('save'), 130, 115);
  check(!afterDestroy.defaultPrevented, 'destroy removes the filter');
}

// The window is the user's to set; it used to be hardcoded at 300ms.
{
  const fast = new window.MotorModule();
  fast.applyTremorFilter(true, 100);
  fire(el('save'), 130, 115);
  const soon = fire(el('save'), 130, 115);
  check(soon.defaultPrevented, 'a short window still catches an immediate repeat');
  fast.destroy();
}

// ── Pointer smoothing ───────────────────────────────────────────────────────
{
  const fresh = new window.MotorModule();
  // A hand resting at (200, 200) with a few pixels of shake.
  let now = 1000;
  let worstRaw = 0;
  let worstSmoothed = 0;
  for (let i = 0; i < 40; i++) {
    const jitterX = 200 + (i % 2 ? 4 : -4);
    const jitterY = 200 + (i % 3 ? 3 : -3);
    const out = fresh._smoothPoint(jitterX, jitterY, now);
    now += 16;
    if (i > 8) {
      worstRaw = Math.max(worstRaw, Math.abs(jitterX - 200), Math.abs(jitterY - 200));
      worstSmoothed = Math.max(worstSmoothed, Math.abs(out.x - 200), Math.abs(out.y - 200));
    }
  }
  check(worstSmoothed < worstRaw,
    'shake in a resting hand is damped: worst deviation ' + Math.round(worstRaw) +
    'px raw, ' + (Math.round(worstSmoothed * 100) / 100) + 'px smoothed');

  // Deliberate travel must not be dragged behind. A filter that damps
  // everything equally feels like pulling the pointer through treacle.
  let x = 200;
  let last = null;
  for (let i = 0; i < 30; i++) { x += 20; last = fresh._smoothPoint(x, 200, now); now += 16; }
  check(Math.abs(last.x - x) < 20,
    'a fast deliberate move keeps up, trailing by ' + Math.round(Math.abs(last.x - x)) + 'px rather than lagging');
}

// ── Nothing left behind ─────────────────────────────────────────────────────
motor.destroy();
check(doc.getElementById('accessiflow-focus-halo') === null &&
  doc.getElementById('accessiflow-snap-halo') === null &&
  doc.getElementById('accessiflow-focus-halo-tip') === null,
  'destroy leaves none of the overlay elements behind');

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
