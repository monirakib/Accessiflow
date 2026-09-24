// AccessiFlow VisionModule
// Text size, line height, letter spacing, contrast, dark mode, color filters, etc.
'use strict';

class VisionModule {
  constructor() {
    this._styleEl = null;
    this._readingGuide = null;
    this._readingGuideHandler = null;
    this._focusModeHandlers = { focusin: null, focusout: null };
    this._highlightLinksObserver = null;
    this._hiddenImages = [];
    this._svgFilterEl = null;
    this._originalOutlines = new Map();
    // New features
    this._magnifierEl = null;
    this._magnifierHandler = null;
    this._bionicApplied = false;
    this._bionicOriginals = [];
    this._lineNumberEls = [];
    this._saturationApplied = false;
  }

  _log(msg) { console.log('[AccessiFlow][Vision] ' + msg); }
  _warn(msg) { console.warn('[AccessiFlow][Vision] ' + msg); }

  // ── Shared style element ──────────────────────────────────
  _getStyle() {
    if (!this._styleEl || !document.head.contains(this._styleEl)) {
      this._styleEl = document.getElementById('accessiflow-vision-style');
      if (!this._styleEl) {
        this._styleEl = document.createElement('style');
        this._styleEl.id = 'accessiflow-vision-style';
        document.head.appendChild(this._styleEl);
      }
    }
    return this._styleEl;
  }

  _updateCSS(rules) {
    try {
      this._getStyle().textContent = rules;
    } catch (e) { this._warn('_updateCSS: ' + e.message); }
  }

  // Build CSS string from all active settings
  buildCSS(s) {
    let css = '';
    try {
      // 1. Text size
      if (s.textSize && s.textSize !== 100) {
        css += 'html { font-size: ' + s.textSize + '% !important; }\n';
      }
      // 2. Line height
      if (s.lineHeight && s.lineHeight !== 1.5) {
        css += '* { line-height: ' + s.lineHeight + ' !important; }\n';
      }
      // 3. Letter spacing
      if (s.letterSpacing && s.letterSpacing > 0) {
        css += '* { letter-spacing: ' + s.letterSpacing + 'px !important; }\n';
      }
      // 4. High contrast
      if (s.highContrast) {
        // The filter itself goes into the shared chain below, so it composes
        // with dark mode and the colour-blindness filters instead of being
        // silently overwritten by whichever rule happens to come last.
        css += 'body { background: #fff !important; color: #000 !important; }\n';
        css += 'a, a:visited { color: #0000EE !important; }\n';
      }
      // 5. Dark mode
      if (s.darkMode && !s.smartDarkMode) {
        css += 'html img, html video, html canvas, html [style*="background-image"] { filter: invert(1) hue-rotate(180deg) !important; }\n';
        css += 'html svg[aria-hidden="true"] { filter: none !important; }\n';
      }
      // 6. Invert colors
      if (s.invertColors && !s.smartDarkMode) {
        css += 'html img, html video, html canvas { filter: invert(1) !important; }\n';
      }
      // 7. Dyslexia font
      if (s.dyslexiaFont) {
        css += "@font-face { font-family: 'OpenDyslexic'; src: url('https://cdn.jsdelivr.net/npm/open-dyslexic@1.0.3/woff/OpenDyslexic-Regular.woff') format('woff'); font-weight: normal; font-style: normal; }\n";
        css += "* { font-family: 'OpenDyslexic', sans-serif !important; word-spacing: 0.1em !important; }\n";
      }
      // 8. Highlight links
      if (s.highlightLinks) {
        css += 'a, a:visited { text-decoration: underline !important; text-decoration-color: #4fffb0 !important; text-underline-offset: 3px !important; background-color: rgba(79,255,176,0.12) !important; outline: 1px dashed #4fffb0 !important; }\n';
      }
      // 9. Hide images (CSS part)
      if (s.hideImages) {
        css += 'img { visibility: hidden !important; }\n';
      }
      // 10. Color filter
      // The colour-blindness filter joins the shared chain; applyColorFilter()
      // still injects the SVG colour matrix that the url() points at.
      // 11. Font family
      if (s.fontFamily && s.fontFamily !== 'default') {
        const f = s.fontFamily === 'OpenDyslexic' ? "'OpenDyslexic', sans-serif" : "'" + s.fontFamily + "', sans-serif";
        if (s.fontFamily === 'OpenDyslexic' && !s.dyslexiaFont) {
          css += "@font-face { font-family: 'OpenDyslexic'; src: url('https://cdn.jsdelivr.net/npm/open-dyslexic@1.0.3/woff/OpenDyslexic-Regular.woff') format('woff'); font-weight: normal; font-style: normal; }\n";
        }
        css += '* { font-family: ' + f + ' !important; }\n';
      }
      // 13. Focus mode (CSS only part)
      // 14. Bionic reading
      if (s.bionicReading) {
        css += '.accessiflow-bionic b { font-weight: 700 !important; }\n';
      }
      // 15. Line numbering
      if (s.lineNumbering) {
        css += '.accessiflow-line-number { position: absolute; left: -40px; color: #666; font-size: 11px; font-family: "Space Mono", monospace; user-select: none; pointer-events: none; }\n';
        css += 'p, li, dd, blockquote { position: relative !important; margin-left: 50px !important; }\n';
      }
      // 16. SVG / icon scaling
      if (s.iconScaling && s.iconScaling > 1) {
        // Icons only. `[class*="icon"]` also caught containers such as a
        // "lexicon" section or an "iconic-header" bar, and scaled whole
        // regions of the page up over each other.
        css += 'svg:not(:root), img[src$=".svg"], i[class*="icon"], span[class*="icon"]:empty, .icon, [class^="icon-"], ' +
          '[class*=" icon-"], .material-icons, .material-symbols-outlined, i.fa, i[class*="fa-"] ' +
          '{ transform: scale(' + s.iconScaling + ') !important; transform-origin: center !important; }\n';
      }
      // 17. Saturation control

      // 18. Text alignment
      if (s.textAlign && s.textAlign !== 'default') {
        css += 'p, li, td, th, div, span, h1, h2, h3, h4, h5, h6 { text-align: ' + s.textAlign + ' !important; }\n';
      }
      // 19. Word spacing
      if (s.wordSpacing && s.wordSpacing > 0) {
        css += '* { word-spacing: ' + s.wordSpacing + 'px !important; }\n';
      }
      // One filter rule, assembled from every setting that asked for one.
      const chain = VisionModule.filterChain(s);
      if (chain.length) css += 'html { filter: ' + chain.join(' ') + ' !important; }\n';
    } catch (e) { this._warn('buildCSS: ' + e.message); }
    return css;
  }

