// The signal processing behind live captions and sound cues.
//
// Everything here is checked with synthesised signals whose right answer is
// known: tones of a set frequency, speech-shaped bursts of set length, a chime
// on one side. The real-speech check with Whisper itself is separate
// (test/browser/), because it needs Chrome and a 41 MB download.
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

const A = require(path.join(ROOT, 'modules/audio-dsp.js'));
const r2 = n => Math.round(n * 100) / 100;

const tone = (freq, seconds, rate, amp) => {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (amp || 0.5) * Math.sin(2 * Math.PI * freq * i / rate);
  return out;
};

// Strength of one frequency in a signal, by correlation against sine and cosine.
const magnitudeAt = (signal, freq, rate) => {
  let re = 0, im = 0;
  for (let i = 0; i < signal.length; i++) {
    re += signal[i] * Math.cos(2 * Math.PI * freq * i / rate);
    im += signal[i] * Math.sin(2 * Math.PI * freq * i / rate);
  }
  return 2 * Math.sqrt(re * re + im * im) / signal.length;
};

// Pushes a signal through in capture-sized pieces, as the worklet delivers it.
const inChunks = (resampler, signal, size) => {
  const parts = [];
  for (let at = 0; at < signal.length; at += size) parts.push(resampler.push(signal.subarray(at, at + size)));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  parts.forEach(p => { out.set(p, at); at += p.length; });
  return out;
};

// ── Resampling ─────────────────────────────────────────────────────────────
{
  const out = inChunks(new A.Resampler(48000, 16000), tone(440, 2, 48000), 2048);
  check(Math.abs(out.length - 32000) < 40,
    '2 seconds at 48 kHz become 2 seconds at 16 kHz: ' + out.length + ' samples');
  const kept = magnitudeAt(out.subarray(200), 440, 16000);
  check(Math.abs(kept - 0.5) < 0.02,
    'a 440 Hz tone, well inside the speech band, keeps its level: ' + r2(kept) + ' of 0.5');
}
{
  // 12 kHz cannot exist at 16 kHz. Without the low-pass it folds down to
  // 4 kHz, right in the middle of the band Whisper listens to.
  const out = inChunks(new A.Resampler(48000, 16000), tone(12000, 1, 48000), 2048);
  const aliased = magnitudeAt(out.subarray(200), 4000, 16000);
  const db = 20 * Math.log10(aliased / 0.5);
  check(db < -40,
    'a 12 kHz tone is removed before it can fold down to 4 kHz: ' + r2(db) + ' dB');
}
{
  // 44.1 kHz is the other common capture rate, and its ratio is not a whole number.
  const out = inChunks(new A.Resampler(44100, 16000), tone(1000, 1.5, 44100), 1024);
  check(Math.abs(out.length - 24000) < 40, '44.1 kHz resamples to the right length: ' + out.length);
  const kept = magnitudeAt(out.subarray(200), 1000, 16000);
  check(Math.abs(kept - 0.5) < 0.03, 'and keeps the tone at a non-integer ratio: ' + r2(kept));
}
{
  // Chunk boundaries must not click: the same signal in different piece sizes
  // gives the same output.
  const signal = tone(700, 0.5, 48000);
  const a = inChunks(new A.Resampler(48000, 16000), signal, 128);
  const b = inChunks(new A.Resampler(48000, 16000), signal, 4096);
  let worst = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  check(worst < 1e-5, 'the output is identical however the input is chunked, so joins are seamless: ' + worst.toExponential(1));
}
check(A.downmix([Float32Array.of(1, 0), Float32Array.of(0, 1)]).join() === '0.5,0.5',
  'stereo is averaged to mono');

// ── Segmenting speech into caption jobs ────────────────────────────────────
const RATE = 16000;
const speech = seconds => tone(220, seconds, RATE, 0.2);       // loud enough to count as speech
const silence = seconds => new Float32Array(Math.round(seconds * RATE));
const run = (segmenter, pieces) => {
  const jobs = [];
  pieces.forEach(piece => {
    for (let at = 0; at < piece.length; at += 1600) {           // 100 ms at a time
      jobs.push(...segmenter.push(piece.subarray(at, at + 1600)));
    }
  });
  return jobs;
};
{
  const jobs = run(new A.CaptionSegmenter(), [silence(5)]);
  check(jobs.length === 0,
    'five seconds of silence produce no transcription at all, which is what stops Whisper inventing captions');
}
{
  const jobs = run(new A.CaptionSegmenter(), [silence(0.5), speech(3), silence(1)]);
  const finals = jobs.filter(j => j.final);
  const interims = jobs.filter(j => !j.final);
  check(finals.length === 1, 'three seconds of speech then a pause give exactly one final caption');
  check(interims.length >= 2, 'with interim updates while it is being spoken: ' + interims.length);
  const seconds = finals[0] ? finals[0].audio.length / RATE : 0;
  check(seconds > 3.2 && seconds < 4.2,
    'the final covers the speech, a little lead-in, and the pause that ended it: ' + r2(seconds) + ' s');
  check(interims.every((j, i) => i === 0 || j.audio.length > interims[i - 1].audio.length),
    'each interim is the segment so far, growing');
}
{
  const jobs = run(new A.CaptionSegmenter(), [speech(1.5), silence(1), speech(2), silence(1)]);
  const finals = jobs.filter(j => j.final);
  check(finals.length === 2 && finals[0].id !== finals[1].id,
    'two sentences with a pause between them become two separate captions');
}
{
  const jobs = run(new A.CaptionSegmenter({ maxSeconds: 10 }), [speech(25)]);
  const finals = jobs.filter(j => j.final);
  check(finals.length === 2 && finals.every(j => j.audio.length <= 10 * RATE + 320),
    'someone talking without a break is still cut into captions of at most 10 seconds: ' + finals.length + ' so far');
}
{
  const jobs = run(new A.CaptionSegmenter(), [speech(0.1), silence(1)]);
  check(jobs.length === 0, 'a click or a cough, too short to be speech, is not transcribed');
}
{
  const seg = new A.CaptionSegmenter();
  run(seg, [speech(2)]);
  const flushed = seg.flush();
  check(flushed.length === 1 && flushed[0].final,
    'stopping captions mid-sentence still transcribes what was said so far');
}

