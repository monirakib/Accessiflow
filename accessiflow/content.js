// AccessiFlow content script orchestrator
// Guards against double-injection, initializes modules, routes messages
'use strict';

(function () {
  // ── Double-injection guard ────────────────────────────────
  if (window.__accessiflowLoaded) return;
  window.__accessiflowLoaded = true;

  const PREFIX = '[AccessiFlow]';
  function _log(msg) { console.log(PREFIX + ' ' + msg); }
  function _warn(msg) { console.warn(PREFIX + ' ' + msg); }

  _log('Content script initializing on ' + location.hostname);

  // ── Module Instances ──────────────────────────────────────
  let blindModule = null;
  let visionModule = null;
  let motorModule = null;
  let cognitiveModule = null;
  let hearingModule = null;
  let seizureModule = null;
  let speechModule = null;
  let neuroModule = null;
  let banglaModule = null;
  let auditModule = null;
  let aiModule = null;
  let ttsEngine = null;

  try { blindModule = new BlindModule(); } catch (e) { _warn('BlindModule init failed: ' + e.message); }
  try { visionModule = new VisionModule(); } catch (e) { _warn('VisionModule init failed: ' + e.message); }
  try { motorModule = new MotorModule(); } catch (e) { _warn('MotorModule init failed: ' + e.message); }
  try { cognitiveModule = new CognitiveModule(); } catch (e) { _warn('CognitiveModule init failed: ' + e.message); }
  try { hearingModule = new HearingModule(); } catch (e) { _warn('HearingModule init failed: ' + e.message); }
  try { seizureModule = new SeizureModule(); } catch (e) { _warn('SeizureModule init failed: ' + e.message); }
  try { speechModule = new SpeechModule(); } catch (e) { _warn('SpeechModule init failed: ' + e.message); }
  try { neuroModule = new NeuroModule(); } catch (e) { _warn('NeuroModule init failed: ' + e.message); }
  try { banglaModule = new BanglaModule(); } catch (e) { _warn('BanglaModule init failed: ' + e.message); }
  try { auditModule = new AuditModule(); } catch (e) { _warn('AuditModule init failed: ' + e.message); }
  try { aiModule = new AIModule(); } catch (e) { _warn('AIModule init failed: ' + e.message); }

  // ── TTS Engine ────────────────────────────────────────────
  class TTSEngine {
    constructor() {
      this.synth = window.speechSynthesis;
      this.rate = 1.0;
      this.pitch = 1.0;
      this.voice = null;
      this.isReading = false;
      this._currentEl = null;
    }

    setRate(r) { this.rate = r; }
    setPitch(p) { this.pitch = p; }
    setVoice(name) {
      const voices = this.synth.getVoices();
      this.voice = voices.find(v => v.name === name) || null;
    }

    speak(text, element) {
      if (!text || !text.trim()) return;
      this.synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = this.rate;
      utter.pitch = this.pitch;
      if (this.voice) utter.voice = this.voice;

      if (element) this.highlightCurrent(element);
      utter.onend = () => { this.unhighlight(); this.isReading = false; };
      utter.onerror = () => { this.unhighlight(); this.isReading = false; };

      this.isReading = true;
      this.synth.speak(utter);
    }

    readSelection() {
      const sel = window.getSelection().toString().trim();
      if (sel) this.speak(sel);
    }

    readHovered(element) {
      if (element && element.textContent) {
        this.speak(element.textContent.trim().substring(0, 500), element);
      }
    }

    readPage() {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
      const texts = [];
      let node;
      while ((node = walker.nextNode())) {
        const t = node.textContent.trim();
        if (t.length > 2) texts.push(t);
      }
      this.speak(texts.join('. '));
    }

    stop() {
      this.synth.cancel();
      this.isReading = false;
      this.unhighlight();
    }

    highlightCurrent(element) {
      this.unhighlight();
      if (element && element.classList) {
        element.classList.add('accessiflow-tts-highlight');
        this._currentEl = element;
      }
    }

    unhighlight() {
      if (this._currentEl && this._currentEl.classList) {
        this._currentEl.classList.remove('accessiflow-tts-highlight');
      }
      this._currentEl = null;
    }
  }

  try { ttsEngine = new TTSEngine(); } catch (e) { _warn('TTS init failed: ' + e.message); }

  // ── Dynamic Style Element ─────────────────────────────────
  let dynamicStyle = document.getElementById('accessiflow-dynamic');
  if (!dynamicStyle) {
    dynamicStyle = document.createElement('style');
    dynamicStyle.id = 'accessiflow-dynamic';
    document.head.appendChild(dynamicStyle);
  }

  // ── Current settings state ────────────────────────────────
  let currentSettings = {};
  let blindMode = true; // Always on by default
  let extensionEnabled = true;

  // ── Apply Settings ────────────────────────────────────────
  function applySettings(settings) {
    try {
      currentSettings = settings || {};
      _log('Applying settings: ' + Object.keys(currentSettings).filter(k => currentSettings[k]).join(', '));

      // Build CSS from modules
      let css = '';

      // Destroy all modules first for clean state
      try { if (visionModule) visionModule.destroy(); } catch (e) { /* ok */ }
      try { if (motorModule) motorModule.destroy(); } catch (e) { /* ok */ }
      try { if (cognitiveModule) cognitiveModule.destroy(); } catch (e) { /* ok */ }
      try { if (hearingModule) hearingModule.destroy(); } catch (e) { /* ok */ }
      try { if (seizureModule) seizureModule.destroy(); } catch (e) { /* ok */ }
      try { if (speechModule) speechModule.destroy(); } catch (e) { /* ok */ }
      try { if (neuroModule) neuroModule.destroy(); } catch (e) { /* ok */ }
      try { if (banglaModule) banglaModule.destroy(); } catch (e) { /* ok */ }

      // Vision
      if (visionModule) {
        try {
          css += visionModule.buildCSS(settings);
          visionModule.apply(settings);
        } catch (e) { _warn('Vision apply error: ' + e.message); }
      }

      // Motor
      if (motorModule) {
        try {
          css += motorModule.buildCSS(settings);
          motorModule.apply(settings);
        } catch (e) { _warn('Motor apply error: ' + e.message); }
      }

      // Cognitive
      if (cognitiveModule) {
        try {
          css += cognitiveModule.buildCSS(settings);
          cognitiveModule.apply(settings);
        } catch (e) { _warn('Cognitive apply error: ' + e.message); }
      }

      // Hearing
      if (hearingModule) {
        try {
          hearingModule.apply(settings);
        } catch (e) { _warn('Hearing apply error: ' + e.message); }
      }

      // Seizure
      if (seizureModule) {
        try {
          css += seizureModule.buildCSS(settings);
          seizureModule.apply(settings);
        } catch (e) { _warn('Seizure apply error: ' + e.message); }
      }

      // Speech
      if (speechModule) {
        try {
          css += speechModule.buildCSS(settings);
          speechModule.apply(settings);
        } catch (e) { _warn('Speech apply error: ' + e.message); }
      }

      // Neuro
      if (neuroModule) {
        try {
          css += neuroModule.buildCSS(settings);
          neuroModule.apply(settings);
        } catch (e) { _warn('Neuro apply error: ' + e.message); }
      }

      // Bangla
      if (banglaModule) {
        try {
          css += banglaModule.buildCSS(settings);
          banglaModule.apply(settings);
        } catch (e) { _warn('Bangla apply error: ' + e.message); }
      }

      // Blind
      if (blindMode && blindModule) {
        try {
          blindModule.runAll();
        } catch (e) { _warn('Blind apply error: ' + e.message); }
      }

      // TTS rate/pitch/voice
      if (ttsEngine) {
        if (settings.ttsRate) ttsEngine.setRate(settings.ttsRate);
        if (settings.ttsPitch) ttsEngine.setPitch(settings.ttsPitch);
        if (settings.ttsVoice) ttsEngine.setVoice(settings.ttsVoice);
      }

      // Update dynamic style
      dynamicStyle.textContent = css;

      // Save settings per hostname
      saveSettings(settings);
    } catch (e) {
      _warn('applySettings error: ' + e.message);
    }
  }

  // ── Settings Persistence ──────────────────────────────────
  function getSettingsKey() {
    return 'settings_' + location.hostname;
  }

  function saveSettings(settings) {
    try {
      const key = getSettingsKey();
      chrome.storage.local.set({ [key]: settings });
    } catch (e) { _warn('saveSettings error: ' + e.message); }
  }

  function loadSettings() {
    try {
      const key = getSettingsKey();
      chrome.storage.local.get(key, data => {
        if (data[key]) {
          _log('Loaded saved settings for ' + location.hostname);
          applySettings(data[key]);
        } else {
          // No saved settings, so just run the blind module
          if (blindMode && blindModule) {
            try { blindModule.runAll(); } catch (e) { _warn('Blind auto-run error: ' + e.message); }
          }
        }
      });
    } catch (e) {
      _warn('loadSettings error: ' + e.message);
      if (blindMode && blindModule) {
        try { blindModule.runAll(); } catch (e2) { /* ok */ }
      }
    }
  }

  // ── Reset / Destroy All ───────────────────────────────────
  function destroyAll() {
    try { if (visionModule) visionModule.destroy(); } catch (e) { /* ok */ }
    try { if (motorModule) motorModule.destroy(); } catch (e) { /* ok */ }
    try { if (cognitiveModule) cognitiveModule.destroy(); } catch (e) { /* ok */ }
    try { if (hearingModule) hearingModule.destroy(); } catch (e) { /* ok */ }
    try { if (seizureModule) seizureModule.destroy(); } catch (e) { /* ok */ }
    try { if (speechModule) speechModule.destroy(); } catch (e) { /* ok */ }
    try { if (neuroModule) neuroModule.destroy(); } catch (e) { /* ok */ }
    try { if (banglaModule) banglaModule.destroy(); } catch (e) { /* ok */ }
    try { if (blindModule) blindModule.destroy(); } catch (e) { /* ok */ }
    try { if (ttsEngine) ttsEngine.stop(); } catch (e) { /* ok */ }
    if (dynamicStyle) dynamicStyle.textContent = '';
    currentSettings = {};
  }

  // ── Message Router ────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.action) return;

    _log('Message received: ' + msg.action);

    try {
      switch (msg.action) {
        case 'applySettings':
          applySettings(msg.data || {});
          sendResponse({ success: true });
          break;

        case 'getSettings':
          sendResponse({ success: true, data: currentSettings });
          break;

        case 'resetSettings':
          destroyAll();
          const key = getSettingsKey();
          chrome.storage.local.remove(key);
          sendResponse({ success: true });
          break;

        case 'toggleExtension':
          extensionEnabled = !extensionEnabled;
          if (!extensionEnabled) {
            destroyAll();
          } else {
            loadSettings();
          }
          sendResponse({ success: true, enabled: extensionEnabled });
          break;

        case 'runAudit':
          if (auditModule) {
            const results = auditModule.runFullAudit();
            sendResponse({ success: true, data: results });
            chrome.runtime.sendMessage({ action: 'auditResults', data: results });
          } else {
            sendResponse({ success: false, error: 'AuditModule not loaded' });
          }
          break;

        case 'aiDescribeImages':
          if (aiModule) {
            aiModule.describeAllImages((done, total) => {
              chrome.runtime.sendMessage({
                action: 'aiProgress', kind: 'images', done: done, total: total
              }, () => { void chrome.runtime.lastError; });
            }).then(result => sendResponse({ success: true, result: result }));
            return true; // async
          }
          sendResponse({ success: false, error: 'The AI helper is not loaded on this page.' });
          break;

        case 'aiSummarizePage':
          if (aiModule) {
            aiModule.summarizePage()
              .then(summary => sendResponse({ success: true, summary: summary }))
              .catch(err => sendResponse({ success: false, error: err.message }));
            return true;
          }
          sendResponse({ success: false, error: 'The AI helper is not loaded on this page.' });
          break;

        case 'aiFixLinks':
          if (aiModule) {
            aiModule.relabelAllLinks((done, total) => {
              chrome.runtime.sendMessage({
                action: 'aiProgress', kind: 'links', done: done, total: total
              }, () => { void chrome.runtime.lastError; });
            }).then(result => sendResponse({ success: true, result: result }));
            return true;
          }
          sendResponse({ success: false, error: 'The AI helper is not loaded on this page.' });
          break;

        case 'aiCancel':
          if (aiModule) aiModule.cancel();
          sendResponse({ success: true });
          break;

        case 'aiCounts':
          if (aiModule) {
            sendResponse({
              success: true,
              images: aiModule.countImagesNeedingAlt(),
              links: aiModule.countVagueLinks()
            });
          } else {
            sendResponse({ success: false, images: 0, links: 0 });
          }
          break;

        case 'ttsReadPage':
          if (ttsEngine) ttsEngine.readPage();
          sendResponse({ success: true });
          break;

        case 'ttsReadSelection':
          if (ttsEngine) ttsEngine.readSelection();
          sendResponse({ success: true });
          break;

        case 'ttsStop':
          if (ttsEngine) ttsEngine.stop();
          sendResponse({ success: true });
          break;

        case 'ping':
          sendResponse({ success: true, loaded: true });
          break;

        default:
          _warn('Unknown action: ' + msg.action);
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (e) {
      _warn('Message handler error: ' + e.message);
      sendResponse({ success: false, error: e.message });
    }
  });

  // ── MutationObserver ──────────────────────────────────────
  const observer = new MutationObserver(mutations => {
    if (!extensionEnabled) return;
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        try {
          // Always run blind repairs on new nodes
          if (blindMode && blindModule) blindModule.repairNode(node);

          // Run hearing observer features if active
          if (currentSettings.captionImages && hearingModule) {
            hearingModule.toggleCaptionImages(true, node);
          }
          if (currentSettings.muteVideos && hearingModule) {
            hearingModule.toggleMuteVideos(true, node);
          }
        } catch (e) { /* suppress observer errors */ }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ── Keyboard Shortcuts ────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (!extensionEnabled) return;
    if (!e.altKey || !e.shiftKey) return;

    const key = e.key.toUpperCase();
    let handled = false;

    switch (key) {
      // Alt+Shift+A is owned by the manifest `commands` entry, which routes
      // through the service worker to the toggleExtension message below.
      // Handling it here as well made the two cancel each other out.
      case 'R': // Read page
        if (ttsEngine) ttsEngine.readPage();
        handled = true;
        break;
      case 'S': // Stop TTS
        if (ttsEngine) ttsEngine.stop();
        handled = true;
        break;
      case 'C': // Toggle high contrast
        currentSettings.highContrast = !currentSettings.highContrast;
        applySettings(currentSettings);
        handled = true;
        break;
      case 'F': // Toggle focus ring
        currentSettings.enhancedFocus = !currentSettings.enhancedFocus;
        applySettings(currentSettings);
        handled = true;
        break;
      case 'T': // Toggle large cursor
        currentSettings.largeCursor = !currentSettings.largeCursor;
        applySettings(currentSettings);
        handled = true;
        break;
      case 'M': // Toggle reading mask
        currentSettings.readingMask = !currentSettings.readingMask;
        applySettings(currentSettings);
        handled = true;
        break;
      case 'N': // Next heading, handled by BlindModule
        break;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      // Announce shortcut activation
      announceShortcut(key);
    }
  });

  // TTS: Read selection on mouseup if enabled
  document.addEventListener('mouseup', () => {
    if (!extensionEnabled || !ttsEngine || !currentSettings.ttsReadOnSelect) return;
    setTimeout(() => { ttsEngine.readSelection(); }, 100);
  });

  function announceShortcut(key) {
    const labels = {
      'A': 'AccessiFlow toggled',
      'R': 'Reading page aloud',
      'S': 'Speech stopped',
      'C': 'High contrast toggled',
      'F': 'Focus ring toggled',
      'T': 'Large cursor toggled',
      'M': 'Reading mask toggled',
    };
    const msg = labels[key] || 'Shortcut activated';
    let region = document.getElementById('accessiflow-shortcut-announce');
    if (!region) {
      region = document.createElement('div');
      region.id = 'accessiflow-shortcut-announce';
      region.setAttribute('aria-live', 'assertive');
      region.setAttribute('role', 'status');
      region.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;';
      document.body.appendChild(region);
    }
    region.textContent = msg;
    setTimeout(() => { region.textContent = ''; }, 2000);
  }

  // ── Auto-load saved settings ──────────────────────────────
  loadSettings();

  _log('Content script ready.');
})();
