// AccessiFlow HearingModule
// Caption images, mute videos, closed caption support
'use strict';

class HearingModule {
  constructor() {
    this._captionedImgs = [];
    this._captionObserver = null;
    this._mutedVideos = [];
    this._muteObserver = null;
    this._captionBadges = [];
    // New features
    this._transcriptionEl = null;
    this._transcriptionRecognition = null;
    this._soundVisualizer = null;
    this._soundAudioContext = null;
    this._soundAnalyser = null;
    this._soundAnimFrame = null;
    this._visualAlertHandler = null;
    this._captionStyleEl = null;
  }

  _log(msg) { console.log('[AccessiFlow][Hearing] ' + msg); }
  _warn(msg) { console.warn('[AccessiFlow][Hearing] ' + msg); }

  // ── 1. Caption images ────────────────────────────────────
  _captionImage(img) {
    try {
      if (img.getAttribute('data-accessiflow-captioned')) return;
      const alt = img.getAttribute('alt');
      if (!alt || !alt.trim()) return;

      const figcaption = document.createElement('figcaption');
      figcaption.textContent = alt;
      figcaption.setAttribute('data-accessiflow-caption', 'true');
      figcaption.style.cssText = 'font-style:italic;font-size:12px;text-align:center;color:#555;padding:4px 0;font-family:system-ui,sans-serif;';

      const existingFigure = img.closest('figure');
      if (existingFigure) {
        existingFigure.appendChild(figcaption);
        this._captionedImgs.push({ img, figcaption, figure: null });
      } else {
        const figure = document.createElement('figure');
        figure.style.cssText = 'margin:0;padding:0;display:inline-block;';
        figure.setAttribute('data-accessiflow-figure', 'true');
        img.parentNode.insertBefore(figure, img);
        figure.appendChild(img);
        figure.appendChild(figcaption);
        this._captionedImgs.push({ img, figcaption, figure });
      }
      img.setAttribute('data-accessiflow-captioned', 'true');
    } catch (e) { this._warn('_captionImage: ' + e.message); }
  }

  toggleCaptionImages(active) {
    try {
      if (active) {
        document.querySelectorAll('img').forEach(img => this._captionImage(img));
        this._captionObserver = new MutationObserver((muts) => {
          muts.forEach(m => {
            m.addedNodes.forEach(n => {
              if (n.nodeType !== 1) return;
              if (n.matches && n.matches('img')) this._captionImage(n);
              if (n.querySelectorAll) n.querySelectorAll('img').forEach(img => this._captionImage(img));
            });
          });
        });
        this._captionObserver.observe(document.body, { childList: true, subtree: true });
      } else {
        if (this._captionObserver) { this._captionObserver.disconnect(); this._captionObserver = null; }
        this._captionedImgs.forEach(({ img, figcaption, figure }) => {
          try {
            img.removeAttribute('data-accessiflow-captioned');
            figcaption.remove();
            if (figure) {
              figure.parentNode.insertBefore(img, figure);
              figure.remove();
            }
          } catch (err) { /* skip */ }
        });
        this._captionedImgs = [];
      }
    } catch (e) { this._warn('toggleCaptionImages: ' + e.message); }
  }

  // ── 2. Mute videos ──────────────────────────────────────
  _muteVideo(video) {
    try {
      if (video.getAttribute('data-accessiflow-muted')) return;
      const wasMuted = video.muted;
      video.muted = true;
      video.setAttribute('data-accessiflow-muted', wasMuted ? 'was-muted' : 'was-unmuted');

      // Add MUTED badge
      const badge = document.createElement('div');
      badge.textContent = 'MUTED';
      badge.setAttribute('aria-hidden', 'true');
      badge.setAttribute('data-accessiflow-mute-badge', 'true');
      badge.style.cssText = 'position:absolute;top:8px;right:8px;background:rgba(239,68,68,0.9);color:#fff;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:bold;z-index:10;font-family:system-ui,sans-serif;';

      const parent = video.parentElement;
      if (parent) {
        const pos = window.getComputedStyle(parent).position;
        if (pos === 'static') parent.style.position = 'relative';
        parent.appendChild(badge);
      }
      this._mutedVideos.push({ video, badge, wasMuted });
    } catch (e) { this._warn('_muteVideo: ' + e.message); }
  }

