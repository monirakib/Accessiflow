// AccessiFlow overlay primitive
//
// One rect-following element, shared by the focus halo, click snapping and the
// reading mask. Three features drawing their own boxes is how you end up with
// three subtly different bugs.
//
// Why draw a separate element instead of setting `outline:` on the target,
// which is what almost every focus tool does: an outline is painted inside the
// target's own stacking context, so `overflow: hidden` on any ancestor clips
// it, and any later `z-index` buries it. On real sites that means the ring is
// invisible exactly when the user most needs it. A fixed-position sibling of
// <body> at the top of the stacking order cannot be clipped by the page.
'use strict';

class AccessiFlowOverlay {
  /**
   * @param {object} [opts]
   * @param {string} [opts.id] so the element can be found and reused
   * @param {string} [opts.className]
   * @param {number} [opts.padding] how far outside the target rect to draw
   */
  constructor(opts) {
    const o = opts || {};
    this.id = o.id || ('accessiflow-overlay-' + Math.random().toString(36).slice(2, 8));
    this.className = o.className || '';
    this.padding = o.padding === undefined ? 4 : o.padding;

    this._el = null;
    this._tip = null;
    this._target = null;
    this._rect = null;          // last rect we drew, so we can skip no-op writes
    this._frame = null;
    this._tracking = false;
    this._onScroll = null;
    this._onResize = null;
    this._visible = false;
  }

  // ── The element ───────────────────────────────────────────────────────────

  _ensure() {
    if (this._el && document.body && document.body.contains(this._el)) return this._el;

    let el = document.getElementById(this.id);
    if (!el) {
      el = document.createElement('div');
      el.id = this.id;
      // aria-hidden because this is a drawing of something that already exists
      // in the accessibility tree. Announcing it again would make a screen
      // reader say every focused control twice.
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = [
        'position: fixed',
        'top: 0', 'left: 0',
        'width: 0', 'height: 0',
        'pointer-events: none',
        'z-index: 2147483600',
        'box-sizing: border-box',
        'display: none',
        'margin: 0', 'padding: 0',
        'transition: none'
      ].join(' !important; ') + ' !important;';
      if (this.className) el.className = this.className;
      (document.body || document.documentElement).appendChild(el);
    }
    this._el = el;
    return el;
  }

  /** Extra inline style for the caller's own look. Kept separate from geometry. */
  style(cssText) {
    const el = this._ensure();
    el.setAttribute('data-accessiflow-style', cssText || '');
    this._paintStyle();
    return this;
  }

  _paintStyle() {
    if (!this._el) return;
    const extra = this._el.getAttribute('data-accessiflow-style') || '';
    const r = this._rect;
    const geometry = r
      ? 'top:' + r.top + 'px !important; left:' + r.left + 'px !important; ' +
        'width:' + r.width + 'px !important; height:' + r.height + 'px !important;'
      : '';
    this._el.style.cssText = [
      'position: fixed !important',
      'pointer-events: none !important',
      'z-index: 2147483600 !important',
      'box-sizing: border-box !important',
      'margin: 0 !important',
      'padding: 0 !important',
      'display: ' + (this._visible ? 'block' : 'none') + ' !important'
    ].join('; ') + '; ' + geometry + ' ' + extra;
  }

  // ── Geometry ──────────────────────────────────────────────────────────────

  /**
   * Draws around a DOM element and keeps following it.
   * Returns false when the element has no usable box, so callers can fall back.
   */
  follow(target) {
    if (!target || !target.getBoundingClientRect) return false;
    const rect = target.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return false;

    this._target = target;
    this._draw(rect);
    this._startTracking();
    return true;
  }

  /** Draws at an explicit viewport rect. Used by the reading mask, which
   *  follows a text range rather than an element. */
  followRect(rect) {
    if (!rect) return false;
    this._target = null;
    this._draw(rect);
    this._startTracking();
    return true;
  }

