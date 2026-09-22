// AccessiFlow voice control, the page's half
//
// The listening happens in the voice panel, an extension page docked beside
// the site: Chrome will not run speech recognition in a hidden document, and
// a listener inside each site would ask for the microphone on every site,
// which someone who cannot use their hands cannot answer. The panel turns
// speech into a command and sends it here; this runs it on the page and says
// what happened, in a sentence the panel shows and can read out.
//
// It sits on page-actions.js, the same finding, clicking and scrolling that
// keyboard-only mode uses.
'use strict';

class VoiceNavModule {
  constructor() {
    this._numbers = null;        // { host, items } while numbers are on screen
    this._mode = false;          // numbers stay on until "no numbers"
    this._assigned = new Map();  // element -> its number, so numbers do not jump
    this._redrawTimer = null;
    this._onScroll = null;
    this._observer = null;
    this._keepTimer = null;
  }

  _A() { return window.AccessiFlowPageActions; }

  /** Runs one command. Resolves to { message, ... } for the panel. */
  async handle(cmd) {
    const A = this._A();
    if (!A) return { ok: false, message: 'Voice control did not load on this page. Say reload.' };

    switch (cmd.type) {
      case 'numbers': return this.numbersOn();
      case 'hideNumbers': return this.numbersOff();
      case 'pick': return this.pick(cmd.n);
      case 'click': return this.clickByName(cmd.name);
      case 'closePopup': {
        const result = await A.closePopup();
        if (this._mode) this._scheduleRedraw(true);
        return result;
      }

      case 'scroll': return this.scroll(cmd);
      case 'stop':
        return { ok: true, message: this.stopScrolling() ? 'Stopped.' : 'Nothing to stop.' };

      case 'heading': return { ok: true, message: A.heading(cmd.dir) };
      case 'textbox': {
        const r = A.firstTextBox();
        return { ok: r.found, message: r.found ? r.message + ' Say type, then your words.' : r.message };
      }
      case 'nextField': return this.nextField();
      case 'type': return this.type(cmd.text);
      case 'undoTyping': return this.undoTyping();
      case 'submit': return this.submit(cmd.confirmed);

      default:
        return { ok: false, message: 'That command does not work on a page.' };
    }
  }

  // ── Numbers ────────────────────────────────────────────────────────────
  //
  // A mode, not a one-off. Once on, numbers stay through clicks, scrolling,
  // new pages and other tabs, until the user says "no numbers": saying
  // "show numbers" before every single click is exactly the repetition voice
  // control is meant to save.
  //
  // A control keeps its number while it stays on screen, so a number read a
  // moment ago still means the same thing when it is said. After a scroll the
  // screen is a different set of things, and they are numbered afresh from 1.

  numbersOn() {
    this._mode = true;
    const count = this._draw(false);
    this._watch();
    if (!count) return { ok: true, message: 'Numbers on, but nothing on screen can be clicked. Say scroll down, or close pop up.' };
    return { ok: true, message: count + ' numbered. Say a number. The numbers stay until you say no numbers.', count: count };
  }

  numbersOff() {
    const was = this._mode || !!this._numbers;
    this._mode = false;
    this._unwatch();
    this._erase();
    this._assigned.clear();
    return { ok: true, message: was ? 'Numbers off.' : 'The numbers were already off.' };
  }

  /** Numbers the given targets, or everything clickable. Returns how many. */
  _draw(stable, targets) {
    const A = this._A();
    const list = targets || A.clickables();
    const numbers = new Map();

    if (stable && !targets) {
      // Keep the numbers of what is still here; give newcomers the lowest
      // numbers nobody is using.
      const used = new Set();
      list.forEach(t => {
        const n = this._assigned.get(t.el);
        if (n && !used.has(n)) { numbers.set(t.el, n); used.add(n); }
      });
      let next = 1;
      list.forEach(t => {
        if (numbers.has(t.el)) return;
        while (used.has(next)) next++;
        numbers.set(t.el, next);
        used.add(next);
      });
    } else {
      list.forEach((t, i) => numbers.set(t.el, i + 1));
    }

    this._erase();
    if (!targets) this._assigned = numbers;
    if (!list.length) return 0;

    const labels = list.map(t => String(numbers.get(t.el)));
    this._numbers = A.drawLabels('accessiflow-voice-numbers', list, labels,
      { bg: '#0b57d0', fg: '#ffffff', dim: '#c2d7ff' });
    return list.length;
  }

  _erase() {
    if (this._numbers) { this._numbers.host.remove(); this._numbers = null; }
  }