  toggleMuteVideos(active) {
    try {
      if (active) {
        document.querySelectorAll('video').forEach(v => this._muteVideo(v));
        this._muteObserver = new MutationObserver((muts) => {
          muts.forEach(m => {
            m.addedNodes.forEach(n => {
              if (n.nodeType !== 1) return;
              if (n.matches && n.matches('video')) this._muteVideo(n);
              if (n.querySelectorAll) n.querySelectorAll('video').forEach(v => this._muteVideo(v));
            });
          });
        });
        this._muteObserver.observe(document.body, { childList: true, subtree: true });
      } else {
        if (this._muteObserver) { this._muteObserver.disconnect(); this._muteObserver = null; }
        this._mutedVideos.forEach(({ video, badge, wasMuted }) => {
          try {
            video.muted = wasMuted;
            video.removeAttribute('data-accessiflow-muted');
            badge.remove();
          } catch (err) { /* skip */ }
        });
        this._mutedVideos = [];
      }
    } catch (e) { this._warn('toggleMuteVideos: ' + e.message); }
  }

  // ── 3. Closed caption support ────────────────────────────
  addClosedCaptionSupport() {
    try {
      document.querySelectorAll('video:not([data-accessiflow-cc-checked])').forEach(video => {
        try {
          video.setAttribute('data-accessiflow-cc-checked', 'true');
          const track = video.querySelector('track[kind="subtitles"], track[kind="captions"]');
          if (track) {
            // Enable existing track
            track.mode = 'showing';
            if (track.track) track.track.mode = 'showing';
          } else {
            // Inject warning badge
            const badge = document.createElement('div');
            badge.textContent = 'No captions available';
            badge.setAttribute('aria-hidden', 'true');
            badge.setAttribute('data-accessiflow-cc-badge', 'true');
            badge.style.cssText = 'position:absolute;bottom:8px;left:8px;background:rgba(245,158,11,0.9);color:#000;padding:4px 10px;border-radius:4px;font-size:11px;font-weight:bold;z-index:10;font-family:system-ui,sans-serif;';
            const parent = video.parentElement;
            if (parent) {
              const pos = window.getComputedStyle(parent).position;
              if (pos === 'static') parent.style.position = 'relative';
              parent.appendChild(badge);
              this._captionBadges.push(badge);
            }
          }
        } catch (err) { /* skip */ }
      });
    } catch (e) { this._warn('addClosedCaptionSupport: ' + e.message); }
  }

  // ── 4. Real-Time Transcription ─────────────────────────────
  applyTranscription(active) {
    try {
      if (active) {
        if (this._transcriptionEl) return;
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
          this._warn('SpeechRecognition API not supported');
          return;
        }

        // Create transcript display
        const el = document.createElement('div');
        el.id = 'accessiflow-transcription';
        el.setAttribute('role', 'log');
        el.setAttribute('aria-label', 'Live audio transcription');
        el.setAttribute('aria-live', 'polite');
        el.style.cssText = 'position:fixed;bottom:10px;left:10px;right:10px;max-height:150px;overflow-y:auto;background:rgba(14,15,19,0.95);border:2px solid #4fffb0;border-radius:12px;padding:12px 16px;color:#e0e0e0;font-size:14px;z-index:2147483640;font-family:system-ui,sans-serif;line-height:1.6;';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        header.innerHTML = '<span style="color:#4fffb0;font-weight:bold;font-size:12px;">🎤 LIVE TRANSCRIPTION</span>';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '✕';
        closeBtn.setAttribute('aria-label', 'Close transcription');
        closeBtn.style.cssText = 'background:#ef4444;color:#fff;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:12px;font-weight:bold;';
        closeBtn.addEventListener('click', () => { this.applyTranscription(false); });
        header.appendChild(closeBtn);
        el.appendChild(header);

        const transcript = document.createElement('div');
        transcript.id = 'accessiflow-transcript-text';
        el.appendChild(transcript);

        document.body.appendChild(el);
        this._transcriptionEl = el;

        // Start recognition
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = document.documentElement.lang || 'en-US';

        recognition.onresult = (event) => {
          let interimText = '';
          let finalText = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              finalText += event.results[i][0].transcript + ' ';
            } else {
              interimText += event.results[i][0].transcript;
            }
          }
          if (finalText) {
            const p = document.createElement('p');
            p.style.cssText = 'margin:2px 0;padding:2px 0;border-bottom:1px solid #2a2d35;';
            p.textContent = finalText.trim();
            transcript.appendChild(p);
            el.scrollTop = el.scrollHeight;
          }
          // Show interim
          let interimEl = transcript.querySelector('#accessiflow-interim');
          if (!interimEl) {
            interimEl = document.createElement('p');
            interimEl.id = 'accessiflow-interim';
            interimEl.style.cssText = 'color:#888;font-style:italic;margin:2px 0;';
            transcript.appendChild(interimEl);
          }
          interimEl.textContent = interimText;
        };

