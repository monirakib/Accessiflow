// AccessiFlow CognitiveModule
// Reading mask, line ruler, simplify page, heading structure, alt text tooltips, pause media
'use strict';

class CognitiveModule {
  constructor() {
    this._styleEl = null;
    this._maskTop = null;
    this._maskBottom = null;
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
      if (s.activeFieldHighlight) {
        css += 'input:focus, textarea:focus, select:focus { outline:3px solid #4fffb0 !important; outline-offset:2px !important; box-shadow:0 0 0 6px rgba(79,255,176,0.2) !important; background-color: rgba(79,255,176,0.05) !important; }\n';
      }
    } catch (e) { this._warn('buildCSS: ' + e.message); }
    return css;
  }

  // ── 1. Reading mask ───────────────────────────────────────
  applyReadingMask(active) {
    try {
      if (active) {
        if (this._maskTop) return;
        const baseStyle = 'position:fixed;left:0;width:100%;pointer-events:none;z-index:2147483645;background:rgba(0,0,0,0.75);transition:height 0.05s linear;';
        this._maskTop = document.createElement('div');
        this._maskTop.id = 'accessiflow-mask-top';
        this._maskTop.setAttribute('aria-hidden', 'true');
        this._maskTop.style.cssText = baseStyle + 'top:0;height:40%;';
        this._maskBottom = document.createElement('div');
        this._maskBottom.id = 'accessiflow-mask-bottom';
        this._maskBottom.setAttribute('aria-hidden', 'true');
        this._maskBottom.style.cssText = baseStyle + 'bottom:0;height:40%;';
        document.body.appendChild(this._maskTop);
        document.body.appendChild(this._maskBottom);

        this._maskHandler = (e) => {
          const y = e.clientY;
          const h = window.innerHeight;
          const stripH = 60;
          this._maskTop.style.height = Math.max(0, y - stripH / 2) + 'px';
          this._maskBottom.style.height = Math.max(0, h - y - stripH / 2) + 'px';
        };
        document.addEventListener('mousemove', this._maskHandler);
      } else {
        if (this._maskTop) { this._maskTop.remove(); this._maskTop = null; }
        if (this._maskBottom) { this._maskBottom.remove(); this._maskBottom = null; }
        if (this._maskHandler) { document.removeEventListener('mousemove', this._maskHandler); this._maskHandler = null; }
      }
    } catch (e) { this._warn('applyReadingMask: ' + e.message); }
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
        const selectors = 'aside, .sidebar, .ad, [class*="advertisement"], .cookie-banner, .popup, .modal-overlay, .newsletter-signup, .social-share, [class*="cookie"], [class*="banner"], [class*="promo"], [id*="ad-"], .widget, [class*="sidebar"]';
        document.querySelectorAll(selectors).forEach(el => {
          try {
            // Don't hide essential elements
            if (el.matches('main, article, [role="main"], nav, header, footer')) return;
            if (el.closest('main, article, [role="main"]')) return;
            this._simplifiedEls.push({ el, display: el.style.display });
            el.style.display = 'none';
          } catch (err) { /* skip */ }
        });
      } else {
        this._simplifiedEls.forEach(({ el, display }) => {
          try { el.style.display = display || ''; } catch (err) { /* skip */ }
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
      } else {
        if (this._mediaObserver) { this._mediaObserver.disconnect(); this._mediaObserver = null; }
        this._pausedMedia = [];
      }
    } catch (e) { this._warn('applyPauseMedia: ' + e.message); }
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
  applyFormSteps(active) {
    try {
      if (active) {
        const forms = document.querySelectorAll('form');
        forms.forEach(form => {
          const fields = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');
          fields.forEach((field, idx) => {
            if (field.getAttribute('data-accessiflow-step')) return;
            field.setAttribute('data-accessiflow-step', idx + 1);

            const stepLabel = document.createElement('span');
            stepLabel.className = 'accessiflow-form-step';
            stepLabel.setAttribute('aria-hidden', 'true');
            stepLabel.style.cssText = 'display:inline-block;background:#6366f1;color:#fff;width:22px;height:22px;border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:bold;margin-right:6px;font-family:system-ui,sans-serif;vertical-align:middle;';
            stepLabel.textContent = idx + 1;

            const parent = field.parentElement;
            if (parent) {
              parent.insertBefore(stepLabel, field);
              this._formStepLabels.push({ field, stepLabel });
            }
          });
        });
      } else {
        this._formStepLabels.forEach(({ field, stepLabel }) => {
          try { field.removeAttribute('data-accessiflow-step'); stepLabel.remove(); } catch (e) { /* skip */ }
        });
        this._formStepLabels = [];
      }
    } catch (e) { this._warn('applyFormSteps: ' + e.message); }
  }

  // ── 10. Break Timer ──────────────────────────────────────
  applyBreakTimer(active, minutes) {
    try {
      if (active) {
        if (this._breakTimerEl) return;
        const interval = (minutes || 20) * 60 * 1000; // ms

        this._breakTimerInterval = setInterval(() => {
          // Show break reminder
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
          overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:2147483646;';
          overlay.addEventListener('click', () => { reminder.remove(); overlay.remove(); });

          document.body.appendChild(overlay);
          document.body.appendChild(reminder);

          try {
            const utter = new SpeechSynthesisUtterance('Time for a break. Rest your eyes and stretch.');
            window.speechSynthesis.speak(utter);
          } catch (e) { /* skip */ }
        }, interval);
        this._breakTimerEl = true;
      } else {
        if (this._breakTimerInterval) { clearInterval(this._breakTimerInterval); this._breakTimerInterval = null; }
        this._breakTimerEl = null;
        const existing = document.getElementById('accessiflow-break-reminder');
        if (existing) existing.remove();
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
      this.applyReadingMask(!!settings.readingMask);
      this.applyLineRuler(!!settings.lineRuler);
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
