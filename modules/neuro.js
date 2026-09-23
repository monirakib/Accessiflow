// AccessiFlow NeuroModule
// Neurodiverse support: autism, ADHD, sensory processing
// Custom color themes, content warnings, focus timer, visual clutter reduction
'use strict';

class NeuroModule {
  constructor() {
    this._styleEl = null;
    this._focusTimer = null;
    this._focusTimerEl = null;
    this._focusTimerInterval = null;
    this._clutterHidden = [];
    this._contentWarnings = [];
    this._navOverlay = null;
    this._socialCuesEls = [];
  }

  _log(msg) { console.log('[AccessiFlow][Neuro] ' + msg); }
  _warn(msg) { console.warn('[AccessiFlow][Neuro] ' + msg); }

  _getStyle() {
    if (!this._styleEl || !document.head.contains(this._styleEl)) {
      this._styleEl = document.getElementById('accessiflow-neuro-style');
      if (!this._styleEl) {
        this._styleEl = document.createElement('style');
        this._styleEl.id = 'accessiflow-neuro-style';
        document.head.appendChild(this._styleEl);
      }
    }
    return this._styleEl;
  }

  buildCSS(s) {
    let css = '';
    try {
      // Colour mood. The filter half of each theme lives in
      // VisionModule.filterChain(), which composes every page-wide filter into
      // one declaration; emitting our own `html { filter: ... }` here used to
      // cancel whatever the Seeing panel had set, and be cancelled by it in
      // turn, depending only on which module happened to write last.
      if (s.neuroColorTheme === 'calm' && !s.smartDarkMode) {
        css += 'body { background-color: #f5f0e8 !important; }\n';
      }

      // Reduce visual clutter
      if (s.reduceClutter) {
        css += '[class*="popup"], [class*="modal"], [class*="overlay"]:not([role="dialog"]), [class*="toast"], [class*="notification"], [class*="banner"], [class*="promo"], [class*="ad-"], [class*="cookie"], .social-share, [class*="newsletter"], [class*="signup-prompt"], [class*="sticky-bar"], [class*="floating"] { display: none !important; }\n';
        css += '*, *::before, *::after { animation-duration: 0.01s !important; transition-duration: 0.01s !important; scroll-behavior: auto !important; }\n';
        css += '::-webkit-scrollbar { width: 8px; } ::-webkit-scrollbar-track { background: #1a1a1a; } ::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }\n';
      }

      // Low stimulation mode
      if (s.lowStimulation) {
        css += 'img, video, svg, canvas, iframe { filter: grayscale(0.5) brightness(0.9) !important; }\n';
        css += '* { border-color: #ccc !important; box-shadow: none !important; text-shadow: none !important; }\n';
        css += 'a { color: #336 !important; text-decoration: underline !important; }\n';
      }

      // Consistent navigation
      if (s.consistentNav) {
        css += '#accessiflow-consistent-nav { display: block !important; }\n';
      }
    } catch (e) { this._warn('buildCSS: ' + e.message); }
    return css;
  }

