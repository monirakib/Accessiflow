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
  <button id="save">Save changes</button>
  <label for="email">Email address</label><input id="email" type="email">
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
const systemVoice = [];  // what went to chrome.tts through the service worker
let requests = 0;
let bulletsReply = null;   // null: the summary helper cannot be reached
const storageListeners = [];
window.chrome = {
  storage: {
    local: {
      get: (k, cb) => {
        const out = {};
        [].concat(k).forEach(key => { if (key in store) out[key] = JSON.parse(JSON.stringify(store[key])); });
        cb(out);
      },
      set: (o, cb) => {
        const changes = {};
        Object.keys(o).forEach(key => { changes[key] = { oldValue: store[key], newValue: o[key] }; });
        Object.assign(store, o);
        storageListeners.forEach(fn => fn(changes, 'local'));
        if (cb) cb();
      },
      remove: (k, cb) => {
        const changes = { [k]: { oldValue: store[k] } };
        delete store[k];
        storageListeners.forEach(fn => fn(changes, 'local'));
        if (cb) cb();
      }
    },
    onChanged: { addListener: fn => storageListeners.push(fn) }
  },
  runtime: {
    id: 'accessiflow-test',
    lastError: null,
    onMessage: { addListener: fn => listeners.push(fn) },
    sendMessage: (msg, cb) => {
      if (msg.action === 'speakOffline') { ownVoice.push(msg); return cb && cb({ success: true }); }
      if (msg.action === 'stopOffline') return cb && cb({ success: true });
      if (msg.action === 'speakSystem') { systemVoice.push(msg); return cb && cb({ success: true, finished: true }); }
      if (msg.action === 'aiDescribeImage') {
        requests++;
        return cb && cb({ success: true, text: 'Description number ' + requests });
      }
      if (msg.action === 'aiFetchImage') return cb && cb({ success: true, image: 'data:image/jpeg;base64,AAAA' });
      if (msg.action === 'aiBullets') {
        return cb && cb(bulletsReply || { success: false, error: 'You appear to be offline.' });
      }
      if (cb) cb({ success: true });
    }
  }
};

// Taken from the manifest rather than listed here, so this test always loads
// exactly what Chrome loads, in the same order. When the two were kept
// separately, adding a module to the manifest left the test quietly exercising
// a build that no longer existed: content.js would catch the missing class,
// warn, and carry on, and the suite stayed green.
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const CONTENT_SCRIPTS = MANIFEST.content_scripts[0].js;

for (const f of CONTENT_SCRIPTS) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

