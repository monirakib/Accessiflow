// Runs the content-script modules together under jsdom and checks how they
// interact. Each module can be right on its own and still wrong in company:
// Screen reader repairs used to fill every missing alt with a placeholder, and
// the AI then saw a description on every picture and described none of them.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

const dom = new JSDOM(`<!DOCTYPE html><html lang="en"><body>
  <main>
    <h1>Fees</h1>
    <img id="chart" src="/images/fee-instruction.jpg">
    <img id="described" src="/images/photo.jpg" alt="Voters queueing outside a polling station">
    <img id="decorative" src="/images/rule.png" alt="">
    <img id="captcha-image" src="/captcha.jpg">
    <div class="captcha-box"><img id="refresh" src="/images/icon-refresh.jpg"></div>
  </main>
</body></html>`, { runScripts: 'outside-only', url: 'https://example.gov/fees' });

const { window } = dom;
window.console.log = () => {};
window.chrome = { runtime: { sendMessage: () => {} } };
// jsdom does no layout; give every image a real on-screen size.
window.HTMLImageElement.prototype.getBoundingClientRect = () => ({ width: 300, height: 200 });

for (const f of ['modules/ai-config.js', 'modules/blind.js', 'modules/ai.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const doc = window.document;
const byId = id => doc.getElementById(id);
const ids = list => list.map(img => img.id).sort().join(', ');

const blind = new window.BlindModule();
const ai = new window.AIModule();

// ── Screen reader repairs runs first, as it does on every page by default ────
blind.repairMissingAltText();
check(byId('chart').alt === '[Image - description unavailable]',
  'repairs gives an undescribed picture the placeholder: "' + byId('chart').alt + '"');

// ── The AI must still see that picture as undescribed ────────────────────────
const wanted = ai._imagesNeedingAlt();
check(wanted.includes(byId('chart')),
  'the AI treats the placeholder as missing, not as a description');
check(!wanted.includes(byId('described')),
  'a real description is left alone');
check(!wanted.includes(byId('decorative')),
  'an image marked decorative (alt="") is left alone');
check(!wanted.includes(byId('captcha-image')) && !wanted.includes(byId('refresh')),
  'CAPTCHAs are never sent for description (by id, and inside a captcha container)');
check(ids(wanted) === 'chart', 'exactly the undescribed picture is picked: ' + (ids(wanted) || 'none'));
check(ai.countImagesNeedingAlt() === 1, 'the popup badge would read 1: ' + ai.countImagesNeedingAlt());

// ── An AI description survives "Turn everything off" ─────────────────────────
// This is what describeImage writes on success.
byId('chart').setAttribute('alt', 'Election Commission notice listing National ID card fees');
byId('chart').setAttribute('data-accessiflow-ai-alt', 'true');
check(ai.countImagesNeedingAlt() === 0, 'once described, the picture is not counted again');

blind.destroy();
check(byId('chart').alt === 'Election Commission notice listing National ID card fees',
  'turning everything off keeps the AI description');
check(!byId('captcha-image').hasAttribute('alt'),
  'turning everything off still removes the placeholders it added elsewhere');

console.log('\n=== PASS (' + ok.length + ') ===');
ok.forEach(m => console.log('  + ' + m));
if (errors.length) {
  console.log('\n=== FAIL (' + errors.length + ') ===');
  errors.forEach(m => console.log('  ! ' + m));
  process.exit(1);
}
console.log('\nAll checks passed.');
