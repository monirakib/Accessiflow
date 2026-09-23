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

    <form id="contact">
      <label for="cname">Your name</label><input id="cname" required>
      <label for="cmsg">Message</label><textarea id="cmsg"></textarea>
    </form>

    <form id="feedback">
      <label for="fname">Name</label><input id="fname">
      <label for="fnote">Comments</label><input id="fnote">
    </form>
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

  // ── Form summaries made here, with no AI ────────────────────────────────
  const local = forms.localSummary(serialized);
  const leakedLocally = SECRETS.filter(secret => local.indexOf(secret) !== -1);
  check(leakedLocally.length === 0,
    'the summary made on this computer holds nothing typed either' +
    (leakedLocally.length ? ', LEAKED: ' + leakedLocally.join(', ') : ''));
  check(/^The form "Medical history form" has \d+ questions\./.test(local),
    'it names the form and counts its questions: ' + local.slice(0, 60));
  check(/NHS number, Date of birth, Email \(optional\)/.test(local),
    'it lists what the form asks for, marking what is optional: ' + local);
  check(/a file to upload \(Scan of your prescription\)/.test(local),
    'and the documents to have ready');
  check(/a password/.test(local) && /payment card details/.test(local) && local.indexOf('Card number') === -1,
    'card and password fields only by what they are');

  // A one-box search bar is not a form worth a summary; two questions are.
  check(forms.serialize(el('search')).fields < 2 && !forms._eligible(el('search')),
    'a one-field search form gets no summary');
  check(forms._eligible(el('contact')), 'a two-question form does');

  // ── Always on, whatever the settings say ────────────────────────────────
  const said = [];
  forms.setSpeaker(text => said.push(text));
  forms.apply({ formBriefs: false });   // the old switch, set off: it no longer exists
  el('nhs').focus();       // a real focus, which fires focusin as a browser would
  await new Promise(r => setTimeout(r, 20));
  const brief = el('claim').previousElementSibling;
  check(brief && brief.classList.contains('accessiflow-form-brief'),
    'focusing the first field shows a summary above the form, with no switch turned on');
  check(brief && brief.getAttribute('role') === 'status',
    'as a status region, so a screen reader announces it without moving focus');
  check(doc.activeElement === el('nhs'), 'focus stays in the field the user chose');
  const briefMsg = sent.filter(m => m.action === 'aiFormBrief').pop();
  check(briefMsg && briefMsg.auto === true, 'a summary triggered by focus asks Smart help as an automatic request');
  check(brief && brief.dataset.source === 'ai' && /NHS number and a scan/.test(brief.textContent),
    'which, when the user has agreed to automatic help, writes it');
  check(said.length === 1 && /^Before you start this form\. You will need/.test(said[0]),
    'and it is handed to the speaker once: ' + said.join(' | '));

  const count = sent.filter(m => m.action === 'aiFormBrief').length;
  el('dob').focus();
  await new Promise(r => setTimeout(r, 20));
  check(sent.filter(m => m.action === 'aiFormBrief').length === count,
    'moving to the next field does not ask again');

  doc.querySelector('#search input').focus();
  await new Promise(r => setTimeout(r, 20));
  check(sent.filter(m => m.action === 'aiFormBrief').length === count,
    'focusing a search box never triggers a summary');

  // Without the user's agreement Smart help refuses at once, and the summary
  // made here takes its place, with nothing sent anywhere.
  replies.aiFormBrief = () => ({ success: false, code: 'no_consent', error: 'Automatic fixes are off.' });
  said.length = 0;
  el('cname').focus();
  await new Promise(r => setTimeout(r, 20));
  const contactBrief = el('contact').previousElementSibling;
  check(contactBrief && contactBrief.dataset.source === 'local' &&
    /It has 2 questions\. It asks for: Your name and Message \(optional\)\./.test(contactBrief.textContent),
    'without agreement, the summary is made on this computer: ' + (contactBrief && contactBrief.querySelector('.accessiflow-form-brief-text').textContent));
  check(/made on this computer/.test(contactBrief.querySelector('.accessiflow-form-brief-note').textContent),
    'and says so: nothing was sent anywhere');
  check(said.length === 1 && /Your name/.test(said[0]), 'it goes to the speaker the same way');

  // Smart help slow to answer: the local summary goes up first, and the AI's
  // replaces its words quietly, without saying them a second time.
  window.ACCESSIFLOW_AI_CONFIG.FORM_AI_WAIT_MS = 30;
  replies.aiFormBrief = () => ({ success: true, text: 'You will need your name and a few comments.', slow: true });
  const realSend = window.chrome.runtime.sendMessage;
  window.chrome.runtime.sendMessage = (msg, cb) => {
    sent.push(msg);
    const reply = replies[msg.action] ? replies[msg.action](msg) : { success: true };
    if (cb) setTimeout(() => cb(reply), reply.slow ? 120 : 0);
  };
  said.length = 0;
  el('fname').focus();
  await new Promise(r => setTimeout(r, 60));
  const feedbackBrief = el('feedback').previousElementSibling;
  check(feedbackBrief && feedbackBrief.dataset.source === 'local',
    'if Smart help is slow, the summary made here goes up first');
  await new Promise(r => setTimeout(r, 150));
  check(feedbackBrief.dataset.source === 'ai' && /a few comments/.test(feedbackBrief.textContent),
    'and the AI\'s replaces it when it arrives');
  check(said.length === 1 && /It asks for: Name and Comments\./.test(said[0]),
    'without being said a second time: ' + said.join(' | '));
  check(feedbackBrief.getAttribute('aria-live') === 'polite',
    'and the region is live again afterwards, having been quiet for the swap');
  window.chrome.runtime.sendMessage = realSend;

  // Alt+Shift+G and the popup say the result themselves.
  said.length = 0;
  replies.aiFormBrief = () => ({ success: false, error: 'You appear to be offline.' });
  el('cmsg').focus();
  const asked = await forms.describeCurrent();
  check(/It has 2 questions/.test(asked) && said.length === 0,
    'asked for explicitly while offline, the summary made here is returned, for the caller to say');

  forms.destroy();
  check(!doc.querySelector('.accessiflow-form-brief'), 'destroy removes every summary');

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
