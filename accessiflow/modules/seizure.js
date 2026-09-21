// AccessiFlow SeizureModule
// Seizure & Vestibular disorder protections
// Flash detection, reduce motion, static GIFs, remove BG videos
'use strict';

class SeizureModule {
  constructor() {
    this._styleEl = null;
    this._frozenGifs = [];
    this._removedBgVideos = [];
    this._flashObserver = null;
    this._animationFrameId = null;

    // Micro-animation interceptor
    this._interceptorOn = false;
    this._pausedAnimations = [];
    this._animationStartHandler = null;
    this._animationSweep = null;
    this._tickerObserver = null;
    this._frozenTickers = new Map();
    this._hookFeatures = null;
  }

  _log(msg) { console.log('[AccessiFlow][Seizure] ' + msg); }
  _warn(msg) { console.warn('[AccessiFlow][Seizure] ' + msg); }

  _getStyle() {
    if (!this._styleEl || !document.head.contains(this._styleEl)) {
      this._styleEl = document.getElementById('accessiflow-seizure-style');
      if (!this._styleEl) {
        this._styleEl = document.createElement('style');
        this._styleEl.id = 'accessiflow-seizure-style';
        document.head.appendChild(this._styleEl);
      }
    }
    return this._styleEl;
  }

  buildCSS(s) {
    let css = '';
    try {
      if (s.reduceMotion) {
        css += '*, *::before, *::after {\n';
        css += '  animation-duration: 0.001ms !important;\n';
        css += '  animation-iteration-count: 1 !important;\n';
        css += '  transition-duration: 0.001ms !important;\n';
        css += '  scroll-behavior: auto !important;\n';
        css += '}\n';
        css += 'html { scroll-behavior: auto !important; }\n';
        // Disable parallax
        css += '[style*="background-attachment: fixed"], [style*="background-attachment:fixed"] { background-attachment: scroll !important; }\n';
        css += '.parallax, [class*="parallax"] { transform: none !important; }\n';
      }
      if (s.staticGifs) {
        css += 'img[src$=".gif"], img[src*=".gif?"] { image-rendering: optimizeSpeed; }\n';
      }
      if (s.disableAutoplay) {
        css += 'video[autoplay] { display: none !important; }\n';
      }
    } catch (e) { this._warn('buildCSS: ' + e.message); }
    return css;
  }