  // ── Focus Timer / Pomodoro ────────────────────────────────
  applyFocusTimer(active, minutes) {
    try {
      if (active) {
        if (this._focusTimerEl) return;
        const duration = (minutes || 25) * 60;
        let remaining = duration;

        const el = document.createElement('div');
        el.id = 'accessiflow-focus-timer';
        el.setAttribute('role', 'timer');
        el.setAttribute('aria-label', 'Focus timer');
        el.setAttribute('aria-live', 'off');
        el.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483640;background:#16181f;border:2px solid #4fffb0;border-radius:12px;padding:8px 20px;display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);font-family:system-ui,sans-serif;';

        const timeDisplay = document.createElement('span');
        timeDisplay.style.cssText = 'color:#4fffb0;font-size:24px;font-weight:bold;font-variant-numeric:tabular-nums;min-width:80px;text-align:center;';
        const formatTime = (s) => Math.floor(s / 60).toString().padStart(2, '0') + ':' + (s % 60).toString().padStart(2, '0');
        timeDisplay.textContent = formatTime(remaining);

        const progress = document.createElement('div');
        progress.style.cssText = 'width:100px;height:6px;background:#2a2d35;border-radius:3px;overflow:hidden;';
        const progressBar = document.createElement('div');
        progressBar.style.cssText = 'width:100%;height:100%;background:#4fffb0;border-radius:3px;transition:width 1s linear;';
        progress.appendChild(progressBar);

        const pauseBtn = document.createElement('button');
        pauseBtn.type = 'button';
        pauseBtn.textContent = '⏸';
        pauseBtn.setAttribute('aria-label', 'Pause timer');
        pauseBtn.style.cssText = 'width:32px;height:32px;background:#2a2d35;border:none;border-radius:6px;color:#e0e0e0;font-size:16px;cursor:pointer;';
        let paused = false;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '✕';
        closeBtn.setAttribute('aria-label', 'Close timer');
        closeBtn.style.cssText = 'width:32px;height:32px;background:#ef4444;border:none;border-radius:6px;color:#fff;font-size:14px;cursor:pointer;font-weight:bold;';
        closeBtn.addEventListener('click', () => { this.applyFocusTimer(false); });

        pauseBtn.addEventListener('click', () => {
          paused = !paused;
          pauseBtn.textContent = paused ? '▶' : '⏸';
          pauseBtn.setAttribute('aria-label', paused ? 'Resume timer' : 'Pause timer');
        });

        el.appendChild(timeDisplay);
        el.appendChild(progress);
        el.appendChild(pauseBtn);
        el.appendChild(closeBtn);
        document.body.appendChild(el);
        this._focusTimerEl = el;

        this._focusTimerInterval = setInterval(() => {
          if (paused) return;
          remaining--;
          timeDisplay.textContent = formatTime(Math.max(0, remaining));
          progressBar.style.width = ((remaining / duration) * 100) + '%';

          if (remaining <= 0) {
            clearInterval(this._focusTimerInterval);
            this._focusTimerInterval = null;
            el.style.borderColor = '#f59e0b';
            timeDisplay.style.color = '#f59e0b';
            timeDisplay.textContent = 'BREAK!';
            progressBar.style.width = '0%';

            // Announce break
            if (typeof window.AccessiFlowSpeak === 'function') {
              window.AccessiFlowSpeak('Time for a break! Well done.');
            }

            // Flash border
            let flash = 0;
            const flashInterval = setInterval(() => {
              el.style.borderColor = flash % 2 === 0 ? '#f59e0b' : '#4fffb0';
              flash++;
              if (flash > 10) clearInterval(flashInterval);
            }, 500);
          }
        }, 1000);
      } else {
        if (this._focusTimerInterval) { clearInterval(this._focusTimerInterval); this._focusTimerInterval = null; }
        if (this._focusTimerEl) { this._focusTimerEl.remove(); this._focusTimerEl = null; }
      }
    } catch (e) { this._warn('applyFocusTimer: ' + e.message); }
  }

