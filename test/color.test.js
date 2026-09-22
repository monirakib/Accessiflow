// Checks the colour maths that Smart Dark Mode, the focus halo and the WCAG
// audit all sit on. These are pure functions with no DOM, so they can be
// checked against the published WCAG reference pairs rather than by eye.
//
// The fuzz check near the end is the one that matters: dark mode is only worth
// shipping if adjustToContrast is guaranteed to reach the ratio it promises.
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

require(path.join(ROOT, 'modules/color.js'));
const C = globalThis.ACCESSIFLOW_COLOR;

const near = (got, want, tol) => Math.abs(got - want) <= (tol === undefined ? 0.01 : tol);
const r2 = n => Math.round(n * 100) / 100;

// ── Contrast, against the WCAG 2.2 worked examples ──────────────────────────
check(near(C.contrastRatio('#000000', '#ffffff'), 21, 0.001),
  'black on white is 21:1');
check(near(C.contrastRatio('#ffffff', '#ffffff'), 1, 0.001),
  'a colour against itself is 1:1');
check(near(C.contrastRatio('#767676', '#ffffff'), 4.54),
  '#767676 on white sits just over the 4.5:1 AA line: ' + r2(C.contrastRatio('#767676', '#ffffff')));
check(near(C.contrastRatio('#949494', '#ffffff'), 3.03),
  '#949494 on white sits just over the 3:1 large-text line');
check(near(C.contrastRatio('#595959', '#ffffff'), 7.0, 0.02),
  '#595959 on white sits on the 7:1 AAA line');
check(near(C.contrastRatio('#0000FF', '#ffffff'), 8.59),
  'pure blue on white is 8.59:1');
check(Math.abs(C.contrastRatio('#123456', '#abcdef') - C.contrastRatio('#abcdef', '#123456')) < 1e-9,
  'contrast is symmetric, whichever way round the arguments go');

// ── Parsing: every syntax for one colour must agree ─────────────────────────
const forms = ['#4fffb0', '#4FFFB0', 'rgb(79, 255, 176)', 'rgb(79 255 176)',
  'rgba(79,255,176,1)', 'rgb(79 255 176 / 100%)'];
const lums = forms.map(f => C.relativeLuminance(f));
check(Math.max.apply(null, lums) - Math.min.apply(null, lums) < 1e-9,
  'hex, rgb(), rgba() and the slash-alpha form all parse to the same colour');
check(C.parseColor('#abc').r === 170 && C.parseColor('#abc').b === 204,
  'three-digit hex expands correctly');
check(C.parseColor('transparent').a === 0, 'transparent parses with zero alpha');
check(C.isTransparent('rgba(0,0,0,0)') && C.isTransparent('transparent'),
  'a see-through colour is recognised, so the engine knows to look at the ancestor');
check(!C.isTransparent('#000000'), 'an opaque colour is not mistaken for transparent');
check(C.parseColor('not-a-colour') === null && C.parseColor('') === null,
  'nonsense parses to null rather than to black');

// ── Alpha compositing ───────────────────────────────────────────────────────
check(C.toHex(C.blend('rgba(0,0,0,0.5)', '#ffffff')) === '#808080',
  'half-opaque black over white composites to mid grey');
check(C.toHex(C.blend('#123456', '#ffffff')) === '#123456',
  'an opaque colour ignores whatever is behind it');

// ── The large-text rule (WCAG 1.4.3 / 1.4.6) ────────────────────────────────
check(C.requiredRatio(16, 400) === 4.5, 'normal text needs 4.5:1 at AA');
check(C.requiredRatio(24, 400) === 3, '24px counts as large text and needs 3:1');
check(C.requiredRatio(18.66, 700) === 3, '18.66px bold counts as large text');
check(C.requiredRatio(18.66, 400) === 4.5, '18.66px regular does not count as large');
check(C.requiredRatio(16, 400, 7) === 7, 'AAA raises normal text to 7:1');
check(C.requiredRatio(24, 400, 7) === 4.5, 'AAA drops large text to 4.5:1');
check(C.requiredRatio(20, 'bold') === 3, 'a keyword font-weight is understood, not just a number');

// ── OKLCH round trip ────────────────────────────────────────────────────────
const trips = ['#4fffb0', '#0000ee', '#767676', '#ff8800', '#123456', '#ffffff', '#000000'];
const badTrip = trips.filter(hex => C.toHex(C.fromOKLCH(C.toOKLCH(hex))) !== hex);
check(badTrip.length === 0,
  'sRGB survives a round trip through OKLCH unchanged' + (badTrip.length ? ': ' + badTrip.join(', ') : ''));

