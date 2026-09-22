// Voice control: the parser, the page half, and the panel.
//
// The parser is tested hardest on what it must NOT do. Someone steering the
// browser by voice cannot reach for a mouse to undo a command they never
// gave, so chatter, sentences that merely contain a command word, and
// long speech all have to come out as nothing.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

const VC = require(path.join(ROOT, 'voice-commands.js'));

// ── The parser ──────────────────────────────────────────────────────────────
{
  const is = (heard, type, extra) => {
    const cmd = VC.parse(heard);
    const good = cmd && cmd.type === type &&
      Object.keys(extra || {}).every(k => cmd[k] === extra[k]);
    check(good, '"' + heard + '" is ' + type + (extra ? ' ' + JSON.stringify(extra) : '') +
      (good ? '' : ', got ' + JSON.stringify(cmd)));
  };
  const nothing = heard => {
    const cmd = VC.parse(heard);
    check(cmd === null, '"' + heard + '" is not a command' + (cmd ? ', got ' + JSON.stringify(cmd) : ''));
  };

  is('scroll down', 'scroll', { dir: 1 });
  is('Scroll up.', 'scroll', { dir: -1 });
  is('page down', 'scroll', { amount: 'page' });
  is('go to the top', 'scroll', { amount: 'end', dir: -1 });
  is('keep scrolling', 'scroll', { keep: true });
  is('stop', 'stop');
  is('show numbers', 'numbers');
  is('12', 'pick', { n: 12 });
  is('twelve', 'pick', { n: 12 });
  is('click 7', 'pick', { n: 7 });
  is('number twenty one', 'pick', { n: 21 });
  is('one hundred and five', 'pick', { n: 105 });
  is('for', 'pick', { n: 4 });
  is('click Urgent Applications', 'click', { name: 'urgent applications' });
  is('press the submit button', 'click', { name: 'submit button' });
  is('go to contact', 'click', { name: 'contact' });
  is('next heading', 'heading', { dir: 1 });
  is('previous heading', 'heading', { dir: -1 });
  is('type Hello, my name is Akib', 'type', { text: 'Hello, my name is Akib' });
  is('search for bus times to Dhaka', 'search', { query: 'bus times to dhaka' });
  is('go back', 'back', { where: 'tab' });
  is('please reload', 'reload');
  is('close tab', 'closeTab', { confirm: true });
  is('submit', 'submit', { confirm: true });
  is('no numbers', 'hideNumbers');
  is('disable numbers', 'hideNumbers');
  is('numbers off', 'hideNumbers');
  is('close pop-up', 'closePopup');
  is('Close the popup.', 'closePopup');
  is('dismiss', 'closePopup');
  is('close tab', 'closeTab');
  is('cancel', 'cancel');
  is('go to sleep', 'sleep', { where: 'panel' });
  is('wake up', 'wake');
  is('pause', 'sleep');
  is('Pause voice control.', 'sleep');
  is('resume', 'wake');
  is('unpause', 'wake');
  nothing('pause the video and then resume it later');
  is('what can I say', 'help');

  // The first version found command words anywhere. None of these may act.
  nothing('I was looking at the table');
  nothing('turn to the next page of the report');
  nothing('can you scroll down a bit for me because I cannot see it');
  nothing('the weather is nice today');
  nothing('');
  nothing('   ');
  // "tab" inside another word, "back" inside a sentence.
  nothing('bring that back later');
  check(VC.parse('click to') && VC.parse('click to').type === 'click',
    'a soundalike after "click" is taken as a name, not a number');

  // The recogniser's second guess can rescue a misheard first.
  const alt = VC.parseAlternatives([{ transcript: 'scroll dawn' }, { transcript: 'scroll down' }]);
  check(alt && alt.type === 'scroll' && alt.heard === 'scroll down',
    'when the first guess is not a command, a later guess that is wins');

  check(VC.toNumber('seventy three') === 73 && VC.toNumber('a hundred') === 100 && VC.toNumber('banana') === null,
    'numbers in words are read, and words that are not numbers are not');
}

// ── The page half ───────────────────────────────────────────────────────────

const PAGE = `<!DOCTYPE html><html lang="en"><body>
  <h1 id="h1">Bangladesh e-Passport</h1>
  <nav>
    <a id="apply" href="#apply">Apply online</a>
    <a id="urgent" tabindex="0">Urgent applications</a>
    <a id="contact" href="#contact">Contact</a>
    <button id="more1">More</button>
    <button id="more2">More</button>
  </nav>
  <form id="f" aria-label="Sign up">
    <input id="name" type="text" aria-label="Full name" required>
    <input id="email" type="email" aria-label="Email">
    <button id="send" type="submit">Send</button>
  </form>
</body></html>`;

