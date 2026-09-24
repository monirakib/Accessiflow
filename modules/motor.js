// AccessiFlow MotorModule
// Large cursor, focus ring, big targets, click assist, stop animations, sticky hover
'use strict';

// ── The large pointer ─────────────────────────────────────────────────────
//
// Drawn by the operating system, from a picture handed over in CSS. It used
// to be a green circle on the page, moved to wherever the last mouse event
// said the pointer was, with the real pointer hidden. That always trailed a
// frame or more behind the hand, so it felt laggy; and wherever the page
// heard no mouse move (just after switching tabs, after any setting changed,
// over an embedded frame) there was no pointer on screen at all. A cursor
// picture moves with the mouse itself and cannot go missing: where a site
// refuses the picture, the ordinary pointer is shown instead.
const POINTER_COLOURS = {
  green: { fill: '#4fffb0', edge: '#0e0f13' },
  white: { fill: '#ffffff', edge: '#000000' },
  black: { fill: '#111111', edge: '#ffffff' },
  yellow: { fill: '#ffd400', edge: '#000000' }
};

// Drawn on a 32 by 32 grid, with the point that clicks.
const POINTER_SHAPES = {
  arrow: { d: 'M3 2 L3 25.5 L9 20 L13.2 29.5 L17.4 27.6 L13.3 18.5 L21.5 18.5 Z', x: 3, y: 2 },
  hand: { d: 'M10 4 A2 2 0 0 1 14 4 V12 A2 2 0 0 1 18 12 V13 A2 2 0 0 1 22 13 V14 A2 2 0 0 1 26 14 V23 ' +
    'C26 27 23 30 19 30 H16 C13 30 11 28.5 9.5 26 L4.5 19 A2 2 0 0 1 7.5 16.5 L10 19 Z', x: 12, y: 2 },
  text: { d: 'M10 3 H14 Q16 3 16 5 Q16 3 18 3 H22 V6 H18.5 Q17.5 6 17.5 7 V25 Q17.5 26 18.5 26 H22 V29 H18 ' +
    'Q16 29 16 27 Q16 29 14 29 H10 V26 H13.5 Q14.5 26 14.5 25 V7 Q14.5 6 13.5 6 H10 Z', x: 16, y: 16 }
};

// Chrome ignores cursor pictures bigger than this.
const POINTER_MAX = 128;

/**
 * The three pointers for a style: `cursor` everywhere, `hand` on things that
 * can be clicked, `text` in boxes that take typing. Each is a CSS cursor
 * value with its hotspot and an ordinary fallback.
 */
function largePointer(style, colourName, size) {
  const c = POINTER_COLOURS[colourName] || POINTER_COLOURS.green;
  const scale = Math.max(1, Math.min(4, Number(size) || 2));
  const url = (svg, px, hx, hy, fallback) =>
    'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") ' + Math.round(hx) + ' ' + Math.round(hy) + ', ' + fallback;
  const svgOpen = (px, box) => '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px +
    '" viewBox="0 0 ' + box + ' ' + box + '">';

  if (style === 'circle') {
    // The green circle it always was, now moved by the system.
    const px = Math.min(POINTER_MAX, Math.round(24 * scale));
    const blob = opacity => svgOpen(px, 32) +
      '<circle cx="16" cy="16" r="14" fill="' + c.fill + '" fill-opacity="' + opacity + '" stroke="' + c.edge + '" stroke-width="2"/>' +
      '<circle cx="16" cy="16" r="1.8" fill="' + c.edge + '"/></svg>';
    const middle = px / 2;
    return {
      cursor: url(blob(0.7), px, middle, middle, 'auto'),
      // More solid over something clickable, so the difference still shows.
      hand: url(blob(0.95), px, middle, middle, 'pointer'),
      text: url(blob(0.45), px, middle, middle, 'text')
    };
  }

  if (style === 'ring') {
    // The ordinary pointer, at its ordinary size, inside a ring that is easy
    // to find on a busy page.
    const px = Math.min(POINTER_MAX, Math.max(40, Math.round(28 * scale)));
    const ringed = (shape, fallback) => {
      const s = POINTER_SHAPES[shape];
      const k = 0.62;
      const tx = 32 - s.x * k;
      const ty = 32 - s.y * k;
      const svg = svgOpen(px, 64) +
        '<circle cx="32" cy="32" r="29" fill="' + c.fill + '" fill-opacity="0.18" stroke="' + c.fill + '" stroke-width="3.5"/>' +
        '<circle cx="32" cy="32" r="30.8" fill="none" stroke="' + c.edge + '" stroke-opacity="0.6" stroke-width="1"/>' +
        '<path transform="translate(' + tx + ' ' + ty + ') scale(' + k + ')" d="' + s.d + '" fill="#ffffff" ' +
        'stroke="#000000" stroke-width="2.2" stroke-linejoin="round"/></svg>';
      return url(svg, px, px / 2, px / 2, fallback);
    };
    return { cursor: ringed('arrow', 'auto'), hand: ringed('hand', 'pointer'), text: ringed('text', 'text') };
  }

  // A bigger version of the pointer everyone already knows.
  const px = Math.min(POINTER_MAX, Math.round(32 * scale));
  const k = px / 32;
  const drawn = (shape, fallback) => {
    const s = POINTER_SHAPES[shape];
    const svg = svgOpen(px, 32) + '<path d="' + s.d + '" fill="' + c.fill + '" stroke="' + c.edge +
      '" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    return url(svg, px, s.x * k, s.y * k, fallback);
  };
  return { cursor: drawn('arrow', 'auto'), hand: drawn('hand', 'pointer'), text: drawn('text', 'text') };
}

