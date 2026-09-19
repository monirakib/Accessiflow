# AccessiFlow

A Chrome extension (Manifest V3) that adapts any website for people with
disabilities, against WCAG 2.2 at AA and AAA. Version 2.0 rebuilt the interface
and moved the AI features off the user's machine.

## What changed in 2.0

Two problems drove the rewrite.

The old popup asked every user to paste an Anthropic API key into a password
box. Our users are disabled people, many of whom have never heard of an API
key, and asking them to sign up for a developer account before their screen
reader can describe an image is a wall, not a feature. The key is gone. There
is no field, no setup step, nothing to buy.

The second problem was the interface itself. An accessibility tool with eleven
tabs crammed into a 380px popup, `role="switch"` paired with `aria-pressed`
instead of `aria-checked`, `<label for>` pointing at `<button>` elements where
`for` does nothing, dark theme only, emoji read aloud as decoration, and Google
Fonts that Manifest V3 blocks anyway. That is an accessibility tool failing its
own audit.

## Layout

```
manifest.json          MV3 manifest, content scripts, keyboard commands
background.js          Service worker: message relay AND the only AI client
content.js             Injects modules, routes messages, applies settings
content.css            Page-level styles, including the AI summary panel
popup.html             Popup shell: header, search, static panels, dialog
popup-schema.js        Every setting defined once: label, help text, WCAG ref
popup.js               Renders the schema, handles search, AI, audit, storage
popup.css              Three themes, forced-colors, reduced motion
welcome.html/.css      First-run page
modules/               Per-disability feature modules (vision, motor, ...)
  ai-config.js         Shared AI constants for worker and content scripts
  ai.js                Finds work, prepares it, applies results. No network.
server/                Cloudflare Worker proxy. The HF token lives here.
test/                  jsdom render and accessibility-wiring tests
```

## The API key problem

You cannot hide a secret inside a distributed browser extension. The extension
ships as readable JavaScript, and whatever it needs in order to sign a request
has to exist in cleartext in browser memory at the moment the request goes out.
DevTools shows it in the Network tab regardless of how the bundle is
obfuscated, encrypted at rest, or compiled to WebAssembly. Obfuscation raises
the effort; it does not change the outcome.

So the token moved out of the client:

```
extension ──(install token)──> Cloudflare Worker ──(HF_TOKEN)──> Hugging Face
                                      ▲
                          HF_TOKEN only exists here,
                          encrypted at rest by Cloudflare
```

What the extension holds is a capability token, not a credential. It is signed
with HMAC-SHA256 using a key that never leaves the Worker, it expires after
thirty days, and it authorises exactly three operations whose prompts are fixed
server-side. Someone who extracts it from `chrome.storage` gets rate-limited
alt text. They cannot reach Hugging Face with it, they cannot change the model,
and they cannot turn it into a general chat endpoint.

Being honest about the limit matters more than the win here. Per-install
identity is accounting, not authentication. An anonymous client cannot prove it
is genuine without a user account or a device attestation service, so a
determined person can script `/v1/register` and mint install tokens. The defence
is to make abuse worthless rather than impossible: three narrow endpoints, a
160-token output cap, per-install and per-IP limits, and a global daily ceiling
that bounds the damage to the Hugging Face budget no matter how many fake
installs exist. `server/README.md` states this in a table, and the thesis should
state it the same way.

Hugging Face replaced Anthropic as the provider. Requests go to
`https://router.huggingface.co/v1/chat/completions`, which is OpenAI-compatible
and covers both the vision model (alt text) and the text model (summaries, link
names) through one endpoint. Model IDs sit in `wrangler.toml` under `[vars]`, so
swapping a model that has gone cold takes a redeploy and no code change.

Setup is in [server/README.md](server/README.md). Until you deploy it and set
`PROXY_ORIGIN` in [modules/ai-config.js](modules/ai-config.js), the three AI
buttons disable themselves and say so. Everything else works offline.

## The interface

The popup renders from `popup-schema.js`. One entry per setting, holding its
plain-language label, a one-sentence description, search keywords and the WCAG
criterion it serves. `popup.js` turns that into markup with DOM calls, which
means all 79 controls get identical ARIA wiring and a setting cannot drift out
of sync with its own label.

Decisions worth defending:

**An accordion replaced the eleven tabs.** A tab strip that narrow forces
targets below the 44px minimum and hides which tab you are on. An accordion
reads top to bottom under a screen reader, and adding a search box over it means
a user can type "tremor" and land on the right control without knowing we filed
it under Moving and clicking.

**A disability filter over the nine setting groups.** Showing all nine at once
asks someone to read past six groups that are not theirs before reaching the
one that is. The `audiences` list in `popup-schema.js` names, for each
disability type, the sections that help with it, most useful first; choosing
one moves those to the top, puts the rest away and opens the first. It filters
the view only. Nothing is switched off, hidden groups keep working, and when a
hidden group still has a setting turned on the hint says so, because a setting
that is on but off screen is the one way a filter can trap someone. Search runs
inside the choice and reports what it left outside it.

**Real checkboxes with `role="switch"`, not buttons.** Native keyboard
behaviour, native label association, a state screen readers already announce.
The previous `role="switch"` with `aria-pressed` was an ARIA violation; switches
use `aria-checked`.

**Stepper buttons on every slider.** Dragging a thumb accurately is exactly what
a hand tremor or a head pointer makes hard. Pressing a button is not.

**Nothing depends on colour alone.** Every state carries a second cue: the
switch thumb moves and gains a tick, selected profiles gain a tick, sections
carry a rotated chevron.

**Three themes plus automatic**, honouring `prefers-color-scheme`,
`prefers-contrast`, `prefers-reduced-motion` and `forced-colors`. There is also
a panel scale control from 90% to 150%, because the browser's own zoom does not
reach a popup.

Plain language throughout. "Steady my clicks" rather than "Tremor filter", with
the clinical term kept in the search keywords so both audiences find it.

## Tests

```bash
cd server && npm install && npm test   # 18 checks on the proxy
cd test   && npm install && npm test   # 42 popup checks, 10 module checks
```

The Worker suite covers token forgery, payload tampering, expiry, origin
rejection, all three quota ladders, SSRF through the image field, prompt and
model override attempts, and that the Hugging Face token never appears in a
response. The popup suite renders the real `popup.html` under jsdom and asserts
every control has a `<label for>` and a resolvable `aria-describedby`, that no
id is duplicated, that `aria-expanded` matches `hidden` on every section, and
that profiles, dependent controls, steppers and search behave. It also
checks that every disability type names sections that exist and that every
section is reachable from at least one type, since a typo there would
silently strand a group of settings. The module suite runs Screen reader
repairs and the AI together, because each was right alone and wrong in
company: the repair placeholder made every picture look already described.

Neither suite replaces testing with an actual screen reader. NVDA on Windows and
VoiceOver on macOS are still the check that matters before submission, and the
automated tests only stop the obvious regressions.

## Install for development

1. Open `chrome://extensions`, turn on Developer mode, choose Load unpacked, and
   pick this folder.
2. Copy the extension ID it shows.
3. Deploy the Worker (see `server/README.md`), then put its URL in
   `modules/ai-config.js` and in `host_permissions` in `manifest.json`.
4. Put the extension ID into `ALLOWED_EXTENSION_IDS` in `server/wrangler.toml`
   and redeploy. Skipping this leaves the Worker open to any origin.

## Known gaps

- `blindMode` defaults on and runs repairs on every page. That is deliberate,
  but it has not been measured against a heavy single-page app yet.
- The AI summary panel is injected at the top of `document.body`. On sites with
  a fixed header it can sit underneath one.
- OpenDyslexic is pulled from `cdn.jsdelivr.net` at runtime, by `content.css`
  and twice more in `modules/vision.js`. This predates 2.0 and is the worst
  remaining defect. Three things are wrong with it. The font is injected into
  the host page's stylesheet, so any site with a `font-src` CSP directive
  blocks it and the dyslexic reader silently gets the site's original font on
  exactly the pages most likely to be hard. It needs a network round trip, so
  it fails offline. And jsdelivr sees a request for every page where the
  setting is on, which is a browsing-history leak from a disability tool.
  The fix is to vendor `OpenDyslexic-Regular.woff2` into `fonts/`, list it under
  `web_accessible_resources`, and build the `@font-face` `src` with
  `chrome.runtime.getURL()`. Nothing else in the extension loads a remote
  resource; the popup and welcome pages were cleaned of Google Fonts in 2.0.