// Hue must hold when lightness moves. This is the whole reason for using OKLCH
// rather than HSL: darkening in HSL visibly shifts blues towards purple.
const blueHue = C.toOKLCH('#2266cc').H;
const darkened = C.mapLightness('#2266cc', 0.14, 0.36, true);
check(Math.abs(C.toOKLCH(darkened).H - blueHue) < 1.5,
  'lightness can be remapped without the hue drifting: ' +
  r2(blueHue) + ' to ' + r2(C.toOKLCH(darkened).H));

// Distinct backgrounds must stay distinct after the flip, or every card,
// table stripe and input box merges into one flat rectangle.
const bgA = C.mapLightness('#ffffff', 0.14, 0.36, true);
const bgB = C.mapLightness('#eeeeee', 0.14, 0.36, true);
check(C.toHex(bgA) !== C.toHex(bgB),
  'two near-identical light backgrounds stay different after the dark flip');

// ── adjustToContrast: the property dark mode depends on ─────────────────────
const untouched = C.adjustToContrast('#000000', '#ffffff', 4.5);
check(untouched.r === 0 && untouched.g === 0 && untouched.b === 0,
  'a colour that already passes is returned unchanged, so pages keep their own palette');

const lifted = C.adjustToContrast('#777777', '#808080', 4.5);
check(C.contrastRatio(lifted, '#808080') >= 4.48,
  'unreadable grey-on-grey is pushed until it passes: ' + r2(C.contrastRatio(lifted, '#808080')) + ' to 1');

const onBlack = C.adjustToContrast('#222222', '#000000', 4.5);
check(C.relativeLuminance(onBlack) > C.relativeLuminance('#222222'),
  'on a dark background the fix goes lighter, not darker');
const onWhite = C.adjustToContrast('#dddddd', '#ffffff', 4.5);
check(C.relativeLuminance(onWhite) < C.relativeLuminance('#dddddd'),
  'on a light background the fix goes darker, not lighter');

// Smallest sufficient change: the result should land near the target, not
// slam to pure white or black, or the page stops looking like itself.
const gentle = C.adjustToContrast('#8a8a8a', '#ffffff', 4.5);
check(C.contrastRatio(gentle, '#ffffff') < 6,
  'the fix stops as soon as it passes rather than overshooting to black: ' +
  r2(C.contrastRatio(gentle, '#ffffff')));

// The fuzz run. Random foreground on random background.
let misses = 0;
let worst = Infinity;
const TRIALS = 20000;
const rnd = () => Math.floor(Math.random() * 256);
for (let i = 0; i < TRIALS; i++) {
  const bg = { r: rnd(), g: rnd(), b: rnd(), a: 1 };
  const fg = { r: rnd(), g: rnd(), b: rnd(), a: 1 };
  const out = C.adjustToContrast(fg, bg, 4.5);
  const got = C.contrastRatio(out, bg);
  if (got < 4.495) {
    // Some backgrounds are mid-grey enough that no colour reaches 4.5:1.
    // Taking the best available is correct; falling short of it is not.
    const ceiling = Math.max(C.contrastRatio('#ffffff', bg), C.contrastRatio('#000000', bg));
    if (ceiling >= 4.5) { misses++; worst = Math.min(worst, got); }
  }
}
check(misses === 0,
  TRIALS + ' random colour pairs all reached 4.5:1 where it was reachable' +
  (misses ? ', ' + misses + ' missed, worst ' + r2(worst) : ''));

// AAA must hold too, since the setting offers it.
let aaaMisses = 0;
for (let i = 0; i < 20000; i++) {
  const bg = { r: rnd(), g: rnd(), b: rnd(), a: 1 };
  const out = C.adjustToContrast({ r: rnd(), g: rnd(), b: rnd(), a: 1 }, bg, 7);
  const ceiling = Math.max(C.contrastRatio('#ffffff', bg), C.contrastRatio('#000000', bg));
  if (C.contrastRatio(out, bg) < 6.995 && ceiling >= 7) aaaMisses++;
}
check(aaaMisses === 0, '20000 random pairs reached the stricter 7:1 AAA target where reachable');

// A colour is always returned, even when the target is impossible.
const impossible = C.adjustToContrast('#808080', '#808080', 21);
check(impossible && typeof impossible.r === 'number',
  'an unreachable target still returns the best available colour rather than nothing');

// ── Gamut ───────────────────────────────────────────────────────────────────
const wild = C.fromOKLCH(C.gamutMap({ L: 0.5, C: 0.9, H: 250, a: 1 }));
check(wild.r >= 0 && wild.r <= 255 && wild.g >= 0 && wild.g <= 255 && wild.b >= 0 && wild.b <= 255,
  'an impossible chroma is desaturated back into sRGB instead of clipping channels');

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
