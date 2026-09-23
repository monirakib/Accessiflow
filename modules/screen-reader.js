// AccessiFlow screen reader
//
// For blind people with no screen reader of their own: a shared or locked-down
// computer, a Chromebook nobody set up, or a Bangla page that NVDA reads in an
// English voice. It is built the way NVDA is, because that is what blind
// users already know:
//
//   Browse mode   the page is a document with a cursor of the reader's own.
//                 The arrow keys read it line by line, word by word, letter
//                 by letter, and single letters jump: H to the next heading,
//                 K link, B button, F form field, D landmark, and Shift goes
//                 back. Enter or Space presses what the cursor is on.
//   Focus mode    keys go to the page, so text boxes, menus and sliders work.
//                 Entered by itself when Tab or Enter lands in one, with a
//                 high beep; Escape goes back, with a low one.
//
//   Insert (or Caps Lock) is the reader's own key:
//     Insert+Down  read everything from here       Control  stop talking
//     Insert+Up    say this line again             Insert+Space  switch mode
//     Insert+Tab   say what has focus               Insert+T  page title
//     Insert+F2    let the next key through to the page
//     Insert+S     speech on or off                Insert+H  list the keys
//     Insert+F7    the Elements List: headings, links, landmarks, fields
//     Insert+Control+F  find text; Insert+F3 finds the next, with Shift the previous
//     Insert+1     key help: every key says what it does instead of doing it
//     Insert+D     describe the picture the cursor is on, with AI if the page gave it no description
//   Control+Alt+arrows move cell by cell in a table, saying the headers.
//   Shift on its own pauses speech, and again carries on from the same word
//   (handled in content.js, which owns the voice).
//
// It also reads what the page announces by itself (live regions, alerts),
// says the new page when a single-page app changes route, and follows
// in-page links such as "Skip to main content" with its cursor.
//
// Off unless the user turns it on (Alt+Shift+Z, or the popup), because two
// screen readers talking at once is worse than either. Someone already
// running NVDA never hears this one in browse mode anyway: NVDA takes the
// keys before Chrome sees them.
'use strict';