  /**
   * Every page-wide filter the settings ask for, as one ordered list.
   *
   * These used to be six separate `html { filter: ... }` rules concatenated
   * into a single stylesheet, which meant the last one silently won and the
   * rest did nothing: turning on a colour-blindness filter quietly cancelled
   * dark mode, and the colour-strength slider cancelled both. CSS filters
   * compose only when they share one declaration, so that is where they belong.
   *
   * Static, so NeuroModule can hand over its colour themes without either
   * module reaching into the other.
   */
  static filterChain(s) {
    const chain = [];
    if (!s) return chain;

    // Smart dark mode recolours the DOM element by element and has already
    // proved each contrast ratio. Filtering the result would invalidate every
    // one of those calculations, so nothing else is allowed on top of it.
    if (s.smartDarkMode) {
      if (s.colorFilter && s.colorFilter !== 'none') {
        chain.push('url(#accessiflow-filter-' + s.colorFilter + ')');
      }
      return chain;
    }

    if (s.highContrast) chain.push('contrast(1.4)', 'brightness(1.1)');
    if (s.darkMode) chain.push('invert(0.9)', 'hue-rotate(180deg)');
    if (s.invertColors) chain.push('invert(1)');

    const themes = {
      calm: ['saturate(0.6)', 'brightness(1.05)'],
      warm: ['sepia(0.2)', 'brightness(1.02)'],
      cool: ['hue-rotate(10deg)', 'saturate(0.8)', 'brightness(1.02)'],
      muted: ['saturate(0.4)', 'brightness(0.95)'],
      pastel: ['saturate(0.5)', 'brightness(1.1)', 'contrast(0.9)']
    };
    if (s.neuroColorTheme && themes[s.neuroColorTheme]) {
      Array.prototype.push.apply(chain, themes[s.neuroColorTheme]);
    }

    if (s.saturation !== undefined && s.saturation !== 100) {
      chain.push('saturate(' + (s.saturation / 100) + ')');
    }

    // A url() filter is a full colour-matrix remap. It goes last so it sees
    // the result of everything else rather than the untouched page.
    if (s.colorFilter && s.colorFilter !== 'none') {
      chain.push('url(#accessiflow-filter-' + s.colorFilter + ')');
    }
    return chain;
  }

