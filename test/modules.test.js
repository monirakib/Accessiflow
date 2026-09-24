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

// ── Dictating into a form ───────────────────────────────────────────────────
// The old version replaced the whole field with each utterance, stopped after
// one phrase, and wrote half-recognised words into the form. Each of those is
// checked here, because each one made it useless for the people it is for.
{
  const page = new JSDOM(`<!DOCTYPE html><html lang="en"><body>
    <input id="name" type="text" value="Monir ">
    <textarea id="notes"></textarea>
    <input id="secret" type="password">
  </body></html>`, { url: 'https://forms.gov/', runScripts: 'outside-only' });
  const win = page.window;
  const doc = win.document;

  // A fake recogniser, so the test needs no microphone and no network.
  const started = [];
  let live = null;
  win.SpeechRecognition = function () {
    this.continuous = false;
    this.interimResults = false;
    this.lang = '';
    this.start = () => { started.push(this.lang); live = this; };
    this.stop = () => { if (this.onend) this.onend(); };
  };
  // The module attaches itself to a window, so it is loaded inside this page
  // rather than required: that is how the browser loads it too.
  win.eval(fs.readFileSync(path.join(ROOT, 'modules/speech.js'), 'utf8'));
  const speech = new win.SpeechModule();
  speech._log = () => {};
  speech._warn = () => {};

  speech.applySpeechToText(true, { dictationLanguage: 'en-US' });
  check(Boolean(doc.getElementById('accessiflow-dictation')),
    'a dictation bar is made, so what is being heard is not typed into the form');
  check(doc.getElementById('accessiflow-dictation').style.display === 'none',
    'but it stays out of sight while you are not in a box, rather than sitting over every page');

  doc.getElementById('name').focus();
  check(doc.getElementById('accessiflow-dictation').style.display === 'flex',
    'and shows once you are in a box it can fill');
  speech.startDictation();
  check(started.length === 1 && started[0] === 'en-US',
    'it listens in the language chosen: ' + started.join(', '));
  check(live.continuous === true,
    'it keeps listening, rather than stopping after one phrase');

  // Speaking adds to what is already there, at the cursor.
  const say = (text, isFinal) => live.onresult({
    resultIndex: 0,
    results: [Object.assign([{ transcript: text }], { isFinal: isFinal !== false, length: 1 })]
  });

  say('Rakib');
  check(doc.getElementById('name').value === 'Monir Rakib',
    'dictated words join what was already typed: "' + doc.getElementById('name').value + '"');

  say('full stop');
  check(doc.getElementById('name').value === 'Monir Rakib.',
    'a spoken full stop becomes punctuation, not the word: "' + doc.getElementById('name').value + '"');

  say('delete that');
  check(doc.getElementById('name').value === 'Monir Rakib',
    '"delete that" takes back the last thing said: "' + doc.getElementById('name').value + '"');

  // Half-heard words stay out of the form.
  const before = doc.getElementById('name').value;
  say('Rak', false);
  check(doc.getElementById('name').value === before,
    'words still being recognised never reach the field');
  check(/Rak/.test(doc.getElementById('accessiflow-dictation-status').textContent),
    'they are shown in the bar instead');

  say('stop dictation');
  check(speech._dictation.listening === false, '"stop dictation" stops it');

  // Turning the setting off puts the page back.
  speech.applySpeechToText(false);
  check(!doc.getElementById('accessiflow-dictation'), 'turning it off removes the bar');
}

