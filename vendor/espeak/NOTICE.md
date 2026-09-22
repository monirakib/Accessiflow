# eSpeak NG, bundled

These files are **eSpeak NG**, compiled to WebAssembly, carried inside
AccessiFlow so that it can speak languages the computer has no voice for.

Windows ships no Bangla voice unless somebody installs a language pack. Asking
a blind Bangla speaker to do that before they can hear their own language is
the barrier this removes: the extension brings its own voice, works offline,
and needs no account, server or payment.

| File | What it is | Size |
| --- | --- | --- |
| `espeak-ng.wasm` | The synthesiser | 836 KB |
| `espeak-ng.js` | Emscripten loader for it | 240 KB |
| `espeak-ng-data/bn_dict` | Bengali pronunciation dictionary | 88 KB |
| `espeak-ng-data/lang/inc/bn` | Bengali voice definition | 26 B |
| `espeak-ng-data/{phondata,phonindex,phontab,intonations}` | Shared phoneme data | 610 KB |

Only Bengali is included. Every other language is left to the voices already on
the computer, which sound far better than this engine does.

## Where it came from

The binaries were taken from the npm package
[`text2wav`](https://www.npmjs.com/package/text2wav) 0.0.14, which publishes a
build of [eSpeak NG](https://github.com/espeak-ng/espeak-ng) (git
`e13b602`). Upstream source: <https://github.com/espeak-ng/espeak-ng>.

## Modification

`espeak-ng.js` has one change from the published build. Its last lines mounted
`espeak-ng-data` from the Node filesystem, which cannot work in a browser: there
is no `require` and no filesystem. That mount is replaced by exposing the
in-memory filesystem, and [offscreen.js](../../offscreen.js) writes the data
files into it before the engine starts. The change is marked in the file with a
comment beginning `AccessiFlow:`. Nothing else was touched.

## Licence

eSpeak NG is **GPL-3.0-or-later**. The full text is in `LICENSE-GPL-3.0`.

The `text2wav` package labels itself MIT, but that covers its own wrapper code,
which is not used here; the engine and data files it redistributes are eSpeak
NG's and stay under the GPL.

**What this means for AccessiFlow.** Distributing the extension with this
engine inside it means distributing a work that includes GPL-3.0 code, so the
extension must be distributed under the GPL as well, with its source available
to anyone who receives it. The source is already published, so this costs
nothing in practice — but it must be stated, not assumed. If AccessiFlow ever
needs a non-GPL licence, this directory is the one thing that has to go; the
Bangla voice would then come from a permissively licensed engine such as
[Piper](https://github.com/rhasspy/piper) (MIT), at the cost of a 77 MB voice
download.
