// Runs the real content script the way a page does: every module, then
// content.js, then an applySettings message. These are the wiring checks for
// "Describe pictures out loud" — which pictures become focus stops, what is
// spoken, how many requests that costs, and that turning it off hands the page
// back untouched.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

const dom = new JSDOM(`<!DOCTYPE html><html lang="en"><body><main>
  <img id="chart" src="/chart.jpg">
  <a href="/fees"><img id="linked" src="/linked.jpg"></a>
  <img id="decorative" src="/rule.png" alt="">
  <img id="tiny" src="/pixel.gif">
</main></body></html>`, {
  runScripts: 'outside-only', url: 'https://example.gov/fees', pretendToBeVisual: true
});

const { window } = dom;
const doc = window.document;
window.console.log = () => {};   // the modules are chatty

// jsdom does no layout: everything is big enough to matter except #tiny.
window.HTMLImageElement.prototype.getBoundingClientRect = function () {
  const big = this.id !== 'tiny';
  return { width: big ? 300 : 12, height: big ? 200 : 12, top: 10, bottom: 210 };
};

// Capture what would have been spoken, in order, with the language and voice
// chosen for each piece. The voice list is what a Windows Chrome offers.
const voices = [
  { name: 'Microsoft David - English (United States)', lang: 'en-US', default: true },
  { name: 'Google US English', lang: 'en-US' },
  { name: 'Google \u09ac\u09be\u0982\u09b2\u09be', lang: 'bn-BD' }
];
const spoken = [];
// Chrome hands out an empty list until its voices are ready, which is the
// state right after a page loads. `ready` flips when they arrive.
let voicesReady = false;
const voiceListeners = [];
window.speechSynthesis = {
  cancel() {},
  speak(u) {
    spoken.push({ text: u.text, lang: u.lang, voice: u.voice && u.voice.name });
    // A real engine reports when it finishes, and the queue waits for that.
    setTimeout(() => { if (u.onend) u.onend(); }, 0);
  },
  getVoices: () => (voicesReady ? voices : []),
  addEventListener: (name, fn) => { if (name === 'voiceschanged') voiceListeners.push(fn); }
};
const deliverVoices = () => { voicesReady = true; voiceListeners.forEach(fn => fn()); };
window.SpeechSynthesisUtterance = function (text) { this.text = text; };

const listeners = [];
const store = {};        // what the page saves for this site
const ownVoice = [];     // what the bundled engine was asked to speak
let requests = 0;
window.chrome = {
  storage: { local: {
    get: (k, cb) => cb({}),
    set: (o, cb) => { Object.assign(store, o); if (cb) cb(); },
    remove: (k, cb) => { delete store[k]; if (cb) cb(); }
  } },
  runtime: {
    lastError: null,
    onMessage: { addListener: fn => listeners.push(fn) },
    sendMessage: (msg, cb) => {
      if (msg.action === 'speakOffline') { ownVoice.push(msg); return cb && cb({ success: true }); }
      if (msg.action === 'stopOffline') return cb && cb({ success: true });
      if (msg.action === 'aiDescribeImage') {
        requests++;
        return cb && cb({ success: true, text: 'Description number ' + requests });
      }
      if (msg.action === 'aiFetchImage') return cb && cb({ success: true, image: 'data:image/jpeg;base64,AAAA' });
      if (cb) cb({ success: true });
    }
  }
};

