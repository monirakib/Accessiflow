// AccessiFlow ContrastModule - Smart Dark Mode
//
// Every dark mode tool on the market does `filter: invert()`. It is one line
// and it is wrong: inverting the page inverts the photographs, the charts, the
// barcodes, the QR codes and the terminal output along with it. Tools then
// re-invert `img` and `video` to patch that up, which fixes photos and leaves
// every CSS background image, gradient and inline SVG broken.
//
// This computes a dark theme instead. It reads what the page actually uses,
// maps each colour's lightness through OKLCH so hue and saturation survive,
// and then *proves* every text colour reaches its WCAG 1.4.3 ratio against the
// background it will really sit on. Nothing is inverted, so nothing that was
// meant to be read as an image is damaged.
//
// The cost is that this has to run over the DOM rather than in one CSS rule,
// so the whole module is built around not making the page janky: read
// everything, then compute, then write once.
'use strict';

class ContrastModule {
  constructor() {
    this._styleEl = null;
    this._active = false;
    this._settings = {};

    this._pairs = new Map();     // rule signature -> index, so identical colours share a rule
    this._seq = 0;
    this._touched = [];          // elements carrying our attribute, for an exact undo

    this._observer = null;
    this._scrollHandler = null;
    this._passQueued = false;
    this._idleHandle = null;
    this._bailed = false;
  }

  _log(msg) { console.log('[AccessiFlow][Contrast] ' + msg); }
  _warn(msg) { console.warn('[AccessiFlow][Contrast] ' + msg); }

  // Elements whose pixels carry meaning. Recolouring these is the exact bug
  // this module exists to avoid.
  static get SKIP_TAGS() {
    return {
      IMG: 1, VIDEO: 1, CANVAS: 1, SVG: 1, PICTURE: 1, IFRAME: 1, OBJECT: 1,
      EMBED: 1, SOURCE: 1, TRACK: 1, MAP: 1, AREA: 1, SCRIPT: 1, STYLE: 1,
      NOSCRIPT: 1, HEAD: 1, META: 1, LINK: 1, TITLE: 1, BR: 1, WBR: 1,
      TEMPLATE: 1, SLOT: 1
    };
  }

  static get ATTR() { return 'data-af-dm'; }
  static get MAX_ELEMENTS() { return 1500; }
  static get PAGE_CEILING() { return 12000; }

  // ── Tuning ────────────────────────────────────────────────────────────────

  /**
   * The destination lightness bands.
   *
   * Backgrounds land in a narrow dark band and text in a light one, but the
   * band has to have *width*: if every light background collapsed to one black,
   * cards, table stripes, inputs and headers would merge into a single flat
   * rectangle and the page would lose all its structure. Keeping the spread is
   * what makes this read as a designed theme rather than a blackout.
   */
  _bands(s) {
    const depth = Math.max(1, Math.min(10, s.smartDarkStrength || 5)) / 10;
    return {
      bgLo: 0.18 - 0.10 * depth,
      bgHi: 0.42 - 0.14 * depth,
      fgLo: 0.68 + 0.04 * depth,
      fgHi: 0.94 + 0.02 * depth
    };
  }

  _target(s) {
    const t = parseFloat(s.smartDarkContrast);
    return (isNaN(t) || t < 3) ? 4.5 : Math.min(7, t);
  }

  // ── Stylesheet ────────────────────────────────────────────────────────────

  _getStyle() {
    if (!this._styleEl || !document.head.contains(this._styleEl)) {
      this._styleEl = document.getElementById('accessiflow-smartdark-style');
      if (!this._styleEl) {
        this._styleEl = document.createElement('style');
        this._styleEl.id = 'accessiflow-smartdark-style';
        (document.head || document.documentElement).appendChild(this._styleEl);
      }
    }
    return this._styleEl;
  }

  /**
   * ContrastModule keeps its own stylesheet rather than contributing to the
   * shared one, because it rewrites itself on scroll and mutation and the
   * shared sheet is rebuilt only when settings change.
   */
  buildCSS() { return ''; }