// ── The scheduler, for when Whisper falls behind ───────────────────────────
{
  const s = new A.CaptionScheduler();
  s.add([{ id: 1, final: false, audio: 'i1' }, { id: 1, final: false, audio: 'i2' }]);
  check(s.size() === 1 && s.next().audio === 'i2', 'only the newest interim is kept');
  s.add([{ id: 2, final: false, audio: 'i' }, { id: 2, final: true, audio: 'f2' }, { id: 3, final: true, audio: 'f3' }]);
  check(s.next().audio === 'f2' && s.next().audio === 'f3' && s.next() === null,
    'finals are never dropped and come first, and an interim for a segment already finalised is discarded');
}

// ── Cleaning Whisper's output ──────────────────────────────────────────────
check(A.cleanTranscript(' [BLANK_AUDIO] ') === '', 'the blank-audio marker is removed');
check(A.cleanTranscript('(upbeat music) Welcome back.') === 'Welcome back.', 'music descriptions are removed from real speech');
check(A.cleanTranscript('♪ ♪') === '', 'music notes alone produce nothing');
check(A.cleanTranscript('Thank you.', 0.005) === '',
  'the phantom "Thank you." on near-silence is dropped');
check(A.cleanTranscript('Thank you.', 0.1) === 'Thank you.',
  'but someone really saying thank you, out loud, is still captioned');
check(A.cleanTranscript('You', 0.16, 6.9) === '',
  'six seconds of loud music that comes back as "You" is dropped, which loudness alone missed (found by the real-speech check)');
check(A.cleanTranscript('Thank you.', 0.12, 1.4) === 'Thank you.',
  'a short, loud "Thank you." is still a real person speaking');
check(A.cleanTranscript('Please hold. Please hold. Please hold. Please hold.') === 'Please hold.',
  'a looping phrase is collapsed to one');

// ── Sound cues ─────────────────────────────────────────────────────────────
const feed = (detector, readings, dt) => {
  const cues = [];
  let now = 0;
  readings.forEach(([l, r]) => {
    const cue = detector.update(l, r, now, dt);
    if (cue) cues.push(Object.assign({ at: now }, cue));
    now += dt;
  });
  return cues;
};
const repeat = (reading, count) => Array.from({ length: count }, () => reading);
{
  // A quiet tab, then a chime on the left.
  const cues = feed(new A.TransientDetector(), [...repeat([0.002, 0.002], 40), ...repeat([0.25, 0.05], 4), ...repeat([0.002, 0.002], 20)], 0.05);
  check(cues.length === 1, 'a chime in a quiet tab gives one cue, not one per reading');
  check(cues[0] && cues[0].pan < -0.5, 'and it is placed on the left, where the sound was: pan ' + (cues[0] ? r2(cues[0].pan) : 'none'));
}
{
  const cues = feed(new A.TransientDetector(), [...repeat([0.002, 0.002], 20), ...repeat([0.02, 0.2], 3)], 0.05);
  check(cues.length === 1 && cues[0].pan > 0.5, 'a sound on the right is placed on the right');
}
{
  // Continuous speech: loud, with ordinary syllable-to-syllable variation.
  const readings = [];
  for (let i = 0; i < 200; i++) {
    const level = 0.08 + 0.05 * Math.abs(Math.sin(i * 0.9));
    readings.push([level, level]);
  }
  const cues = feed(new A.TransientDetector(), readings, 0.05);
  check(cues.length <= 1,
    'ten seconds of steady talking gives at most the one cue for when it started: ' + cues.length);
}
{
  const cues = feed(new A.TransientDetector(), [...repeat([0.002, 0.002], 20),
    ...repeat([0.2, 0.2], 2), ...repeat([0.002, 0.002], 4), ...repeat([0.2, 0.2], 2)], 0.05);
  check(cues.length === 1, 'two pings 0.3 s apart are one cue, so a double chime is not two alarms');
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
