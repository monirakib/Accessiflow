// Smart Dark Mode, under jsdom.
//
// The claim this module makes is specific and checkable: after a pass, every
// piece of text it recoloured reaches its WCAG 1.4.3 ratio against the
// background it will really sit on, and nothing whose pixels carry meaning
// was touched. Both are asserted here against the stylesheet it emits.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

// Backgrounds and text colours are set inline so jsdom's computed styles are
// real values rather than empty strings. The pairs are deliberately awful:
// mid-grey on mid-grey is the case a naive inverter leaves unreadable.
const PAGE = `<!DOCTYPE html><html lang="en"><body style="background-color: #ffffff">
  <main style="background-color: #ffffff">
    <h1 style="background-color: #ffffff; color: #111111; font-size: 32px">Quarterly report</h1>
    <p id="body-text" style="background-color: #ffffff; color: #333333; font-size: 16px">Readable dark on white.</p>
    <p id="faint" style="background-color: #ffffff; color: #999999; font-size: 16px">Faint grey, already borderline.</p>
    <p id="awful" style="background-color: #808080; color: #777777; font-size: 16px">Grey on grey, unreadable.</p>
    <div id="card" style="background-color: #f5f5f5; color: #222222; border: 1px solid #dddddd; font-size: 14px">A card</div>
    <div id="brandblue" style="background-color: #2266cc; color: #ffffff; font-size: 16px">Brand blue panel</div>
    <a id="link" href="/x" style="background-color: #ffffff; color: #0000ee; font-size: 16px">A link</a>
    <p class="same" style="background-color: #ffffff; color: #333333; font-size: 16px">Same styling as the body text.</p>
    <p class="same" style="background-color: #ffffff; color: #333333; font-size: 16px">And again.</p>
    <p class="same" style="background-color: #ffffff; color: #333333; font-size: 16px">And a third time.</p>
    <p class="same" style="background-color: #ffffff; color: #333333; font-size: 16px">And a fourth.</p>
    <img id="chart" src="/chart.png" alt="Revenue by quarter">
    <canvas id="plot" width="200" height="100"></canvas>
    <svg id="icon" width="16" height="16"><title>Print</title></svg>
    <div id="hero" style="background-image: url(/hero.jpg); color: #ffffff; font-size: 20px">Hero text</div>
  </main>
</body></html>`;

const dom = new JSDOM(PAGE, { runScripts: 'outside-only', url: 'https://example.com/report' });
const { window } = dom;
const doc = window.document;
window.console.log = () => {};
window.console.warn = () => {};

// jsdom performs no layout, so every rect is 0x0 and the module would skip the
// whole page. Give each element a plausible on-screen box.
window.Element.prototype.getBoundingClientRect = function () {
  return { top: 10, left: 10, right: 210, bottom: 60, width: 200, height: 50, x: 10, y: 10 };
};
window.requestAnimationFrame = fn => setTimeout(() => fn(Date.now()), 0);
window.cancelAnimationFrame = id => clearTimeout(id);