  _draw(rect) {
    const p = this.padding;
    const next = {
      top: Math.round(rect.top - p),
      left: Math.round(rect.left - p),
      width: Math.round(rect.width + p * 2),
      height: Math.round(rect.height + p * 2)
    };

    const prev = this._rect;
    const same = prev &&
      prev.top === next.top && prev.left === next.left &&
      prev.width === next.width && prev.height === next.height;

    this._rect = next;
    this._visible = true;
    // Writing identical geometry every frame is the difference between a
    // smooth page and one that relayouts 60 times a second for nothing.
    if (!same || !this._el) {
      this._ensure();
      this._paintStyle();
    }
    if (this._tip) this._positionTip();
  }

  _startTracking() {
    if (this._tracking) return;
    this._tracking = true;

    const tick = () => {
      if (!this._tracking) return;
      if (this._target) {
        if (!this._target.isConnected) { this.hide(); return; }
        const rect = this._target.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) { this.hide(); return; }
        this._draw(rect);
      }
      this._frame = requestAnimationFrame(tick);
    };
    this._frame = requestAnimationFrame(tick);

    // Scroll and resize are handled by the same rAF loop, but a passive
    // listener wakes it immediately on the frame the user actually scrolled.
    this._onScroll = () => { if (this._target) this._draw(this._target.getBoundingClientRect()); };
    this._onResize = this._onScroll;
    window.addEventListener('scroll', this._onScroll, { passive: true, capture: true });
    window.addEventListener('resize', this._onResize, { passive: true });
  }

  _stopTracking() {
    this._tracking = false;
    if (this._frame) { cancelAnimationFrame(this._frame); this._frame = null; }
    if (this._onScroll) {
      window.removeEventListener('scroll', this._onScroll, { capture: true });
      window.removeEventListener('resize', this._onResize);
      this._onScroll = null;
      this._onResize = null;
    }
  }

  // ── The tooltip ───────────────────────────────────────────────────────────

  /**
   * A label pinned to the overlay. Also aria-hidden: the text it shows is the
   * element's own accessible name, which the screen reader already read.
   */
  tooltip(text, opts) {
    const o = opts || {};
    if (!text) { this.clearTooltip(); return this; }

    if (!this._tip) {
      this._tip = document.createElement('div');
      this._tip.setAttribute('aria-hidden', 'true');
      this._tip.id = this.id + '-tip';
      (document.body || document.documentElement).appendChild(this._tip);
    }
    this._tip.textContent = text;
    this._tipStyle = o.style || '';
    this._positionTip();
    return this;
  }

  clearTooltip() {
    if (this._tip) { this._tip.remove(); this._tip = null; }
  }

  _positionTip() {
    if (!this._tip || !this._rect) return;
    const r = this._rect;
    const base = [
      'position: fixed !important',
      'z-index: 2147483601 !important',
      'pointer-events: none !important',
      'max-width: 320px !important',
      'white-space: nowrap !important',
      'overflow: hidden !important',
      'text-overflow: ellipsis !important',
      'display: ' + (this._visible ? 'block' : 'none') + ' !important'
    ].join('; ');

    // Measure before choosing a side, so the tip never hangs off the viewport.
    this._tip.style.cssText = base + '; top: -9999px !important; left: 0 !important; ' + (this._tipStyle || '');
    const tipRect = this._tip.getBoundingClientRect();
    const gap = 6;

    let top = r.top - tipRect.height - gap;
    if (top < 4) top = r.top + r.height + gap;              // flip below
    if (top + tipRect.height > window.innerHeight - 4) top = Math.max(4, r.top - tipRect.height - gap);

    let left = r.left;
    if (left + tipRect.width > window.innerWidth - 4) left = window.innerWidth - tipRect.width - 4;
    if (left < 4) left = 4;

    this._tip.style.cssText = base +
      '; top: ' + Math.round(top) + 'px !important; left: ' + Math.round(left) + 'px !important; ' +
      (this._tipStyle || '');
  }

  // ── Cutout mask, for the reading lens ─────────────────────────────────────

  /**
   * Turns the overlay into a hole: everything outside the rect is dimmed,
   * the rect itself stays clear.
   *
   * A single huge spread box-shadow does this in one element. The obvious
   * alternative, two or four dimming panels around the gap, leaves seams at
   * the corners and cannot have a soft or rounded edge.
   */
  cutout(opts) {
    const o = opts || {};
    const dim = o.dim === undefined ? 0.7 : o.dim;
    const tint = o.tint || '0, 0, 0';
    const radius = o.radius === undefined ? 4 : o.radius;
    const feather = o.feather === undefined ? 0 : o.feather;

    this.style(
      'background: transparent !important; ' +
      'border-radius: ' + radius + 'px !important; ' +
      'box-shadow: 0 0 ' + feather + 'px ' + (feather ? '2px ' : '') +
        'rgba(' + tint + ',' + dim + '), 0 0 0 100vmax rgba(' + tint + ',' + dim + ') !important;'
    );
    return this;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  hide() {
    this._visible = false;
    this._target = null;
    this._stopTracking();
    if (this._el) this._paintStyle();
    if (this._tip) this._tip.style.display = 'none';
  }

  destroy() {
    this._stopTracking();
    this.clearTooltip();
    if (this._el) { this._el.remove(); this._el = null; }
    this._target = null;
    this._rect = null;
    this._visible = false;
  }

  get element() { return this._el; }
  get visible() { return this._visible; }
}

