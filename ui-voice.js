// AccessiFlow's voice on its own pages
//
// The setup page and the popup are extension pages. The content script, and
// with it the built-in screen reader, never runs there, so a blind user who
// relies on AccessiFlow's reader rather than NVDA would find both silent.
// This gives them a voice of their own: what has focus, what just changed,
// and the keys typed into a box.
//
// It speaks through chrome.tts, which needs no click first. A web page's own
// speech is refused until the user has pressed something, and the setup page
// has to talk from the moment it opens, because a blind user cannot find a
// Start button they cannot see.
//
// Where the page also loads the screen reader (modules/screen-reader.js and
// the modules it reads the page with), that reader runs here too, speaking
// through the same chrome.tts. Then the keys are the ones a blind user
// already knows from NVDA and from AccessiFlow on every website: the arrows
// read line by line, H jumps to a heading, B to a button, Insert and Down
// arrow reads everything. Without it, only what Tab lands on is said.
'use strict';

(function (root) {
  const ROLE_NAMES = {
    button: 'button', link: 'link', checkbox: 'check box', radio: 'radio button',
    switch: 'switch', slider: 'slider', combobox: 'combo box', listbox: 'list',
    textbox: 'edit', searchbox: 'search edit', tab: 'tab', menuitem: 'menu item',
    heading: 'heading', dialog: 'dialog'
  };

  function clean(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  /** Text of the elements named, leaving out anything hidden from speech. */
  function textOfIds(ids) {
    return clean(String(ids || '').split(/\s+/).map(id => {
      const node = id && document.getElementById(id);
      if (!node) return '';
      const copy = node.cloneNode(true);
      copy.querySelectorAll('[aria-hidden="true"], [hidden]').forEach(n => n.remove());
      return copy.textContent;
    }).join(' '));
  }

  /** The label text, without the text of the control inside the label. */
  function labelText(el) {
    const labels = el.labels ? Array.from(el.labels) : [];
    return clean(labels.map(label => {
      const copy = label.cloneNode(true);
      copy.querySelectorAll('input, select, textarea, output, [aria-hidden="true"]').forEach(n => n.remove());
      return copy.textContent;
    }).join(' '));
  }

  function nameOf(el) {
    return clean(el.getAttribute('aria-label')) ||
      textOfIds(el.getAttribute('aria-labelledby')) ||
      labelText(el) ||
      (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'SUMMARY' ? clean(el.textContent) : '') ||
      clean(el.getAttribute('placeholder')) ||
      clean(el.getAttribute('title')) ||
      (/^H[1-6]$/.test(el.tagName) ? clean(el.textContent) : '');
  }

  function roleOf(el) {
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role) return role;
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
    if (tag === 'A') return 'link';
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (/^H[1-6]$/.test(tag)) return 'heading';
    if (tag === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'search') return 'searchbox';
      if (type === 'button' || type === 'submit') return 'button';
      return 'textbox';
    }
    return '';
  }

  function stateOf(el, role) {
    const parts = [];
    if (role === 'switch') parts.push(el.checked || el.getAttribute('aria-checked') === 'true' ? 'on' : 'off');
    else if (role === 'checkbox') parts.push(el.checked ? 'checked' : 'not checked');
    else if (role === 'radio') parts.push(el.checked ? 'selected' : 'not selected');
    else if (role === 'slider') {
      const out = el.id ? document.querySelector('output[for="' + el.id + '"]') : null;
      parts.push(out ? clean(out.textContent) : String(el.value));
    } else if (role === 'combobox' && el.tagName === 'SELECT') {
      const option = el.options[el.selectedIndex];
      if (option) parts.push(clean(option.textContent));
    } else if (role === 'textbox' || role === 'searchbox') {
      parts.push(el.value ? (el.type === 'password' ? 'has text' : clean(el.value)) : 'blank');
    }
    const pressed = el.getAttribute('aria-pressed');
    if (pressed === 'true') parts.push('pressed');
    const expanded = el.getAttribute('aria-expanded');
    if (expanded === 'true') parts.push('expanded');
    else if (expanded === 'false') parts.push('collapsed');
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') parts.push('unavailable');
    return parts.join(', ');
  }

  /**
   * chrome.tts as the screen reader's voice. speak() resolves true once the
   * sentence was said to the end and false if something cut in, which is
   * what lets "read everything" go on to the next line and stop on a key.
   */
  function ttsBackend(voice) {
    let current = null;       // the sentence being said: { finish, guard, ms }

    function arm(turn) {
      clearTimeout(turn.guard);
      // Some voices never report the end, and reading everything would stop
      // for good on the first line. Long enough never to cut real speech.
      turn.guard = setTimeout(() => turn.finish(true), turn.ms);
    }

    return {
      speak(text) {
        // A paused engine stays paused for the next sentence unless stopped
        // first; something new to say means the pause is over.
        if (voice._paused) {
          voice._paused = false;
          try { chrome.tts.stop(); } catch (e) { /* ok */ }
        }
        return new Promise(resolve => {
          const turn = { guard: null, done: false };
          turn.ms = Math.min(60000, 2500 + text.length * 120 / Math.min(1, voice.rate || 1));
          turn.finish = ok => {
            if (turn.done) return;
            turn.done = true;
            clearTimeout(turn.guard);
            if (current === turn) current = null;
            resolve(ok);
          };
          current = turn;
          arm(turn);
          try {
            chrome.tts.speak(text, {
              rate: voice.rate,
              lang: 'en-US',
              enqueue: false,
              onEvent: event => {
                const type = event && event.type;
                if (type === 'end') turn.finish(true);
                else if (type === 'interrupted' || type === 'cancelled' || type === 'error') turn.finish(false);
              }
            });
          } catch (e) {
            turn.finish(false);
          }
        });
      },
      stop() {
        const turn = current;
        current = null;
        try { chrome.tts.stop(); } catch (e) { /* nothing was speaking */ }
        if (turn) turn.finish(false);
      },
      // While paused the sentence is not over, however long the pause.
      pause() { if (current) clearTimeout(current.guard); },
      resume() { if (current) arm(current); }
    };
  }

  /** "Text size, slider, 130%. Make all text on the page bigger or smaller." */
  function describe(el) {
    if (!el || el.nodeType !== 1) return '';
    const role = roleOf(el);
    const name = nameOf(el);
    const state = stateOf(el, role);
    const said = [name, ROLE_NAMES[role] || '', state].filter(Boolean).join(', ');
    const desc = textOfIds(el.getAttribute('aria-describedby'));
    return desc ? said + '. ' + desc : said;
  }

  const UiVoice = {
    on: false,
    rate: 1,
    reader: null,             // the screen reader, while it runs on this page
    _watching: false,
    _paused: false,
    _backend: null,
    _hostKey: null,

    /**
     * @param opts.rate     speaking speed
     * @param opts.hostKey  (e, target) → true for a key the page keeps for
     *                      itself in browse mode; target is what the reader's
     *                      cursor would press
     */
    enable(opts) {
      this.on = true;
      if (opts && typeof opts.rate === 'number') this.rate = opts.rate;
      if (opts && typeof opts.hostKey === 'function') this._hostKey = opts.hostKey;
      this._watch();
      this._startReader();
    },

    disable() {
      this.stop();
      this.on = false;
      if (this.reader) this.reader.disable();
      this.reader = null;
    },

    _startReader() {
      const Reader = root.AccessiFlowScreenReader;
      if (!Reader || !root.AccessiFlowSRBuffer || this.readerOn()) return;
      if (typeof document === 'undefined' || !document.body) return;
      if (!this._backend) this._backend = ttsBackend(this);
      const reader = new Reader();
      // Quiet: the page greets the user itself, in its own words.
      reader.enable(this._backend, {
        quietStart: true,
        hostKey: (e, target) => (this._hostKey ? this._hostKey(e, target) : false)
      });
      this.reader = reader;
    },

    /** Whether the screen reader is running on this page. */
    readerOn() {
      return Boolean(this.reader && this.reader.active);
    },

    /** "browse" or "focus" while the screen reader runs here; '' otherwise. */
    mode() {
      return this.readerOn() ? this.reader.mode : '';
    },

    /**
     * Moves focus without the voice naming the new spot, for a page about to
     * say more about it itself. The reader's cursor goes there too.
     */
    focusQuietly(node, opts) {
      if (!node) return;
      if (this.readerOn()) { this.reader.focusSilently(node, opts); return; }
      const was = this.on;
      this.on = false;
      try { node.focus(opts); } finally { this.on = was; }
    },

    setRate(rate) {
      if (typeof rate === 'number' && rate > 0) this.rate = rate;
    },

    /** Speaks now, cutting off anything else, unless opts.queue. */
    say(text, opts) {
      text = clean(text);
      if (!this.on || !text) return;
      // A paused engine stays paused for the next sentence unless stopped
      // first; something new to say means the pause is over.
      if (this._paused) this.stop();
      // One voice, one queue: said as the reader, so its next line cuts this
      // off and this cuts off its reading, instead of the two overlapping.
      if (this.readerOn()) {
        if (opts && opts.queue) this.reader.sayAfter(text);
        else this.reader.say(text);
        return;
      }
      try {
        chrome.tts.speak(text, {
          rate: this.rate,
          lang: 'en-US',
          enqueue: Boolean(opts && opts.queue)
        });
      } catch (e) { /* no speech on this platform */ }
    },

    /** Speaks at this rate once, whether or not the voice is on: a preview. */
    preview(text, rate) {
      if (this._paused) this.stop();
      try { chrome.tts.speak(clean(text), { rate: rate || this.rate, lang: 'en-US', enqueue: false }); }
      catch (e) { /* ok */ }
    },

    stop() {
      this._paused = false;
      if (this.readerOn()) this.reader.stopTalking();
      try { chrome.tts.stop(); } catch (e) { /* nothing was speaking */ }
    },

    /** Shift on its own: pause, and again carry on from the same place. */
    togglePause() {
      try {
        if (this._paused) {
          this._paused = false;
          chrome.tts.resume();
          if (this._backend) this._backend.resume();
          return;
        }
        chrome.tts.isSpeaking(speaking => {
          if (!speaking) return;
          this._paused = true;
          chrome.tts.pause();
          if (this._backend) this._backend.pause();
        });
      } catch (e) { /* no speech on this platform */ }
    },

    describe: describe,

    _watch() {
      if (this._watching) return;
      this._watching = true;

      // What has focus, as it arrives: the same thing a screen reader says.
      // The screen reader, when it runs here, says that itself.
      document.addEventListener('focusin', e => {
        if (!this.on || this.readerOn()) return;
        const text = describe(e.target);
        if (text) this.say(text);
      });

      // Keys typed into a box, one character at a time.
      document.addEventListener('input', e => {
        if (!this.on || !e.data || e.isComposing) return;
        const el = e.target;
        if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;
        if (el.type === 'range') return;
        const secret = el.type === 'password';
        const ch = e.data.length === 1 ? e.data : '';
        this.say(secret ? 'star' : ch === ' ' ? 'space' : (ch || e.data));
      });

      // Ctrl on its own stops speech, as in every screen reader, and Shift on
      // its own pauses it. Shift only counts when let go with nothing else
      // pressed, since it is also how capitals are typed and Tab goes back.
      let shiftAlone = false;
      document.addEventListener('keydown', e => {
        if (e.key === 'Control' && !e.altKey && !e.shiftKey && !e.metaKey) this.stop();
        if (e.key === 'Shift') {
          if (!e.repeat) shiftAlone = !(e.ctrlKey || e.altKey || e.metaKey);
        } else {
          shiftAlone = false;
        }
      });
      document.addEventListener('mousedown', () => { shiftAlone = false; });
      document.addEventListener('keyup', e => {
        if (e.key !== 'Shift') return;
        const alone = shiftAlone;
        shiftAlone = false;
        if (alone && this.on) this.togglePause();
      });
    }
  };

  root.AccessiFlowUiVoice = UiVoice;
})(typeof window !== 'undefined' ? window : globalThis);