// ── What gets said about one element ────────────────────────────────
// Pointing at a button has to say the button, not the card it sits in, and a
// control has to say what it is and what state it is in. This is the whole
// feature, so it is checked against the markup real pages use.
{
  const naming = require(path.join(ROOT, 'modules/naming.js'));
  const page = new JSDOM(`<!DOCTYPE html><html lang="en"><body>
    <div class="card"><button id="save">Save changes</button></div>
    <a id="home" href="/">Home</a>
    <label for="email">Email address</label><input id="email" type="email">
    <input id="filled" type="text" aria-label="Search" value="fees">
    <input id="agree" type="checkbox" checked aria-label="Accept terms">
    <button id="menu" aria-expanded="false">Menu</button>
    <button id="off" disabled>Delete</button>
    <h2 id="title">Fees</h2>
    <img id="photo" src="/p.jpg" alt="Voters queueing">
    <img id="spacer" src="/s.gif" alt="">
    <a id="icononly" href="/x"><img src="/i.png" alt="Print this page"></a>
    <button id="nameless"><span></span></button>
    <p id="para">Fees are due by September.</p>
    <div id="accessiflow-shortcut-announce">our own furniture</div>
  </body></html>`).window.document;
  const say = id => naming.describeElement(page.getElementById(id));

  check(say('save') === 'Save changes, button', 'a button: ' + say('save'));
  check(say('home') === 'Home, link', 'a link: ' + say('home'));
  check(say('email') === 'Email address, edit, blank',
    'an empty box says so, rather than going quiet: ' + say('email'));
  check(say('filled') === 'Search, edit, fees', 'a box with something in it: ' + say('filled'));
  check(say('agree') === 'Accept terms, check box, checked', 'a ticked box: ' + say('agree'));
  check(say('menu') === 'Menu, button, collapsed', 'a menu that is shut: ' + say('menu'));
  check(/unavailable/.test(say('off')), 'a button you cannot press: ' + say('off'));
  check(say('title') === 'Fees, heading level 2', 'a heading says its level: ' + say('title'));
  check(say('photo') === 'Voters queueing, graphic', 'a picture: ' + say('photo'));
  check(say('icononly') === 'Print this page, link',
    'an icon-only link is named by its picture: ' + say('icononly'));
  check(say('nameless') === 'unlabelled button',
    'a control with no name says so, because that is a fault worth hearing: ' + say('nameless'));
  check(say('para') === 'Fees are due by September.', 'plain text is just read');
  check(say('spacer') === '', 'a picture marked decorative stays silent');
  check(say('accessiflow-shortcut-announce') === '',
    'AccessiFlow never announces its own furniture back at the user');

  // Pointing lands on the word inside the button, not the button.
  const inside = page.getElementById('save').firstChild;
  check(naming.describeElement(inside) === 'Save changes, button',
    'pointing at the text inside a button announces the button');

  // aria-labelledby wins over the text, the way a screen reader reads it.
  const aria = new JSDOM(`<!DOCTYPE html><body>
    <span id="lbl">Postcode</span>
    <input id="pc" aria-labelledby="lbl" aria-label="ignored">
  </body>`).window.document;
  check(naming.accessibleName(aria.getElementById('pc')) === 'Postcode',
    'aria-labelledby is preferred over aria-label');
}

// ── The manifest itself ───────────────────────────────────────────
// Chrome shows an error for any key it does not recognise, and JSON has no
// comments to explain a setting in, which is how one got in here.
{
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const allowed = ['manifest_version', 'name', 'version', 'description', 'permissions',
    'host_permissions', 'action', 'icons', 'content_scripts', 'background',
    'content_security_policy', 'commands', 'web_accessible_resources', 'options_page',
    'default_locale', 'minimum_chrome_version', 'offline_enabled', 'short_name', 'author', 'side_panel'];
  const unknown = Object.keys(manifest).filter(key => allowed.indexOf(key) === -1);
  check(unknown.length === 0, 'every manifest key is one Chrome knows: ' + (unknown.join(', ') || 'yes'));

  // Every file the manifest points at has to exist, or the extension will
  // not load at all on somebody else's computer.
  const referenced = []
    .concat(Object.values(manifest.icons || {}))
    .concat(Object.values((manifest.action || {}).default_icon || {}))
    .concat([manifest.action && manifest.action.default_popup, manifest.background.service_worker])
    .concat([(manifest.side_panel || {}).default_path])
    .concat((manifest.content_scripts || []).reduce((all, cs) =>
      all.concat(cs.js || [], cs.css || []), []))
    .filter(Boolean);
  const missing = referenced.filter(file => !fs.existsSync(path.join(ROOT, file)));
  check(missing.length === 0, 'every file the manifest names exists: ' + (missing.join(', ') || 'yes'));

  // The speech engines are WebAssembly, so extension pages must be allowed to
  // run it; without this the offscreen document fails silently.
  const csp = (manifest.content_security_policy || {}).extension_pages || '';
  check(/wasm-unsafe-eval/.test(csp), 'extension pages may run the speech engines: ' + csp);
  check((manifest.permissions || []).indexOf('offscreen') > -1,
    'the offscreen document is permitted, which is where speech happens');
}