        recognition.onend = () => {
          if (this._transcriptionRecognition) {
            try { recognition.start(); } catch (e) { /* skip */ }
          }
        };

        recognition.onerror = () => { /* will restart via onend */ };

        try { recognition.start(); } catch (e) { this._warn('Transcription start error: ' + e.message); }
        this._transcriptionRecognition = recognition;
      } else {
        if (this._transcriptionRecognition) {
          try { this._transcriptionRecognition.stop(); } catch (e) { /* skip */ }
          this._transcriptionRecognition = null;
        }
        if (this._transcriptionEl) { this._transcriptionEl.remove(); this._transcriptionEl = null; }
      }
    } catch (e) { this._warn('applyTranscription: ' + e.message); }
  }

  // ── 5. Sound Visualization ────────────────────────────────
  applySoundVisualization(active) {
    try {
      if (active) {
        if (this._soundVisualizer) return;

        const canvas = document.createElement('canvas');
        canvas.id = 'accessiflow-sound-viz';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.width = 200;
        canvas.height = 50;
        canvas.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:2147483640;border:1px solid #4fffb0;border-radius:8px;background:rgba(14,15,19,0.9);';
        document.body.appendChild(canvas);
        this._soundVisualizer = canvas;

        // Get audio from page videos or microphone
        try {
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          this._soundAudioContext = audioCtx;
          this._soundAnalyser = analyser;

          // Try to capture from page videos first
          const video = document.querySelector('video');
          if (video) {
            const source = audioCtx.createMediaElementSource(video);
            source.connect(analyser);
            analyser.connect(audioCtx.destination);
          } else {
            // Fallback: show static visualization
            const ctx = canvas.getContext('2d');
            const draw = () => {
              ctx.fillStyle = '#0e0f13';
              ctx.fillRect(0, 0, 200, 50);
              ctx.fillStyle = '#4fffb0';
              for (let i = 0; i < 20; i++) {
                const h = Math.random() * 30 + 5;
                ctx.fillRect(i * 10, 50 - h, 8, h);
              }
            };
            draw();
            return;
          }

          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          const ctx = canvas.getContext('2d');

          const draw = () => {
            if (!this._soundVisualizer) return;
            this._soundAnimFrame = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);

            ctx.fillStyle = '#0e0f13';
            ctx.fillRect(0, 0, 200, 50);

            const barWidth = 200 / bufferLength;
            for (let i = 0; i < bufferLength; i++) {
              const barHeight = (dataArray[i] / 255) * 50;
              ctx.fillStyle = '#4fffb0';
              ctx.fillRect(i * barWidth, 50 - barHeight, barWidth - 1, barHeight);
            }
          };
          draw();
        } catch (audioErr) {
          this._warn('Audio visualization setup error: ' + audioErr.message);
        }
      } else {
        if (this._soundAnimFrame) { cancelAnimationFrame(this._soundAnimFrame); this._soundAnimFrame = null; }
        if (this._soundAudioContext) { try { this._soundAudioContext.close(); } catch (e) { /* skip */ } this._soundAudioContext = null; }
        this._soundAnalyser = null;
        if (this._soundVisualizer) { this._soundVisualizer.remove(); this._soundVisualizer = null; }
      }
    } catch (e) { this._warn('applySoundVisualization: ' + e.message); }
  }

  // ── 6. Visual Alerts for Audio Cues ───────────────────────
  applyVisualAlerts(active) {
    try {
      if (active) {
        if (this._visualAlertHandler) return;

        // Flash screen border when audio plays
        this._visualAlertHandler = (e) => {
          if (e.target && (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO')) {
            // Flash the screen edges
            const flash = document.createElement('div');
            flash.setAttribute('aria-hidden', 'true');
            flash.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483641;border:6px solid #f59e0b;box-sizing:border-box;animation:accessiflow-visual-alert 0.5s ease-out forwards;';
            document.body.appendChild(flash);
            setTimeout(() => { try { flash.remove(); } catch (e) { /* skip */ } }, 600);
          }
        };

        // Inject animation CSS
        if (!this._captionStyleEl) {
          this._captionStyleEl = document.createElement('style');
          this._captionStyleEl.id = 'accessiflow-hearing-extra-style';
          document.head.appendChild(this._captionStyleEl);
        }
        this._captionStyleEl.textContent += '@keyframes accessiflow-visual-alert { 0% { opacity:1; } 100% { opacity:0; } }\n';

        document.addEventListener('play', this._visualAlertHandler, true);
      } else {
        if (this._visualAlertHandler) {
          document.removeEventListener('play', this._visualAlertHandler, true);
          this._visualAlertHandler = null;
        }
      }
    } catch (e) { this._warn('applyVisualAlerts: ' + e.message); }
  }

  // ── 7. Caption Styling ────────────────────────────────────
  applyCaptionStyling(active, options) {
    try {
      if (active) {
        if (!this._captionStyleEl) {
          this._captionStyleEl = document.createElement('style');
          this._captionStyleEl.id = 'accessiflow-hearing-extra-style';
          document.head.appendChild(this._captionStyleEl);
        }
        const fontSize = (options && options.captionFontSize) || 16;
        const color = (options && options.captionColor) || '#ffffff';
        const bgColor = (options && options.captionBg) || 'rgba(0,0,0,0.8)';

        let css = '::cue { font-size: ' + fontSize + 'px !important; color: ' + color + ' !important; background-color: ' + bgColor + ' !important; font-family: system-ui, sans-serif !important; line-height: 1.4 !important; }\n';
        css += 'track[kind="subtitles"]::cue, track[kind="captions"]::cue { font-size: ' + fontSize + 'px !important; }\n';
        this._captionStyleEl.textContent = css;
      } else {
        if (this._captionStyleEl) { this._captionStyleEl.remove(); this._captionStyleEl = null; }
      }
    } catch (e) { this._warn('applyCaptionStyling: ' + e.message); }
  }

  apply(settings) {
    try {
      this.toggleCaptionImages(!!settings.captionImages);
      this.toggleMuteVideos(!!settings.muteVideos);
      if (settings.captionImages || settings.muteVideos) {
        this.addClosedCaptionSupport();
      }
      this.applyTranscription(!!settings.liveTranscription);
      this.applySoundVisualization(!!settings.soundVisualization);
      this.applyVisualAlerts(!!settings.visualAlerts);
      this.applyCaptionStyling(!!settings.captionStyling, settings);
    } catch (e) { this._warn('apply: ' + e.message); }
  }

  destroy() {
    try {
      this.toggleCaptionImages(false);
      this.toggleMuteVideos(false);
      this._captionBadges.forEach(b => { try { b.remove(); } catch (e) { /* skip */ } });
      this._captionBadges = [];
      this.applyTranscription(false);
      this.applySoundVisualization(false);
      this.applyVisualAlerts(false);
      this.applyCaptionStyling(false);
    } catch (e) { this._warn('destroy: ' + e.message); }
  }
}

if (typeof window !== 'undefined') window.HearingModule = HearingModule;
