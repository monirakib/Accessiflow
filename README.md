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

## What changed in 3.0

Settings used to be kept per website, so every choice had to be made again on
the next site, and a blind user had to find a switch on each new page before
the thing that would read the switch out was running. Now there is one
**setup**, applied on every website, with per-site exceptions on top.

- **A setup page that talks.** Installing AccessiFlow opens `welcome.html`,
  which starts speaking at once through `chrome.tts` (a page's own speech is
  refused until the user presses something, and a blind user cannot find a
  Start button they cannot see). Three questions: what you need (number keys
  choose), a few details for those needs, and a check before saving. "Blind,
  and I use NVDA" and "blind, with nothing" get different setups, so nothing
  is ever read twice.
- **Key echo.** Each letter, each word, or both, as it is typed into any text
  box. Password boxes say "star". Built on `beforeinput`/`input`, so Bangla
  and other input methods are spoken once the character is complete.
- **Summarise, out loud.** A button on the popup's Home screen and
  <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>. The AI's three key points,
  spoken and shown; an outline built from the page itself when the helper
  cannot be reached.
- **One Stop, and a Pause.** The popup's Stop, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>,
  <kbd>Ctrl</kbd> on its own as in NVDA, and a button on the page that appears
  only while something long is being read. <kbd>Shift</kbd> on its own pauses,
  and pressed again carries on from the word it stopped on (from the start of
  that sentence or two, with a voice that does not report its words). The
  caller keeps waiting through a pause, so the screen reader's read-all goes
  on to the next line afterwards. Shift with any other key, or with a click,
  is never taken for a pause. Every module now speaks through
  the same engine, so all of it is in the user's voice and speed, and Stop
  reaches all of it.
- **A summary on every form.** When focus first enters a form of two
  questions or more, a short summary appears above it: how many questions,
  what they ask for, which are optional, and any file to have ready. It is
  written on the user's own computer from the form's labels, with nothing
  sent; once the user has agreed to automatic Smart help, the AI's fuller
  summary is used instead. With the built-in screen reader on it is read out,
  queued after the name of the field focus landed on; with it off it is only
  shown. There is no switch for it any more: it is part of AccessiFlow being
  on for the site.
- **A popup that is not overwhelming.** Home shows whether AccessiFlow is on
  for this site, the setup, four large buttons (read, stop, summarise,
  describe the pictures) and at most six settings chosen for the user's
  needs. Everything else is under All settings, with search, as before.
- **The popup and setup page speak for themselves** while the built-in screen
  reader is on (`ui-voice.js`), since that reader cannot run inside extension
  pages.

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
welcome.html/.js/.css  The setup page: talks, asks three questions, saves the setup
ui-voice.js            Speech for AccessiFlow's own pages (popup, setup page)
modules/               Per-disability feature modules (vision, motor, ...)
  settings-store.js    Defaults, then the setup, then this site's exceptions
  profiles.js          One bundle per need, with its setup wording and Home settings
  shortcuts.js         Every keyboard shortcut, written once
  key-echo.js          Says what is typed
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

### Dictating into forms

*Dictate into boxes*, in **Speaking and typing**, fills in forms by voice.
<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> starts and stops it, and switches
the feature on if it was off, because a shortcut that answers with silence
teaches nobody anything. The Hand movement profile turns it on.

It replaces an earlier version that could not be used for a form, and the
reasons are worth keeping:

- **It replaced the whole field with each utterance.** Anything already typed
  was wiped, and every sentence erased the one before it. Words now go in at
  the cursor.
- **It stopped after one phrase.** A paragraph meant clicking a 28-pixel mic
  over and over — the exact difficulty being worked around. Recognition is
  continuous now, and restarts itself when Chrome pauses it.
- **Half-recognised words went into the field.** A form that appears to
  corrupt itself is worse than no dictation for someone who cannot easily undo
  it, so interim results go to a bar and only final text reaches the form.

Dictation starts from the end of what is already in the box. Chrome selects a
field's entire contents when you Tab into it, so honouring the selection would
delete the user's text — the original bug, reintroduced by being careful about
cursors. Clicking inside the text afterwards still inserts there.