class MotorModule {
  constructor() {
    this._styleEl = null;
    this._stickyHoverHandlers = { over: null, out: null };
    this._pausedVideos = [];
    // New features
    this._dwellClickHandler = null;
    this._dwellTimer = null;
    this._dwellIndicator = null;
    this._tremorFilter = null;
    this._lastClickTime = 0;
    this._keyboardNav = null;
    this._switchScanHandler = null;
    this._switchScanInterval = null;
    this._switchCurrentIdx = 0;
    this._switchElements = [];
    this._dragAlternatives = [];

    // Dynamic visual pathing (the focus halo)
    this._halo = null;
    this._focusInHandler = null;
    this._focusOutHandler = null;

    // Tremor-resistant click snapping
    this._snapHalo = null;
    this._snapMoveHandler = null;
    this._snapDownHandler = null;
    this._snapClickHandler = null;
    this._snapInvalidate = null;
    this._snapTarget = null;
    this._snapCandidates = null;
    this._snapRadius = 28;
    this._smooth = null;          // 1-Euro filter state for the drawn pointer
    this._lastClickTarget = null;
  }

  /**
   * Whether motion is unwelcome right now.
   *
   * A pulsating halo is itself a vestibular trigger. Shipping one that ignores
   * the user's own reduced-motion preference, or the extension's own seizure
   * settings, would break the promise the Safety panel makes.
   */
  _motionOK(s) {
    if (s && (s.reduceMotion || s.stopAnimations)) return false;
    try {
      return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return true;
    }
  }

  _log(msg) { console.log('[AccessiFlow][Motor] ' + msg); }
  _warn(msg) { console.warn('[AccessiFlow][Motor] ' + msg); }

  _getStyle() {
    if (!this._styleEl || !document.head.contains(this._styleEl)) {
      this._styleEl = document.getElementById('accessiflow-motor-style');
      if (!this._styleEl) {
        this._styleEl = document.createElement('style');
        this._styleEl.id = 'accessiflow-motor-style';
        document.head.appendChild(this._styleEl);
      }
    }
    return this._styleEl;
  }