  // ── 9. Hide images (DOM manipulation) ─────────────────────
  applyHideImages(active) {
    try {
      if (active) {
        document.querySelectorAll('img:not([data-accessiflow-hidden])').forEach(img => {
          try {
            const w = img.offsetWidth || img.naturalWidth || 100;
            const h = img.offsetHeight || img.naturalHeight || 60;
            const placeholder = document.createElement('div');
            placeholder.setAttribute('aria-hidden', 'true');
            placeholder.setAttribute('data-accessiflow-placeholder', 'true');
            placeholder.style.cssText = 'width:' + w + 'px;height:' + h + 'px;display:inline-flex;align-items:center;justify-content:center;background:#1a1a2e;color:#aaa;font-size:12px;border:1px dashed #444;box-sizing:border-box;';
            placeholder.textContent = '[Image Hidden]';
            img.setAttribute('data-accessiflow-hidden', 'true');
            img.parentNode.insertBefore(placeholder, img.nextSibling);
            this._hiddenImages.push({ img, placeholder });
          } catch (e) { /* skip */ }
        });
      } else {
        this._hiddenImages.forEach(({ img, placeholder }) => {
          try {
            img.removeAttribute('data-accessiflow-hidden');
            if (placeholder.parentNode) placeholder.remove();
          } catch (e) { /* skip */ }
        });
        this._hiddenImages = [];
      }
    } catch (e) { this._warn('applyHideImages: ' + e.message); }
  }