  // ── Content Warnings ──────────────────────────────────────
  applyContentWarnings(active) {
    try {
      if (active) {
        // Scan for potentially distressing content and add warnings
        const triggerKeywords = [
          { pattern: /\b(death|dying|killed|murder|suicide)\b/gi, category: 'Violence/Death' },
          { pattern: /\b(blood|gore|graphic|disturbing)\b/gi, category: 'Graphic Content' },
          { pattern: /\b(abuse|assault|harassment|trauma)\b/gi, category: 'Sensitive Topics' },
          { pattern: /\b(flashing|strobe|flickering)\b/gi, category: 'Photosensitivity' },
          { pattern: /\b(spider|snake|insect|needle|injection)\b/gi, category: 'Phobia Triggers' }
        ];

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
          acceptNode: (node) => {
            if (node.getAttribute('data-accessiflow-cw')) return NodeFilter.FILTER_REJECT;
            if (node.matches('script, style, noscript, [aria-hidden="true"]')) return NodeFilter.FILTER_REJECT;
            const text = node.textContent || '';
            if (text.length < 20 || text.length > 5000) return NodeFilter.FILTER_SKIP;
            return NodeFilter.FILTER_ACCEPT;
          }
        });

        let node;
        const warned = new Set();
        while ((node = walker.nextNode())) {
          if (warned.has(node)) continue;
          const text = node.textContent;
          for (const trigger of triggerKeywords) {
            if (trigger.pattern.test(text)) {
              trigger.pattern.lastIndex = 0;
              // Only warn on "leaf" text containers (p, div, li, article sections)
              if (node.matches('p, li, td, blockquote, article, section, [role="article"]') && !node.querySelector('[data-accessiflow-cw]')) {
                const warning = document.createElement('div');
                warning.setAttribute('data-accessiflow-cw', 'true');
                warning.setAttribute('role', 'alert');
                warning.style.cssText = 'background:rgba(245,158,11,0.15);border-left:4px solid #f59e0b;padding:6px 12px;margin:4px 0;border-radius:0 6px 6px 0;font-size:12px;font-family:system-ui,sans-serif;color:#f59e0b;';
                warning.textContent = '⚠ Content Warning: ' + trigger.category;

                const showBtn = document.createElement('button');
                showBtn.type = 'button';
                showBtn.textContent = 'Show';
                showBtn.style.cssText = 'margin-left:8px;padding:2px 8px;background:#f59e0b;color:#000;border:none;border-radius:4px;font-size:11px;cursor:pointer;font-weight:bold;';
                const contentEl = node;
                const origDisplay = contentEl.style.display;
                contentEl.style.display = 'none';

                showBtn.addEventListener('click', () => {
                  contentEl.style.display = origDisplay || '';
                  warning.remove();
                });
                warning.appendChild(showBtn);

                node.parentNode.insertBefore(warning, node);
                this._contentWarnings.push({ warning, node, origDisplay });
                warned.add(node);
              }
              break;
            }
          }
        }
      } else {
        this._contentWarnings.forEach(({ warning, node, origDisplay }) => {
          try {
            warning.remove();
            node.style.display = origDisplay || '';
          } catch (e) { /* skip */ }
        });
        this._contentWarnings = [];
      }
    } catch (e) { this._warn('applyContentWarnings: ' + e.message); }
  }

  // ── Consistent Navigation Overlay ─────────────────────────
  applyConsistentNav(active) {
    try {
      if (active) {
        if (this._navOverlay) return;

        const nav = document.createElement('nav');
        nav.id = 'accessiflow-consistent-nav';
        nav.setAttribute('aria-label', 'Consistent Navigation');
        nav.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483638;background:#16181f;border-bottom:2px solid #4fffb0;padding:6px 16px;display:flex;align-items:center;gap:12px;font-family:system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,0.4);';

        // Create consistent nav items from page structure
        const navItems = [
          { label: '⬆ Top', action: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
          { label: '📑 Main', action: () => { const m = document.querySelector('main, [role="main"], #main, #content, .main-content'); if (m) m.scrollIntoView({ behavior: 'smooth' }); } },
          { label: '🔍 Search', action: () => { const s = document.querySelector('input[type="search"], input[name="q"], input[name="search"], [role="search"] input'); if (s) { s.scrollIntoView({ behavior: 'smooth' }); s.focus(); } } },
          { label: '🧭 Nav', action: () => { const n = document.querySelector('nav, [role="navigation"]'); if (n) n.scrollIntoView({ behavior: 'smooth' }); } },
          { label: '⬇ Footer', action: () => { const f = document.querySelector('footer, [role="contentinfo"]'); if (f) f.scrollIntoView({ behavior: 'smooth' }); } }
        ];

        navItems.forEach(item => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = item.label;
          btn.style.cssText = 'padding:4px 12px;background:#1e2029;border:1px solid #2a2d35;border-radius:6px;color:#e0e0e0;font-size:12px;cursor:pointer;white-space:nowrap;font-family:inherit;';
          btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#4fffb0'; btn.style.color = '#4fffb0'; });
          btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#2a2d35'; btn.style.color = '#e0e0e0'; });
          btn.addEventListener('click', item.action);
          nav.appendChild(btn);
        });

        // Heading jump dropdown
        const headingSelect = document.createElement('select');
        headingSelect.setAttribute('aria-label', 'Jump to heading');
        headingSelect.style.cssText = 'margin-left:auto;padding:4px 8px;background:#1e2029;border:1px solid #2a2d35;border-radius:6px;color:#e0e0e0;font-size:12px;max-width:200px;';
        const defaultOpt = document.createElement('option');
        defaultOpt.textContent = 'Jump to heading...';
        defaultOpt.value = '';
        headingSelect.appendChild(defaultOpt);

        document.querySelectorAll('h1, h2, h3, h4').forEach((h, i) => {
          const opt = document.createElement('option');
          opt.value = i;
          opt.textContent = h.tagName + ': ' + (h.textContent || '').trim().substring(0, 40);
          headingSelect.appendChild(opt);
        });

        headingSelect.addEventListener('change', () => {
          const idx = parseInt(headingSelect.value);
          if (!isNaN(idx)) {
            const headings = document.querySelectorAll('h1, h2, h3, h4');
            if (headings[idx]) headings[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });

        nav.appendChild(headingSelect);

        // Push body content down
        document.body.style.marginTop = (document.body.style.marginTop ? parseInt(document.body.style.marginTop) : 0) + 40 + 'px';

        document.body.appendChild(nav);
        this._navOverlay = nav;
      } else {
        if (this._navOverlay) {
          this._navOverlay.remove();
          this._navOverlay = null;
          // Restore body margin
          const mt = parseInt(document.body.style.marginTop) || 0;
          document.body.style.marginTop = Math.max(0, mt - 40) + 'px';
          if (parseInt(document.body.style.marginTop) === 0) document.body.style.marginTop = '';
        }
      }
    } catch (e) { this._warn('applyConsistentNav: ' + e.message); }
  }

  // ── Social Cues Helper (literal language tooltips) ────────
  applySocialCues(active) {
    try {
      if (active) {
        // Detect common idioms/figurative language and add literal explanations
        const idioms = {
          'break a leg': 'Meaning: Good luck!',
          'piece of cake': 'Meaning: Something very easy.',
          'hit the nail on the head': 'Meaning: To be exactly right.',
          'let the cat out of the bag': 'Meaning: To reveal a secret.',
          'bite the bullet': 'Meaning: To endure something painful.',
          'cost an arm and a leg': 'Meaning: Very expensive.',
          'once in a blue moon': 'Meaning: Very rarely.',
          'spill the beans': 'Meaning: To reveal a secret.',
          'kick the bucket': 'Meaning: To die (informal).',
          'under the weather': 'Meaning: Feeling sick.',
          'the ball is in your court': 'Meaning: It\'s your decision now.',
          'back to square one': 'Meaning: Start over from the beginning.',
          'on the same page': 'Meaning: In agreement.',
          'barking up the wrong tree': 'Meaning: Making a mistake / wrong assumption.'
        };

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let textNode;
        while ((textNode = walker.nextNode())) {
          const text = textNode.textContent.toLowerCase();
          for (const [idiom, explanation] of Object.entries(idioms)) {
            if (text.includes(idiom)) {
              const parent = textNode.parentElement;
              if (!parent || parent.getAttribute('data-accessiflow-idiom')) continue;
              parent.setAttribute('data-accessiflow-idiom', 'true');

              const tooltip = document.createElement('span');
              tooltip.setAttribute('data-accessiflow-social-cue', 'true');
              tooltip.style.cssText = 'display:inline;position:relative;border-bottom:2px dotted #6366f1;cursor:help;';
              tooltip.title = explanation;

              // We mark the parent but don't restructure DOM extensively to avoid breaking things
              parent.style.borderBottom = '2px dotted #6366f1';
              parent.title = (parent.title ? parent.title + ' | ' : '') + explanation;
              this._socialCuesEls.push(parent);
              break;
            }
          }
        }
      } else {
        this._socialCuesEls.forEach(el => {
          try {
            el.removeAttribute('data-accessiflow-idiom');
            el.style.borderBottom = '';
            el.title = '';
          } catch (e) { /* skip */ }
        });
        this._socialCuesEls = [];
      }
    } catch (e) { this._warn('applySocialCues: ' + e.message); }
  }

  apply(settings) {
    try {
      const css = this.buildCSS(settings);
      this._getStyle().textContent = css;
      this.applyFocusTimer(!!settings.focusTimer, settings.focusTimerMinutes || 25);
      this.applyContentWarnings(!!settings.contentWarnings);
      this.applyConsistentNav(!!settings.consistentNav);
      this.applySocialCues(!!settings.socialCues);
    } catch (e) { this._warn('apply: ' + e.message); }
  }

  destroy() {
    try {
      if (this._styleEl) { this._styleEl.remove(); this._styleEl = null; }
      this.applyFocusTimer(false);
      this.applyContentWarnings(false);
      this.applyConsistentNav(false);
      this.applySocialCues(false);
    } catch (e) { this._warn('destroy: ' + e.message); }
  }
}

if (typeof window !== 'undefined') window.NeuroModule = NeuroModule;
