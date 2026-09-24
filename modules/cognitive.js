// AccessiFlow CognitiveModule
// Reading mask, line ruler, simplify page, heading structure, alt text tooltips, pause media
'use strict';

// What a carousel or slider looks like in markup, across the common libraries.
const CAROUSELS = '[aria-roledescription="carousel" i], [class*="carousel" i], [class*="slider" i], ' +
  '[class*="slideshow" i], [class*="swiper" i], [class*="slick" i], [class*="splide" i], [class*="glide" i]';

class CognitiveModule {
  constructor() {
    this._styleEl = null;
    this._maskLens = null;
    this._maskLocked = false;
    this._maskKeyHandler = null;
    this._maskHandler = null;
    this._lineRuler = null;
    this._lineRulerHandler = null;
    this._simplifiedEls = [];
    this._tooltipEl = null;
    this._tooltipHandlers = { over: null, out: null, move: null };
    this._mediaObserver = null;
    this._pausedMedia = [];
    // New features
    this._dictionaryHandler = null;
    this._dictionaryTooltip = null;
    this._progressBar = null;
    this._progressHandler = null;
    this._distractionFreeEls = [];
    this._memoryAidData = {};
    this._memoryAidInputs = [];
    this._breakTimerEl = null;
    this._breakTimerInterval = null;
    this._formStepLabels = [];
    this._activeFieldHighlight = null;
    this._activeFieldHandler = null;
  }

  _log(msg) { console.log('[AccessiFlow][Cognitive] ' + msg); }
  _warn(msg) { console.warn('[AccessiFlow][Cognitive] ' + msg); }

  _getStyle() {
    if (!this._styleEl || !document.head.contains(this._styleEl)) {
      this._styleEl = document.getElementById('accessiflow-cognitive-style');
      if (!this._styleEl) {
        this._styleEl = document.createElement('style');
        this._styleEl.id = 'accessiflow-cognitive-style';
        document.head.appendChild(this._styleEl);
      }
    }
    return this._styleEl;
  }

  buildCSS(s) {
    let css = '';
    try {
      if (s.showHeadings) {
        const colors = { '1': '#9b59b6', '2': '#6366f1', '3': '#3b82f6', '4': '#22d3ee', '5': '#f59e0b', '6': '#ef4444' };
        for (let i = 1; i <= 6; i++) {
          css += 'h' + i + '::before { content: "H' + i + '"; display: inline-block; background: ' + colors[i] + '; color: #fff; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; margin-right: 8px; vertical-align: middle; font-family: system-ui, sans-serif !important; }\n';
        }
      }
      // Distraction-free mode
      if (s.distractionFree) {
        css += 'aside, .sidebar, [class*="sidebar"], [class*="ad"], [class*="social"], [class*="share"], [class*="related"], [class*="recommend"], [class*="popup"], [class*="modal"], [class*="banner"], footer, [class*="footer"], [class*="comment"], [class*="widget"] { display: none !important; }\n';
        css += 'main, article, [role="main"] { max-width: 700px !important; margin: 0 auto !important; padding: 20px !important; }\n';
        css += 'body { background: #fefefe !important; }\n';
      }
      // Reading progress bar
      if (s.readingProgress) {
        css += '#accessiflow-progress-bar { position:fixed;top:0;left:0;height:4px;background:linear-gradient(90deg,#4fffb0,#6366f1);z-index:2147483647;transition:width 0.15s ease;pointer-events:none; }\n';
      }
      // Active form field highlight
      // Yields to the focus halo, which already draws a ring around whatever
      // has the keyboard. Two rings on one field is noise, not emphasis.
      if (s.activeFieldHighlight && !s.focusHalo) {
        css += 'input:focus, textarea:focus, select:focus { outline:3px solid #4fffb0 !important; outline-offset:2px !important; box-shadow:0 0 0 6px rgba(79,255,176,0.2) !important; background-color: rgba(79,255,176,0.05) !important; }\n';
      }
    } catch (e) { this._warn('buildCSS: ' + e.message); }
    return css;
  }