const RECTS = {
  h1: [10, 10, 400, 40], apply: [60, 10, 120, 30], urgent: [60, 140, 160, 30],
  contact: [60, 310, 80, 30], more1: [60, 400, 60, 30], more2: [60, 470, 60, 30],
  name: [120, 10, 200, 24], email: [160, 10, 200, 24], send: [200, 10, 60, 30]
};

function makePage(html) {
  const dom = new JSDOM(html || PAGE, { runScripts: 'outside-only', url: 'https://example.com/' });
  const w = dom.window;
  w.console.log = () => {};
  w.console.warn = () => {};
  w.Element.prototype.getBoundingClientRect = function () {
    const r = RECTS[this.id];
    const [top, left, width, height] = r || [0, 0, 0, 0];
    return { top, left, width, height, right: left + width, bottom: top + height, x: left, y: top };
  };
  w.Element.prototype.getClientRects = function () { return RECTS[this.id] || this.tagName === 'FORM' ? [1] : []; };
  w.Element.prototype.scrollIntoView = function () {};
  Object.defineProperty(w, 'innerWidth', { value: 1024, configurable: true });
  Object.defineProperty(w, 'innerHeight', { value: 768, configurable: true });
  w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  w.scrolled = 0;
  w.scrollBy = (a, b) => { w.scrolled += typeof a === 'object' ? a.top : b; };
  for (const f of ['modules/color.js', 'modules/overlay.js', 'modules/naming.js',
    'modules/page-actions.js', 'modules/voice-nav.js']) {
    w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  }
  return w;
}

