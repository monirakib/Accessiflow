# Third-party code and voices

AccessiFlow bundles outside pieces so that it can speak Bangla on a computer
that has no Bangla voice of its own, and caption a tab's sound without sending
it anywhere. Each is listed here with what it is, where it came from, and what
its licence requires.

| Directory | What | Licence |
| --- | --- | --- |
| `espeak/` | eSpeak NG, the always-available voice and the phonemiser | **GPL-3.0-or-later** |
| `onnx/` | ONNX Runtime Web, which runs the neural voice | MIT |
| `piper/` | Configuration for Piper's Bangla voice (the model is downloaded, not bundled) | MIT (code) |
| `transformers/` | Transformers.js and its ONNX Runtime WebAssembly build, which run Whisper for live captions (the model is downloaded, not bundled) | Apache-2.0, MIT |

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

## transformers/

[Transformers.js](https://github.com/huggingface/transformers.js) 4.3.0,
Apache-2.0, from the `@huggingface/transformers` npm package: only its browser
build, `transformers.min.js` (580 KB). Its licence is
[LICENSE-transformers-Apache-2.0](transformers/LICENSE-transformers-Apache-2.0).

Transformers.js carries its own copy of ONNX Runtime Web, a different version
from the one in `onnx/`, so the two are not shared. Its WebAssembly build is
taken from the matching `onnxruntime-web` package
(1.31.0-dev.20260914-8d85527a0), MIT licensed
([LICENSE-onnxruntime-MIT](transformers/LICENSE-onnxruntime-MIT)): the
single-threaded-capable SIMD build `ort-wasm-simd-threaded.asyncify.wasm`
(27 MB) and its loader `.mjs`. By default Transformers.js fetches these from a
CDN at runtime; Manifest V3 forbids running code from anywhere but the
extension, so they are bundled and `caption-engine.js` points the runtime at
them.

The model, [onnx-community/whisper-tiny.en](https://huggingface.co/onnx-community/whisper-tiny.en)
with 8-bit weights (41 MB), is **downloaded when the user asks for it** and
kept in the browser's cache, like the Bangla voice. It is a conversion of
OpenAI's Whisper tiny.en, which OpenAI released under the MIT licence. It is
English only.

## What is not here

No model weights are committed to this repository. The neural voice and the
caption model are fetched at runtime, which keeps the extension at about 42 MB
instead of about 155 MB, and means a user who never turns either on never
downloads it. Most of the 42 MB is the two WebAssembly runtimes: 10 MB for the
voice, 27 MB for captions.