// ── The natural Bangla voice ──────────────────────────────────────
// The model turns phonemes into sound, so what goes in has to be exactly the
// scheme it was trained on, and what comes out has to be a file a browser can
// play. Both are pure functions, checked here; the model itself is not.
{
  const voice = require(path.join(ROOT, 'piper.js'));
  const config = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'vendor/piper/bn_BD-google-medium.onnx.json'), 'utf8'));

  // Piper's scheme: start, then every phoneme followed by a pad, then end.
  const map = { '^': [1], '_': [0], '$': [2], a: [10], b: [11] };
  check(voice.phonemeIds('ab', map).join(',') === '1,10,0,11,0,2',
    'phonemes become start, phoneme, pad, ..., end: ' + voice.phonemeIds('ab', map).join(','));
  check(voice.phonemeIds('aQb', map).join(',') === '1,10,0,11,0,2',
    'a sound the voice does not know is dropped, not guessed at');

  // The real voice table, with phonemes eSpeak actually produced for Bangla.
  const real = voice.phonemeIds('b\u02c8a\u014bladˌe\u0283', config.phoneme_id_map);
  check(real.length > 10 && real[0] === 1,
    'real Bangla phonemes map onto the voice table: ' + real.length + ' ids');

  // Samples in, a playable WAV out.
  const samples = new Float32Array(2205);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 8) * 0.5;
  const wav = voice.floatsToWav(samples, 22050);
  const header = String.fromCharCode(wav[0], wav[1], wav[2], wav[3]);
  check(header === 'RIFF', 'the sound is a WAV file: ' + header);
  check(wav.length === 44 + samples.length * 2,
    'header plus 16-bit samples: ' + wav.length + ' bytes');
  const view = new DataView(wav.buffer, wav.byteOffset);
  check(view.getUint32(24, true) === 22050,
    'at the rate the voice was trained on: ' + view.getUint32(24, true) + ' Hz');

  const loud = new Float32Array([2, -2]);     // beyond the range a WAV allows
  const clipped = new DataView(voice.floatsToWav(loud, 22050).buffer);
  check(clipped.getInt16(44, true) === 32767 && clipped.getInt16(46, true) === -32768,
    'sound louder than the format allows is clamped, not wrapped into noise');
}

