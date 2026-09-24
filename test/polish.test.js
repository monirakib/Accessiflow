// Fixes from user testing: features that did something other than what their
// setting said, left the page changed after they were switched off, or spoke
// when nobody asked. Each is checked for what it does on, and for leaving the
// page exactly as it was once it is off.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }
const wait = ms => new Promise(r => setTimeout(r, ms));

const PAGE = `<!DOCTYPE html><html lang="en"><body>
  <main>
    <h1 id="h1">Market news</h1>
    <p id="dates">The sun sat low on 12 Mar and May 5. You may go on Friday at 10 and 20.</p>
    <p id="idiom" title="Weather note">It is raining cats and dogs today.</p>
    <aside id="side">Related stories</aside>
    <div class="ad" id="ad">Advertisement</div>
    <div class="carousel" id="carousel"><button aria-label="Pause slides" id="pause">Pause</button></div>
    <form id="form">
      <div class="row"><label for="name">Name</label> <input id="name" required></div>
      <div class="row"><label for="email">Email</label> <input id="email" type="email"></div>
      <fieldset><legend>Size</legend><label><input type="radio" name="size" value="s"> S</label><label><input type="radio" name="size" value="l"> L</label></fieldset>
      <div class="row"><label for="phone">Phone</label> <input id="phone" type="tel"></div>
      <button type="submit" id="send">Send</button>
    </form>
    <nav><ul><li><a id="m1" href="#1">One</a></li><li><a id="m2" href="#2">Two</a></li></ul></nav>
    <video id="vid" controls></video>
    <p id="long">${'Words to fill the page. '.repeat(30)}</p>
  </main>
</body></html>`;