  // ── 1. Reading mask ───────────────────────────────────────
  // ── 1. Reading mask (cognitive masking) ──────────────────
  //
  // Dims the page except for a lens over what is being read.
  //
  // Three things separate this from the usual version of the idea:
  //
  //   * It snaps to the actual line or sentence under the pointer, found with
  //     caretRangeFromPoint and Range.getClientRects, rather than to a fixed
  //     band of pixels. A fixed band cuts through descenders on one line and
  //     leaves half of the next one showing, which is precisely the ambiguity
  //     a reading mask is supposed to remove.
  //   * The cutout is one element using a very large box-shadow spread, not
  //     two dimming panels with a gap between them. Two panels leave seams,
  //     cannot be rounded, and cannot be softened at the edges.
  //   * It can be locked in place, so reaching for the scrollbar does not
  //     drag the lens away from the sentence being read.
  applyReadingMask(active, settings) {
    try {
      if (active) {
        if (this._maskLens) return;
        const s = settings || {};
        const Overlay = window.AccessiFlowOverlay;
        if (!Overlay) { this._warn('overlay primitive not loaded'); return; }

        this._maskMode = s.maskMode || 'line';
        this._maskDim = s.maskDim === undefined ? 0.75 : s.maskDim;
        this._maskTint = s.maskTint === 'warm' ? '40, 24, 8'
          : s.maskTint === 'cool' ? '8, 20, 40'
            : '0, 0, 0';
        this._maskLocked = false;

        this._maskLens = new Overlay({ id: 'accessiflow-reading-lens', padding: 4 });
        this._maskLens.cutout({ dim: this._maskDim, tint: this._maskTint, radius: 5 });

        this._maskHandler = (e) => {
          if (this._maskLocked) return;
          const rect = this._lineRectAt(e.clientX, e.clientY);
          if (rect) this._maskLens.followRect(rect);
          else this._maskLens.followRect(this._fallbackBand(e.clientY));
        };

        // A lock, so the pointer can leave the text without the lens
        // following it off to a scrollbar or a menu.
        this._maskKeyHandler = (e) => {
          if (!e.altKey || !e.shiftKey) return;
          // K, for keep. L was the obvious letter and is already landmark
          // navigation in BlindModule; this handler runs in the capture phase,
          // so sharing the key would have silently disabled landmarks.
          if (e.code !== 'KeyK') return;
          e.preventDefault();
          e.stopPropagation();
          this._maskLocked = !this._maskLocked;
          this._announceMask(this._maskLocked
            ? 'Reading lens locked in place.'
            : 'Reading lens following the pointer again.');
        };

        document.addEventListener('mousemove', this._maskHandler, { passive: true });
        document.addEventListener('keydown', this._maskKeyHandler, true);

        // Show something immediately rather than waiting for the first move,
        // or switching the setting on appears to do nothing.
        this._maskLens.followRect(this._fallbackBand(window.innerHeight / 2));
      } else {
        if (this._maskHandler) {
          document.removeEventListener('mousemove', this._maskHandler);
          this._maskHandler = null;
        }
        if (this._maskKeyHandler) {
          document.removeEventListener('keydown', this._maskKeyHandler, true);
          this._maskKeyHandler = null;
        }
        if (this._maskLens) { this._maskLens.destroy(); this._maskLens = null; }
        this._maskLocked = false;
      }
    } catch (e) { this._warn('applyReadingMask: ' + e.message); }
  }

  _announceMask(message) {
    try {
      const region = document.getElementById('accessiflow-shortcut-announce');
      if (region) region.textContent = message;
    } catch (e) { /* skip */ }
  }

  /** A plain horizontal strip, for when there is no text under the pointer. */
  _fallbackBand(y) {
    const height = 64;
    return { top: y - height / 2, left: 0, width: window.innerWidth, height: height };
  }

  /**
   * The rectangle of the line, sentence or paragraph under a point.
   *
   * caretRangeFromPoint gives the exact text position; expanding that range
   * and asking for its client rects gives the real geometry of the line box,
   * including its true height for the font in use.
   */
  _lineRectAt(x, y) {
    try {
      const caret = this._caretAt(x, y);
      if (!caret || !caret.node || caret.node.nodeType !== 3) return null;

      const text = caret.node.nodeValue || '';
      if (!text.trim()) return null;

      // Ignore text inside our own furniture.
      const owner = caret.node.parentElement;
      if (!owner || (owner.closest && owner.closest('[id^="accessiflow-"]'))) return null;

      if (this._maskMode === 'paragraph') {
        const block = owner.closest('p, li, dd, blockquote, h1, h2, h3, h4, h5, h6, td, div');
        if (!block) return null;
        const rect = block.getBoundingClientRect();
        return rect.height > 0 ? rect : null;
      }

      const range = document.createRange();
      if (this._maskMode === 'sentence') {
        const bounds = this._sentenceBounds(text, caret.offset);
        range.setStart(caret.node, bounds.start);
        range.setEnd(caret.node, bounds.end);
      } else {
        range.setStart(caret.node, 0);
        range.setEnd(caret.node, text.length);
      }

      // A range spanning several visual lines reports one rect per line.
      // The one containing the pointer is the line being read.
      const rects = range.getClientRects();
      if (!rects || !rects.length) return null;

      let best = null;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.width === 0 || r.height === 0) continue;
        if (y >= r.top - 2 && y <= r.bottom + 2) { best = r; break; }
        if (!best || Math.abs(y - (r.top + r.height / 2)) <
          Math.abs(y - (best.top + best.height / 2))) best = r;
      }
      if (!best) return null;

