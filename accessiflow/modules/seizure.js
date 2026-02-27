// AccessiFlow — SeizureModule
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
        this._log('Flash detection enabled — monitoring videos');
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
                  // WCAG 2.3.1 violation — pause
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
          } catch (e) { /* CORS — can't freeze cross-origin */ }
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

  apply(settings) {
    try {
      const css = this.buildCSS(settings);
      this._getStyle().textContent = css;
      this.applyFlashDetection(!!settings.flashDetection);
      this.applyReduceMotion(!!settings.reduceMotion);
      this.applyStaticGifs(!!settings.staticGifs);
      this.applyDisableAutoplay(!!settings.disableAutoplay);
    } catch (e) { this._warn('apply: ' + e.message); }
  }

  destroy() {
    try {
      if (this._styleEl) { this._styleEl.remove(); this._styleEl = null; }
      this.applyFlashDetection(false);
      this.applyReduceMotion(false);
      this.applyStaticGifs(false);
      this.applyDisableAutoplay(false);
    } catch (e) { this._warn('destroy: ' + e.message); }
  }
}

if (typeof window !== 'undefined') window.SeizureModule = SeizureModule;