// Every module named in the manifest has to have actually defined its class,
// or content.js silently runs without it.
{
  const expected = {
    'modules/blind.js': 'BlindModule', 'modules/vision.js': 'VisionModule',
    'modules/contrast.js': 'ContrastModule', 'modules/motor.js': 'MotorModule',
    'modules/focus-lock.js': 'FocusLockModule',
    'modules/forms.js': 'FormsModule',
    'modules/cognitive.js': 'CognitiveModule', 'modules/hearing.js': 'HearingModule',
    'modules/seizure.js': 'SeizureModule', 'modules/speech.js': 'SpeechModule',
    'modules/neuro.js': 'NeuroModule', 'modules/bangla.js': 'BanglaModule',
    'modules/audit.js': 'AuditModule', 'modules/ai.js': 'AIModule',
    'modules/overlay.js': 'AccessiFlowOverlay',
    'modules/keyboard-nav.js': 'AccessiFlowKeyboardNav',
    'modules/voice-nav.js': 'VoiceNavModule',
    'modules/screen-reader.js': 'AccessiFlowScreenReader',
    'modules/pointer-dial.js': 'AccessiFlowPointerDial',
    'modules/onscreen-keyboard.js': 'AccessiFlowScreenKeyboard'
  };
  const undefinedClasses = CONTENT_SCRIPTS
    .filter(f => expected[f] && typeof window[expected[f]] !== 'function')
    .map(f => expected[f]);
  check(undefinedClasses.length === 0,
    'every module in the manifest defined its class' +
    (undefinedClasses.length ? ', missing: ' + undefinedClasses.join(', ') : ''));
  check(typeof window.ACCESSIFLOW_COLOR === 'object',
    'the colour helpers loaded before the modules that depend on them');
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

  // ── Reading what you point at ────────────────────────────────────────────
  // The screen-reader behaviour people asked for: point at a button and hear
  // what it is. The dwell matters as much as the speech — without it, crossing
  // the page on the way somewhere else fires an announcement per element.
  await send({ action: 'applySettings', data: { ttsReadOnHover: true, ttsReadOnFocus: true, hoverReadDelay: 150 } });

  spoken.length = 0;
  const hover = el => el.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));

  hover(byId('save'));
  check(spoken.length === 0, 'nothing is said while the pointer is still moving');

  await settle();
  check(spoken[0] && spoken[0].text === 'Save changes, button',
    'resting on a button says what it is: ' + (spoken[0] && spoken[0].text));

  // Pointing at the same thing again must not repeat it.
  spoken.length = 0;
  hover(byId('save'));
  await settle();
  check(spoken.length === 0, 'pointing at the same thing again stays quiet');

  // The keyboard equivalent, which is what a blind user actually uses.
  spoken.length = 0;
  byId('email').focus();
  await settle();
  check(spoken.some(u => /Email address, edit, blank/.test(u.text)),
    'tabbing to a box says its label and that it is empty: ' +
    (spoken.map(u => u.text).join(' | ') || 'nothing'));

  // Off means off: no listeners left behind.
  await send({ action: 'applySettings', data: {} });
  spoken.length = 0;
  hover(byId('save'));
  await settle();
  check(spoken.length === 0, 'turning it off stops the announcements');

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
  // their disability needs with one keypress, without opening the panel. It
  // goes into their setup, so it holds on every site from then on.
  const setup = () => store.accessiflow_setup || { needs: [], settings: {} };
  const site = () => store['settings_example.gov'] || {};
  const live = () => (doc.getElementById('accessiflow-shortcut-announce') || {}).textContent;

  spoken.length = 0;
  press('9', { altKey: true, shiftKey: true, code: 'Digit9' });
  await settle();
  const listed = spoken.map(u => u.text).join(' ');
  check(/Alt Shift R, Read this page aloud/.test(listed) && /Alt Shift B, Summarise/.test(listed) &&
    /Ctrl, Stop reading/.test(listed),
    'Alt+Shift+9 reads the main keys, so they can be found by ear: ' + listed.slice(0, 120));

  spoken.length = 0;
  press('2', { altKey: true, shiftKey: true, code: 'Digit2' });
  await settle();
  check(setup().needs.join(',') === 'blind' && setup().settings.blindMode === true &&
    setup().settings.ttsReadOnSelect === true && setup().settings.speakImageDescriptions === true,
    'Alt+Shift+2 adds the whole screen reader bundle to the setup: ' + JSON.stringify(setup()));
  check(!('ttsReadOnSelect' in site()), 'into the setup, for every site, not into this site');
  check(/Screen reader added to your setup, on every site/.test(spoken.map(u => u.text).join(' ')),
    'and says which profile it was, in our own voice');
  check(/Screen reader added/.test(live() || ''),
    'and in a live region, for a screen reader already running');
  const applied = await send({ action: 'getSettings' });
  check(applied.data.speakImageDescriptions === true, 'and the page applies it at once');

  spoken.length = 0;
  press('1', { altKey: true, shiftKey: true, code: 'Digit1' });
  await settle();
  check(setup().needs.join(',') === 'blind,visual' && setup().settings.textSize === 130 &&
    setup().settings.blindMode === true,
    'a second profile adds to the first rather than wiping it: ' + JSON.stringify(setup().needs));

  press('8', { altKey: true, shiftKey: true, code: 'Digit8' });
  await settle();
  check(site()._off === true, 'Alt+Shift+8 pauses AccessiFlow on this site only');
  check(!doc.getElementById('accessiflow-dynamic').textContent, 'and the page goes back to how the site made it');
  check(setup().needs.length === 2, 'while the setup, for every other site, is untouched');
  check(/paused on this site/.test(spoken.map(u => u.text).join(' ')), 'and it says so');
  press('8', { altKey: true, shiftKey: true, code: 'Digit8' });
  await settle();
  check(!site()._off && (await send({ action: 'getSettings' })).data.textSize === 130,
    'pressing it again brings the setup back here');

  // Clear the setup so the checks below start from the defaults again.
  window.chrome.storage.local.remove('accessiflow_setup');
  await settle();
  check((await send({ action: 'getSettings' })).data.textSize === 100,
    'a setup removed in another tab reaches this page too');

  // ── The built-in screen reader ───────────────────────────────────────────
  {
    const Reader = window.AccessiFlowScreenReader;
    spoken.length = 0;
    press('Z', { altKey: true, shiftKey: true, code: 'KeyZ' });
    await settle();
    check(Reader.ownsKeys(), 'Alt+Shift+Z turns the screen reader on');
    check(store.accessiflowScreenReader === true && !(store['settings_example.gov'] || {}).screenReader,
      'for every website, in its own key, not in this site\'s settings');
    check(/Screen reader on\./.test(spoken.map(u => u.text).join(' ')),
      'and it introduces itself in our voice: ' + (spoken[0] && spoken[0].text));

    const settings = await send({ action: 'getSettings' });
    check(settings.data.screenReader === true, 'the popup is told it is on');

    // Focus was left in a text box by the checks above, which is focus mode.
    // Leaving it for nowhere has to hand the arrows back to the reader.
    check(Reader._current.mode === 'focus', 'focus left in a text box means focus mode');
    doc.activeElement.blur();
    await settle();
    check(Reader._current.mode === 'browse', 'and when focus leaves it for nowhere, browse mode is back');
    const arrow = new window.KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true });
    doc.body.dispatchEvent(arrow);
    check(arrow.defaultPrevented, 'and the arrow keys now read the page instead of scrolling it');

    await send({ action: 'applySettings', data: { textSize: 120 } });
    check(Reader.ownsKeys(), 'changing some other setting on this site leaves it on');

    // Another tab switched it off.
    storageListeners.forEach(fn => fn({ accessiflowScreenReader: { oldValue: true, newValue: false } }, 'local'));
    check(!Reader.ownsKeys(), 'switched off in another tab, it goes off here too');
    storageListeners.forEach(fn => fn({ accessiflowScreenReader: { oldValue: false, newValue: true } }, 'local'));
    check(Reader.ownsKeys(), 'and back on the same way');

    spoken.length = 0;
    press('Z', { altKey: true, shiftKey: true, code: 'KeyZ' });
    await settle();
    check(!Reader.ownsKeys() && store.accessiflowScreenReader === false, 'Alt+Shift+Z turns it off again');
    check(spoken.some(u => u.text === 'Screen reader off.'), 'and says so');
  }

  // ── Speech before the user has pressed anything on the page ──────────────
  // Chrome answers speechSynthesis with "not-allowed" until then (measured in
  // Chrome with raw CDP), so a page just arrived at would be silent.
  {
    Object.defineProperty(window.navigator, 'userActivation',
      { value: { hasBeenActive: false }, configurable: true });
    spoken.length = 0;
    systemVoice.length = 0;
    storageListeners.forEach(fn => fn({ accessiflowScreenReader: { oldValue: false, newValue: true } }, 'local'));
    await settle();
    check(systemVoice.length > 0 && spoken.length === 0,
      'before any key press, speech goes through the computer\'s voices in the extension, not the page: ' +
      (systemVoice[0] && systemVoice[0].text));
    check(systemVoice[0] && systemVoice[0].lang === 'en-US', 'in the language of the text');
    storageListeners.forEach(fn => fn({ accessiflowScreenReader: { oldValue: true, newValue: false } }, 'local'));

    // Activation arrives, but Chrome still refuses one sentence.
    Object.defineProperty(window.navigator, 'userActivation',
      { value: { hasBeenActive: true }, configurable: true });
    const realSpeak = window.speechSynthesis.speak;
    window.speechSynthesis.speak = u => setTimeout(() => u.onerror && u.onerror({ error: 'not-allowed' }), 0);
    spoken.length = 0;
    systemVoice.length = 0;
    await send({ action: 'applySettings', data: {} });
    const p = doc.createElement('p');
    p.textContent = '\u09ac\u09be\u0982\u09b2\u09be\u09a6\u09c7\u09b6 \u09a8\u09bf\u09b0\u09cd\u09ac\u09be\u099a\u09a8 \u0995\u09ae\u09bf\u09b6\u09a8';
    doc.body.appendChild(p);
    press('R', { altKey: true, shiftKey: true, code: 'KeyR' });
    await settle();
    window.speechSynthesis.speak = realSpeak;
    p.remove();
    check(systemVoice.length > 0, 'a "not-allowed" refusal is retried through the extension');
    check(!/voice installed/.test(spoken.map(u => u.text).join(' ') + systemVoice.map(m => m.text).join(' ')),
      'and is not mistaken for a missing Bangla voice');
  }

  // ── Every voice is the user's voice ──────────────────────────────────────
  {
    await send({ action: 'applySettings', data: { ttsRate: 1.5 } });
    spoken.length = 0;
    window.SpeechModule.say('Yes please');
    await settle();
    check(spoken.some(u => u.text === 'Yes please' && /David/.test(u.voice || '')),
      'the picture board speaks through the same engine as everything else: ' +
      JSON.stringify(spoken[0] || null));
  }

  // ── Stop ──────────────────────────────────────────────────────────────────
  // Real speech takes time. The stub finishes every sentence at once, so it is
  // held open here, the way a long page is.
  {
    const realSpeak = window.speechSynthesis.speak;
    const realCancel = window.speechSynthesis.cancel;
    let held = [];
    let cancels = 0;
    window.speechSynthesis.speak = u => { spoken.push({ text: u.text }); held.push(u); };
    window.speechSynthesis.cancel = () => {
      cancels++;
      const was = held; held = [];
      was.forEach(u => setTimeout(() => u.onend && u.onend(), 0));
    };
    const stopHost = () => doc.getElementById('accessiflow-sr-stop');
    const stopShown = () => Boolean(stopHost()) && stopHost().style.display !== 'none';

    await send({ action: 'applySettings', data: {} });
    press('R', { altKey: true, shiftKey: true, code: 'KeyR' });
    await settle();
    check(!stopShown(), 'no Stop button in the first moment of speech');
    await new Promise(r => setTimeout(r, 1100));
    check(stopShown(), 'a floating Stop button appears once reading has gone on for a second');
    const button = stopHost() && stopHost().shadowRoot &&
      stopHost().shadowRoot.querySelector('button[data-action="stop"]');
    check(button && /Stop reading/.test(button.textContent), 'it is a real button, named Stop reading');
    const pauseButton = stopHost().shadowRoot.querySelector('button[data-action="pause"]');
    check(pauseButton && /^Pause/.test(pauseButton.textContent) && /Shift/.test(pauseButton.getAttribute('aria-label')),
      'with a Pause button beside it, which names its key: ' + (pauseButton && pauseButton.getAttribute('aria-label')));

    const before = cancels;
    press('Control', { code: 'ControlLeft' });
    await settle();
    check(cancels > before && !stopShown(), 'Ctrl on its own stops the reading, and the button goes');

    const idle = cancels;
    press('Control', { code: 'ControlLeft' });
    check(cancels === idle, 'Ctrl while nothing is being said does nothing at all');

    press('R', { altKey: true, shiftKey: true, code: 'KeyR' });
    await new Promise(r => setTimeout(r, 1100));
    button.click();
    await settle();
    check(!stopShown() && held.length === 0, 'the floating button stops it too');

    press('R', { altKey: true, shiftKey: true, code: 'KeyR' });
    await settle();
    await send({ action: 'ttsStop' });
    check(held.length === 0, 'and so does the popup\'s Stop');

    // ── Pause, and carry on from the same place ────────────────────────────
    const release = (key, opts) => doc.dispatchEvent(
      new window.KeyboardEvent('keyup', Object.assign({ key, bubbles: true }, opts || {})));
    const tapShift = () => { press('Shift', { code: 'ShiftLeft', shiftKey: true }); release('Shift', { code: 'ShiftLeft' }); };
    const pauseLabel = () => pauseButton.textContent;
    const long = 'The office opens at nine on weekdays and at ten on Saturdays. ' +
      'Second, bring the letter we sent you, and a photo ID that shows your address. ' +
      'Third, if you need an interpreter, ask when you book and we will arrange one. ' +
      'Fourth, parking is free for the first two hours, behind the main building. ' +
      'Last, you can cancel up to a day before without any charge.';
    let finished = null;
    spoken.length = 0;
    window.AccessiFlowSpeak(long).then(v => { finished = v; });
    await settle();
    check(held.length === 1 && spoken.length === 1 && spoken[0].text.length < long.length,
      'a long text is read in stretches of a few sentences: ' + (spoken[0] && spoken[0].text.length) + ' of ' + long.length + ' characters');
    const firstRun = held[0].text;
    const at = firstRun.indexOf('bring the letter');
    held[0].onboundary({ name: 'word', charIndex: at });   // the voice has reached "bring"

    const beforePause = cancels;
    tapShift();
    await settle();
    check(cancels > beforePause && held.length === 0, 'Shift on its own pauses: the voice stops at once');
    check(finished === null, 'while whoever asked for the speech keeps waiting, as the screen reader\'s read-all does');
    check(stopShown() && /^Carry on/.test(pauseLabel()), 'the buttons stay, and Pause becomes Carry on');

    spoken.length = 0;
    tapShift();
    await settle();
    check(spoken[0] && spoken[0].text.indexOf('bring the letter') === 0,
      'Shift again carries on from the word it stopped on: ' + (spoken[0] && spoken[0].text.slice(0, 40)));
    check(/^Pause/.test(pauseLabel()), 'and the button says Pause again');

    // Let the voice finish every stretch; the waiting caller hears it ended.
    for (let i = 0; i < 10 && finished === null; i++) {
      const u = held.shift();
      if (u && u.onend) u.onend();
      await new Promise(r => setTimeout(r, 5));
    }
    check(finished === true, 'and the read finishes as if it had never been interrupted');

    // A quick double tap: the stopped sentence reports that it ended only
    // after the resume. That late report must not end the read, or the
    // screen reader's read-all would stop at the next line.
    {
      const heldCancel = window.speechSynthesis.cancel;
      const lateEnds = [];
      window.speechSynthesis.cancel = () => { cancels++; lateEnds.push.apply(lateEnds, held); held = []; };
      let late = null;
      window.AccessiFlowSpeak(long).then(v => { late = v; });
      await settle();
      tapShift();
      tapShift();
      await settle();
      lateEnds.forEach(u => u.onend && u.onend());
      await settle();
      check(late === null && held.length === 1,
        'a quick double tap of Shift cannot end the read early, even when the stopped sentence reports in late');
      window.speechSynthesis.cancel = heldCancel;
      for (let i = 0; i < 10 && late === null; i++) {
        const u = held.shift();
        if (u && u.onend) u.onend();
        await new Promise(r => setTimeout(r, 5));
      }
      check(late === true, 'and it still finishes normally');
    }

    // Shift used with another key is not a pause.
    window.AccessiFlowSpeak(long);
    await settle();
    const typing = cancels;
    press('Shift', { code: 'ShiftLeft', shiftKey: true });
    press('Tab', { code: 'Tab', shiftKey: true });
    release('Shift', { code: 'ShiftLeft' });
    await settle();
    check(cancels === typing && held.length === 1, 'Shift+Tab, a capital letter or Alt+Shift never pauses');

    // Paused, then Ctrl: that is a stop, and the caller is told it ended early.
    let stopped = null;
    window.AccessiFlowSpeak(long).then(v => { stopped = v; });
    await settle();
    tapShift();
    await settle();
    press('Control', { code: 'ControlLeft' });
    await settle();
    check(stopped === false && !stopShown(), 'Ctrl while paused stops for good, and the buttons go');
    tapShift();
    await settle();
    check(held.length === 0, 'after which Shift has nothing to carry on');

    // The same from the buttons, for anyone reading with the mouse.
    window.AccessiFlowSpeak(long);
    await new Promise(r => setTimeout(r, 1100));
    pauseButton.click();
    await settle();
    check(held.length === 0 && /^Carry on/.test(pauseLabel()), 'the Pause button pauses');
    spoken.length = 0;
    pauseButton.click();
    await settle();
    check(held.length === 1 && spoken.length === 1, 'and Carry on carries on');
    await send({ action: 'ttsStop' });

    // ── Key echo ───────────────────────────────────────────────────────────
    await send({ action: 'applySettings', data: { keyEcho: 'letters' } });
    spoken.length = 0;
    const box = byId('email');
    box.focus();
    box.value = 'a';
    box.dispatchEvent(new window.InputEvent('input', { inputType: 'insertText', data: 'a', bubbles: true }));
    box.value = 'aB';
    box.dispatchEvent(new window.InputEvent('input', { inputType: 'insertText', data: 'B', bubbles: true }));
    await settle();
    check(spoken.map(u => u.text).join('|') === 'a|cap B',
      'with key echo on, each typed key is spoken: ' + spoken.map(u => u.text).join(' | '));
    await new Promise(r => setTimeout(r, 1100));
    check(!stopShown(), 'and a typed key never brings up the Stop button, however long it lingers');
    const echoCancels = cancels;
    tapShift();
    check(cancels === echoCancels, 'nor can a typed key be paused: there is nothing to carry on');
    window.speechSynthesis.cancel();

    await send({ action: 'applySettings', data: {} });
    spoken.length = 0;
    box.dispatchEvent(new window.InputEvent('input', { inputType: 'insertText', data: 'c', bubbles: true }));
    await settle();
    check(spoken.length === 0, 'and with it off, typing is silent');

    window.speechSynthesis.speak = realSpeak;
    window.speechSynthesis.cancel = realCancel;
  }

  // ── Every form gets a summary; read out only with the reader on ──────────
  {
    const addForm = (id, a, b) => {
      const form = doc.createElement('form');
      form.id = id;
      form.innerHTML = '<label for="' + id + '-a">' + a + '</label><input id="' + id + '-a" required>' +
        '<label for="' + id + '-b">' + b + '</label><input id="' + id + '-b" type="date" required>';
      doc.querySelector('main').appendChild(form);
      return form;
    };
    const booking = addForm('booking', 'Full name', 'Appointment date');
    await settle();
    spoken.length = 0;
    byId('booking-a').focus();
    await settle();
    const panel = booking.previousElementSibling;
    // The skip link needs <main> to have an id. One starting "accessiflow-"
    // made every module treat the whole page as AccessiFlow's own UI, and
    // this summary was never shown.
    const mainId = doc.querySelector('main').id;
    check(mainId && mainId.indexOf('accessiflow-') !== 0 &&
      doc.querySelector('a.accessiflow-skip-link').getAttribute('href') === '#' + mainId,
      'the skip link target on <main> does not look like AccessiFlow\'s own furniture: #' + mainId);
    check(panel && panel.classList.contains('accessiflow-form-brief') &&
      /Full name and Appointment date\. All of them are required\./.test(panel.textContent),
      'a two-question form gets a summary with no setting turned on: ' +
      (panel && panel.querySelector('.accessiflow-form-brief-text').textContent));
    check(!spoken.some(u => /Before you start this form/.test(u.text)),
      'with the built-in screen reader off, it is shown and not read out');

    const renewal = addForm('renewal', 'Licence holder', 'Expiry date');
    storageListeners.forEach(fn => fn({ accessiflowScreenReader: { oldValue: false, newValue: true } }, 'local'));
    await settle();
    spoken.length = 0;
    byId('renewal-a').focus();
    await settle();
    await settle();
    const heard = spoken.map(u => u.text);
    const fieldAt = heard.findIndex(t => /Licence holder/.test(t) && !/Before you start/.test(t));
    const briefAt = heard.findIndex(t => /^Before you start this form\. It has 2 questions/.test(t));
    check(briefAt > -1, 'with the built-in screen reader on, it is read out: ' + (heard[briefAt] || heard.join(' | ')));
    check(fieldAt > -1 && fieldAt < briefAt,
      'after the name of the field focus landed on, not over it: ' + heard.join(' | '));
    storageListeners.forEach(fn => fn({ accessiflowScreenReader: { oldValue: true, newValue: false } }, 'local'));
    doc.activeElement.blur();
    [booking, renewal].forEach(f => { if (f.previousElementSibling && f.previousElementSibling.classList.contains('accessiflow-form-brief')) f.previousElementSibling.remove(); f.remove(); });
    await settle();
  }

  // ── Summarise, out loud ───────────────────────────────────────────────────
  {
    spoken.length = 0;
    bulletsReply = null;   // the helper cannot be reached
    const outline = await send({ action: 'summarizeAloud' });
    await settle();
    const heard = spoken.map(u => u.text).join(' ');
    check(outline.kind === 'outline', 'with no helper, the summary falls back to an outline of the page');
    check(/not enough text on this page/.test(heard) && !/Here is an outline instead/.test(heard),
      'on a page with too little text for either, it says so plainly, once: ' + heard.slice(0, 160));

    const h2 = doc.createElement('h2');
    h2.textContent = 'Opening hours';
    const note = doc.createElement('p');
    note.textContent = 'The office opens at nine every weekday and closes at five, except on public holidays.';
    doc.querySelector('main').append(h2, note);
    spoken.length = 0;
    await send({ action: 'summarizeAloud' });
    await settle();
    const outlined = spoken.map(u => u.text).join(' ');
    check(/Here is an outline instead\. It has 1 heading, starting with: Opening hours\. It begins: The office opens/.test(outlined),
      'with some text but no helper, it reads an outline built from the page, saying why: ' + outlined.slice(0, 200));
    const panel = doc.getElementById('accessiflow-page-summary');
    check(panel && /Opening hours/.test(panel.textContent), 'and shows it at the top of the page too');
    h2.remove();
    note.remove();

    const article = doc.createElement('article');
    article.innerHTML = '<h1>Fees</h1><p>' + 'Passport fees depend on the number of pages and how fast you need it. '.repeat(6) + '</p>';
    doc.querySelector('main').appendChild(article);
    bulletsReply = { success: true, bullets: ['Fees depend on pages.', 'Faster costs more.', 'Pay online.'] };
    spoken.length = 0;
    const summary = await send({ action: 'summarizeAloud' });
    await settle();
    check(summary.kind === 'bullets' && summary.bullets.length === 3, 'with the helper, it gives the key points');
    check(spoken.some(u => /^The key points\. Fees depend on pages\./.test(u.text)),
      'and reads them out: ' + (spoken.map(u => u.text).join(' | ')).slice(0, 160));

    spoken.length = 0;
    press('B', { altKey: true, shiftKey: true, code: 'KeyB' });
    await settle();
    check(spoken.some(u => /^The key points/.test(u.text)), 'Alt+Shift+B does the same from the keyboard');
    article.remove();
  }

  // ── A change to the setup reaches pages already open ─────────────────────
  {
    window.chrome.storage.local.set({ accessiflow_setup: { v: 1, needs: [], settings: { textSize: 150, keyEcho: 'words' } } });
    await settle();
    const now = (await send({ action: 'getSettings' })).data;
    check(now.textSize === 150 && now.keyEcho === 'words',
      'a setup saved in the popup or the setup page applies here without a reload');
    check(now.focusLock === true, 'on top of the defaults, so default-on settings are really on');
    window.chrome.storage.local.set({ 'settings_example.gov': { _v: 2, textSize: 110 } });
    await settle();
    check((await send({ action: 'getSettings' })).data.textSize === 110,
      'and this site\'s own exception wins over the setup');
  }

  // ── The hold-click menu and the keyboard follow the setup ────────────────
  {
    window.chrome.storage.local.set({ accessiflow_setup: { v: 1, needs: [], settings: { holdDial: true, onScreenKeyboard: true } } });
    window.chrome.storage.local.set({ 'settings_example.gov': { _v: 2 } });
    await settle();
    const board = doc.getElementById('accessiflow-keyboard');
    check(board && board.style.display !== 'none',
      'turning the on-screen keyboard on in the setup shows it on pages already open');
  }

  // ── Cut off by an update ─────────────────────────────────────────────────
  // What Chrome does to the copy left in an open tab when AccessiFlow is
  // updated or reloaded: its connection to the extension goes.
  {
    const id = window.chrome.runtime.id;
    delete window.chrome.runtime.id;
    window.dispatchEvent(new window.Event('focus'));
    check(!doc.getElementById('accessiflow-keyboard'),
      'a copy cut off by an update clears its keyboard away as soon as the tab is used');
    const toast = doc.getElementById('accessiflow-hand-toast');
    check(toast && /updated\. Reload this page/.test(toast.shadowRoot.textContent),
      'and says to reload the page, rather than leaving half-working tools behind');
    window.chrome.runtime.id = id;
  }

  console.log('\n=== PASS (' + ok.length + ') ===');
  ok.forEach(m => console.log('  + ' + m));
  if (errors.length) {
    console.log('\n=== FAIL (' + errors.length + ') ===');
    errors.forEach(m => console.log('  ! ' + m));
    process.exit(1);
  }
  console.log('\nAll checks passed.');
})();
