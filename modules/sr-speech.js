// AccessiFlow screen reader: speech
//
// The rule every screen reader lives by: whatever the user does next matters
// more than whatever is still being said. Pressing the down arrow twice must
// not queue two lines; the first is cut off and the second read at once.
// Anything the page announces by itself (a live region) waits its turn
// instead, because it was not asked for.
//
// The voice is not here. content.js hands in its TTSEngine, which already
// splits Bangla from English and speaks Bangla with the voice bundled in the
// extension when the computer has none, so the reader gets all of that for
// free. Tones are here: a mode change or the end of the page is heard faster
// as a beep than as a sentence.
'use strict';

(function (root) {
  const TONES = {
    focus: { freq: 880, ms: 60 },      // keys now go to the page
    browse: { freq: 440, ms: 60 },     // keys are the reader's again
    edge: { freq: 180, ms: 90 },       // nothing further that way
    busy: { freq: 660, ms: 30 }
  };

  class SRSpeech {
    /**
     * @param backend {speak(text) → Promise<boolean finished>, stop()}
     */
    constructor(backend) {
      this._backend = backend;
      this._turn = 0;
      this._queue = [];
      this._busy = false;
      this._audio = null;
      this.muted = false;
      this.onSpeak = null;        // told every line said, for the on-screen speech viewer
      this.last = '';
    }

    /**
     * Says this now, cutting off anything still being said. Resolves true if
     * it was said to the end, false if something else cut in.
     */
    say(text) {
      text = String(text || '').trim();
      this._queue = [];
      const turn = ++this._turn;
      if (!text) { this._stopBackend(); return Promise.resolve(false); }
      return this._speak(text, turn);
    }

    /** Says this once the current speech has finished. */
    queue(text) {
      text = String(text || '').trim();
      if (!text) return;
      if (!this._busy) { this._speak(text, ++this._turn); return; }
      this._queue.push(text);
    }

    stop() {
      this._turn++;
      this._queue = [];
      this._stopBackend();
    }

    _stopBackend() {
      this._busy = false;
      try { this._backend.stop(); } catch (e) { /* nothing was playing */ }
    }

    _speak(text, turn) {
      this.last = text;
      if (typeof this.onSpeak === 'function') {
        try { this.onSpeak(text); } catch (e) { /* the viewer is optional */ }
      }
      if (this.muted) return Promise.resolve(true);

      this._busy = true;
      let spoken;
      try { spoken = Promise.resolve(this._backend.speak(text)); } catch (e) { spoken = Promise.resolve(false); }
      return spoken.then(finished => {
        if (turn !== this._turn) return false;
        this._busy = false;
        const next = this._queue.shift();
        if (next) this._speak(next, ++this._turn);
        return finished !== false;
      }, () => {
        if (turn === this._turn) this._busy = false;
        return false;
      });
    }

    /** A short beep. Needs a key press first, which is always how it is reached. */
    tone(kind) {
      const t = TONES[kind];
      if (!t || this.muted) return;
      try {
        const Ctx = root.AudioContext || root.webkitAudioContext;
        if (!Ctx) return;
        if (!this._audio) this._audio = new Ctx();
        const ctx = this._audio;
        if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = t.freq;
        const now = ctx.currentTime;
        const end = now + t.ms / 1000;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.15, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(end + 0.01);
      } catch (e) { /* no audio here: the words still come */ }
    }

    destroy() {
      this.stop();
      if (this._audio && this._audio.close) { try { this._audio.close(); } catch (e) { /* ok */ } }
      this._audio = null;
    }
  }

  // What to call a character when it is read on its own. A lone "." read
  // aloud is silence in most voices.
  const SYMBOLS = {
    ' ': 'space', ' ': 'space', '.': 'dot', ',': 'comma', ';': 'semicolon', ':': 'colon',
    '!': 'bang', '?': 'question', '"': 'quote', '\'': 'apostrophe', '(': 'left paren',
    ')': 'right paren', '[': 'left bracket', ']': 'right bracket', '{': 'left brace',
    '}': 'right brace', '-': 'dash', '_': 'underline', '/': 'slash', '\\': 'backslash',
    '@': 'at', '#': 'number', '$': 'dollar', '%': 'percent', '&': 'and', '*': 'star',
    '+': 'plus', '=': 'equals', '<': 'less', '>': 'greater', '|': 'bar', '~': 'tilde',
    '`': 'grave', '^': 'caret', '…': 'dot dot dot', '–': 'dash', '—': 'dash',
    '।': 'dari'
  };

  function characterName(ch) {
    if (!ch) return 'blank';
    if (SYMBOLS[ch]) return SYMBOLS[ch];
    if (/[A-Z]/.test(ch)) return 'cap ' + ch;
    return ch;
  }

  SRSpeech.characterName = characterName;
  SRSpeech.TONES = TONES;
  root.AccessiFlowSRSpeech = SRSpeech;
})(typeof window !== 'undefined' ? window : globalThis);
