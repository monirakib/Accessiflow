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