      // In sentence mode a sentence wrapping across lines should show whole,
      // so the rects are merged rather than one line picked out of them.
      if (this._maskMode === 'sentence' && rects.length > 1) {
        let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          if (r.width === 0 || r.height === 0) continue;
          top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom);
          left = Math.min(left, r.left); right = Math.max(right, r.right);
        }
        if (top < bottom) {
          return { top: top, left: left, width: right - left, height: bottom - top };
        }
      }

      return best;
    } catch (e) {
      return null;
    }
  }

  /** caretRangeFromPoint, or the standards-track equivalent. */
  _caretAt(x, y) {
    if (typeof document.caretRangeFromPoint === 'function') {
      const range = document.caretRangeFromPoint(x, y);
      return range ? { node: range.startContainer, offset: range.startOffset } : null;
    }
    if (typeof document.caretPositionFromPoint === 'function') {
      const position = document.caretPositionFromPoint(x, y);
      return position ? { node: position.offsetNode, offset: position.offset } : null;
    }
    return null;
  }

  /**
   * Where the sentence around an offset starts and ends.
   *
   * The Bangla danda counts as a full stop, so this works on the Bangla pages
   * the extension is partly built for rather than treating a whole paragraph
   * as one sentence.
   */
  _sentenceBounds(text, offset) {
    const TERMINATORS = '.!?।৷';
    let start = 0;
    for (let i = Math.min(offset, text.length) - 1; i >= 0; i--) {
      if (TERMINATORS.indexOf(text[i]) !== -1) { start = i + 1; break; }
    }
    let end = text.length;
    for (let i = offset; i < text.length; i++) {
      if (TERMINATORS.indexOf(text[i]) !== -1) { end = i + 1; break; }
    }
    while (start < end && /\s/.test(text[start])) start++;
    return { start: start, end: end };
  }

  // ── 2. Line ruler ────────────────────────────────────────
  applyLineRuler(active) {
    try {
      if (active) {
        if (this._lineRuler) return;
        this._lineRuler = document.createElement('div');
        this._lineRuler.id = 'accessiflow-line-ruler';
        this._lineRuler.setAttribute('aria-hidden', 'true');
        this._lineRuler.style.cssText = 'position:fixed;left:0;width:100%;height:2px;background:#ffb347;box-shadow:0 0 6px #ffb347;pointer-events:none;z-index:2147483645;top:50%;';
        document.body.appendChild(this._lineRuler);

        this._lineRulerHandler = (e) => {
          this._lineRuler.style.top = e.clientY + 'px';
        };
        document.addEventListener('mousemove', this._lineRulerHandler);
      } else {
        if (this._lineRuler) { this._lineRuler.remove(); this._lineRuler = null; }
        if (this._lineRulerHandler) { document.removeEventListener('mousemove', this._lineRulerHandler); this._lineRulerHandler = null; }
      }
    } catch (e) { this._warn('applyLineRuler: ' + e.message); }
  }

  // ── 3. Simplify page ─────────────────────────────────────
  applySimplifyPage(active) {
    try {
      if (active) {
        const selectors = 'aside, [role="complementary"], .sidebar, .ad, .ads, .advert, [class*="advertisement"], ' +
          '.cookie-banner, .popup, .modal-overlay, .newsletter-signup, .social-share, [class*="share-buttons"], ' +
          '[class*="cookie"], [class*="banner"]:not(header):not([role="banner"]), [class*="promo"], [id*="ad-"], ' +
          '[id^="ad_"], .widget, [class*="sidebar"], [class*="related-posts"], [class*="recommended"]';
        document.querySelectorAll(selectors).forEach(el => {
          try {
            // Don't hide essential elements
            if (el.matches('main, article, [role="main"], nav, header, footer, body, html')) return;
            if (el.closest('[id^="accessiflow-"]')) return;
            // Inside the main content too, as long as it is not the content
            // itself: nothing holding the page's heading or a form. It used
            // to skip everything inside <main>, which on most modern pages is
            // where the sidebars are, so it did nothing at all.
            if (el.querySelector('h1, input:not([type="hidden"]), select, textarea, [role="main"], main, article')) return;
            this._simplifiedEls.push({ el, display: el.style.getPropertyValue('display'), priority: el.style.getPropertyPriority('display') });
            el.style.setProperty('display', 'none', 'important');
          } catch (err) { /* skip */ }
        });
      } else {
        this._simplifiedEls.forEach(({ el, display, priority }) => {
          try {
            if (display) el.style.setProperty('display', display, priority || '');
            else el.style.removeProperty('display');
          } catch (err) { /* skip */ }
        });
        this._simplifiedEls = [];
      }
    } catch (e) { this._warn('applySimplifyPage: ' + e.message); }
  }

  // ── 5. Alt text tooltips ──────────────────────────────────
  applyAltTextTooltips(active) {
    try {
      if (active) {
        if (!this._tooltipEl) {
          this._tooltipEl = document.createElement('div');
          this._tooltipEl.id = 'accessiflow-alt-tooltip';
          this._tooltipEl.setAttribute('aria-hidden', 'true');
          this._tooltipEl.style.cssText = 'position:fixed;max-width:300px;padding:8px 12px;background:#16181f;color:#e0e0e0;border:1px solid #4fffb0;border-radius:6px;font-size:12px;z-index:2147483647;display:none;pointer-events:none;font-family:system-ui,sans-serif;word-wrap:break-word;';
          document.body.appendChild(this._tooltipEl);
        }

        this._tooltipHandlers.over = (e) => {
          const img = e.target.closest('img');
          if (!img) return;
          const alt = img.getAttribute('alt');
          if (alt && alt.trim()) {
            this._tooltipEl.textContent = 'Alt: ' + alt;
            this._tooltipEl.style.borderColor = '#4fffb0';
          } else {
            this._tooltipEl.textContent = '⚠ Missing alt text (WCAG 1.1.1 violation)';
            this._tooltipEl.style.borderColor = '#ef4444';
          }
          this._tooltipEl.style.display = 'block';
        };
        this._tooltipHandlers.out = (e) => {
          if (e.target.closest('img')) {
            this._tooltipEl.style.display = 'none';
          }
        };
        this._tooltipHandlers.move = (e) => {
          if (this._tooltipEl.style.display === 'block') {
            this._tooltipEl.style.left = (e.clientX + 12) + 'px';
            this._tooltipEl.style.top = (e.clientY + 12) + 'px';
          }
        };
        document.addEventListener('mouseover', this._tooltipHandlers.over);
        document.addEventListener('mouseout', this._tooltipHandlers.out);
        document.addEventListener('mousemove', this._tooltipHandlers.move);
      } else {
        if (this._tooltipHandlers.over) {
          document.removeEventListener('mouseover', this._tooltipHandlers.over);
          document.removeEventListener('mouseout', this._tooltipHandlers.out);
          document.removeEventListener('mousemove', this._tooltipHandlers.move);
          this._tooltipHandlers = { over: null, out: null, move: null };
        }
        if (this._tooltipEl) { this._tooltipEl.remove(); this._tooltipEl = null; }
      }
    } catch (e) { this._warn('applyAltTextTooltips: ' + e.message); }
  }

  // ── 6. Pause media ───────────────────────────────────────
  applyPauseMedia(active) {
    try {
      if (active) {
        document.querySelectorAll('video, audio').forEach(m => {
          try { if (!m.paused) { m.pause(); this._pausedMedia.push(m); } } catch (err) { /* skip */ }
        });
        this._mediaObserver = new MutationObserver((muts) => {
          muts.forEach(m => {
            m.addedNodes.forEach(n => {
              if (n.nodeType !== 1) return;
              const medias = n.matches && n.matches('video, audio') ? [n] : (n.querySelectorAll ? Array.from(n.querySelectorAll('video, audio')) : []);
              medias.forEach(media => { try { media.pause(); } catch (err) { /* skip */ } });
            });
          });
        });
        this._mediaObserver.observe(document.body, { childList: true, subtree: true });

        // Carousels and sliders: pressed pause where the page offers one,
        // animation frozen inside them, and old-style marquees stopped. It
        // used to pause only video and sound, whatever the setting said.
        this._stopCarousels();
        if (!this._carouselStyle) {
          this._carouselStyle = document.createElement('style');
          this._carouselStyle.id = 'accessiflow-pause-carousels';
          this._carouselStyle.textContent = CAROUSELS.split(', ').map(sel => sel + ', ' + sel + ' *').join(', ') +
            ' { animation-play-state: paused !important; transition: none !important; scroll-behavior: auto !important; }';
          (document.head || document.documentElement).appendChild(this._carouselStyle);
        }
      } else {
        if (this._mediaObserver) { this._mediaObserver.disconnect(); this._mediaObserver = null; }
        this._pausedMedia = [];
        if (this._carouselStyle) { this._carouselStyle.remove(); this._carouselStyle = null; }
        document.querySelectorAll('marquee').forEach(m => { try { m.start(); } catch (err) { /* skip */ } });
      }
    } catch (e) { this._warn('applyPauseMedia: ' + e.message); }
  }

  _stopCarousels() {
    document.querySelectorAll(CAROUSELS).forEach(el => {
      const pause = el.querySelector('[aria-label*="pause" i], [title*="pause" i], [class*="pause"], button[class*="stop"]');
      if (pause && !pause.closest('[id^="accessiflow-"]')) {
        try { pause.click(); } catch (err) { /* skip */ }
      }
    });
    document.querySelectorAll('marquee').forEach(m => { try { m.stop(); } catch (err) { /* skip */ } });
  }

  // ── 7. Dictionary Tooltips (double-click word) ─────────────
  applyDictionary(active) {
    try {
      if (active) {
        if (this._dictionaryHandler) return;

        if (!this._dictionaryTooltip) {
          this._dictionaryTooltip = document.createElement('div');
          this._dictionaryTooltip.id = 'accessiflow-dictionary';
          this._dictionaryTooltip.setAttribute('role', 'tooltip');
          this._dictionaryTooltip.style.cssText = 'position:fixed;max-width:350px;padding:12px 16px;background:#16181f;color:#e0e0e0;border:2px solid #6366f1;border-radius:10px;font-size:13px;z-index:2147483647;display:none;pointer-events:auto;font-family:system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.5);';
          document.body.appendChild(this._dictionaryTooltip);
        }

        this._dictionaryHandler = (e) => {
          const sel = window.getSelection().toString().trim();
          if (!sel || sel.includes(' ') || sel.length > 30 || sel.length < 2) {
            this._dictionaryTooltip.style.display = 'none';
            return;
          }

          // Show loading
          this._dictionaryTooltip.style.display = 'block';
          this._dictionaryTooltip.style.left = (e.clientX + 10) + 'px';
          this._dictionaryTooltip.style.top = (e.clientY + 10) + 'px';
          this._dictionaryTooltip.innerHTML = '<b style="color:#6366f1">' + sel + '</b><br><span style="color:#888;">Looking up...</span>';

          // Use free dictionary API
          fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(sel))
            .then(r => r.ok ? r.json() : Promise.reject('Not found'))
            .then(data => {
              if (!data || !data[0]) throw new Error('No data');
              const entry = data[0];
              let html = '<b style="color:#6366f1;font-size:15px;">' + entry.word + '</b>';
              if (entry.phonetic) html += ' <span style="color:#888;">' + entry.phonetic + '</span>';
              html += '<br>';
              const meanings = entry.meanings || [];
              meanings.slice(0, 2).forEach(m => {
                html += '<i style="color:#4fffb0;font-size:11px;">' + (m.partOfSpeech || '') + '</i><br>';
                (m.definitions || []).slice(0, 2).forEach(d => {
                  html += '<span style="font-size:12px;">• ' + d.definition + '</span><br>';
                });
              });
              const closeBtn = '<button onclick="this.parentElement.style.display=\'none\'" style="position:absolute;top:4px;right:6px;background:none;border:none;color:#888;cursor:pointer;font-size:14px;">✕</button>';
              this._dictionaryTooltip.innerHTML = closeBtn + html;
            })
            .catch(() => {
              this._dictionaryTooltip.innerHTML = '<b style="color:#6366f1">' + sel + '</b><br><span style="color:#888;">No definition found.</span>';
              setTimeout(() => { if (this._dictionaryTooltip) this._dictionaryTooltip.style.display = 'none'; }, 2000);
            });
        };
        document.addEventListener('dblclick', this._dictionaryHandler);
      } else {
        if (this._dictionaryHandler) { document.removeEventListener('dblclick', this._dictionaryHandler); this._dictionaryHandler = null; }
        if (this._dictionaryTooltip) { this._dictionaryTooltip.remove(); this._dictionaryTooltip = null; }
      }
    } catch (e) { this._warn('applyDictionary: ' + e.message); }
  }

  // ── 8. Reading Progress Bar ───────────────────────────────
  applyReadingProgress(active) {
    try {
      if (active) {
        if (this._progressBar) return;
        this._progressBar = document.createElement('div');
        this._progressBar.id = 'accessiflow-progress-bar';
        this._progressBar.setAttribute('role', 'progressbar');
        this._progressBar.setAttribute('aria-label', 'Reading progress');
        this._progressBar.setAttribute('aria-valuemin', '0');
        this._progressBar.setAttribute('aria-valuemax', '100');
        this._progressBar.style.width = '0%';
        document.body.appendChild(this._progressBar);

        this._progressHandler = () => {
          const scrolled = window.scrollY;
          const total = document.documentElement.scrollHeight - window.innerHeight;
          const pct = total > 0 ? Math.min(100, (scrolled / total) * 100) : 0;
          this._progressBar.style.width = pct + '%';
          this._progressBar.setAttribute('aria-valuenow', Math.round(pct));
        };
        window.addEventListener('scroll', this._progressHandler, { passive: true });
        this._progressHandler(); // initial
      } else {
        if (this._progressBar) { this._progressBar.remove(); this._progressBar = null; }
        if (this._progressHandler) { window.removeEventListener('scroll', this._progressHandler); this._progressHandler = null; }
      }
    } catch (e) { this._warn('applyReadingProgress: ' + e.message); }
  }

  // ── 9. Numbered Form Steps ────────────────────────────────
  // One question at a time. It used to put a numbered badge beside each
  // field and leave the whole form on screen. Now a form of three questions
  // or more shows one at a time, with "Question 2 of 5", Back and Next. Its
  // send button stays where it was, so the form can always be sent.
  applyFormSteps(active) {
    const FIELDS = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select';
    try {
      if (!active) {
        this._formStepLabels.forEach(({ nodes, bar }) => {
          try {
            nodes.forEach(n => n.classList.remove('accessiflow-step-hidden'));
            bar.remove();
          } catch (e) { /* skip */ }
        });
        this._formStepLabels = [];
        if (this._formStepStyle) { this._formStepStyle.remove(); this._formStepStyle = null; }
        return;
      }
      if (!this._formStepStyle) {
        this._formStepStyle = document.createElement('style');
        this._formStepStyle.id = 'accessiflow-form-steps-style';
        this._formStepStyle.textContent = '.accessiflow-step-hidden { display: none !important; }';
        (document.head || document.documentElement).appendChild(this._formStepStyle);
      }

      document.querySelectorAll('form').forEach(form => {
        if (form.closest('[id^="accessiflow-"]') || this._formStepLabels.some(s => s.form === form)) return;
        const fields = Array.from(form.querySelectorAll(FIELDS)).filter(f => f.getClientRects().length > 0);

        // One question per field, and one for each group of radio buttons
        // or check boxes that share a name.
        const questions = [];
        const byName = new Map();
        fields.forEach(field => {
          const type = (field.getAttribute('type') || '').toLowerCase();
          if ((type === 'radio' || type === 'checkbox') && field.name) {
            if (byName.has(field.name)) { byName.get(field.name).fields.push(field); return; }
            const q = { fields: [field] };
            byName.set(field.name, q);
            questions.push(q);
            return;
          }
          questions.push({ fields: [field] });
        });
        if (questions.length < 3) return;

        // What to hide for each question: the largest wrapper holding only
        // its own fields, or, in a form laid out flat, the fields and their
        // labels themselves.
        const all = new Set(fields);
        questions.forEach(q => {
          let wrap = q.fields.length > 1 ? q.fields[0].closest('fieldset') : null;
          if (!wrap) {
            wrap = q.fields[0];
            while (wrap.parentElement && wrap.parentElement !== form) {
              const inside = Array.from(wrap.parentElement.querySelectorAll(FIELDS)).filter(f => all.has(f));
              if (inside.some(f => q.fields.indexOf(f) === -1)) break;
              if (wrap.parentElement.querySelector('button[type="submit"], input[type="submit"], button:not([type])')) break;
              wrap = wrap.parentElement;
            }
          }
          const nodes = new Set([wrap]);
          if (wrap === q.fields[0] || q.fields.indexOf(wrap) > -1) {
            q.fields.forEach(f => {
              nodes.add(f);
              (f.labels ? Array.from(f.labels) : []).forEach(l => { if (!l.contains(f) || l.parentElement === form) nodes.add(l); });
              const wrappingLabel = f.closest('label');
              if (wrappingLabel && form.contains(wrappingLabel)) nodes.add(wrappingLabel);
            });
          }
          q.nodes = Array.from(nodes);
        });

        const bar = document.createElement('div');
        bar.className = 'accessiflow-form-stepper';
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', 'One question at a time');
        bar.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px;padding:8px 10px;' +
          'border:2px solid #4f46e5;border-radius:10px;background:#eef2ff;color:#1e1b4b;font:600 15px/1.3 system-ui,sans-serif;';
        const where = document.createElement('span');
        where.setAttribute('role', 'status');
        where.setAttribute('aria-live', 'polite');
        where.style.flex = '1';
        const button = text => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = text;
          b.style.cssText = 'min-height:40px;padding:0 16px;border-radius:8px;border:2px solid #4f46e5;background:#fff;' +
            'color:#1e1b4b;font:700 15px system-ui,sans-serif;cursor:pointer;';
          return b;
        };
        const back = button('Back');
        const next = button('Next');
        bar.append(where, back, next);
        form.insertBefore(bar, form.firstChild);

        const state = { form, bar, questions, at: 0, nodes: [].concat(...questions.map(q => q.nodes)) };
        const show = (index, focus) => {
          state.at = Math.max(0, Math.min(questions.length - 1, index));
          questions.forEach((q, i) => q.nodes.forEach(n => n.classList.toggle('accessiflow-step-hidden', i !== state.at)));
          where.textContent = 'Question ' + (state.at + 1) + ' of ' + questions.length;
          back.disabled = state.at === 0;
          next.disabled = state.at === questions.length - 1;
          back.style.opacity = back.disabled ? '.45' : '1';
          next.style.opacity = next.disabled ? '.45' : '1';
          if (focus) { try { questions[state.at].fields[0].focus(); } catch (e) { /* ok */ } }
        };
        back.addEventListener('click', () => show(state.at - 1, true));
        next.addEventListener('click', () => {
          // An answer the form will refuse is said now, not after the last question.
          const bad = questions[state.at].fields.find(f => typeof f.checkValidity === 'function' && !f.checkValidity());
          if (bad) { try { bad.reportValidity(); } catch (e) { /* ok */ } return; }
          show(state.at + 1, true);
        });
        // A field refused on sending, or reached some other way, is brought into view.
        form.addEventListener('invalid', e => {
          const i = questions.findIndex(q => q.fields.indexOf(e.target) > -1);
          if (i > -1 && i !== state.at) show(i, false);
        }, true);
        show(0, false);
        this._formStepLabels.push(state);
      });
    } catch (e) { this._warn('applyFormSteps: ' + e.message); }
  }

  // ── 10. Break Timer ──────────────────────────────────────
  //
  // One reminder for the whole browser. Each tab used to run its own timer
  // from when it loaded, restart it whenever any setting changed, and show
  // and say the reminder by itself, so with several tabs open "Time for a
  // break" came at unpredictable moments, from tabs nobody was looking at.
  // When the last break was taken is kept in storage; only the tab the user
  // is looking at shows the reminder, and a long spell away counts as a
  // break.
  applyBreakTimer(active, minutes) {
    const KEY = 'accessiflow_break';
    const AWAY = 5 * 60 * 1000;          // this long with no tab checking in is a break
    try {
      if (active) {
        if (this._breakTimerEl) return;
        const interval = (minutes || 20) * 60 * 1000; // ms

        const check = () => {
          if (document.hidden) return;
          try {
            chrome.storage.local.get(KEY, data => {
              const now = Date.now();
              const stored = data && data[KEY];
              let since = stored && stored.since;
              // Never started, or the browser was closed or left alone.
              if (!since || !stored.seen || now - stored.seen > AWAY) since = now;
              const due = now - since >= interval && document.hasFocus() &&
                !document.getElementById('accessiflow-break-reminder');
              chrome.storage.local.set({ [KEY]: { since: due ? now : since, seen: now } });
              if (due) showReminder();
            });
          } catch (e) { /* cut off from the extension */ }
        };

        const showReminder = () => {
          const reminder = document.createElement('div');
          reminder.id = 'accessiflow-break-reminder';
          reminder.setAttribute('role', 'alert');
          reminder.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;background:#16181f;border:3px solid #4fffb0;border-radius:20px;padding:40px 50px;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,0.7);font-family:system-ui,sans-serif;';
          reminder.innerHTML = '<div style="font-size:48px;margin-bottom:16px;">🧘</div><div style="color:#4fffb0;font-size:20px;font-weight:bold;margin-bottom:8px;">Time for a Break!</div><div style="color:#e0e0e0;font-size:14px;margin-bottom:20px;">You\'ve been browsing for ' + (minutes || 20) + ' minutes.<br>Rest your eyes and stretch.</div>';

          const closeBtn = document.createElement('button');
          closeBtn.type = 'button';
          closeBtn.textContent = 'Got it!';
          closeBtn.style.cssText = 'padding:10px 30px;background:#4fffb0;color:#0e0f13;border:none;border-radius:10px;font-size:16px;font-weight:bold;cursor:pointer;';
          closeBtn.addEventListener('click', () => { reminder.remove(); overlay.remove(); });
          reminder.appendChild(closeBtn);

          const overlay = document.createElement('div');
          overlay.id = 'accessiflow-break-overlay';
          overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:2147483646;';
          overlay.addEventListener('click', () => { reminder.remove(); overlay.remove(); });

          document.body.appendChild(overlay);
          document.body.appendChild(reminder);
          try { closeBtn.focus(); } catch (e) { /* ok */ }

          if (typeof window.AccessiFlowSpeak === 'function') {
            window.AccessiFlowSpeak('Time for a break. Rest your eyes and stretch.');
          }
        };

        this._breakTimerInterval = setInterval(check, 30000);
        check();
        this._breakTimerEl = true;
      } else {
        if (this._breakTimerInterval) { clearInterval(this._breakTimerInterval); this._breakTimerInterval = null; }
        this._breakTimerEl = null;
        ['accessiflow-break-reminder', 'accessiflow-break-overlay'].forEach(id => {
          const existing = document.getElementById(id);
          if (existing) existing.remove();
        });
      }
    } catch (e) { this._warn('applyBreakTimer: ' + e.message); }
  }

  // ── 11. Memory Aid (form value recall) ────────────────────
  applyMemoryAid(active) {
    try {
      if (active) {
        // Load saved form data
        const hostname = location.hostname;
        const storageKey = 'accessiflow_memory_' + hostname;

        chrome.storage.local.get(storageKey, (data) => {
          this._memoryAidData = data[storageKey] || {};

          document.querySelectorAll('input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]), textarea, select').forEach(field => {
            if (field.getAttribute('data-accessiflow-memory')) return;
            field.setAttribute('data-accessiflow-memory', 'true');

            const key = field.name || field.id || '';
            if (!key) return;

            // Pre-fill if we have saved data
            if (this._memoryAidData[key] && !field.value) {
              field.value = this._memoryAidData[key];
              field.dispatchEvent(new Event('input', { bubbles: true }));

              // Show recall indicator
              const indicator = document.createElement('span');
              indicator.style.cssText = 'font-size:10px;color:#4fffb0;margin-left:4px;font-family:system-ui,sans-serif;';
              indicator.textContent = '(recalled)';
              if (field.parentElement) field.parentElement.appendChild(indicator);
              setTimeout(() => { try { indicator.remove(); } catch (e) { /* ok */ } }, 3000);
            }

            // Save on change
            const handler = () => {
              this._memoryAidData[key] = field.value;
              chrome.storage.local.set({ [storageKey]: this._memoryAidData });
            };
            field.addEventListener('change', handler);
            this._memoryAidInputs.push({ field, handler });
          });
        });
      } else {
        this._memoryAidInputs.forEach(({ field, handler }) => {
          try {
            field.removeAttribute('data-accessiflow-memory');
            field.removeEventListener('change', handler);
          } catch (e) { /* skip */ }
        });
        this._memoryAidInputs = [];
      }
    } catch (e) { this._warn('applyMemoryAid: ' + e.message); }
  }

  apply(settings) {
    try {
      const css = this.buildCSS(settings);
      this._getStyle().textContent = css;
      this.applyReadingMask(!!settings.readingMask, settings);
      this.applyLineRuler(!!settings.lineRuler && !settings.readingMask);
      this.applySimplifyPage(!!settings.simplifyPage);
      this.applyAltTextTooltips(!!settings.altTextTooltips);
      this.applyPauseMedia(!!settings.pauseMedia);
      this.applyDictionary(!!settings.dictionary);
      this.applyReadingProgress(!!settings.readingProgress);
      this.applyFormSteps(!!settings.formSteps);
      this.applyBreakTimer(!!settings.breakTimer, settings.breakTimerMinutes || 20);
      this.applyMemoryAid(!!settings.memoryAid);
    } catch (e) { this._warn('apply: ' + e.message); }
  }

  destroy() {
    try {
      if (this._styleEl) { this._styleEl.remove(); this._styleEl = null; }
      this.applyReadingMask(false);
      this.applyLineRuler(false);
      this.applySimplifyPage(false);
      this.applyAltTextTooltips(false);
      this.applyPauseMedia(false);
      this.applyDictionary(false);
      this.applyReadingProgress(false);
      this.applyFormSteps(false);
      this.applyBreakTimer(false);
      this.applyMemoryAid(false);
    } catch (e) { this._warn('destroy: ' + e.message); }
  }
}

if (typeof window !== 'undefined') window.CognitiveModule = CognitiveModule;