Spoken commands: "full stop", "comma", "question mark", "new line", "new
paragraph", "delete that", "stop dictation", and দাঁড়ি for the Bangla full
stop. The language follows the page unless it is set, so a Bangla form is
recognised as Bangla. Password boxes are never dictated into.

### Reading what you point at

*Read what I point at* and *Read what I tab to*, in **Having pages read aloud**,
say what a thing is as you reach it: "Save changes, button", "Email address,
edit, blank", "Accept terms, check box, checked". The Screen reader profile
(Alt+Shift+2) turns both on.

The work is in [modules/naming.js](modules/naming.js), and it is not the same
as reading an element's text. A name is not text: aria-labelledby wins over
aria-label, which wins over a label, an alt or the content, and an icon-only
link is named by its picture. The role and state matter as much — an empty box
says "blank" rather than going quiet, because silence there is
indistinguishable from a control that failed to read, and a control with no
name at all is announced as "unlabelled button" because that is a fault on the
page the user needs to know about.

Pointing climbs to the nearest thing worth announcing: at a word inside a
button it means the button. Pointing waits 400ms by default (adjustable)
because crossing the page on the way somewhere else would otherwise fire an
announcement per element, and the same element is never announced twice in a
row. Focus is read at once, since tabbing is deliberate.

It speaks through the same engine as everything else, so on a Bangla page the
labels come out in the Bangla voice.

### A Bangla voice people can actually follow

eSpeak always works and always sounds like a machine; testers could not follow
it. So there is a second Bangla voice: Piper`s `bn_BD` neural model, trained on
Google`s Bengali recordings, run by ONNX Runtime Web inside the same offscreen
document.

The cheap part is the phonemes. Piper needs them, eSpeak produces exactly the
ones its Bangla voice was trained on, and eSpeak is already bundled for the
robotic fallback — so the engine that made the bad voice is the front half of
the good one. Nothing extra to ship: no second phonemiser, no espeak data
duplicated.

Measured in Chrome, single-threaded: 82ms to phonemise a sentence, 916ms once
to start the engine, 840ms to generate 4.3 seconds of speech — about **five
times faster than real time**.

