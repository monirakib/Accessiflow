// AccessiFlow — Popup Script
// Settings management, message passing, tab navigation
'use strict';

(function () {
  // ── State ─────────────────────────────────────────────────
  let currentTabId = null;
  let currentHostname = '';
  let settings = {};

  // ── DOM Helpers ───────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ── Toggle Controls ───────────────────────────────────────
  const TOGGLE_IDS = [
    // Vision
    'highContrast', 'darkMode', 'invertColors', 'dyslexiaFont',
    'highlightLinks', 'hideImages', 'readingGuide', 'focusMode',
    'magnifier', 'bionicReading', 'lineNumbering',
    // Motor
    'largeCursor', 'enhancedFocus', 'bigTargets', 'clickAssist',
    'stopAnimations', 'stickyHover',
    'dwellClick', 'tremorFilter', 'keyboardOnly', 'voiceCommands', 'edgeScrolling',
    // Cognitive
    'readingMask', 'lineRuler', 'simplifyPage', 'showHeadings',
    'altTextTooltips', 'pauseMedia',
    'dictionary', 'readingProgress', 'distractionFree', 'formSteps',
    'activeFieldHighlight', 'breakTimer', 'memoryAid',
    // Hearing
    'captionImages', 'muteVideos', 'closedCaptions',
    'liveTranscription', 'soundVisualization', 'visualAlerts', 'captionStyling',
    // Seizure
    'flashDetection', 'reduceMotion', 'staticGifs', 'disableAutoplay',
    // Speech
    'aacBoard', 'quickResponses', 'textInputBar', 'speechToText',
    // Neuro
    'reduceClutter', 'lowStimulation', 'focusTimer',
    'contentWarnings', 'consistentNav', 'socialCues',
    // Bangla
    'banglaFont', 'banglaLargeText', 'banglaFormLabels', 'banglaNumbers',
    // Blind / TTS
    'ttsReadOnSelect', 'blindMode'
  ];

  // Slider IDs and their output format
  const SLIDER_IDS = {
    textSize: { suffix: '%', default: 100 },
    lineHeight: { suffix: '', default: 1.5 },
    letterSpacing: { suffix: 'px', default: 0 },
    magnifierZoom: { suffix: '×', default: 2 },
    iconScaling: { suffix: '×', default: 1 },
    saturation: { suffix: '%', default: 100 },
    wordSpacing: { suffix: 'px', default: 0 },
    cursorSize: { suffix: '×', default: 2 },
    dwellClickDelay: { suffix: 'ms', default: 1000 },
    breakTimerMinutes: { suffix: ' min', default: 20 },
    focusTimerMinutes: { suffix: ' min', default: 25 },
    ttsRate: { suffix: '×', default: 1.0 },
    ttsPitch: { suffix: '', default: 1.0 }
  };

  const SELECT_IDS = ['colorFilter', 'fontFamily', 'textAlign', 'neuroColorTheme'];

  // ── Tab Navigation (arrow keys + click) ───────────────────
  function initTabs() {
    const tabs = $$('[role="tab"]');
    const panels = $$('[role="tabpanel"]');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => activateTab(tab, tabs, panels));
      tab.addEventListener('keydown', e => {
        const tabList = Array.from(tabs);
        const index = tabList.indexOf(tab);
        let newIndex = index;

        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          newIndex = (index + 1) % tabList.length;
          e.preventDefault();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          newIndex = (index - 1 + tabList.length) % tabList.length;
          e.preventDefault();
        } else if (e.key === 'Home') {
          newIndex = 0;
          e.preventDefault();
        } else if (e.key === 'End') {
          newIndex = tabList.length - 1;
          e.preventDefault();
        }

        if (newIndex !== index) {
          activateTab(tabList[newIndex], tabs, panels);
          tabList[newIndex].focus();
        }
      });
    });
  }

  function activateTab(tab, tabs, panels) {
    tabs.forEach(t => {
      t.setAttribute('aria-selected', 'false');
      t.setAttribute('tabindex', '-1');
    });
    tab.setAttribute('aria-selected', 'true');
    tab.setAttribute('tabindex', '0');

    panels.forEach(p => {
      p.hidden = true;
      p.classList.remove('active');
    });
    const panelId = tab.getAttribute('aria-controls');
    const panel = document.getElementById(panelId);
    if (panel) {
      panel.hidden = false;
      panel.classList.add('active');
    }
  }

  // ── Toggle Button Setup ───────────────────────────────────
  function initToggles() {
    TOGGLE_IDS.forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', () => {
        const pressed = btn.getAttribute('aria-pressed') === 'true';
        btn.setAttribute('aria-pressed', String(!pressed));
        settings[id] = !pressed;
        sendSettings();
      });
    });
  }

  // ── Slider Setup ──────────────────────────────────────────
  function initSliders() {
    Object.keys(SLIDER_IDS).forEach(id => {
      const slider = document.getElementById(id);
      const output = document.getElementById('out-' + id);
      if (!slider) return;

      slider.addEventListener('input', () => {
        const val = parseFloat(slider.value);
        slider.setAttribute('aria-valuenow', val);
        if (output) output.textContent = val + SLIDER_IDS[id].suffix;
        settings[id] = val;
        sendSettings();
      });
    });
  }

  // ── Select Setup ──────────────────────────────────────────
  function initSelects() {
    SELECT_IDS.forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.addEventListener('change', () => {
        settings[id] = sel.value;
        sendSettings();
      });
    });
  }

  // ── Quick Profiles ────────────────────────────────────────
  const PROFILES = {
    visual: {
      highContrast: true, textSize: 130, dyslexiaFont: true,
      highlightLinks: true, enhancedFocus: true
    },
    motor: {
      largeCursor: true, bigTargets: true, enhancedFocus: true,
      stopAnimations: true, cursorSize: 2
    },
    cognitive: {
      readingMask: true, lineHeight: 1.8, letterSpacing: 2,
      simplifyPage: true, lineRuler: true
    },
    blind: {
      blindMode: true, ttsReadOnSelect: true
    },
    senior: {
      textSize: 140, lineHeight: 2.0, largeCursor: true,
      bigTargets: true, enhancedFocus: true, highlightLinks: true
    },
    adhd: {
      focusTimer: true, distractionFree: true, readingProgress: true,
      reduceClutter: true, breakTimer: true
    },
    seizure: {
      flashDetection: true, reduceMotion: true, staticGifs: true,
      disableAutoplay: true, stopAnimations: true
    }
  };

  function initProfiles() {
    $$('.profile-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const profile = btn.getAttribute('data-profile');
        const pressed = btn.getAttribute('aria-pressed') === 'true';

        if (pressed) {
          // Deactivate — reset to defaults
          btn.setAttribute('aria-pressed', 'false');
          resetSettingsToDefaults();
        } else {
          // Deactivate all others
          $$('.profile-btn').forEach(b => b.setAttribute('aria-pressed', 'false'));
          btn.setAttribute('aria-pressed', 'true');

          // Apply profile
          resetSettingsToDefaults();
          const profileSettings = PROFILES[profile];
          if (profileSettings) {
            Object.assign(settings, profileSettings);
          }
        }

        updateUIFromSettings();
        sendSettings();
      });
    });
  }

  function resetSettingsToDefaults() {
    TOGGLE_IDS.forEach(id => { settings[id] = (id === 'blindMode'); });
    Object.keys(SLIDER_IDS).forEach(id => { settings[id] = SLIDER_IDS[id].default; });
    SELECT_IDS.forEach(id => { settings[id] = ''; });
    settings.colorFilter = 'none';
    settings.textAlign = 'default';
    settings.neuroColorTheme = 'none';
  }

  // ── Update UI from settings object ────────────────────────
  function updateUIFromSettings() {
    TOGGLE_IDS.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.setAttribute('aria-pressed', String(!!settings[id]));
    });

    Object.keys(SLIDER_IDS).forEach(id => {
      const slider = document.getElementById(id);
      const output = document.getElementById('out-' + id);
      if (slider) {
        const val = settings[id] !== undefined ? settings[id] : SLIDER_IDS[id].default;
        slider.value = val;
        slider.setAttribute('aria-valuenow', val);
        if (output) output.textContent = val + SLIDER_IDS[id].suffix;
      }
    });

    SELECT_IDS.forEach(id => {
      const sel = document.getElementById(id);
      if (sel) sel.value = settings[id] || (id === 'colorFilter' ? 'none' : '');
    });
  }

  // ── Message Passing ───────────────────────────────────────
  function sendSettings() {
    if (!currentTabId) return;
    chrome.tabs.sendMessage(currentTabId, { action: 'applySettings', data: settings }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[AccessiFlow Popup] Send failed:', chrome.runtime.lastError.message);
      }
    });
  }

  function sendAction(action, callback) {
    if (!currentTabId) return;
    chrome.tabs.sendMessage(currentTabId, { action }, response => {
      if (chrome.runtime.lastError) {
        console.warn('[AccessiFlow Popup] Action failed:', chrome.runtime.lastError.message);
        return;
      }
      if (callback) callback(response);
    });
  }

  // ── Load Settings for Current Hostname ────────────────────
  function loadHostSettings() {
    const key = 'settings_' + currentHostname;
    chrome.storage.local.get(key, data => {
      if (data[key]) {
        settings = data[key];
      } else {
        resetSettingsToDefaults();
      }
      updateUIFromSettings();
    });
  }

  // ── Audit ─────────────────────────────────────────────────
  function initAudit() {
    const btn = $('#btnRunAudit');
    if (!btn) return;

    btn.addEventListener('click', () => {
      btn.textContent = 'Running...';
      btn.disabled = true;

      sendAction('runAudit', response => {
        btn.textContent = 'Run WCAG 2.2 Audit';
        btn.disabled = false;

        if (!response || !response.success) {
          $('#auditResultsList').textContent = 'Audit failed. Is the page loaded?';
          return;
        }

        const { score, issues } = response.data;
        displayAuditResults(score, issues);
      });
    });
  }

  function displayAuditResults(score, issues) {
    // Score circle
    const scoreArea = $('#auditScoreArea');
    const scoreVal = $('#auditScoreValue');
    const scoreCircle = $('#auditScoreCircle');
    scoreArea.hidden = false;
    scoreVal.textContent = score;

    scoreCircle.classList.remove('score-low', 'score-mid');
    if (score < 40) scoreCircle.classList.add('score-low');
    else if (score < 70) scoreCircle.classList.add('score-mid');

    // Issues list
    const list = $('#auditResultsList');
    list.innerHTML = '';
    issues.forEach(issue => {
      const div = document.createElement('div');
      div.className = 'audit-issue audit-issue-' + issue.type;

      const badge = document.createElement('span');
      badge.className = 'audit-badge audit-badge-' + issue.type;
      badge.textContent = issue.type;

      const msg = document.createElement('span');
      msg.textContent = issue.message + (issue.count > 0 ? ' (' + issue.count + ')' : '');

      const crit = document.createElement('span');
      crit.className = 'audit-criterion';
      crit.textContent = issue.criterion;

      div.appendChild(badge);
      div.appendChild(msg);
      div.appendChild(crit);
      list.appendChild(div);
    });
  }

  // ── TTS Buttons ───────────────────────────────────────────
  function initTTS() {
    const readBtn = $('#btnTTSRead');
    const stopBtn = $('#btnTTSStop');
    if (readBtn) readBtn.addEventListener('click', () => sendAction('ttsReadPage'));
    if (stopBtn) stopBtn.addEventListener('click', () => sendAction('ttsStop'));
  }

  // ── AI Features ───────────────────────────────────────────
  function initAI() {
    const status = $('#aiStatus');

    const btnAlt = $('#btnAiAltText');
    const btnSummary = $('#btnAiSummary');
    const btnLinks = $('#btnAiLinks');
    const btnSaveKey = $('#btnSaveApiKey');

    if (btnSaveKey) {
      btnSaveKey.addEventListener('click', () => {
        const key = $('#apiKey').value.trim();
        if (!key) {
          if (status) status.textContent = 'Please enter an API key.';
          return;
        }
        chrome.storage.local.set({ accessiflow_claude_api_key: key }, () => {
          if (status) status.textContent = 'API key saved!';
          $('#apiKey').value = '';
        });
      });
    }

    if (btnAlt) {
      btnAlt.addEventListener('click', () => {
        if (status) status.textContent = 'Generating alt text...';
        sendAction('aiGenerateAltText', r => {
          if (status) status.textContent = r && r.success ? 'Generated alt text for ' + r.count + ' images.' : 'Failed — check API key.';
        });
      });
    }

    if (btnSummary) {
      btnSummary.addEventListener('click', () => {
        if (status) status.textContent = 'Generating summary...';
        sendAction('aiPageSummary', r => {
          if (status) status.textContent = r && r.success && r.summary ? 'Summary: ' + r.summary.substring(0, 100) : 'Failed — check API key.';
        });
      });
    }

    if (btnLinks) {
      btnLinks.addEventListener('click', () => {
        if (status) status.textContent = 'Fixing vague links...';
        sendAction('aiFixLinks', r => {
          if (status) status.textContent = r && r.success ? 'Fixed ' + r.count + ' vague links.' : 'Failed — check API key.';
        });
      });
    }
  }

  // ── Settings Actions ──────────────────────────────────────
  function initSettingsActions() {
    const btnReset = $('#btnResetSettings');
    const btnExport = $('#btnExportSettings');
    const btnImport = $('#btnImportSettings');
    const importFile = $('#importFile');

    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (confirm('Reset all settings for ' + currentHostname + '?')) {
          sendAction('resetSettings');
          resetSettingsToDefaults();
          updateUIFromSettings();
        }
      });
    }

    if (btnExport) {
      btnExport.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'accessiflow-settings-' + currentHostname + '.json';
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    if (btnImport && importFile) {
      btnImport.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          try {
            const imported = JSON.parse(ev.target.result);
            settings = imported;
            updateUIFromSettings();
            sendSettings();
          } catch (err) {
            alert('Invalid settings file.');
          }
        };
        reader.readAsText(file);
      });
    }
  }

  // ── Load API Key Status ───────────────────────────────────
  function loadApiKeyStatus() {
    chrome.storage.local.get('accessiflow_claude_api_key', data => {
      const status = $('#aiStatus');
      if (data.accessiflow_claude_api_key) {
        if (status) status.textContent = 'API key is set.';
      } else {
        if (status) status.textContent = 'No API key set — add one above to use AI features.';
      }
    });
  }

  // ── Initialize ────────────────────────────────────────────
  function init() {
    // Get active tab
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs && tabs[0]) {
        currentTabId = tabs[0].id;
        try {
          const url = new URL(tabs[0].url);
          currentHostname = url.hostname;
        } catch (e) {
          currentHostname = 'unknown';
        }
        const el = $('#currentHostname');
        if (el) el.textContent = currentHostname;

        loadHostSettings();
      }
    });

    initTabs();
    initToggles();
    initSliders();
    initSelects();
    initProfiles();
    initAudit();
    initTTS();
    initAI();
    initSettingsActions();
    loadApiKeyStatus();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