for (const f of ['modules/color.js', 'modules/overlay.js', 'modules/contrast.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const C = window.ACCESSIFLOW_COLOR;
const before = doc.body.innerHTML;

const contrast = new window.ContrastModule();
contrast.apply({ smartDarkMode: true, smartDarkContrast: 4.5, smartDarkStrength: 5 });

const sheet = doc.getElementById('accessiflow-smartdark-style');
check(sheet !== null, 'a stylesheet is created when the setting goes on');

const css = sheet ? sheet.textContent : '';

// ── Parse the emitted rules back out ────────────────────────────────────────
const rules = new Map();   // index -> { color, background, borders: [] }
css.replace(/\[data-af-dm="(\d+)"\]\{([^}]*)\}/g, (_, index, body) => {
  const entry = { color: null, background: null, borders: [] };
  body.split(';').forEach(decl => {
    const m = decl.match(/^\s*([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})/);
    if (!m) return;
    if (m[1] === 'color') entry.color = m[2];
    else if (m[1] === 'background-color') entry.background = m[2];
    else if (m[1].indexOf('border') === 0) entry.borders.push(m[2]);
  });
  rules.set(index, entry);
  return '';
});

check(rules.size > 0, 'rules were emitted: ' + rules.size + ' distinct colour combinations');

// ── The promise: recoloured text passes its ratio ───────────────────────────
const el = id => doc.getElementById(id);
const ruleFor = node => {
  const index = node && node.getAttribute('data-af-dm');
  return index ? rules.get(index) : null;
};

let checked = 0;
const failures = [];
rules.forEach((entry, index) => {
  if (!entry.color || !entry.background) return;   // text inherits its background
  checked++;
  const ratio = C.contrastRatio(entry.color, entry.background);
  if (ratio < 4.48) failures.push('rule ' + index + ': ' + entry.color + ' on ' +
    entry.background + ' is only ' + Math.round(ratio * 100) / 100 + ':1');
});
check(checked > 0, 'rules carrying both a text and a background colour were produced: ' + checked);
check(failures.length === 0,
  'every recoloured text colour reaches 4.5:1 against its new background' +
  (failures.length ? ' -- ' + failures.join('; ') : ''));

// The case that motivates the whole module: unreadable grey on grey must come
// out readable, not merely darker.
const awful = ruleFor(el('awful'));
check(awful && awful.color && awful.background,
  'the grey-on-grey paragraph was given both a text and a background colour');
if (awful && awful.color && awful.background) {
  const wasRatio = C.contrastRatio('#777777', '#808080');
  const nowRatio = C.contrastRatio(awful.color, awful.background);
  check(nowRatio >= 4.48,
    'grey on grey went from ' + Math.round(wasRatio * 100) / 100 + ':1 to ' +
    Math.round(nowRatio * 100) / 100 + ':1');
}

// ── Nothing whose pixels carry meaning is touched ───────────────────────────
['chart', 'plot', 'icon'].forEach(id => {
  check(!el(id).hasAttribute('data-af-dm'),
    'the ' + el(id).tagName.toLowerCase() + ' was left alone, so its pixels still mean what they meant');
});
check(el('chart').getAttribute('alt') === 'Revenue by quarter',
  'the image is untouched entirely, alt text included');

// An element painting a background image keeps it: recolouring the box behind
// a sprite sheet or hero photo achieves nothing and can destroy it.
const hero = ruleFor(el('hero'));
check(!hero || hero.background === null,
  'an element with a background image keeps its own background');

// ── The page actually went dark ─────────────────────────────────────────────
check(/:root\s*\{[^}]*color-scheme:\s*dark/.test(css),
  'color-scheme: dark is declared, so scrollbars and native widgets follow');
check(/::placeholder/.test(css) && /::selection/.test(css),
  'placeholder and selection colours are set, which filter-based dark modes miss');

const bodyRule = css.match(/\bbody\s*\{([^}]*)\}/);
check(bodyRule !== null, 'the page canvas is given an explicit dark background');
if (bodyRule) {
  const bg = bodyRule[1].match(/background-color:\s*(#[0-9a-fA-F]{6})/);
  check(bg && C.relativeLuminance(bg[1]) < 0.1,
    'the canvas is genuinely dark: ' + (bg ? bg[1] : 'none'));
}

// Backgrounds that differed before must still differ, or every card, stripe
// and input merges into one flat rectangle and the page loses its structure.
const card = ruleFor(el('card'));
const blue = ruleFor(el('brandblue'));
check(card && card.background && blue && blue.background && card.background !== blue.background,
  'a white card and a blue panel stay visibly different after the flip');

// Hue survives. A brand blue that comes back purple is a bug users notice.
if (blue && blue.background) {
  const wasHue = C.toOKLCH('#2266cc').H;
  const nowHue = C.toOKLCH(blue.background).H;
  check(Math.abs(nowHue - wasHue) < 6,
    'the brand blue is still blue: hue ' + Math.round(wasHue) + ' to ' + Math.round(nowHue));
}

check(card && card.borders.length > 0,
  'the card keeps a border, so it still reads as a card');

// ── Identical colours share one rule ────────────────────────────────────────
// Several paragraphs sit on white; if each got its own rule the stylesheet
// would grow with the page instead of with the palette.
{
  const touched = doc.querySelectorAll('[data-af-dm]').length;
  check(rules.size < touched,
    'identical colour pairs share one rule: ' + rules.size + ' rules cover ' +
    touched + ' elements');

  // The five paragraphs styled identically must all land on the same rule, or
  // the stylesheet grows with the length of the page instead of with the
  // size of the palette.
  const sameIndexes = new Set(
    Array.from(doc.querySelectorAll('p.same')).map(n => n.getAttribute('data-af-dm'))
  );
  sameIndexes.add(el('body-text').getAttribute('data-af-dm'));
  check(sameIndexes.size === 1,
    'five identically styled paragraphs share a single rule, not five');
}

// ── Off means off ───────────────────────────────────────────────────────────
contrast.destroy();
check(doc.getElementById('accessiflow-smartdark-style') === null,
  'the stylesheet is removed on destroy');
check(doc.querySelectorAll('[data-af-dm]').length === 0,
  'every marker attribute is removed on destroy');
check(doc.body.innerHTML === before,
  'the DOM is byte-identical to how it started, which the module contract depends on');

// ── Turning it off through settings, not destroy ────────────────────────────
const second = new window.ContrastModule();
second.apply({ smartDarkMode: true, smartDarkContrast: 4.5, smartDarkStrength: 5 });
check(doc.getElementById('accessiflow-smartdark-style') !== null, 'switched back on');
second.apply({ smartDarkMode: false });
check(doc.getElementById('accessiflow-smartdark-style') === null &&
  doc.body.innerHTML === before,
  'switching the setting off cleans up as completely as destroy does');

// ── A page too big to process stands down rather than freezing the tab ──────
{
  const huge = new JSDOM('<!DOCTYPE html><body></body>',
    { runScripts: 'outside-only', url: 'https://example.com/' });
  huge.window.Element.prototype.getBoundingClientRect = window.Element.prototype.getBoundingClientRect;
  huge.window.console.warn = () => {};
  for (const f of ['modules/color.js', 'modules/overlay.js', 'modules/contrast.js']) {
    huge.window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  }
  const body = huge.window.document.body;
  const ceiling = huge.window.ContrastModule.PAGE_CEILING;
  const frag = huge.window.document.createDocumentFragment();
  for (let i = 0; i < ceiling + 10; i++) frag.appendChild(huge.window.document.createElement('span'));
  body.appendChild(frag);

  const guard = new huge.window.ContrastModule();
  const started = Date.now();
  guard.apply({ smartDarkMode: true });
  const elapsed = Date.now() - started;
  const emitted = huge.window.document.querySelectorAll('[data-af-dm]').length;
  check(emitted === 0,
    'a page above the element ceiling is left alone rather than locking the tab (' +
    elapsed + 'ms, ' + emitted + ' elements touched)');
  guard.destroy();
}

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
