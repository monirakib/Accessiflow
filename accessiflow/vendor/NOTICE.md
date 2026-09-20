# Third-party code and voices

AccessiFlow bundles three outside pieces so that it can speak Bangla on a
computer that has no Bangla voice of its own. Each is listed here with what it
is, where it came from, and what its licence requires.

| Directory | What | Licence |
| --- | --- | --- |
| `espeak/` | eSpeak NG, the always-available voice and the phonemiser | **GPL-3.0-or-later** |
| `onnx/` | ONNX Runtime Web, which runs the neural voice | MIT |
| `piper/` | Configuration for Piper's Bangla voice (the model is downloaded, not bundled) | MIT (code) |

## espeak/

See [espeak/NOTICE.md](espeak/NOTICE.md). GPL-3.0, which is the licence that
governs AccessiFlow as a whole while this directory is part of it.

## onnx/

[ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.18.0, MIT
licensed, taken from the `onnxruntime-web` npm package. Only two files are
kept: the WebAssembly backend loader (`ort.wasm.min.js`, 140 KB) and its
SIMD build (`ort-wasm-simd.wasm`, 10 MB). The WebGL, WebGPU and training
builds, and the multi-threaded WebAssembly builds, are not included: an
extension page has no `SharedArrayBuffer`, so threads are unavailable, and one
thread already runs this voice about five times faster than real time.

## piper/

[Piper](https://github.com/rhasspy/piper) is MIT licensed. Only the voice's
configuration file is bundled — the phoneme table and inference settings, 5 KB.

The voice itself, `bn_BD-google-medium.onnx` (73 MB), is **downloaded when the
user asks for it** and kept in the browser's cache. It is not redistributed
with the extension. It is fetched from
[rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices).

That voice was trained on:

- **[OpenSLR 37](http://www.openslr.org/37/)**, Google's crowd-sourced Bengali
  speech corpus — *Creative Commons Attribution-ShareAlike 4.0 International*
- **[CMU Indic](http://festvox.org/cmu_indic/index.html)** — CMU's own
  permissive licence

Attribution for those belongs in anything published about AccessiFlow's Bangla
speech, and the ShareAlike term applies to the voice, not to code that merely
plays it.

## What is not here

No model weights are committed to this repository. The neural voice is fetched
at runtime, which keeps the extension at about 14 MB instead of 90 MB, and
means a user who never turns that voice on never downloads it.
