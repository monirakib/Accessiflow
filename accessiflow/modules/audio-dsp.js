// AccessiFlow audio signal processing
//
// Pure functions and small state machines, with no Web Audio, no DOM and no
// chrome APIs. The offscreen document uses them to turn a captured tab's
// sound into caption jobs and sound cues; the tests run the very same code
// under plain node, and the real-speech check runs it in headless Chrome.
//
// Four pieces:
//
//   Resampler          any capture rate down to Whisper's 16 kHz, low-passed
//                      first so that audio above 8 kHz does not fold back
//                      into the speech band as noise
//   CaptionSegmenter   decides when there is speech worth transcribing, sends
//                      growing "interim" snapshots while someone is talking,
//                      and a "final" once they pause
//   cleanTranscript    removes what Whisper invents on music and silence
//   TransientDetector  notices a sudden sound out of relative quiet -- a chat
//                      ping, an error chime -- and says which side it came from
'use strict';

(function (root) {

  // ── Basics ───────────────────────────────────────────────────────────────

  function rms(samples, start, end) {
    const from = start || 0;
    const to = end === undefined ? samples.length : end;
    if (to <= from) return 0;
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / (to - from));
  }

  /** Averages any number of channels into one. */
  function downmix(channels) {
    if (!channels || !channels.length) return new Float32Array(0);
    if (channels.length === 1) return Float32Array.from(channels[0]);
    const n = channels[0].length;
    const out = new Float32Array(n);
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      for (let i = 0; i < n; i++) out[i] += ch[i];
    }
    for (let i = 0; i < n; i++) out[i] /= channels.length;
    return out;
  }

  function concat(a, b) {
    const out = new Float32Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  // ── Resampling ───────────────────────────────────────────────────────────

  /**
   * A streaming resampler: windowed-sinc low-pass, then linear interpolation
   * at the output rate.
   *
   * The filter is the part that matters. Taking every third sample of 48 kHz
   * audio without it folds everything between 8 and 24 kHz -- cymbals, hiss,
   * the sibilance of the speech itself -- back down into the band Whisper
   * listens to. A plain three-sample average only takes that down by 9 dB;
   * this takes it down by more than 40.
   *
   * It keeps state between chunks, so audio can be pushed in whatever pieces
   * the capture delivers without clicks at the joins.
   */
  function Resampler(inRate, outRate, taps) {
    this.inRate = inRate;
    this.outRate = outRate;
    this.ratio = inRate / outRate;
    this.passthrough = inRate === outRate;

    const n = taps || 63;                     // odd, so the filter is symmetric about a sample
    const cutoff = 0.45 * outRate / inRate;   // just below the new Nyquist, as a fraction of inRate
    const kernel = new Float32Array(n);
    const mid = (n - 1) / 2;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = i - mid;
      const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
      // Blackman window: steeper stopband than Hann for the same length.
      const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (n - 1));
      kernel[i] = sinc * w;
      sum += kernel[i];
    }
    for (let i = 0; i < n; i++) kernel[i] /= sum;   // unity gain at 0 Hz
    this.kernel = kernel;

    this.history = new Float32Array(n - 1);   // the tail of the previous chunk
    this.filtered = new Float32Array(0);      // filtered samples not yet consumed
    this.position = 0;                        // next output position, in filtered-sample units
  }

  Resampler.prototype.push = function (input) {
    if (this.passthrough) return Float32Array.from(input);

    const k = this.kernel;
    const n = k.length;
    const joined = concat(this.history, input);

    // Convolve. Output j is centred on joined[j + mid], i.e. on the input
    // sample that arrived (n - 1) / 2 samples ago -- a fixed, tiny delay.
    const count = joined.length - n + 1;
    const filtered = new Float32Array(Math.max(0, count));
    for (let j = 0; j < count; j++) {
      let acc = 0;
      for (let t = 0; t < n; t++) acc += joined[j + t] * k[t];
      filtered[j] = acc;
    }
    this.history = joined.slice(joined.length - (n - 1));

    // Sample the filtered signal at the output rate.
    const buffer = concat(this.filtered, filtered);
    const out = [];
    let pos = this.position;
    while (pos + 1 < buffer.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      out.push(buffer[i] * (1 - frac) + buffer[i + 1] * frac);
      pos += this.ratio;
    }

    // Keep what the next output sample still needs. The position can run past
    // the end of a short buffer (with 128-sample chunks it lands one sample
    // beyond), and that overshoot has to be carried into the next chunk; dropping
    // it shifted the signal by a sample at every join.
    const keepFrom = Math.min(Math.floor(pos), buffer.length);
    this.filtered = buffer.slice(keepFrom);
    this.position = pos - keepFrom;
    return Float32Array.from(out);
  };

  // ── Speech segmentation ──────────────────────────────────────────────────

  /**
   * Turns a continuous 16 kHz stream into transcription jobs.
   *
   * Whisper is trained on whole utterances and does badly on audio chopped at
   * arbitrary points; fixed overlapping windows also make the same words come
   * out twice. So audio is grouped into segments at natural pauses instead:
   *
   *   * while someone is talking, an "interim" job for the segment so far is
   *     produced every `interimEvery` seconds, so captions appear as speech
   *     happens rather than after it
   *   * when they pause for `silenceSeconds`, or the segment reaches
   *     `maxSeconds`, one "final" job with the whole segment, and a fresh start
   *
   * Pure silence produces no jobs at all. That is the main defence against
   * Whisper's habit of hearing "Thank you." in an empty room.
   */
  function CaptionSegmenter(opts) {
    const o = opts || {};
    this.rate = o.sampleRate || 16000;
    this.frame = Math.round(this.rate * 0.02);            // 20 ms analysis frames
    this.silenceRms = o.silenceRms === undefined ? 0.008 : o.silenceRms;
    this.silenceFrames = Math.round((o.silenceSeconds || 0.6) / 0.02);
    this.minSpeech = Math.round((o.minSpeechSeconds || 0.35) * this.rate);
    this.maxSamples = Math.round((o.maxSeconds || 10) * this.rate);
    this.interimSamples = Math.round((o.interimEvery || 1.2) * this.rate);
    this.preRoll = Math.round((o.preRollSeconds || 0.3) * this.rate);

    this.id = 0;
    this._reset();
    this._pending = new Float32Array(0);   // less than one frame, carried over
    this._preBuffer = new Float32Array(0); // recent quiet audio, so the first syllable is not clipped
  }

  CaptionSegmenter.prototype._reset = function () {
    this.segment = [];          // Float32Array chunks
    this.length = 0;
    this.speechSamples = 0;
    this.quietFrames = 0;
    this.lastInterimAt = 0;
    this.active = false;
  };

  CaptionSegmenter.prototype._joined = function () {
    const out = new Float32Array(this.length);
    let at = 0;
    for (let i = 0; i < this.segment.length; i++) { out.set(this.segment[i], at); at += this.segment[i].length; }
    return out;
  };

  /**
   * @param {Float32Array} samples 16 kHz mono
   * @returns {Array<{id:number, audio:Float32Array, final:boolean}>}
   */
  CaptionSegmenter.prototype.push = function (samples) {
    const jobs = [];
    const data = concat(this._pending, samples);
    const whole = Math.floor(data.length / this.frame) * this.frame;
    this._pending = data.slice(whole);

    for (let at = 0; at < whole; at += this.frame) {
      const frame = data.subarray(at, at + this.frame);
      const loud = rms(frame) >= this.silenceRms;

      if (!this.active) {
        if (!loud) {
          // Keep a little recent quiet, so a segment starts just before the
          // speech did rather than on its first loud frame.
          this._preBuffer = concat(this._preBuffer, frame);
          if (this._preBuffer.length > this.preRoll) {
            this._preBuffer = this._preBuffer.slice(this._preBuffer.length - this.preRoll);
          }
          continue;
        }
        this.active = true;
        this.id++;
        if (this._preBuffer.length) {
          this.segment.push(this._preBuffer);
          this.length += this._preBuffer.length;
          this._preBuffer = new Float32Array(0);
        }
      }

      this.segment.push(Float32Array.from(frame));
      this.length += frame.length;
      if (loud) { this.speechSamples += frame.length; this.quietFrames = 0; }
      else this.quietFrames++;

      const paused = this.quietFrames >= this.silenceFrames;
      const full = this.length >= this.maxSamples;

      if (paused || full) {
        if (this.speechSamples >= this.minSpeech) {
          jobs.push({ id: this.id, audio: this._joined(), final: true });
        }
        this._reset();
        continue;
      }

      if (this.speechSamples >= this.minSpeech &&
        this.length - this.lastInterimAt >= this.interimSamples) {
        this.lastInterimAt = this.length;
        jobs.push({ id: this.id, audio: this._joined(), final: false });
      }
    }
    return jobs;
  };

  /** Ends whatever is in progress, for when capture stops mid-sentence. */
  CaptionSegmenter.prototype.flush = function () {
    const jobs = [];
    if (this.active && this.speechSamples >= this.minSpeech) {
      jobs.push({ id: this.id, audio: this._joined(), final: true });
    }
    this._reset();
    return jobs;
  };

  /**
   * Decides what to transcribe next when jobs arrive faster than Whisper can
   * keep up. A final is never dropped: it is the caption that stays on screen.
   * Interims are disposable, so only the newest is kept, and one belonging to
   * a segment that has since been finalised is thrown away.
   */
  function CaptionScheduler() {
    this.finals = [];
    this.interim = null;
  }

  CaptionScheduler.prototype.add = function (jobs) {
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      if (job.final) {
        this.finals.push(job);
        if (this.interim && this.interim.id === job.id) this.interim = null;
      } else {
        this.interim = job;
      }
    }
  };

  CaptionScheduler.prototype.next = function () {
    if (this.finals.length) return this.finals.shift();
    const job = this.interim;
    this.interim = null;
    return job;
  };

  CaptionScheduler.prototype.size = function () {
    return this.finals.length + (this.interim ? 1 : 0);
  };

  // ── Cleaning Whisper's output ────────────────────────────────────────────

  // What Whisper produces for music, noise and silence rather than speech.
  // These come from its training data -- subtitles scraped from videos -- and
  // are well known. Shown as captions, they are worse than nothing: a deaf
  // viewer reads "Thanks for watching!" during a silent scene and has no way
  // to know nobody said it.
  const ARTIFACTS = /\[(?:blank_audio|music|applause|laughter|silence|inaudible|noise|sound)[^\]]*\]|\((?:music|applause|laughter|silence|inaudible|noise|upbeat music|dramatic music)[^)]*\)|[♪♫♬]+/gi;
  const HALLUCINATIONS = [
    /^thank you\.?$/i, /^thanks for watching!?\.?$/i, /^thank you for watching\.?$/i,
    /^you\.?$/i, /^bye\.?$/i, /^\.+$/, /^subtitles by/i, /^please subscribe/i
  ];

  /**
   * @param {string} text Whisper's raw output
   * @param {number} [loudness] RMS of the audio it came from
   * @param {number} [seconds] how long that audio was
   * @returns {string} what may be shown, possibly ''
   */
  function cleanTranscript(text, loudness, seconds) {
    let out = String(text || '').replace(ARTIFACTS, ' ').replace(/\s+/g, ' ').trim();
    if (!out) return '';
    // The phantom phrases are dropped only when something says they are
    // phantom, because someone genuinely saying "Thank you." should still be
    // captioned. Two things do: the audio was near silent, or it went on far
    // too long for so few words. A person says "you" in under a second; six
    // seconds of music that comes back as "You" was not speech. Loudness
    // alone missed exactly that case, since music is loud.
    const quiet = loudness !== undefined && loudness < 0.02;
    const tooLong = seconds !== undefined && seconds > 2.5;
    if ((quiet || tooLong) && HALLUCINATIONS.some(re => re.test(out))) return '';
    // Whisper sometimes loops, repeating one phrase until the window ends.
    out = out.replace(/(\b[\w' ]{3,40}?[.,!?]?)(?:\s+\1){2,}/gi, '$1');
    return out;
  }

  // ── Sound cues ───────────────────────────────────────────────────────────

  /**
   * Notices sudden sounds, and which way they came from.
   *
   * Fed one loudness reading per channel several times a second. It keeps a
   * slow-moving sense of how loud things have been, and fires when a reading
   * jumps well above it: a notification ping in a quiet tab, an error chime,
   * a message arriving. Continuous sound -- someone talking, music -- keeps
   * the background high, so its ordinary syllables and beats do not fire.
   *
   * After firing it waits `refractory` seconds, so one chime is one cue.
   */
  function TransientDetector(opts) {
    const o = opts || {};
    this.floor = o.floor === undefined ? 0.01 : o.floor;          // quieter than this is silence
    this.jump = o.jump === undefined ? 4 : o.jump;                 // ratio above background that counts
    this.refractory = o.refractory === undefined ? 1.2 : o.refractory;
    this.backgroundSeconds = o.backgroundSeconds || 1.5;
    this.background = 0;
    this.lastFired = -Infinity;
  }

  /**
   * @param {number} left  RMS of the left channel for this reading
   * @param {number} right RMS of the right channel
   * @param {number} now   seconds
   * @param {number} dt    seconds since the previous reading
   * @returns {?{pan:number, strength:number}} a cue, or null
   */
  TransientDetector.prototype.update = function (left, right, now, dt) {
    const level = Math.max(left, right);
    const quietBefore = this.background;
    let cue = null;

    if (level > this.floor &&
      level > Math.max(quietBefore, this.floor * 0.5) * this.jump &&
      now - this.lastFired >= this.refractory) {
      const total = left + right;
      cue = {
        // -1 is fully left, 1 fully right. Energy balance rather than a
        // difference in time: tab audio arrives already mixed, so balance is
        // what there is to go on.
        pan: total > 0 ? Math.max(-1, Math.min(1, (right - left) / total)) : 0,
        strength: Math.min(1, level / 0.3)
      };
      this.lastFired = now;
    }

    // The background rises quickly and falls slowly, so the tail of a sound
    // does not immediately count as quiet again.
    const tau = level > this.background ? this.backgroundSeconds / 3 : this.backgroundSeconds;
    const a = 1 - Math.exp(-(dt || 0.05) / tau);
    this.background += a * (level - this.background);
    return cue;
  };

  root.AccessiFlowAudio = {
    rms: rms,
    downmix: downmix,
    Resampler: Resampler,
    CaptionSegmenter: CaptionSegmenter,
    CaptionScheduler: CaptionScheduler,
    cleanTranscript: cleanTranscript,
    TransientDetector: TransientDetector
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = root.AccessiFlowAudio;
})(typeof globalThis !== 'undefined' ? globalThis : self);
