// AccessiFlow SpeechModule
// Speech disability support: text input alternatives, AAC board, pre-built responses
'use strict';

class SpeechModule {
  constructor() {
    this._styleEl = null;
    this._aacBoard = null;
    this._quickResponses = null;
    this._textInputBar = null;
    this._speechToText = null;
    this._recognition = null;
    this._isListening = false;
  }

  _log(msg) { console.log('[AccessiFlow][Speech] ' + msg); }
  _warn(msg) { console.warn('[AccessiFlow][Speech] ' + msg); }

  _getStyle() {
    if (!this._styleEl || !document.head.contains(this._styleEl)) {
      this._styleEl = document.getElementById('accessiflow-speech-style');
      if (!this._styleEl) {
        this._styleEl = document.createElement('style');
        this._styleEl.id = 'accessiflow-speech-style';
        document.head.appendChild(this._styleEl);
      }
    }
    return this._styleEl;
  }

  buildCSS(s) {
    let css = '';
    try {
      if (s.aacBoard || s.quickResponses || s.textInputBar) {
        css += '.accessiflow-speech-overlay { position:fixed;bottom:0;left:0;right:0;z-index:2147483640;font-family:system-ui,-apple-system,sans-serif; }\n';
      }
    } catch (e) { this._warn('buildCSS: ' + e.message); }
    return css;
  }