// ── Shared helpers that every overlay consumer needs ────────────────────────

const AccessiFlowGeometry = {
  /** Distance from a point to the nearest edge of a rect. Zero when inside. */
  distanceToRect(x, y, rect) {
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    return Math.sqrt(dx * dx + dy * dy);
  },

  /** True when the rect is big enough and on screen enough to aim at. */
  isUsable(rect) {
    if (!rect || rect.width < 1 || rect.height < 1) return false;
    return rect.bottom > 0 && rect.right > 0 &&
      rect.top < window.innerHeight && rect.left < window.innerWidth;
  },

  /**
   * Whether an element is actually visible to a sighted user. Cheap checks
   * first: getComputedStyle is the expensive call and most elements fail
   * before reaching it.
   */
  isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (!this.isUsable(rect)) return false;
    const cs = window.getComputedStyle(el);
    if (!cs) return false;
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05;
  },

  /**
   * The colour actually behind an element, found by climbing past every
   * transparent ancestor. Without this, text on an unstyled <span> inside a
   * dark card looks like text on white, and every contrast decision is wrong.
   */
  effectiveBackground(el) {
    const C = globalThis.ACCESSIFLOW_COLOR;
    let node = el;
    let acc = null;

    while (node && node.nodeType === 1) {
      const cs = window.getComputedStyle(node);
      const bg = cs ? cs.backgroundColor : null;
      if (bg && !C.isTransparent(bg)) {
        const parsed = C.parseColor(bg);
        acc = acc ? C.blend(acc, parsed) : parsed;
        if (parsed && parsed.a >= 1) return acc;   // fully opaque: stop climbing
      }
      node = node.parentElement;
    }

    // Nothing opaque all the way up. The canvas underneath is what shows.
    const htmlBg = window.getComputedStyle(document.documentElement).backgroundColor;
    const bodyBg = document.body ? window.getComputedStyle(document.body).backgroundColor : null;
    const base = (bodyBg && !C.isTransparent(bodyBg)) ? bodyBg
      : (htmlBg && !C.isTransparent(htmlBg)) ? htmlBg
        : '#ffffff';
    return acc ? C.blend(acc, base) : C.parseColor(base);
  },

  /** Elements a pointer can meaningfully aim at. */
  ACTIONABLE_SELECTOR: 'a[href], button, input:not([type="hidden"]), select, textarea, ' +
    'summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], ' +
    '[role="tab"], [role="menuitem"], [role="option"], [role="switch"], ' +
    '[onclick], [tabindex]:not([tabindex="-1"])',

  isActionable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('[id^="accessiflow-"]')) return false;   // never target our own UI
    if (el.disabled) return false;
    return el.matches(this.ACTIONABLE_SELECTOR);
  }
};

if (typeof window !== 'undefined') {
  window.AccessiFlowOverlay = AccessiFlowOverlay;
  window.AccessiFlowGeometry = AccessiFlowGeometry;
}