const dom = new JSDOM(PAGE, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/news' });
const { window } = dom;
const doc = window.document;
window.console.log = () => {};
window.console.warn = () => {};
window.Element.prototype.getClientRects = function () { return this.isConnected ? [{}] : []; };
window.Element.prototype.getBoundingClientRect = function () {
  return { top: 100, left: 100, width: 200, height: 30, right: 300, bottom: 130, x: 100, y: 100 };
};
Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
window.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
doc.hasFocus = () => true;

const store = {};
const storeListeners = [];
window.chrome = {
  runtime: { id: 'test', sendMessage() {} },
  storage: {
    local: {
      get(key, cb) { const o = {}; [].concat(key).forEach(k => { if (k in store) o[k] = JSON.parse(JSON.stringify(store[k])); }); cb(o); },
      set(items) {
        const changes = {};
        Object.keys(items).forEach(k => { changes[k] = { newValue: items[k] }; store[k] = JSON.parse(JSON.stringify(items[k])); });
        storeListeners.forEach(fn => fn(changes, 'local'));
      }
    },
    onChanged: { addListener: fn => storeListeners.push(fn), removeListener: fn => storeListeners.splice(storeListeners.indexOf(fn), 1) }
  }
};
const said = [];
window.AccessiFlowSpeak = text => { said.push(text); return Promise.resolve(true); };

for (const f of ['modules/color.js', 'modules/overlay.js', 'modules/bangla.js', 'modules/neuro.js', 'modules/cognitive.js',
  'modules/hearing.js', 'modules/vision.js', 'modules/motor.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}
const el = id => doc.getElementById(id);
const shown = e => window.getComputedStyle(e).display !== 'none';

(async () => {
  // ── Bangla numerals and dates ──
  {
    const bangla = new window.BanglaModule();
    const before = el('dates').textContent;
    bangla.apply({ banglaNumbers: true, banglaFormLabels: true });
    const on = el('dates').textContent;
    check(/১২ মার্চ/.test(on) && /মে ৫/.test(on) && /শুক্রবার/.test(on) && /১০ and ২০/.test(on),
      'Bangla numerals change every number in a line, and month and day names in dates: ' + on);
    check(/The sun sat low/.test(on) && /You may go/.test(on),
      'but not ordinary English words that happen to match a short name ("sun", "sat", "you may")');
    check(el('email').placeholder === 'ইমেইল', 'Bangla form labels give a box a Bangla placeholder');
    const hint = doc.querySelector('[data-accessiflow-bn-hint]');
    check(hint && /color: inherit/.test(hint.getAttribute('style')),
      'in the page\'s own text colour, not the bright green that could not be read on white');
    bangla.destroy();
    check(el('dates').textContent === before && el('email').placeholder === '' &&
      !doc.querySelector('[data-accessiflow-bn-num], [data-accessiflow-bn-date], [data-accessiflow-bn-label], [data-accessiflow-bn-hint]'),
      'switched off, every word and placeholder is back and nothing is left on the page');
    bangla.apply({ banglaNumbers: true });
    check(/১২/.test(el('dates').textContent),
      'and switched on again (as happens whenever any other setting changes), it works again');
    bangla.destroy();
  }

  // ── Explain tone keeps the page's own tooltips ──
  {
    const neuro = new window.NeuroModule();
    neuro.applySocialCues(true);
    check(/Raining very heavily/.test(el('idiom').title) && /^Weather note/.test(el('idiom').title),
      'Explain tone explains an idiom, after the element\'s own tooltip: ' + el('idiom').title);
    neuro.applySocialCues(false);
    check(el('idiom').title === 'Weather note', 'and switched off, the page\'s own tooltip is still there: ' + el('idiom').title);
  }

  // ── One question at a time ──
  {
    const cog = new window.CognitiveModule();
    cog.applyFormSteps(true);
    const visible = () => ['name', 'email', 'phone'].filter(id => !el(id).closest('.accessiflow-step-hidden')).join();
    const radiosShown = () => !doc.querySelector('fieldset').classList.contains('accessiflow-step-hidden');
    const bar = doc.querySelector('.accessiflow-form-stepper');
    check(bar && /Question 1 of 4/.test(bar.textContent) && visible() === 'name' && !radiosShown(),
      'One question at a time shows the first question only, and counts a radio group as one: ' + (bar && bar.textContent));
    check(shown(el('send')), 'the send button stays');
    const next = Array.from(bar.querySelectorAll('button')).find(b => b.textContent === 'Next');
    next.click();
    check(visible() === 'name', 'Next does not move on from a required question left empty');
    el('name').value = 'Rakib';
    next.click();
    check(visible() === 'email' && /Question 2 of 4/.test(bar.textContent), 'answered, it moves on: ' + bar.textContent);
    next.click();
    check(radiosShown() && visible() === '', 'the radio group is shown whole');
    cog.applyFormSteps(false);
    check(!doc.querySelector('.accessiflow-form-stepper, .accessiflow-step-hidden'), 'switched off, the whole form is back');
  }

  // ── Simplify the page, and pause moving content ──
  {
    const cog = new window.CognitiveModule();
    let paused = 0;
    el('pause').addEventListener('click', () => { paused++; });
    cog.applySimplifyPage(true);
    cog.applyPauseMedia(true);
    check(!shown(el('side')) && !shown(el('ad')),
      'Simplify the page hides the sidebar and advert inside the main content, where most pages put them');
    check(shown(el('form')) && shown(el('h1')), 'and leaves the heading and the form alone');
    check(paused === 1, 'Pause moving content presses a carousel\'s own pause button');
    check(!!el('accessiflow-pause-carousels'), 'and freezes animation inside carousels');
    cog.applySimplifyPage(false);
    cog.applyPauseMedia(false);
    check(shown(el('side')) && shown(el('ad')) && !el('accessiflow-pause-carousels'), 'both put everything back when off');
  }

  // ── Label audio content ──
  {
    const hearing = new window.HearingModule();
    hearing.toggleCaptionImages(true);
    hearing.toggleCaptionImages(true);   // switched on twice, as a settings change can
    const labels = () => doc.querySelectorAll('[data-accessiflow-media-label]');
    check(labels().length === 1 && /Video without captions/.test(labels()[0].textContent),
      'Label audio content labels a video, once, with whether it has captions: ' + (labels()[0] || {}).textContent);
    const audio = doc.createElement('audio');
    audio.controls = true;
    doc.querySelector('main').appendChild(audio);
    await wait(10);
    check(labels().length === 2, 'and a sound clip added later');
    hearing.toggleCaptionImages(false);
    doc.querySelector('main').appendChild(doc.createElement('video'));
    await wait(10);
    check(labels().length === 0, 'switched off, every label goes, and nothing labels a video added afterwards');
    audio.remove();
  }

  // ── Video subtitles survive a settings change ──
  {
    const hearing = new window.HearingModule();
    const badges = () => doc.querySelectorAll('[data-accessiflow-cc-badge]').length;
    hearing.apply({ closedCaptions: true });
    check(badges() >= 1, 'Turn video subtitles on says when a video has none');
    hearing.destroy();
    check(badges() === 0 && !doc.querySelector('[data-accessiflow-cc-checked]'), 'and leaves nothing behind when off');
    hearing.apply({ closedCaptions: true });
    check(badges() >= 1, 'and still works after being switched off and on, as every settings change does');
    hearing.destroy();
    hearing.apply({ closedCaptions: true, captionImages: true });
    check(badges() === 0 && doc.querySelectorAll('[data-accessiflow-media-label]').length > 0,
      'with Label audio content on, the label says it, rather than two notices on one video');
    hearing.destroy();
  }

  // ── Number the lines leaves no trace ──
  {
    const vision = new window.VisionModule();
    vision.applyLineNumbering(true);
    check(doc.querySelectorAll('.accessiflow-line-number').length > 0, 'Number the lines numbers the paragraphs');
    vision.applyLineNumbering(false);
    check(!el('dates').getAttribute('style'), 'and leaves no style on them afterwards');
  }

  // ── Dim everything else really dims ──
  {
    const vision = new window.VisionModule();
    vision.applyFocusMode(true);
    el('dates').dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    await wait(40);
    const spot = el('accessiflow-focus-spot');
    check(spot && /box-shadow/.test(spot.getAttribute('style')) && /100vmax/.test(spot.getAttribute('style')),
      'Dim everything else darkens the page around the paragraph under the pointer');
    vision.applyFocusMode(false);
    check(!el('accessiflow-focus-spot'), 'and the dimming goes when it is off');
  }

  // ── Hold menu colours: one item, not the whole page ──
  {
    const motor = new window.MotorModule();
    motor.applyStickyHover(true);
    const hover = (a, next) => {
      a.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
      a.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: next || doc.body }));
    };
    hover(el('m1'));
    check(el('m1').classList.contains('accessiflow-sticky-hover'), 'Hold menu colours keeps the last menu item highlighted');
    hover(el('m2'));
    check(!el('m1').classList.contains('accessiflow-sticky-hover') && el('m2').classList.contains('accessiflow-sticky-hover'),
      'and only that one: the one before lets go');
    hover(el('dates'));
    check(!el('dates').classList.contains('accessiflow-sticky-hover'), 'ordinary text is never held');
    motor.applyStickyHover(false);
    check(!doc.querySelector('.accessiflow-sticky-hover') && !el('m2').getAttribute('style'), 'switched off, nothing is left');
  }

  // ── Scroll at the edges scrolls while the pointer rests there ──
  {
    const motor = new window.MotorModule();
    const scrolls = [];
    window.scrollBy = a => { scrolls.push(typeof a === 'object' ? a.top : a); };
    check(motor.buildCSS({ edgeScrolling: true }).indexOf('scroll-behavior') === -1,
      'Scroll at the edges no longer turns on smooth scrolling, which cancelled its own small scrolls');
    motor.applyEdgeScrolling(true);
    doc.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 500, clientY: 795 }));
    await wait(120);
    const n = scrolls.length;
    check(n > 2 && scrolls.every(s => s > 0), 'it keeps scrolling down while the pointer rests at the bottom: ' + n + ' steps');
    doc.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 500, clientY: 400 }));
    await wait(60);
    const m = scrolls.length;
    await wait(60);
    check(scrolls.length === m, 'and stops once the pointer moves away');
    motor.applyEdgeScrolling(false);
  }

  // ── Break reminders: one for the whole browser ──
  {
    const cog = new window.CognitiveModule();
    store.accessiflow_break = { since: Date.now() - 25 * 60000, seen: Date.now() };
    Object.defineProperty(doc, 'hidden', { value: true, configurable: true });
    cog.applyBreakTimer(true, 20);
    await wait(20);
    check(!el('accessiflow-break-reminder') && said.length === 0, 'a tab in the background never shows or says the break reminder');
    cog.applyBreakTimer(false);
    Object.defineProperty(doc, 'hidden', { value: false, configurable: true });
    cog.applyBreakTimer(true, 20);
    await wait(20);
    check(!!el('accessiflow-break-reminder') && said.length === 1, 'the tab in front shows it and says it, once');
    check(Date.now() - store.accessiflow_break.since < 5000, 'and the break is counted for every tab');
    cog.applyBreakTimer(false);
    check(!el('accessiflow-break-reminder') && !el('accessiflow-break-overlay'), 'switched off, the reminder and its dark backdrop both go');
    store.accessiflow_break = { since: Date.now() - 25 * 60000, seen: Date.now() - 60 * 60000 };
    said.length = 0;
    cog.applyBreakTimer(true, 20);
    await wait(20);
    check(!el('accessiflow-break-reminder'), 'an hour away from the browser counts as a break');
    cog.applyBreakTimer(false);
  }

  // ── The focus timer: one count everywhere, said once ──
  {
    const a = new window.NeuroModule();
    store.accessiflow_focus_timer = { start: Date.now() - 26 * 60000, minutes: 25, pausedAt: null, announced: null };
    said.length = 0;
    a.applyFocusTimer(true, 25);
    await wait(1100);
    const timer = el('accessiflow-focus-timer');
    check(timer && /Break/.test(timer.textContent) && said.length === 1, 'the focus timer says the break once: ' + JSON.stringify(said));
    check(!/flash/i.test(fs.readFileSync(path.join(ROOT, 'modules/neuro.js'), 'utf8').slice(0, 9000).replace(/\/\/.*$/gm, '')),
      'and no longer flashes its border');
    a.applyFocusTimer(false);
    const b = new window.NeuroModule();
    b.applyFocusTimer(true, 25);
    await wait(1100);
    check(said.length === 1, 'another tab, or the same one reloaded, does not say it again');
    b.applyFocusTimer(false);
    check(!el('accessiflow-focus-timer'), 'switched off, the timer goes');
  }

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
