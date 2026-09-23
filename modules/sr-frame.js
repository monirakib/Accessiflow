// AccessiFlow screen reader: frames from other sites
//
// A card payment form, a video player, a map, a comment box: these usually
// come in an iframe from another site. The page cannot see inside them, and
// neither can the reader running in the page, so without this a blind user
// hears "frame" and nothing more, at exactly the moment they are paying.
//
// So a small agent runs inside each frame (injected by the service worker
// only while the reader is on). It builds that frame's lines with the same
// buffer code and sends them up; the reader slots them in where the frame is.
// Everything then works through frames as if they were part of the page:
// arrows, H and K, Find, the Elements List, reading everything.
//
// How the pieces find each other:
//   1. The agent asks the service worker for its frame id, and posts a hello
//      to its parent window with that id and a random nonce.
//   2. The parent matches the message's source window to one of its
//      <iframe> elements; that is how it knows which element the lines
//      belong in.
//   3. Everything after that goes through the service worker by frame id
//      (chrome.tabs.sendMessage), never by postMessage, so the page's own
//      scripts cannot read the lines or forge them. The nonce, sent back
//      with the first request, stops a page from pointing one frame's hello
//      at another frame.
//
// Keys pressed while focus is inside a frame go to that frame's document, not
// the page's, so the agent follows the reader's rules for which keys are its
// own, takes those, and forwards them. The reader's cursor, modes and speech
// all stay in one place: the top of the page.
'use strict';

