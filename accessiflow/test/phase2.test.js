// Phase 2 in the page: AI code healing, the plain-language simplifier, the
// TL;DR, and form briefs.
//
// The service worker is stubbed; what is under test is what the content
// script sends and what it does to the page with the answer. Three properties
// matter above the rest:
//
//   * the form serialiser never emits anything the user typed
//   * a simplified page can be restored exactly, event listeners included
//   * healing touches only what the free repairs could not name
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

const LONG_A = 'Remittance of the aforementioned sum must be effected in full no later than the fifth ' +
  'day of May, failing which the account holder shall become liable for a surcharge as set out in ' +
  'the schedule of charges, which may be consulted at any branch or on request.';
const LONG_B = 'Applicants who are in receipt of qualifying benefits may be entitled to a reduction, ' +
  'subject to the provision of documentary evidence satisfactory to the authority, and see the ' +
  '<a id="guide" href="/guide">eligibility guide</a> for the full conditions that apply.';

const PAGE = `<!DOCTYPE html><html lang="en"><head><title>Claims portal</title></head><body>
  <main>
    <h1>Your claim</h1>
    <p id="pa">${LONG_A}</p>
    <p id="pb">${LONG_B}</p>
    <p id="short">Short paragraph.</p>

    <button id="icon-save" class="btn-42 icon-floppy"><svg></svg></button>
    <button id="named">Save</button>
    <a id="icon-link" href="/profile" class="nav-avatar"><span class="avatar"></span></a>

    <form id="claim" action="/claims/submit">
      <h2>Medical history form</h2>
      <fieldset>
        <legend>About you</legend>
        <label for="nhs">NHS number</label>
        <input id="nhs" name="nhs" required maxlength="10" minlength="10" value="9434765919">
        <label>Date of birth <input id="dob" type="date" required value="1980-01-01"></label>
        <label for="email">Email</label><input id="email" type="email" value="me@example.com">
      </fieldset>
      <label for="notes">Anything else?</label>
      <textarea id="notes">I have a heart condition and take warfarin</textarea>
      <label>Bio <div id="bio" contenteditable="true" role="textbox">my private typed words</div></label>
      <label for="pw">Password</label><input id="pw" type="password" value="hunter2">
      <label for="card">Card number</label><input id="card" name="cardnumber" autocomplete="cc-number" value="4111111111111111">
      <input type="hidden" name="csrf" value="SECRET-CSRF-TOKEN">
      <label for="scan">Scan of your prescription</label><input id="scan" type="file" accept=".pdf,.jpg" required>
      <button type="submit" id="send-claim" class="btn-submit-claim"></button>
    </form>

    <form id="search"><input name="q" aria-label="Search"></form>
  </main>
</body></html>`;

const dom = new JSDOM(PAGE, { runScripts: 'outside-only', url: 'https://claims.example/claim' });
const { window } = dom;
const doc = window.document;
window.console.log = () => {};
window.console.warn = () => {};
window.Element.prototype.getBoundingClientRect = function () {
  return { top: 10, left: 10, width: 120, height: 30, right: 130, bottom: 40, x: 10, y: 10 };
};

// A stand-in service worker that records every message.
const sent = [];
const replies = {
  aiLabelControl: msg => {
    if (/btn-42|floppy/.test(msg.classList)) return { success: true, text: 'Save claim', cached: false };
    if (/submit-claim/.test(msg.classList)) return { success: true, text: 'Submit medical form', cached: false };
    return { success: true, text: '', cached: false };     // the model was unsure
  },
  aiSimplify: msg => ({
    success: true,
    rewrites: msg.paragraphs.map((p, i) => 'Plain version ' + (i + 1) + '.'),
    cached: false
  }),
  aiBullets: () => ({ success: true, bullets: ['First point.', 'Second point.', 'Third point.'] }),
  aiFormBrief: () => ({ success: true, text: 'You will need your NHS number and a scan of your prescription.' })
};
window.chrome = {
  runtime: {
    lastError: null,
    sendMessage: (msg, cb) => {
      sent.push(msg);
      const reply = replies[msg.action] ? replies[msg.action](msg) : { success: true };
      if (cb) setTimeout(() => cb(reply), 0);
    }
  }
};