  // ── 10. Color filter SVG injection ────────────────────────
  applyColorFilter(type) {
    try {
      // Remove existing
      const existing = document.getElementById('accessiflow-svg-filters');
      if (existing) existing.remove();

      if (!type || type === 'none') return;

      const matrices = {
        protanopia: '0.567 0.433 0 0 0 0.558 0.442 0 0 0 0 0.242 0.758 0 0 0 0 0 1 0',
        deuteranopia: '0.625 0.375 0 0 0 0.7 0.3 0 0 0 0 0.3 0.7 0 0 0 0 0 1 0',
        tritanopia: '0.95 0.05 0 0 0 0 0.433 0.567 0 0 0 0.475 0.525 0 0 0 0 0 1 0',
        achromatopsia: '0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0 0 0 1 0'
      };

      if (!matrices[type]) return;

      const svgNs = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNs, 'svg');
      svg.id = 'accessiflow-svg-filters';
      svg.setAttribute('aria-hidden', 'true');
      svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';

      const defs = document.createElementNS(svgNs, 'defs');
      const filter = document.createElementNS(svgNs, 'filter');
      filter.id = 'accessiflow-filter-' + type;
      const matrix = document.createElementNS(svgNs, 'feColorMatrix');
      matrix.setAttribute('type', 'matrix');
      matrix.setAttribute('values', matrices[type]);
      filter.appendChild(matrix);
      defs.appendChild(filter);
      svg.appendChild(defs);
      document.body.appendChild(svg);
    } catch (e) { this._warn('applyColorFilter: ' + e.message); }
  }

  // ── 12. Reading guide ─────────────────────────────────────
  applyReadingGuide(active) {
    try {
      if (active) {
        if (this._readingGuide) return;
        const guide = document.createElement('div');
        guide.id = 'accessiflow-reading-guide';
        guide.setAttribute('aria-hidden', 'true');
        guide.style.cssText = 'position:fixed;left:0;width:100%;height:40px;top:50%;pointer-events:none;z-index:2147483646;background:rgba(79,255,176,0.1);border-top:2px solid rgba(79,255,176,0.5);border-bottom:2px solid rgba(79,255,176,0.5);transition:top 0.05s linear;';
        document.body.appendChild(guide);
        this._readingGuide = guide;

        this._readingGuideHandler = (e) => {
          guide.style.top = (e.clientY - 20) + 'px';
        };
        document.addEventListener('mousemove', this._readingGuideHandler);
      } else {
        if (this._readingGuide) {
          this._readingGuide.remove();
          this._readingGuide = null;
        }
        if (this._readingGuideHandler) {
          document.removeEventListener('mousemove', this._readingGuideHandler);
          this._readingGuideHandler = null;
        }
      }
    } catch (e) { this._warn('applyReadingGuide: ' + e.message); }
  }

  // ── 13. Focus mode ────────────────────────────────────────
  // Dim everything else: the page darkened around the block of text under
  // the pointer, or the thing the keyboard is on. It used to put a glow round
  // the focused control and dim nothing, whatever the setting said.
  applyFocusMode(active) {
    try {
      if (active) {
        if (this._focusSpot) return;
        const Overlay = window.AccessiFlowOverlay;
        if (!Overlay) { this._warn('overlay primitive not loaded'); return; }
        this._focusSpot = new Overlay({ id: 'accessiflow-focus-spot', padding: 8 });
        this._focusSpot.cutout({ dim: 0.6, radius: 8, feather: 10 });

        const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, dd, dt, figure, figcaption, label, ' +
          'button, a, input, select, textarea, summary, [role="button"], [role="link"]';
        const blockAt = el => {
          for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
            if (n.id && String(n.id).indexOf('accessiflow-') === 0) return null;
            if (!n.matches || !n.matches(BLOCK)) continue;
            const r = n.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) continue;
            // Not something the size of the page.
            if (r.height > window.innerHeight * 0.8 && r.width > window.innerWidth * 0.8) return null;
            return n;
          }
          return null;
        };
        let pending = null;
        let target = null;
        const show = el => {
          if (!el) return;
          target = el;
          if (!this._focusSpot.follow(el)) this._focusSpot.hide();
        };
        this._focusModeHandlers.move = e => {
          pending = e.target;
          if (this._focusModeFrame) return;
          this._focusModeFrame = requestAnimationFrame(() => {
            this._focusModeFrame = null;
            const el = blockAt(pending);
            if (el && el !== target) show(el);
          });
        };
        this._focusModeHandlers.focusin = e => {
          const el = e.target && e.target.nodeType === 1 && !(e.target.id && String(e.target.id).indexOf('accessiflow-') === 0) ? e.target : null;
          if (el && el !== document.body) show(el);
        };
        document.addEventListener('mouseover', this._focusModeHandlers.move, { passive: true });
        document.addEventListener('focusin', this._focusModeHandlers.focusin);
      } else {
        if (this._focusModeHandlers.move) {
          document.removeEventListener('mouseover', this._focusModeHandlers.move);
          document.removeEventListener('focusin', this._focusModeHandlers.focusin);
          this._focusModeHandlers = { focusin: null, focusout: null };
        }
        if (this._focusModeFrame) { cancelAnimationFrame(this._focusModeFrame); this._focusModeFrame = null; }
        if (this._focusSpot) { this._focusSpot.destroy(); this._focusSpot = null; }
      }
    } catch (e) { this._warn('applyFocusMode: ' + e.message); }
  }

  // ── 14. Magnifier Lens ─────────────────────────────────────
  applyMagnifier(active, zoom) {
    try {
      if (active) {
        if (this._magnifierEl) return;
        const magnifierSize = 180;
        const zoomLevel = zoom || 2;

        const lens = document.createElement('div');
        lens.id = 'accessiflow-magnifier';
        lens.setAttribute('aria-hidden', 'true');
        lens.style.cssText = 'position:fixed;width:' + magnifierSize + 'px;height:' + magnifierSize + 'px;border-radius:50%;border:3px solid #4fffb0;box-shadow:0 0 20px rgba(0,0,0,0.5);overflow:hidden;pointer-events:none;z-index:2147483646;display:none;background:#fff;';

        const content = document.createElement('div');
        content.id = 'accessiflow-magnifier-content';
        content.style.cssText = 'position:absolute;width:' + (magnifierSize * zoomLevel) + 'px;height:' + (magnifierSize * zoomLevel) + 'px;transform-origin:center;';
        lens.appendChild(content);
        document.body.appendChild(lens);
        this._magnifierEl = lens;

        this._magnifierHandler = (e) => {
          const x = e.clientX;
          const y = e.clientY;
          lens.style.display = 'block';
          lens.style.left = (x + 20) + 'px';
          lens.style.top = (y + 20) + 'px';

          // Clone area under cursor
          const el = document.elementFromPoint(x, y);
          if (el && el !== lens) {
            try {
              content.innerHTML = '';
              const clone = el.cloneNode(true);
              clone.style.transform = 'scale(' + zoomLevel + ')';
              clone.style.transformOrigin = 'top left';
              clone.style.pointerEvents = 'none';
              content.appendChild(clone);
            } catch (err) { /* skip */ }
          }
        };
        document.addEventListener('mousemove', this._magnifierHandler);
      } else {
        if (this._magnifierEl) { this._magnifierEl.remove(); this._magnifierEl = null; }
        if (this._magnifierHandler) { document.removeEventListener('mousemove', this._magnifierHandler); this._magnifierHandler = null; }
      }
    } catch (e) { this._warn('applyMagnifier: ' + e.message); }
  }

  // ── 15. Bionic Reading ────────────────────────────────────
  applyBionicReading(active) {
    try {
      if (active) {
        if (this._bionicApplied) return;
        this._bionicApplied = true;

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => {
            if (!node.parentElement) return NodeFilter.FILTER_REJECT;
            if (node.parentElement.matches('script, style, noscript, code, pre, input, textarea, .accessiflow-bionic')) return NodeFilter.FILTER_REJECT;
            if (node.textContent.trim().length < 3) return NodeFilter.FILTER_SKIP;
            return NodeFilter.FILTER_ACCEPT;
          }
        });

        const nodes = [];
        let n;
        while ((n = walker.nextNode())) nodes.push(n);

        nodes.forEach(textNode => {
          try {
            const text = textNode.textContent;
            const words = text.split(/(\s+)/);
            const span = document.createElement('span');
            span.className = 'accessiflow-bionic';
            span.setAttribute('data-accessiflow-bionic', 'true');

            words.forEach(word => {
              if (/^\s+$/.test(word)) {
                span.appendChild(document.createTextNode(word));
                return;
              }
              const mid = Math.ceil(word.length / 2);
              const bold = document.createElement('b');
              bold.textContent = word.substring(0, mid);
              span.appendChild(bold);
              span.appendChild(document.createTextNode(word.substring(mid)));
            });

            textNode.parentNode.replaceChild(span, textNode);
            this._bionicOriginals.push({ span, originalText: text });
          } catch (err) { /* skip */ }
        });
      } else {
        this._bionicOriginals.forEach(({ span, originalText }) => {
          try {
            const text = document.createTextNode(originalText);
            if (span.parentNode) span.parentNode.replaceChild(text, span);
          } catch (err) { /* skip */ }
        });
        this._bionicOriginals = [];
        this._bionicApplied = false;
      }
    } catch (e) { this._warn('applyBionicReading: ' + e.message); }
  }

  // ── 16. Line Numbering ────────────────────────────────────
  applyLineNumbering(active) {
    try {
      if (active) {
        let lineNum = 1;
        document.querySelectorAll('p, li, dd, blockquote').forEach(el => {
          if (el.getAttribute('data-accessiflow-line-num')) return;
          el.setAttribute('data-accessiflow-line-num', lineNum);
          const num = document.createElement('span');
          num.className = 'accessiflow-line-number';
          num.setAttribute('aria-hidden', 'true');
          num.textContent = lineNum;
          // Positioned by the stylesheet while this is on; writing it on the
          // element as well left every paragraph changed after it was off.
          el.insertBefore(num, el.firstChild);
          this._lineNumberEls.push({ el, num });
          lineNum++;
        });
      } else {
        this._lineNumberEls.forEach(({ el, num }) => {
          try {
            el.removeAttribute('data-accessiflow-line-num');
            num.remove();
          } catch (err) { /* skip */ }
        });
        this._lineNumberEls = [];
      }
    } catch (e) { this._warn('applyLineNumbering: ' + e.message); }
  }

  // ── Apply all settings ────────────────────────────────────
  apply(settings) {
    try {
      const css = this.buildCSS(settings);
      this._updateCSS(css);
      this.applyColorFilter(settings.colorFilter);
      // The reading mask draws its own lens over the line being read. Three
      // separate overlays chasing the same pointer is what the Reading panel
      // used to do, and they visibly fought each other.
      this.applyReadingGuide(!!settings.readingGuide && !settings.readingMask);
      this.applyFocusMode(!!settings.focusMode);
      this.applyHideImages(!!settings.hideImages);
      this.applyMagnifier(!!settings.magnifier, settings.magnifierZoom || 2);
      this.applyBionicReading(!!settings.bionicReading);
      this.applyLineNumbering(!!settings.lineNumbering);
    } catch (e) { this._warn('apply: ' + e.message); }
  }

  destroy() {
    try {
      if (this._styleEl) { this._styleEl.remove(); this._styleEl = null; }
      this.applyReadingGuide(false);
      this.applyFocusMode(false);
      this.applyHideImages(false);
      this.applyMagnifier(false);
      this.applyBionicReading(false);
      this.applyLineNumbering(false);
      const svgF = document.getElementById('accessiflow-svg-filters');
      if (svgF) svgF.remove();
    } catch (e) { this._warn('destroy: ' + e.message); }
  }
}

if (typeof window !== 'undefined') window.VisionModule = VisionModule;
