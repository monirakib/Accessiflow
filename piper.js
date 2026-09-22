// AccessiFlow natural voice
//
// eSpeak (vendor/espeak) can always speak Bangla, but it sounds like a machine
// from 1985 and people report they cannot follow it. This runs a neural voice
// instead: Piper's bn_BD model, trained on Google's Bengali recordings.
//
// The split of work is the useful part. Piper needs phonemes, and eSpeak is
// exactly what produces them, so the engine already shipped for the robotic
// voice becomes the front half of the good one. Nothing else is needed but the
// model itself, which is too large to bundle (73 MB) and is fetched once and
// kept in the browser's cache.
//
// Loaded by offscreen.html, and by the tests in Node, which exercise the pure
// parts: turning phonemes into model input, and samples into a playable sound.
'use strict';

(function (root) {
  const VOICE = {
    id: 'bn_BD-google-medium',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/bn/bn_BD/google/medium/bn_BD-google-medium.onnx',
    config: 'vendor/piper/bn_BD-google-medium.onnx.json',
    bytes: 76782515,
    cache: 'accessiflow-voices'
  };

  /**
   * Phonemes to model input, in Piper's own scheme: a start token, then every
   * phoneme followed by a pad, then an end token. Anything the voice does not
   * know is dropped rather than guessed at, which loses a sound instead of
   * producing a wrong one.
   */
  function phonemeIds(phonemes, map) {
    const look = key => {
      const value = map[key];
      if (value === undefined) return [];
      return Array.isArray(value) ? value : [value];
    };

    const ids = look('^').slice();
    const pad = look('_');
    Array.from(String(phonemes)).forEach(character => {
      const found = look(character);
      if (!found.length) return;
      ids.push.apply(ids, found);
      ids.push.apply(ids, pad);
    });
    ids.push.apply(ids, look('$'));
    return ids;
  }

  /** Model output is floats from -1 to 1; a player wants a WAV file. */
  function floatsToWav(samples, sampleRate) {
    const bytes = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(bytes);
    const text = (at, value) => {
      for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
    };

    text(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);          // PCM header length
    view.setUint16(20, 1, true);           // uncompressed
    view.setUint16(22, 1, true);           // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);          // bits per sample
    text(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    for (let i = 0; i < samples.length; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF, true);
    }
    return new Uint8Array(bytes);
  }

  /**
   * The voice itself: fetches the model once, keeps it in the browser cache,
   * and turns phonemes into sound. Everything is lazy, so a user who never
   * turns this on never pays for any of it.
   */
  class NaturalVoice {
    constructor(options) {
      this.options = options || {};
      this.session = null;
      this.config = null;
      this._loading = null;
    }

    /** True once the model is on this computer, without fetching it. */
    async isDownloaded() {
      try {
        const cache = await caches.open(VOICE.cache);
        return Boolean(await cache.match(VOICE.url));
      } catch (e) {
        return false;
      }
    }

    /**
     * The model, from the cache when it is there and from the network the
     * first time. `onProgress` is called with a fraction so a blind user can
     * be told how a 73 MB download is going, rather than waiting in silence.
     */
    async _modelBytes(onProgress) {
      const cache = await caches.open(VOICE.cache);
      const cached = await cache.match(VOICE.url);
      if (cached) return cached.arrayBuffer();

      const res = await fetch(VOICE.url);
      if (!res.ok) throw new Error('the voice could not be downloaded');

      // Copy it through so the progress can be reported; the response body can
      // only be read once, so the clone is what gets stored.
      const total = Number(res.headers.get('content-length')) || VOICE.bytes;
      const reader = res.clone().body.getReader();
      let seen = 0;
      const chunks = [];
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        chunks.push(step.value);
        seen += step.value.length;
        if (onProgress) onProgress(Math.min(1, seen / total));
      }

      await cache.put(VOICE.url, new Response(new Blob(chunks), {
        headers: { 'Content-Type': 'application/octet-stream' }
      }));

      const whole = new Uint8Array(seen);
      let at = 0;
      chunks.forEach(chunk => { whole.set(chunk, at); at += chunk.length; });
      return whole.buffer;
    }

    async load(onProgress) {
      if (this.session) return this.session;
      if (this._loading) return this._loading;

      this._loading = (async () => {
        const configUrl = this.options.resolve ? this.options.resolve(VOICE.config) : VOICE.config;
        this.config = await (await fetch(configUrl)).json();

        // One thread: an extension page has no SharedArrayBuffer, and the
        // model is fast enough without it (about five times real time).
        const ort = root.ort;
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.simd = true;
        ort.env.wasm.wasmPaths = this.options.resolve ? this.options.resolve('vendor/onnx/') : 'vendor/onnx/';
        ort.env.logLevel = 'error';

        const bytes = await this._modelBytes(onProgress);
        this.session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
        return this.session;
      })().finally(() => { this._loading = null; });

      return this._loading;
    }

    /** Phonemes in, a WAV out. The caller does the phonemising with eSpeak. */
    async speak(phonemes, rate) {
      const session = await this.load();
      const ort = root.ort;
      const ids = phonemeIds(phonemes, this.config.phoneme_id_map);
      if (ids.length < 3) throw new Error('nothing to say');

      const inference = this.config.inference || {};
      // Piper calls it length_scale: bigger is slower, so it is the inverse of
      // the speed the rest of AccessiFlow talks in.
      const length = (inference.length_scale || 1) / Math.max(0.5, Math.min(2, rate || 1));

      const feeds = {
        input: new ort.Tensor('int64', BigInt64Array.from(ids.map(id => BigInt(id))), [1, ids.length]),
        input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
        scales: new ort.Tensor('float32', Float32Array.from([
          inference.noise_scale === undefined ? 0.667 : inference.noise_scale,
          length,
          inference.noise_w === undefined ? 0.8 : inference.noise_w
        ]), [3])
      };
      if (session.inputNames.indexOf('sid') > -1) {
        feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(0)]), [1]);
      }

      const result = await session.run(feeds);
      const samples = result[session.outputNames[0]].data;
      return floatsToWav(samples, (this.config.audio && this.config.audio.sample_rate) || 22050);
    }
  }

  root.AccessiFlowVoice = { VOICE, phonemeIds, floatsToWav, NaturalVoice };

  // The pure parts are tested in Node.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VOICE, phonemeIds, floatsToWav, NaturalVoice };
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
