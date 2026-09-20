// AccessiFlow content script orchestrator
// Guards against double-injection, initializes modules, routes messages
'use strict';

(function () {
  // ── Double-injection guard ────────────────────────────────
  if (window.__accessiflowLoaded) return;
  window.__accessiflowLoaded = true;

  const PREFIX = '[AccessiFlow]';
  function _log(msg) { console.log(PREFIX + ' ' + msg); }
  function _warn(msg) { console.warn(PREFIX + ' ' + msg); }

  _log('Content script initializing on ' + location.hostname);

  // ── Module Instances ──────────────────────────────────────
  let blindModule = null;
  let visionModule = null;
  let motorModule = null;
  let cognitiveModule = null;
  let hearingModule = null;
  let seizureModule = null;
  let speechModule = null;
  let neuroModule = null;
  let banglaModule = null;
  let auditModule = null;
  let aiModule = null;
  let ttsEngine = null;

  try { blindModule = new BlindModule(); } catch (e) { _warn('BlindModule init failed: ' + e.message); }
  try { visionModule = new VisionModule(); } catch (e) { _warn('VisionModule init failed: ' + e.message); }
  try { motorModule = new MotorModule(); } catch (e) { _warn('MotorModule init failed: ' + e.message); }
  try { cognitiveModule = new CognitiveModule(); } catch (e) { _warn('CognitiveModule init failed: ' + e.message); }
  try { hearingModule = new HearingModule(); } catch (e) { _warn('HearingModule init failed: ' + e.message); }
  try { seizureModule = new SeizureModule(); } catch (e) { _warn('SeizureModule init failed: ' + e.message); }
  try { speechModule = new SpeechModule(); } catch (e) { _warn('SpeechModule init failed: ' + e.message); }
  try { neuroModule = new NeuroModule(); } catch (e) { _warn('NeuroModule init failed: ' + e.message); }
  try { banglaModule = new BanglaModule(); } catch (e) { _warn('BanglaModule init failed: ' + e.message); }
  try { auditModule = new AuditModule(); } catch (e) { _warn('AuditModule init failed: ' + e.message); }
  try { aiModule = new AIModule(); } catch (e) { _warn('AIModule init failed: ' + e.message); }

  // ── TTS Engine ────────────────────────────────────────────

  // Languages the extension can speak by itself, with the engine bundled in
  // vendor/espeak. Only used when the computer has no voice of its own for
  // them, which on Windows is every Bangla user who has not installed a
  // language pack.
  const OWN_VOICE_LANGS = { bn: true };
  class TTSEngine {
    constructor() {
      this.synth = window.speechSynthesis;
      this.rate = 1.0;
      this.pitch = 1.0;
      this.voice = null;
      this.isReading = false;
      this._currentEl = null;

      this._voices = [];
      this._pending = null;        // what to say once the voices arrive
      this._gaveUpWaiting = false;
      this._missingSaid = {};
      this.onMissingVoice = null;  // set by the page, to report it out loud
      this._watchVoices();
    }

    /**
     * Chrome builds its voice list asynchronously and returns an empty array
     * until it is ready, which is the state right after a page loads.
     * Choosing a voice in that window finds nothing and falls back to the
     * default English one, so Bangla was read by an English voice, which
     * produces silence. Anything said that early is held until the list
     * arrives, and spoken then.
     */
    _voiceList() {
      const list = this.synth.getVoices() || [];
      if (list.length) this._voices = list;
      return this._voices;
    }

    _watchVoices() {
      const arrived = () => {
        this._voiceList();
        const held = this._pending;
        if (held && this._voices.length) {
          this._pending = null;
          this.speak(held.text, held.element);
        }
      };

      try {
        this.synth.addEventListener('voiceschanged', arrived);
      } catch (e) {
        this.synth.onvoiceschanged = arrived;
      }

      // Some builds never fire the event. Never leave a held sentence unsaid:
      // speaking with the wrong voice still beats silence with no explanation.
      setTimeout(() => {
        this._gaveUpWaiting = true;
        const held = this._pending;
        this._pending = null;
        if (held) this.speak(held.text, held.element);
      }, 1500);
    }

    /** Said once per language: there is no voice here for this script. */
    _reportMissingVoice(lang) {
      if (this._missingSaid[lang]) return;
      this._missingSaid[lang] = true;
      const names = { bn: 'Bangla', hi: 'Hindi', ar: 'Arabic', ru: 'Russian',
                      ja: 'Japanese', ko: 'Korean', zh: 'Chinese' };
      const name = names[lang] || lang;
      if (typeof this.onMissingVoice === 'function') this.onMissingVoice(lang, name);
    }

    setRate(r) { this.rate = r; }
    setPitch(p) { this.pitch = p; }
    setVoice(name) {
      this.voice = this._voiceList().find(v => v.name === name) || null;
    }

    /**
     * Which language a piece of text is in, by the script it is written in.
     *
     * Without this every utterance is spoken by the browser's default voice,
     * which is usually English, and Bangla comes out as silence or nonsense.
     * The page cannot be trusted to say: the site this was written for
     * declares no language at all on a page that is almost entirely Bangla.
     */
    languageOf(text) {
      const scripts = [
        { lang: 'bn', re: /[\u0980-\u09FF]/g },   // Bangla
        { lang: 'hi', re: /[\u0900-\u097F]/g },   // Devanagari
        { lang: 'ar', re: /[\u0600-\u06FF]/g },   // Arabic
        { lang: 'ru', re: /[\u0400-\u04FF]/g },   // Cyrillic
        { lang: 'ja', re: /[\u3040-\u30FF]/g },   // Kana
        { lang: 'ko', re: /[\uAC00-\uD7AF]/g },   // Hangul
        { lang: 'zh', re: /[\u4E00-\u9FFF]/g }    // Han
      ];

      let best = null;
      let bestCount = 0;
      scripts.forEach(script => {
        const found = (text.match(script.re) || []).length;
        if (found > bestCount) { bestCount = found; best = script.lang; }
      });

      // A few stray characters are a quotation, not the language of the text.
      const letters = (text.match(/[^\s\d\p{P}]/gu) || []).length || 1;
      if (best && bestCount / letters > 0.2) return best;

      const declared = (document.documentElement.getAttribute('lang') || '').trim().toLowerCase();

      // Latin text on a page written in another script: the page's own
      // language would be the wrong voice for it. English is the assumption
      // because that is what Latin text on such pages nearly always is.
      const otherScript = /^(bn|hi|ar|ru|ja|ko|zh|ta|te|ur|fa|he|th|el)/.test(declared);
      if (otherScript && /[A-Za-z]/.test(text)) return 'en';

      return declared || 'en';
    }

    /** The best installed voice for a language, or null to let Chrome pick. */
    voiceFor(lang) {
      const voices = this._voiceList();
      const base = String(lang).toLowerCase().split('-')[0];

      // A voice the user chose themselves wins, but only for its own language.
      if (this.voice && String(this.voice.lang).toLowerCase().indexOf(base) === 0) return this.voice;

      return voices.find(v => String(v.lang).toLowerCase().replace('_', '-') === String(lang).toLowerCase()) ||
             voices.find(v => String(v.lang).toLowerCase().split(/[-_]/)[0] === base) ||
             (base === 'en' ? this.voice : null);
    }

    /**
     * Splits text into runs of one script each, so a Bangla page with English
     * headings is read by two voices instead of one wrong one. Runs shorter
     * than a few characters are folded into the previous one: switching voice
     * for a single bracket or digit sounds worse than reading it in place.
     */
    _byLanguage(text) {
      const parts = String(text).split(/(?<=[.!?\u0964\n])\s+/);   // \u0964 is the Bangla full stop
      const runs = [];
      parts.forEach(part => {
        if (!part.trim()) return;
        const lang = this.languageOf(part);
        const last = runs[runs.length - 1];
        if (last && (last.lang === lang || part.trim().length < 4)) last.text += ' ' + part;
        else runs.push({ lang: lang, text: part });
      });
      return runs.length ? runs : [{ lang: this.languageOf(text), text: String(text) }];
    }

    speak(text, element) {
      if (!text || !text.trim()) return;

      // Still waiting for Chrome's voice list: hold this rather than say it
      // in the wrong voice.
      if (!this._voiceList().length && !this._gaveUpWaiting) {
        this._pending = { text: text, element: element };
        return;
      }

      this.stop();

      const runs = this._byLanguage(text);
      if (element) this.highlightCurrent(element);
      this.isReading = true;
      this._turn = (this._turn || 0) + 1;
      this._playRuns(runs, this._turn);
    }

    /**
     * Runs are played one at a time rather than queued all at once, because
     * some go to the browser's voices and some to the engine inside the
     * extension, and those two know nothing about each other. Waiting for
     * each keeps a mixed-language page in order instead of two voices talking
     * over one another.
     */
    _playRuns(runs, turn) {
      const next = i => {
        if (turn !== this._turn) return;          // stopped, or replaced
        if (i >= runs.length) {
          this.unhighlight();
          this.isReading = false;
          return;
        }
        this._playRun(runs[i]).then(() => next(i + 1), () => next(i + 1));
      };
      next(0);
    }

    _playRun(run) {
      const voice = this.voiceFor(run.lang);
      // No voice on this computer, but we brought one: use it rather than
      // hand the text to a voice that will say nothing.
      if (!voice && OWN_VOICE_LANGS[run.lang]) return this._playWithOwnVoice(run);
      return this._playWithBrowser(run, voice);
    }

    _playWithBrowser(run, voice) {
      return new Promise(resolve => {
        // Chrome sometimes never fires onend, and a queue waiting on it
        // would leave the rest of the page unread. Generous enough never to
        // cut real speech short: a sentence takes nothing like this long.
        let guard = setTimeout(finish, Math.min(60000, 2500 + run.text.length * 120));
        let ended = false;
        function finish() {
          if (ended) return;
          ended = true;
          clearTimeout(guard);
          resolve();
        }

        const utter = new SpeechSynthesisUtterance(run.text);
        utter.rate = this.rate;
        utter.pitch = this.pitch;
        // A region is added when only the bare language is known: Chrome
        // matches its own online voices on tags like bn-BD, not bn.
        utter.lang = this.regionFor(run.lang);
        if (voice) utter.voice = voice;

        const started = Date.now();
        utter.onend = () => {
          // Nothing installed for this script and nothing bundled either: the
          // engine returns at once without making a sound, and the user is
          // owed an explanation rather than silence.
          if (!voice && run.lang !== 'en' && run.text.length > 20 && Date.now() - started < 250) {
            this._reportMissingVoice(run.lang);
          }
          finish();
        };
        utter.onerror = () => {
          if (!voice && run.lang !== 'en') this._reportMissingVoice(run.lang);
          finish();
        };
        this.synth.speak(utter);
      });
    }

    /** Speech from the engine shipped inside the extension. */
    _playWithOwnVoice(run) {
      return new Promise(resolve => {
        try {
          chrome.runtime.sendMessage({
            action: 'speakOffline',
            text: run.text,
            lang: run.lang,
            rate: this.rate,
            pitch: this.pitch,
            natural: Boolean(currentSettings.naturalBanglaVoice)
          }, reply => {
            void chrome.runtime.lastError;
            if (reply && reply.success === false) this._reportMissingVoice(run.lang);
            resolve();
          });
        } catch (e) {
          resolve();
        }
      });
    }

    /** bn on its own matches no Chrome voice; bn-BD does. */
    regionFor(lang) {
      if (String(lang).indexOf('-') > -1) return lang;
      const regions = { bn: 'bn-BD', hi: 'hi-IN', ar: 'ar-SA', ru: 'ru-RU',
                        ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', en: 'en-US' };
      return regions[lang] || lang;
    }

    readSelection() {
      const sel = window.getSelection().toString().trim();
      if (sel) this.speak(sel);
    }

    readHovered(element) {
      if (element && element.textContent) {
        this.speak(element.textContent.trim().substring(0, 500), element);
      }
    }

    readPage() {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
      const texts = [];
      let node;
      while ((node = walker.nextNode())) {
        const t = node.textContent.trim();
        if (t.length > 2) texts.push(t);
      }
      this.speak(texts.join('. '));
    }

    stop() {
      this._turn = (this._turn || 0) + 1;   // abandon anything still queued
      this._pending = null;
      try { this.synth.cancel(); } catch (e) { /* ok */ }
      try {
        chrome.runtime.sendMessage({ action: 'stopOffline' }, () => { void chrome.runtime.lastError; });
      } catch (e) { /* the worker may be asleep; nothing is playing then */ }
      this.isReading = false;
      this.unhighlight();
    }

    highlightCurrent(element) {
      this.unhighlight();
      if (element && element.classList) {
        element.classList.add('accessiflow-tts-highlight');
        this._currentEl = element;
      }
    }

    unhighlight() {
      if (this._currentEl && this._currentEl.classList) {
        this._currentEl.classList.remove('accessiflow-tts-highlight');
      }
      this._currentEl = null;
    }
  }

  try { ttsEngine = new TTSEngine(); } catch (e) { _warn('TTS init failed: ' + e.message); }

  // Said in English, because the missing voice is the one that would have
  // said it. Without this the user just gets silence and no reason for it.
  if (ttsEngine) {
    ttsEngine.onMissingVoice = (lang, name) => {
      const message = 'This browser has no ' + name + ' voice installed, so ' +
        name + ' text cannot be read aloud. You can add one in your system ' +
        'speech settings.';
      _warn(message);
      try {
        announceToPage(message);
        const utter = new SpeechSynthesisUtterance(message);
        utter.lang = 'en-US';
        window.speechSynthesis.speak(utter);
      } catch (e) { /* nothing more we can do */ }
    };
  }

  // ── Describing pictures out loud ──────────────────────────
  //
  // A description in the alt attribute only helps if something reads it out,
  // and plenty of blind and low-vision users browse without a screen reader
  // running on every page. With this on, each meaningful picture can be
  // reached with Tab and speaks what it shows when pressed: the page's own
  // description when it has one, the AI's when it does not.
  //
  // Pictures are never described on focus alone. Tabbing past ten pictures
  // would fire ten paid requests and talk over the user; it takes a press.
  const ImageSpeech = {
    active: false,
    _busy: false,
    _pointer: null,

    apply(on) { if (on) this.enable(); else this.disable(); },

    enable() {
      if (this.active) return;
      this.active = true;
      document.addEventListener('click', this._onClick, true);
      document.addEventListener('keydown', this._onKey, true);
      document.addEventListener('mousemove', this._onMove, { passive: true });
      // A lazily loaded picture has no size yet, so it would be skipped and
      // never looked at again. `load` does not bubble, but a capturing
      // listener on the document still sees each one arrive.
      document.addEventListener('load', this._onLoad, true);
      this.refresh();
      _log('Picture speech on');
    },

    disable() {
      if (!this.active) return;
      this.active = false;
      document.removeEventListener('click', this._onClick, true);
      document.removeEventListener('keydown', this._onKey, true);
      document.removeEventListener('mousemove', this._onMove);
      document.removeEventListener('load', this._onLoad, true);
      document.querySelectorAll('[data-accessiflow-speak]').forEach(img => {
        // Only give back a tabindex we added ourselves.
        if (img.getAttribute('data-accessiflow-speak') === 'added') img.removeAttribute('tabindex');
        img.removeAttribute('data-accessiflow-speak');
        img.removeAttribute('data-accessiflow-speak-hint');
        img.classList.remove('accessiflow-image-busy');
      });
      if (ttsEngine) ttsEngine.stop();
    },

    /** Makes pictures reachable with Tab. Called again as a page adds more. */
    refresh(root) {
      if (!this.active) return;
      const scope = (root && root.querySelectorAll) ? root : document;
      scope.querySelectorAll('img:not([data-accessiflow-speak])').forEach(img => {
        ImageSpeech._mark(img);
      });
    },

    /** Gives one picture a focus stop, if it is one worth speaking. */
    _mark(img) {
      if (!this.active || !img || img.hasAttribute('data-accessiflow-speak')) return;
      if (!this._worthSpeaking(img)) return;
      // A picture inside a link or button already has a focus stop, and taking
      // its click would break the link. Alt+Shift+D still reads those.
      if (img.closest('a, button, [role="button"], [role="link"]')) return;

      const had = img.hasAttribute('tabindex');
      img.setAttribute('data-accessiflow-speak', had ? 'keep' : 'added');
      if (!had) img.setAttribute('tabindex', '0');
    },

    _worthSpeaking(img) {
      if (!img || img.tagName !== 'IMG') return false;
      if (img.getAttribute('aria-hidden') === 'true') return false;
      if (img.getAttribute('role') === 'presentation') return false;

      // alt="" is the page saying this picture carries no meaning. Reading it
      // out would be noise. Our own placeholder is not such a statement.
      const placeholder = img.getAttribute('data-accessiflow-alt-repaired') === 'placeholder';
      if (!placeholder && img.hasAttribute('alt') && !img.getAttribute('alt').trim()) return false;

      const rect = img.getBoundingClientRect();
      const min = (aiModule && aiModule.cfg && aiModule.cfg.IMAGE_MIN_EDGE) || 48;
      return rect.width >= min && rect.height >= min;
    },

    _onClick: e => {
      const img = (e.target && e.target.closest) ? e.target.closest('img[data-accessiflow-speak]') : null;
      if (img) ImageSpeech.speakFor(img);
    },

    _onKey: e => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      const el = document.activeElement;
      if (!el || !el.matches || !el.matches('img[data-accessiflow-speak]')) return;
      e.preventDefault();   // Space would otherwise scroll the page
      ImageSpeech.speakFor(el);
    },

    _onMove: e => { ImageSpeech._pointer = { x: e.clientX, y: e.clientY }; },

    _onLoad: e => {
      if (e.target && e.target.tagName === 'IMG') ImageSpeech._mark(e.target);
    },

    /** Speaks one picture. One at a time: each AI request costs something. */
    speakFor(img) {
      if (!img || !ttsEngine || !aiModule) return;
      if (this._busy) return;

      this._busy = true;
      img.classList.add('accessiflow-image-busy');

      aiModule.describeForSpeech(img, () => {
        ttsEngine.speak('Describing this picture. One moment.');
      }).then(result => {
        ttsEngine.speak(result.text || result.error || 'This picture could not be described.', img);
      }).catch(e => {
        _warn('speakFor: ' + e.message);
        ttsEngine.speak('This picture could not be described.');
      }).then(() => {
        this._busy = false;
        img.classList.remove('accessiflow-image-busy');
      });
    },

    /**
     * The picture the user is on: whatever has focus, then whatever is under
     * the pointer, then the biggest one on screen. This is what Alt+Shift+D
     * reads, and it works for pictures inside links too.
     */
    describeCurrent() {
      const img = this._focusedImage() || this._pointerImage() || this._largestVisibleImage();
      if (!img) {
        if (ttsEngine) ttsEngine.speak('No picture found here.');
        return;
      }
      this.speakFor(img);
    },

    _focusedImage() {
      const el = document.activeElement;
      if (!el) return null;
      if (el.tagName === 'IMG') return el;
      const inside = el.querySelector ? el.querySelector('img') : null;
      return (inside && this._worthSpeaking(inside)) ? inside : null;
    },

    _pointerImage() {
      if (!this._pointer) return null;
      const el = document.elementFromPoint(this._pointer.x, this._pointer.y);
      if (!el) return null;
      const img = el.tagName === 'IMG' ? el : (el.closest ? el.closest('img') : null);
      return (img && this._worthSpeaking(img)) ? img : null;
    },

    _largestVisibleImage() {
      let best = null;
      let bestArea = 0;
      document.querySelectorAll('img').forEach(img => {
        if (!this._worthSpeaking(img)) return;
        const r = img.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return;
        const area = r.width * r.height;
        if (area > bestArea) { bestArea = area; best = img; }
      });
      return best;
    }
  };

  // ── Dynamic Style Element ─────────────────────────────────
  let dynamicStyle = document.getElementById('accessiflow-dynamic');
  if (!dynamicStyle) {
    dynamicStyle = document.createElement('style');
    dynamicStyle.id = 'accessiflow-dynamic';
    document.head.appendChild(dynamicStyle);
  }

  // ── Current settings state ────────────────────────────────
  let currentSettings = {};
  let blindMode = true; // Always on by default
  let extensionEnabled = true;

  // ── Apply Settings ────────────────────────────────────────
  function applySettings(settings) {
    try {
      currentSettings = settings || {};
      _log('Applying settings: ' + Object.keys(currentSettings).filter(k => currentSettings[k]).join(', '));

      // Build CSS from modules
      let css = '';

      // Destroy all modules first for clean state
      try { if (visionModule) visionModule.destroy(); } catch (e) { /* ok */ }
      try { if (motorModule) motorModule.destroy(); } catch (e) { /* ok */ }
      try { if (cognitiveModule) cognitiveModule.destroy(); } catch (e) { /* ok */ }
      try { if (hearingModule) hearingModule.destroy(); } catch (e) { /* ok */ }
      try { if (seizureModule) seizureModule.destroy(); } catch (e) { /* ok */ }
      try { if (speechModule) speechModule.destroy(); } catch (e) { /* ok */ }
      try { if (neuroModule) neuroModule.destroy(); } catch (e) { /* ok */ }
      try { if (banglaModule) banglaModule.destroy(); } catch (e) { /* ok */ }

      // Vision
      if (visionModule) {
        try {
          css += visionModule.buildCSS(settings);
          visionModule.apply(settings);
        } catch (e) { _warn('Vision apply error: ' + e.message); }
      }

      // Motor
      if (motorModule) {
        try {
          css += motorModule.buildCSS(settings);
          motorModule.apply(settings);
        } catch (e) { _warn('Motor apply error: ' + e.message); }
      }

      // Cognitive
      if (cognitiveModule) {
        try {
          css += cognitiveModule.buildCSS(settings);
          cognitiveModule.apply(settings);
        } catch (e) { _warn('Cognitive apply error: ' + e.message); }
      }

      // Hearing
      if (hearingModule) {
        try {
          hearingModule.apply(settings);
        } catch (e) { _warn('Hearing apply error: ' + e.message); }
      }

      // Seizure
      if (seizureModule) {
        try {
          css += seizureModule.buildCSS(settings);
          seizureModule.apply(settings);
        } catch (e) { _warn('Seizure apply error: ' + e.message); }
      }

      // Speech
      if (speechModule) {
        try {
          css += speechModule.buildCSS(settings);
          speechModule.apply(settings);
        } catch (e) { _warn('Speech apply error: ' + e.message); }
      }

      // Neuro
      if (neuroModule) {
        try {
          css += neuroModule.buildCSS(settings);
          neuroModule.apply(settings);
        } catch (e) { _warn('Neuro apply error: ' + e.message); }
      }

      // Bangla
      if (banglaModule) {
        try {
          css += banglaModule.buildCSS(settings);
          banglaModule.apply(settings);
        } catch (e) { _warn('Bangla apply error: ' + e.message); }
      }

      // Blind
      if (blindMode && blindModule) {
        try {
          blindModule.runAll();
        } catch (e) { _warn('Blind apply error: ' + e.message); }
      }

      // Describe pictures out loud
      try {
        ImageSpeech.apply(!!settings.speakImageDescriptions);
      } catch (e) { _warn('Picture speech apply error: ' + e.message); }

      // TTS rate/pitch/voice
      if (ttsEngine) {
        if (settings.ttsRate) ttsEngine.setRate(settings.ttsRate);
        if (settings.ttsPitch) ttsEngine.setPitch(settings.ttsPitch);
        if (settings.ttsVoice) ttsEngine.setVoice(settings.ttsVoice);
      }

      // Update dynamic style
      dynamicStyle.textContent = css;

      // Save settings per hostname
      saveSettings(settings);
    } catch (e) {
      _warn('applySettings error: ' + e.message);
    }
  }

  // ── Settings Persistence ──────────────────────────────────
  function getSettingsKey() {
    return 'settings_' + location.hostname;
  }

  function saveSettings(settings) {
    try {
      const key = getSettingsKey();
      chrome.storage.local.set({ [key]: settings });
    } catch (e) { _warn('saveSettings error: ' + e.message); }
  }

  function loadSettings() {
    try {
      const key = getSettingsKey();
      chrome.storage.local.get(key, data => {
        if (data[key]) {
          _log('Loaded saved settings for ' + location.hostname);
          applySettings(data[key]);
        } else {
          // No saved settings, so just run the blind module
          if (blindMode && blindModule) {
            try { blindModule.runAll(); } catch (e) { _warn('Blind auto-run error: ' + e.message); }
          }
        }
      });
    } catch (e) {
      _warn('loadSettings error: ' + e.message);
      if (blindMode && blindModule) {
        try { blindModule.runAll(); } catch (e2) { /* ok */ }
      }
    }
  }

  // ── Reset / Destroy All ───────────────────────────────────
  function destroyAll() {
    try { if (visionModule) visionModule.destroy(); } catch (e) { /* ok */ }
    try { if (motorModule) motorModule.destroy(); } catch (e) { /* ok */ }
    try { if (cognitiveModule) cognitiveModule.destroy(); } catch (e) { /* ok */ }
    try { if (hearingModule) hearingModule.destroy(); } catch (e) { /* ok */ }
    try { if (seizureModule) seizureModule.destroy(); } catch (e) { /* ok */ }
    try { if (speechModule) speechModule.destroy(); } catch (e) { /* ok */ }
    try { if (neuroModule) neuroModule.destroy(); } catch (e) { /* ok */ }
    try { if (banglaModule) banglaModule.destroy(); } catch (e) { /* ok */ }
    try { if (blindModule) blindModule.destroy(); } catch (e) { /* ok */ }
    try { ImageSpeech.disable(); } catch (e) { /* ok */ }
    try { if (ttsEngine) ttsEngine.stop(); } catch (e) { /* ok */ }
    if (dynamicStyle) dynamicStyle.textContent = '';
    currentSettings = {};
  }

  // ── Message Router ────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.action) return;

    _log('Message received: ' + msg.action);

    try {
      switch (msg.action) {
        case 'applySettings':
          applySettings(msg.data || {});
          sendResponse({ success: true });
          break;

        case 'getSettings':
          sendResponse({ success: true, data: currentSettings });
          break;

        case 'resetSettings':
          destroyAll();
          const key = getSettingsKey();
          chrome.storage.local.remove(key);
          sendResponse({ success: true });
          break;

        case 'toggleExtension':
          extensionEnabled = !extensionEnabled;
          if (!extensionEnabled) {
            destroyAll();
          } else {
            loadSettings();
          }
          sendResponse({ success: true, enabled: extensionEnabled });
          break;

        case 'runAudit':
          if (auditModule) {
            const results = auditModule.runFullAudit();
            sendResponse({ success: true, data: results });
            chrome.runtime.sendMessage({ action: 'auditResults', data: results });
          } else {
            sendResponse({ success: false, error: 'AuditModule not loaded' });
          }
          break;

        case 'aiDescribeImages':
          if (aiModule) {
            aiModule.describeAllImages((done, total) => {
              chrome.runtime.sendMessage({
                action: 'aiProgress', kind: 'images', done: done, total: total
              }, () => { void chrome.runtime.lastError; });
            }).then(result => sendResponse({ success: true, result: result }));
            return true; // async
          }
          sendResponse({ success: false, error: 'The AI helper is not loaded on this page.' });
          break;

        case 'aiSummarizePage':
          if (aiModule) {
            aiModule.summarizePage()
              .then(summary => sendResponse({ success: true, summary: summary }))
              .catch(err => sendResponse({ success: false, error: err.message }));
            return true;
          }
          sendResponse({ success: false, error: 'The AI helper is not loaded on this page.' });
          break;

        case 'aiFixLinks':
          if (aiModule) {
            aiModule.relabelAllLinks((done, total) => {
              chrome.runtime.sendMessage({
                action: 'aiProgress', kind: 'links', done: done, total: total
              }, () => { void chrome.runtime.lastError; });
            }).then(result => sendResponse({ success: true, result: result }));
            return true;
          }
          sendResponse({ success: false, error: 'The AI helper is not loaded on this page.' });
          break;

        case 'aiCancel':
          if (aiModule) aiModule.cancel();
          sendResponse({ success: true });
          break;

        case 'aiCounts':
          if (aiModule) {
            sendResponse({
              success: true,
              images: aiModule.countImagesNeedingAlt(),
              links: aiModule.countVagueLinks()
            });
          } else {
            sendResponse({ success: false, images: 0, links: 0 });
          }
          break;

        case 'ttsReadPage':
          if (ttsEngine) ttsEngine.readPage();
          sendResponse({ success: true });
          break;

        case 'ttsReadSelection':
          if (ttsEngine) ttsEngine.readSelection();
          sendResponse({ success: true });
          break;

        case 'ttsStop':
          if (ttsEngine) ttsEngine.stop();
          sendResponse({ success: true });
          break;

        case 'ping':
          sendResponse({ success: true, loaded: true });
          break;

        default:
          _warn('Unknown action: ' + msg.action);
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (e) {
      _warn('Message handler error: ' + e.message);
      sendResponse({ success: false, error: e.message });
    }
  });

  // ── MutationObserver ──────────────────────────────────────
  const observer = new MutationObserver(mutations => {
    if (!extensionEnabled) return;
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        try {
          // Always run blind repairs on new nodes
          if (blindMode && blindModule) blindModule.repairNode(node);

          // Run hearing observer features if active
          if (currentSettings.captionImages && hearingModule) {
            hearingModule.toggleCaptionImages(true, node);
          }
          if (currentSettings.muteVideos && hearingModule) {
            hearingModule.toggleMuteVideos(true, node);
          }
          if (currentSettings.speakImageDescriptions) ImageSpeech.refresh(node);
        } catch (e) { /* suppress observer errors */ }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ── Profiles from the keyboard ────────────────────────────
  //
  // Someone who cannot see the screen cannot open a panel, read seventy
  // switches and pick the eight that help them. One keypress turns on the
  // whole bundle for their disability and says out loud which one it was, so
  // the tool is usable before any of its reading features are even on.

  const PROFILES = (typeof ACCESSIFLOW_PROFILES !== 'undefined' && ACCESSIFLOW_PROFILES) ||
                   window.ACCESSIFLOW_PROFILES || [];

  /**
   * Says something twice over: into a live region, which a screen reader
   * reads, and in our own voice, for someone who has no screen reader running.
   * Kept to one short sentence, because anyone using both hears it twice.
   */
  function tellUser(message) {
    announceToPage(message);
    if (ttsEngine) {
      try { ttsEngine.speak(message); } catch (e) { _warn('tellUser: ' + e.message); }
    }
  }

  function applyProfile(profile) {
    if (!profile) return;
    const next = Object.assign({}, profile.settings);
    applySettings(next);
    saveSettings(next);
    _log('Profile applied: ' + profile.id);
    tellUser(profile.label + ' profile on. ' + profile.desc);
  }

  function turnEverythingOff() {
    destroyAll();
    try { chrome.storage.local.remove(getSettingsKey()); } catch (e) { /* ok */ }
    tellUser('Everything off. This page is back to normal.');
  }

  /** Reads the profile list out, so the shortcuts can be found by ear. */
  function listProfiles() {
    if (!PROFILES.length) return;
    const spoken = PROFILES.map(p => 'Alt Shift ' + p.key + ', ' + p.label).join('. ');
    tellUser('AccessiFlow profiles. ' + spoken + '. Alt Shift 8, everything off.');
  }

  // ── Keyboard Shortcuts ────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (!extensionEnabled) return;
    if (!e.altKey || !e.shiftKey) return;

    // Profiles: Alt+Shift+1..7 turn one on, 8 turns everything off, 9 reads
    // the list. e.code rather than e.key, because with Shift held down "1"
    // arrives as "!" and differs by keyboard layout.
    const digit = /^Digit([0-9])$/.exec(e.code || '');
    if (digit) {
      const pressed = digit[1];
      if (pressed === '9') listProfiles();
      else if (pressed === '8') turnEverythingOff();
      else {
        const profile = PROFILES.find(p => p.key === pressed);
        if (!profile) return;          // an unassigned digit belongs to the page
        applyProfile(profile);
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    const key = e.key.toUpperCase();
    let handled = false;

    switch (key) {
      // Alt+Shift+A is owned by the manifest `commands` entry, which routes
      // through the service worker to the toggleExtension message below.
      // Handling it here as well made the two cancel each other out.
      case 'R': // Read page
        if (ttsEngine) ttsEngine.readPage();
        handled = true;
        break;
      case 'S': // Stop TTS
        if (ttsEngine) ttsEngine.stop();
        handled = true;
        break;
      case 'C': // Toggle high contrast
        currentSettings.highContrast = !currentSettings.highContrast;
        applySettings(currentSettings);
        handled = true;
        break;
      case 'F': // Toggle focus ring
        currentSettings.enhancedFocus = !currentSettings.enhancedFocus;
        applySettings(currentSettings);
        handled = true;
        break;
      case 'T': // Toggle large cursor
        currentSettings.largeCursor = !currentSettings.largeCursor;
        applySettings(currentSettings);
        handled = true;
        break;
      case 'M': // Toggle reading mask
        currentSettings.readingMask = !currentSettings.readingMask;
        applySettings(currentSettings);
        handled = true;
        break;
      case 'D': // Describe the picture I am on, and read it out
        e.preventDefault();
        e.stopPropagation();
        ImageSpeech.describeCurrent();
        return;   // its own speech is the feedback; no shortcut announcement
      case 'N': // Next heading, handled by BlindModule
        break;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      // Announce shortcut activation
      announceShortcut(key);
    }
  });

  // TTS: Read selection on mouseup if enabled
  document.addEventListener('mouseup', () => {
    if (!extensionEnabled || !ttsEngine || !currentSettings.ttsReadOnSelect) return;
    setTimeout(() => { ttsEngine.readSelection(); }, 100);
  });

  function announceShortcut(key) {
    const labels = {
      'A': 'AccessiFlow toggled',
      'R': 'Reading page aloud',
      'S': 'Speech stopped',
      'C': 'High contrast toggled',
      'F': 'Focus ring toggled',
      'T': 'Large cursor toggled',
      'M': 'Reading mask toggled',
    };
    announceToPage(labels[key] || 'Shortcut activated');
  }

  /** The page's own live region, which a screen reader reads out. */
  function announceToPage(msg) {
    let region = document.getElementById('accessiflow-shortcut-announce');
    if (!region) {
      region = document.createElement('div');
      region.id = 'accessiflow-shortcut-announce';
      region.setAttribute('aria-live', 'assertive');
      region.setAttribute('role', 'status');
      region.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;';
      document.body.appendChild(region);
    }
    region.textContent = msg;
    setTimeout(() => { region.textContent = ''; }, 2000);
  }

  // ── Auto-load saved settings ──────────────────────────────
  loadSettings();

  _log('Content script ready.');
})();