  // ── AAC Communication Board ───────────────────────────────
  applyAACBoard(active) {
    try {
      if (active) {
        if (this._aacBoard) return;

        const board = document.createElement('div');
        board.id = 'accessiflow-aac-board';
        board.setAttribute('role', 'toolbar');
        board.setAttribute('aria-label', 'AAC Communication Board');
        board.style.cssText = 'position:fixed;bottom:10px;left:50%;transform:translateX(-50%);z-index:2147483640;background:#16181f;border:2px solid #4fffb0;border-radius:16px;padding:12px;display:flex;flex-wrap:wrap;gap:8px;max-width:600px;box-shadow:0 8px 32px rgba(0,0,0,0.6);';

        // Output display area
        const output = document.createElement('div');
        output.id = 'accessiflow-aac-output';
        output.setAttribute('aria-live', 'assertive');
        output.setAttribute('role', 'status');
        output.style.cssText = 'width:100%;min-height:40px;background:#0e0f13;border:1px solid #2a2d35;border-radius:8px;padding:8px 12px;color:#e0e0e0;font-size:16px;margin-bottom:8px;word-wrap:break-word;';
        output.textContent = '';
        board.appendChild(output);

        // AAC categories with pictograms
        const categories = {
          'Basic Needs': [
            { emoji: '💧', label: 'Water' },
            { emoji: '🍽️', label: 'Food' },
            { emoji: '🚻', label: 'Bathroom' },
            { emoji: '😴', label: 'Rest' },
            { emoji: '🏥', label: 'Help' },
            { emoji: '💊', label: 'Medicine' }
          ],
          'Responses': [
            { emoji: '✅', label: 'Yes' },
            { emoji: '❌', label: 'No' },
            { emoji: '🙏', label: 'Please' },
            { emoji: '🙌', label: 'Thank you' },
            { emoji: '😊', label: 'Happy' },
            { emoji: '😢', label: 'Sad' }
          ],
          'Actions': [
            { emoji: '🔊', label: 'Louder' },
            { emoji: '🔇', label: 'Quieter' },
            { emoji: '⬆️', label: 'More' },
            { emoji: '⬇️', label: 'Less' },
            { emoji: '🔄', label: 'Again' },
            { emoji: '⏹️', label: 'Stop' }
          ],
          'Places': [
            { emoji: '🏠', label: 'Home' },
            { emoji: '🏫', label: 'School' },
            { emoji: '🏪', label: 'Store' },
            { emoji: '🏥', label: 'Hospital' },
            { emoji: '🚗', label: 'Car' },
            { emoji: '📍', label: 'Here' }
          ]
        };

        Object.keys(categories).forEach(catName => {
          const catDiv = document.createElement('div');
          catDiv.style.cssText = 'width:100%;';

          const catLabel = document.createElement('div');
          catLabel.textContent = catName;
          catLabel.style.cssText = 'color:#4fffb0;font-size:11px;font-weight:bold;margin:4px 0 2px 4px;text-transform:uppercase;letter-spacing:1px;';
          catDiv.appendChild(catLabel);

          const row = document.createElement('div');
          row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';

          categories[catName].forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('aria-label', item.label);
            btn.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;width:60px;height:60px;background:#1e2029;border:1px solid #2a2d35;border-radius:10px;cursor:pointer;color:#e0e0e0;font-family:inherit;transition:all 0.15s;';
            btn.innerHTML = '<span style="font-size:24px;">' + item.emoji + '</span><span style="font-size:9px;margin-top:2px;">' + item.label + '</span>';
            btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#4fffb0'; btn.style.background = 'rgba(79,255,176,0.1)'; });
            btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#2a2d35'; btn.style.background = '#1e2029'; });
            btn.addEventListener('click', () => {
              const current = output.textContent || '';
              output.textContent = current + (current ? ' ' : '') + item.label;
              // Also speak it
              try {
                const utter = new SpeechSynthesisUtterance(item.label);
                window.speechSynthesis.speak(utter);
              } catch (e) { /* no TTS */ }
            });
            row.appendChild(btn);
          });

          catDiv.appendChild(row);
          board.appendChild(catDiv);
        });

        // Action buttons row
        const actions = document.createElement('div');
        actions.style.cssText = 'width:100%;display:flex;gap:6px;margin-top:8px;';

        const speakBtn = document.createElement('button');
        speakBtn.type = 'button';
        speakBtn.textContent = '🔊 Speak All';
        speakBtn.style.cssText = 'flex:1;padding:8px;background:#4fffb0;color:#0e0f13;border:none;border-radius:8px;font-weight:bold;cursor:pointer;font-size:13px;';
        speakBtn.addEventListener('click', () => {
          const text = output.textContent.trim();
          if (text) {
            try {
              const utter = new SpeechSynthesisUtterance(text);
              window.speechSynthesis.speak(utter);
            } catch (e) { /* no TTS */ }
          }
        });

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = '🗑️ Clear';
        clearBtn.style.cssText = 'flex:1;padding:8px;background:#2a2d35;color:#e0e0e0;border:none;border-radius:8px;font-weight:bold;cursor:pointer;font-size:13px;';
        clearBtn.addEventListener('click', () => { output.textContent = ''; });

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '✕ Close';
        closeBtn.setAttribute('aria-label', 'Close AAC Board');
        closeBtn.style.cssText = 'padding:8px 16px;background:#ef4444;color:#fff;border:none;border-radius:8px;font-weight:bold;cursor:pointer;font-size:13px;';
        closeBtn.addEventListener('click', () => { board.style.display = 'none'; });

        actions.appendChild(speakBtn);
        actions.appendChild(clearBtn);
        actions.appendChild(closeBtn);
        board.appendChild(actions);

        document.body.appendChild(board);
        this._aacBoard = board;
      } else {
        if (this._aacBoard) { this._aacBoard.remove(); this._aacBoard = null; }
      }
    } catch (e) { this._warn('applyAACBoard: ' + e.message); }
  }

  // ── Quick Responses Panel ─────────────────────────────────
  applyQuickResponses(active) {
    try {
      if (active) {
        if (this._quickResponses) return;

        const panel = document.createElement('div');
        panel.id = 'accessiflow-quick-responses';
        panel.setAttribute('role', 'toolbar');
        panel.setAttribute('aria-label', 'Quick Response Templates');
        panel.style.cssText = 'position:fixed;top:10px;right:10px;z-index:2147483640;background:#16181f;border:2px solid #4fffb0;border-radius:12px;padding:12px;max-width:260px;box-shadow:0 8px 32px rgba(0,0,0,0.6);';

        const title = document.createElement('div');
        title.textContent = 'Quick Responses';
        title.style.cssText = 'color:#4fffb0;font-size:13px;font-weight:bold;margin-bottom:8px;';
        panel.appendChild(title);

        const responses = [
          'Yes, I agree.',
          'No, thank you.',
          'I need more time.',
          'Can you repeat that?',
          'I need help.',
          'I don\'t understand.',
          'That sounds good.',
          'Let me think about it.',
          'Please explain more.',
          'Thank you for your patience.'
        ];

        responses.forEach(text => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = text;
          btn.style.cssText = 'display:block;width:100%;text-align:left;padding:6px 10px;margin-bottom:4px;background:#1e2029;border:1px solid #2a2d35;border-radius:6px;color:#e0e0e0;font-size:12px;cursor:pointer;font-family:inherit;transition:all 0.15s;';
          btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#4fffb0'; btn.style.background = 'rgba(79,255,176,0.1)'; });
          btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#2a2d35'; btn.style.background = '#1e2029'; });
          btn.addEventListener('click', () => {
            // Copy to clipboard and paste into active input
            try { navigator.clipboard.writeText(text); } catch (e) { /* skip */ }
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
              if (activeEl.isContentEditable) {
                document.execCommand('insertText', false, text);
              } else {
                const start = activeEl.selectionStart || 0;
                const end = activeEl.selectionEnd || 0;
                activeEl.value = activeEl.value.substring(0, start) + text + activeEl.value.substring(end);
                activeEl.selectionStart = activeEl.selectionEnd = start + text.length;
                activeEl.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }
            // Also speak it
            try {
              const utter = new SpeechSynthesisUtterance(text);
              window.speechSynthesis.speak(utter);
            } catch (e) { /* skip */ }
          });
          panel.appendChild(btn);
        });

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '✕ Close';
        closeBtn.setAttribute('aria-label', 'Close Quick Responses');
        closeBtn.style.cssText = 'display:block;width:100%;padding:6px;margin-top:8px;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        panel.appendChild(closeBtn);

        document.body.appendChild(panel);
        this._quickResponses = panel;
      } else {
        if (this._quickResponses) { this._quickResponses.remove(); this._quickResponses = null; }
      }
    } catch (e) { this._warn('applyQuickResponses: ' + e.message); }
  }

  // ── Text Input Bar (typing alternative to speaking) ───────
  applyTextInputBar(active) {
    try {
      if (active) {
        if (this._textInputBar) return;

        const bar = document.createElement('div');
        bar.id = 'accessiflow-text-input-bar';
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', 'Text Input Speech Bar');
        bar.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:2147483640;background:#16181f;border:2px solid #4fffb0;border-radius:12px;padding:10px;display:flex;gap:8px;align-items:center;box-shadow:0 8px 32px rgba(0,0,0,0.6);max-width:400px;';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Type to speak...';
        input.setAttribute('aria-label', 'Type text to speak aloud');
        input.style.cssText = 'flex:1;padding:8px 12px;background:#0e0f13;border:1px solid #2a2d35;border-radius:8px;color:#e0e0e0;font-size:14px;min-width:200px;outline:none;';
        input.addEventListener('focus', () => { input.style.borderColor = '#4fffb0'; });
        input.addEventListener('blur', () => { input.style.borderColor = '#2a2d35'; });

        const speakBtn = document.createElement('button');
        speakBtn.type = 'button';
        speakBtn.textContent = '🔊';
        speakBtn.setAttribute('aria-label', 'Speak typed text');
        speakBtn.style.cssText = 'width:40px;height:40px;background:#4fffb0;color:#0e0f13;border:none;border-radius:8px;font-size:18px;cursor:pointer;';
        speakBtn.addEventListener('click', () => {
          const text = input.value.trim();
          if (text) {
            try {
              window.speechSynthesis.cancel();
              const utter = new SpeechSynthesisUtterance(text);
              window.speechSynthesis.speak(utter);
            } catch (e) { /* skip */ }
          }
        });

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') speakBtn.click();
        });

        bar.appendChild(input);
        bar.appendChild(speakBtn);
        document.body.appendChild(bar);
        this._textInputBar = bar;
      } else {
        if (this._textInputBar) { this._textInputBar.remove(); this._textInputBar = null; }
      }
    } catch (e) { this._warn('applyTextInputBar: ' + e.message); }
  }

  // ── Speech-to-Text (voice input for form fields) ──────────
  applySpeechToText(active) {
    try {
      if (active) {
        if (this._speechToText) return;
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
          this._warn('SpeechRecognition API not supported in this browser');
          return;
        }

        // Add mic buttons to all text inputs and textareas
        const inputs = document.querySelectorAll('input[type="text"], input[type="search"], input[type="email"], input[type="url"], input:not([type]), textarea');
        this._speechToText = [];

        inputs.forEach(input => {
          if (input.getAttribute('data-accessiflow-mic')) return;
          input.setAttribute('data-accessiflow-mic', 'true');

          const mic = document.createElement('button');
          mic.type = 'button';
          mic.textContent = '🎤';
          mic.setAttribute('aria-label', 'Voice input for ' + (input.getAttribute('aria-label') || input.name || 'text field'));
          mic.style.cssText = 'position:absolute;right:4px;top:50%;transform:translateY(-50%);width:28px;height:28px;background:rgba(79,255,176,0.2);border:1px solid #4fffb0;border-radius:50%;font-size:14px;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;padding:0;';

          // Wrap input in relative container if needed
          const parent = input.parentElement;
          if (parent && window.getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
          }
          input.style.paddingRight = '36px';
          if (parent) parent.appendChild(mic);

          mic.addEventListener('click', () => {
            if (this._isListening) {
              if (this._recognition) this._recognition.stop();
              mic.style.background = 'rgba(79,255,176,0.2)';
              this._isListening = false;
              return;
            }

            const recognition = new SpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = true;
            recognition.lang = document.documentElement.lang || 'en-US';
            this._recognition = recognition;
            this._isListening = true;
            mic.style.background = 'rgba(239,68,68,0.5)';
            mic.textContent = '⏺';

            recognition.onresult = (event) => {
              let transcript = '';
              for (let i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
              }
              if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
                input.value = transcript;
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
            };

            recognition.onend = () => {
              mic.style.background = 'rgba(79,255,176,0.2)';
              mic.textContent = '🎤';
              this._isListening = false;
            };

            recognition.onerror = () => {
              mic.style.background = 'rgba(79,255,176,0.2)';
              mic.textContent = '🎤';
              this._isListening = false;
            };

            recognition.start();
          });

          this._speechToText.push({ input, mic });
        });
      } else {
        if (this._speechToText) {
          this._speechToText.forEach(({ input, mic }) => {
            try {
              input.removeAttribute('data-accessiflow-mic');
              input.style.paddingRight = '';
              mic.remove();
            } catch (e) { /* skip */ }
          });
          this._speechToText = null;
        }
        if (this._recognition) {
          try { this._recognition.stop(); } catch (e) { /* skip */ }
          this._recognition = null;
        }
        this._isListening = false;
      }
    } catch (e) { this._warn('applySpeechToText: ' + e.message); }
  }

  apply(settings) {
    try {
      const css = this.buildCSS(settings);
      this._getStyle().textContent = css;
      this.applyAACBoard(!!settings.aacBoard);
      this.applyQuickResponses(!!settings.quickResponses);
      this.applyTextInputBar(!!settings.textInputBar);
      this.applySpeechToText(!!settings.speechToText);
    } catch (e) { this._warn('apply: ' + e.message); }
  }

  destroy() {
    try {
      if (this._styleEl) { this._styleEl.remove(); this._styleEl = null; }
      this.applyAACBoard(false);
      this.applyQuickResponses(false);
      this.applyTextInputBar(false);
      this.applySpeechToText(false);
    } catch (e) { this._warn('destroy: ' + e.message); }
  }
}

if (typeof window !== 'undefined') window.SpeechModule = SpeechModule;