The model is 73 MB, which is too much to bundle and too much to spend behind
someone`s back, so it is never fetched on its own. *Natural Bangla voice* in
the settings asks for it, the download reports its progress out loud rather
than only drawing a bar, and the robotic voice keeps working throughout. Any
failure falls back to eSpeak and stays there: a blind user is never left with
silence because the better voice broke.

Licences are in [vendor/NOTICE.md](vendor/NOTICE.md). The model is downloaded,
never redistributed, and its training data (OpenSLR 37, CC-BY-SA 4.0) needs
attribution in anything published about this.

### The extension carries its own Bangla voice

Windows has no Bangla voice unless somebody installs a language pack, so every
fix above ends at the same wall: there is nothing to speak with. Telling a
blind Bangla speaker to install a language pack before they can hear their own
language is not an accessibility tool, it is a prerequisite.

So the voice ships inside the extension. [vendor/espeak](vendor/espeak) holds
eSpeak NG compiled to WebAssembly (836 KB) with the Bengali dictionary and the
shared phoneme data — 1.8 MB in total, of which only Bengali is included,
because every other language is better served by the voices already on the
computer. It works offline, needs no account or server, and costs nothing per
use. A sentence takes about 25ms to synthesise.

It runs in [offscreen.js](offscreen.js), not in the page. Two reasons: a
content script cannot use WebAssembly on sites with a strict content security
policy, and audio a page starts dies when that page navigates. An offscreen
document is the extension's own, so neither applies.

The browser's voices still win whenever they exist. `_playRun()` reaches for
the bundled engine only when the computer has no voice for that script, so a
machine with a real Bangla voice uses it, and the robotic fallback is the
floor rather than the default. Runs play one at a time, because the browser's
queue and ours know nothing about each other and would otherwise talk over one
another; a watchdog resolves a run that never reports back, since Chrome
sometimes never fires `onend` and one stuck sentence would silence the rest of
the page.

**Licence, which matters here.** eSpeak NG is GPL-3.0, so shipping it makes the
extension GPL-3.0 too, source included. That is already true of this repository,
but it is a real consequence and [vendor/espeak/NOTICE.md](vendor/espeak/NOTICE.md)
states it plainly, along with the one change made to the published build.

### Voices arrive late

`speechSynthesis.getVoices()` returns an empty array until Chrome has built
its voice list, which is precisely the state just after a page loads. Choosing
a voice in that window finds nothing, the utterance falls back to the default
English voice, and Bangla comes out as silence. `TTSEngine` now holds anything
it is asked to say until the list arrives, speaks it then, and gives up waiting
after 1.5 seconds so a missing `voiceschanged` event cannot swallow a sentence.

Two smaller things fell out of the same bug. The utterance language is
region-qualified (`bn-BD`, not `bn`), because that is what Chrome matches its
own online voices against. And when a run of text finds no voice and the engine
returns in under 250ms without making a sound, AccessiFlow says so in English:
silence with no explanation is the worst outcome for someone who cannot see the
screen. The voice picker in *Having pages read aloud* lists every installed
voice with its language tag, which is how a user can tell whether their browser
has one for their language at all.

### The setup, and a profile in one keypress

What applies on a site is worked out in one place,
[modules/settings-store.js](modules/settings-store.js), shared by the page,
the popup and the setup page: the schema defaults, then the user's setup
(`accessiflow_setup`), then that site's own exceptions (`settings_<host>`,
only what differs). A change in the popup goes into the setup unless "Only
this site" is chosen, and every open tab follows it through
`storage.onChanged`, a background tab only once it is looked at. Sites saved
by 2.x held a full copy of every setting; on first read the copy is trimmed
to what differs from the defaults, so a site keeps its own adjustments and
starts following the setup for everything else.

Nine bundles, one per need, are listed in
[modules/profiles.js](modules/profiles.js). The setup page asks about them
with the same numbers as <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>1</kbd> to
<kbd>7</kbd>, which add a need to the setup from any page. Adding, never
replacing: one keypress must not undo a setup someone spent time on.
<kbd>8</kbd> pauses AccessiFlow on the current site only (again to undo) and
<kbd>9</kbd> reads the main keys aloud. Each keypress says what it did, twice
over: into a live region for a screen reader already running, and in the
extension's own voice for someone who has none.

`e.code` rather than `e.key` decides the digit: with Shift held, "1" arrives
as "!" and differs between keyboard layouts. Digits with no profile are left
alone, so a page keeps its own shortcuts.

### Language, and why Bangla was silent

Speech without a language is speech in the browser's default voice, which is
usually English. Bangla read by an English voice is unusable, and the site this
was tested against — `services.nidw.gov.bd`, a Bangladeshi government service —
ships `<html>` with **no `lang` attribute at all** and not one `lang=` anywhere,
on a page that is almost entirely Bangla. So neither an external screen reader
nor our own read-aloud had anything to go on. Both halves are fixed:

- **The page is labelled from the script on it.** `repairPageLanguage()` in
  [modules/blind.js](modules/blind.js) sets `lang` on `<html>` when the page
  declares none, and marks the parts written in another script (WCAG 3.1.1 and
  3.1.2). That is what NVDA, JAWS and VoiceOver read to choose a voice, so it
  helps whether or not our own speech is used.
- **Our speech follows the text, not the page.** `TTSEngine.languageOf()` in
  [content.js](content.js) reads the script a run of text is written in, splits
  mixed text into runs at sentence ends (including the Bangla full stop `।`),
  and gives each run its own `lang` and the best installed voice. A Bangla page
  with English headings is read by two voices instead of one wrong one.

Script is not language: Latin letters could be English, French, or Bangla
transliterated. On a Bangla page they are nearly always English, and assuming
so beats reading them aloud in Bangla, but it is an assumption and the code
says as much. `lang` is set on the utterance even when no matching voice is
installed, because Chrome can still reach one of its own online voices from it.

### Pictures read out loud

Alt text only helps if something reads it. **Describe pictures out loud**, in
*Having pages read aloud*, makes every meaningful picture reachable with Tab;
pressing one speaks what it shows, and <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd>
reads whichever picture has focus, sits under the pointer, or is largest on
screen. Deliberate choices:

- **The page's own alt text wins.** It is instant, costs nothing, and someone
  who knew what the picture was for wrote it. The model is the fallback for the
  pictures that would otherwise be silent, and a second press replays a stored
  description rather than paying for it twice.
- **Nothing is described just because it has focus.** Tabbing past ten pictures
  would fire ten paid requests and talk over the user, so it takes a press.
- **Silence is never the answer.** A refusal, an offline error and a picture
  that cannot be read all come back as a sentence to speak, because a blind
  user cannot see that nothing happened.
- **`alt=""` is respected.** The page is saying the picture carries no meaning;
  reading it out would be noise.

Cross-origin pictures used to fail silently: a canvas is tainted for an image
from another origin without CORS headers, so the page cannot export its pixels,
and most sites serve images from a separate host. The service worker holds the
host permissions, so it fetches and downscales the file itself when the page
cannot ([background.js](background.js), `fetchImageAsDataUrl`).

Descriptions are cut on a word boundary, not at character 125. Spoken aloud,
"...effective September 1," stops a voice mid-thought; a shorter whole phrase
is worth more than a longer broken one.

Setup is in [server/README.md](server/README.md). Until you deploy it and set
`PROXY_ORIGIN` in [modules/ai-config.js](modules/ai-config.js), the three AI
buttons disable themselves and say so. Everything else works offline.

## The interface

The popup renders from `popup-schema.js`. One entry per setting, holding its
plain-language label, a one-sentence description, search keywords and the WCAG
criterion it serves. `popup.js` turns that into markup with DOM calls, which
means every control gets identical ARIA wiring and a setting cannot drift out
of sync with its own label.

Decisions worth defending:

**An accordion replaced the eleven tabs.** A tab strip that narrow forces
targets below the 44px minimum and hides which tab you are on. An accordion
reads top to bottom under a screen reader, and adding a search box over it means
a user can type "tremor" and land on the right control without knowing we filed
it under Moving and clicking.

**Home first, everything else one press away.** Most people open the panel
to have a page read, to stop it, or to find out what a page is about. Home
holds those, whether AccessiFlow is on for this site, the setup, and at most
six settings picked from the chosen needs (one from each need in turn, from
`home` in `profiles.js`). The rows on Home are copies of the rows under All
settings, with their own ids, and both follow every change. The needs filter
and the Quick setup grid of 2.x are gone: the setup page does their job once,
instead of on every visit.

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
cd server && npm install && npm test          # the proxy
cd test   && npm install && npm test          # 21 jsdom suites
cd test   && npm run test:browser             # real Chrome, extension installed
```