(async () => {
  const w = makePage();
  const doc = w.document;
  const el = id => doc.getElementById(id);
  const nav = new w.VoiceNavModule();
  const clicks = {};
  ['apply', 'urgent', 'contact', 'more1', 'more2'].forEach(id => {
    clicks[id] = 0;
    el(id).addEventListener('click', e => { clicks[id]++; e.preventDefault(); });
  });
  const numbers = () => doc.getElementById('accessiflow-voice-numbers');

  // Numbers.
  let r = await nav.handle({ type: 'numbers' });
  check(!!numbers() && /numbered/.test(r.message), 'show numbers puts numbers on the page: ' + r.message);
  const labels = Array.from(numbers().shadowRoot.querySelectorAll('.hint')).map(n => n.textContent);
  check(labels[0] === '1' && labels.length === r.count, 'numbered from 1: ' + labels.join(' '));
  r = await nav.handle({ type: 'pick', n: 2 });
  check(clicks.urgent === 1, 'saying 2 clicks the second thing, the link with no href');
  check(!!numbers(), 'and the numbers stay on, ready for the next one');
  r = await nav.handle({ type: 'pick', n: 1 });
  check(clicks.apply === 1 && !!numbers(), 'a second number works straight away, with no "show numbers" in between');

  r = await nav.handle({ type: 'pick', n: 99 });
  check(!r.ok && /no number 99/.test(r.message), 'a number that is not there is refused, and says how high they go');

  // Stable numbers: something appearing does not renumber what was there.
  const urgentLabel = () => Array.from(numbers().shadowRoot.querySelectorAll('.hint'))
    .find(h => h.style.left === (140 - 4) + 'px' && h.style.top === (60 - 4) + 'px');
  const before = urgentLabel().textContent;
  const extra = doc.createElement('button');
  extra.id = 'newcomer';
  extra.textContent = 'New';
  RECTS.newcomer = [30, 10, 60, 20];            // above everything, first in reading order
  doc.body.insertBefore(extra, doc.body.firstChild);
  await new Promise(res => setTimeout(res, 700));
  check(urgentLabel() && urgentLabel().textContent === before,
    'when a new control appears, the others keep their numbers: Urgent is still ' + before);
  const newcomerNumber = Array.from(numbers().shadowRoot.querySelectorAll('.hint'))
    .find(h => h.style.top === (30 - 4) + 'px');
  check(newcomerNumber && !isNaN(+newcomerNumber.textContent), 'and the newcomer gets a number of its own');
  extra.remove();
  delete RECTS.newcomer;

  r = await nav.handle({ type: 'hideNumbers' });
  check(!numbers() && r.message === 'Numbers off.', 'no numbers turns them off');
  r = await nav.handle({ type: 'pick', n: 3 });
  check(!r.ok && /show numbers first/i.test(r.message), 'a number with the numbers off says what to do');
  const clickedSoFar = clicks.apply;
  check(clickedSoFar === 1, 'and clicks nothing');

  // By name.
  r = await nav.handle({ type: 'click', name: 'contact' });
  check(clicks.contact === 1, 'click contact clicks Contact');
  r = await nav.handle({ type: 'click', name: 'urgent applications' });
  check(clicks.urgent === 2, 'click urgent applications clicks it by its full name');
  r = await nav.handle({ type: 'click', name: 'urgent' });
  check(clicks.urgent === 3, 'and by the start of its name');
  r = await nav.handle({ type: 'click', name: 'contract' });
  check(clicks.contact === 2, 'a near miss from the recogniser ("contract") still finds Contact');
  r = await nav.handle({ type: 'click', name: 'more' });
  check(r.choose && clicks.more1 === 0 && clicks.more2 === 0 && numbers() &&
    numbers().shadowRoot.querySelectorAll('.hint').length === 2,
    'two buttons both called More: neither is clicked, both are numbered: ' + r.message);
  await nav.handle({ type: 'pick', n: 2 });
  check(clicks.more2 === 1 && clicks.more1 === 0, 'and saying 2 picks the second');
  r = await nav.handle({ type: 'click', name: 'zebra crossing' });
  check(!r.ok && /Nothing called/.test(r.message), 'a name that is not on screen clicks nothing and says so');

  // Scrolling.
  w.scrolled = 0;
  await nav.handle({ type: 'scroll', dir: 1 });
  check(w.scrolled > 0, 'scroll down scrolls down');
  await nav.handle({ type: 'scroll', dir: 1, keep: true });
  r = await nav.handle({ type: 'stop' });
  check(r.message === 'Stopped.', 'keep scrolling runs until stop');

  // Forms.
  r = await nav.handle({ type: 'type', text: 'Akib' });
  check(el('name').value === 'Akib' && doc.activeElement === el('name'),
    'type goes into the first text box when none is chosen: ' + JSON.stringify(el('name').value));
  await nav.handle({ type: 'type', text: 'Monir' });
  check(el('name').value === 'Akib Monir', 'more typing adds to it, with a space');
  r = await nav.handle({ type: 'nextField' });
  check(doc.activeElement === el('email') && /Email/.test(r.message), 'next field moves to Email: ' + r.message);

  let sent = 0;
  el('f').addEventListener('submit', e => { sent++; e.preventDefault(); });
  r = await nav.handle({ type: 'submit' });
  check(r.confirm && sent === 0 && /Sign up/.test(r.message), 'submit asks first, naming the form: ' + r.message);
  r = await nav.handle({ type: 'submit', confirmed: true });
  check(sent === 1, 'and sends once confirmed');

  el('name').value = '';
  r = await nav.handle({ type: 'submit', confirmed: true });
  check(!r.ok && sent === 1 && doc.activeElement === el('name') && /Full name/.test(r.message),
    'a required box left empty is named and gone to, and nothing is sent: ' + r.message);

  nav.destroy();
  check(!numbers(), 'destroy leaves nothing behind');

  await popupTests();
  await panelTests();
  finish();
})().catch(e => { errors.push('crashed: ' + e.stack); finish(); });

// ── Pop-ups ─────────────────────────────────────────────────────────────────