  buildCSS(s) {
    let css = '';
    try {
      // 1. Large pointer, drawn by the system. The three pictures are also
      // custom properties, which reach inside shadow roots where these rules
      // cannot: AccessiFlow's own keyboard and ring use them.
      if (s.largeCursor) {
        const p = largePointer(s.cursorStyle, s.cursorColor, s.cursorSize || 2);
        css += 'html { --af-cursor: ' + p.cursor + '; --af-cursor-hand: ' + p.hand + '; --af-cursor-text: ' + p.text + '; }\n';
        css += 'html, html * { cursor: var(--af-cursor) !important; }\n';
        css += 'html :is(a[href], button, summary, label, select, [role="button"], [role="link"], [role="tab"], ' +
          '[role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [onclick], ' +
          'input[type="checkbox"], input[type="radio"], input[type="submit"], input[type="button"], input[type="reset"], ' +
          'input[type="file"], input[type="range"], input[type="color"]), ' +
          'html :is(a[href], button, [role="button"], [role="link"]) * { cursor: var(--af-cursor-hand) !important; }\n';
        css += 'html :is(textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], ' +
          'input[type="url"], input[type="tel"], input[type="password"], input[type="number"], ' +
          '[contenteditable=""], [contenteditable="true"]), ' +
          'html :is([contenteditable=""], [contenteditable="true"]) * { cursor: var(--af-cursor-text) !important; }\n';
      }
      // 2. Enhanced focus ring. Stands aside for the halo, which does the same
      // job without being clipped by the page's own overflow and stacking.
      if (s.enhancedFocus && !s.focusHalo) {
        css += '*:focus { outline: 3px solid #4fffb0 !important; outline-offset: 3px !important; box-shadow: 0 0 0 6px rgba(79,255,176,0.3) !important; }\n';
      }

      // 2b. The halo's pulse. Declared here rather than inline so it can be
      // left out entirely when motion is unwelcome.
      if (s.focusHalo && this._motionOK(s) && s.focusHaloPulse !== false) {
        css += '@keyframes accessiflow-halo-pulse {\n';
        css += '  0%, 100% { opacity: 1; }\n';
        css += '  50% { opacity: 0.45; }\n';
        css += '}\n';
      }
      // 3. Big targets
      if (s.bigTargets) {
        css += 'a, button, input, select, textarea, [role="button"], [role="link"], [tabindex] { min-height: 44px !important; min-width: 44px !important; padding: 8px !important; }\n';
      }
      // 5. Stop animations
      if (s.stopAnimations) {
        // Deliberately not `animation-play-state: paused`, which was here
        // before. Pausing freezes an animation wherever it happens to be, and
        // the near-universal fade-in-on-scroll pattern starts at opacity 0 --
        // so pausing it on arrival hides the content permanently. Collapsing
        // the duration instead jumps every animation to its finished state,
        // which is where the page wanted it.
        css += '*, *::before, *::after {\n';
        css += '  animation-duration: 0.001ms !important;\n';
        css += '  animation-delay: 0s !important;\n';
        css += '  animation-iteration-count: 1 !important;\n';
        css += '  transition-duration: 0.001ms !important;\n';
        css += '  transition-delay: 0s !important;\n';
        css += '}\n';
        css += 'html { scroll-behavior: auto !important; }\n';
      }
      // 6. Dwell click indicator
      if (s.dwellClick) {
        css += '@keyframes accessiflow-dwell { 0% { stroke-dashoffset:157; } 100% { stroke-dashoffset:0; } }\n';
      }
      // 7. Keyboard-only mode
      if (s.keyboardOnly) {
        // Without a mouse, knowing where the keyboard is is not optional.
        if (!s.focusHalo) {
          css += 'a:focus, button:focus, input:focus, select:focus, textarea:focus, [tabindex]:focus { outline:3px solid #4fffb0 !important; outline-offset:3px !important; }\n';
        }
      }
      // 8. Edge scrolling
      if (s.edgeScrolling) {
        css += 'html { scroll-behavior: smooth !important; }\n';
      }
    } catch (e) { this._warn('buildCSS: ' + e.message); }
    return css;
  }

  // ── 1. Large cursor ───────────────────────────────────────
  // All of it is CSS now (see largePointer and buildCSS). This only clears
  // away the circle an older version drew on the page, should one be left.
  applyLargeCursor() {
    try {
      const old = document.getElementById('accessiflow-custom-cursor');
      if (old) old.remove();
    } catch (e) { this._warn('applyLargeCursor: ' + e.message); }
  }

  // ── 5. Stop animations, pause videos ─────────────────────
  applyStopAnimations(active) {
    try {
      if (active) {
        document.querySelectorAll('video').forEach(v => {
          try {
            if (!v.paused) { v.pause(); this._pausedVideos.push(v); }
          } catch (err) { /* skip */ }
        });
      } else {
        this._pausedVideos.forEach(v => {
          try { v.play(); } catch (err) { /* skip */ }
        });
        this._pausedVideos = [];
      }
    } catch (e) { this._warn('applyStopAnimations: ' + e.message); }
  }

  // ── 6. Sticky hover ──────────────────────────────────────
  applyStickyHover(active) {
    try {
      if (active) {
        this._stickyHoverHandlers.over = (e) => {
          try {
            const el = e.target;
            if (!el || !el.style) return;
            const cs = window.getComputedStyle(el);
            el.dataset.accessiflowBg = cs.backgroundColor;
            el.dataset.accessiflowColor = cs.color;
          } catch (err) { /* skip */ }
        };
        this._stickyHoverHandlers.out = (e) => {
          try {
            const el = e.target;
            if (!el || !el.dataset) return;
            if (el.dataset.accessiflowBg) {
              el.style.backgroundColor = el.dataset.accessiflowBg;
              el.style.color = el.dataset.accessiflowColor;
              el.classList.add('accessiflow-sticky-hover');
            }
          } catch (err) { /* skip */ }
        };
        document.addEventListener('mouseover', this._stickyHoverHandlers.over);
        document.addEventListener('mouseout', this._stickyHoverHandlers.out);
      } else {
        if (this._stickyHoverHandlers.over) {
          document.removeEventListener('mouseover', this._stickyHoverHandlers.over);
          document.removeEventListener('mouseout', this._stickyHoverHandlers.out);
          this._stickyHoverHandlers = { over: null, out: null };
        }
        document.querySelectorAll('.accessiflow-sticky-hover').forEach(el => {
          try {
            el.style.backgroundColor = '';
            el.style.color = '';
            el.classList.remove('accessiflow-sticky-hover');
          } catch (err) { /* skip */ }
        });
      }
    } catch (e) { this._warn('applyStickyHover: ' + e.message); }
  }