The Worker suite covers token forgery, payload tampering, expiry, origin
rejection, all three quota ladders, SSRF through the image field, prompt and
model override attempts, and that the Hugging Face token never appears in a
response. The popup suite renders the real `popup.html` under jsdom and asserts
every control has a `<label for>` and a resolvable `aria-describedby`, that no
id is duplicated even with the Home copies, that `aria-expanded` matches
`hidden` on every section, that a change lands in the setup or in the site's
exceptions as chosen, and that the Help list names every Alt+Shift key
`content.js` handles and every manifest command. `settings-store.test.js`
covers the layering and the 2.x migration, `key-echo.test.js` what is heard
while typing, and `welcome.test.js` the setup page's keys, voice and answers.
In real Chrome, `setup.js` installs AccessiFlow into a fresh profile, finishes
the setup with the keyboard alone, and checks that a site opened afterwards
follows it, that the Stop button shows and Ctrl stops speech, and that the
popup lays out in the real cascade.

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

- Until 3.0 the skip-link repair gave the page's `<main>` the id
  `accessiflow-main`. Every module treats an id starting `accessiflow-` as
  AccessiFlow's own furniture, so on sites without their own skip link the
  whole main content was skipped by smart dark mode, the page check, click
  snapping, voice commands and form summaries. The target is now
  `#main-accessiflow`; a check in `content.test.js` keeps it that way.
- Key echo and the floating Stop button work in the page itself, not inside
  an embedded frame from another site (a card payment box, some login
  forms), because the content script runs only in the top frame.
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
#   A c c e s s i f l o w - A c c e s s i b i l i t y - E x t e n s i o n  
 