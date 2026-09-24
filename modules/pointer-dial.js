// AccessiFlow hold-click menu
//
// Hold the mouse button still for a moment and a ring of eight actions
// opens around the pointer: scroll up and down, back and forward, the tab
// on either side, reload, and the on-screen keyboard. Move towards one and
// let go. It is for anyone who can move a mouse but cannot easily reach a
// keyboard, hold two keys together, or keep turning a scroll wheel.
//
// A click stays a click. The ring opens only when the button is held down
// with the pointer kept still, which leaves alone the things a held button
// already means on the web:
//   • a quick click is let go before the delay, and the page gets it as usual
//   • dragging and selecting text move the pointer, and moving cancels the ring
//   • a slider, a list box or a video, where holding still is the gesture
//     itself, never opens it
// Once the ring has opened, the click that would have followed is swallowed,
// so letting go over a link does not also follow the link.
//
// Letting go without choosing leaves the ring open, for anyone who cannot
// keep a button down: then a click chooses, and a click in the middle closes
// it. Holding on Scroll up or Scroll down keeps scrolling until let go.
//
// What sits in each of the eight places is the user's choice, from the
// actions below, in the popup's Moving and clicking section.
'use strict';

(function () {
  if (typeof window !== 'undefined' && window.AccessiFlowPointerDial) return;

  // Everything the ring can hold. Icons are drawn as lines on a 24 by 24
  // grid rather than taken from a font, so they look the same on every
  // computer and are never read out as symbols.
  const ACTIONS = {
    scrollUp: { name: 'Scroll up', lines: ['Scroll', 'up'], scroll: -1, icon: 'M12 19V5M5 12l7-7 7 7' },
    scrollDown: { name: 'Scroll down', lines: ['Scroll', 'down'], scroll: 1, icon: 'M12 5v14M19 12l-7 7-7-7' },
    back: { name: 'Back', lines: ['Back'], icon: 'M19 12H5M12 19l-7-7 7-7' },
    forward: { name: 'Forward', lines: ['Forward'], icon: 'M5 12h14M12 5l7 7-7 7' },
    prevTab: { name: 'Previous tab', lines: ['Previous', 'tab'], icon: 'M10 5h10v14H10zM10 12H3M6 9l-3 3 3 3' },
    nextTab: { name: 'Next tab', lines: ['Next', 'tab'], icon: 'M4 5h10v14H4zM14 12h7M18 9l3 3-3 3' },
    reload: { name: 'Reload', lines: ['Reload'], icon: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5' },
    keyboard: { name: 'Keyboard', lines: ['Keyboard'], icon: 'M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10' },
    shortcuts: { name: 'Shortcuts', lines: ['Shortcuts'], icon: 'M13 2L4 14h7l-1 8 9-12h-7z' },
    newTab: { name: 'New tab', lines: ['New', 'tab'], icon: 'M4 5h16v14H4zM12 9v6M9 12h6' },
    closeTab: { name: 'Close tab', lines: ['Close', 'tab'], icon: 'M4 5h16v14H4zM9.5 9.5l5 5M14.5 9.5l-5 5' },
    top: { name: 'Top of page', lines: ['Top'], icon: 'M5 3h14M12 21V8M6 13l6-6 6 6' },
    bottom: { name: 'Bottom of page', lines: ['Bottom'], icon: 'M5 21h14M12 3v13M6 11l6 6 6-6' },
    copy: { name: 'Copy', lines: ['Copy'], icon: 'M9 9h11v11H9zM5 15H4V4h11v1' },
    cut: { name: 'Cut', lines: ['Cut'], icon: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.1 7.9L20 20M8.1 16.1L20 4' },
    paste: { name: 'Paste', lines: ['Paste'], icon: 'M9 3h6v4H9zM7 5H5v16h14V5h-2' },
    selectAll: { name: 'Select all', lines: ['Select', 'all'], icon: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M9 9h6v6H9z' },
    undo: { name: 'Undo', lines: ['Undo'], icon: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3' },
    redo: { name: 'Redo', lines: ['Redo'], icon: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3' },
    zoomIn: { name: 'Zoom in', lines: ['Zoom', 'in'], icon: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M11 8v6M8 11h6' },
    zoomOut: { name: 'Zoom out', lines: ['Zoom', 'out'], icon: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M8 11h6' },
    zoomReset: { name: 'Normal size', lines: ['Normal', 'size'], icon: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M9.5 9.5h3v3h-3z' },
    screenshot: { name: 'Screenshot', lines: ['Screenshot'], icon: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z' },
    print: { name: 'Print', lines: ['Print'], icon: 'M7 9V3h10v6M7 17H4V9h16v8h-3M7 14h10v7H7z' },
    history: { name: 'History', lines: ['History'], icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2' },
    downloads: { name: 'Downloads', lines: ['Downloads'], icon: 'M12 4v11M7 10l5 5 5-5M5 20h14' },
    newWindow: { name: 'New window', lines: ['New', 'window'], icon: 'M3 5h18v14H3zM3 9h18' },
    readPage: { name: 'Read aloud', lines: ['Read', 'aloud'], icon: 'M4 9h4l5-4v14l-5-4H4zM16 9a3 3 0 0 1 0 6M18.5 6.5a7 7 0 0 1 0 11' },
    stopReading: { name: 'Stop reading', lines: ['Stop', 'reading'], icon: 'M4 9h4l5-4v14l-5-4H4zM16 10l4 4M20 10l-4 4' }
  };

  // Clockwise from the top. Opposites face each other, so "back" things sit
  // on the left and "forward" things on the right.
  const DEFAULT_SLOTS = ['scrollUp', 'nextTab', 'forward', 'reload', 'scrollDown', 'keyboard', 'back', 'prevTab'];

  /** The eight places, filled in from the user's choices; `null` is an empty place. */
  function itemsFor(slots) {
    return DEFAULT_SLOTS.map((fallback, i) => {
      const id = slots && slots[i] !== undefined && slots[i] !== null && slots[i] !== '' ? slots[i] : fallback;
      return ACTIONS[id] ? Object.assign({ id: id }, ACTIONS[id]) : null;
    });
  }

  const OUTER = 150;           // ring radius, px
  const INNER = 48;            // the middle, where letting go chooses nothing
  const LABEL = 104;           // where each choice's icon and words sit
  const GAP_PX = 5;            // pixels of space between neighbouring choices
  const STILL = 14;            // drift allowed while holding before it counts as a drag
  const MOVED = 10;            // travel from where the ring opened before a choice counts
  const SCROLL_ARM = 150;      // ms on a scroll choice before scrolling starts
  const SPEEDS = { slow: 300, medium: 700, fast: 1400 };   // px per second
  // Holding still is already the gesture on these.
  const EXCLUDE = 'select, option, input[type="range"], input[type="color"], video, audio, embed, object, canvas, iframe';

  const SVG = 'http://www.w3.org/2000/svg';

  function composedParent(el) {
    if (!el) return null;
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode ? el.getRootNode() : null;
    return root && root.host ? root.host : null;
  }

  function isOurs(el) {
    for (let n = el; n; n = composedParent(n)) {
      if (n.id && String(n.id).indexOf('accessiflow-') === 0) return true;
    }
    return false;
  }

  function motionOK() {
    try { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return true; }
  }

  const raf = fn => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(() => fn(Date.now()), 16));
  const cancelRaf = id => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id));
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  class AccessiFlowPointerDial {
    /**
     * @param {object} [options]
     * @param {function(string)} [options.run] carries out a choice by id
     */
    constructor(options) {
      const o = options || {};
      this._run = o.run || (id => {
        const A = window.AccessiFlowHandActions;
        if (A) A.run(id).then(message => A.toast(message));
      });
      this._opts = { enabled: false, delay: 800, button: 'left', speed: 'medium' };
      this._listening = false;
      this._press = null;        // a held button that may become the ring
      this._open = null;         // the ring, while it is on screen
      this._swallow = null;      // the click that follows the ring, to be eaten
      this._eatMouse = false;    // mouse events of a click made on the ring itself
      this._host = null;
      this._parts = null;
      this._noSelect = null;
      this._saved = null;
      this._items = itemsFor(null);
      this._slotsKey = DEFAULT_SLOTS.join();

      this._onDown = this._onDown.bind(this);
      this._onMove = this._onMove.bind(this);
      this._onUp = this._onUp.bind(this);
      this._onCancel = this._onCancel.bind(this);
      this._onMouse = this._onMouse.bind(this);
      this._onClickish = this._onClickish.bind(this);
      this._onDragStart = this._onDragStart.bind(this);
      this._onKey = this._onKey.bind(this);
      this._onAway = this._onAway.bind(this);
      this._scrollFrame = this._scrollFrame.bind(this);
    }

    static get ACTIONS() { return ACTIONS; }
    static get DEFAULT_SLOTS() { return DEFAULT_SLOTS.slice(); }

    get isOpen() { return Boolean(this._open); }

    /** What is in each place now, clockwise from the top: ids, or null for empty. */
    get slots() { return this._items.map(item => (item ? item.id : null)); }

    /**
     * @param {object} opts
     * @param {boolean} opts.enabled
     * @param {number} [opts.delay] ms the button must be held
     * @param {'left'|'right'} [opts.button]
     * @param {'slow'|'medium'|'fast'} [opts.speed] of held scrolling
     * @param {string[]} [opts.slots] eight action ids, clockwise from the top;
     *   'none' leaves a place empty, and anything missing keeps its default
     */
    apply(opts) {
      const o = opts || {};
      this._opts = {
        enabled: Boolean(o.enabled),
        delay: Math.max(200, Math.min(3000, Number(o.delay) || 800)),
        button: o.button === 'right' ? 'right' : 'left',
        speed: SPEEDS[o.speed] ? o.speed : 'medium'
      };
      const items = itemsFor(o.slots);
      const key = items.map(item => (item ? item.id : '')).join();
      if (key !== this._slotsKey) {
        // Drawn again from scratch next time it opens.
        this._items = items;
        this._slotsKey = key;
        this.close();
        if (this._host) this._host.remove();
        this._host = null;
        this._parts = null;
      }
      if (this._opts.enabled) {
        this._listen(true);
      } else {
        this._cancelPress();
        this.close();
        this._listen(false);
      }
    }

    destroy() {
      this.apply({ enabled: false });
      if (this._host) this._host.remove();
      this._host = null;
      this._parts = null;
    }

    _listen(on) {
      if (on === this._listening) return;
      this._listening = on;
      const method = on ? 'addEventListener' : 'removeEventListener';
      const opts = { capture: true, passive: false };
      window[method]('pointerdown', this._onDown, opts);
      window[method]('pointermove', this._onMove, opts);
      window[method]('pointerup', this._onUp, opts);
      window[method]('pointercancel', this._onCancel, opts);
      window[method]('mousedown', this._onMouse, opts);
      window[method]('mouseup', this._onMouse, opts);
      ['click', 'auxclick', 'dblclick', 'contextmenu'].forEach(type => window[method](type, this._onClickish, opts));
      window[method]('dragstart', this._onDragStart, opts);
      window[method]('keydown', this._onKey, opts);
      window[method]('blur', this._onAway, opts);
      document[method]('visibilitychange', this._onAway, opts);
    }

    // ── Holding ─────────────────────────────────────────────────────────────

    _wantedButton() { return this._opts.button === 'right' ? 2 : 0; }

    /** Whether this press is one the ring may grow out of. */
    _startable(e) {
      if (e.pointerType && e.pointerType !== 'mouse') return false;   // touch has its own long press
      if (e.button !== this._wantedButton()) return false;
      // A held modifier makes it a deliberate click of some other kind.
      if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return false;
      if (document.pointerLockElement) return false;                  // a game has the mouse
      // On the page's scrollbar, where holding scrolls. The viewport is
      // measured on the scrolling element: in an old-style page without a
      // doctype, <html> is only as tall as the text, and every press below
      // that would have been taken for the scrollbar.
      const view = document.scrollingElement || document.documentElement;
      if (view && view.clientWidth && e.clientX >= view.clientWidth) return false;
      if (view && view.clientHeight && e.clientY >= view.clientHeight) return false;

      const target = e.composedPath ? e.composedPath()[0] : e.target;
      if (!target || isOurs(target)) return false;
      // On the scrollbar of a panel inside the page.
      if (target.nodeType === 1 && target.getBoundingClientRect && target !== view) {
        const r = target.getBoundingClientRect();
        const right = r.left + target.clientLeft + target.clientWidth;
        const bottom = r.top + target.clientTop + target.clientHeight;
        if ((target.scrollHeight > target.clientHeight && target.clientWidth && e.clientX >= right && e.clientX < r.right) ||
            (target.scrollWidth > target.clientWidth && target.clientHeight && e.clientY >= bottom && e.clientY < r.bottom)) {
          return false;
        }
      }
      for (let n = target; n; n = composedParent(n)) {
        if (n.nodeType === 1 && n.matches && n.matches(EXCLUDE)) return false;
      }
      return true;
    }

    _onDown(e) {
      if (this._open) { this._downOnRing(e); return; }
      if (!this._startable(e)) return;
      this._cancelPress();
      const target = e.composedPath ? e.composedPath()[0] : e.target;
      this._press = {
        id: e.pointerId, x: e.clientX, y: e.clientY, target: target,
        timer: setTimeout(() => this._openRing(), this._opts.delay)
      };
    }

    _cancelPress() {
      if (!this._press) return;
      clearTimeout(this._press.timer);
      this._press = null;
    }

    _onMove(e) {
      if (this._press && !this._open) {
        if (Math.hypot(e.clientX - this._press.x, e.clientY - this._press.y) > STILL) this._cancelPress();
        return;
      }
      if (this._open) this._track(e.clientX, e.clientY);
    }

    // ── The ring ────────────────────────────────────────────────────────────

    _openRing() {
      const p = this._press;
      this._press = null;
      if (!p || !this._opts.enabled) return;

      const w = window.innerWidth;
      const h = window.innerHeight;
      const edge = OUTER + 8;
      // Kept whole on screen. Near an edge the middle is not under the pointer,
      // which is why a choice needs the pointer to travel first (MOVED).
      const cx = w < edge * 2 ? w / 2 : Math.max(edge, Math.min(w - edge, p.x));
      const cy = h < edge * 2 ? h / 2 : Math.max(edge, Math.min(h - edge, p.y));

      const A = window.AccessiFlowHandActions;
      this._open = {
        cx: cx, cy: cy, ox: p.x, oy: p.y,
        mode: 'drag',          // the button that opened it is still down
        holding: true,
        moved: false,
        highlight: -1,
        downIndex: -1,
        scroller: A ? A.scrollerAt(p.target) : (document.scrollingElement || document.documentElement),
        scroll: null
      };
      // A restore still waiting from the last time is out of date now.
      this._settleNow(false);
      this._holdSelection();
      this._draw(true);
    }

    /** Which choice a point is on, or -1 for the middle or, when clicking, well outside. */
    _indexAt(x, y) {
      const o = this._open;
      if (!o) return -1;
      const dx = x - o.cx;
      const dy = y - o.cy;
      const distance = Math.hypot(dx, dy);
      if (distance < INNER) return -1;
      // While dragging, direction is enough: a flick past the edge still
      // counts. A click has to land on the ring or near it.
      if (o.mode === 'click' && distance > OUTER + 24) return -1;
      const index = Math.round(this._angleOf(dx, dy) / 45) % this._items.length;
      // An empty place is nothing, the same as the middle.
      return this._items[index] ? index : -1;
    }

    /** Degrees clockwise from straight up. */
    _angleOf(dx, dy) {
      return (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
    }

    _track(x, y) {
      const o = this._open;
      // A held button moving over text goes on selecting it underneath the
      // ring, whatever the page's styles say; it is undone as it happens.
      if (o.holding) this._putSelectionBack(this._saved);
      if (!o.moved && Math.hypot(x - o.ox, y - o.oy) >= MOVED) o.moved = true;
      if (o.mode === 'drag' && !o.moved) return;
      this._point(x, y);
      this._highlight(this._indexAt(x, y));
      if (o.holding) this._updateScroll();
    }

    _onUp(e) {
      if (this._press && !this._open) { this._cancelPress(); return; }   // a click: the page's
      const o = this._open;
      if (!o) return;

      if (o.mode === 'drag') {
        // The button that opened the ring coming up. The page is allowed to
        // see it, so nothing it started on the press is left thinking the
        // button is still down; the click that follows is what gets eaten.
        this._swallowNext();
        o.holding = false;
        const index = o.moved ? this._indexAt(e.clientX, e.clientY) : -1;
        if (index >= 0) { this._choose(index); return; }
        if (!o.moved) {
          // Let go without moving: stay open, and let clicks choose.
          o.mode = 'click';
          this._stopScroll();
          this._draw();
          return;
        }
        this.close();   // went out and came back to the middle: changed their mind
        return;
      }

      // A click on the ring itself.
      e.preventDefault();
      e.stopImmediatePropagation();
      this._swallowNext();
      o.holding = false;
      const index = this._indexAt(e.clientX, e.clientY);
      const down = o.downIndex;
      o.downIndex = -1;

      if (down >= 0 && this._items[down].scroll) {
        // Scrolling by clicks keeps the ring open for the next one.
        if (index === down && !(o.scroll && o.scroll.moved)) this._step(this._items[down].scroll);
        this._stopScroll();
        this._highlight(index);
        return;
      }
      if (index >= 0 && index === down) { this._choose(index, true); return; }
      if (index < 0 && down < 0) this.close();
    }

    _downOnRing(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this._eatMouse = true;
      const o = this._open;
      o.holding = true;
      o.downIndex = this._indexAt(e.clientX, e.clientY);
      this._highlight(o.downIndex);
      this._updateScroll();
    }

    /**
     * @param {number} index
     * @param {boolean} [now] no held button was dragged over text (a click
     *   on the ring, a key), so there is no selection to wait for
     */
    _choose(index, now) {
      const item = this._items[index];
      if (!item) return;
      if (item.scroll) {
        const o = this._open;
        if (!(o && o.scroll && o.scroll.moved)) this._step(item.scroll);
        this._stopScroll();
        if (o && o.mode === 'drag') this.close();
        return;
      }
      this.close();
      this._afterSettle(() => this._run(item.id));
      if (now) this._settleNow(true);
    }

    close() {
      if (!this._open) return;
      this._stopScroll();
      this._open = null;
      this._closedAt = Date.now();
      if (this._host) this._host.style.display = 'none';
      this._releaseSelection();
    }

    _onCancel() {
      this._cancelPress();
      this.close();
    }

    _onAway(e) {
      if (e && e.type === 'visibilitychange' && !document.hidden) return;
      // Caught in the capture phase, so every element's blur arrives here too:
      // pressing on the page while in a text box blurs the box. Only the
      // window itself losing focus means the user has gone elsewhere.
      if (e && e.type === 'blur' && e.target !== window) return;
      this._cancelPress();
      this.close();
    }

    // ── What the page must not see ──────────────────────────────────────────

    _swallowNext() {
      this._swallow = { until: Date.now() + 800, click: true, auxclick: true, dblclick: true, contextmenu: true };
    }

    _onClickish(e) {
      // On Linux and macOS the menu opens as the right button goes down, so
      // it cannot be held there; the press is over.
      if (e.type === 'contextmenu' && this._press && !this._open) { this._cancelPress(); return; }
      const s = this._swallow;
      if (!s) return;
      if (Date.now() > s.until) { this._swallow = null; return; }
      if (!s[e.type]) return;
      s[e.type] = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    _onMouse(e) {
      if (!this._eatMouse) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'mouseup') this._eatMouse = false;
    }

    _onDragStart(e) {
      if (this._open) { e.preventDefault(); return; }
      // The browser has started dragging what was pressed: a drag, not a hold.
      this._cancelPress();
    }

    _onKey(e) {
      const o = this._open;
      if (!o) return;
      let handled = true;
      const current = o.highlight;
      const count = this._items.length;
      // The next place round that holds something, either way.
      const next = step => {
        let i = current < 0 ? (step > 0 ? -1 : count) : current;
        for (let n = 0; n < count; n++) {
          i = (i + step + count) % count;
          if (this._items[i]) return i;
        }
        return -1;
      };
      switch (e.key) {
        case 'Escape': this.close(); break;
        case 'ArrowRight': case 'ArrowDown': this._highlight(next(1)); break;
        case 'ArrowLeft': case 'ArrowUp': this._highlight(next(-1)); break;
        case 'Enter': case ' ':
          if (current >= 0) {
            if (this._items[current].scroll) this._step(this._items[current].scroll);
            else this._choose(current, true);
          }
          break;
        default: handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }

    /**
     * Holding the button down over text would carry on selecting it as the
     * pointer travels to a choice. Selection is switched off while the ring
     * is open, and whatever was selected before is put back afterwards.
     */
    _holdSelection() {
      this._saved = null;
      try {
        const A = window.AccessiFlowHandActions;
        const field = A ? A.deepActive() : document.activeElement;
        if (field && A && A.isTextField(field) && A.hasCaret(field)) {
          this._saved = { field: field, start: field.selectionStart, end: field.selectionEnd, dir: field.selectionDirection };
        } else {
          const sel = document.getSelection();
          const ranges = [];
          for (let i = 0; sel && i < sel.rangeCount; i++) ranges.push(sel.getRangeAt(i).cloneRange());
          this._saved = { ranges: ranges };
        }
      } catch (e) { this._saved = null; }

      if (!this._noSelect) {
        this._noSelect = document.createElement('style');
        this._noSelect.id = 'accessiflow-dial-noselect';
        this._noSelect.textContent = 'html, html * { -webkit-user-select: none !important; user-select: none !important; }';
      }
      (document.head || document.documentElement).appendChild(this._noSelect);
    }

    /** Puts back what was selected when the ring opened, if anything has changed it. */
    _putSelectionBack(saved) {
      if (!saved) return;
      try {
        if (saved.field) {
          const f = saved.field;
          if (f.isConnected && (f.selectionStart !== saved.start || f.selectionEnd !== saved.end)) {
            f.setSelectionRange(saved.start, saved.end, saved.dir || 'none');
          }
        } else if (saved.ranges) {
          const sel = document.getSelection();
          const same = sel.rangeCount === saved.ranges.length && saved.ranges.every((r, i) => {
            const now = sel.getRangeAt(i);
            return now.startContainer === r.startContainer && now.startOffset === r.startOffset &&
              now.endContainer === r.endContainer && now.endOffset === r.endOffset;
          });
          if (same) return;
          sel.removeAllRanges();
          saved.ranges.forEach(r => sel.addRange(r));
        }
      } catch (e) { /* the page moved on */ }
    }

    _releaseSelection() {
      const saved = this._saved;
      this._saved = null;
      this._putSelectionBack(saved);
      // Chrome settles a mouse selection as the button comes up, which is
      // after this runs, and would leave the text dragged across selected
      // (and, with Read what I select on, read out). So it is put back once
      // more when that mouse-up has been handled, and a choice made on the
      // ring waits until then: Select all run first would be undone by it.
      this._settleNow(false);
      const settle = { saved: saved, queue: [], timer: null, onUp: null };
      settle.onUp = () => setTimeout(() => this._settleNow(true, settle), 0);
      window.addEventListener('mouseup', settle.onUp, true);
      // No mouse-up to wait for: closed from the keyboard, or by a click already over.
      settle.timer = setTimeout(() => this._settleNow(true, settle), 300);
      this._settle = settle;
    }

    /** Ends the wait after the ring closed: puts the selection back if asked, then runs what was chosen. */
    _settleNow(restore, only) {
      const settle = this._settle;
      if (!settle || (only && settle !== only)) return;
      this._settle = null;
      clearTimeout(settle.timer);
      window.removeEventListener('mouseup', settle.onUp, true);
      if (restore) this._putSelectionBack(settle.saved);
      if (this._noSelect && !this._open) this._noSelect.remove();
      settle.queue.forEach(fn => { try { fn(); } catch (e) { /* the page may be navigating away */ } });
    }

    /** Runs `fn` once the page has settled from the ring, straight away if it has. */
    _afterSettle(fn) {
      if (this._settle) this._settle.queue.push(fn);
      else fn();
    }

    /** True while the ring is open and for a moment after, when the page is still settling from it. */
    get recentlyActive() {
      return Boolean(this._open || this._press) || Date.now() - (this._closedAt || 0) < 800;
    }

    // ── Scrolling while held ────────────────────────────────────────────────

    _wantedScroll() {
      const o = this._open;
      if (!o || !o.holding || o.highlight < 0) return 0;
      if (o.mode === 'click' && o.highlight !== o.downIndex) return 0;
      return this._items[o.highlight].scroll || 0;
    }

    _updateScroll() {
      const o = this._open;
      if (!o) return;
      const dir = this._wantedScroll();
      if (!dir) { this._stopScroll(); return; }
      if (o.scroll && o.scroll.dir === dir) return;
      this._stopScroll();
      o.scroll = { dir: dir, since: now(), last: 0, acc: 0, moved: false, frame: null };
      o.scroll.frame = raf(this._scrollFrame);
    }

    _scrollFrame(stamp) {
      const o = this._open;
      if (!o || !o.scroll) return;
      const s = o.scroll;
      const t = typeof stamp === 'number' ? stamp : now();
      // A moment's grace first, so passing over a scroll choice on the way
      // to another one does not jerk the page.
      if (t - s.since >= SCROLL_ARM) {
        const dt = s.last ? Math.min(64, t - s.last) : 16;
        s.acc += s.dir * SPEEDS[this._opts.speed] * dt / 1000;
        const whole = Math.trunc(s.acc);
        if (whole) {
          s.acc -= whole;
          s.moved = true;
          const A = window.AccessiFlowHandActions;
          if (A) A.scrollBy(o.scroller, whole);
        }
        s.last = t;
      }
      s.frame = raf(this._scrollFrame);
    }

    _stopScroll() {
      const o = this._open;
      if (!o || !o.scroll) return;
      cancelRaf(o.scroll.frame);
      o.scroll = null;
    }

    /** One screenful, for a quick choice of Scroll up or down. */
    _step(dir) {
      const o = this._open;
      const target = o ? o.scroller : null;
      const top = Math.max(80, Math.round(window.innerHeight * 0.85)) * dir;
      const behavior = motionOK() ? 'smooth' : 'auto';
      const isPage = !target || target === document.scrollingElement || target === document.documentElement ||
        target === document.body;
      try {
        if (isPage) window.scrollBy({ top: top, behavior: behavior });
        else target.scrollBy({ top: top, behavior: behavior });
      } catch (e) {
        const A = window.AccessiFlowHandActions;
        if (A) A.scrollBy(target, top);
      }
    }

    // ── Drawing ─────────────────────────────────────────────────────────────

    _highlight(index) {
      const o = this._open;
      if (!o || o.highlight === index) return;
      o.highlight = index;
      if (this._parts) this._paint();
    }

    /** The marker on the middle's edge, pointing the way the pointer is heading. */
    _point(x, y) {
      const o = this._open;
      const p = this._parts;
      if (!o || !p) return;
      const dx = x - o.cx;
      const dy = y - o.cy;
      if (Math.hypot(dx, dy) < 8) { p.needle.style.display = 'none'; return; }
      p.needle.setAttribute('transform', 'rotate(' + this._angleOf(dx, dy).toFixed(1) + ')');
      p.needle.style.display = '';
    }

    _build() {
      const host = document.createElement('div');
      host.id = 'accessiflow-dial';
      host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483646; display: none; ' +
        'background: rgba(0,0,0,.08); cursor: var(--af-cursor, default);';
      const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

      const style = document.createElement('style');
      style.textContent = [
        'svg { position: fixed; overflow: visible; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; ',
        '  filter: drop-shadow(0 10px 24px rgba(0,0,0,.45)); transform-origin: 50% 50%; }',
        'svg.pop { animation: af-pop .12s ease-out; }',
        '@keyframes af-pop { from { opacity: 0; transform: scale(.9); } to { opacity: 1; transform: scale(1); } }',
        '.base { fill: #0b0c10; }',
        '.rim { fill: none; stroke: #4fffb0; stroke-width: 2; opacity: .9; }',
        '.wedge { transition: transform .09s ease-out; }',
        '.wedge .shape { fill: #1b1e25; stroke: rgba(255,255,255,.12); stroke-width: 1; }',
        '.wedge .glyph, .middle .glyph { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }',
        '.wedge .glyph { stroke: #f4f5f7; }',
        '.wedge text { fill: #f4f5f7; font-size: 13px; font-weight: 700; text-anchor: middle; }',
        '.wedge.on .shape { fill: #ffd400; stroke: #111; stroke-width: 1.5; }',
        '.wedge.on .glyph { stroke: #111; }',
        '.wedge.on text { fill: #111; }',
        '.wedge.empty .shape { fill: #14161b; opacity: .55; }',
        '.middle .disc { fill: #0e0f13; stroke: #4fffb0; stroke-width: 2; }',
        '.middle .glyph { stroke: #ffd400; }',
        '.middle text { fill: #f4f5f7; font-size: 11.5px; font-weight: 600; text-anchor: middle; }',
        '.needle { fill: #ffd400; stroke: #111; stroke-width: 1.2; }',
        '@media (prefers-reduced-motion: reduce) { .wedge { transition: none; } svg.pop { animation: none; } }',
        '@media (forced-colors: active) {',
        '  .wedge .shape, .middle .disc { fill: Canvas; stroke: CanvasText; }',
        '  .wedge .glyph, .middle .glyph, .rim { stroke: CanvasText; }',
        '  .wedge text, .middle text { fill: CanvasText; }',
        '  .wedge.on .shape { fill: Highlight; stroke: HighlightText; }',
        '  .wedge.on .glyph { stroke: HighlightText; }',
        '  .wedge.on text { fill: HighlightText; }',
        '  .needle { fill: Highlight; }',
        '}'
      ].join('\n');
      root.appendChild(style);

      const size = OUTER * 2 + 40;
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('width', String(size));
      svg.setAttribute('height', String(size));
      svg.setAttribute('viewBox', [-size / 2, -size / 2, size, size].join(' '));
      svg.setAttribute('role', 'menu');
      svg.setAttribute('aria-label', 'Hold-click menu');

      const round = n => Math.round(n * 100) / 100;
      const point = (radius, degrees) => {
        const a = (degrees - 90) * Math.PI / 180;
        return [round(radius * Math.cos(a)), round(radius * Math.sin(a))];
      };
      // The same width of gap all the way along, rather than a wedge of
      // nothing that widens towards the edge.
      const gapAt = radius => (GAP_PX / 2) / radius * 180 / Math.PI;
      const glyph = (d, x, y, px) => {
        const path = document.createElementNS(SVG, 'path');
        path.setAttribute('class', 'glyph');
        path.setAttribute('d', d);
        path.setAttribute('transform', 'translate(' + round(x) + ' ' + round(y) + ') scale(' + round(px / 24) + ')');
        path.setAttribute('aria-hidden', 'true');
        return path;
      };

      // A dark disc under the choices, so the gaps between them are dark
      // lines rather than slits showing the page behind.
      const base = document.createElementNS(SVG, 'circle');
      base.setAttribute('class', 'base');
      base.setAttribute('r', String(OUTER + 1));
      svg.appendChild(base);
      const rim = document.createElementNS(SVG, 'circle');
      rim.setAttribute('class', 'rim');
      rim.setAttribute('r', String(OUTER + 5));
      svg.appendChild(rim);

      const wedges = this._items.map((item, i) => {
        const g = document.createElementNS(SVG, 'g');
        g.setAttribute('class', item ? 'wedge' : 'wedge empty');
        const centre = i * 45;
        const [ox1, oy1] = point(OUTER, centre - 22.5 + gapAt(OUTER));
        const [ox2, oy2] = point(OUTER, centre + 22.5 - gapAt(OUTER));
        const [ix2, iy2] = point(INNER, centre + 22.5 - gapAt(INNER));
        const [ix1, iy1] = point(INNER, centre - 22.5 + gapAt(INNER));
        const shape = document.createElementNS(SVG, 'path');
        shape.setAttribute('class', 'shape');
        shape.setAttribute('d', 'M' + ix1 + ' ' + iy1 + ' L' + ox1 + ' ' + oy1 +
          ' A' + OUTER + ' ' + OUTER + ' 0 0 1 ' + ox2 + ' ' + oy2 +
          ' L' + ix2 + ' ' + iy2 + ' A' + INNER + ' ' + INNER + ' 0 0 0 ' + ix1 + ' ' + iy1 + ' Z');
        g.appendChild(shape);

        if (!item) {
          g.setAttribute('aria-hidden', 'true');
        } else {
          g.setAttribute('role', 'menuitem');
          g.setAttribute('aria-label', item.name);
          // Icon above, words below, the pair centred on the label circle.
          const [lx, ly] = point(LABEL, centre);
          const lines = item.lines;
          const top = ly - (22 + 3 + 14 * lines.length) / 2;
          g.appendChild(glyph(item.icon, lx - 11, top, 22));
          const text = document.createElementNS(SVG, 'text');
          text.setAttribute('aria-hidden', 'true');
          lines.forEach((line, n) => {
            const span = document.createElementNS(SVG, 'tspan');
            span.setAttribute('x', String(lx));
            span.setAttribute('y', String(round(top + 22 + 3 + 11 + n * 14)));
            span.textContent = line;
            text.appendChild(span);
          });
          g.appendChild(text);
        }
        svg.appendChild(g);
        return g;
      });

      const middle = document.createElementNS(SVG, 'g');
      middle.setAttribute('class', 'middle');
      const disc = document.createElementNS(SVG, 'circle');
      disc.setAttribute('class', 'disc');
      disc.setAttribute('r', String(INNER - 6));
      middle.appendChild(disc);
      const icon = document.createElementNS(SVG, 'g');
      middle.appendChild(icon);
      const hint = document.createElementNS(SVG, 'text');
      hint.setAttribute('aria-live', 'polite');
      middle.appendChild(hint);
      const needle = document.createElementNS(SVG, 'g');
      needle.style.display = 'none';
      const dot = document.createElementNS(SVG, 'path');
      dot.setAttribute('class', 'needle');
      // A small arrowhead on the middle's edge, pointing outwards.
      const r = INNER - 6;
      dot.setAttribute('d', 'M0 ' + (-r - 7) + ' L6 ' + (-r + 2) + ' L-6 ' + (-r + 2) + ' Z');
      needle.appendChild(dot);
      middle.appendChild(needle);
      svg.appendChild(middle);

      root.appendChild(svg);
      document.documentElement.appendChild(host);
      this._host = host;
      this._parts = { svg: svg, wedges: wedges, hint: hint, icon: icon, needle: needle, size: size, glyph: glyph };
    }

    _draw(opening) {
      if (!this._host || !this._host.isConnected) this._build();
      const o = this._open;
      const p = this._parts;
      p.svg.style.left = (o.cx - p.size / 2) + 'px';
      p.svg.style.top = (o.cy - p.size / 2) + 'px';
      this._host.style.display = '';
      if (opening) {
        p.needle.style.display = 'none';
        if (motionOK()) {
          p.svg.classList.remove('pop');
          void p.svg.getBoundingClientRect();
          p.svg.classList.add('pop');
        }
      }
      this._paint();
    }

    _paint() {
      const o = this._open;
      const p = this._parts;
      if (!o || !p) return;
      p.wedges.forEach((g, i) => {
        const item = this._items[i];
        const on = i === o.highlight;
        g.setAttribute('class', !item ? 'wedge empty' : on ? 'wedge on' : 'wedge');
        // The chosen one lifts out of the ring a little, towards the pointer.
        if (on) {
          const a = (i * 45 - 90) * Math.PI / 180;
          g.style.transform = 'translate(' + (7 * Math.cos(a)).toFixed(1) + 'px, ' + (7 * Math.sin(a)).toFixed(1) + 'px)';
        } else {
          g.style.transform = '';
        }
      });

      const item = o.highlight >= 0 ? this._items[o.highlight] : null;
      while (p.icon.firstChild) p.icon.removeChild(p.icon.firstChild);
      let lines;
      let top;
      if (item) {
        p.icon.appendChild(p.glyph(item.icon, -11, -26, 22));
        lines = item.name.split(' ');
        if (lines.length > 2) lines = [lines[0], lines.slice(1).join(' ')];
        top = 8 + (lines.length === 1 ? 4 : 0);
      } else {
        if (o.mode === 'click') lines = ['Click one,', 'or here', 'to close'];
        else if (o.moved) lines = ['Let go', 'to cancel'];
        else lines = ['Move and', 'let go'];
        top = 4 - (lines.length - 1) * 6.5;
      }

      const hint = p.hint;
      while (hint.firstChild) hint.removeChild(hint.firstChild);
      lines.forEach((line, n) => {
        const span = document.createElementNS(SVG, 'tspan');
        span.setAttribute('x', '0');
        span.setAttribute('y', String(top + n * 13));
        span.textContent = line;
        hint.appendChild(span);
      });
    }
  }

  if (typeof window !== 'undefined') window.AccessiFlowPointerDial = AccessiFlowPointerDial;
})();