(function () {
  const A = () => window.AccessiFlowPageActions;
  const N = () => window.AccessiFlowNaming;
  const Buf = () => window.AccessiFlowSRBuffer;
  const Speech = () => window.AccessiFlowSRSpeech;
  const Live = () => window.AccessiFlowSRLive;
  const Table = () => window.AccessiFlowSRTable;
  const Dialogs = () => window.AccessiFlowSRDialogs;
  const Frames = () => window.AccessiFlowSRFrames;

  const MODIFIERS = { Insert: true, CapsLock: true };
  const HIGHLIGHT = 'accessiflow-sr';
  const CURSOR_CLASS = 'accessiflow-sr-cursor';

  // Letter → what it finds, and what to call it when there is no more.
  const QUICK = {
    H: ['heading', 'heading'], K: ['link', 'link'], B: ['button', 'button'],
    F: ['field', 'form field'], E: ['edit', 'edit field'], X: ['checkbox', 'check box'],
    R: ['radio', 'radio button'], C: ['combo', 'combo box'], G: ['graphic', 'graphic'],
    D: ['landmark', 'landmark'], L: ['list', 'list'], I: ['listitem', 'list item'],
    T: ['table', 'table'], Q: ['blockquote', 'block quote']
  };

  // Widgets that need the arrow keys for themselves.
  const FOCUS_ROLES = {
    menuitem: 1, menuitemcheckbox: 1, menuitemradio: 1, option: 1, treeitem: 1,
    gridcell: 1, spinbutton: 1, listbox: 1, tree: 1, grid: 1, treegrid: 1, menu: 1, menubar: 1
  };

  const ROLE_WORDS = {
    edit: 'edit', button: 'button', checkbox: 'check box', radio: 'radio button', combo: 'combo box',
    slider: 'slider', graphic: 'graphic', link: 'link', frame: 'frame', separator: 'separator',
    tab: 'tab', menuitem: 'menu item', option: 'option', treeitem: 'tree item', progress: 'progress bar',
    media: 'media'
  };

  const ARROWS = { ArrowDown: 1, ArrowUp: 1, ArrowLeft: 1, ArrowRight: 1 };

  const HELP = 'Screen reader keys. Down and up arrows read line by line. ' +
    'Left and right read letter by letter, and with Control, word by word. ' +
    'H jumps to the next heading, 1 to 6 to a heading level, K link, B button, F form field, ' +
    'E edit field, X check box, D landmark, L list, T table, G graphic. Shift with any of them goes back. ' +
    'Enter or Space presses what you are on. Tab moves between controls. ' +
    'Insert and down arrow reads everything. Control stops. Shift pauses, and Shift again carries on. ' +
    'Insert and Space switches between browse and focus mode; Escape leaves a text box. ' +
    'Insert and F7 lists the headings, links, landmarks and fields. Insert, Control and F finds text. ' +
    'In a table, Control, Alt and the arrows move cell by cell. ' +
    'Insert and 1 turns on key help, to hear what any key does. ' +
    'Insert and D describes the picture you are on. ' +
    'Alt Shift Z turns the screen reader off.';

  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

  // How much punctuation is read out. "some" leaves it to the voice, which
  // pauses at commas and full stops; "all" names every symbol, which is what
  // someone checking an email address or a price needs; "none" drops the
  // symbols a voice would otherwise read aloud as words.
  function punctuate(text, level) {
    if (level === 'all') {
      return clean(String(text).replace(/[^\p{L}\p{N}\p{M}\s]/gu, ch => {
        const name = Speech().characterName(ch);
        return name === ch ? ch : ' ' + name + ' ';
      }));
    }
    if (level === 'none') return clean(String(text).replace(/[^\p{L}\p{N}\p{M}\s.,;:?!'\u0964-]/gu, ' '));
    return text;
  }

  function keyName(e) {
    const names = { ' ': 'Space', ArrowDown: 'Down arrow', ArrowUp: 'Up arrow', ArrowLeft: 'Left arrow',
      ArrowRight: 'Right arrow', Escape: 'Escape', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
      Delete: 'Delete', PageUp: 'Page up', PageDown: 'Page down', Home: 'Home', End: 'End' };
    const base = names[e.key] || (e.key && e.key.length === 1 ? e.key.toUpperCase() : e.key);
    return (e.ctrlKey ? 'Control ' : '') + (e.altKey ? 'Alt ' : '') + (e.shiftKey ? 'Shift ' : '') + base;
  }

  const log = msg => console.log('[AccessiFlow][Reader] ' + msg);

  function deepTarget(e) {
    const path = e.composedPath ? e.composedPath() : null;
    return (path && path[0]) || e.target;
  }

  /** What has focus, looking inside shadow roots and frames from the same site. */
  function deepActive() {
    let el = document.activeElement;
    for (let i = 0; el && i < 20; i++) {
      if (el.shadowRoot && el.shadowRoot.activeElement) { el = el.shadowRoot.activeElement; continue; }
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
        let inner = null;
        try { inner = el.contentDocument; } catch (e) { inner = null; }
        if (inner && inner.activeElement && inner.activeElement !== inner.body) { el = inner.activeElement; continue; }
      }
      break;
    }
    return el;
  }

  function bodyOf(el) {
    return el && el.ownerDocument ? el.ownerDocument.body : document.body;
  }

  function isOurs(el) {
    for (let n = el; n; n = n.parentNode || n.host) {
      if (n.id && /^accessiflow-(sr-|kbnav-)/.test(n.id)) return true;
    }
    return false;
  }

  /** Whether the page needs the keys while focus is here. */
  function needsFocusMode(el) {
    if (!el || el.nodeType !== 1 || el === bodyOf(el) || el === document.documentElement) return false;
    if (A().isEditable(el)) return true;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (FOCUS_ROLES[role]) return true;
    if (el.hasAttribute('aria-activedescendant')) return true;
    return !!(el.closest && el.closest('[role="application"]'));
  }

  function focusable(el) {
    if (!el || el.nodeType !== 1 || el.disabled) return false;
    return el.tabIndex >= 0 || el.hasAttribute('tabindex');
  }

  const CLICKABLE = 'a[href], button, summary, label, input, select, textarea, [role="button"], [role="link"], ' +
    '[role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="option"], [onclick], [tabindex]';

  class ScreenReader {
    constructor() {
      this.active = false;
      this.mode = 'browse';
      this._speech = null;
      this._buf = null;
      this._dirty = true;
      this._builtAt = 0;
      this._cursor = { index: 0, offset: 0, node: null };
      this._moved = false;          // the cursor has left the focused element
      this._mod = false;
      this._modUsed = false;
      this._passNext = false;
      this._sayAllTurn = 0;
      this._quiet = null;           // an element we are focusing ourselves
      this._startPoint = null;      // text we made focusable so Tab can start from it
      this._marked = null;
      this._lastDialog = null;
      this._observer = null;
      this._rebuildTimer = null;
      this._viewer = null;
      this._options = {};
      this._h = {};
      this._touched = new WeakSet();   // elements whose class we change for the highlight
      this._live = null;
      this._panel = null;              // the Elements List or Find, while open
      this._panelReturn = null;        // where focus was before it opened
      this._elementsKind = 'heading';
      this._lastFind = '';
      this._tableCell = null;          // { el, index }: an empty cell the cursor is standing in
      this._helpMode = false;
      this._lastPath = '';
      this._navTimer = null;
      this._lastFocusAt = 0;
      this._frames = null;             // frames from other sites, and their lines
      this._frameWins = new WeakSet(); // same-site frame windows we listen to
      this._frameWinList = [];
      this._styledDocs = [];           // documents we put our highlight style in
      this._remoteShown = null;        // the frame currently drawing our cursor
      this._framesAskedAt = 0;
    }

    static ownsKeys() {
      return !!(ScreenReader._current && ScreenReader._current.active);
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    /**
     * @param backend {speak(text) → Promise, stop()}: the voice
     * @param options {intro: bool, viewer: bool}
     */
    enable(backend, options) {
      options = options || {};
      if (this.active) { this.configure(options); return; }
      this.active = true;
      ScreenReader._current = this;
      this._speech = new (Speech())(backend);
      this._speech.onSpeak = text => this._showSpoken(text);

      this._h = {
        down: e => this._onKeyDown(e),
        up: e => this._onKeyUp(e),
        late: e => this._onLateKeyDown(e),
        focus: e => this._onFocusIn(e),
        focusOut: () => this._onFocusOut(),
        blur: () => { this._mod = false; },
        popstate: () => this._checkUrl(),
        hash: () => { this._checkUrl(); this._followHash(); }
      };
      window.addEventListener('keydown', this._h.down, true);
      window.addEventListener('keyup', this._h.up, true);
      window.addEventListener('keydown', this._h.late, false);
      window.addEventListener('focusin', this._h.focus, true);
      window.addEventListener('focusout', this._h.focusOut, true);
      window.addEventListener('blur', this._h.blur);
      window.addEventListener('popstate', this._h.popstate);
      window.addEventListener('hashchange', this._h.hash);
      this._lastPath = location.pathname + location.search;

      this._injectStyle(document);
      this._watch();
      this.configure(options);

      const Watcher = Live();
      if (Watcher) {
        this._live = new Watcher((text, politeness) => this._announceLive(text, politeness));
        this._live.start();
      }

      const F = Frames();
      if (F && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        this._frames = new F.Hub({ onChange: () => this._pageChanged() });
      }

      const buf = this._buffer(true);
      const active = deepActive();
      if (active && active !== document.body && buf.lineOf(active) > -1) {
        this._cursor.index = buf.lineOf(active);
      }
      this._anchor();
      this.mode = needsFocusMode(active) ? 'focus' : 'browse';

      const counts = buf.count('heading') + ' headings, ' + buf.count('link') + ' links.';
      const title = document.title ? document.title + '. ' : '';
      this._speech.say((options.intro ? 'Screen reader on. ' : '') + title + counts +
        (options.intro ? ' Press Insert and H for the list of keys.' : ''));
      log('on, ' + buf.length + ' lines');
    }

    configure(options) {
      this._options = Object.assign({}, this._options, options || {});
      if (this._options.viewer) this._buildViewer();
      else this._removeViewer();
    }

    disable() {
      if (!this.active) return;
      this.active = false;
      if (ScreenReader._current === this) ScreenReader._current = null;
      this._sayAllTurn++;
      window.removeEventListener('keydown', this._h.down, true);
      window.removeEventListener('keyup', this._h.up, true);
      window.removeEventListener('keydown', this._h.late, false);
      window.removeEventListener('focusin', this._h.focus, true);
      window.removeEventListener('focusout', this._h.focusOut, true);
      window.removeEventListener('blur', this._h.blur);
      window.removeEventListener('popstate', this._h.popstate);
      window.removeEventListener('hashchange', this._h.hash);
      if (this._live) { this._live.stop(); this._live = null; }
      if (this._frames) { this._frames.stop(); this._frames = null; }
      this._frameWinList.forEach(win => this._unlistenWindow(win));
      this._frameWinList = [];
      this._frameWins = new WeakSet();
      this._remoteShown = null;
      if (this._panel) { this._panel.close(false); this._panel = null; }
      clearTimeout(this._navTimer);
      this._helpMode = false;
      if (this._observer) { this._observer.disconnect(); this._observer = null; }
      clearTimeout(this._rebuildTimer);
      this._clearHighlight();
      this._clearStartPoint();
      this._removeViewer();
      this._styledDocs.forEach(doc => {
        const style = doc.getElementById && doc.getElementById('accessiflow-sr-style');
        if (style) style.remove();
      });
      this._styledDocs = [];
      if (this._speech) { this._speech.destroy(); this._speech = null; }
      this._buf = null;
      log('off');
    }

    // ── The buffer ─────────────────────────────────────────────────────────

    _watch() {
      if (typeof MutationObserver !== 'function') return;
      this._observer = new MutationObserver(records => this._consume(records));
      this._observer.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true, attributes: true, attributeOldValue: true,
        attributeFilter: ['hidden', 'aria-hidden', 'style', 'class', 'open', 'inert', 'aria-label',
          'aria-expanded', 'aria-checked', 'alt', 'disabled', 'role']
      });
    }

    _pageChanged() {
      this._checkUrl();
      this._dirty = true;
      // Rebuilt shortly after the page settles, so a key press rarely waits.
      clearTimeout(this._rebuildTimer);
      this._rebuildTimer = setTimeout(() => { if (this.active && this._dirty) this._rebuild(); }, 400);
    }

    /** Our own changes to the page (a highlight class, a tabindex) are not the page changing. */
    _isOwnRecord(r) {
      if (isOurs(r.target)) return true;
      if (r.type === 'attributes' && r.attributeName === 'class' && this._touched.has(r.target)) {
        // Ours only if nothing but our cursor class changed: the page may
        // change the classes of the very element the cursor is on.
        const strip = v => String(v || '').split(/\s+/).filter(c => c && c !== CURSOR_CLASS).sort().join(' ');
        return strip(r.oldValue) === strip(r.target.getAttribute('class'));
      }
      if (r.type === 'childList') {
        const nodes = Array.prototype.slice.call(r.addedNodes).concat(Array.prototype.slice.call(r.removedNodes));
        return nodes.length > 0 && nodes.every(n => n.id && /^accessiflow-sr-/.test(n.id));
      }
      return false;
    }

    /**
     * Page changes: ours are dropped, small ones are patched into the buffer
     * where it is exact to do so, and anything else marks it for rebuilding.
     */
    _consume(records) {
      let changed = false;
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (this._isOwnRecord(r)) continue;
        if (!changed && !this._dirty && this._buf && this._buf.patch(r)) continue;
        changed = true;
      }
      if (this._buf && !this._buf.settle()) changed = true;
      if (changed) this._pageChanged();
    }

    /** Drops the records our own change just made, keeping anything the page did meanwhile. */
    _ignoreOwnChanges() {
      if (this._observer) this._consume(this._observer.takeRecords());
    }

    _buffer(force) {
      const stale = this._buf && this._dirty &&
        (Date.now() - this._builtAt > 250 || !this._anchorAlive());
      if (!this._buf || force || stale) this._rebuild();
      return this._buf;
    }

    _anchorAlive() {
      const n = this._cursor.node;
      return !n || n.isConnected !== false;
    }

    _rebuild() {
      const anchor = this._cursor.node;
      const remote = this._cursor.remote;
      this._buf = Buf().build(document, {
        remote: el => (this._frames ? this._frames.linesFor(el) : null),
        onRemoteFrame: () => this._reachFrames()
      });
      this._listenToFrames(this._buf.frames || []);
      this._dirty = false;
      this._builtAt = Date.now();
      let index = remote ? this._buf.lineOfRemote(remote.frameId, remote.index)
        : anchor && anchor.isConnected !== false ? this._buf.lineOf(anchor) : -1;
      if (index < 0) index = Math.min(this._cursor.index, this._buf.length - 1);
      this._cursor.index = Math.max(0, index);
      const item = this._item();
      if (!item || this._cursor.offset >= this._textOf(item).length) this._cursor.offset = 0;
      this._anchor();
    }

    _item() {
      return this._buf && this._buf.items[this._cursor.index] || null;
    }

    _anchor() {
      const item = this._item();
      this._cursor.node = item ? (item.range ? item.range.startNode : item.el) : null;
      this._cursor.remote = item && item.remote ? item.remote : null;
    }

    _setCursor(index, offset) {
      this._cursor.index = index;
      this._cursor.offset = offset || 0;
      this._anchor();
    }

    // ── What to say ────────────────────────────────────────────────────────

    /** The text the cursor moves through letter by letter. */
    _textOf(item) {
      if (!item) return '';
      if (item.kind === 'object') return item.text || this._lineText(item);
      return item.text;
    }

    _lineText(item) {
      let said;
      if (item.kind === 'object') {
        said = (item.remote ? item.said : (N() && N().describeElement(item.el))) ||
          [item.text, ROLE_WORDS[item.role]].filter(Boolean).join(', ');
        if (!said && ROLE_WORDS[item.role]) said = 'unlabelled ' + ROLE_WORDS[item.role];
        // Said once per page: after that the user knows, and hearing it on
        // every picture would be noise.
        if (this._pictureOf(item) && !item.text && !this._describeHinted && this._options.describe) {
          this._describeHinted = true;
          said += '. Insert D describes it';
        }
        // A picture inside a link is pressed like the link.
        if (item.link && item.role !== 'link' && item.link.el !== item.el && !item.remote) said += ', link';
      } else {
        said = punctuate(item.text, this._options.punctuation) + (item.link ? ', link' : '');
      }
      if (item.heading) said = 'heading level ' + item.heading.level + ', ' + said;
      return said;
    }

    /**
     * "navigation landmark", "list, 3 items", "out of table": said on the way
     * in and out. Containers that start on this line are said even when the
     * cursor was already inside them, which is what D or T landing on one
     * needs: the user asked for the landmark, so name it.
     */
    _contextChange(prev, item, exits, landed) {
      const verbosity = this._options.verbosity || 'normal';
      // Low verbosity: only what the user asked for by jumping to it.
      if (verbosity === 'low' && !landed) return [];
      const before = (prev ? prev.containers : [])
        .filter(c => !(landed && c.start === item.index && item.containers.some(o => o.el === c.el)));
      const after = item.containers;
      const has = (list, c) => list.some(o => o.el === c.el);
      const out = [];
      if (exits) {
        before.slice().reverse().forEach(c => {
          if (has(after, c)) return;
          if (c.kind === 'list' || c.kind === 'table' || c.kind === 'blockquote' || c.kind === 'dialog' || c.kind === 'frame') {
            out.push('out of ' + c.role);
          }
        });
      }
      after.forEach(c => {
        if (has(before, c)) return;
        if (c.kind === 'landmark') out.push((c.name ? c.name + ', ' : '') + c.role + ' landmark');
        else if (c.kind === 'list') out.push('list, ' + c.count + (c.count === 1 ? ' item' : ' items'));
        else if (c.kind === 'table') out.push('table with ' + c.rows + ' rows and ' + c.cols + ' columns');
        else if (c.kind === 'blockquote') out.push('block quote');
        else if (c.kind === 'dialog') out.push((c.name ? c.name + ', ' : '') + 'dialogue');
        else if (c.kind === 'frame') out.push('frame' + (c.name ? ', ' + c.name : ''));
        else if (c.kind === 'listitem' && verbosity === 'high' && typeof c.el === 'object') {
          const list = c.el.parentElement;
          const items = list ? Array.prototype.filter.call(list.children, n => n.tagName === 'LI' ||
            (n.getAttribute('role') || '') === 'listitem') : [];
          const at = items.indexOf(c.el);
          if (at > -1) out.push('item ' + (at + 1) + ' of ' + items.length);
        }
      });
      return out;
    }

    _speechFor(item, prev, exits, landed) {
      return this._contextChange(prev, item, exits, landed).concat(this._lineText(item)).join(', ');
    }

    _say(text) {
      if (this._speech) return this._speech.say(text);
      return Promise.resolve(false);
    }

    // ── Keys ───────────────────────────────────────────────────────────────

    _eat(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }

    _onKeyDown(e) {
      if (!this.active) return;
      const key = e.key;

      // The Elements List and Find take the keys for themselves while open.
      if (this._panel && this._panel.isOpen) {
        if (key === 'Control') this.stopTalking();
        return;
      }

      if (MODIFIERS[key]) {
        this._mod = true;
        this._modUsed = false;
        // Caps Lock cannot be stopped from toggling; Insert can.
        if (key === 'Insert') this._eat(e);
        return;
      }
      if (key === 'Control') {
        this.stopTalking();
        if (this._helpMode) this._say('Control, stops speech');
        return;
      }
      if (key === 'Shift' || key === 'Alt' || key === 'Meta' || key === 'AltGraph') return;

      if (this._passNext) { this._passNext = false; return; }

      this._sayAllTurn++;   // any key stops reading everything

      if (this._helpMode) {
        this._eat(e);
        if (this._mod) this._modUsed = true;
        if (this._mod && e.code === 'Digit1') {
          this._helpMode = false;
          this._say('Key help off');
          return;
        }
        this._say(this._describeKey(e, this._mod));
        return;
      }

      if (this._mod) {
        this._modUsed = true;
        if (this._modCommand(e)) this._eat(e);
        return;
      }

      if (this.mode === 'focus') {
        // Typing interrupts speech, as it does in every screen reader.
        if (key !== 'Escape' && this._speech) this._speech.stop();
        return;
      }

      if (this._browseCommand(e)) this._eat(e);
      else if (key !== 'Tab' && this._speech) this._speech.stop();
    }

    _onKeyUp(e) {
      if (!this.active || !MODIFIERS[e.key]) return;
      this._mod = false;
      if (e.key === 'Insert') this._eat(e);
    }

    /**
     * Escape in focus mode goes back to browse mode, but only if the page did
     * not want it: a menu or an autocomplete closing on Escape comes first.
     */
    _onLateKeyDown(e) {
      if (!this.active || this.mode !== 'focus' || e.key !== 'Escape' || e.defaultPrevented) return;
      if (this._mod) return;
      this._setMode('browse', true);
      e.preventDefault();
    }

    _modCommand(e) {
      if (e.key === 'ArrowDown') { this.sayAll(); return true; }
      if (e.key === 'ArrowUp') { this.repeat(); return true; }
      if (e.key === ' ') { this._setMode(this.mode === 'focus' ? 'browse' : 'focus', true, true); return true; }
      if (e.key === 'Tab') { this._sayFocus(); return true; }
      if (e.key === 'F2') {
        this._passNext = true;
        this._say('Pass next key through');
        return true;
      }
      if (e.key === 'F7') { this.openElementsList(); return true; }
      if (e.key === 'F3') {
        if (this._lastFind) this.find(this._lastFind, e.shiftKey ? -1 : 1);
        else this.openFind();
        return true;
      }
      if (e.code === 'KeyF' && e.ctrlKey) { this.openFind(); return true; }
      switch (e.code) {
        case 'Digit1':
          this._helpMode = true;
          this._say('Key help on. Press any key to hear what it does. Insert and 1 again to leave.');
          return true;
        case 'KeyE': this.openElementsList(); return true;
        case 'KeyD': this.describePicture(); return true;
        case 'KeyT': this._say(document.title ? 'Title: ' + document.title : 'This page has no title'); return true;
        case 'KeyH': this._say(HELP); return true;
        case 'KeyS':
          if (!this._speech) return true;
          if (this._speech.muted) { this._speech.muted = false; this._say('Speech on'); }
          else { this._say('Speech off'); this._speech.muted = true; }
          return true;
      }
      return false;
    }

    _browseCommand(e) {
      if (e.ctrlKey && e.altKey && ARROWS[e.key]) {
        const d = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] }[e.key];
        this.tableMove(d[0], d[1]);
        return true;
      }
      if (e.altKey || e.metaKey) return false;
      const ctrl = e.ctrlKey;
      switch (e.key) {
        case 'ArrowDown': ctrl ? this.paragraph(1) : this.line(1); return true;
        case 'ArrowUp': ctrl ? this.paragraph(-1) : this.line(-1); return true;
        case 'ArrowRight': ctrl ? this.word(1) : this.character(1); return true;
        case 'ArrowLeft': ctrl ? this.word(-1) : this.character(-1); return true;
        case 'Home': ctrl ? this.edge(-1) : this.lineEdge(-1); return true;
        case 'End': ctrl ? this.edge(1) : this.lineEdge(1); return true;
        case 'Enter':
        case ' ':
          if (ctrl || e.repeat) return !!e.repeat;
          this.activate();
          return true;
        case 'Tab':
          this._syncStartPoint();
          return false;
        case 'Escape':
          if (this._speech) this._speech.stop();
          return false;
      }
      if (ctrl) return false;                 // copy, paste, find: the browser's

      const letter = /^Key([A-Z])$/.exec(e.code || '');
      const digit = /^Digit([1-6])$/.exec(e.code || '');
      const direction = e.shiftKey ? -1 : 1;
      if (digit) { this.jump('heading' + digit[1], 'heading level ' + digit[1], direction); return true; }
      if (letter && QUICK[letter[1]]) {
        this.jump(QUICK[letter[1]][0], QUICK[letter[1]][1], direction);
        return true;
      }
      // Any other letter is kept from the page, so a site's own single-key
      // shortcuts do not go off while the user is reading. Insert+F2 lets one through.
      return (e.key || '').length === 1;
    }

    // ── Moving ─────────────────────────────────────────────────────────────

    _go(index, offset, speech) {
      this._setCursor(index, offset);
      this._moved = true;
      const item = this._item();
      this._show(item);
      this._say(speech);
    }

    _edgeOf(direction) {
      if (this._speech) this._speech.tone('edge');
      this._say(direction > 0 ? 'Bottom' : 'Top');
    }

    line(direction) {
      const buf = this._buffer();
      if (!buf.length) { this._say('Nothing to read on this page'); return; }
      const prev = this._item();
      const next = this._cursor.index + direction;
      if (next < 0 || next >= buf.length) { this._edgeOf(direction); return; }
      const item = buf.items[next];
      this._go(next, 0, this._speechFor(item, prev, true));
    }

    paragraph(direction) {
      const buf = this._buffer();
      const prev = this._item();
      if (!prev) return;
      let i = this._cursor.index + direction;
      while (i >= 0 && i < buf.length && buf.items[i].el === prev.el) i += direction;
      if (i < 0 || i >= buf.length) { this._edgeOf(direction); return; }
      this._go(i, 0, this._speechFor(buf.items[i], prev, true));
    }

    edge(direction) {
      const buf = this._buffer();
      if (!buf.length) return;
      const prev = this._item();
      const i = direction > 0 ? buf.length - 1 : 0;
      this._go(i, 0, this._speechFor(buf.items[i], prev, false));
    }

    character(direction) {
      const buf = this._buffer();
      const item = this._item();
      if (!item) return;
      let index = this._cursor.index;
      let offset = this._cursor.offset + direction;
      if (offset >= this._textOf(item).length) {
        if (index + 1 >= buf.length) { this._edgeOf(1); return; }
        index++; offset = 0;
      } else if (offset < 0) {
        if (index === 0) { this._edgeOf(-1); return; }
        index--; offset = Math.max(0, this._textOf(buf.items[index]).length - 1);
      }
      const text = this._textOf(buf.items[index]);
      this._go(index, offset, Speech().characterName(text[offset]));
    }

    word(direction) {
      const buf = this._buffer();
      const item = this._item();
      if (!item) return;
      const starts = t => { const out = []; const re = /\S+/g; let m; while ((m = re.exec(t))) out.push(m.index); return out; };
      let index = this._cursor.index;
      let text = this._textOf(item);
      let list = starts(text);
      let offset;
      if (direction > 0) {
        offset = list.find(s => s > this._cursor.offset);
        while (offset === undefined) {
          if (++index >= buf.length) { this._edgeOf(1); return; }
          text = this._textOf(buf.items[index]);
          list = starts(text);
          offset = list[0];
        }
      } else {
        const earlier = list.filter(s => s < this._cursor.offset);
        offset = earlier[earlier.length - 1];
        while (offset === undefined) {
          if (--index < 0) { this._edgeOf(-1); return; }
          text = this._textOf(buf.items[index]);
          list = starts(text);
          offset = list[list.length - 1];
        }
      }
      this._go(index, offset, (/^\S+/.exec(text.slice(offset)) || [''])[0]);
    }

    lineEdge(direction) {
      const item = this._item();
      if (!item) return;
      const text = this._textOf(item);
      const offset = direction > 0 ? Math.max(0, text.length - 1) : 0;
      this._go(this._cursor.index, offset, Speech().characterName(text[offset]));
    }

    /** The next or previous heading, link, landmark… */
    jump(kind, name, direction) {
      const buf = this._buffer();
      const prev = this._item();
      const i = buf.find(kind, this._cursor.index, direction);
      if (i < 0) {
        if (this._speech) this._speech.tone('edge');
        this._say('No ' + (direction > 0 ? 'next ' : 'previous ') + name);
        return;
      }
      const container = /^(landmark|list|listitem|table|blockquote)$/.test(kind);
      this._go(i, 0, this._speechFor(buf.items[i], prev, false, container));
    }

    repeat() {
      const item = this._buffer() && this._item();
      if (!item) { this._say('Nothing to read on this page'); return; }
      this._show(item);
      this._say(this._lineText(item));
    }

    /** Reads on from the cursor to the end of the page, until any key is pressed. */
    async sayAll() {
      const turn = ++this._sayAllTurn;
      let buf = this._buffer();
      if (!buf.length) { this._say('Nothing to read on this page'); return; }
      let prev = null;
      while (this.active && turn === this._sayAllTurn) {
        const item = this._item();
        this._show(item);
        this._moved = true;
        const finished = await this._say(this._speechFor(item, prev, !!prev));
        if (!finished || turn !== this._sayAllTurn || !this.active) return;
        buf = this._buffer();
        const current = this._item();
        if (this._cursor.index + 1 >= buf.length) {
          if (this._speech) this._speech.tone('edge');
          return;
        }
        prev = current;
        this._setCursor(this._cursor.index + 1, 0);
      }
    }

    stopTalking() {
      this._sayAllTurn++;
      if (this._speech) this._speech.stop();
    }

    /**
     * Says this once the current speech is finished, as a polite live
     * region would be: a form's summary after the name of the field focus
     * just landed on, rather than cutting it off.
     */
    sayAfter(text) {
      if (this.active && this._speech && text) this._speech.queue(text);
    }

    // ── Pressing things ────────────────────────────────────────────────────

    _targetOf(item) {
      if (item.kind === 'object') return item.el;
      if (item.link) return item.link.el;
      const start = item.range && item.range.startNode ? item.range.startNode.parentElement : item.el;
      return (start && start.closest && start.closest(CLICKABLE)) || start;
    }

    activate() {
      this._buffer();
      const item = this._item();
      if (!item) return;
      if (item.remote) { this._activateRemote(item); return; }
      if (item.pendingFrame) { this._say('This frame is still loading'); this._reachFrames(true); return; }
      const el = this._targetOf(item);
      if (!el) return;

      // A text box, list or slider wants the keyboard: focus it, and the
      // focus handler switches to focus mode and says where the user is.
      if (needsFocusMode(el)) {
        try { el.focus(); } catch (e) { /* ok */ }
        if (deepActive() !== el) this._setMode('focus', true);
        return;
      }

      this._quiet = el;
      A().activate(el);
      this._quiet = null;          // focus events are synchronous: it has come, or it never will
      this._moved = false;

      // A check box or a menu button changed state; say the new one.
      const stateful = el.hasAttribute('aria-expanded') || el.hasAttribute('aria-pressed') ||
        el.hasAttribute('aria-checked') || (el.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(el.type));
      if (stateful) {
        setTimeout(() => {
          if (!this.active || !el.isConnected) return;
          this._say((N() && N().describeElement(el)) || '');
        }, 60);
      }
    }

    // ── Focus ──────────────────────────────────────────────────────────────

    _setMode(mode, spoken, manual) {
      if (mode === this.mode) {
        if (spoken) this._say(mode === 'focus' ? 'Focus mode' : 'Browse mode');
        return;
      }
      this.mode = mode;
      if (this._speech) this._speech.tone(mode);
      // Switched by hand onto something the page can take keys for: give it focus.
      if (this._frames) this._frames.setMode(mode);
      if (manual && mode === 'focus') {
        const item = this._item();
        const el = item && !item.remote && this._targetOf(item);
        if (el && focusable(el) && deepActive() !== el) {
          this._quiet = el;
          try { el.focus({ preventScroll: true }); } catch (e) { /* ok */ }
          this._quiet = null;
        }
      }
      if (spoken) this._say(mode === 'focus' ? 'Focus mode' : 'Browse mode');
    }

    _onFocusIn(e) {
      if (!this.active) return;
      const el = deepTarget(e);
      if (!el || el.nodeType !== 1 || isOurs(el)) return;

      if (this._quiet === el || el === this._startPoint) {
        this._quiet = null;
        this._moved = false;
        return;
      }
      this._sayAllTurn++;
      this._lastFocusAt = Date.now();

      const wanted = needsFocusMode(el) ? 'focus' : 'browse';
      if (wanted !== this.mode) this._setMode(wanted, false);

      // An app that swaps its content and focuses the new heading does both
      // in one go, before the page-change records have arrived: take them
      // now, or the focus is looked up in the page as it was.
      this._ignoreOwnChanges();
      const buf = this._buffer(this._dirty);
      const index = buf.lineOf(el);
      const prev = this._item();
      if (index > -1) {
        this._setCursor(index, 0);
        this._show(this._item());
      }
      this._moved = false;

      const parts = [];
      const dialog = el.closest ? el.closest('[role="dialog"], [role="alertdialog"], dialog') : null;
      if (dialog && dialog !== this._lastDialog) {
        const name = N() ? N().accessibleName(dialog) : '';
        const labelled = dialog.hasAttribute('aria-label') || dialog.hasAttribute('aria-labelledby');
        parts.push((labelled && name ? name.slice(0, 80) + ', ' : '') + 'dialogue');
      }
      this._lastDialog = dialog;

      const described = N() ? N().describeElement(el) : '';
      const item = this._item();
      if (item && index > -1 && item.heading && item.heading.el === el) {
        parts.push(this._lineText(item));           // a heading focused by the page itself
      } else if (described) {
        if (item && item.heading && index > -1) parts.push('heading level ' + item.heading.level);
        parts.push(described);
      } else if (item && index > -1) {
        parts.push(this._speechFor(item, prev, false));
      }
      if (parts.length) this._say(parts.join(', '));
    }

    /**
     * Focus left a text box for nowhere: the box was removed, or the user
     * clicked blank page. Stuck in focus mode, the arrows would do nothing,
     * so go back to browse mode. Checked a moment later, because focus moving
     * to another element also passes through here first.
     */
    _onFocusOut() {
      if (this.mode !== 'focus') return;
      setTimeout(() => {
        if (!this.active || this.mode !== 'focus') return;
        const el = deepActive();
        if (!el || el === document.body || el === document.documentElement) this._setMode('browse', false);
      }, 0);
    }

    _sayFocus() {
      const el = deepActive();
      if (!el || el === document.body) { this._say('Nothing has focus'); return; }
      this._say((N() && N().describeElement(el)) || 'Focus is on the page');
    }

    /**
     * Tab moves on from where the reader is, not from where focus was left.
     * Give focus to what the cursor is on, silently, just before the browser
     * moves it; plain text is made focusable for that moment so there is
     * somewhere to start from.
     */
    _syncStartPoint() {
      if (!this._moved) return;
      this._moved = false;
      const item = this._item();
      if (!item) return;
      if (item.remote) {
        // Focus can only go to the frame itself in time for this Tab; the
        // browser then moves on into it.
        this._quiet = item.el;
        try { item.el.focus({ preventScroll: true }); } catch (e) { /* ok */ }
        this._quiet = null;
        return;
      }
      const active = deepActive();
      const target = this._targetOf(item);
      if (target && focusable(target)) {
        if (active === target) return;
        this._quiet = target;
        try { target.focus({ preventScroll: true }); } catch (e) { /* ok */ }
        this._quiet = null;
        return;
      }
      const block = item.el;
      if (!block || block.nodeType !== 1 || (active && block.contains(active))) return;
      this._clearStartPoint();
      if (!block.hasAttribute('tabindex')) {
        block.setAttribute('tabindex', '-1');
        this._startPoint = block;
        this._ignoreOwnChanges();
        block.addEventListener('blur', () => this._clearStartPoint(), { once: true });
      }
      this._quiet = block;
      try { block.focus({ preventScroll: true }); } catch (e) { /* ok */ }
      this._quiet = null;
    }

    _clearStartPoint() {
      const el = this._startPoint;
      if (!el) return;
      this._startPoint = null;
      el.removeAttribute('tabindex');
      this._ignoreOwnChanges();
    }

    // ── What the page says by itself ───────────────────────────────────────

    _announceLive(text, politeness) {
      if (!this._speech) return;
      if (politeness === 'assertive') this._say(text);
      else this._speech.queue(text);
    }

    /**
     * A single-page app changed route: the URL and the content changed but
     * no page loaded, so nothing else tells a blind user they have arrived.
     * Waits a moment for the new title and content, then says where they are
     * and puts the cursor at the start of the new content. If the app moved
     * focus itself, as good ones do, that focus is left alone.
     */
    _checkUrl() {
      const path = location.pathname + location.search;
      if (path === this._lastPath) return;
      this._lastPath = path;
      clearTimeout(this._navTimer);
      const changedAt = Date.now();
      this._navTimer = setTimeout(() => this._arrived(changedAt), 600);
    }

    _arrived(changedAt) {
      if (!this.active) return;
      const title = document.title || 'Page changed';
      // The change is only noticed when the page's changes are delivered,
      // which can be just after the app has already focused its new heading;
      // focus within a second either side counts as the app's own doing.
      if (this._lastFocusAt >= changedAt - 1000) {
        if (this._speech) this._speech.queue(title);
        return;
      }
      this._sayAllTurn++;
      const buf = this._buffer(true);
      const main = buf.containers.find(c => c.kind === 'landmark' && c.role === 'main' && c.start > -1);
      let line = main ? main.start : buf.find('heading1', -1, 1);
      if (line < 0) line = buf.find('heading', -1, 1);
      if (line < 0) line = 0;
      this._setCursor(line, 0);
      this._show(this._item());
      this._moved = true;
      const item = this._item();
      this._say(title + '. ' + buf.count('heading') + ' headings, ' + buf.count('link') + ' links.' +
        (item ? ' ' + this._speechFor(item, null, false) : ''));
    }

    /**
     * An in-page link was followed ("Skip to main content", a table of
     * contents): the reading cursor goes where the link pointed, as it does
     * in NVDA. Without this the page scrolls and the cursor stays behind.
     */
    _followHash() {
      if (!this.active) return;
      let id = location.hash.slice(1);
      try { id = decodeURIComponent(id); } catch (e) { /* use it as it is */ }
      if (!id) return;
      const target = document.getElementById(id) || document.getElementsByName(id)[0];
      if (!target) return;
      const buf = this._buffer(true);
      const line = buf.lineOf(target);
      if (line < 0) return;
      this._sayAllTurn++;
      const prev = this._item();
      this._go(line, 0, this._speechFor(buf.items[line], prev, false, true));
    }

    // ── Tables ─────────────────────────────────────────────────────────────

    /** One cell on, saying the header of whichever row or column changed. */
    tableMove(dRow, dCol) {
      const T = Table();
      const buf = this._buffer();
      const item = this._item();
      if (!T || !item) return;
      if (item.remote) { this._say('Moving by table cell does not reach inside frames from other sites yet'); return; }
      const origin = this._tableCell && this._tableCell.index === this._cursor.index && this._tableCell.el.isConnected
        ? this._tableCell.el
        : T.cellOf(item.range ? item.range.startNode : item.el);
      if (!origin) { this._say('Not in a table'); return; }
      const g = T.grid(T.tableOf(origin));
      const from = g.pos.get(origin);
      if (!from) { this._say('Not in a table'); return; }
      const next = T.step(g, from, dRow, dCol);
      if (!next) {
        if (this._speech) this._speech.tone('edge');
        this._say('Edge of table');
        return;
      }

      const parts = [];
      if (dRow) {
        const header = T.isRowHeader(next.cell) ? '' : T.rowHeader(g, next.row, next.col);
        parts.push((header ? header + ', ' : '') + 'row ' + (next.row + 1));
      }
      if (dCol) {
        const header = T.isColumnHeader(next.cell) ? '' : T.columnHeader(g, next.row, next.col);
        parts.push((header ? header + ', ' : '') + 'column ' + (next.col + 1));
      }
      parts.push(punctuate(T.cellText(next.cell), this._options.punctuation) || 'blank');

      // The cursor goes to the cell's first line; an empty cell has none, so
      // the cursor stays put and the cell is remembered as where we are.
      const line = buf.lineOf(next.cell);
      const lineItem = line > -1 ? buf.items[line] : null;
      const node = lineItem && (lineItem.range ? lineItem.range.startNode : lineItem.el);
      if (node && next.cell.contains(node)) {
        this._setCursor(line, 0);
        this._show(lineItem);
      } else {
        this._clearHighlight();
        this._touched.add(next.cell);
        next.cell.classList.add(CURSOR_CLASS);
        this._marked = next.cell;
        this._ignoreOwnChanges();
      }
      this._tableCell = { el: next.cell, index: this._cursor.index };
      this._moved = true;
      this._say(parts.join(', '));
    }

    // ── The Elements List and Find ─────────────────────────────────────────

    /** Everything of one kind on the page, for the Elements List. */
    _elements(kind) {
      const buf = this._buffer();
      const Nm = N();
      const name = el => (Nm ? clean(Nm.accessibleName(el)) : '');
      if (kind === 'heading') {
        return buf.indexOf('heading').map(i => {
          const it = buf.items[i];
          const label = (it.remote ? '' : name(it.heading.el)) || it.text;
          return { label: label, level: it.heading.level, spoken: label + ', heading level ' + it.heading.level, line: i };
        });
      }
      if (kind === 'link') {
        return buf.indexOf('link').map(i => {
          const it = buf.items[i];
          const label = (it.remote ? '' : name(it.link.el)) || it.text || 'unlabelled link';
          return { label: label, spoken: label + ', link', line: i };
        });
      }
      if (kind === 'landmark') {
        return buf.containers.filter(c => c.kind === 'landmark' && c.start > -1)
          .sort((a, b) => a.start - b.start)
          .map(c => {
            const label = (c.name ? c.name + ' ' : '') + c.role;
            return { label: label, spoken: label + ' landmark', line: c.start };
          });
      }
      const wanted = kind === 'button' ? buf.indexOf('button') :
        buf.indexOf('field').filter(i => buf.items[i].role !== 'button');
      return wanted.map(i => {
        const it = buf.items[i];
        const said = (it.remote ? it.said : (Nm && Nm.describeElement(it.el))) || it.text || 'unlabelled';
        return { label: said, spoken: said, line: i };
      });
    }

    _openPanel(panel) {
      this.stopTalking();
      this._panelReturn = deepActive();
      this._panel = panel;
      panel.open();
    }

    /** Focus back where it was, quietly: the user is about to hear where they are. */
    _closedPanel() {
      this._panel = null;
      const back = this._panelReturn;
      this._panelReturn = null;
      if (back && back !== document.body && back.isConnected && typeof back.focus === 'function') {
        this._quiet = back;
        try { back.focus({ preventScroll: true }); } catch (e) { /* ok */ }
        this._quiet = null;
      }
    }

    openElementsList() {
      const D = Dialogs();
      if (!D) return;
      this._buffer();
      this._openPanel(new D.ElementsList({
        kind: this._elementsKind,
        items: kind => { this._elementsKind = kind; return this._elements(kind); },
        say: text => this._say(text),
        choose: (entry, activate) => {
          this._closedPanel();
          const buf = this._buffer();
          const line = Math.min(entry.line, buf.length - 1);
          const prev = this._item();
          this._go(line, 0, this._speechFor(buf.items[line], prev, false, true));
          if (activate) this.activate();
        },
        close: () => { this._closedPanel(); this.repeat(); }
      }));
    }

    openFind() {
      const D = Dialogs();
      if (!D) return;
      this._openPanel(new D.FindBox({
        last: this._lastFind,
        say: text => this._say(text),
        find: text => { this._closedPanel(); this.find(text, 1); },
        close: () => { this._closedPanel(); this.repeat(); }
      }));
    }

    /** The next (1) or previous (-1) place the text appears, from the cursor. */
    find(text, direction) {
      this._lastFind = text;
      const buf = this._buffer();
      const q = text.toLowerCase();
      const cur = this._cursor;
      let found = -1;
      let at = -1;
      if (direction > 0) {
        for (let i = cur.index; i < buf.length && found < 0; i++) {
          const t = this._textOf(buf.items[i]).toLowerCase();
          const hit = t.indexOf(q, i === cur.index ? cur.offset + 1 : 0);
          if (hit > -1) { found = i; at = hit; }
        }
      } else {
        for (let i = cur.index; i >= 0 && found < 0; i--) {
          const t = this._textOf(buf.items[i]).toLowerCase();
          if (i === cur.index && cur.offset === 0) continue;
          const hit = i === cur.index ? t.lastIndexOf(q, cur.offset - 1) : t.lastIndexOf(q);
          if (hit > -1) { found = i; at = hit; }
        }
      }
      if (found < 0) {
        if (this._speech) this._speech.tone('edge');
        this._say('Not found: ' + text);
        return;
      }
      const prev = this._item();
      this._go(found, at, this._speechFor(buf.items[found], prev, false));
    }

    // ── Frames ─────────────────────────────────────────────────────────────

    /**
     * A frame from another site is on the page: ask the service worker to put
     * an agent in every frame, so it can be read. At most every few seconds,
     * however many such frames there are.
     */
    _reachFrames(now) {
      if (!this._frames) return;
      const t = Date.now();
      if (!now && t - this._framesAskedAt < 3000) return;
      this._framesAskedAt = t;
      try {
        chrome.runtime.sendMessage({ action: 'srInjectFrames' }, () => { void chrome.runtime.lastError; });
      } catch (e) { /* the worker is restarting; the next build asks again */ }
    }

    /** A same-site frame's keys and focus are the page's: listen there too. */
    _listenToFrames(frames) {
      frames.forEach(frame => {
        let win = null;
        try { win = frame.contentWindow; void win.document; } catch (e) { win = null; }
        if (!win || this._frameWins.has(win)) return;
        this._frameWins.add(win);
        this._frameWinList.push(win);
        win.addEventListener('keydown', this._h.down, true);
        win.addEventListener('keyup', this._h.up, true);
        win.addEventListener('keydown', this._h.late, false);
        win.addEventListener('focusin', this._h.focus, true);
        win.addEventListener('focusout', this._h.focusOut, true);
        if (this._observer && win.document.documentElement) {
          this._observer.observe(win.document.documentElement, {
            childList: true, subtree: true, characterData: true, attributes: true, attributeOldValue: true,
            attributeFilter: ['hidden', 'aria-hidden', 'style', 'class', 'open', 'inert', 'aria-label',
              'aria-expanded', 'aria-checked', 'alt', 'disabled', 'role']
          });
        }
        if (this._live) this._live.addDocument(win.document);
        if (this._frames) this._frames.addWindow(win);
      });
    }

    _unlistenWindow(win) {
      try {
        win.removeEventListener('keydown', this._h.down, true);
        win.removeEventListener('keyup', this._h.up, true);
        win.removeEventListener('keydown', this._h.late, false);
        win.removeEventListener('focusin', this._h.focus, true);
        win.removeEventListener('focusout', this._h.focusOut, true);
      } catch (e) { /* the frame is gone */ }
    }

    _activateRemote(item) {
      this._moved = false;
      Frames().relay(item.remote.frameId, { type: 'activate', index: item.remote.index }).then(reply => {
        if (this.active && reply && reply.said) this._say(reply.said);
      });
    }

    /**
     * From an agent in a frame from another site, through the service worker.
     * Lines that changed, a key pressed while focus was inside it, focus moving
     * inside it, or something it announced by itself.
     */
    onFrameMessage(from, msg) {
      if (!this.active || !msg) return null;
      switch (msg.type) {
        case 'update':
          return { ok: !!(this._frames && this._frames.update(from, msg.lines)) };
        case 'live':
          this._announceLive(String(msg.text || ''), msg.politeness === 'assertive' ? 'assertive' : 'polite');
          return { ok: true };
        case 'key': {
          const e = {
            key: msg.key, code: msg.code, repeat: !!msg.repeat, ctrlKey: !!msg.ctrlKey, altKey: !!msg.altKey,
            shiftKey: !!msg.shiftKey, metaKey: !!msg.metaKey, defaultPrevented: false, target: document.body,
            preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, composedPath() { return []; }
          };
          if (msg.phase === 'shortcut') {
            // Handed to AccessiFlow's own shortcut handler, in this page.
            document.dispatchEvent(new KeyboardEvent('keydown', {
              key: msg.key, code: msg.code, altKey: true, shiftKey: true, bubbles: true, cancelable: true
            }));
            return { ok: true };
          }
          if (msg.phase === 'up') this._onKeyUp(e);
          else if (msg.phase === 'late') this._onLateKeyDown(e);
          else this._onKeyDown(e);
          return { ok: true };
        }
        case 'focus': {
          this._sayAllTurn++;
          this._lastFocusAt = Date.now();
          this._setMode(msg.focusMode ? 'focus' : 'browse', false);
          const buf = this._buffer();
          const line = buf.lineOfRemote(msg.frameId, msg.index);
          if (line > -1) {
            this._setCursor(line, 0);
            this._remoteShown = msg.frameId;   // it highlights its own focus
          }
          this._moved = false;
          if (msg.said) this._say(String(msg.said));
          return { ok: true };
        }
      }
      return null;
    }

    // ── Pictures ───────────────────────────────────────────────────────────

    /** The picture a line is about: the image itself, or the one inside a link or button. */
    _pictureOf(item) {
      if (!item || item.remote) return null;
      if (item.el && item.el.tagName === 'IMG') return item.el;
      if (item.role === 'graphic') return null;          // an SVG: nothing to send
      const holder = item.link ? item.link.el : (item.kind === 'object' ? item.el : null);
      const img = holder && holder.querySelector ? holder.querySelector('img') : null;
      return img && !(N() && N().accessibleName(holder)) ? img : null;
    }

    /**
     * Insert+D. The page's own description when it has one; otherwise the AI,
     * through the same route as Alt+Shift+D, which never sends a security
     * check picture and remembers what it has described.
     */
    describePicture() {
      const item = this._buffer() && this._item();
      const img = this._pictureOf(item) || (item && item.el && item.el.querySelector && item.el.querySelector('img'));
      if (!img) { this._say('No picture here'); return; }
      const describe = this._options.describe;
      if (!describe) { this._say('Describing pictures is not available here'); return; }
      Promise.resolve(describe(img, () => this._say('Describing this picture. One moment.')))
        .then(result => {
          if (!this.active) return;
          if (result && result.text) this._say(result.text + ', graphic');
          else this._say((result && result.error) || 'This picture could not be described.');
        }, () => { if (this.active) this._say('This picture could not be described.'); });
    }

    // ── Key help ───────────────────────────────────────────────────────────

    _describeKey(e, mod) {
      const shift = e.shiftKey;
      if (mod) {
        const byKey = {
          ArrowDown: 'Say all: reads from here to the end of the page', ArrowUp: 'Says the current line again',
          ' ': 'Switches between browse mode and focus mode', Tab: 'Says what has keyboard focus',
          F2: 'Lets the next key through to the page', F7: 'Opens the elements list',
          F3: shift ? 'Finds the previous match' : 'Finds the next match'
        };
        if (byKey[e.key]) return 'Insert ' + keyName(e) + ', ' + byKey[e.key];
        const byCode = { KeyT: 'Says the page title', KeyH: 'Says the list of screen reader keys',
          KeyS: 'Turns speech off or on', KeyE: 'Opens the elements list',
          KeyD: 'Describes the picture the cursor is on',
          KeyF: e.ctrlKey ? 'Finds text on the page' : '' };
        if (byCode[e.code]) return 'Insert ' + keyName(e) + ', ' + byCode[e.code];
        return 'Insert ' + keyName(e) + ', no command';
      }
      if (e.ctrlKey && e.altKey && ARROWS[e.key]) {
        return keyName(e) + ', in a table, moves to the ' +
          { ArrowDown: 'next row', ArrowUp: 'previous row', ArrowRight: 'next column', ArrowLeft: 'previous column' }[e.key];
      }
      const ctrl = e.ctrlKey;
      const plain = {
        ArrowDown: ctrl ? 'Next paragraph' : 'Next line', ArrowUp: ctrl ? 'Previous paragraph' : 'Previous line',
        ArrowRight: ctrl ? 'Next word' : 'Next character', ArrowLeft: ctrl ? 'Previous word' : 'Previous character',
        Home: ctrl ? 'Top of the page' : 'Start of the line', End: ctrl ? 'Bottom of the page' : 'End of the line',
        Enter: 'Presses what the cursor is on', ' ': 'Presses what the cursor is on',
        Tab: shift ? 'Previous control' : 'Next control', Escape: 'Stops speech, or leaves focus mode'
      };
      if (plain[e.key]) return keyName(e) + ', ' + plain[e.key];
      const digit = /^Digit([1-6])$/.exec(e.code || '');
      if (digit && !ctrl) return keyName(e) + ', ' + (shift ? 'previous' : 'next') + ' heading at level ' + digit[1];
      const letter = /^Key([A-Z])$/.exec(e.code || '');
      if (letter && QUICK[letter[1]] && !ctrl) {
        return letter[1] + (shift ? ' with Shift' : '') + ', ' + (shift ? 'previous ' : 'next ') + QUICK[letter[1]][1];
      }
      return keyName(e) + ', no command';
    }

    // ── On screen ──────────────────────────────────────────────────────────

    _injectStyle(doc) {
      doc = doc || document;
      if (doc.getElementById('accessiflow-sr-style')) return;
      const style = doc.createElement('style');
      style.id = 'accessiflow-sr-style';
      style.textContent =
        '.' + CURSOR_CLASS + ' { outline: 3px solid #ffd400 !important; outline-offset: 2px !important; }\n' +
        '::highlight(' + HIGHLIGHT + ') { background-color: #ffd400; color: #111; }';
      (doc.head || doc.documentElement).appendChild(style);
      if (this._styledDocs.indexOf(doc) === -1) this._styledDocs.push(doc);
      this._ignoreOwnChanges();
    }

    _clearHighlight() {
      this._styledDocs.forEach(doc => {
        const win = doc.defaultView;
        try { if (win && win.CSS && win.CSS.highlights) win.CSS.highlights.delete(HIGHLIGHT); } catch (e) { /* ok */ }
      });
      if (this._remoteShown !== null && this._frames) {
        Frames().relay(this._remoteShown, { type: 'clear' });
        this._remoteShown = null;
      }
      if (this._marked) {
        this._marked.classList.remove(CURSOR_CLASS);
        this._marked = null;
        this._ignoreOwnChanges();
      }
    }

    /**
     * Where the reader is, drawn on the page, for anyone sighted helping and
     * for low vision; and scrolled to, so the page and the voice agree.
     */
    _show(item) {
      this._clearHighlight();
      if (!item) return;
      let rect = null;
      let scrollEl = item.el;

      if (item.remote) {
        // The frame draws the cursor itself; the page shows the frame.
        this._remoteShown = item.remote.frameId;
        Frames().relay(item.remote.frameId, { type: 'show', index: item.remote.index });
        try {
          const r = item.el.getBoundingClientRect();
          if (r.bottom < 0 || r.top > (window.innerHeight || 0)) item.el.scrollIntoView({ block: 'nearest' });
        } catch (e) { /* ok */ }
        return;
      }

      // A line in a same-site frame lives in that frame's document and window.
      const doc = (item.range ? item.range.startNode : item.el).ownerDocument || document;
      const win = doc.defaultView || window;
      if (doc !== document) this._injectStyle(doc);

      if (item.range && win.CSS && win.CSS.highlights && typeof win.Highlight === 'function') {
        try {
          const r = doc.createRange();
          r.setStart(item.range.startNode, Math.min(item.range.startOffset, item.range.startNode.length));
          r.setEnd(item.range.endNode, Math.min(item.range.endOffset, item.range.endNode.length));
          win.CSS.highlights.set(HIGHLIGHT, new win.Highlight(r));
          rect = r.getBoundingClientRect();
          scrollEl = item.range.startNode.parentElement;
        } catch (e) { rect = null; }
      }
      if (!rect && item.el && item.el.classList) {
        this._touched.add(item.el);
        item.el.classList.add(CURSOR_CLASS);
        this._marked = item.el;
        this._ignoreOwnChanges();
        try { rect = item.el.getBoundingClientRect(); } catch (e) { rect = null; }
      }

      if (!rect || !scrollEl) return;
      const h = window.innerHeight || 0;
      if (rect.height === 0 && rect.width === 0) return;          // nothing to scroll to
      if (rect.top >= 0 && rect.bottom <= h) return;
      try { scrollEl.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) { /* ok */ }
    }

    // What the reader says, on screen, for sighted helpers. Hidden from other
    // screen readers, which would otherwise read everything twice.
    _buildViewer() {
      if (this._viewer) return;
      const host = document.createElement('div');
      host.id = 'accessiflow-sr-viewer';
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'all: initial; position: fixed; left: 16px; bottom: 16px; z-index: 2147483645; pointer-events: none;';
      const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
      const box = document.createElement('div');
      box.style.cssText = 'font: 600 15px/1.4 system-ui, "Segoe UI", sans-serif; color: #f4f5f7; background: #16181d; ' +
        'border: 2px solid #ffd400; border-radius: 10px; padding: 8px 12px; max-width: min(560px, calc(100vw - 32px)); ' +
        'box-shadow: 0 6px 20px rgba(0,0,0,.45);';
      const mode = document.createElement('div');
      mode.style.cssText = 'font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #ffd400;';
      const text = document.createElement('div');
      box.append(mode, text);
      root.appendChild(box);
      document.documentElement.appendChild(host);
      this._viewer = { host: host, mode: mode, text: text };
      this._ignoreOwnChanges();
      this._showSpoken(this._speech ? this._speech.last : '');
    }

    _removeViewer() {
      if (!this._viewer) return;
      this._viewer.host.remove();
      this._viewer = null;
    }

    _showSpoken(text) {
      if (!this._viewer) return;
      this._viewer.mode.textContent = (this.mode === 'focus' ? 'Focus mode' : 'Browse mode');
      this._viewer.text.textContent = text || '';
      this._viewer.host.style.display = text ? '' : 'none';
    }
  }

  ScreenReader.needsFocusMode = needsFocusMode;
  ScreenReader.HELP = HELP;
  ScreenReader._current = null;

  window.AccessiFlowScreenReader = ScreenReader;
})();
