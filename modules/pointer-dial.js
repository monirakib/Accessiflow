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
'use strict';

(function () {
  if (typeof window !== 'undefined' && window.AccessiFlowPointerDial) return;

  // Clockwise from the top. Opposites face each other, so "back" things sit
  // on the left and "forward" things on the right.
  const ITEMS = [
    { id: 'scrollUp', lines: ['Scroll', 'up'], icon: '▲', scroll: -1, name: 'Scroll up' },
    { id: 'nextTab', lines: ['Next', 'tab'], icon: '⇥', name: 'Next tab' },
    { id: 'forward', lines: ['Forward'], icon: '→', name: 'Forward' },
    { id: 'reload', lines: ['Reload'], icon: '⟳', name: 'Reload' },
    { id: 'scrollDown', lines: ['Scroll', 'down'], icon: '▼', scroll: 1, name: 'Scroll down' },
    { id: 'keyboard', lines: ['Keyboard'], icon: '⌨', name: 'Keyboard' },
    { id: 'back', lines: ['Back'], icon: '←', name: 'Back' },
    { id: 'prevTab', lines: ['Previous', 'tab'], icon: '⇤', name: 'Previous tab' }
  ];

  const OUTER = 150;           // ring radius, px
  const INNER = 46;            // the middle, where letting go chooses nothing
  const LABEL = 100;           // where the words sit
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

    static get ITEMS() { return ITEMS; }

    get isOpen() { return Boolean(this._open); }

    /**
     * @param {object} opts
     * @param {boolean} opts.enabled
     * @param {number} [opts.delay] ms the button must be held
     * @param {'left'|'right'} [opts.button]
     * @param {'slow'|'medium'|'fast'} [opts.speed] of held scrolling
     */
    apply(opts) {
      const o = opts || {};
      this._opts = {
        enabled: Boolean(o.enabled),
        delay: Math.max(200, Math.min(3000, Number(o.delay) || 800)),
        button: o.button === 'right' ? 'right' : 'left',
        speed: SPEEDS[o.speed] ? o.speed : 'medium'
      };
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
      const de = document.documentElement;
      // On the page's scrollbar, where holding scrolls.
      if (de && de.clientWidth && e.clientX >= de.clientWidth) return false;
      if (de && de.clientHeight && e.clientY >= de.clientHeight) return false;

      const target = e.composedPath ? e.composedPath()[0] : e.target;
      if (!target || isOurs(target)) return false;
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
      this._holdSelection();
      this._draw();
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
      const degrees = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
      return Math.round(degrees / 45) % ITEMS.length;
    }

    _track(x, y) {
      const o = this._open;
      if (!o.moved && Math.hypot(x - o.ox, y - o.oy) >= MOVED) o.moved = true;
      if (o.mode === 'drag' && !o.moved) return;
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

      if (down >= 0 && ITEMS[down].scroll) {
        // Scrolling by clicks keeps the ring open for the next one.
        if (index === down && !(o.scroll && o.scroll.moved)) this._step(ITEMS[down].scroll);
        this._stopScroll();
        this._highlight(index);
        return;
      }
      if (index >= 0 && index === down) { this._choose(index); return; }
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

    _choose(index) {
      const item = ITEMS[index];
      if (!item) return;
      if (item.scroll) {
        const o = this._open;
        if (!(o && o.scroll && o.scroll.moved)) this._step(item.scroll);
        this._stopScroll();
        if (o && o.mode === 'drag') this.close();
        return;
      }
      this.close();
      try { this._run(item.id); } catch (err) { /* the page may be navigating away */ }
    }

    close() {
      if (!this._open) return;
      this._stopScroll();
      this._open = null;
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
      switch (e.key) {
        case 'Escape': this.close(); break;
        case 'ArrowRight': case 'ArrowDown':
          this._highlight(current < 0 ? 0 : (current + 1) % ITEMS.length); break;
        case 'ArrowLeft': case 'ArrowUp':
          this._highlight(current < 0 ? ITEMS.length - 1 : (current + ITEMS.length - 1) % ITEMS.length); break;
        case 'Enter': case ' ':
          if (current >= 0) {
            if (ITEMS[current].scroll) this._step(ITEMS[current].scroll);
            else this._choose(current);
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

    _releaseSelection() {
      if (this._noSelect) this._noSelect.remove();
      const saved = this._saved;
      this._saved = null;
      if (!saved) return;
      try {
        if (saved.field) {
          if (saved.field.isConnected) saved.field.setSelectionRange(saved.start, saved.end, saved.dir || 'none');
        } else if (saved.ranges) {
          const sel = document.getSelection();
          sel.removeAllRanges();
          saved.ranges.forEach(r => sel.addRange(r));
        }
      } catch (e) { /* the page moved on */ }
    }

    // ── Scrolling while held ────────────────────────────────────────────────

    _wantedScroll() {
      const o = this._open;
      if (!o || !o.holding || o.highlight < 0) return 0;
      if (o.mode === 'click' && o.highlight !== o.downIndex) return 0;
      return ITEMS[o.highlight].scroll || 0;
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

    _build() {
      const host = document.createElement('div');
      host.id = 'accessiflow-dial';
      host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483646; display: none; ' +
        'background: rgba(0,0,0,.12); cursor: default;';
      const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

      const style = document.createElement('style');
      style.textContent = [
        'svg { position: fixed; overflow: visible; font-family: system-ui, "Segoe UI", sans-serif; ',
        '  filter: drop-shadow(0 8px 20px rgba(0,0,0,.45)); }',
        '.wedge path { fill: #16181d; stroke: #4fffb0; stroke-width: 1.5; }',
        '.wedge text { fill: #f4f5f7; font-size: 14px; font-weight: 700; text-anchor: middle; }',
        '.wedge .icon { font-size: 20px; font-weight: 400; }',
        '.wedge.on path { fill: #ffd400; stroke: #111; stroke-width: 2.5; }',
        '.wedge.on text { fill: #111; }',
        '.middle circle { fill: #0e0f13; stroke: #4fffb0; stroke-width: 2; }',
        '.middle text { fill: #f4f5f7; font-size: 11.5px; font-weight: 600; text-anchor: middle; }',
        '@media (forced-colors: active) {',
        '  .wedge path, .middle circle { fill: Canvas; stroke: CanvasText; }',
        '  .wedge text, .middle text { fill: CanvasText; }',
        '  .wedge.on path { fill: Highlight; stroke: HighlightText; }',
        '  .wedge.on text { fill: HighlightText; }',
        '}'
      ].join('\n');
      root.appendChild(style);

      const size = OUTER * 2 + 8;
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('width', String(size));
      svg.setAttribute('height', String(size));
      svg.setAttribute('viewBox', [-size / 2, -size / 2, size, size].join(' '));
      svg.setAttribute('role', 'menu');
      svg.setAttribute('aria-label', 'Hold-click menu');

      const point = (radius, degrees) => {
        const a = (degrees - 90) * Math.PI / 180;
        return [Math.round(radius * Math.cos(a) * 100) / 100, Math.round(radius * Math.sin(a) * 100) / 100];
      };

      const wedges = ITEMS.map((item, i) => {
        const g = document.createElementNS(SVG, 'g');
        g.setAttribute('class', 'wedge');
        g.setAttribute('role', 'menuitem');
        g.setAttribute('aria-label', item.name);
        const from = i * 45 - 22.5;
        const to = i * 45 + 22.5;
        const [ox1, oy1] = point(OUTER, from);
        const [ox2, oy2] = point(OUTER, to);
        const [ix2, iy2] = point(INNER, to);
        const [ix1, iy1] = point(INNER, from);
        const path = document.createElementNS(SVG, 'path');
        path.setAttribute('d', 'M' + ix1 + ' ' + iy1 + ' L' + ox1 + ' ' + oy1 +
          ' A' + OUTER + ' ' + OUTER + ' 0 0 1 ' + ox2 + ' ' + oy2 +
          ' L' + ix2 + ' ' + iy2 + ' A' + INNER + ' ' + INNER + ' 0 0 0 ' + ix1 + ' ' + iy1 + ' Z');
        g.appendChild(path);

        const [lx, ly] = point(LABEL, i * 45);
        const lines = item.lines;
        const icon = document.createElementNS(SVG, 'text');
        icon.setAttribute('class', 'icon');
        icon.setAttribute('aria-hidden', 'true');
        icon.setAttribute('x', String(lx));
        icon.setAttribute('y', String(ly - 6 - (lines.length - 1) * 8));
        icon.textContent = item.icon;
        g.appendChild(icon);
        const text = document.createElementNS(SVG, 'text');
        text.setAttribute('aria-hidden', 'true');
        lines.forEach((line, n) => {
          const span = document.createElementNS(SVG, 'tspan');
          span.setAttribute('x', String(lx));
          span.setAttribute('y', String(ly + 14 + n * 16 - (lines.length - 1) * 8));
          span.textContent = line;
          text.appendChild(span);
        });
        g.appendChild(text);
        svg.appendChild(g);
        return g;
      });

      const middle = document.createElementNS(SVG, 'g');
      middle.setAttribute('class', 'middle');
      const circle = document.createElementNS(SVG, 'circle');
      circle.setAttribute('r', String(INNER - 4));
      middle.appendChild(circle);
      const hint = document.createElementNS(SVG, 'text');
      hint.setAttribute('aria-live', 'polite');
      middle.appendChild(hint);
      svg.appendChild(middle);

      root.appendChild(svg);
      document.documentElement.appendChild(host);
      this._host = host;
      this._parts = { svg: svg, wedges: wedges, hint: hint, size: size };
    }

    _draw() {
      if (!this._host || !this._host.isConnected) this._build();
      const o = this._open;
      const p = this._parts;
      p.svg.style.left = (o.cx - p.size / 2) + 'px';
      p.svg.style.top = (o.cy - p.size / 2) + 'px';
      this._host.style.display = '';
      this._paint();
    }

    _paint() {
      const o = this._open;
      const p = this._parts;
      if (!o || !p) return;
      p.wedges.forEach((g, i) => g.setAttribute('class', i === o.highlight ? 'wedge on' : 'wedge'));

      let lines;
      if (o.highlight >= 0) lines = ITEMS[o.highlight].name.split(' ');
      else if (o.mode === 'click') lines = ['Click one,', 'or here', 'to close'];
      else if (o.moved) lines = ['Let go', 'to cancel'];
      else lines = ['Move and', 'let go'];

      const hint = p.hint;
      while (hint.firstChild) hint.removeChild(hint.firstChild);
      lines.forEach((line, n) => {
        const span = document.createElementNS(SVG, 'tspan');
        span.setAttribute('x', '0');
        span.setAttribute('y', String(4 + n * 13 - (lines.length - 1) * 6.5));
        span.textContent = line;
        hint.appendChild(span);
      });
    }
  }

  if (typeof window !== 'undefined') window.AccessiFlowPointerDial = AccessiFlowPointerDial;
})();