(function (root) {
  const OBSERVE = { childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['hidden', 'aria-hidden', 'style', 'class', 'open', 'aria-label', 'aria-expanded',
      'aria-checked', 'alt', 'disabled', 'role'] };
  const ARROWS = { ArrowDown: 1, ArrowUp: 1, ArrowLeft: 1, ArrowRight: 1 };
  const MODIFIERS = { Insert: 1, CapsLock: 1 };
  const HIGHLIGHT = 'accessiflow-sr';
  const CURSOR_CLASS = 'accessiflow-sr-cursor';
  const CLICKABLE = 'a[href], button, summary, label, input, select, textarea, [role="button"], [role="link"], ' +
    '[role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="option"], [onclick], [tabindex]';

  /** A message to another frame of this tab, through the service worker. */
  function relay(to, msg) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ action: 'srRelay', to: to, msg: msg }, reply => {
          void chrome.runtime.lastError;
          resolve(reply === undefined ? null : reply);
        });
      } catch (e) { resolve(null); }
    });
  }

  /**
   * Every frame element in a document: inside open shadow roots, and inside
   * frames from the same site, which the reader reads as part of the page.
   */
  function frameElements(doc) {
    const out = [];
    const walk = scope => {
      Array.prototype.forEach.call(scope.querySelectorAll('iframe, frame'), f => {
        out.push(f);
        let inner = null;
        try { inner = f.contentDocument; } catch (e) { inner = null; }
        if (inner && inner.documentElement) walk(inner);
      });
      Array.prototype.forEach.call(scope.querySelectorAll('*'), el => { if (el.shadowRoot) walk(el.shadowRoot); });
    };
    walk(doc);
    return out;
  }

  // ── The hub: frames inside this document ─────────────────────────────────

  class FrameHub {
    /** @param opts.onChange  called when any frame's lines arrive or change */
    constructor(opts) {
      this._opts = opts || {};
      this._frames = new Map();       // frame element → { frameId, nonce, lines }
      this.mode = 'browse';
      this.letters = true;            // single letter navigation, as the reader has it
      this._stopped = false;
      this._windows = [window];
      this._onMessage = e => this._hello(e);
      window.addEventListener('message', this._onMessage);
    }

    /**
     * A same-site frame's window: a frame from another site inside it says
     * hello there, not to the top of the page.
     */
    addWindow(win) {
      if (this._stopped || this._windows.indexOf(win) !== -1) return;
      this._windows.push(win);
      try { win.addEventListener('message', this._onMessage); } catch (e) { /* gone */ }
    }

    stop() {
      this._stopped = true;
      this._windows.forEach(w => { try { w.removeEventListener('message', this._onMessage); } catch (e) { /* gone */ } });
      this._windows = [];
      this.broadcast({ type: 'stop' });
      this._frames.clear();
    }

    linesFor(el) {
      const f = this._frames.get(el);
      return f && f.lines ? f.lines : null;
    }

    frameIdOf(el) {
      const f = this._frames.get(el);
      return f ? f.frameId : null;
    }

    _hello(e) {
      const d = e.data;
      if (this._stopped || !d || typeof d !== 'object' || d.__accessiflowSr !== 'hello') return;
      if (typeof d.frameId !== 'number' || typeof d.nonce !== 'string' || !e.source) return;
      const el = frameElements(document).find(f => {
        try { return f.contentWindow === e.source; } catch (x) { return false; }
      });
      if (!el) return;
      const known = this._frames.get(el);
      if (known && known.frameId === d.frameId && known.nonce === d.nonce) return;
      this._frames.set(el, { frameId: d.frameId, nonce: d.nonce, lines: null });
      this.refresh(el);
    }

    refresh(el) {
      const f = this._frames.get(el);
      if (!f) return;
      relay(f.frameId, { type: 'snapshot', nonce: f.nonce, mode: this.mode, letters: this.letters }).then(reply => {
        if (this._stopped || this._frames.get(el) !== f) return;
        if (reply && Array.isArray(reply.lines)) {
          f.lines = reply.lines;
          if (this._opts.onChange) this._opts.onChange();
        }
      });
    }

    /** New lines pushed up by a frame that changed. Only from frames already known. */
    update(from, lines) {
      if (!Array.isArray(lines)) return false;
      let changed = false;
      this._frames.forEach((f, el) => {
        if (f.frameId !== from) return;
        if (!el.isConnected) { this._frames.delete(el); return; }
        f.lines = lines;
        changed = true;
      });
      if (changed && this._opts.onChange) this._opts.onChange();
      return changed;
    }

    broadcast(msg) {
      this._frames.forEach(f => { relay(f.frameId, msg); });
    }

    setMode(mode) {
      this.mode = mode;
      this.broadcast({ type: 'mode', mode: mode, letters: this.letters });
    }

    /** Single letter navigation off: letters typed in a frame go to that frame's page. */
    setLetters(on) {
      this.letters = on !== false;
      this.broadcast({ type: 'mode', mode: this.mode, letters: this.letters });
    }
  }

  // ── The agent: runs inside a frame from another site ─────────────────────

  function naming() { return root.AccessiFlowNaming; }

  function deepTarget(e) {
    const path = e.composedPath ? e.composedPath() : null;
    return (path && path[0]) || e.target;
  }

  function needsFocusMode(el) {
    if (!el || el.nodeType !== 1 || el === el.ownerDocument.body) return false;
    const A = root.AccessiFlowPageActions;
    if (A && A.isEditable(el)) return true;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (/^(menuitem|menuitemcheckbox|menuitemradio|option|treeitem|gridcell|spinbutton|listbox|tree|grid|treegrid|menu|menubar)$/.test(role)) return true;
    if (el.hasAttribute('aria-activedescendant')) return true;
    return !!el.closest('[role="application"]');
  }

  /** The keys the reader takes for itself in browse mode, by the same rules it uses. */
  function readerKey(e, letters) {
    const k = e.key || '';
    if (e.metaKey) return false;
    if (e.ctrlKey && e.altKey) return !!ARROWS[k];
    if (e.altKey) return false;
    if (ARROWS[k] || k === 'Home' || k === 'End') return true;
    if (e.ctrlKey) return false;
    if (k === 'Enter' || k === ' ' || k === 'PageDown' || k === 'PageUp') return true;
    return letters !== false && k.length === 1;
  }

  class FrameAgent {
    /** @param opts.parent  the window to say hello to; the real parent unless a test says otherwise */
    constructor(opts) {
      this._parentWindow = (opts && opts.parent) || (() => window.parent);
      this.frameId = undefined;
      this.nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
      this.parent = null;
      this.attached = false;
      this.mode = 'browse';
      this.letters = true;
      this.hub = null;
      this._buf = null;
      this._dirty = true;
      this._mod = false;
      this._quiet = null;
      this._marked = null;
      this._pushTimer = null;
      this._h = {};
    }

    start() {
      this._onRuntime = (m, sender, respond) => {
        if (!m || m.action !== 'srFrame') return;
        const reply = this.handle(m.from, m.msg || {});
        if (reply && typeof reply.then === 'function') { reply.then(respond); return true; }
        respond(reply === undefined ? null : reply);
      };
      chrome.runtime.onMessage.addListener(this._onRuntime);
      chrome.runtime.sendMessage({ action: 'srWhoAmI' }, reply => {
        void chrome.runtime.lastError;
        if (!reply || typeof reply.frameId !== 'number') return;
        this.frameId = reply.frameId;
        this.hello();
      });
    }

    /** Tells the parent this frame can be read. Sent again if the reader is switched back on. */
    hello() {
      if (this.frameId === undefined) return;
      if (!this.hub) this.hub = new FrameHub({ onChange: () => this._changed() });
      try {
        this._parentWindow().postMessage({ __accessiflowSr: 'hello', frameId: this.frameId, nonce: this.nonce }, '*');
      } catch (e) { /* no parent to tell */ }
    }

    handle(from, msg) {
      if (msg.type === 'snapshot') {
        if (msg.nonce !== this.nonce) return { error: 'unknown frame' };
        this.parent = from;
        if (msg.mode) this.mode = msg.mode;
        if (typeof msg.letters === 'boolean') this.letters = msg.letters;
        this._attach();
        return { lines: this._lines() };
      }
      if (!this.attached) return null;
      switch (msg.type) {
        case 'mode':
          this.mode = msg.mode === 'focus' ? 'focus' : 'browse';
          if (typeof msg.letters === 'boolean') this.letters = msg.letters;
          if (this.hub) { this.hub.letters = this.letters; this.hub.setMode(this.mode); }
          return { ok: true };
        case 'update':
          return { ok: !!(this.hub && this.hub.update(from, msg.lines)) };
        case 'show': this._show(msg.index); return { ok: true };
        case 'clear': this._clear(); return { ok: true };
        case 'activate': return this._activate(msg.index);
        case 'focusStart': this._focusStart(msg.index); return { ok: true };
        case 'stop':
          this._detach();
          if (this.hub) this.hub.broadcast({ type: 'stop' });
          return { ok: true };
      }
      return null;
    }

    // ── Watching this frame ──

    _attach() {
      if (this.attached) return;
      this.attached = true;
      this._h = {
        down: e => this._onKeyDown(e),
        up: e => this._onKeyUp(e),
        late: e => this._onLate(e),
        focus: e => this._onFocusIn(e),
        blur: () => { this._mod = false; }
      };
      window.addEventListener('keydown', this._h.down, true);
      window.addEventListener('keyup', this._h.up, true);
      window.addEventListener('keydown', this._h.late, false);
      window.addEventListener('focusin', this._h.focus, true);
      window.addEventListener('blur', this._h.blur);
      this._observer = new MutationObserver(records => {
        if (records.every(r => r.target && r.target.id && /^accessiflow-sr/.test(r.target.id))) return;
        this._changed();
      });
      this._observer.observe(document.documentElement, OBSERVE);
      const Live = root.AccessiFlowSRLive;
      if (Live) {
        this._live = new Live((text, politeness) => relay(0, { type: 'live', text: text, politeness: politeness }));
        this._live.start();
      }
    }

    _detach() {
      if (!this.attached) return;
      this.attached = false;
      this.parent = null;
      window.removeEventListener('keydown', this._h.down, true);
      window.removeEventListener('keyup', this._h.up, true);
      window.removeEventListener('keydown', this._h.late, false);
      window.removeEventListener('focusin', this._h.focus, true);
      window.removeEventListener('blur', this._h.blur);
      if (this._observer) { this._observer.disconnect(); this._observer = null; }
      if (this._live) { this._live.stop(); this._live = null; }
      clearTimeout(this._pushTimer);
      this._clear();
    }

    _buffer() {
      if (this._observer && this._observer.takeRecords().length) this._dirty = true;
      if (!this._buf || this._dirty) {
        this._buf = root.AccessiFlowSRBuffer.build(document, {
          remote: el => (this.hub ? this.hub.linesFor(el) : null)
        });
        this._dirty = false;
      }
      return this._buf;
    }

    _lines() {
      return this._buffer().serialize(this.frameId);
    }

    /** This frame, or a frame inside it, changed: send the new lines up once it settles. */
    _changed() {
      this._dirty = true;
      clearTimeout(this._pushTimer);
      this._pushTimer = setTimeout(() => {
        if (!this.attached || this.parent === null) return;
        relay(this.parent, { type: 'update', lines: this._lines() });
      }, 300);
    }

    // ── Keys and focus, handed to the reader at the top ──

    _forward(e, phase) {
      relay(0, {
        type: 'key', phase: phase, key: e.key, code: e.code, repeat: !!e.repeat,
        ctrlKey: !!e.ctrlKey, altKey: !!e.altKey, shiftKey: !!e.shiftKey, metaKey: !!e.metaKey
      });
    }

    _eat(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }

    _onKeyDown(e) {
      const k = e.key;
      // AccessiFlow's own shortcuts (Alt+Shift+Z turns the reader off) live in
      // the page, and a key pressed with focus in here never reaches it. A
      // blind user cannot see where focus is, so they must work from here too.
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && /^(Key[A-Z]|Digit[0-9])$/.test(e.code || '')) {
        this._forward(e, 'shortcut');
        return;
      }
      if (MODIFIERS[k]) {
        this._mod = true;
        if (k === 'Insert') this._eat(e);
        this._forward(e, 'down');
        return;
      }
      if (k === 'Control') { this._forward(e, 'down'); return; }
      if (k === 'Shift' || k === 'Alt' || k === 'Meta' || k === 'AltGraph') return;
      if (this._mod) { this._eat(e); this._forward(e, 'down'); return; }
      if (this.mode !== 'browse') return;              // the page's keys; Escape is seen late
      if (readerKey(e, this.letters)) { this._eat(e); this._forward(e, 'down'); }
      else if (k === 'Escape') this._forward(e, 'down');
    }

    _onKeyUp(e) {
      if (!MODIFIERS[e.key]) return;
      this._mod = false;
      if (e.key === 'Insert') this._eat(e);
      this._forward(e, 'up');
    }

    _onLate(e) {
      if (this.mode !== 'focus' || e.key !== 'Escape' || e.defaultPrevented || this._mod) return;
      e.preventDefault();
      this._forward(e, 'late');
    }

    _onFocusIn(e) {
      const el = deepTarget(e);
      if (!el || el.nodeType !== 1) return;
      if (this._quiet === el) { this._quiet = null; return; }
      const buf = this._buffer();
      const index = buf.lineOf(el);
      const N = naming();
      const item = index > -1 ? buf.items[index] : null;
      let said = N ? N.describeElement(el) : '';
      if (item && item.heading && item.heading.el === el) said = 'heading level ' + item.heading.level + ', ' + item.text;
      else if (!said && item) said = item.text;
      relay(0, { type: 'focus', frameId: this.frameId, index: index, said: said, focusMode: needsFocusMode(el) });
    }

    // ── Doing what the reader asks ──

    _targetOf(item) {
      if (item.kind === 'object') return item.el;
      if (item.link) return item.link.el;
      const start = item.range && item.range.startNode ? item.range.startNode.parentElement : item.el;
      return (start && start.closest && start.closest(CLICKABLE)) || start;
    }

    _activate(index) {
      const item = this._buffer().items[index];
      if (!item || item.remote) return { ok: false };
      const el = this._targetOf(item);
      if (!el) return { ok: false };
      if (needsFocusMode(el)) {
        // Focus goes in; the focus handler tells the reader, which switches mode.
        try { el.focus(); } catch (e) { /* ok */ }
        return { ok: true };
      }
      this._quiet = el;
      const A = root.AccessiFlowPageActions;
      if (A) A.activate(el);
      else { try { el.focus(); el.click(); } catch (e) { /* ok */ } }
      this._quiet = null;
      const stateful = el.hasAttribute('aria-expanded') || el.hasAttribute('aria-pressed') ||
        el.hasAttribute('aria-checked') || (el.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(el.type));
      if (!stateful) return { ok: true };
      return new Promise(resolve => setTimeout(() => {
        const N = naming();
        resolve({ ok: true, said: N ? N.describeElement(el) : '' });
      }, 60));
    }

    _focusStart(index) {
      const item = this._buffer().items[index];
      const el = item && !item.remote ? this._targetOf(item) : null;
      if (!el || typeof el.focus !== 'function') return;
      this._quiet = el;
      try { el.focus({ preventScroll: true }); } catch (e) { /* ok */ }
      this._quiet = null;
    }

    _clear() {
      try { if (window.CSS && CSS.highlights) CSS.highlights.delete(HIGHLIGHT); } catch (e) { /* ok */ }
      if (this._marked) { this._marked.classList.remove(CURSOR_CLASS); this._marked = null; }
    }

    _show(index) {
      this._clear();
      const item = this._buffer().items[index];
      if (!item || item.remote) return;
      if (!document.getElementById('accessiflow-sr-style')) {
        const style = document.createElement('style');
        style.id = 'accessiflow-sr-style';
        style.textContent = '.' + CURSOR_CLASS + ' { outline: 3px solid #ffd400 !important; outline-offset: 2px !important; }\n' +
          '::highlight(' + HIGHLIGHT + ') { background-color: #ffd400; color: #111; }';
        (document.head || document.documentElement).appendChild(style);
      }
      let target = item.el;
      if (item.range && window.CSS && CSS.highlights && typeof window.Highlight === 'function') {
        try {
          const r = document.createRange();
          r.setStart(item.range.startNode, Math.min(item.range.startOffset, item.range.startNode.length));
          r.setEnd(item.range.endNode, Math.min(item.range.endOffset, item.range.endNode.length));
          CSS.highlights.set(HIGHLIGHT, new window.Highlight(r));
          target = item.range.startNode.parentElement;
        } catch (e) { target = item.el; }
      } else if (item.el && item.el.classList) {
        item.el.classList.add(CURSOR_CLASS);
        this._marked = item.el;
      }
      try { if (target) target.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) { /* ok */ }
    }
  }

  root.AccessiFlowSRFrames = { Hub: FrameHub, Agent: FrameAgent, relay: relay, frameElements: frameElements };

  // Inside a frame, with nothing else of AccessiFlow loaded here, start the
  // agent. Injected again when the reader is switched back on: say hello again.
  const inFrame = (() => { try { return window.top !== window; } catch (e) { return true; } })();
  const sameSiteAsParent = (() => { try { return !!window.parent.document; } catch (e) { return false; } })();
  if (inFrame && !sameSiteAsParent && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    // A frame from the same site as its parent is read by the parent directly.
    if (root.__accessiflowSrAgent) root.__accessiflowSrAgent.hello();
    else {
      root.__accessiflowSrAgent = new FrameAgent();
      root.__accessiflowSrAgent.start();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
