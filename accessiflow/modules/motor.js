// AccessiFlow — MotorModule
// Large cursor, focus ring, big targets, click assist, stop animations, sticky hover
'use strict';

class MotorModule {
  constructor() {
    this._styleEl = null;
    this._cursorEl = null;
    this._cursorMoveHandler = null;
    this._cursorClickHandler = null;
    this._clickAssistHandler = null;
    this._stickyHoverHandlers = { over: null, out: null };
    this._pausedVideos = [];
    // New features
    this._dwellClickHandler = null;
    this._dwellTimer = null;
    this._dwellIndicator = null;
    this._tremorFilter = null;
    this._lastClickTime = 0;
    this._keyboardOverlay = null;
    this._keyboardLabels = [];
    this._switchScanHandler = null;
    this._switchScanInterval = null;
    this._switchCurrentIdx = 0;
    this._switchElements = [];
    this._voiceRecognition = null;
    this._dragAlternatives = [];
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
      // 1. Large cursor (hide real cursor)
      if (s.largeCursor) {
        css += 'html, html * { cursor: none !important; }\n';
      }
      // 2. Enhanced focus ring
      if (s.enhancedFocus) {
        css += '*:focus { outline: 3px solid #4fffb0 !important; outline-offset: 3px !important; box-shadow: 0 0 0 6px rgba(79,255,176,0.3) !important; }\n';
      }
      // 3. Big targets
      if (s.bigTargets) {
        css += 'a, button, input, select, textarea, [role="button"], [role="link"], [tabindex] { min-height: 44px !important; min-width: 44px !important; padding: 8px !important; }\n';
      }
      // 4. Click assist keyframes
      if (s.clickAssist) {
        css += '@keyframes accessiflow-ripple { 0% { transform:scale(0);opacity:1; } 100% { transform:scale(3);opacity:0; } }\n';
      }
      // 5. Stop animations
      if (s.stopAnimations) {
        css += '*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }\n';
        css += 'html { scroll-behavior: auto !important; }\n';
      }
      // 6. Dwell click indicator
      if (s.dwellClick) {
        css += '@keyframes accessiflow-dwell { 0% { stroke-dashoffset:157; } 100% { stroke-dashoffset:0; } }\n';
      }
      // 7. Keyboard-only mode
      if (s.keyboardOnly) {
        css += '.accessiflow-kb-label { position:absolute;top:-8px;left:-8px;background:#4fffb0;color:#0e0f13;font-size:10px;font-weight:bold;padding:1px 4px;border-radius:3px;z-index:2147483640;font-family:"Space Mono",monospace;pointer-events:none; }\n';
        css += 'a:focus, button:focus, input:focus, select:focus, textarea:focus, [tabindex]:focus { outline:3px solid #4fffb0 !important; outline-offset:3px !important; }\n';
      }
      // 8. Edge scrolling
      if (s.edgeScrolling) {
        css += 'html { scroll-behavior: smooth !important; }\n';
      }
    } catch (e) { this._warn('buildCSS: ' + e.message); }
    return css;
  }

  // ── 1. Large cursor ───────────────────────────────────────
  applyLargeCursor(active, size) {
    try {
      if (active) {
        if (this._cursorEl) return;
        const sz = 16 * (size || 2);
        const cursor = document.createElement('div');
        cursor.id = 'accessiflow-custom-cursor';
        cursor.setAttribute('aria-hidden', 'true');
        cursor.style.cssText = 'position:fixed;width:' + sz + 'px;height:' + sz + 'px;border-radius:50%;background:rgba(79,255,176,0.7);border:2px solid #000;pointer-events:none;z-index:2147483647;top:-100px;left:-100px;transition:transform 0.08s ease;';
        document.body.appendChild(cursor);
        this._cursorEl = cursor;

        this._cursorMoveHandler = (e) => {
          cursor.style.left = (e.clientX - sz / 2) + 'px';
          cursor.style.top = (e.clientY - sz / 2) + 'px';
        };
        this._cursorClickHandler = () => {
          cursor.style.transform = 'scale(1.4)';
          setTimeout(() => { cursor.style.transform = 'scale(1)'; }, 200);
        };
        document.addEventListener('mousemove', this._cursorMoveHandler);
        document.addEventListener('click', this._cursorClickHandler);
      } else {
        if (this._cursorEl) { this._cursorEl.remove(); this._cursorEl = null; }
        if (this._cursorMoveHandler) { document.removeEventListener('mousemove', this._cursorMoveHandler); this._cursorMoveHandler = null; }
        if (this._cursorClickHandler) { document.removeEventListener('click', this._cursorClickHandler); this._cursorClickHandler = null; }
      }
    } catch (e) { this._warn('applyLargeCursor: ' + e.message); }
  }

  // ── 4. Click assist ───────────────────────────────────────
  applyClickAssist(active) {
    try {
      if (active) {
        this._clickAssistHandler = (e) => {
          try {
            const ripple = document.createElement('div');
            ripple.setAttribute('aria-hidden', 'true');
            ripple.style.cssText = 'position:fixed;width:30px;height:30px;border-radius:50%;background:rgba(79,255,176,0.5);pointer-events:none;z-index:2147483646;animation:accessiflow-ripple 0.4s ease-out forwards;left:' + (e.clientX - 15) + 'px;top:' + (e.clientY - 15) + 'px;';
            document.body.appendChild(ripple);
            setTimeout(() => { try { ripple.remove(); } catch (err) { /* skip */ } }, 500);
          } catch (err) { /* skip */ }
        };
        document.addEventListener('click', this._clickAssistHandler);
      } else {
        if (this._clickAssistHandler) { document.removeEventListener('click', this._clickAssistHandler); this._clickAssistHandler = null; }
      }
    } catch (e) { this._warn('applyClickAssist: ' + e.message); }
  }

  // ── 5. Stop animations — pause videos ─────────────────────
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
            // Mouse moved — reset
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
              // Auto-click at cursor position
              const target = document.elementFromPoint(lastX, lastY);
              if (target) {
                target.click();
                target.focus();
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
  applyTremorFilter(active) {
    try {
      if (active) {
        if (this._tremorFilter) return;
        const minInterval = 300; // ms between clicks

        this._tremorFilter = (e) => {
          const now = Date.now();
          if (now - this._lastClickTime < minInterval) {
            e.preventDefault();
            e.stopPropagation();
            return false;
          }
          this._lastClickTime = now;
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

  // ── 9. Keyboard-Only Mode ────────────────────────────────
  applyKeyboardOnly(active) {
    try {
      if (active) {
        if (this._keyboardLabels.length > 0) return;
        const els = document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"]');
        let num = 1;
        els.forEach(el => {
          if (el.getAttribute('data-accessiflow-kb')) return;
          if (el.offsetWidth === 0 && el.offsetHeight === 0) return;
          el.setAttribute('data-accessiflow-kb', num);
          el.setAttribute('tabindex', el.getAttribute('tabindex') || '0');

          const label = document.createElement('span');
          label.className = 'accessiflow-kb-label';
          label.textContent = num;
          label.setAttribute('aria-hidden', 'true');

          const pos = window.getComputedStyle(el).position;
          if (pos === 'static') el.style.position = 'relative';
          el.appendChild(label);
          this._keyboardLabels.push({ el, label });
          num++;
        });

        // Number key press to jump to element
        this._switchScanHandler = (e) => {
          if (e.ctrlKey && /^[0-9]$/.test(e.key)) {
            let target = parseInt(e.key);
            if (target === 0) target = 10;
            const item = this._keyboardLabels[target - 1];
            if (item) {
              e.preventDefault();
              item.el.focus();
              item.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        };
        document.addEventListener('keydown', this._switchScanHandler);
      } else {
        this._keyboardLabels.forEach(({ el, label }) => {
          try {
            el.removeAttribute('data-accessiflow-kb');
            label.remove();
          } catch (err) { /* skip */ }
        });
        this._keyboardLabels = [];
        if (this._switchScanHandler) {
          document.removeEventListener('keydown', this._switchScanHandler);
          this._switchScanHandler = null;
        }
      }
    } catch (e) { this._warn('applyKeyboardOnly: ' + e.message); }
  }

  // ── 10. Voice Commands ────────────────────────────────────
  applyVoiceCommands(active) {
    try {
      if (active) {
        if (this._voiceRecognition) return;
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) { this._warn('Speech Recognition not supported'); return; }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = document.documentElement.lang || 'en-US';

        recognition.onresult = (event) => {
          const last = event.results[event.results.length - 1];
          if (!last.isFinal) return;
          const cmd = last[0].transcript.toLowerCase().trim();
          this._log('Voice command: ' + cmd);

          if (cmd.includes('scroll down')) window.scrollBy(0, 300);
          else if (cmd.includes('scroll up')) window.scrollBy(0, -300);
          else if (cmd.includes('go to top')) window.scrollTo(0, 0);
          else if (cmd.includes('go to bottom')) window.scrollTo(0, document.body.scrollHeight);
          else if (cmd.includes('go back')) window.history.back();
          else if (cmd.includes('go forward')) window.history.forward();
          else if (cmd.includes('reload') || cmd.includes('refresh')) location.reload();
          else if (cmd.includes('click')) {
            // Find element with matching text
            const text = cmd.replace('click', '').trim();
            if (text) {
              const els = document.querySelectorAll('a, button, [role="button"]');
              for (const el of els) {
                if ((el.textContent || '').toLowerCase().trim().includes(text)) {
                  el.click();
                  break;
                }
              }
            }
          }
          else if (cmd.includes('tab') || cmd.includes('next')) {
            const active = document.activeElement;
            const focusable = Array.from(document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]'));
            const idx = focusable.indexOf(active);
            if (idx >= 0 && idx < focusable.length - 1) focusable[idx + 1].focus();
            else if (focusable.length > 0) focusable[0].focus();
          }
        };

        recognition.onerror = () => { /* restart on error */ };
        recognition.onend = () => {
          if (this._voiceRecognition) {
            try { recognition.start(); } catch (e) { /* skip */ }
          }
        };

        try { recognition.start(); } catch (e) { this._warn('Voice start error: ' + e.message); }
        this._voiceRecognition = recognition;
      } else {
        if (this._voiceRecognition) {
          try { this._voiceRecognition.stop(); } catch (e) { /* skip */ }
          this._voiceRecognition = null;
        }
      }
    } catch (e) { this._warn('applyVoiceCommands: ' + e.message); }
  }

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

  apply(settings) {
    try {
      const css = this.buildCSS(settings);
      this._getStyle().textContent = css;
      this.applyLargeCursor(!!settings.largeCursor, settings.cursorSize || 2);
      this.applyClickAssist(!!settings.clickAssist);
      this.applyStopAnimations(!!settings.stopAnimations);
      this.applyStickyHover(!!settings.stickyHover);
      this.applyDwellClick(!!settings.dwellClick, settings.dwellClickDelay || 1000);
      this.applyTremorFilter(!!settings.tremorFilter);
      this.applyKeyboardOnly(!!settings.keyboardOnly);
      this.applyVoiceCommands(!!settings.voiceCommands);
      this.applyEdgeScrolling(!!settings.edgeScrolling);
    } catch (e) { this._warn('apply: ' + e.message); }
  }

  destroy() {
    try {
      if (this._styleEl) { this._styleEl.remove(); this._styleEl = null; }
      this.applyLargeCursor(false);
      this.applyClickAssist(false);
      this.applyStopAnimations(false);
      this.applyStickyHover(false);
      this.applyDwellClick(false);
      this.applyTremorFilter(false);
      this.applyKeyboardOnly(false);
      this.applyVoiceCommands(false);
      this.applyEdgeScrolling(false);
    } catch (e) { this._warn('destroy: ' + e.message); }
  }
}

if (typeof window !== 'undefined') window.MotorModule = MotorModule;