  // ── 1. Flash/Strobe Detection ─────────────────────────────
  applyFlashDetection(active) {
    try {
      if (active) {
        this._log('Flash detection enabled, monitoring videos');
        // Find all videos and monitor luminance changes
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
          if (video.getAttribute('data-accessiflow-flash-checked')) return;
          video.setAttribute('data-accessiflow-flash-checked', 'true');

          const canvas = document.createElement('canvas');
          canvas.width = 16;
          canvas.height = 16;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          let lastLuminance = 0;
          let flashCount = 0;
          let lastResetTime = Date.now();

          const checkFlash = () => {
            if (video.paused || video.ended) return;
            try {
              ctx.drawImage(video, 0, 0, 16, 16);
              const data = ctx.getImageData(0, 0, 16, 16).data;
              let totalLum = 0;
              for (let i = 0; i < data.length; i += 4) {
                totalLum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
              }
              const avgLum = totalLum / (16 * 16);
              const diff = Math.abs(avgLum - lastLuminance);
              lastLuminance = avgLum;

              const now = Date.now();
              if (now - lastResetTime > 1000) {
                if (flashCount > 3) {
                  // WCAG 2.3.1 violation, pause
                  video.pause();
                  this._warn('Video paused: >3 flashes per second detected');
                  this._injectFlashWarning(video);
                }
                flashCount = 0;
                lastResetTime = now;
              }
              if (diff > 40) flashCount++;
            } catch (e) { /* CORS or other error */ }
            if (!video.paused) requestAnimationFrame(checkFlash);
          };

          video.addEventListener('play', () => requestAnimationFrame(checkFlash));
          if (!video.paused) requestAnimationFrame(checkFlash);
        });

        // Also check CSS animations for rapid changes
        this._flashObserver = new MutationObserver(muts => {
          muts.forEach(m => {
            m.addedNodes.forEach(n => {
              if (n.nodeType !== 1) return;
              const vids = n.matches && n.matches('video') ? [n] : (n.querySelectorAll ? Array.from(n.querySelectorAll('video')) : []);
              vids.forEach(v => {
                if (!v.getAttribute('data-accessiflow-flash-checked')) {
                  this.applyFlashDetection(true); // Re-run on new videos
                }
              });
            });
          });
        });
        this._flashObserver.observe(document.body, { childList: true, subtree: true });
      } else {
        if (this._flashObserver) { this._flashObserver.disconnect(); this._flashObserver = null; }
        document.querySelectorAll('[data-accessiflow-flash-checked]').forEach(v => v.removeAttribute('data-accessiflow-flash-checked'));
        document.querySelectorAll('.accessiflow-flash-warning').forEach(w => w.remove());
      }
    } catch (e) { this._warn('applyFlashDetection: ' + e.message); }
  }

  _injectFlashWarning(video) {
    try {
      const warning = document.createElement('div');
      warning.className = 'accessiflow-flash-warning';
      warning.setAttribute('role', 'alert');
      warning.textContent = '⚠ Video paused: rapid flashing detected (seizure risk)';
      warning.style.cssText = 'background:#ff5555;color:#fff;padding:10px 16px;border-radius:6px;font-size:13px;font-weight:bold;text-align:center;margin:8px 0;font-family:system-ui,sans-serif;';
      video.parentNode.insertBefore(warning, video.nextSibling);
    } catch (e) { /* skip */ }
  }

  // ── 2. Reduce Motion ──────────────────────────────────────
  applyReduceMotion(active) {
    try {
      if (active) {
        // Stop all carousels/sliders by clicking pause buttons
        document.querySelectorAll('[class*="carousel"], [class*="slider"], [class*="slideshow"]').forEach(el => {
          const pauseBtn = el.querySelector('[aria-label*="pause"], [class*="pause"], button[class*="stop"]');
          if (pauseBtn) try { pauseBtn.click(); } catch (e) { /* skip */ }
        });
        // Pause marquee elements
        document.querySelectorAll('marquee').forEach(m => { try { m.stop(); } catch (e) { /* skip */ } });
        this._log('Reduce motion applied');
      } else {
        document.querySelectorAll('marquee').forEach(m => { try { m.start(); } catch (e) { /* skip */ } });
      }
    } catch (e) { this._warn('applyReduceMotion: ' + e.message); }
  }

  // ── 3. Static GIFs (freeze on first frame) ────────────────
  applyStaticGifs(active) {
    try {
      if (active) {
        document.querySelectorAll('img[src$=".gif"], img[src*=".gif?"]').forEach(img => {
          if (img.getAttribute('data-accessiflow-frozen')) return;
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width || 200;
            canvas.height = img.naturalHeight || img.height || 200;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/png');
            const originalSrc = img.src;
            img.setAttribute('data-accessiflow-original-gif', originalSrc);
            img.setAttribute('data-accessiflow-frozen', 'true');
            img.src = dataUrl;
            this._frozenGifs.push(img);
          } catch (e) { /* CORS, can't freeze cross-origin */ }
        });
        this._log('Froze ' + this._frozenGifs.length + ' GIFs');
      } else {
        this._frozenGifs.forEach(img => {
          try {
            const orig = img.getAttribute('data-accessiflow-original-gif');
            if (orig) img.src = orig;
            img.removeAttribute('data-accessiflow-frozen');
            img.removeAttribute('data-accessiflow-original-gif');
          } catch (e) { /* skip */ }
        });
        this._frozenGifs = [];
      }
    } catch (e) { this._warn('applyStaticGifs: ' + e.message); }
  }

  // ── 4. Remove Background Videos ───────────────────────────
  applyDisableAutoplay(active) {
    try {
      if (active) {
        document.querySelectorAll('video[autoplay], video[data-autoplay]').forEach(video => {
          try {
            video.pause();
            video.removeAttribute('autoplay');
            const cs = window.getComputedStyle(video.parentElement || video);
            // If video is used as background (position absolute/fixed, z-index < 0 or covers whole viewport)
            const isBg = (cs.position === 'absolute' || cs.position === 'fixed') && video.muted;
            if (isBg) {
              video.style.display = 'none';
              this._removedBgVideos.push(video);
              this._log('Hidden background video');
            } else {
              // Just pause, don't hide
              video.setAttribute('data-accessiflow-autoplay-paused', 'true');
              this._removedBgVideos.push(video);
            }
          } catch (e) { /* skip */ }
        });
      } else {
        this._removedBgVideos.forEach(video => {
          try {
            video.style.display = '';
            video.removeAttribute('data-accessiflow-autoplay-paused');
          } catch (e) { /* skip */ }
        });
        this._removedBgVideos = [];
      }
    } catch (e) { this._warn('applyDisableAutoplay: ' + e.message); }
  }

  // ── 5. Aggressive micro-animation interceptor ─────────────
  //
  // The CSS above stops anything declared in a stylesheet. It does nothing to
  // the three kinds of movement that cause most of the trouble:
  //
  //   * animations driven from JavaScript through the Web Animations API,
  //     which no stylesheet override can reach
  //   * tickers and counters that rewrite their own text several times a
  //     second
  //   * elements blinking by toggling their own visibility
  //
  // Canvas loops and smooth scrolling need the page's own globals, so those
  // are handled by page-hook.js in the page world. Everything here runs in
  // the content script.
  applyMotionInterceptor(active, settings) {
    try {
      if (active) {
        if (this._interceptorOn) return;
        this._interceptorOn = true;
        const s = settings || {};

        this._pauseWebAnimations();

        // Animations that start later have to be caught too. animationstart
        // fires for CSS animations; the polled sweep catches Web Animations
        // started from script, which raise no event.
        this._animationStartHandler = () => this._pauseWebAnimations();
        document.addEventListener('animationstart', this._animationStartHandler, true);
        document.addEventListener('transitionstart', this._animationStartHandler, true);
        this._animationSweep = setInterval(() => {
          if (document.hidden) return;
          this._pauseWebAnimations();
        }, 1000);

        this._watchTickers();
        if (s.freezeCanvas) this._freezePageWorld({ canvas: true, scroll: true });
        else this._freezePageWorld({ canvas: false, scroll: true });
      } else {
        if (!this._interceptorOn) return;
        this._interceptorOn = false;

        if (this._animationStartHandler) {
          document.removeEventListener('animationstart', this._animationStartHandler, true);
          document.removeEventListener('transitionstart', this._animationStartHandler, true);
          this._animationStartHandler = null;
        }
        if (this._animationSweep) { clearInterval(this._animationSweep); this._animationSweep = null; }

        this._resumeWebAnimations();
        this._unwatchTickers();
        this._thawPageWorld();
      }
    } catch (e) { this._warn('applyMotionInterceptor: ' + e.message); }
  }

  /**
   * Pauses every running animation, including ones started from script.
   *
   * Pausing rather than cancelling matters: cancel() would snap an element
   * back to its start state, which for the very common fade-in-on-scroll
   * pattern means opacity 0, and the content would vanish.
   */
  _pauseWebAnimations() {
    try {
      if (typeof document.getAnimations !== 'function') return;
      const animations = document.getAnimations();
      for (let i = 0; i < animations.length; i++) {
        const animation = animations[i];
        try {
          if (animation.playState !== 'running') continue;
          const target = animation.effect && animation.effect.target;
          if (target && target.closest && target.closest('[id^="accessiflow-"]')) continue;

          // An animation that is nearly done is let finish. Freezing a
          // fade-in at 90% leaves content half-transparent for good, which is
          // worse than the last fraction of a second of movement.
          const timing = animation.effect && animation.effect.getComputedTiming
            ? animation.effect.getComputedTiming() : null;
          if (timing && timing.iterations !== Infinity && typeof timing.progress === 'number' &&
            timing.progress > 0.8) {
            animation.finish();
            continue;
          }

          animation.pause();
          this._pausedAnimations.push(animation);
        } catch (err) { /* an animation can finish mid-loop */ }
      }
    } catch (e) { this._warn('_pauseWebAnimations: ' + e.message); }
  }

  _resumeWebAnimations() {
    for (let i = 0; i < this._pausedAnimations.length; i++) {
      try { this._pausedAnimations[i].play(); } catch (e) { /* gone */ }
    }
    this._pausedAnimations = [];
  }

  /**
   * Finds elements rewriting their own text several times a second and pins
   * them to their current value.
   *
   * Live prices, countdowns and news crawlers all do this. For someone with
   * ADHD or a vestibular disorder, text that will not hold still is the single
   * most distracting thing a page can contain, and none of it is reachable
   * from CSS.
   */
  _watchTickers() {
    if (this._tickerObserver) return;
    const counts = new Map();

    this._tickerObserver = new MutationObserver(mutations => {
      if (!this._interceptorOn) return;
      const now = Date.now();

      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];

        // Both shapes of the same event. `node.nodeValue = x` reports as
        // characterData, while the far more common `el.textContent = x`
        // replaces the child text node and reports as childList. Watching only
        // the first misses most real tickers.
        let host = null;
        if (m.type === 'characterData') {
          host = m.target.parentElement;
        } else if (m.type === 'childList') {
          const target = m.target;
          if (!target || target.nodeType !== 1) continue;
          // Only when the change is text, not structure. A list gaining a row
          // is the page working, not a ticker.
          const touched = [].concat(
            Array.prototype.slice.call(m.addedNodes),
            Array.prototype.slice.call(m.removedNodes)
          );
          if (!touched.length || !touched.every(n => n.nodeType === 3)) continue;
          host = target;
        } else {
          continue;
        }

        if (!host) continue;
        if (host.closest('[id^="accessiflow-"]')) continue;
        // Never freeze a live region: it exists to announce changes, and
        // pinning it would silence the very updates a screen reader needs.
        if (host.closest('[aria-live], [role="status"], [role="alert"], [role="log"]')) continue;
        if (host.isContentEditable) continue;
        if (host.closest('input, textarea')) continue;

        let record = counts.get(host);
        if (!record || now - record.since > 1000) {
          record = { count: 0, since: now };
          counts.set(host, record);
        }
        record.count++;

        // Twice a second, sustained, is a ticker rather than a page doing
        // ordinary work.
        if (record.count >= 3 && !this._frozenTickers.has(host)) {
          this._freezeTicker(host);
        }
      }
    });

    this._tickerObserver.observe(document.body, {
      characterData: true,
      childList: true,
      subtree: true
    });
  }

  _freezeTicker(host) {
    try {
      const frozenText = host.textContent;
      this._frozenTickers.set(host, {
        html: host.innerHTML,
        observer: null
      });

      // The element keeps being rewritten by the page's own script; putting
      // the value back each time is what holds it still, without breaking the
      // script that is doing the writing.
      const guard = new MutationObserver(() => {
        if (!this._interceptorOn) return;
        if (host.textContent !== frozenText) {
          guard.disconnect();
          host.textContent = frozenText;
          guard.observe(host, { characterData: true, childList: true, subtree: true });
        }
      });
      guard.observe(host, { characterData: true, childList: true, subtree: true });
      this._frozenTickers.get(host).observer = guard;

      host.setAttribute('data-accessiflow-frozen-ticker', 'true');
      this._log('froze a ticker: "' + String(frozenText).slice(0, 40) + '"');
    } catch (e) { this._warn('_freezeTicker: ' + e.message); }
  }

  _unwatchTickers() {
    if (this._tickerObserver) { this._tickerObserver.disconnect(); this._tickerObserver = null; }

    this._frozenTickers.forEach((record, host) => {
      try {
        if (record.observer) record.observer.disconnect();
        host.innerHTML = record.html;
        host.removeAttribute('data-accessiflow-frozen-ticker');
      } catch (e) { /* gone */ }
    });
    this._frozenTickers = new Map();
  }

  // ── The page world ────────────────────────────────────────
  //
  // Canvas loops and JavaScript-driven smooth scrolling live in the page's own
  // globals, which a content script cannot reach. page-hook.js is injected
  // into the page world to do that part, and is spoken to by postMessage.

  _freezePageWorld(features) {
    // Through the shared bridge, which queues the command until the hook has
    // loaded. This used to post straight after appending the hook's script,
    // which runs asynchronously, so the first freeze could arrive before
    // anything was listening and be lost.
    const bridge = globalThis.AccessiFlowPageBridge;
    if (!bridge) return;
    bridge.send('freeze', { features: features });
    this._hookFeatures = features;
  }

  _thawPageWorld() {
    const bridge = globalThis.AccessiFlowPageBridge;
    if (!bridge || !bridge.injected || !this._hookFeatures) return;
    bridge.send('thaw');
    this._hookFeatures = null;
  }

  apply(settings) {
    try {
      const css = this.buildCSS(settings);
      this._getStyle().textContent = css;
      this.applyFlashDetection(!!settings.flashDetection);
      this.applyReduceMotion(!!settings.reduceMotion);
      this.applyStaticGifs(!!settings.staticGifs);
      this.applyDisableAutoplay(!!settings.disableAutoplay);
      this.applyMotionInterceptor(!!settings.motionInterceptor, settings);
    } catch (e) { this._warn('apply: ' + e.message); }
  }

  destroy() {
    try {
      if (this._styleEl) { this._styleEl.remove(); this._styleEl = null; }
      this.applyFlashDetection(false);
      this.applyReduceMotion(false);
      this.applyStaticGifs(false);
      this.applyDisableAutoplay(false);
      this.applyMotionInterceptor(false);
    } catch (e) { this._warn('destroy: ' + e.message); }
  }
}

if (typeof window !== 'undefined') window.SeizureModule = SeizureModule;