  // ── 7. Dwell Click ─────────────────────────────────────────
  applyDwellClick(active, delay) {
    try {
      if (active) {
        if (this._dwellClickHandler) return;
        const dwellDelay = delay || 1000;

        // Create SVG ring indicator
        const indicator = document.createElement('div');
        indicator.id = 'accessiflow-dwell-indicator';
        indicator.setAttribute('aria-hidden', 'true');
        indicator.style.cssText = 'position:fixed;width:50px;height:50px;pointer-events:none;z-index:2147483646;display:none;';
        indicator.innerHTML = '<svg width="50" height="50"><circle cx="25" cy="25" r="22" fill="none" stroke="#2a2d35" stroke-width="3"/><circle cx="25" cy="25" r="22" fill="none" stroke="#4fffb0" stroke-width="3" stroke-dasharray="157" stroke-dashoffset="157" style="transition:stroke-dashoffset ' + (dwellDelay / 1000) + 's linear;"/></svg>';
        document.body.appendChild(indicator);
        this._dwellIndicator = indicator;

        let lastX = 0, lastY = 0;
        this._dwellClickHandler = (e) => {
          const dx = Math.abs(e.clientX - lastX);
          const dy = Math.abs(e.clientY - lastY);

          if (dx > 10 || dy > 10) {
            // Mouse moved, reset
            lastX = e.clientX;
            lastY = e.clientY;
            if (this._dwellTimer) { clearTimeout(this._dwellTimer); this._dwellTimer = null; }
            indicator.style.display = 'none';
            const circle = indicator.querySelector('circle:last-child');
            if (circle) circle.style.strokeDashoffset = '157';

            // Start new dwell timer
            indicator.style.left = (e.clientX - 25) + 'px';
            indicator.style.top = (e.clientY - 25) + 'px';
            indicator.style.display = 'block';

            setTimeout(() => {
              const circle2 = indicator.querySelector('circle:last-child');
              if (circle2) circle2.style.strokeDashoffset = '0';
            }, 50);

            this._dwellTimer = setTimeout(() => {
              // Auto-click at cursor position. Seen through shadow roots, so
              // resting on a key of the on-screen keyboard presses that key
              // rather than the keyboard as a whole.
              const A = window.AccessiFlowPageActions;
              const target = A ? A.deepElementFromPoint(lastX, lastY) : document.elementFromPoint(lastX, lastY);
              if (target) {
                target.click();
                // Our own buttons never take focus: the on-screen keyboard
                // would pull it out of the box being typed in.
                const ours = window.AccessiFlowHandActions && window.AccessiFlowHandActions.isOurs(target);
                if (!ours) target.focus();
              }
              indicator.style.display = 'none';
              const circle3 = indicator.querySelector('circle:last-child');
              if (circle3) circle3.style.strokeDashoffset = '157';
              this._dwellTimer = null;
            }, dwellDelay);
          }
        };
        document.addEventListener('mousemove', this._dwellClickHandler);
      } else {
        if (this._dwellClickHandler) { document.removeEventListener('mousemove', this._dwellClickHandler); this._dwellClickHandler = null; }
        if (this._dwellTimer) { clearTimeout(this._dwellTimer); this._dwellTimer = null; }
        if (this._dwellIndicator) { this._dwellIndicator.remove(); this._dwellIndicator = null; }
      }
    } catch (e) { this._warn('applyDwellClick: ' + e.message); }
  }