for (const f of ['modules/ai-config.js', 'modules/profiles.js', 'modules/blind.js', 'modules/vision.js', 'modules/motor.js',
                 'modules/cognitive.js', 'modules/hearing.js', 'modules/seizure.js', 'modules/speech.js',
                 'modules/neuro.js', 'modules/bangla.js', 'modules/audit.js', 'modules/ai.js', 'content.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const send = msg => new Promise(resolve => listeners[0](msg, {}, resolve));
const settle = () => new Promise(r => setTimeout(r, 150));
const marked = () => Array.from(doc.querySelectorAll('[data-accessiflow-speak]')).map(i => i.id);
const byId = id => doc.getElementById(id);
// `code` matters for the digits: with Shift held, "1" arrives as "!".
// The engine is private to content.js; reach it the way the page does, by
// asking the extension to read something aloud.
const ttsEngineFor = () => ({
  speak: text => {
    const p = doc.createElement('p');
    p.id = 'held';
    p.textContent = text;
    doc.querySelector('main').appendChild(p);
    doc.dispatchEvent(new window.KeyboardEvent('keydown',
      { key: 'R', code: 'KeyR', altKey: true, shiftKey: true, bubbles: true }));
    p.remove();
  }
});

const press = (key, opts) => doc.dispatchEvent(
  new window.KeyboardEvent('keydown', Object.assign({ key, bubbles: true }, opts || {})));

(async () => {
  // ── Speech asked for before Chrome's voices exist ────────────────────────
  // This is what made Bangla silent: a voice was chosen from an empty list,
  // so every language fell back to the default English voice.
  ttsEngineFor().speak('\u09ac\u09be\u0982\u09b2\u09be\u09a6\u09c7\u09b6 \u09a8\u09bf\u09b0\u09cd\u09ac\u09be\u099a\u09a8 \u0995\u09ae\u09bf\u09b6\u09a8 \u099c\u09be\u09a4\u09c0\u09df \u09aa\u09b0\u09bf\u099a\u09df\u09aa\u09a4\u09cd\u09b0\u0964');
  check(spoken.length === 0, 'nothing is said while the voice list is still empty');

  deliverVoices();
  await settle();
  const heldBangla = spoken.find(u => (u.lang || '').indexOf('bn') === 0);
  check(spoken.length > 0, 'the held sentence is spoken once the voices arrive');
  check(heldBangla && heldBangla.voice === 'Google বাংলা',
    'and its Bangla run gets the Bangla voice, not the default: ' +
    (heldBangla && heldBangla.voice));
  spoken.length = 0;

  check(marked().length === 0, 'no picture is a focus stop until the setting is on');

  await send({ action: 'applySettings', data: { speakImageDescriptions: true, blindMode: true } });

  check(marked().includes('chart'), 'a plain picture becomes reachable with Tab');
  check(byId('chart').getAttribute('tabindex') === '0', 'it gets a tabindex of 0');
  check(!marked().includes('linked'),
    'a picture inside a link is left alone: the link already owns that focus stop');
  check(!marked().includes('decorative'), 'a picture marked alt="" stays silent');
  check(!marked().includes('tiny'), 'an icon-sized picture is not worth a focus stop');

  // A keyboard user tabs to the picture and presses Enter.
  byId('chart').focus();
  press('Enter');
  await settle();

  check(spoken[0].text === 'Describing this picture. One moment.',
    'the wait is announced, so a blind user is not left in silence: ' + spoken[0].text);
  check(spoken[1].text === 'Description number 1', 'then the description is spoken: ' + spoken[1].text);
  check(requests === 1, 'that cost exactly one request: ' + requests);
  check(byId('chart').alt === 'Description number 1',
    'the description is written into the picture too, for screen readers');

  // Pressing it again must not pay for the same picture twice.
  spoken.length = 0;
  press('Enter');
  await settle();
  check(requests === 1 && spoken[0].text === 'Description number 1',
    'pressing it again replays the stored description, with no second request');

  // Alt+Shift+D works from a focused link, which pressing cannot.
  spoken.length = 0;
  byId('linked').closest('a').focus();
  press('D', { altKey: true, shiftKey: true });
  await settle();
  check(requests === 2 && spoken[1].text === 'Description number 2',
    'Alt+Shift+D describes the picture inside the focused link: ' + spoken.map(u => u.text).join(' | '));

  // ── Each language in its own voice ───────────────────────────────────────
  // Reading Bangla with an English voice produces nonsense, and the site this
  // was built for declares no language at all, so the text itself has to say.
  const bangla = doc.createElement('p');
  bangla.textContent = '\u09ac\u09be\u0982\u09b2\u09be\u09a6\u09c7\u09b6 \u09a8\u09bf\u09b0\u09cd\u09ac\u09be\u099a\u09a8 \u0995\u09ae\u09bf\u09b6\u09a8 \u099c\u09be\u09a4\u09c0\u09df \u09aa\u09b0\u09bf\u099a\u09df\u09aa\u09a4\u09cd\u09b0 \u09a8\u09ac\u09be\u09df\u09a8 \u09ab\u09bf\u0964';
  doc.querySelector('main').appendChild(bangla);

  spoken.length = 0;
  press('R', { altKey: true, shiftKey: true });   // read this page aloud
  await settle();

  // The tag is region-qualified (bn-BD): bare 'bn' matches no Chrome voice.
  const inBangla = spoken.find(u => (u.lang || '').indexOf('bn') === 0);
  const inEnglish = spoken.find(u => (u.lang || '').indexOf('en') === 0);
  check(Boolean(inBangla), 'Bangla text is spoken as Bangla, not by the default voice');
  check(inBangla && /\u09ac\u09be\u0982\u09b2\u09be/.test(inBangla.text),
    'the Bangla run holds the Bangla words: ' + (inBangla && inBangla.text));
  check(inBangla && inBangla.voice === 'Google \u09ac\u09be\u0982\u09b2\u09be',
    'and it picks an installed Bangla voice: ' + (inBangla && inBangla.voice));
  check(Boolean(inEnglish) && inEnglish.voice !== 'Google \u09ac\u09be\u0982\u09b2\u09be',
    'English on the same page keeps an English voice: ' + (inEnglish && inEnglish.voice));

  // Turning it off hands the page back exactly as it was.
  await send({ action: 'applySettings', data: { speakImageDescriptions: false } });
  check(marked().length === 0 && !byId('chart').hasAttribute('tabindex'),
    'turning it off removes every focus stop it added');

  // ── A computer with no Bangla voice ──────────────────────────────────────
  // Which is every stock Windows machine. Bangla must still be spoken, by
  // the engine bundled in the extension, while English still uses the
  // browser's own voice.
  voices.length = 1;   // leave only the English voice installed
  ownVoice.length = 0;
  spoken.length = 0;

  press('R', { altKey: true, shiftKey: true, code: 'KeyR' });   // read the page aloud
  await settle();

  check(ownVoice.length > 0, 'Bangla is handed to the engine inside the extension');
  check(ownVoice[0] && ownVoice[0].lang === 'bn' && /\u09ac\u09be\u0982\u09b2\u09be/.test(ownVoice[0].text),
    'with the Bangla text: ' + (ownVoice[0] && ownVoice[0].text || 'nothing'));
  check(spoken.some(u => (u.lang || '').indexOf('en') === 0),
    'while English still goes to the browser voice');
  check(!spoken.some(u => /\u09ac\u09be\u0982\u09b2\u09be\u09a6\u09c7\u09b6/.test(u.text)),
    'and no Bangla is sent to a voice that cannot say it');

  // ── Profiles from the keyboard ───────────────────────────────────────────
  // The whole point: someone who cannot see the screen turns on everything
  // their disability needs with one keypress, without opening the panel.
  const saved = () => store['settings_example.gov'] || {};
  const live = () => (doc.getElementById('accessiflow-shortcut-announce') || {}).textContent;

  spoken.length = 0;
  press('9', { altKey: true, shiftKey: true, code: 'Digit9' });
  await settle();
  const listed = spoken.map(u => u.text).join(' ');
  check(/Alt Shift 1, Low vision/.test(listed) && /Alt Shift 2, Screen reader/.test(listed),
    'Alt+Shift+9 reads the profile list, so the shortcuts can be found by ear');

  spoken.length = 0;
  press('2', { altKey: true, shiftKey: true, code: 'Digit2' });
  await settle();
  check(saved().blindMode === true && saved().ttsReadOnSelect === true &&
    saved().speakImageDescriptions === true,
    'Alt+Shift+2 turns on the whole screen reader bundle: ' + JSON.stringify(saved()));
  check(/Screen reader profile on/.test(spoken.map(u => u.text).join(' ')),
    'and says which profile it was, in our own voice');
  check(/Screen reader profile on/.test(live() || ''),
    'and in a live region, for a screen reader already running');

  spoken.length = 0;
  press('1', { altKey: true, shiftKey: true, code: 'Digit1' });
  await settle();
  check(saved().textSize === 130 && saved().highContrast === true && !saved().blindMode,
    'a second profile replaces the first rather than piling on: ' + JSON.stringify(saved()));

  press('8', { altKey: true, shiftKey: true, code: 'Digit8' });
  await settle();
  check(!store['settings_example.gov'], 'Alt+Shift+8 turns everything off and forgets the site');

  console.log('\n=== PASS (' + ok.length + ') ===');
  ok.forEach(m => console.log('  + ' + m));
  if (errors.length) {
    console.log('\n=== FAIL (' + errors.length + ') ===');
    errors.forEach(m => console.log('  ! ' + m));
    process.exit(1);
  }
  console.log('\nAll checks passed.');
})();
