// AccessiFlow capture worklet
//
// Runs on the audio rendering thread, where anything slow is heard as a
// crackle in the tab's sound. So it does the least it can: collect the
// captured audio into blocks of 2048 frames, measure each channel's loudness,
// and hand both to the offscreen document. Resampling, segmenting and Whisper
// all happen there, off this thread.
'use strict';

const BLOCK = 2048;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffers = null;
    this.filled = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    // Silence the output: this node exists to be pulled by the graph, not to
    // be heard. The tab's own sound reaches the speakers by a separate path.
    if (outputs[0]) outputs[0].forEach(channel => channel.fill(0));
    if (!input || !input.length || !input[0].length) return true;

    if (!this.buffers || this.buffers.length !== input.length) {
      this.buffers = input.map(() => new Float32Array(BLOCK));
      this.filled = 0;
    }

    const frames = input[0].length;
    let offset = 0;
    while (offset < frames) {
      const take = Math.min(frames - offset, BLOCK - this.filled);
      for (let c = 0; c < input.length; c++) {
        this.buffers[c].set(input[c].subarray(offset, offset + take), this.filled);
      }
      this.filled += take;
      offset += take;

      if (this.filled === BLOCK) {
        const channels = this.buffers.map(b => b.slice());
        const loudness = channels.map(ch => {
          let sum = 0;
          for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
          return Math.sqrt(sum / ch.length);
        });
        // Transferred, not copied, so the audio thread hands the memory over
        // instead of spending time duplicating it.
        this.port.postMessage({ channels: channels, rms: loudness }, channels.map(ch => ch.buffer));
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('accessiflow-capture', CaptureProcessor);