  // ── 8. Tremor Filtering ───────────────────────────────────
  applyTremorFilter(active, interval) {
    try {
      if (active) {
        if (this._tremorFilter) return;
        // Was hardcoded at 300ms. Tremor is not one speed: an essential tremor
        // repeats far faster than a spasm, so the window has to be the user's
        // to set.
        const minInterval = Math.max(100, Math.min(1000, interval || 300));

        this._tremorFilter = (e) => {
          const now = Date.now();
          const sinceLast = now - this._lastClickTime;
          // What was really pressed. Inside a shadow root e.target is only the
          // host, which made every key of the on-screen keyboard look like one
          // element pressed twice.
          const target = (e.composedPath && e.composedPath()[0]) || e.target;

          if (sinceLast < minInterval) {
            // A second click on a *different* element is the user moving on,
            // not a shake. Swallowing it would make the page feel dead.
            if (target !== this._lastClickTarget) {
              this._lastClickTime = now;
              this._lastClickTarget = target;
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            return false;
          }
          this._lastClickTime = now;
          this._lastClickTarget = target;
        };
        document.addEventListener('click', this._tremorFilter, true);
      } else {
        if (this._tremorFilter) {
          document.removeEventListener('click', this._tremorFilter, true);
          this._tremorFilter = null;
        }
      }
    } catch (e) { this._warn('applyTremorFilter: ' + e.message); }
  }

  // ── 9. Keyboard-only mode ────────────────────────────────
  //
  // This used to number the first ten controls and jump to them with
  // Ctrl+1..0, which Chrome already uses to switch tabs, so it mostly did
  // nothing; it also appended the numbers inside inputs, where they cannot
  // go. The real mode lives in keyboard-nav.js: single-key commands, letter
  // labels on everything clickable, and a key guide on screen.
  applyKeyboardOnly(active) {
    try {
      if (active) {
        if (this._keyboardNav) return;
        const Nav = window.AccessiFlowKeyboardNav;
        if (!Nav) { this._warn('keyboard-nav.js not loaded'); return; }
        this._keyboardNav = new Nav();
        this._keyboardNav.enable();
      } else if (this._keyboardNav) {
        this._keyboardNav.disable();
        this._keyboardNav = null;
      }
    } catch (e) { this._warn('applyKeyboardOnly: ' + e.message); }
  }

  // ── 10. Voice commands ── moved: voice control is now its own side panel
  // (voice-panel.js), acting through modules/voice-nav.js. The old listener
  // here matched command words anywhere in a sentence and asked for the
  // microphone on every site.

  // ── 11. Edge Scrolling ────────────────────────────────────
  applyEdgeScrolling(active) {
    try {
      if (active) {
        if (this._edgeScrollHandler) return;
        this._edgeScrollHandler = (e) => {
          const margin = 40;
          const speed = 5;
          if (e.clientY < margin) window.scrollBy(0, -speed);
          else if (e.clientY > window.innerHeight - margin) window.scrollBy(0, speed);
        };
        document.addEventListener('mousemove', this._edgeScrollHandler);
      } else {
        if (this._edgeScrollHandler) { document.removeEventListener('mousemove', this._edgeScrollHandler); this._edgeScrollHandler = null; }
      }
    } catch (e) { this._warn('applyEdgeScrolling: ' + e.message); }
  }

  // ── 12. Dynamic visual pathing: the focus halo ───────────────
  //
  // Replaces `*:focus { outline: ... }`. An outline is painted inside the
  // target's own stacking context, so any ancestor with `overflow: hidden`
  // clips it and any later `z-index` buries it. That is why focus rings look
  // broken on exactly the dense, deeply nested pages where finding the
  // keyboard matters most. This draws a fixed-position halo outside the
  // target's rect, where nothing on the page can reach it.
  applyFocusHalo(active, settings) {
    try {
      if (active) {
        if (this._halo) return;
        const s = settings || {};
        const Overlay = window.AccessiFlowOverlay;
        if (!Overlay) { this._warn('overlay primitive not loaded'); return; }

        this._halo = new Overlay({
          id: 'accessiflow-focus-halo',
          padding: Math.max(2, (s.focusHaloSize || 4))
        });

        const pulse = s.focusHaloPulse !== false && this._motionOK(s);

        this._focusInHandler = (e) => {
          try {
            const el = e.target;
            if (!el || el.nodeType !== 1) return;
            if (el === document.body || el === document.documentElement) return;
            if (el.closest && el.closest('[id^="accessiflow-"]')) return;

            if (!this._halo.follow(el)) { this._halo.hide(); return; }

            const colour = this._haloColour(el);
            this._halo.style(
              'background: transparent !important; ' +
              'border: ' + Math.max(2, (s.focusHaloSize || 4)) + 'px solid ' + colour.ring + ' !important; ' +
              'border-radius: 6px !important; ' +
              'box-shadow: 0 0 0 2px ' + colour.halo + ', 0 0 12px 4px ' + colour.halo + ' !important; ' +
              (pulse ? 'animation: accessiflow-halo-pulse 1.4s ease-in-out infinite !important;' : '')
            );

            if (s.focusHaloTooltip !== false) {
              const hint = this._activationHint(el);
              if (hint) {
                this._halo.tooltip(hint, {
                  style: 'background: ' + colour.ring + ' !important; color: ' + colour.text + ' !important; ' +
                    'font: 600 12px/1.5 system-ui, sans-serif !important; ' +
                    'padding: 3px 8px !important; border-radius: 4px !important; ' +
                    'box-shadow: 0 2px 8px rgba(0,0,0,0.4) !important;'
                });
              } else {
                this._halo.clearTooltip();
              }
            }
          } catch (err) { /* one odd element must not kill the halo */ }
        };

        this._focusOutHandler = () => {
          // A blur is usually followed immediately by a focus somewhere else.
          // Hiding on the next tick instead of now stops the halo flickering
          // off and on as the keyboard moves between controls.
          setTimeout(() => {
            if (!this._halo) return;
            const el = document.activeElement;
            if (!el || el === document.body || el === document.documentElement) this._halo.hide();
          }, 0);
        };

        document.addEventListener('focusin', this._focusInHandler, true);
        document.addEventListener('focusout', this._focusOutHandler, true);

        // If something already has focus, show it straight away rather than
        // waiting for the user to press Tab to find out the feature is on.
        if (document.activeElement && document.activeElement !== document.body) {
          this._focusInHandler({ target: document.activeElement });
        }
      } else {
        if (this._focusInHandler) {
          document.removeEventListener('focusin', this._focusInHandler, true);
          document.removeEventListener('focusout', this._focusOutHandler, true);
          this._focusInHandler = null;
          this._focusOutHandler = null;
        }
        if (this._halo) { this._halo.destroy(); this._halo = null; }
      }
    } catch (e) { this._warn('applyFocusHalo: ' + e.message); }
  }

  /**
   * A halo colour chosen against what is actually behind the element, rather
   * than one fixed green that vanishes on a green page.
   */
  _haloColour(el) {
    const fallback = { ring: '#4fffb0', halo: 'rgba(79,255,176,0.35)', text: '#0e0f13' };
    try {
      const C = globalThis.ACCESSIFLOW_COLOR;
      const G = globalThis.AccessiFlowGeometry;
      if (!C || !G) return fallback;

      const bg = G.effectiveBackground(el);
      const options = ['#4fffb0', '#ffd400', '#ff4fd8', '#00b0ff', '#ff5a3c'];
      const best = C.bestContrasting(bg, options);
      // Below 3:1 the ring is hard to see at all, so fall back to whichever of
      // black or white the background leaves room for.
      const ring = best.ratio >= 3 ? best.color
        : C.toHex(C.bestContrasting(bg, ['#ffffff', '#000000']).color);
      const parsed = C.parseColor(ring);
      return {
        ring: ring,
        halo: 'rgba(' + parsed.r + ',' + parsed.g + ',' + parsed.b + ',0.35)',
        text: C.contrastRatio(ring, '#000000') > C.contrastRatio(ring, '#ffffff') ? '#000000' : '#ffffff'
      };
    } catch (e) {
      return fallback;
    }
  }

  /**
   * What to press, in words. Telling someone where the keyboard is only half
   * helps; the other half is what it can do from there.
   */
  _activationHint(el) {
    try {
      const naming = globalThis.AccessiFlowNaming;
      const name = naming ? naming.accessibleName(el) : '';
      const tag = el.tagName;
      const role = (el.getAttribute('role') || '').toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();

      let key = null;
      if (tag === 'A' && el.hasAttribute('href')) key = 'Enter';
      else if (tag === 'BUTTON' || role === 'button' || type === 'submit' || type === 'button') key = 'Enter or Space';
      else if (type === 'checkbox' || role === 'checkbox' || role === 'switch') key = 'Space';
      else if (type === 'radio' || role === 'radio') key = 'Arrow keys';
      else if (type === 'range' || role === 'slider') key = 'Arrow keys';
      else if (tag === 'SELECT' || role === 'combobox') key = 'Arrow keys, then Enter';
      else if (tag === 'TEXTAREA') key = 'Type here';
      else if (tag === 'INPUT') key = 'Type here';
      else if (tag === 'SUMMARY' || role === 'disclosure') key = 'Enter to open';
      else if (role === 'tab') key = 'Arrow keys to switch';
      else if (role === 'menuitem' || role === 'option') key = 'Enter';

      // An accesskey is the fastest route there is and almost nothing surfaces it.
      const accesskey = el.getAttribute('accesskey');
      if (accesskey) key = 'Alt+' + accesskey.toUpperCase() + (key ? ', or ' + key : '');

      if (!key) return name || '';
      return name ? name + '  ·  ' + key : key;
    } catch (e) {
      return '';
    }
  }

  // ── 13. Tremor-resistant click snapping ──────────────────────
  //
  // A web page cannot move the operating system cursor; no such API exists.
  // So this does not warp the pointer. It does three things that together
  // give the same result without ever fighting the user's hand:
  //
  //   1. smooths the *drawn* pointer, so tremor is visibly damped
  //   2. locks on to the nearest target and shows which one will be hit
  //   3. redirects the click there if the press lands just outside it
  //
  // Redirection is what actually fixes the miss. The halo is what makes it
  // predictable, which matters more: a click that silently goes somewhere
  // other than where you pressed is frightening, not helpful.
  applyClickSnapping(active, settings) {
    try {
      if (active) {
        if (this._snapMoveHandler) return;
        const s = settings || {};
        const Overlay = window.AccessiFlowOverlay;
        const G = globalThis.AccessiFlowGeometry;
        if (!Overlay || !G) { this._warn('overlay primitive not loaded'); return; }

        this._snapRadius = Math.max(8, Math.min(120, s.clickSnapRadius || 28));
        this._snapHalo = new Overlay({ id: 'accessiflow-snap-halo', padding: 3 });
        this._snapHalo.style(
          'background: rgba(79,255,176,0.12) !important; ' +
          'border: 3px dashed #4fffb0 !important; border-radius: 6px !important;'
        );

        // Candidates are cached because querying every element on every mouse
        // move would cost more than the feature is worth. Scrolling, resizing
        // and DOM changes throw the cache away.
        this._snapCandidates = null;
        this._snapInvalidate = () => { this._snapCandidates = null; };
        window.addEventListener('scroll', this._snapInvalidate, { passive: true, capture: true });
        window.addEventListener('resize', this._snapInvalidate, { passive: true });

        // At most once a frame, for the latest position only. Working out the
        // nearest target on every mouse event, and again after every scroll
        // event, is what made the pointer feel heavy on long pages.
        this._snapPoint = null;
        this._snapFrame = null;
        const update = () => {
          this._snapFrame = null;
          const p = this._snapPoint;
          if (!p || !this._snapHalo) return;
          // Rebuilt no more than ten times a second while the page scrolls.
          if (!this._snapCandidates && Date.now() - (this._snapBuiltAt || 0) < 100) {
            this._snapFrame = requestAnimationFrame(update);
            return;
          }
          try {
            const target = this._nearestTarget(p.x, p.y);
            this._snapTarget = target;
            if (target) this._snapHalo.follow(target);
            else this._snapHalo.hide();
          } catch (err) { /* skip */ }
        };
        this._snapMoveHandler = (e) => {
          this._snapPoint = { x: e.clientX, y: e.clientY };
          if (!this._snapFrame) this._snapFrame = requestAnimationFrame(update);
        };

        // Capture phase, so the decision is made before the page sees the
        // event and can act on the wrong element.
        this._snapClickHandler = (e) => {
          try {
            if (e.target && e.target.closest && e.target.closest('[id^="accessiflow-"]')) return;
            if (G.isActionable(e.target)) return;                          // a real target: leave it
            // Worked out afresh where the click actually is, never from what
            // the halo last showed: a click sent somewhere the user did not
            // press is frightening, and the halo can be a frame behind.
            // A click made by script (Click by hovering, say) has no position of
            // its own; the pointer's last one stands in for it.
            const at = (e.clientX || e.clientY) ? { x: e.clientX, y: e.clientY } : this._snapPoint;
            if (!at) return;
            this._snapCandidates = null;
            const destination = this._nearestTarget(at.x, at.y);
            this._snapTarget = destination;
            if (!destination) return;
            if (e.target && destination.contains(e.target)) return;        // already on target

            e.preventDefault();
            e.stopPropagation();

            if (typeof destination.focus === 'function') {
              try { destination.focus(); } catch (err) { /* skip */ }
            }
            destination.click();
          } catch (err) { /* skip */ }
        };

        document.addEventListener('mousemove', this._snapMoveHandler, { passive: true });
        document.addEventListener('click', this._snapClickHandler, true);
      } else {
        if (this._snapMoveHandler) {
          document.removeEventListener('mousemove', this._snapMoveHandler);
          document.removeEventListener('click', this._snapClickHandler, true);
          this._snapMoveHandler = null;
          this._snapClickHandler = null;
        }
        if (this._snapInvalidate) {
          window.removeEventListener('scroll', this._snapInvalidate, { capture: true });
          window.removeEventListener('resize', this._snapInvalidate);
          this._snapInvalidate = null;
        }
        if (this._snapFrame) { cancelAnimationFrame(this._snapFrame); this._snapFrame = null; }
        if (this._snapHalo) { this._snapHalo.destroy(); this._snapHalo = null; }
        this._snapTarget = null;
        this._snapCandidates = null;
        this._snapPoint = null;
      }
    } catch (e) { this._warn('applyClickSnapping: ' + e.message); }
  }

  /** Everything clickable that is currently on screen. */
  _visibleTargets() {
    const G = globalThis.AccessiFlowGeometry;
    if (this._snapCandidates) return this._snapCandidates;

    const out = [];
    try {
      const all = document.querySelectorAll(G.ACTIONABLE_SELECTOR);
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (el.closest('[id^="accessiflow-"]')) continue;
        if (el.disabled) continue;
        const rect = el.getBoundingClientRect();
        if (!G.isUsable(rect)) continue;
        out.push({ el: el, rect: rect });
      }
    } catch (e) { /* skip */ }

    this._snapCandidates = out;
    this._snapBuiltAt = Date.now();
    return out;
  }