for (const f of ['modules/ai-config.js', 'modules/ai-cache.js', 'modules/blind.js',
  'modules/forms.js', 'modules/ai.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}
window.ACCESSIFLOW_AI_CONFIG.REQUEST_SPACING_MS = 0;

const el = id => doc.getElementById(id);
const blind = new window.BlindModule();
const ai = new window.AIModule();
const forms = new window.FormsModule();

(async () => {
  // ── Healing: only what the free repairs could not name ──────────────────
  blind.repairEmptyButtons();
  blind.repairEmptyLinks();

  check(el('icon-save').getAttribute('data-accessiflow-btn-repaired') === 'placeholder',
    'a button with no name and no usable icon is marked as a placeholder for the AI');
  check(el('named').getAttribute('data-accessiflow-btn-repaired') === null,
    'a button with visible text is not touched at all');

  const needing = ai._controlsNeedingName().map(n => n.id).sort();
  check(needing.indexOf('icon-save') !== -1 && needing.indexOf('send-claim') !== -1,
    'the AI is offered exactly the placeholders: ' + needing.join(', '));
  check(needing.indexOf('named') === -1, 'and never a control that already has a name');

  const ctx = ai._controlContext(el('send-claim'));
  check(/Medical history form/.test(ctx.formPurpose),
    'the form a control belongs to is sent with it, which is what makes "Submit medical form" reachable: ' + ctx.formPurpose);
  check(/btn-submit-claim/.test(ctx.classList), 'its class names go too, because they often say what it does');
  check(ctx.pageTitle === 'Claims portal', 'and the page title');

  const sig1 = ai._controlSignature(el('send-claim'));
  const sig2 = ai._controlSignature(el('send-claim'));
  check(sig1 === sig2 && sig1.indexOf('/claim') === 0,
    'a control’s signature is stable, so the next visit finds its remembered name');

  const result = await ai.healControls({ auto: true });
  check(result.named >= 2, 'healing named the controls it was sure about: ' + result.named + ' of ' + result.total);
  check(el('icon-save').getAttribute('aria-label') === 'Save claim',
    'the icon button now has a real name for the screen reader: ' + el('icon-save').getAttribute('aria-label'));
  check(el('send-claim').getAttribute('aria-label') === 'Submit medical form',
    'and the empty submit button is named from its form: ' + el('send-claim').getAttribute('aria-label'));
  check(/no description available/.test(el('icon-link').getAttribute('aria-label')),
    'where the model was unsure, the placeholder stays rather than a guess being read aloud');

  const healMsgs = sent.filter(m => m.action === 'aiLabelControl');
  check(healMsgs.every(m => m.auto === true && typeof m.cacheKey === 'string' && m.cacheKey),
    'automatic healing marks its calls as automatic and gives each a cache key, so the gate can apply');

  ai.revertControls();
  check(el('icon-save').getAttribute('aria-label') !== 'Save claim' &&
    el('icon-save').getAttribute('data-accessiflow-ai-control') === null,
    'revertControls takes every AI name back off');

  // A refusal from the gate is quiet, not an error the user is told about.
  const savedReply = replies.aiLabelControl;
  replies.aiLabelControl = () => ({ success: false, error: 'off', code: 'no_consent' });
  const quiet = await ai.healControls({ auto: true });
  check(quiet.error === null, 'no consent is a silent stop, not an error message');
  replies.aiLabelControl = savedReply;

  // ── The simplifier ──────────────────────────────────────────────────────
  const paraB = el('pb');
  const guide = el('guide');
  let guideClicks = 0;
  guide.addEventListener('click', e => { e.preventDefault(); guideClicks++; });
  const beforeA = el('pa').innerHTML;
  const beforeB = paraB.innerHTML;

  const candidates = ai._simplifiableParagraphs().map(n => n.id);
  check(candidates.join(',') === 'pa,pb',
    'only the long paragraphs are offered, never short ones or anything inside a form: ' + candidates.join(','));

  const simplified = await ai.simplifyPage();
  check(simplified.rewritten === 2, 'both long paragraphs were rewritten');
  check(el('pa').querySelector('.accessiflow-simplified-text').textContent === 'Plain version 1.',
    'each rewrite lands in its own paragraph, in order');
  check(el('pa').getAttribute('data-accessiflow-simplified') === 'true', 'and is marked as rewritten');

  const notice = el('accessiflow-simplified-notice');
  check(notice && /rewritten in plain language by AI/.test(notice.textContent),
    'a notice says plainly that the page was rewritten by AI');

  const linkCopy = paraB.querySelector('.accessiflow-simplified-links a');
  check(linkCopy && linkCopy.getAttribute('href') === '/guide',
    'a rewritten paragraph keeps its links, listed underneath, since they cannot be spliced into new prose');

  const toggle = paraB.querySelector('.accessiflow-simplified-toggle');
  toggle.click();
  check(!paraB.querySelector('.accessiflow-simplified-original').hidden &&
    paraB.querySelector('.accessiflow-simplified-text').hidden,
    'each paragraph can show its original with one press');
  check(toggle.getAttribute('aria-pressed') === 'true', 'and the toggle says which state it is in');
  toggle.click();

  const restored = ai.revertSimplified();
  check(restored === 2, 'restore brings both paragraphs back');
  check(el('pa').innerHTML === beforeA && paraB.innerHTML === beforeB,
    'the paragraphs are byte-identical to before');
  check(el('guide') === guide, 'the original link element itself is back, not a copy');
  el('guide').click();
  check(guideClicks === 1,
    'and its own event listener still works, because the original nodes were moved rather than cloned');
  check(!el('accessiflow-simplified-notice'), 'the notice goes when the page is restored');

  // A mismatched batch is never applied.
  replies.aiSimplify = () => ({ success: true, rewrites: ['Only one'], cached: false });
  const mismatched = await ai.simplifyPage();
  check(mismatched.rewritten === 0,
    'if the rewrites do not line up with the paragraphs, none of them is used');
  check(!el('pa').hasAttribute('data-accessiflow-simplified'), 'and the page is untouched');

  // ── TL;DR ───────────────────────────────────────────────────────────────
  const bullets = await ai.summarizeBullets();
  check(bullets.length === 3, 'the TL;DR comes back as three points');
  const panel = el('accessiflow-page-summary');
  check(panel && panel.querySelectorAll('.accessiflow-summary-list li').length === 3,
    'shown as a real list, so a screen reader announces three items');
  check(/key points/i.test(panel.querySelector('.accessiflow-summary-heading').textContent),
    'under a heading that says what it is');

  // ── Form briefs: what may be sent ───────────────────────────────────────
  const serialized = forms.serialize(el('claim'));
  const t = serialized.text;
  const SECRETS = ['9434765919', '1980-01-01', 'me@example.com', 'warfarin', 'heart condition',
    'my private typed words', 'hunter2', '4111111111111111', 'SECRET-CSRF-TOKEN'];
  const leaked = SECRETS.filter(secret => t.indexOf(secret) !== -1);
  check(leaked.length === 0,
    'nothing the user typed or the page prefilled appears in what is sent' +
    (leaked.length ? ', LEAKED: ' + leaked.join(', ') : ''));
  check(/NHS number \(text, required, 10 characters\)/.test(t),
    'labels, types and limits are described: NHS number, required, 10 characters');
  check(/Scan of your prescription \(file upload, accepts \.pdf,\.jpg, required\)/.test(t),
    'including the documents a user will need to have ready');
  check(/- password details/.test(t) && /- payment card details/.test(t),
    'password and card fields are reported by category only');
  check(t.indexOf('Card number') === -1,
    'a payment field is not described by its own label, even though a label is not user data');
  check(!/csrf/i.test(t), 'hidden fields are left out entirely');
  check(/Section: About you/.test(t), 'fieldset legends give the form its structure');
  check(/Form: Medical history form/.test(t), 'and the form is named');

  // The search box is not a form worth a summary.
  check(forms.serialize(el('search')).fields < 4, 'a one-field search form is below the threshold');

  // Automatic brief on first focus.
  forms.apply({ formBriefs: true });
  el('nhs').focus();       // a real focus, which fires focusin as a browser would
  await new Promise(r => setTimeout(r, 20));
  const brief = el('claim').previousElementSibling;
  check(brief && brief.classList.contains('accessiflow-form-brief'),
    'focusing the first field shows a brief above the form');
  check(brief && brief.getAttribute('role') === 'status',
    'as a status region, so a screen reader announces it without moving focus');
  check(doc.activeElement === el('nhs'), 'focus stays in the field the user chose');
  const briefMsg = sent.filter(m => m.action === 'aiFormBrief').pop();
  check(briefMsg && briefMsg.auto === true, 'a brief triggered by focus is marked automatic');

  const count = sent.filter(m => m.action === 'aiFormBrief').length;
  el('dob').focus();
  await new Promise(r => setTimeout(r, 20));
  check(sent.filter(m => m.action === 'aiFormBrief').length === count,
    'moving to the next field does not ask again');

  doc.querySelector('#search input').focus();
  await new Promise(r => setTimeout(r, 20));
  check(sent.filter(m => m.action === 'aiFormBrief').length === count,
    'focusing a search box never triggers a brief');

  forms.destroy();
  check(!doc.querySelector('.accessiflow-form-brief'), 'destroy removes the brief');

  finish();
})().catch(err => { errors.push('threw: ' + err.stack); finish(); });

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