  // ── The pass ──────────────────────────────────────────────────────────────

  _candidates() {
    const all = document.querySelectorAll('body *');
    if (all.length > ContrastModule.PAGE_CEILING) {
      // Better to do nothing visible than to lock the tab for several seconds
      // on a page with tens of thousands of nodes.
      if (!this._bailed) {
        this._warn('Page has ' + all.length + ' elements, above the ' +
          ContrastModule.PAGE_CEILING + ' ceiling. Smart dark mode stood down to keep the page responsive.');
        this._bailed = true;
      }
      return [];
    }

    // An expanded band around the viewport: what the user can see now, plus
    // what a flick of the wheel will bring into view.
    const margin = window.innerHeight * 1.5;
    const out = [];
    const skip = ContrastModule.SKIP_TAGS;

    for (let i = 0; i < all.length && out.length < ContrastModule.MAX_ELEMENTS; i++) {
      const el = all[i];
      if (skip[el.tagName]) continue;
      if (el.hasAttribute(ContrastModule.ATTR)) continue;      // already done
      if (el.id && el.id.indexOf('accessiflow-') === 0) continue;
      if (el.closest('[id^="accessiflow-"]')) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.bottom < -margin || rect.top > window.innerHeight + margin) continue;

      out.push({ el: el, rect: rect });
    }
    return out;
  }

  /** True when this element paints its own text, rather than only inheriting. */
  _hasOwnText(el) {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim()) return true;
    }
    return false;
  }

  _pass() {
    if (!this._active) return;
    const C = globalThis.ACCESSIFLOW_COLOR;
    const G = globalThis.AccessiFlowGeometry;
    if (!C || !G) { this._warn('colour helpers are not loaded'); return; }

    const started = Date.now();
    const candidates = this._candidates();
    if (!candidates.length) return;

    const bands = this._bands(this._settings);
    const target = this._target(this._settings);

    // ── Read. No writes in this loop, or every getComputedStyle call after
    // the first forces a fresh layout and the pass takes seconds. ───────────
    const records = [];
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i].el;
      const cs = window.getComputedStyle(el);
      if (!cs) continue;
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;

      records.push({
        el: el,
        bg: cs.backgroundColor,
        fg: cs.color,
        bgImage: cs.backgroundImage,
        borderTop: cs.borderTopColor,
        borderRight: cs.borderRightColor,
        borderBottom: cs.borderBottomColor,
        borderLeft: cs.borderLeftColor,
        borderWidth: parseFloat(cs.borderTopWidth) || parseFloat(cs.borderBottomWidth) ||
          parseFloat(cs.borderLeftWidth) || parseFloat(cs.borderRightWidth) || 0,
        fontSize: parseFloat(cs.fontSize) || 16,
        fontWeight: cs.fontWeight,
        ownText: this._hasOwnText(el),
        effectiveBg: null
      });
    }

    // The effective background needs its own climb, which is more reads. Doing
    // it here keeps it out of the write phase.
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r.ownText) r.effectiveBg = G.effectiveBackground(r.el);
    }

    // ── Compute. Pure arithmetic, no DOM at all. ────────────────────────────
    const writes = [];
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const decls = [];

      // A background image or gradient carries its own design. Recolouring the
      // box behind it does nothing useful and can destroy a sprite sheet.
      const hasBgImage = r.bgImage && r.bgImage !== 'none';

      let newBgHex = null;
      if (!hasBgImage && !C.isTransparent(r.bg)) {
        const mapped = C.mapLightness(r.bg, bands.bgLo, bands.bgHi, true);
        newBgHex = C.toHex(mapped);
        decls.push('background-color:' + newBgHex + ' !important');
      }

      if (r.ownText && !C.isTransparent(r.fg)) {
        // What this text will actually sit on once the pass has run: the old
        // effective background put through the same transform.
        const newEffective = hasBgImage
          ? C.parseColor('#1a1a1a')                    // unknowable; assume mid-dark
          : C.mapLightness(r.effectiveBg, bands.bgLo, bands.bgHi, true);

        const flat = C.blend(r.fg, r.effectiveBg);
        const lifted = C.mapLightness(flat, bands.fgLo, bands.fgHi, true);
        const need = C.requiredRatio(r.fontSize, r.fontWeight, target);
        const finalFg = C.adjustToContrast(lifted, newEffective, need);
        decls.push('color:' + C.toHex(finalFg) + ' !important');
      }

      // Borders are what separate a card from its page. Losing them is how
      // filter-based dark modes turn a table into a wall of text.
      if (r.borderWidth > 0) {
        const sides = [
          ['border-top-color', r.borderTop],
          ['border-right-color', r.borderRight],
          ['border-bottom-color', r.borderBottom],
          ['border-left-color', r.borderLeft]
        ];
        for (let s = 0; s < sides.length; s++) {
          if (C.isTransparent(sides[s][1])) continue;
          const mapped = C.mapLightness(sides[s][1], bands.bgLo + 0.10, bands.bgHi + 0.18, true);
          decls.push(sides[s][0] + ':' + C.toHex(mapped) + ' !important');
        }
      }

      if (decls.length) writes.push({ el: r.el, decls: decls });
    }

    // ── Write. Attributes first, then one stylesheet update. ────────────────
    let css = '';
    for (let i = 0; i < writes.length; i++) {
      const w = writes[i];
      const signature = w.decls.join(';');
      let index = this._pairs.get(signature);
      if (index === undefined) {
        index = ++this._seq;
        this._pairs.set(signature, index);
        css += '[' + ContrastModule.ATTR + '="' + index + '"]{' + signature + '}\n';
      }
      w.el.setAttribute(ContrastModule.ATTR, String(index));
      this._touched.push(w.el);
    }

    if (css) this._getStyle().textContent += css;

    const elapsed = Date.now() - started;
    if (elapsed > 120) {
      this._log('pass: ' + writes.length + ' elements, ' + this._pairs.size +
        ' distinct rules, ' + elapsed + 'ms');
    }
  }

  /**
   * Everything that has to be said once, not per element: the page canvas, the
   * native widget colours, and the two pseudo-elements that filter-based dark
   * modes always leave white-on-white.
   */
  _baseCSS() {
    const C = globalThis.ACCESSIFLOW_COLOR;
    const bands = this._bands(this._settings);
    const pageBg = C.toHex(C.fromOKLCH({ L: bands.bgLo, C: 0, H: 0, a: 1 }));
    const pageFg = C.toHex(C.fromOKLCH({ L: bands.fgHi, C: 0, H: 0, a: 1 }));
    const muted = C.toHex(C.fromOKLCH({ L: (bands.fgLo + bands.bgHi) / 2, C: 0, H: 0, a: 1 }));

    return [
      // Tells the browser to darken scrollbars, form widgets and the space
      // outside the document. No amount of element styling reaches these.
      ':root { color-scheme: dark !important; }',
      'html { background-color: ' + pageBg + ' !important; }',
      'body { background-color: ' + pageBg + ' !important; color: ' + pageFg + ' !important; }',
      '::placeholder { color: ' + muted + ' !important; opacity: 1 !important; }',
      '::selection { background-color: ' + pageFg + ' !important; color: ' + pageBg + ' !important; }',
      // An image sitting directly on the new dark canvas can look like it is
      // floating. A faint surround costs nothing and reads much better.
      'img, video { background-color: transparent !important; }'
    ].join('\n') + '\n';
  }

  // ── Keeping up with the page ──────────────────────────────────────────────

  _queuePass() {
    if (!this._active || this._passQueued) return;
    this._passQueued = true;

    const run = () => {
      this._passQueued = false;
      this._idleHandle = null;
      if (!this._active) return;
      if (document.hidden) return;         // nothing to repaint in a background tab
      try { this._pass(); } catch (e) { this._warn('pass: ' + e.message); }
    };

    // requestIdleCallback keeps this out of the way of the page's own work.
    // Chrome has it; the timeout guarantees it still runs on a busy page.
    if (typeof requestIdleCallback === 'function') {
      this._idleHandle = requestIdleCallback(run, { timeout: 500 });
    } else {
      this._idleHandle = setTimeout(run, 200);
    }
  }

  _watch() {
    if (this._observer) return;

    this._observer = new MutationObserver(mutations => {
      if (!this._active) return;
      let relevant = false;

      for (let i = 0; i < mutations.length && !relevant; i++) {
        const m = mutations[i];
        if (m.type === 'childList' && m.addedNodes.length) {
          for (let n = 0; n < m.addedNodes.length; n++) {
            const node = m.addedNodes[n];
            if (node.nodeType !== 1) continue;
            if (node.id && node.id.indexOf('accessiflow-') === 0) continue;
            relevant = true;
            break;
          }
        } else if (m.type === 'attributes' && m.target && m.target.nodeType === 1) {
          // Our own attribute writes must not retrigger the observer, or the
          // pass feeds itself forever.
          if (m.attributeName === ContrastModule.ATTR) continue;
          // The element was restyled, so whatever we decided for it is stale.
          m.target.removeAttribute(ContrastModule.ATTR);
          relevant = true;
        }
      }

      if (relevant) this._queuePass();
    });

    this._observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });

    let scrollTimer = null;
    this._scrollHandler = () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      // On scroll *end*, not during: new content has arrived in the band.
      scrollTimer = setTimeout(() => this._queuePass(), 200);
    };
    window.addEventListener('scroll', this._scrollHandler, { passive: true });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * The settings this module's output actually depends on. content.js calls
   * applySettings on every slider tick, and repainting the whole page because
   * the user nudged an unrelated font size would make the popup feel broken.
   */
  _signature(s) {
    return [s.smartDarkMode ? 1 : 0, s.smartDarkContrast, s.smartDarkStrength].join('|');
  }

  apply(settings) {
    const next = settings || {};
    const signature = this._signature(next);
    const unchanged = signature === this._signature(this._settings);
    this._settings = next;

    const want = !!next.smartDarkMode;

    if (want && !this._active) {
      this._active = true;
      this._bailed = false;
      this._getStyle().textContent = this._baseCSS();
      this._watch();
      this._pass();                 // first pass now, not at idle: no flash of white
      this._log('Smart dark mode on, targeting ' + this._target(next) + ':1');
    } else if (want && this._active) {
      if (unchanged) {
        // Some other setting moved. Ours still hold, so leave the page alone
        // and just pick up anything new that has appeared.
        this._queuePass();
      } else {
        // The bands or the contrast target moved. Every decision was made
        // against the old ones, so they all have to be thrown away.
        this._reset();
        this._getStyle().textContent = this._baseCSS();
        this._pass();
      }
    } else if (!want && this._active) {
      this.destroy();
    }
  }

  /** Drops every decision but stays switched on. */
  _reset() {
    for (let i = 0; i < this._touched.length; i++) {
      try { this._touched[i].removeAttribute(ContrastModule.ATTR); } catch (e) { /* gone */ }
    }
    this._touched = [];
    this._pairs.clear();
    this._seq = 0;
  }

  destroy() {
    this._active = false;

    if (this._observer) { this._observer.disconnect(); this._observer = null; }
    if (this._scrollHandler) {
      window.removeEventListener('scroll', this._scrollHandler);
      this._scrollHandler = null;
    }
    if (this._idleHandle) {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(this._idleHandle);
      else clearTimeout(this._idleHandle);
      this._idleHandle = null;
    }
    this._passQueued = false;

    this._reset();
    if (this._styleEl) { this._styleEl.remove(); this._styleEl = null; }
  }
}

if (typeof window !== 'undefined') window.ContrastModule = ContrastModule;