  /** Redraws after the page moves or changes, while numbers are on. */
  _watch() {
    if (this._onScroll) return;
    this._onScroll = () => this._scheduleRedraw(false);
    window.addEventListener('scroll', this._onScroll, { capture: true, passive: true });
    window.addEventListener('resize', this._onScroll, { passive: true });

    // A menu opening, a pop-up appearing, a page drawing itself in: new
    // things to number. Our own labels are ignored, or every redraw would
    // trigger the next.
    if (typeof MutationObserver === 'function') {
      this._observer = new MutationObserver(records => {
        const theirs = records.some(r => {
          const nodes = Array.from(r.addedNodes).concat(Array.from(r.removedNodes));
          if (!nodes.length) return !(r.target.id && r.target.id.indexOf('accessiflow-') === 0);
          return nodes.some(n => !(n.id && n.id.indexOf('accessiflow-') === 0));
        });
        if (theirs) this._scheduleRedraw(true);
      });
      this._observer.observe(document.documentElement, {
        // Not `style`: animations rewrite it every frame.
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'hidden', 'open', 'aria-hidden', 'aria-expanded']
      });
    }
  }

  _unwatch() {
    if (this._onScroll) {
      window.removeEventListener('scroll', this._onScroll, { capture: true });
      window.removeEventListener('resize', this._onScroll);
      this._onScroll = null;
    }
    if (this._observer) { this._observer.disconnect(); this._observer = null; }
    if (this._redrawTimer) { clearTimeout(this._redrawTimer); this._redrawTimer = null; }
  }

  _scheduleRedraw(stable) {
    if (!this._mode) return;
    // A scroll wins over a change: after scrolling, everything is renumbered.
    this._pendingStable = this._redrawTimer ? (this._pendingStable && stable) : stable;
    // A change does not push the redraw back, or a page that animates all
    // the time would never be renumbered. A scroll does: it waits to settle.
    if (this._redrawTimer && stable) return;
    if (this._redrawTimer) clearTimeout(this._redrawTimer);
    this._redrawTimer = setTimeout(() => {
      this._redrawTimer = null;
      if (this._mode) this._draw(this._pendingStable);
    }, stable ? 500 : 350);
  }

  /** The label showing a number, or null. */
  _labelFor(n) {
    if (!this._numbers) return null;
    return this._numbers.items.find(item => item.label === String(n)) || null;
  }

  pick(n) {
    if (!this._numbers) {
      return { ok: false, message: this._mode
        ? 'Nothing is numbered on screen right now. Say scroll down.'
        : 'Say show numbers first, then the number.' };
    }
    const item = this._labelFor(n);
    if (!item) {
      const shown = this._numbers.items.map(i => +i.label);
      return { ok: false, message: 'There is no number ' + n + ' on screen. The numbers go up to ' + Math.max.apply(null, shown) + '.' };
    }
    const result = this._A().activate(item.el);
    // Numbers for a single choice go once it is made; the mode stays.
    if (this._mode) this._scheduleRedraw(true);
    else this._erase();
    return Object.assign({ ok: true }, result);
  }

  // ── Clicking by name ───────────────────────────────────────────────────

  /**
   * How well a control's name fits what was said, 0 to 100. Speech gets
   * words slightly wrong ("contract" for "contact"), so near spellings count,
   * but for less than the real thing.
   */
  static score(name, wanted) {
    const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
    const n = norm(name);
    const w = norm(wanted);
    if (!n || !w) return 0;
    if (n === w) return 100;
    if (n.startsWith(w + ' ') || (w.length >= 4 && n.startsWith(w))) return 85;

    const nameWords = n.split(' ');
    const wantWords = w.split(' ');
    const has = word => nameWords.some(x => x === word || (word.length >= 3 && x.startsWith(word)));
    if (wantWords.every(has)) return 70 - Math.min(20, nameWords.length - wantWords.length);

    // Near spellings, word by word.
    let total = 0;
    for (const word of wantWords) {
      let best = 0;
      for (const x of nameWords) best = Math.max(best, VoiceNavModule.similarity(word, x));
      if (best < 0.7) return 0;
      total += best;
    }
    return Math.round(45 * total / wantWords.length);
  }

  /** 1 for the same word, 0 for nothing alike (Levenshtein, as a share). */
  static similarity(a, b) {
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;
    const row = [];
    for (let j = 0; j <= b.length; j++) row[j] = j;
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const temp = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = temp;
      }
    }
    return 1 - row[b.length] / Math.max(a.length, b.length);
  }

  clickByName(wanted) {
    const A = this._A();
    const scored = A.clickables()
      .map(t => Object.assign(t, { score: VoiceNavModule.score(A.nameOf(t.el), wanted) }))
      .filter(t => t.score > 0)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      return { ok: false, message: 'Nothing called ' + wanted + ' on screen. Say show numbers, or scroll down.' };
    }

    const best = scored[0].score;
    const tied = scored.filter(t => t.score === best);
    if (tied.length === 1) {
      const result = A.activate(tied[0].el);
      if (this._mode) this._scheduleRedraw(true);
      return Object.assign({ ok: true }, result);
    }

    // Several fit equally well. With numbers on, they already have numbers:
    // say which. Otherwise number just those, for this one choice.
    if (this._mode) {
      const theirs = tied.map(t => this._assigned.get(t.el)).filter(Boolean).sort((a, b) => a - b);
      return { ok: true, choose: true,
        message: tied.length + ' things match ' + wanted + ': numbers ' + theirs.slice(0, 8).join(', ') + '. Say the number.' };
    }
    this._draw(false, tied.slice(0, 30));
    return { ok: true, message: tied.length + ' things match ' + wanted + '. Say the number of the one you want.', choose: true };
  }

  // ── Scrolling ──────────────────────────────────────────────────────────

  scroll(cmd) {
    const A = this._A();
    this.stopScrolling();
    if (!cmd.keep) return { ok: true, message: A.scroll(cmd.dir, { amount: cmd.amount }) };

    // Slow and steady, so the reader can follow, until they say stop.
    const target = A.scroller();
    const isWindow = target === document.scrollingElement || target === document.documentElement;
    let last = -1;
    this._keepTimer = setInterval(() => {
      const before = isWindow ? window.scrollY : target.scrollTop;
      if (isWindow) window.scrollBy(0, 3 * cmd.dir);
      else target.scrollTop += 3 * cmd.dir;
      const after = isWindow ? window.scrollY : target.scrollTop;
      if (after === before && after === last) this.stopScrolling();   // reached the end
      last = after;
    }, 30);
    return { ok: true, message: 'Scrolling. Say stop.' };
  }

  stopScrolling() {
    if (!this._keepTimer) return false;
    clearInterval(this._keepTimer);
    this._keepTimer = null;
    return true;
  }

  // ── Forms ──────────────────────────────────────────────────────────────

  _fields() {
    const A = this._A();
    return Array.from(document.querySelectorAll(
      'input:not([type="hidden"]), select, textarea, [contenteditable=""], [contenteditable="true"]'))
      .filter(el => !el.disabled && !el.closest('[id^="accessiflow-"]') && el.getClientRects().length > 0 &&
        ['submit', 'button', 'reset', 'image'].indexOf((el.getAttribute('type') || '').toLowerCase()) === -1 &&
        (A.isEditable(el) || el.type === 'checkbox' || el.type === 'radio'));
  }

  nextField() {
    const A = this._A();
    const fields = this._fields();
    if (!fields.length) return { ok: false, message: 'There are no boxes to fill in on this page.' };
    const at = fields.indexOf(document.activeElement);
    const next = fields[at + 1];
    if (!next) return { ok: false, message: 'That was the last box. Say submit when you are ready.' };
    try { next.scrollIntoView({ block: 'center' }); } catch (e) { /* ok */ }
    next.focus();
    const name = A.nameOf(next);
    return { ok: true, message: (name || 'The next box') + '.' };
  }

  type(text) {
    const A = this._A();
    let field = document.activeElement;
    if (!A.isTextBox(field)) {
      const found = A.firstTextBox();
      if (!found.found) return { ok: false, message: found.message };
      field = found.el;
    }
    field.focus();

    // A space between this and what is already there, as a typist would.
    const before = field.isContentEditable ? (field.textContent || '')
      : String(field.value || '').slice(0, field.selectionStart == null ? undefined : field.selectionStart);
    const insert = (before && !/\s$/.test(before) ? ' ' : '') + text;

    // execCommand goes through the browser's own editing, so the site's
    // framework sees ordinary typing and the browser can undo it.
    let done = false;
    try { done = document.execCommand && document.execCommand('insertText', false, insert); } catch (e) { done = false; }
    if (!done) {
      if (field.isContentEditable) field.textContent += insert;
      else field.value = String(field.value || '') + insert;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return { ok: true, message: 'Typed.' };
  }

  undoTyping() {
    let done = false;
    try { done = document.execCommand && document.execCommand('undo'); } catch (e) { done = false; }
    return done ? { ok: true, message: 'Undone.' } : { ok: false, message: 'Nothing to undo here.' };
  }

  _currentForm() {
    const active = document.activeElement;
    if (active && active.form) return active.form;
    if (active && active.closest) {
      const f = active.closest('form');
      if (f) return f;
    }
    const forms = Array.from(document.forms).filter(f => f.getClientRects().length > 0);
    return forms.length === 1 ? forms[0] : null;
  }

  submit(confirmed) {
    const form = this._currentForm();
    if (!form) return { ok: false, message: 'Say text box or next field to get into the form first.' };
    // A box the form insists on is still empty: say which, and go there,
    // rather than send nothing and report success.
    if (typeof form.checkValidity === 'function' && !form.checkValidity()) {
      const bad = form.querySelector(':invalid:not(fieldset):not(form)');
      if (bad) {
        try { bad.scrollIntoView({ block: 'center' }); } catch (e) { /* ok */ }
        bad.focus();
        const label = this._A().nameOf(bad);
        return { ok: false, message: 'The ' + (label ? label + ' ' : '') + 'box needs filling in first.' };
      }
    }
    if (!confirmed) {
      const name = form.getAttribute('aria-label') || (form.querySelector('h1, h2, h3, legend') || {}).textContent || '';
      return { ok: true, confirm: true, message: 'Send ' + (name.trim() ? 'the ' + name.trim() + ' form' : 'this form') + '? Say yes or no.' };
    }
    try {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.submit();
    } catch (e) {
      return { ok: false, message: 'The form could not be sent: ' + e.message };
    }
    return { ok: true, message: 'Sent.' };
  }

  destroy() {
    this.numbersOff();
    this.stopScrolling();
  }
}

if (typeof window !== 'undefined') window.VoiceNavModule = VoiceNavModule;