  /**
   * The nearest clickable thing within the snap radius, measured edge to edge.
   *
   * Edge distance rather than centre distance matters: a wide navigation link
   * whose centre is far away can still be the thing the user is obviously
   * aiming at, because its edge is a few pixels from the pointer.
   */
  _nearestTarget(x, y) {
    const G = globalThis.AccessiFlowGeometry;
    const candidates = this._visibleTargets();
    let best = null;
    let bestDistance = Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const distance = G.distanceToRect(x, y, candidates[i].rect);
      if (distance > this._snapRadius) continue;
      if (distance < bestDistance) { bestDistance = distance; best = candidates[i].el; }
    }

    // Inside a target already: nothing to snap, the page will handle it.
    if (best && bestDistance === 0) return best;
    return best;
  }

  /**
   * A 1-Euro filter over the pointer position.
   *
   * A plain moving average would damp tremor and also add lag to deliberate
   * movement, which feels like dragging the pointer through treacle. This
   * adapts: heavy smoothing while the hand is nearly still, almost none once
   * it is travelling, so shake is removed and intent is not.
   */
  _smoothPoint(x, y, now) {
    const MIN_CUTOFF = 0.6;
    const BETA = 0.02;

    if (!this._smooth) {
      this._smooth = { x: x, y: y, dx: 0, dy: 0, t: now };
      return { x: x, y: y };
    }

    const state = this._smooth;
    const dt = Math.max(1, now - state.t) / 1000;
    state.t = now;

    const alpha = (cutoff) => {
      const tau = 1 / (2 * Math.PI * cutoff);
      return 1 / (1 + tau / dt);
    };

    const speedAlpha = alpha(1.0);
    state.dx = speedAlpha * ((x - state.x) / dt) + (1 - speedAlpha) * state.dx;
    state.dy = speedAlpha * ((y - state.y) / dt) + (1 - speedAlpha) * state.dy;

    const speed = Math.sqrt(state.dx * state.dx + state.dy * state.dy);
    const cutoff = MIN_CUTOFF + BETA * speed;
    const a = alpha(cutoff);

    state.x = a * x + (1 - a) * state.x;
    state.y = a * y + (1 - a) * state.y;
    return { x: state.x, y: state.y };
  }

  apply(settings) {
    try {
      const css = this.buildCSS(settings);
      this._getStyle().textContent = css;
      this.applyLargeCursor(!!settings.largeCursor, settings.cursorSize || 2);
      this.applyStopAnimations(!!settings.stopAnimations);
      this.applyStickyHover(!!settings.stickyHover);
      this.applyDwellClick(!!settings.dwellClick, settings.dwellClickDelay || 1000);
      this.applyTremorFilter(!!settings.tremorFilter, settings.tremorInterval);
      this.applyKeyboardOnly(!!settings.keyboardOnly);
      this.applyEdgeScrolling(!!settings.edgeScrolling);
      this.applyFocusHalo(!!settings.focusHalo, settings);
      this.applyClickSnapping(!!settings.clickSnapping, settings);
    } catch (e) { this._warn('apply: ' + e.message); }
  }

  destroy() {
    try {
      if (this._styleEl) { this._styleEl.remove(); this._styleEl = null; }
      this.applyLargeCursor(false);
      this.applyStopAnimations(false);
      this.applyStickyHover(false);
      this.applyDwellClick(false);
      this.applyTremorFilter(false);
      this.applyKeyboardOnly(false);
      this.applyEdgeScrolling(false);
      this.applyFocusHalo(false);
      this.applyClickSnapping(false);
    } catch (e) { this._warn('destroy: ' + e.message); }
  }
}

if (typeof window !== 'undefined') window.MotorModule = MotorModule;
