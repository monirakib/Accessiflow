// AccessiFlow HearingModule
// Live captions from tab audio, sound cues, a sound meter, caption styling,
// captions on the page's own videos, and the microphone transcript
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
    this._captionStyleEl = null;

    // Live captions and sound, fed from the offscreen document
    this._meterWanted = false;
    this._meterEl = null;
    this._cueHandler = null;
    this._cueSettings = {};
    this._captureRunning = false;
    this._captionBox = null;
    this._captionLines = null;
    this._captionInterim = null;
    this._captionSettings = {};
  }

  _log(msg) { console.log('[AccessiFlow][Hearing] ' + msg); }
  _warn(msg) { console.warn('[AccessiFlow][Hearing] ' + msg); }

  /**
   * One watcher for videos and sound added later, shared by the labels and
   * muting. Each used to start a new watcher every time the page added
   * anything, and switching the feature off stopped only the last one, so the
   * others went on labelling and muting.
   */
  _watchMedia() {
    const wanted = this._labelsOn || this._muteOn;
    if (wanted && !this._mediaObserver) {
      this._mediaObserver = new MutationObserver(muts => {
        muts.forEach(m => m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;
          const found = n.matches && n.matches('video, audio, iframe') ? [n]
            : (n.querySelectorAll ? Array.from(n.querySelectorAll('video, audio, iframe')) : []);
          found.forEach(el => {
            if (this._labelsOn) this._labelMedia(el);
            if (this._muteOn && el.tagName === 'VIDEO') this._muteVideo(el);
          });
        }));
      });
      this._mediaObserver.observe(document.body, { childList: true, subtree: true });
    } else if (!wanted && this._mediaObserver) {
      this._mediaObserver.disconnect();
      this._mediaObserver = null;
    }
  }

  // ── 1. Label audio content ───────────────────────────────
  //
  // A label before each video and sound clip saying whether it has captions,
  // so someone who cannot hear it knows before pressing play whether they
  // will be able to follow it, and where to get captions when it has none.
  // (This used to write each picture's description underneath it instead,
  // which is not what the setting said it did.)
  _labelMedia(el) {
    try {
      if (!this._labelled) this._labelled = new WeakSet();
      if (this._labelled.has(el) || !el.parentNode || el.closest('[id^="accessiflow-"]')) return;
      let text;
      if (el.tagName === 'IFRAME') {
        const src = el.getAttribute('src') || '';
        if (!/youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com|dailymotion\.com|facebook\.com\/plugins\/video|player\./i.test(src)) return;
        text = 'Embedded video: look for its own CC button. Alt+Shift+W gives live captions.';
      } else {
        // Background sound with no controls is not something to follow.
        if (el.tagName === 'AUDIO' && !el.controls) return;
        const captions = Array.from(el.querySelectorAll('track')).some(t => /^(captions|subtitles)$/i.test(t.kind || 'subtitles'));
        const what = el.tagName === 'VIDEO' ? 'Video' : 'Sound clip';
        text = captions ? what + ' with captions.' : what + ' without captions. Alt+Shift+W gives live captions.';
      }
      const label = document.createElement('div');
      label.setAttribute('data-accessiflow-media-label', 'true');
      label.setAttribute('role', 'note');
      label.style.cssText = 'display:block !important;width:max-content !important;max-width:100% !important;box-sizing:border-box !important;' +
        'margin:4px 0 !important;padding:3px 8px !important;font:600 13px/1.35 system-ui,"Segoe UI",sans-serif !important;' +
        'color:#111 !important;background:#ffd400 !important;border:2px solid #111 !important;border-radius:6px !important;';
      label.textContent = text;
      el.parentNode.insertBefore(label, el);
      this._labelled.add(el);
      this._captionedImgs.push({ figcaption: label });
    } catch (e) { this._warn('_labelMedia: ' + e.message); }
  }

  toggleCaptionImages(active) {
    try {
      this._labelsOn = Boolean(active);
      if (active) {
        document.querySelectorAll('video, audio, iframe').forEach(el => this._labelMedia(el));
      } else {
        this._captionedImgs.forEach(({ figcaption }) => { try { figcaption.remove(); } catch (err) { /* skip */ } });
        this._captionedImgs = [];
        this._labelled = new WeakSet();
      }
      this._watchMedia();
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
      badge.style.cssText = 'position:absolute;top:8px;right:8px;background:rgba(185,28,28,0.95);color:#fff;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:bold;z-index:10;font-family:system-ui,sans-serif;pointer-events:none;';

      const parent = video.parentElement;
      let positioned = null;
      if (parent) {
        const pos = window.getComputedStyle(parent).position;
        // Put back afterwards: the badge needs it, the page did not ask for it.
        if (pos === 'static') { positioned = parent.style.position; parent.style.position = 'relative'; }
        parent.appendChild(badge);
      }
      this._mutedVideos.push({ video, badge, wasMuted, parent, positioned });
    } catch (e) { this._warn('_muteVideo: ' + e.message); }
  }

  toggleMuteVideos(active) {
    try {
      this._muteOn = Boolean(active);
      if (active) {
        document.querySelectorAll('video').forEach(v => this._muteVideo(v));
      } else {
        this._mutedVideos.forEach(({ video, badge, wasMuted, parent, positioned }) => {
          try {
            video.muted = wasMuted;
            video.removeAttribute('data-accessiflow-muted');
            badge.remove();
            if (parent && positioned !== null) parent.style.position = positioned;
          } catch (err) { /* skip */ }
        });
        this._mutedVideos = [];
      }
      this._watchMedia();
    } catch (e) { this._warn('toggleMuteVideos: ' + e.message); }
  }

  // ── 3. Closed caption support ────────────────────────────
  // What was changed is remembered here rather than marked on the video. A
  // mark left behind after a settings change (which switches everything off
  // and on again) made it skip every video it had already seen.
  addClosedCaptionSupport(showBadge) {
    try {
      if (!this._ccChecked) this._ccChecked = new WeakSet();
      if (!this._ccTracks) this._ccTracks = [];
      document.querySelectorAll('video').forEach(video => {
        try {
          if (this._ccChecked.has(video)) return;
          this._ccChecked.add(video);
          const track = video.querySelector('track[kind="subtitles"], track[kind="captions"]');
          if (track) {
            // Enable existing track, and remember how it was.
            if (track.track) {
              this._ccTracks.push({ track: track.track, mode: track.track.mode });
              track.track.mode = 'showing';
            }
          } else if (showBadge) {
            // Inject warning badge
            const badge = document.createElement('div');
            badge.textContent = 'No captions available';
            badge.setAttribute('aria-hidden', 'true');
            badge.setAttribute('data-accessiflow-cc-badge', 'true');
            badge.style.cssText = 'position:absolute;bottom:8px;left:8px;background:rgba(245,158,11,0.95);color:#000;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:bold;z-index:10;font-family:system-ui,sans-serif;pointer-events:none;';
            const parent = video.parentElement;
            if (parent) {
              const pos = window.getComputedStyle(parent).position;
              if (pos === 'static') {
                this._ccPositioned = (this._ccPositioned || []).concat([{ el: parent, position: parent.style.position }]);
                parent.style.position = 'relative';
              }
              parent.appendChild(badge);
              this._captionBadges.push(badge);
            }
          }
        } catch (err) { /* skip */ }
      });
    } catch (e) { this._warn('addClosedCaptionSupport: ' + e.message); }
  }

  _removeClosedCaptionSupport() {
    this._captionBadges.forEach(b => { try { b.remove(); } catch (e) { /* skip */ } });
    this._captionBadges = [];
    (this._ccTracks || []).forEach(({ track, mode }) => { try { track.mode = mode; } catch (e) { /* skip */ } });
    this._ccTracks = [];
    (this._ccPositioned || []).forEach(({ el, position }) => { try { el.style.position = position; } catch (e) { /* skip */ } });
    this._ccPositioned = [];
    this._ccChecked = new WeakSet();
    // Marks an older version left on the page.
    document.querySelectorAll('[data-accessiflow-cc-checked]').forEach(v => v.removeAttribute('data-accessiflow-cc-checked'));
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

  // ── 5. Sound level meter ──────────────────────────────────
  //
  // Driven only by the tab capture behind live captions, which hears exactly
  // what the tab plays. The meter used to call createMediaElementSource() on
  // the page's first <video>, which permanently reroutes that video's sound
  // into our own audio graph -- so closing the meter silenced the video until
  // the page was reloaded -- and with no video on the page it drew one frame
  // of random bars. A meter that moves when nothing is playing is worse than
  // no meter for someone who cannot hear whether anything is.
  applySoundMeter(active) {
    try {
      if (active) {
        this._meterWanted = true;
        return;                 // drawn on the first real level, not before
      }
      this._meterWanted = false;
      if (this._meterEl) { this._meterEl.remove(); this._meterEl = null; }
    } catch (e) { this._warn('applySoundMeter: ' + e.message); }
  }

  _drawLevel(left, right) {
    if (!this._meterWanted) return;
    if (!this._meterEl) {
      const meter = document.createElement('div');
      meter.id = 'accessiflow-sound-meter';
      meter.className = 'accessiflow-sound-meter';
      meter.setAttribute('aria-hidden', 'true');
      ['L', 'R'].forEach(side => {
        const row = document.createElement('div');
        row.className = 'accessiflow-sound-meter-row';
        const label = document.createElement('span');
        label.textContent = side;
        const track = document.createElement('span');
        track.className = 'accessiflow-sound-meter-track';
        const fill = document.createElement('span');
        fill.className = 'accessiflow-sound-meter-fill';
        track.appendChild(fill);
        row.append(label, track);
        meter.appendChild(row);
      });
      document.body.appendChild(meter);
      this._meterEl = meter;
    }
    // Decibels, so quiet speech still moves the bar and loud music does not
    // simply pin it: -60 dB at empty, 0 dB at full.
    const toWidth = v => Math.max(0, Math.min(100, (20 * Math.log10(Math.max(v, 1e-6)) + 60) / 60 * 100));
    const fills = this._meterEl.querySelectorAll('.accessiflow-sound-meter-fill');
    this._place(fills[0], { width: toWidth(left) + '%' });
    this._place(fills[1], { width: toWidth(right) + '%' });
  }

  // ── 6. Sound cues ─────────────────────────────────────────
  //
  // A glow at the edge of the screen when the page makes a sound, on the side
  // the sound came from. Two sources:
  //
  //   * with live captions running, the tab capture itself, which hears every
  //     sound and knows its left-right balance
  //   * otherwise, page-hook.js, which notices <audio> starting and Web Audio
  //     sounds being played; an audio element's cue appears where the element
  //     is on the page, a Web Audio sound at the bottom of the screen, because
  //     it has no position and one is not invented for it
  applySoundCues(active, settings) {
    try {
      if (active) {
        this._cueSettings = settings || {};
        if (this._cueHandler) return;
        const bridge = globalThis.AccessiFlowPageBridge;
        this._cueHandler = data => {
          // The capture hears the same sound, and places it better.
          if (this._captureRunning) return;
          this.showSoundCue({ rect: data.rect, kind: data.kind, strength: 0.8 });
        };
        if (bridge) {
          bridge.on('sound', this._cueHandler);
          bridge.send('watchSound');
        }
      } else {
        if (this._cueHandler) {
          const bridge = globalThis.AccessiFlowPageBridge;
          if (bridge) {
            bridge.off('sound', this._cueHandler);
            if (bridge.injected) bridge.send('unwatchSound');
          }
          this._cueHandler = null;
        }
        document.querySelectorAll('.accessiflow-sound-cue').forEach(n => n.remove());
      }
    } catch (e) { this._warn('applySoundCues: ' + e.message); }
  }

  /**
   * Draws one cue.
   *
   * @param {{pan?:number, rect?:object, strength?:number, kind?:string}} cue
   *   pan from -1 (left) to 1 (right), or the on-page rect of what made it
   */
  showSoundCue(cue) {
    if (!cue) return;
    const s = this._cueSettings || {};
    const calm = s.reduceMotion || s.stopAnimations || this._prefersReducedMotion();
    const strength = Math.max(0.35, Math.min(1, cue.strength || 0.7));

    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.className = 'accessiflow-sound-cue';

    let side;
    if (cue.rect) side = 'at';
    else if (typeof cue.pan === 'number' && cue.pan < -0.3) side = 'left';
    else if (typeof cue.pan === 'number' && cue.pan > 0.3) side = 'right';
    else side = 'bottom';
    el.classList.add('accessiflow-sound-cue--' + side);
    if (calm) el.classList.add('accessiflow-sound-cue--calm');
    el.style.setProperty('--accessiflow-cue-strength', String(strength));

    if (side === 'at') {
      const r = cue.rect;
      const size = Math.max(60, Math.min(160, Math.max(r.width, r.height)));
      this._place(el, {
        left: Math.round(r.left + r.width / 2 - size / 2) + 'px',
        top: Math.round(r.top + r.height / 2 - size / 2) + 'px',
        width: size + 'px',
        height: size + 'px'
      });
    }

    const label = document.createElement('span');
    label.className = 'accessiflow-sound-cue-label';
    label.textContent = side === 'left' ? '♪ Sound on the left'
      : side === 'right' ? '♪ Sound on the right'
        : '♪ Sound';
    el.appendChild(label);

    document.body.appendChild(el);
    setTimeout(() => { try { el.remove(); } catch (e) { /* gone */ } }, 1600);
    this._lastCue = { side: side, at: Date.now() };
  }

  /**
   * Inline styles set with !important. The shared page stylesheet resets every
   * AccessiFlow element with `all: initial !important`, which beats a plain
   * inline style, so without this a dragged caption box would not move and a
   * cue would not go where the sound was.
   */
  _place(el, props) {
    Object.keys(props).forEach(name => el.style.setProperty(name, props[name], 'important'));
  }

  _prefersReducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  // ── 7. Live captions from tab audio ───────────────────────
  //
  // The overlay only. Capture and Whisper run in the offscreen document; this
  // shows what they send. It is a region, not a live region: captions exist
  // for people reading them, and a screen reader announcing every interim
  // revision would talk over the very audio being captioned.

  /** Everything the offscreen document sends for this tab arrives here. */
  onCaptionEvent(event) {
    if (!event) return;
    try {
      if (event.type === 'state') this._captionState(event);
      else if (event.type === 'caption') this._showCaption(event);
      else if (event.type === 'soundCue') { if (this._cueHandler) this.showSoundCue(event); }
      else if (event.type === 'level') this._drawLevel(event.left, event.right);
    } catch (e) { this._warn('onCaptionEvent: ' + e.message); }
  }

  _captionState(event) {
    if (event.state === 'starting' || event.state === 'running') {
      this._captureRunning = true;
      const box = this._ensureCaptionBox();
      this._setCaptionStatus(event.state === 'starting'
        ? 'Starting live captions… the first one can take about ten seconds.'
        : 'Listening. Captions appear here as people speak.');
      box.hidden = false;
    } else if (event.state === 'stopped') {
      this._captureRunning = false;
      if (this._meterEl) { this._meterEl.remove(); this._meterEl = null; }
      if (event.message) {
        // A failure started from the shortcut has nowhere else to be seen.
        this._ensureCaptionBox().hidden = false;
        this._setCaptionStatus(event.message);
        setTimeout(() => this._removeCaptionBox(), 8000);
      } else {
        this._removeCaptionBox();
      }
    }
  }

  _ensureCaptionBox() {
    if (this._captionBox && this._captionBox.isConnected) return this._captionBox;

    const box = document.createElement('div');
    box.id = 'accessiflow-live-captions';
    box.className = 'accessiflow-live-captions';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Live captions');

    const bar = document.createElement('div');
    bar.className = 'accessiflow-live-captions-bar';

    // A real button, so the box can be moved without a mouse: focus it and
    // use the arrow keys. Holding Shift moves further.
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'accessiflow-live-captions-grip';
    grip.textContent = 'Move';
    grip.setAttribute('aria-label', 'Move captions. Use the arrow keys, or drag.');

    const status = document.createElement('span');
    status.className = 'accessiflow-live-captions-status';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'accessiflow-live-captions-close';
    close.textContent = 'Stop captions';
    close.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'stopCaptions' }, () => { void chrome.runtime.lastError; });
    });

    bar.append(grip, status, close);

    const lines = document.createElement('div');
    lines.className = 'accessiflow-live-captions-lines';
    const interim = document.createElement('p');
    interim.className = 'accessiflow-live-captions-interim';
    lines.appendChild(interim);

    box.append(bar, lines);
    document.body.appendChild(box);
    this._captionBox = box;
    this._captionLines = lines;
    this._captionInterim = interim;
    this._applyCaptionLook();
    this._restoreCaptionPosition();
    this._makeMovable(box, grip);
    return box;
  }

  _setCaptionStatus(text) {
    const status = this._captionBox && this._captionBox.querySelector('.accessiflow-live-captions-status');
    if (status) status.textContent = text;
  }

  _showCaption(event) {
    const box = this._ensureCaptionBox();
    box.hidden = false;
    this._setCaptionStatus('Live captions');

    if (!event.final) {
      this._captionInterim.textContent = event.text || '';
      return;
    }

    this._captionInterim.textContent = '';
    if (!event.text) return;
    const line = document.createElement('p');
    line.className = 'accessiflow-live-captions-line';
    line.textContent = event.text;
    this._captionLines.insertBefore(line, this._captionInterim);

    // The last few lines, not a growing transcript. Reading captions is
    // following along, not scrolling back.
    const kept = Math.max(1, Math.min(6, (this._captionSettings && this._captionSettings.captionLines) || 3));
    const all = this._captionLines.querySelectorAll('.accessiflow-live-captions-line');
    for (let i = 0; i < all.length - kept; i++) all[i].remove();
  }

  /**
   * One palette for live captions and for the video subtitles restyled
   * through ::cue, so the two look the same when both are on.
   */
  static captionLook(s) {
    const settings = s || {};
    const colours = { white: '#ffffff', yellow: '#ffe14d', cyan: '#7df9ff', green: '#9dff8a' };
    const backs = { dark: 'rgba(0,0,0,0.82)', solid: '#000000', blue: 'rgba(8,20,64,0.9)', clear: 'rgba(0,0,0,0.62)' };
    // "Lighter" is as light as it can go and still keep every caption colour at
    // 4.5:1 or better over a white page. At 35% it measured 1.9:1, which a text
    // shadow cannot be relied on to rescue.
    return {
      size: Math.max(14, Math.min(48, parseInt(settings.captionFontSize, 10) || 22)),
      colour: colours[settings.captionColor] || colours.white,
      back: backs[settings.captionBg] || backs.dark
    };
  }

  _applyCaptionLook() {
    if (!this._captionBox) return;
    const look = HearingModule.captionLook(this._captionSettings);
    this._captionBox.style.setProperty('--accessiflow-caption-size', look.size + 'px');
    this._captionBox.style.setProperty('--accessiflow-caption-colour', look.colour);
    this._captionBox.style.setProperty('--accessiflow-caption-back', look.back);
  }

  _makeMovable(box, grip) {
    const move = (dx, dy) => {
      const r = box.getBoundingClientRect();
      const left = Math.max(0, Math.min(window.innerWidth - Math.min(r.width, window.innerWidth), r.left + dx));
      const top = Math.max(0, Math.min(window.innerHeight - 40, r.top + dy));
      this._place(box, { left: left + 'px', top: top + 'px', bottom: 'auto', transform: 'none' });
    };

    grip.addEventListener('keydown', e => {
      const step = e.shiftKey ? 80 : 20;
      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!delta) return;
      e.preventDefault();
      e.stopPropagation();
      move(delta[0], delta[1]);
      this._saveCaptionPosition();
    });

    let dragging = null;
    grip.addEventListener('pointerdown', e => {
      dragging = { x: e.clientX, y: e.clientY };
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* skip */ }
    });
    grip.addEventListener('pointermove', e => {
      if (!dragging) return;
      move(e.clientX - dragging.x, e.clientY - dragging.y);
      dragging = { x: e.clientX, y: e.clientY };
    });
    const end = () => { if (dragging) { dragging = null; this._saveCaptionPosition(); } };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  _saveCaptionPosition() {
    if (!this._captionBox) return;
    const r = this._captionBox.getBoundingClientRect();
    const where = { left: Math.round(r.left), top: Math.round(r.top) };
    try { chrome.storage.local.set({ accessiflow_caption_position: where }); } catch (e) { /* skip */ }
  }

  _restoreCaptionPosition() {
    try {
      chrome.storage.local.get('accessiflow_caption_position', found => {
        const where = found && found.accessiflow_caption_position;
        if (!where || !this._captionBox) return;
        // Kept on screen even if the window has since been made smaller.
        const left = Math.max(0, Math.min(window.innerWidth - 200, where.left));
        const top = Math.max(0, Math.min(window.innerHeight - 60, where.top));
        this._place(this._captionBox, { left: left + 'px', top: top + 'px', bottom: 'auto', transform: 'none' });
      });
    } catch (e) { /* skip */ }
  }

  _removeCaptionBox() {
    if (this._captionBox) { this._captionBox.remove(); this._captionBox = null; }
    this._captionLines = null;
    this._captionInterim = null;
  }

  // ── 8. Caption Styling ────────────────────────────────────
  applyCaptionStyling(active, options) {
    try {
      if (active) {
        if (!this._captionStyleEl) {
          this._captionStyleEl = document.createElement('style');
          this._captionStyleEl.id = 'accessiflow-hearing-extra-style';
          document.head.appendChild(this._captionStyleEl);
        }
        // These three used to be read here and declared nowhere, so nobody
        // could ever change them. They are Hearing settings now, shared with
        // live captions.
        const look = HearingModule.captionLook(options);
        const fontSize = look.size;
        const color = look.colour;
        const bgColor = look.back;

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
      // Its own setting only. It used to run for muting and labelling too,
      // and with Label audio content on, a video got two notices that it has
      // no captions; the label says it, so the badge is left out then.
      if (settings.closedCaptions) this.addClosedCaptionSupport(!settings.captionImages);
      this.applyTranscription(!!settings.liveTranscription);
      this.applySoundMeter(!!settings.soundVisualization);
      this.applySoundCues(!!settings.visualAlerts, settings);
      this.applyCaptionStyling(!!settings.captionStyling, settings);
      this._captionSettings = settings;
      this._applyCaptionLook();
    } catch (e) { this._warn('apply: ' + e.message); }
  }

  destroy() {
    try {
      this.toggleCaptionImages(false);
      this.toggleMuteVideos(false);
      this._removeClosedCaptionSupport();
      this.applyTranscription(false);
      this.applySoundMeter(false);
      this.applySoundCues(false);
      this.applyCaptionStyling(false);
      // The live caption box is left alone. It follows the capture, which
      // runs in the offscreen document and does not stop because a setting
      // changed; content.js calls destroy on every settings change.
    } catch (e) { this._warn('destroy: ' + e.message); }
  }

  /** For turning AccessiFlow off entirely: the caption box goes too. */
  destroyCaptions() {
    this._captureRunning = false;
    this._removeCaptionBox();
    if (this._meterEl) { this._meterEl.remove(); this._meterEl = null; }
  }
}

if (typeof window !== 'undefined') window.HearingModule = HearingModule;