async function popupTests() {
  // A notice like the passport site's: its ✕ is a <span>, not a button.
  RECTS.notice = [200, 300, 600, 400];
  RECTS.noticeX = [210, 860, 24, 24];
  RECTS.modal = [150, 250, 500, 300];
  const w = makePage(`<!DOCTYPE html><html><body>
    <a id="behind" href="#x">Behind</a>
    <div id="notice" role="dialog">
      <span id="noticeX">✕</span>
      <p>Special warning</p>
    </div>
  </body></html>`);
  const nav = new w.VoiceNavModule();
  const notice = w.document.getElementById('notice');
  w.document.getElementById('noticeX').addEventListener('click', () => { notice.style.display = 'none'; });

  let r = await nav.handle({ type: 'closePopup' });
  check(r.ok && w.getComputedStyle(notice).display === 'none',
    'close pop up presses a ✕ that is only a <span>: ' + r.message);

  r = await nav.handle({ type: 'closePopup' });
  check(!r.ok && /cannot see a pop-up/.test(r.message), 'with nothing open, it says there is no pop-up');

  // No close button at all, but it listens for Esc, as most do.
  const w2 = makePage(`<!DOCTYPE html><html><body>
    <div id="modal" aria-modal="true"><p>Subscribe to our newsletter</p></div>
    <script></script>
  </body></html>`);
  const modal = w2.document.getElementById('modal');
  w2.document.addEventListener('keydown', e => { if (e.key === 'Escape') modal.hidden = true; });
  const nav2 = new w2.VoiceNavModule();
  r = await nav2.handle({ type: 'closePopup' });
  check(r.ok && modal.hidden, 'a pop-up with no close button is closed with Esc: ' + r.message);

  // One that will not close is reported honestly, not as closed.
  const w3 = makePage(`<!DOCTYPE html><html><body>
    <div id="modal" role="dialog"><p>You must agree</p></div>
  </body></html>`);
  r = await new w3.VoiceNavModule().handle({ type: 'closePopup' });
  check(!r.ok && /would not close/.test(r.message), 'a pop-up that stays open is not reported as closed: ' + r.message);

  delete RECTS.notice; delete RECTS.noticeX; delete RECTS.modal;
}

// ── The panel ───────────────────────────────────────────────────────────────

