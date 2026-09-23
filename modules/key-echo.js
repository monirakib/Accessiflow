// AccessiFlow key echo
//
// Says what you type, as you type it: each letter, each finished word, or
// both, the way NVDA's "speak typed characters" and "speak typed words" do.
// Without it, a blind user typing into a web form without a screen reader
// running has no idea whether the keys they pressed arrived.
//
// It listens to `beforeinput` and `input` rather than keydown, because only
// those know what actually went into the box: the character a Bangla or
// Chinese input method produced, a key that the site swallowed, or a
// backspace that had nothing left to delete.
//
// Password boxes say "star" for each key, never the character, because
// anyone within earshot would otherwise hear the password.
'use strict';

(function (root) {
  const TEXT_TYPES = ['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number'];

  // What ends a word, and so triggers speaking it. Not the apostrophe: it
  // sits inside words ("don't"), and would cut them in half.
  const WORD_END = /[\s.,;:!?)\]}"।…]/;
  // What a word is made of: letters and their marks (Bangla vowel signs are
  // marks), digits, and the joiners that sit inside words.
  const LAST_WORD = /[\p{L}\p{M}\p{N}'’_-]+$/u;

  function charName(ch) {
    const Speech = root.AccessiFlowSRSpeech;
    if (Speech && Speech.characterName) return Speech.characterName(ch);
    return ch === ' ' ? 'space' : ch;
  }

  /** A rich text region, such as a mail editor or a chat box. */
  function isEditableRegion(el) {
    if (el.isContentEditable) return true;
    const attr = el.getAttribute('contenteditable');
    return attr === '' || attr === 'true' || attr === 'plaintext-only';
  }

  /** A box whose keys are the user's typing, and so worth echoing. */
  function isTextField(el) {
    if (!el || el.nodeType !== 1 || el.disabled || el.readOnly) return false;
    if (isEditableRegion(el)) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    return TEXT_TYPES.indexOf((el.getAttribute('type') || '').toLowerCase()) !== -1;
  }

  function isSecret(el) {
    return Boolean(el) && el.tagName === 'INPUT' &&
      (el.getAttribute('type') || '').toLowerCase() === 'password';
  }

  /** The element the event really happened in, even inside a shadow root. */
  function targetOf(e) {
    const path = e.composedPath ? e.composedPath() : null;
    let el = (path && path[0]) || e.target;
    if (el && el.nodeType === 3) el = el.parentElement;
    // A contenteditable region fires on its host, not on the inner node.
    while (el && el.nodeType === 1 && !isTextField(el) && el.parentElement &&
           isEditableRegion(el.parentElement)) {
      el = el.parentElement;
    }
    return el;
  }

  /** Text before the caret, for finding the word just finished. */
  function textBeforeCaret(el) {
    if (isEditableRegion(el)) {
      const sel = el.ownerDocument.getSelection();
      if (!sel || !sel.rangeCount) return '';
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType !== 3) return '';
      return node.data.slice(0, range.startOffset);
    }
    const end = typeof el.selectionStart === 'number' ? el.selectionStart : String(el.value || '').length;
    return String(el.value || '').slice(0, end);
  }

  /** What a delete is about to remove, before it happens. */
  function aboutToDelete(el, inputType) {
    const forward = inputType === 'deleteContentForward';
    if (isEditableRegion(el)) {
      const sel = el.ownerDocument.getSelection();
      if (!sel || !sel.rangeCount) return '';
      if (!sel.isCollapsed) return sel.toString();
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType !== 3) return '';
      const at = range.startOffset;
      return forward ? node.data.charAt(at) : node.data.charAt(at - 1);
    }
    const value = String(el.value || '');
    let start, end;
    try { start = el.selectionStart; end = el.selectionEnd; } catch (e) { return ''; }
    if (typeof start !== 'number') return '';
    if (start !== end) return value.slice(start, end);
    return forward ? value.charAt(start) : value.charAt(start - 1);
  }

  class KeyEcho {
    constructor() {
      this.mode = 'off';
      this._speak = null;
      this._composing = false;
      this._h = {
        before: e => this._onBeforeInput(e),
        input: e => this._onInput(e),
        compStart: () => { this._composing = true; },
        compEnd: e => this._onCompositionEnd(e)
      };
      this._listening = false;
    }

    /** fn(text) speaks, cutting off whatever was being said. */
    setSpeaker(fn) { this._speak = fn; }

    apply(mode) {
      const wanted = ['letters', 'words', 'both'].indexOf(mode) !== -1 ? mode : 'off';
      this.mode = wanted;
      if (wanted === 'off') this._stop();
      else this._start();
    }

    _start() {
      if (this._listening) return;
      this._listening = true;
      document.addEventListener('beforeinput', this._h.before, true);
      document.addEventListener('input', this._h.input, true);
      document.addEventListener('compositionstart', this._h.compStart, true);
      document.addEventListener('compositionend', this._h.compEnd, true);
    }

    _stop() {
      if (!this._listening) return;
      this._listening = false;
      document.removeEventListener('beforeinput', this._h.before, true);
      document.removeEventListener('input', this._h.input, true);
      document.removeEventListener('compositionstart', this._h.compStart, true);
      document.removeEventListener('compositionend', this._h.compEnd, true);
      this._composing = false;
    }

    destroy() { this._stop(); }

    _say(text) {
      if (!text || typeof this._speak !== 'function') return;
      try { this._speak(text); } catch (e) { /* speech is best effort */ }
    }

    get _letters() { return this.mode === 'letters' || this.mode === 'both'; }
    get _words() { return this.mode === 'words' || this.mode === 'both'; }

    // Deletions have to be read before they happen: afterwards the character
    // is gone and there is nothing left to name.
    _onBeforeInput(e) {
      const type = e.inputType || '';
      if (type.indexOf('delete') !== 0) return;
      const el = targetOf(e);
      if (!isTextField(el)) return;
      if (type === 'deleteContentBackward' || type === 'deleteContentForward') {
        const gone = aboutToDelete(el, type);
        if (!gone) return;
        if (isSecret(el)) { this._say('star deleted'); return; }
        if (gone.length === 1) this._say(charName(gone) + ' deleted');
        else if (gone.length <= 40) this._say(gone + ', deleted');
        else this._say('Selection deleted');
        return;
      }
      if (type.indexOf('deleteWord') === 0) this._say('Word deleted');
      else if (type.indexOf('deleteSoftLine') === 0 || type.indexOf('deleteHardLine') === 0) this._say('Line deleted');
      else if (type === 'deleteByCut') this._say('Cut');
    }

    _onInput(e) {
      if (this._composing || e.isComposing) return;   // said once, when it is done
      const el = targetOf(e);
      if (!isTextField(el)) return;
      const type = e.inputType || '';
      const secret = isSecret(el);

      if (type === 'insertLineBreak' || type === 'insertParagraph') {
        const word = this._words && !secret ? this._lastWord(el, true) : '';
        this._say(word ? word + ', new line' : 'new line');
        return;
      }
      if (type === 'insertFromPaste') { this._say('Pasted'); return; }
      if (type === 'historyUndo') { this._say('Undo'); return; }
      if (type === 'historyRedo') { this._say('Redo'); return; }
      if (type !== 'insertText' && type !== 'insertReplacementText') return;

      const data = e.data || '';
      if (!data) return;
      if (secret) {
        if (this._letters) this._say('star');
        return;
      }

      // Several characters at once: autocorrect, or an input method that
      // skipped composition events. Say what arrived.
      if (data.length > 1) {
        this._say(data);
        return;
      }

      const ends = WORD_END.test(data);
      if (ends && this._words) {
        const word = this._lastWord(el, false);
        if (word) {
          // A space after a word says the word; other punctuation is named too.
          const tail = /\s/.test(data) ? '' : ' ' + charName(data);
          this._say(word + tail);
          return;
        }
      }
      if (this._letters) this._say(charName(data));
    }

    _onCompositionEnd(e) {
      this._composing = false;
      const el = targetOf(e);
      if (!isTextField(el) || isSecret(el)) return;
      const data = e.data || '';
      if (!data) return;
      // A composed syllable is closer to a letter than a word: say it in
      // letters mode; in words mode it is picked up when the word ends.
      if (this._letters) this._say(data);
    }

    /**
     * The word just before the caret. After an `input` event the ending
     * character is already in the box, so it is stripped first.
     */
    _lastWord(el, afterBreak) {
      let text = textBeforeCaret(el);
      if (!afterBreak) text = text.slice(0, -1);
      else text = text.replace(/[\r\n]+$/, '');
      const match = LAST_WORD.exec(text);
      return match ? match[0] : '';
    }
  }

  KeyEcho.isTextField = isTextField;
  root.AccessiFlowKeyEcho = KeyEcho;
})(typeof window !== 'undefined' ? window : globalThis);