// ── Telling a screen reader what language the page is in ────────────────────
// A screen reader picks its voice from the lang attribute. Bangla government
// sites routinely ship none, and then Bangla is read with an English voice.
{
  const langDom = new JSDOM(`<!DOCTYPE html><html><body>
    <p>\u09ac\u09be\u0982\u09b2\u09be\u09a6\u09c7\u09b6 \u09a8\u09bf\u09b0\u09cd\u09ac\u09be\u099a\u09a8 \u0995\u09ae\u09bf\u09b6\u09a8 \u099c\u09be\u09a4\u09c0\u09df \u09aa\u09b0\u09bf\u099a\u09df\u09aa\u09a4\u09cd\u09b0</p>
    <p>\u09a8\u09ac\u09be\u09df\u09a8 \u09ab\u09bf \u09e7\u09e6\u09e6 \u099f\u09be\u0995\u09be \u098f\u09ac\u0982 \u09b8\u0982\u09b6\u09cb\u09a7\u09a8</p>
    <a href="#main">Skip to main content</a>
  </body></html>`, { runScripts: 'outside-only', url: 'https://services.nidw.gov.bd/' });
  langDom.window.console.log = () => {};
  langDom.window.chrome = { runtime: { sendMessage: () => {} } };
  langDom.window.eval(fs.readFileSync(path.join(ROOT, 'modules/blind.js'), 'utf8'));

  const langDoc = langDom.window.document;
  const repairer = new langDom.window.BlindModule();

  check(!langDoc.documentElement.hasAttribute('lang'),
    'the page starts with no language at all, like the real site');

  repairer.repairPageLanguage();
  check(langDoc.documentElement.getAttribute('lang') === 'bn',
    'the page is labelled Bangla from the script on it: ' +
    langDoc.documentElement.getAttribute('lang'));

  const skip = langDoc.querySelector('a[href="#main"]');
  check(skip.getAttribute('lang') === 'en',
    'an English part of a Bangla page is labelled too (WCAG 3.1.2): ' + skip.getAttribute('lang'));

  repairer.destroy();
  check(!langDoc.documentElement.hasAttribute('lang') && !skip.hasAttribute('lang'),
    'turning everything off puts the page back with no labels of ours');
}

// ── Reading one picture out loud ────────────────────────────────────────────
// describeForSpeech is what Alt+Shift+D and pressing a picture both call. The
// network is stubbed: these check which pictures cost a request and what the
// user would hear, not the model.

(async () => {
  const doc2 = dom.window.document;
  const img = id => doc2.getElementById(id);
  let requests = 0;
  let waitingSaid = 0;
  const onWaiting = () => { waitingSaid++; };

  ai._imageDataUrl = async () => 'data:image/jpeg;base64,AAAA';
  ai._ask = async () => { requests++; return 'A fee chart from the Election Commission'; };

  // A description already in the page is free and instant.
  const own = await ai.describeForSpeech(img('described'), onWaiting);
  check(own.source === 'page' && own.text === 'Voters queueing outside a polling station',
    'the page\'s own description is read out as-is: ' + own.text);
  check(requests === 0 && waitingSaid === 0,
    'no request and no "one moment" for a picture that already has a description');

  // A picture with nothing but our placeholder goes to the AI.
  const fresh = doc2.createElement('img');
  fresh.id = 'fresh';
  fresh.src = '/images/chart.jpg';
  doc2.querySelector('main').appendChild(fresh);
  blind.repairMissingAltText();

  const described = await ai.describeForSpeech(img('fresh'), onWaiting);
  check(described.source === 'ai' && described.text === 'A fee chart from the Election Commission',
    'a picture with no description is sent to the AI: ' + described.text);
  check(waitingSaid === 1, 'the user is told to wait, but only when a request is made');
  check(img('fresh').alt === 'A fee chart from the Election Commission',
    'the description is also written into the picture, for screen readers');

  const again = await ai.describeForSpeech(img('fresh'), onWaiting);
  check(again.text === described.text && requests === 1,
    'pressing the same picture again costs no second request');

  // A CAPTCHA is refused out loud rather than described.
  const captcha = await ai.describeForSpeech(img('captcha-image'), onWaiting);
  check(captcha.text === null && /security check/.test(captcha.error) && requests === 1,
    'a CAPTCHA is refused in plain words: ' + captcha.error);

  // A failure has to say something; silence tells a blind user nothing.
  ai._ask = async () => { throw new Error('You appear to be offline.'); };
  const broken = doc2.createElement('img');
  broken.id = 'broken';
  broken.src = '/images/other.jpg';
  doc2.querySelector('main').appendChild(broken);
  blind.repairMissingAltText();
  const failed = await ai.describeForSpeech(img('broken'), onWaiting);
  check(failed.text === null && failed.error === 'You appear to be offline.',
    'a failure comes back as something speakable: ' + failed.error);

  finish();
})();

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
