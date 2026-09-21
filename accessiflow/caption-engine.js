// AccessiFlow caption engine
//
// Whisper, running on this computer. The runtime (transformers.js and its
// WebAssembly build of ONNX Runtime) ships inside the extension in
// vendor/transformers; only the model's weights are downloaded, once, when the
// user asks for them, and are then kept in the browser's cache.
//
// One module, imported by the offscreen document and by the real-speech test
// harness, so what is tested is the configuration that ships.
//
// Nothing about the audio leaves the machine. That matters more here than
// anywhere else in AccessiFlow: a captured tab can be a video call, a doctor's
// appointment or a bank's phone line.

import { pipeline, env } from './vendor/transformers/transformers.min.js';

export const MODEL = {
  id: 'onnx-community/whisper-tiny.en',
  // 8-bit weights for both halves: 41 MB in total, against 152 MB at full
  // precision. Whether the encoder can take 8 bits without losing accuracy is
  // measured by test/browser rather than assumed.
  dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
  files: ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'],
  megabytes: 41,
  language: 'en'
};

const CACHE_NAME = 'transformers-cache';

let configured = false;

/**
 * Points the runtime at the copy inside the extension.
 *
 * By default transformers.js fetches its WebAssembly from jsDelivr. Manifest
 * V3 forbids running code from anywhere but the extension itself, and a caption
 * engine that stopped working whenever a CDN did would be no use to anyone.
 *
 * One thread, no proxy worker: an extension page is not cross-origin isolated,
 * so there is no SharedArrayBuffer and threads are unavailable anyway, and
 * saying so up front stops the runtime from trying and logging warnings.
 *
 * @param {string} base URL the extension's files are served from, ending in /
 */
export function configure(base) {
  if (configured) return;
  configured = true;
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  env.backends.onnx.wasm.wasmPaths = base + 'vendor/transformers/';
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
}

function fileUrl(file) {
  const host = String(env.remoteHost || 'https://huggingface.co/').replace(/\/?$/, '/');
  return host + MODEL.id + '/resolve/main/' + file;
}

/** Whether both halves of the model are already in the cache. */
export async function isDownloaded() {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const found = await Promise.all(MODEL.files.map(f => cache.match(fileUrl(f))));
    return found.every(Boolean);
  } catch (e) {
    return false;
  }
}

/**
 * Loads the model, downloading it first if it is not cached.
 *
 * @param {function} [onProgress] called with a fraction from 0 to 1, across
 *   every file rather than per file, so a progress bar only ever moves forward
 */
export async function load(onProgress) {
  const seen = {};
  const report = event => {
    if (!onProgress || !event || !event.file) return;
    if (event.status === 'progress' || event.status === 'done') {
      const total = event.total || (seen[event.file] && seen[event.file].total) || 0;
      const loaded = event.status === 'done' ? total : (event.loaded || 0);
      seen[event.file] = { loaded: loaded, total: total };
      let sumLoaded = 0;
      let sumTotal = 0;
      Object.keys(seen).forEach(k => { sumLoaded += seen[k].loaded; sumTotal += seen[k].total; });
      // The small config and tokenizer files arrive first and would otherwise
      // make the bar leap to 100% before the 30 MB decoder has started.
      const expected = MODEL.megabytes * 1e6;
      onProgress(Math.min(1, sumLoaded / Math.max(sumTotal, expected)));
    }
  };

  return pipeline('automatic-speech-recognition', MODEL.id, {
    dtype: MODEL.dtype,
    device: 'wasm',
    progress_callback: report
  });
}

/**
 * One piece of audio to text.
 *
 * @param {object} engine what load() returned
 * @param {Float32Array} audio 16 kHz mono
 * @returns {Promise<string>} Whisper's raw text, before cleanTranscript
 */
export async function transcribe(engine, audio) {
  const out = await engine(audio, {
    // No language or task option: this is an English-only model, and giving
    // one to an English-only Whisper is an error rather than a hint.
    return_timestamps: false,
    // Greedy decoding. Beam search is a little more accurate and several
    // times slower, and a caption that arrives late is a caption that has
    // stopped being useful.
    num_beams: 1
  });
  return (out && out.text) || '';
}

// The DSP layer is a classic script that attaches to globalThis, so the same
// file also runs under node for its tests. Imported here for its side effect.
import './modules/audio-dsp.js';

/**
 * Raw captured audio in, captions out.
 *
 * Owns the whole chain from capture chunks to text: downmix, resample to
 * 16 kHz, segment at pauses, schedule, transcribe one job at a time, clean.
 * Whisper is never given two jobs at once; while it is busy, newer interims
 * replace older ones and finals queue, so it can fall behind for a moment but
 * never builds up a backlog of stale partial captions.
 */
export class CaptionPipeline {
  /**
   * @param {object} engine what load() returned
   * @param {number} sampleRate the capture's own rate
   * @param {function} onCaption ({text, final, id, lagMs}) for each caption
   */
  constructor(engine, sampleRate, onCaption) {
    const A = globalThis.AccessiFlowAudio;
    this.engine = engine;
    this.onCaption = onCaption;
    this.resampler = new A.Resampler(sampleRate, 16000);
    this.segmenter = new A.CaptionSegmenter();
    this.scheduler = new A.CaptionScheduler();
    this.busy = false;
    this.stopped = false;
    this.stats = { jobs: 0, audioSeconds: 0, busyMs: 0 };
    this._lastFinalId = 0;
  }

  /** @param {Float32Array[]} channels one chunk of capture, per channel */
  push(channels) {
    if (this.stopped) return;
    const A = globalThis.AccessiFlowAudio;
    const mono = this.resampler.push(A.downmix(channels));
    const jobs = this.segmenter.push(mono);
    const now = Date.now();
    jobs.forEach(job => { job.queuedAt = now; });
    this.scheduler.add(jobs);
    this._pump();
  }

  /** Transcribes whatever was being said when capture stopped. */
  async finish() {
    const jobs = this.segmenter.flush();
    const now = Date.now();
    jobs.forEach(job => { job.queuedAt = now; });
    this.scheduler.add(jobs);
    this._pump();
    while (this.busy || this.scheduler.size()) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    this.stopped = true;
  }

  stop() {
    this.stopped = true;
    this.scheduler = new globalThis.AccessiFlowAudio.CaptionScheduler();
  }

  async _pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      let job;
      while (!this.stopped && (job = this.scheduler.next())) {
        // An interim for a segment that has already been finalised would put
        // older, partial text on screen after the finished caption.
        if (!job.final && job.id <= this._lastFinalId) continue;

        const started = Date.now();
        const raw = await transcribe(this.engine, job.audio);
        const took = Date.now() - started;
        this.stats.jobs++;
        this.stats.audioSeconds += job.audio.length / 16000;
        this.stats.busyMs += took;

        if (job.final) this._lastFinalId = Math.max(this._lastFinalId, job.id);
        const A = globalThis.AccessiFlowAudio;
        const text = A.cleanTranscript(raw, A.rms(job.audio), job.audio.length / 16000);
        if (!text && !job.final) continue;
        this.onCaption({ text: text, final: job.final, id: job.id, lagMs: Date.now() - job.queuedAt, took: took });
      }
    } finally {
      this.busy = false;
    }
  }
}
