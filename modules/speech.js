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

  /**
   * Speaks in the voice and at the speed the user chose, through content.js,
   * so Stop reaches it too. The browser's default voice is only a fallback
   * for when this module runs on its own.
   */
  static say(text) {
    if (typeof window.AccessiFlowSpeak === 'function') { window.AccessiFlowSpeak(text); return; }
    try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch (e) { /* no speech here */ }
  }

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
              SpeechModule.say(item.label);
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
          if (text) SpeechModule.say(text);
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
            SpeechModule.say(text);
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
          if (text) SpeechModule.say(text);
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
  // ── Dictation ─────────────────────────────────────────────
  //
  // Speaking instead of typing, for anyone who finds a keyboard hard: tremor,
  // one hand, pain, RSI, or simply a long form.
  //
  // The previous version could not be used for a form. It replaced the whole
  // field with each utterance, so it wiped what was already there and every
  // sentence erased the one before it; it stopped after one phrase, so a
  // paragraph meant clicking a 28-pixel target over and over, which is exactly
  // the difficulty being worked around; and it wrote half-recognised text
  // straight into the field. This one inserts at the cursor, keeps listening,
  // and shows what it is hearing somewhere other than the page.

  /** What the spoken words mean, when they are an instruction and not text. */
  dictationCommand(spoken, lang) {
    const said = String(spoken || '').trim().toLowerCase().replace(/[।.?!,]+$/, '');

    const punctuation = {
      'full stop': '.', 'period': '.', 'comma': ',', 'question mark': '?',
      'exclamation mark': '!', 'exclamation point': '!', 'colon': ':',
      'semicolon': ';', 'dash': ' - ', 'open quote': ' "', 'close quote': '" ',
      'new line': '\n', 'newline': '\n', 'next line': '\n', 'new paragraph': '\n\n',
      // Bangla: the sentence ends with a daari, and people say its name.
      'দাঁড়ি': '।', 'daari': '।', 'dari': '।'
    };
    if (Object.prototype.hasOwnProperty.call(punctuation, said)) {
      return { type: 'punctuation', text: punctuation[said] };
    }

    if (said === 'delete that' || said === 'scratch that' || said === 'undo that') {
      return { type: 'undo' };
    }
    if (said === 'stop dictation' || said === 'stop listening' || said === 'stop dictating') {
      return { type: 'stop' };
    }

    void lang;
    return { type: 'text', text: String(spoken || '') };
  }

  /** Puts text where the cursor is, leaving everything else alone. */
  insertIntoField(field, text) {
    if (!field || !text) return 0;

    if (field.isContentEditable) {
      field.focus();
      const selection = field.ownerDocument.getSelection();
      if (selection && selection.rangeCount) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const node = field.ownerDocument.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        field.textContent += text;
      }
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return text.length;
    }

    const value = field.value || '';
    // selectionStart is null on some input types; appending is the safe answer.
    const start = typeof field.selectionStart === 'number' ? field.selectionStart : value.length;
    const end = typeof field.selectionEnd === 'number' ? field.selectionEnd : value.length;

    field.value = value.slice(0, start) + text + value.slice(end);
    const caret = start + text.length;
    try { field.setSelectionRange(caret, caret); } catch (e) { /* not all fields allow it */ }

    // Pages listen for these; a framework-backed form ignores a value that
    // arrives without them.
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return text.length;
  }

  /**
   * Starts from the end of whatever is already in the box.
   *
   * Tabbing into a field in Chrome selects everything in it, so inserting at
   * the selection would replace the text the user already typed — which is
   * the fault this whole rewrite exists to remove. Clicking somewhere inside
   * the text afterwards still works: only the start is forced.
   */
  _caretToEnd(field) {
    try {
      if (field.isContentEditable) {
        const selection = field.ownerDocument.getSelection();
        const range = field.ownerDocument.createRange();
        range.selectNodeContents(field);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      const end = (field.value || '').length;
      // Number and email boxes refuse this in Chrome, which is harmless.
      if (typeof field.setSelectionRange === 'function') field.setSelectionRange(end, end);
    } catch (e) { /* the box does not allow a caret; appending still works */ }
  }

  /**
   * The words, spaced against what they are joining. A space is added only
   * when there is something before them that does not already end in one, so
   * dictating after "Monir " does not produce "Monir  Rakib".
   */
  dictationText(field, said) {
    const words = String(said || '').trim();
    if (!words) return '';

    const value = field && !field.isContentEditable ? (field.value || '')
                : (field ? field.textContent || '' : '');
    const caret = field && typeof field.selectionStart === 'number' ? field.selectionStart : value.length;
    const before = value.slice(0, caret);

    return (before && !/\s$/.test(before) ? ' ' : '') + words;
  }

  /** Takes back the last thing dictated, for "delete that". */
  undoLastDictation() {
    const state = this._dictation;
    if (!state || !state.field || !state.lastLength) return;

    const field = state.field;
    if (field.isContentEditable) {
      field.textContent = field.textContent.slice(0, -state.lastLength);
    } else {
      const value = field.value || '';
      const caret = typeof field.selectionStart === 'number' ? field.selectionStart : value.length;
      const from = Math.max(0, caret - state.lastLength);
      field.value = value.slice(0, from) + value.slice(caret);
      try { field.setSelectionRange(from, from); } catch (e) { /* ok */ }
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    state.lastLength = 0;
  }

  /** Every box worth dictating into. Passwords are deliberately not included. */
  _dictationFields() {
    return Array.from(document.querySelectorAll(
      'input[type="text"], input[type="search"], input[type="email"], input[type="url"], ' +
      'input[type="tel"], input[type="number"], input:not([type]), textarea, [contenteditable="true"]'
    )).filter(el => !el.disabled && !el.readOnly);
  }

  /** The box the words should go into: the focused one, or the only one. */
  _dictationTarget() {
    const active = document.activeElement;
    const fields = this._dictationFields();
    if (active && fields.indexOf(active) > -1) return active;
    if (this._dictation && this._dictation.field &&
        document.contains(this._dictation.field)) return this._dictation.field;
    return fields.length === 1 ? fields[0] : null;
  }

  /**
   * The bar. It exists so that what is being heard appears somewhere other
   * than the field itself: half-recognised words arriving in a form look like
   * the form is corrupting itself, and for someone who cannot easily undo
   * that, it is worse than no dictation at all.
   */
  _dictationBar() {
    let bar = document.getElementById('accessiflow-dictation');
    if (bar) return bar;

    bar = document.createElement('div');
    bar.id = 'accessiflow-dictation';
    bar.setAttribute('data-accessiflow-injected', 'true');
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Dictation');
    bar.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);' +
      'z-index:2147483640;background:#16181f;color:#e8eaf0;border:2px solid #4fffb0;' +
      'border-radius:14px;padding:10px 12px;display:flex;align-items:center;gap:10px;' +
      'max-width:min(640px,92vw);box-shadow:0 8px 32px rgba(0,0,0,0.5);' +
      'font:15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;';

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'accessiflow-dictation-toggle';
    // 44px, because the people this is for are the ones who miss small targets.
    button.style.cssText = 'min-width:44px;min-height:44px;border-radius:10px;border:2px solid #4fffb0;' +
      'background:rgba(79,255,176,0.16);color:#4fffb0;font:inherit;font-weight:700;cursor:pointer;padding:0 12px;';
    button.textContent = 'Start';
    button.setAttribute('aria-label', 'Start dictation');
    button.addEventListener('click', () => this.toggleDictation());

    const status = document.createElement('p');
    status.id = 'accessiflow-dictation-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'margin:0;flex:1;min-width:0;color:#aab3c4;';
    status.textContent = 'Press Alt+Shift+V, or Start, then speak.';

    bar.append(button, status);
    document.body.appendChild(bar);
    return bar;
  }

  _dictationSay(message, heard) {
    const status = document.getElementById('accessiflow-dictation-status');
    if (status) status.textContent = heard ? '“' + heard + '”' : message;
  }

  applySpeechToText(active, settings) {
    try {
      if (!active) {
        this.stopDictation();
        const bar = document.getElementById('accessiflow-dictation');
        if (bar) bar.remove();
        this._dictation = null;
        return;
      }

      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) {
        this._warn('This browser has no speech recognition.');
        return;
      }

      this._dictation = this._dictation || { listening: false, field: null, lastLength: 0 };
      this._dictation.lang = (settings && settings.dictationLanguage) || '';
      this._dictationBar();

      // Remember which box to fill while the user is choosing one.
      if (!this._dictationFocus) {
        this._dictationFocus = e => {
          if (!this._dictation) return;
          const field = e.target;
          if (this._dictationFields().indexOf(field) > -1) this._dictation.field = field;
        };
        document.addEventListener('focusin', this._dictationFocus, true);
      }
    } catch (e) { this._warn('applySpeechToText: ' + e.message); }
  }

  toggleDictation() {
    if (this._dictation && this._dictation.listening) this.stopDictation();
    else this.startDictation();
  }

  startDictation() {
    try {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition || !this._dictation) return;

      const field = this._dictationTarget();
      if (!field) {
        this._dictationSay('Click or tab into the box you want to fill, then start again.');
        return;
      }
      this._dictation.field = field;
      this._caretToEnd(field);

      const recognition = new Recognition();
      // Keeps listening: a paragraph should not cost one press per sentence.
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = this._dictation.lang ||
        document.documentElement.getAttribute('lang') ||
        navigator.language || 'en-US';

      recognition.onresult = event => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const said = result[0].transcript;
          if (!result.isFinal) { interim += said; continue; }

          const command = this.dictationCommand(said, recognition.lang);
          if (command.type === 'stop') { this.stopDictation(); return; }
          if (command.type === 'undo') { this.undoLastDictation(); continue; }

          const text = command.type === 'punctuation' ? command.text
            : this.dictationText(this._dictation.field, said);
          this._dictation.lastLength = this.insertIntoField(this._dictation.field, text);
        }
        if (interim.trim()) this._dictationSay('', interim.trim());
      };

      // Chrome stops on its own after a pause; start again so dictation lasts
      // as long as the user wants it to.
      recognition.onend = () => {
        if (this._dictation && this._dictation.listening) {
          try { recognition.start(); } catch (e) { /* already starting */ }
        }
      };

      recognition.onerror = event => {
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        const message = event.error === 'not-allowed'
          ? 'Microphone blocked. Allow the microphone for this site, then start again.'
          : 'Dictation stopped: ' + event.error;
        this.stopDictation();
        this._dictationSay(message);
        this._warn(message);
      };

      this._dictation.recognition = recognition;
      this._dictation.listening = true;
      recognition.start();

      const button = document.getElementById('accessiflow-dictation-toggle');
      if (button) {
        button.textContent = 'Stop';
        button.setAttribute('aria-label', 'Stop dictation');
        button.style.background = 'rgba(255,107,107,0.18)';
        button.style.borderColor = '#ff6b6b';
        button.style.color = '#ff6b6b';
      }
      this._dictationSay('Listening. Say "full stop", "new line", "delete that" or "stop dictation".');
    } catch (e) {
      this._warn('startDictation: ' + e.message);
    }
  }

  stopDictation() {
    const state = this._dictation;
    if (!state) return;
    state.listening = false;
    if (state.recognition) {
      try { state.recognition.stop(); } catch (e) { /* ok */ }
      state.recognition = null;
    }

    const button = document.getElementById('accessiflow-dictation-toggle');
    if (button) {
      button.textContent = 'Start';
      button.setAttribute('aria-label', 'Start dictation');
      button.style.background = 'rgba(79,255,176,0.16)';
      button.style.borderColor = '#4fffb0';
      button.style.color = '#4fffb0';
    }
    this._dictationSay('Stopped. Press Alt+Shift+V to dictate again.');
  }


  apply(settings) {
    try {
      const css = this.buildCSS(settings);
      this._getStyle().textContent = css;
      this.applyAACBoard(!!settings.aacBoard);
      this.applyQuickResponses(!!settings.quickResponses);
      this.applyTextInputBar(!!settings.textInputBar);
      this.applySpeechToText(!!settings.speechToText, settings);
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