async function panelTests() {
  const html = fs.readFileSync(path.join(ROOT, 'voice-panel.html'), 'utf8')
    .replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'chrome-extension://abc/voice-panel.html' });
  const w = dom.window;
  w.console.log = () => {};
  w.console.warn = () => {};

  const sent = [];
  const tabCalls = [];
  const tabEvents = {};
  const tabs = [
    { id: 1, active: true, title: 'e-Passport', url: 'https://www.epassport.gov.bd/' },
    { id: 2, active: false, title: 'Mail', url: 'https://mail.example.com/' }
  ];
  let pageAnswer = () => ({ ok: true, message: 'Done on the page.' });

  w.chrome = {
    runtime: { lastError: null, getURL: p => 'chrome-extension://abc/' + p },
    storage: { local: { get: (k, cb) => cb({}), set: () => {} } },
    tabs: {
      getCurrent: cb => cb(undefined),        // in the side panel, not a tab
      query: async () => tabs,
      sendMessage: (id, msg, cb) => { sent.push({ id, cmd: msg.command }); cb(pageAnswer(msg.command)); },
      goBack: async id => { tabCalls.push(['back', id]); },
      goForward: async id => { tabCalls.push(['forward', id]); },
      reload: async id => { tabCalls.push(['reload', id]); },
      create: async o => { tabCalls.push(['create', o.url || '']); },
      update: async (id, o) => { tabCalls.push(['activate', id, o.active]); },
      remove: async id => { tabCalls.push(['remove', id]); },
      onActivated: { addListener: fn => { tabEvents.activated = fn; } },
      onUpdated: { addListener: fn => { tabEvents.updated = fn; } }
    }
  };
  // No microphone here: permission stays at "prompt", so the panel waits.
  Object.defineProperty(w.navigator, 'permissions', {
    value: { query: async () => ({ state: 'prompt', onchange: null }) }, configurable: true
  });

  w.eval(fs.readFileSync(path.join(ROOT, 'voice-commands.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(ROOT, 'voice-panel.js'), 'utf8'));
  await new Promise(r => setTimeout(r, 20));

  const $ = id => w.document.getElementById(id);
  const say = text => w.__accessiflowVoiceHear(text);

  check(!$('setup').hidden, 'without the microphone allowed, the panel shows how to allow it');
  check($('helpList').querySelectorAll('dt').length >= 15, 'the list of things to say is shown');

  await say('scroll down');
  check(sent.length === 1 && sent[0].id === 1 && sent[0].cmd.type === 'scroll',
    'a page command goes to the tab beside the panel');
  check($('reply').textContent === 'Done on the page.', 'and the page’s answer is shown');

  await say('go back');
  check(tabCalls.some(c => c[0] === 'back' && c[1] === 1), 'go back is done on the tab, not sent into the page');

  await say('next tab');
  check(tabCalls.some(c => c[0] === 'activate' && c[1] === 2), 'next tab switches to the next tab');

  await say('search for bus times');
  check(tabCalls.some(c => c[0] === 'create' && /q=bus%20times/.test(c[1])), 'search opens a search in a new tab');

  // Confirmation: nothing happens until yes.
  const before = tabCalls.length;
  await say('close tab');
  check(tabCalls.length === before && !$('confirm').hidden && /Close/.test($('confirmText').textContent),
    'close tab asks first and closes nothing yet');
  await say('no');
  check(tabCalls.length === before && $('confirm').hidden, 'no cancels it');
  await say('close tab');
  await say('yes');
  check(tabCalls.some(c => c[0] === 'remove' && c[1] === 1), 'yes closes it');

  // A confirmation the page asks for.
  pageAnswer = cmd => cmd.type === 'submit' && !cmd.confirmed
    ? { ok: true, confirm: true, message: 'Send the Sign up form? Say yes or no.' }
    : { ok: true, message: cmd.confirmed ? 'Sent.' : 'Done on the page.' };
  await say('submit');
  check(!$('confirm').hidden, 'the page can ask the panel for a yes or no');
  await say('yes');
  const last = sent[sent.length - 1].cmd;
  check(last.type === 'submit' && last.confirmed === true && $('reply').textContent === 'Sent.',
    'and yes sends the command back, confirmed');

  // Pause and resume, by voice.
  let count = sent.length;
  await say('pause');
  check($('stateLabel').textContent === 'Paused' && /resume/.test($('stateHint').textContent),
    'saying pause pauses voice control, and says how to resume');
  await say('scroll down');
  await say('click contact');
  await say('pause');
  check(sent.length === count, 'paused, commands are ignored');
  await say('resume');
  check($('stateLabel').textContent === 'Listening' && /Resumed/.test($('reply').textContent),
    'saying resume starts it again');
  await say('scroll down');
  check(sent.length === count + 1, 'and commands work again');

  // The older words still work.
  count = sent.length;
  await say('go to sleep');
  check($('stateLabel').textContent === 'Paused', 'go to sleep is the same as pause');
  await say('scroll down');
  check(sent.length === count, 'and ignores commands too');
  await say('wake up');
  check($('stateLabel').textContent === 'Listening', 'wake up is the same as resume');

  // The button is the microphone itself, which voice cannot turn back on.
  check($('btnPause').textContent === 'Microphone off' || $('btnPause').hidden,
    'the button is labelled for what it does: the microphone, not pause');

  // Numbers follow the user to the next page and the next tab.
  await say('show numbers');
  check(!$('numbersChip').hidden, 'with numbers on, the panel says so, and how to turn them off');
  let n = sent.length;
  tabEvents.updated(1, { status: 'complete' });
  await new Promise(res => setTimeout(res, 20));
  check(sent.length === n + 1 && sent[n].cmd.type === 'numbers',
    'when the page beside the panel loads a new page, its numbers are put back');
  n = sent.length;
  tabEvents.updated(2, { status: 'complete' });
  await new Promise(res => setTimeout(res, 20));
  check(sent.length === n, 'but a page loading in some other tab in the background is left alone');
  await say('cancel');
  check(!$('numbersChip').hidden && /Nothing to cancel/.test($('reply').textContent),
    'cancel does not turn the numbers off; only asking for that does');
  await say('no numbers');
  check($('numbersChip').hidden, 'no numbers turns the mode off');
  n = sent.length;
  tabEvents.activated({ tabId: 1 });
  await new Promise(res => setTimeout(res, 20));
  check(sent.length === n, 'and numbers are no longer put on new pages');

  // Chatter.
  const logBefore = $('log').children.length;
  const sentBefore = sent.length;
  await say('so anyway I was telling her about the table in the kitchen');
  check(sent.length === sentBefore && $('log').children.length === logBefore,
    'long speech that is not a command is ignored without a fuss');
  await say('banana');
  check(/not a command/.test($('reply').textContent), 'a short phrase that is not a command gets a hint');

  // Chrome's own pages.
  w.chrome.tabs.sendMessage = (id, msg, cb) => { w.chrome.runtime.lastError = { message: 'no receiver' }; cb(undefined); w.chrome.runtime.lastError = null; };
  tabs[0].url = 'chrome://settings/';
  await say('show numbers');
  check(/Chrome does not let extensions work on this page/.test($('reply').textContent),
    'on a Chrome page, it says why nothing happened and what still works');
  tabs[0].url = 'https://www.epassport.gov.bd/';
  await say('show numbers');
  check(/Say reload/.test($('reply').textContent), 'on a site opened before voice control, it says to reload');
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
}
