// AccessiFlow on-screen keyboard
//
// A keyboard on the page, pressed with the mouse one key at a time. It can
// be dragged anywhere, made bigger or smaller, and follows the user from
// page to page until it is hidden.
//
// Ctrl, Alt, Shift and the Windows key stay down once pressed, so a
// shortcut is built one key at a time and nobody has to hold three keys
// with one hand: Ctrl, then Shift, then S, then Do it. The line above the
// keys says what the combination will do before it is done, because a
// Ctrl+W pressed by mistake closes the tab. Shift on its own is the
// ordinary kind: the next letter is a capital, then it lets go.
//
// Shortcuts opens a list of the things shortcuts are for (copy, paste, new
// tab, zoom, screenshot), with a box to ask for one in plain words: "take a
// screenshot" finds Screenshot. That is matched on the computer; nothing
// typed there is sent anywhere.
//
// Keys never take focus. Pressing one would otherwise pull focus out of the
// box being typed in, and the next key would have nowhere to go.
'use strict';

(function () {
  if (typeof window !== 'undefined' && window.AccessiFlowScreenKeyboard) return;

  const STORE_KEY = 'accessiflow_keyboard';
  const MIN_W = 380;
  const MIN_H = 150;
  const HINT = 'Ctrl, Alt, Shift and Win stay held after one click, so shortcuts need only one hand.';

  // Two-character strings are a key and its shifted character. `w` is width
  // in key units; every row adds up to 15.
  const LAYOUT = [
    [{ k: 'Escape', label: 'Esc', w: 2.5 }, { k: 'Home', w: 2.5 }, { k: 'End', w: 2.5 },
      { k: 'PageUp', label: 'Page up', w: 2.5 }, { k: 'PageDown', label: 'Page down', w: 2.5 },
      { k: 'Delete', w: 2.5, repeat: true }],
    ['`~', '1!', '2@', '3#', '4$', '5%', '6^', '7&', '8*', '9(', '0)', '-_', '=+',
      { k: 'Backspace', label: '⌫ Back', name: 'Backspace', w: 2, repeat: true }],
    [{ k: 'Tab', w: 1.5 }, 'qQ', 'wW', 'eE', 'rR', 'tT', 'yY', 'uU', 'iI', 'oO', 'pP', '[{', ']}',
      { chars: '\\|', w: 1.5 }],
    [{ k: 'CapsLock', label: 'Caps', name: 'Caps Lock', w: 1.75 }, 'aA', 'sS', 'dD', 'fF', 'gG', 'hH', 'jJ',
      'kK', 'lL', ';:', '\'"', { k: 'Enter', w: 2.25 }],
    [{ mod: 'shift', label: 'Shift', w: 2.5 }, 'zZ', 'xX', 'cC', 'vV', 'bB', 'nN', 'mM', ',<', '.>', '/?',
      { k: 'ArrowUp', label: '↑', name: 'Up arrow', w: 1.25, repeat: true },
      { mod: 'shift', label: 'Shift', w: 1.25 }],
    [{ mod: 'ctrl', label: 'Ctrl', w: 1.75 }, { mod: 'win', label: 'Win', name: 'Windows key', w: 1.5 },
      { mod: 'alt', label: 'Alt', w: 1.5 }, { k: ' ', label: 'Space', w: 6.5 },
      { k: 'ArrowLeft', label: '←', name: 'Left arrow', w: 1.25, repeat: true },
      { k: 'ArrowDown', label: '↓', name: 'Down arrow', w: 1.25, repeat: true },
      { k: 'ArrowRight', label: '→', name: 'Right arrow', w: 1.25, repeat: true }]
  ];

  /** Every key as one shape: { char, shifted, letter } or { k } or { mod }. */
  function keyDefs() {
    return LAYOUT.map(row => row.map(entry => {
      const spec = typeof entry === 'string' ? { chars: entry } : Object.assign({}, entry);
      if (spec.chars) {
        spec.char = spec.chars[0];
        spec.shifted = spec.chars[1];
        spec.letter = /[a-z]/.test(spec.char);
        delete spec.chars;
      }
      spec.w = spec.w || 1;
      return spec;
    }));
  }

  const FOCUSABLE = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, iframe, summary, ' +
    '[contenteditable=""], [contenteditable="true"], [tabindex]';
  const PRESSABLE = 'a[href], button, summary, input[type="checkbox"], input[type="radio"], input[type="submit"], ' +
    'input[type="button"], input[type="reset"], [role="button"], [role="link"], [role="checkbox"], [role="radio"], ' +
    '[role="switch"], [role="menuitem"], [role="tab"], [role="option"]';

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const STYLE = [
    ':host { all: initial; }',
    '.kb { box-sizing: border-box; position: relative; display: flex; flex-direction: column; gap: 6px; ',
    '  font: 14px/1.25 system-ui, -apple-system, "Segoe UI", sans-serif; color: #f4f5f7; background: #16181d; ',
    '  border: 2px solid #4fffb0; border-radius: 12px; padding: 8px 8px 10px; box-shadow: 0 10px 30px rgba(0,0,0,.5); ',
    '  -webkit-user-select: none; user-select: none; }',
    '.bar { display: flex; align-items: center; gap: 6px; }',
    '.grip { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px; ',
    '  background: #20232a; cursor: move; touch-action: none; }',
    '.grip .dots { color: #a9b0bd; font-size: 18px; line-height: 1; }',
    '.grip .title { font-weight: 700; color: #4fffb0; white-space: nowrap; }',
    '.grip .into { color: #c9ced8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    'button { font-family: inherit; }',
    '.tool { font: 600 13px/1 system-ui, sans-serif; min-height: 36px; min-width: 36px; padding: 0 10px; color: #f4f5f7; ',
    '  background: #2a2e37; border: 1px solid #555c69; border-radius: 8px; cursor: var(--af-cursor-hand, pointer); white-space: nowrap; }',
    '.tool:hover { border-color: #4fffb0; }',
    '.tool[aria-pressed="true"] { background: #4fffb0; color: #111; border-color: #111; }',
    'button:focus-visible, input:focus-visible { outline: 3px solid #ffd400; outline-offset: 2px; }',
    '.line { box-sizing: border-box; min-height: 54px; display: flex; align-items: center; gap: 8px; padding: 4px 8px; ',
    '  border-radius: 10px; background: #20232a; border: 2px solid transparent; }',
    '.line.building { border-color: #ffd400; }',
    '.message { flex: 1; min-width: 0; color: #c9ced8; }',
    '.message.said { color: #111; background: #ffd400; font-weight: 600; padding: 6px 10px; border-radius: 8px; }',
    '.status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }',
    '.combo { flex: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }',
    '.message[hidden], .combo[hidden], .panel[hidden], .suggest[hidden] { display: none; }',
    // A fixed height, so words coming and going never move the keys.
    '.suggest { box-sizing: border-box; height: 46px; display: flex; gap: 6px; align-items: stretch; }',
    '.sugg { flex: 1 1 0; min-width: 0; font: 600 16px/1 system-ui, "Segoe UI", sans-serif; color: #111; ',
    '  background: #4fffb0; border: 2px solid #111; border-radius: 8px; cursor: var(--af-cursor-hand, pointer); ',
    '  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 8px; }',
    '.sugg:hover { background: #ffd400; }',
    '.suggest .empty { flex: 1; align-self: center; color: #a9b0bd; padding: 0 4px; }',
    '.chips { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }',
    'kbd { font: 700 15px/1.4 ui-monospace, "Cascadia Mono", Consolas, monospace; padding: 2px 8px; border-radius: 6px; ',
    '  background: #ffd400; color: #111; }',
    'kbd.waiting { background: transparent; color: #a9b0bd; border: 1px dashed #a9b0bd; }',
    '.plus { color: #a9b0bd; }',
    '.means { flex: 1; min-width: 150px; }',
    '.means.cannot { color: #ffc2b8; }',
    '.doit { font: 700 15px/1 system-ui, sans-serif; min-height: 40px; padding: 0 18px; color: #111; background: #4fffb0; ',
    '  border: 2px solid #111; border-radius: 8px; cursor: var(--af-cursor-hand, pointer); }',
    '.doit:disabled { opacity: .45; cursor: var(--af-cursor, default); }',
    '.panel { display: grid; gap: 8px; padding: 8px; border-radius: 10px; background: #20232a; }',
    '.ask { display: grid; gap: 4px; }',
    '.ask label { font-weight: 700; }',
    '.ask input { font: 16px/1.3 system-ui, sans-serif; padding: 8px 10px; border-radius: 8px; border: 2px solid #555c69; ',
    '  background: #0e0f13; color: #f4f5f7; -webkit-user-select: text; user-select: text; }',
    // A fixed height, not a maximum: the list shrinking as the search narrows
    // would move every key under the user's hand with each letter typed.
    '.results { height: 190px; overflow: auto; display: grid; gap: 6px; align-content: start; ',
    '  grid-template-columns: repeat(auto-fill, minmax(165px, 1fr)); }',
    '.results h3 { grid-column: 1 / -1; margin: 6px 0 0; font-size: 12px; font-weight: 600; text-transform: uppercase; ',
    '  letter-spacing: .06em; color: #a9b0bd; }',
    '.act { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left; min-height: 48px; ',
    '  padding: 8px 10px; font: 600 14px/1.2 system-ui, sans-serif; color: #f4f5f7; background: #2a2e37; ',
    '  border: 1px solid #555c69; border-radius: 8px; cursor: var(--af-cursor-hand, pointer); }',
    '.act:hover { border-color: #4fffb0; }',
    '.act.first { border: 2px solid #4fffb0; }',
    '.act.armed { background: #ffd400; color: #111; border-color: #111; }',
    '.act .keys { font: 12px/1.2 ui-monospace, Consolas, monospace; color: #a9b0bd; }',
    '.act.armed .keys { color: #333; }',
    '.none { grid-column: 1 / -1; margin: 0; color: #c9ced8; }',
    '.keys-area { display: flex; flex-direction: column; gap: 5px; }',
    '.row { flex: 1 1 0; min-height: 0; display: flex; gap: 5px; }',
    '.key { flex: var(--w) 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; ',
    '  justify-content: center; gap: 1px; padding: 0 2px; overflow: hidden; ',
    '  font: 600 var(--key-font, 18px)/1 system-ui, "Segoe UI", sans-serif; color: #f4f5f7; background: #2a2e37; ',
    '  border: 1px solid #555c69; border-bottom-width: 4px; border-radius: 8px; cursor: var(--af-cursor-hand, pointer); }',
    '.key.named { font-size: calc(var(--key-font, 18px) * .7); }',
    '.key .sub { font-size: calc(var(--key-font, 18px) * .55); font-weight: 600; color: #a9b0bd; }',
    '.key:hover { background: #363b46; border-color: #4fffb0; }',
    '.key:active { background: #4a5060; }',
    '.key.on { background: #ffd400; color: #111; border-color: #111; }',
    '.key.on .sub { color: #333; }',
    '.resize { position: absolute; right: 0; bottom: 0; width: 26px; height: 26px; cursor: nwse-resize; touch-action: none; ',
    '  background: linear-gradient(135deg, transparent 50%, #4fffb0 50%, #4fffb0 58%, transparent 58%, transparent 70%, ',
    '  #4fffb0 70%, #4fffb0 78%, transparent 78%); border-bottom-right-radius: 10px; }',
    '@media (forced-colors: active) {',
    '  .kb, .combo, .panel { border: 2px solid CanvasText; }',
    '  .key, .tool, .act, .doit { border: 2px solid ButtonText; }',
    '  .key.on, .tool[aria-pressed="true"], .act.armed { forced-color-adjust: none; background: Highlight; color: HighlightText; }',
    '}'
  ].join('\n');

  class AccessiFlowScreenKeyboard {
    /**
     * @param {object} [options]
     * @param {function()} [options.onHide] the Hide button; turns the setting off
     */
    constructor(options) {
      const o = options || {};
      this._onHide = o.onHide || (() => this.hide());
      this._mods = { ctrl: false, alt: false, shift: false, win: false };
      this._caps = false;
      this._main = null;           // the key chosen to go with held modifiers
      this._shown = false;
      this._host = null;
      this._geo = null;            // { x, y, w, h }; h is the height of the keys
      this._saveTimer = null;
      this._statusTimer = null;
      this._carrying = null;
      this._saved = null;          // where the user was on the page before using the search box
      this._armed = null;          // an action waiting for its second press
      this._repeat = null;
      this._suggestOn = true;
      this._predictor = null;      // made the first time a word is started
      this._suggestFrame = null;

      this._onFocusIn = this._onFocusIn.bind(this);
      this._onTyping = this._onTyping.bind(this);
      this._onFocusOut = this._onFocusOut.bind(this);
      this._onResize = this._onResize.bind(this);
      this._onCarryMove = this._onCarryMove.bind(this);
      this._onCarryUp = this._onCarryUp.bind(this);
      this._onCarryDown = this._onCarryDown.bind(this);
    }

    get shown() { return this._shown; }

    /**
     * @param {object} opts
     * @param {boolean} opts.enabled
     * @param {boolean} [opts.suggestions] whole words offered above the keys; on unless false
     */
    apply(opts) {
      const o = opts || {};
      this._suggestOn = o.suggestions !== false;
      if (this._suggestRow) {
        this._suggestRow.hidden = !this._suggestOn;
        this._updateSuggestions();
      }
      if (o.enabled) this.show();
      else this.hide();
    }

    show() {
      if (this._shown) return;
      if (!this._host || !this._host.isConnected) this._build();
      this._shown = true;
      this._host.style.display = '';
      document.addEventListener('focusin', this._onFocusIn, true);
      document.addEventListener('focusout', this._onFocusOut, true);
      // Typing on a real keyboard, and moving the caret, change the word too.
      document.addEventListener('input', this._onTyping, true);
      document.addEventListener('selectionchange', this._onTyping);
      window.addEventListener('resize', this._onResize);
      this._loadGeo();
      this._updateTarget();
      this._updateSuggestions();
    }

    hide() {
      if (!this._shown) return;
      this._shown = false;
      this._endCarry();
      this._stopRepeat();
      this._clearCombo();
      if (this._host) this._host.style.display = 'none';
      document.removeEventListener('focusin', this._onFocusIn, true);
      document.removeEventListener('focusout', this._onFocusOut, true);
      document.removeEventListener('input', this._onTyping, true);
      document.removeEventListener('selectionchange', this._onTyping);
      window.removeEventListener('resize', this._onResize);
    }

    /** Shows the keyboard with its Shortcuts list open, for the ring's Shortcuts choice. */
    openShortcuts() {
      this.show();
      this._togglePanel(true);
    }

    destroy() {
      this.hide();
      clearTimeout(this._saveTimer);
      clearTimeout(this._statusTimer);
      if (this._host) this._host.remove();
      this._host = null;
    }

    // ── Building ────────────────────────────────────────────────────────────

    _build() {
      const host = document.createElement('div');
      host.id = 'accessiflow-keyboard';
      host.style.cssText = 'all: initial; position: fixed; left: 16px; top: 16px; z-index: 2147483645; display: none;';
      const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
      this._root = root;

      const style = document.createElement('style');
      style.textContent = STYLE;
      root.appendChild(style);

      const kb = document.createElement('div');
      kb.className = 'kb';
      kb.setAttribute('role', 'group');
      kb.setAttribute('aria-label', 'On-screen keyboard');
      this._kb = kb;

      // ── The bar: move handle, where typing goes, and the tools ──
      const bar = document.createElement('div');
      bar.className = 'bar';
      const grip = document.createElement('div');
      grip.className = 'grip';
      grip.title = 'Drag to move, or click once to pick up and again to put down';
      const dots = document.createElement('span');
      dots.className = 'dots';
      dots.setAttribute('aria-hidden', 'true');
      dots.textContent = '⠿';
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = 'Keyboard';
      const into = document.createElement('span');
      into.className = 'into';
      grip.append(dots, title, into);
      grip.addEventListener('pointerdown', e => this._startCarry('move', e));
      this._into = into;

      const smaller = this._tool('A−', 'Make the keyboard smaller', () => this._scale(1 / 1.15));
      const bigger = this._tool('A+', 'Make the keyboard bigger', () => this._scale(1.15));
      this._shortcutsBtn = this._tool('Shortcuts', 'Show shortcuts, and ask for one in plain words',
        () => this._togglePanel());
      this._shortcutsBtn.setAttribute('aria-pressed', 'false');
      const hide = this._tool('Hide', 'Hide the on-screen keyboard', () => this._onHide());
      bar.append(grip, smaller, bigger, this._shortcutsBtn, hide);

      // ── One line above the keys, always the same height: it says what just
      // happened, or shows the shortcut being built. Messages that came and
      // went in lines of their own moved every key under the user's hand.
      const line = document.createElement('div');
      line.className = 'line';
      const message = document.createElement('div');
      message.className = 'message';
      message.setAttribute('aria-hidden', 'true');
      // Read out by a screen reader once, without the hint that follows it.
      const status = document.createElement('div');
      status.className = 'status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      this._line = line;
      this._message = message;
      this._status = status;
      this._said = '';

      // ── The combination being built ──
      const combo = document.createElement('div');
      combo.className = 'combo';
      combo.hidden = true;
      const chips = document.createElement('div');
      chips.className = 'chips';
      const means = document.createElement('div');
      means.className = 'means';
      const doit = document.createElement('button');
      doit.type = 'button';
      doit.className = 'doit';
      doit.textContent = 'Do it';
      doit.addEventListener('click', () => this._doIt());
      const clear = this._tool('Clear', 'Let go of every held key', () => this._clearCombo());
      combo.append(chips, means, doit, clear);
      this._combo = { box: combo, chips: chips, means: means, doit: doit };
      line.append(message, combo, status);

      // ── Shortcuts, and the plain-words search ──
      const panel = document.createElement('section');
      panel.className = 'panel';
      panel.hidden = true;
      panel.setAttribute('aria-label', 'Shortcuts');
      const ask = document.createElement('div');
      ask.className = 'ask';
      const label = document.createElement('label');
      label.htmlFor = 'accessiflow-ask';
      label.textContent = 'What do you want to do?';
      const input = document.createElement('input');
      input.id = 'accessiflow-ask';
      input.type = 'search';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = 'For example: take a screenshot';
      input.addEventListener('mousedown', () => { if (!this._saved) this._saved = this._snapshot(); });
      input.addEventListener('input', () => this._renderResults());
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); this._runFirst(); }
        if (e.key === 'Escape') { e.preventDefault(); this._leaveSearch(); }
      });
      ask.append(label, input);
      const results = document.createElement('div');
      results.className = 'results';
      panel.append(ask, results);
      this._panel = panel;
      this._search = input;
      this._results = results;

      // ── The keys ──
      const area = document.createElement('div');
      area.className = 'keys-area';
      this._keyButtons = [];
      keyDefs().forEach(row => {
        const line = document.createElement('div');
        line.className = 'row';
        row.forEach(def => {
          const button = document.createElement('button');
          button.type = 'button';
          button.tabIndex = -1;
          button.className = 'key' + (def.char ? '' : ' named');
          button.style.setProperty('--w', String(def.w));
          const main = document.createElement('span');
          main.className = 'main';
          const sub = document.createElement('span');
          sub.className = 'sub';
          sub.setAttribute('aria-hidden', 'true');
          button.append(main, sub);
          button.addEventListener('click', () => {
            if (this._repeat && this._repeat.fired) { this._repeat = null; return; }
            this._press(def);
          });
          if (def.repeat) {
            button.addEventListener('pointerdown', () => this._startRepeat(def));
            button.addEventListener('pointerup', () => this._stopRepeat(true));
            button.addEventListener('pointerleave', () => this._stopRepeat(false));
          }
          line.appendChild(button);
          this._keyButtons.push({ def: def, button: button, main: main, sub: sub });
        });
        area.appendChild(line);
      });
      this._keysArea = area;

      const resize = document.createElement('div');
      resize.className = 'resize';
      resize.title = 'Drag to resize, or click once to pick up and again to put down';
      resize.setAttribute('aria-hidden', 'true');
      resize.addEventListener('pointerdown', e => this._startCarry('resize', e));

      // ── Whole words, offered as the user types ──
      const suggest = document.createElement('div');
      suggest.className = 'suggest';
      suggest.setAttribute('role', 'group');
      suggest.setAttribute('aria-label', 'Suggested words');
      suggest.hidden = !this._suggestOn;
      this._suggestRow = suggest;

      kb.append(bar, line, panel, suggest, area, resize);
      root.appendChild(kb);

      // Pressing anything but the search box leaves focus where it was: in
      // the page's box, with its caret and selection untouched.
      kb.addEventListener('mousedown', e => {
        const path = e.composedPath ? e.composedPath() : [e.target];
        if (path[0] !== this._search) e.preventDefault();
      });
      // The page never hears clicks on the keyboard. A site that closes its
      // suggestions, or a pop-up, on any click elsewhere would otherwise
      // close them on every key.
      ['mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'contextmenu'].forEach(type => {
        host.addEventListener(type, e => e.stopPropagation());
      });

      document.documentElement.appendChild(host);
      this._host = host;
      this._refresh();
      this._renderResults();
    }

    _tool(text, label, onClick) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tool';
      button.textContent = text;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', onClick);
      return button;
    }

    // ── Pressing keys ───────────────────────────────────────────────────────

    _A() { return window.AccessiFlowHandActions; }

    _comboMode() { return this._mods.ctrl || this._mods.alt || this._mods.win; }

    _press(def) {
      this._pressKey(def);
      this._updateTarget();
      this._updateSuggestions();
    }

    // ── Suggested words ─────────────────────────────────────────────────────

    /** The page's box that suggestions are for: never a password, never the search box. */
    _suggestField() {
      const A = this._A();
      const el = A.deepActive();
      if (!A.isTextField(el) || A.isOurs(el)) return null;
      if ((el.getAttribute('type') || '').toLowerCase() === 'password') return null;
      return el;
    }

    _model() {
      if (!this._predictor) {
        const P = window.AccessiFlowWordPredict;
        if (!P) return null;
        this._predictor = P.create({
          text: () => (document.body ? (document.body.innerText || document.body.textContent || '') : '')
        });
      }
      return this._predictor;
    }

    _onTyping(e) {
      if (e && e.type === 'input') {
        const el = e.composedPath ? e.composedPath()[0] : e.target;
        if (this._A().isOurs(el)) return;
      }
      if (this._suggestFrame) return;
      const later = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : fn => setTimeout(fn, 16);
      this._suggestFrame = later(() => {
        this._suggestFrame = null;
        this._updateSuggestions();
      });
    }

    _updateSuggestions() {
      const row = this._suggestRow;
      if (!row || row.hidden) return;
      const P = window.AccessiFlowWordPredict;
      const field = this._suggestField();
      const at = field && P ? P.wordBefore(field) : null;
      const model = at ? this._model() : null;
      const words = model ? model.suggest(at.word, this._geo && this._geo.w >= 640 ? 4 : 3) : [];

      const key = words.join('\u0000') + '|' + (field ? 1 : 0);
      if (key === this._shownWords) return;
      this._shownWords = key;
      while (row.firstChild) row.removeChild(row.firstChild);
      if (!words.length) {
        const empty = document.createElement('span');
        empty.className = 'empty';
        empty.textContent = field ? 'Words to finish what you are typing show here.' : '';
        row.appendChild(empty);
        return;
      }
      words.forEach(word => {
        const button = document.createElement('button');
        button.type = 'button';
        button.tabIndex = -1;
        button.className = 'sugg';
        button.textContent = word;
        button.setAttribute('aria-label', 'Type ' + word);
        button.addEventListener('click', () => this._accept(word));
        row.appendChild(button);
      });
    }

    /** Swaps the part-typed word for the whole one, and a space, in one step Undo can take back. */
    _accept(word) {
      const A = this._A();
      const P = window.AccessiFlowWordPredict;
      const field = this._suggestField();
      const at = field && P ? P.wordBefore(field) : null;
      if (!at) return;
      try {
        if (at.node) {
          const doc = field.ownerDocument || document;
          const range = doc.createRange();
          range.setStart(at.node, at.start);
          range.setEnd(at.node, at.end);
          const sel = doc.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          field.setSelectionRange(at.start, at.end);
        }
      } catch (e) { return; }
      A.insertText(field, word + ' ');
      const model = this._model();
      if (model) model.learn(word);
      this._updateSuggestions();
    }

    /** Counts the word just finished, as a space or a full stop ends it. */
    _learnWord(field) {
      const P = window.AccessiFlowWordPredict;
      if (!P || !field || field !== this._suggestField()) return;
      const at = P.wordBefore(field);
      const model = at ? this._model() : null;
      if (model) model.learn(at.word);
    }

    _pressKey(def) {
      if (def.mod) {
        // Attention has moved to a new shortcut; the last message can go.
        clearTimeout(this._statusTimer);
        this._said = '';
        this._status.textContent = '';
        this._mods[def.mod] = !this._mods[def.mod];
        if (!this._comboMode()) this._main = null;
        this._refresh();
        return;
      }
      if (def.k === 'CapsLock') {
        this._caps = !this._caps;
        this._refresh();
        return;
      }
      if (this._comboMode()) {
        // Held Ctrl, Alt or Windows: this key completes a shortcut, which
        // waits for Do it rather than going off on its own.
        this._main = def;
        this._refresh();
        return;
      }
      const shift = this._mods.shift;
      this._type(def, shift);
      if (shift) {
        this._mods.shift = false;
        this._refresh();
      }
    }

    /** The box typing goes into: the page's, or this keyboard's own search box. */
    _field() {
      const A = this._A();
      const el = A.deepActive();
      return A.isTextField(el) ? el : null;
    }

    _type(def, shift) {
      const A = this._A();
      const field = this._field();

      if (def.char) {
        let ch = shift ? def.shifted : def.char;
        if (def.letter && this._caps) ch = shift ? def.char : def.shifted;
        if (field) {
          if (/[.,!?;:)\]}"']/.test(ch)) this._learnWord(field);
          A.insertText(field, ch);
          this._updateTarget();
          return;
        }
        // Nothing to type into. A site's single-key shortcuts (K to pause a
        // video, C to compose a message) still hear it.
        if (!A.sendKeys(A.deepActive(), { shift: shift }, def.char)) {
          this._say('Click a box on the page first, then type.');
        }
        return;
      }

      switch (def.k) {
        case ' ': return this._space(field, shift);
        case 'Backspace': case 'Delete': {
          const dir = def.k === 'Backspace' ? -1 : 1;
          if (field === this._search) { A.deleteText(field, dir); this._renderResults(); return; }
          if (field) { A.deleteText(field, dir); return; }
          A.sendKeys(A.deepActive(), { shift: shift }, def.k);
          return;
        }
        case 'Enter': return this._enter(field, shift);
        case 'Tab': return this._tab(shift ? -1 : 1);
        case 'Escape': return this._escape(field);
        case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown':
          return this._arrow(def.k.replace('Arrow', ''), shift, field);
        case 'Home': case 'End': return this._homeEnd(def.k === 'Home' ? -1 : 1, shift, field);
        case 'PageUp': case 'PageDown': {
          const dir = def.k === 'PageUp' ? -1 : 1;
          if (A.sendKeys(A.deepActive(), { shift: shift }, def.k)) return;
          const P = window.AccessiFlowPageActions;
          if (P) P.scroll(dir, { amount: 'page' });
          else A.scrollBy(null, dir * Math.round(window.innerHeight * 0.85));
          return;
        }
      }
    }

    _pressable(el) {
      return Boolean(el && el !== document.body && el.matches && el.matches(PRESSABLE));
    }

    _space(field, shift) {
      const A = this._A();
      if (field) {
        this._learnWord(field);
        A.insertText(field, ' ');
        if (field === this._search) this._renderResults();
        return;
      }
      const target = A.deepActive();
      if (A.sendKeys(target, { shift: shift }, 'Space')) return;
      if (this._pressable(target)) { target.click(); return; }
      A.scrollBy(A.scrollerAt(target), (shift ? -1 : 1) * Math.round(window.innerHeight * 0.85));
    }

    _enter(field, shift) {
      const A = this._A();
      if (field === this._search) { this._runFirst(); return; }
      this._learnWord(field);
      const target = field || A.deepActive();
      // The page hears Enter first: a chat box sends the message on it.
      if (A.sendKeys(target, { shift: shift }, 'Enter')) return;
      if (field && (field.tagName === 'TEXTAREA' || field.isContentEditable)) {
        const doc = field.ownerDocument || document;
        let done = false;
        if (field.isContentEditable) {
          try { done = doc.execCommand(shift ? 'insertLineBreak' : 'insertParagraph'); } catch (e) { done = false; }
        }
        if (!done) A.insertText(field, '\n');
        return;
      }
      if (field && field.form) {
        const form = field.form;
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
        return;
      }
      if (this._pressable(target)) target.click();
    }

    _escape(field) {
      const A = this._A();
      if (field === this._search) { this._leaveSearch(); return; }
      A.sendKeys(A.deepActive(), {}, 'Esc');
    }

    /** Tab and Shift+Tab, which a page cannot fake: moves focus itself. */
    _tab(dir) {
      const A = this._A();
      if (this._saved) this._restore();
      const list = Array.from(document.querySelectorAll(FOCUSABLE)).filter(el => {
        if (el.disabled || el.tabIndex < 0 || A.isOurs(el)) return false;
        return el.getClientRects().length > 0;
      });
      if (!list.length) { this._say('There is nothing to move to on this page.'); return; }
      const current = A.deepActive();
      let at = list.findIndex(el => el === current || el.contains(current));
      if (at === -1) at = dir > 0 ? -1 : list.length;
      const next = list[(at + dir + list.length) % list.length];
      try { next.focus(); } catch (e) { /* ok */ }
      try { next.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ok */ }
      this._updateTarget();
    }

    /** Arrow keys: the page first, then list boxes and sliders, then the caret, then scrolling. */
    _arrow(name, shift, field) {
      const A = this._A();
      const target = field || A.deepActive();
      if (field !== this._search && A.sendKeys(target, { shift: shift }, name)) return;
      const delta = name === 'Left' || name === 'Up' ? -1 : 1;
      if (this._nudge(target, delta, name)) return;
      if (field) { this._moveCaret(field, name, shift); return; }
      if (name === 'Up' || name === 'Down') A.scrollBy(A.scrollerAt(target), delta * 60);
    }

    /** What arrows do to a list box, a slider, a number or a set of radio buttons. */
    _nudge(el, delta, name) {
      if (!el || el.nodeType !== 1) return false;
      const fire = () => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (el.tagName === 'SELECT') {
        const i = clamp(el.selectedIndex + delta, 0, el.options.length - 1);
        if (i !== el.selectedIndex) { el.selectedIndex = i; fire(); }
        return true;
      }
      if (el.tagName === 'INPUT' && (type === 'range' || (type === 'number' && (name === 'Up' || name === 'Down')))) {
        try { if (delta > 0) el.stepUp(); else el.stepDown(); fire(); } catch (e) { /* no step */ }
        return true;
      }
      if (el.tagName === 'INPUT' && type === 'radio' && el.name) {
        const scope = el.form ? Array.from(el.form.elements) : Array.from(document.getElementsByName(el.name));
        const group = scope.filter(r => r.type === 'radio' && r.name === el.name && !r.disabled);
        const next = group[(group.indexOf(el) + delta + group.length) % group.length];
        if (next && next !== el) { next.focus(); next.click(); }
        return true;
      }
      return false;
    }

    _moveCaret(field, name, shift) {
      const A = this._A();
      if (field.isContentEditable) {
        const sel = (field.ownerDocument || document).getSelection();
        const back = name === 'Left' || name === 'Up';
        if (sel && sel.modify) {
          sel.modify(shift ? 'extend' : 'move', back ? 'backward' : 'forward',
            name === 'Up' || name === 'Down' ? 'line' : 'character');
        }
        return;
      }
      if (!A.hasCaret(field)) return;
      const value = String(field.value || '');
      const start = field.selectionStart;
      const end = field.selectionEnd;
      const backward = field.selectionDirection === 'backward';
      let caret = backward ? start : end;
      const anchor = backward ? end : start;

      if (!shift && start !== end && (name === 'Left' || name === 'Right')) {
        const at = name === 'Left' ? start : end;
        field.setSelectionRange(at, at);
        return;
      }
      if (name === 'Left') caret = Math.max(0, caret - 1);
      else if (name === 'Right') caret = Math.min(value.length, caret + 1);
      else if (field.tagName !== 'TEXTAREA') return;
      else {
        // Up and down by lines as typed, keeping the column where it can.
        const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
        const column = caret - lineStart;
        if (name === 'Up') {
          if (lineStart === 0) caret = 0;
          else {
            const prevStart = value.lastIndexOf('\n', lineStart - 2) + 1;
            caret = prevStart + Math.min(column, lineStart - 1 - prevStart);
          }
        } else {
          const lineEnd = value.indexOf('\n', caret);
          if (lineEnd === -1) caret = value.length;
          else {
            const nextStart = lineEnd + 1;
            const nextEnd = value.indexOf('\n', nextStart);
            caret = nextStart + Math.min(column, (nextEnd === -1 ? value.length : nextEnd) - nextStart);
          }
        }
      }
      this._select(field, shift ? anchor : caret, caret);
    }

    _select(field, anchor, caret) {
      if (anchor === caret) field.setSelectionRange(caret, caret);
      else if (caret < anchor) field.setSelectionRange(caret, anchor, 'backward');
      else field.setSelectionRange(anchor, caret, 'forward');
    }

    _homeEnd(dir, shift, field) {
      const A = this._A();
      if (field && field.isContentEditable) {
        const sel = (field.ownerDocument || document).getSelection();
        if (sel && sel.modify) sel.modify(shift ? 'extend' : 'move', dir < 0 ? 'backward' : 'forward', 'lineboundary');
        return;
      }
      if (field && A.hasCaret(field)) {
        const value = String(field.value || '');
        const backward = field.selectionDirection === 'backward';
        const caret = backward ? field.selectionStart : field.selectionEnd;
        const anchor = backward ? field.selectionEnd : field.selectionStart;
        let to;
        if (dir < 0) to = value.lastIndexOf('\n', caret - 1) + 1;
        else { const e = value.indexOf('\n', caret); to = e === -1 ? value.length : e; }
        this._select(field, shift ? anchor : to, to);
        return;
      }
      if (A.sendKeys(A.deepActive(), { shift: shift }, dir < 0 ? 'Home' : 'End')) return;
      A.run(dir < 0 ? 'top' : 'bottom').then(message => this._say(message));
    }

    // ── Repeating keys ──────────────────────────────────────────────────────

    // Backspace, Delete and the arrows repeat when held, like a real keyboard.
    _startRepeat(def) {
      this._stopRepeat(false);
      const r = { def: def, fired: false, timer: null };
      r.timer = setTimeout(() => {
        r.fired = true;
        this._press(def);
        r.timer = setInterval(() => this._press(def), 80);
      }, 550);
      this._repeat = r;
    }

    // `keep` holds on to the record until the click that follows has seen it,
    // so a held key does not also fire once more on letting go.
    _stopRepeat(keep) {
      const r = this._repeat;
      if (!r) return;
      clearTimeout(r.timer);
      clearInterval(r.timer);
      if (!keep || !r.fired) this._repeat = null;
    }

    // ── Combinations ────────────────────────────────────────────────────────

    _comboKeyName() {
      const def = this._main;
      if (!def) return '';
      return def.char || def.k;
    }

    _doIt() {
      if (!this._main) return;
      const A = this._A();
      const mods = Object.assign({}, this._mods);
      const key = this._comboKeyName();
      this._clearCombo();
      const target = this._pageTarget();
      A.runCombo(mods, key, { target: target }).then(message => this._say(message));
    }

    _clearCombo() {
      this._mods = { ctrl: false, alt: false, shift: false, win: false };
      this._main = null;
      if (this._host) this._refresh();
    }

    // ── Shortcuts panel ─────────────────────────────────────────────────────

    _togglePanel(open) {
      const show = typeof open === 'boolean' ? open : this._panel.hidden;
      if (show === !this._panel.hidden) return;
      const before = this._kb.getBoundingClientRect().height;
      this._panel.hidden = !show;
      this._shortcutsBtn.setAttribute('aria-pressed', String(show));
      if (!show) this._leaveSearch(true);
      this._renderResults();
      // Grow upwards, so the keys stay where the hand already is.
      const after = this._kb.getBoundingClientRect().height;
      if (this._geo && before && after) {
        this._geo.y -= after - before;
        this._layout();
      }
    }

    _renderResults() {
      if (!this._results) return;
      const A = this._A();
      const query = this._search.value;
      const found = A.search(query);
      const box = this._results;
      while (box.firstChild) box.removeChild(box.firstChild);
      this._armed = null;

      if (!found.length) {
        const none = document.createElement('p');
        none.className = 'none';
        none.textContent = 'Nothing matches that. Try one word, such as copy, tab or zoom.';
        box.appendChild(none);
        return;
      }
      let group = null;
      found.forEach((action, i) => {
        if (!query.trim() && action.group !== group) {
          group = action.group;
          const h = document.createElement('h3');
          h.textContent = group;
          box.appendChild(h);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'act' + (query.trim() && i === 0 ? ' first' : '');
        button.dataset.id = action.id;
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = action.label;
        const keys = document.createElement('span');
        keys.className = 'keys';
        keys.textContent = A.display(action.keys[0]);
        button.append(name, keys);
        button.setAttribute('aria-label', action.label + ', ' + A.display(action.keys[0]));
        button.addEventListener('click', () => this._choose(action, button));
        box.appendChild(button);
      });
    }

    _runFirst() {
      const first = this._results && this._results.querySelector('.act');
      if (first) first.click();
    }

    _choose(action, button) {
      if (action.confirm && this._armed !== action.id) {
        // A second press, because this one cannot be taken back.
        this._armed = action.id;
        button.classList.add('armed');
        button.firstChild.textContent = 'Click again to ' + action.label.toLowerCase();
        setTimeout(() => {
          if (this._armed !== action.id) return;
          this._armed = null;
          button.classList.remove('armed');
          button.firstChild.textContent = action.label;
        }, 4000);
        return;
      }
      this._armed = null;
      const target = this._pageTarget();
      this._A().run(action.id, { target: target }).then(message => this._say(message));
    }

    // Clicking into the search box moves focus, and with it the page's own
    // caret and selection. They are noted first and put back before
    // anything is done, so Paste lands in the box the user was typing in and
    // Copy copies what they had selected.
    _snapshot() {
      const A = this._A();
      const el = A.deepActive();
      if (!el || A.isOurs(el)) return null;
      const saved = { el: el };
      if (A.hasCaret(el)) {
        saved.start = el.selectionStart;
        saved.end = el.selectionEnd;
        saved.dir = el.selectionDirection;
      } else {
        try {
          const sel = document.getSelection();
          if (sel && sel.rangeCount) saved.range = sel.getRangeAt(0).cloneRange();
        } catch (e) { /* ok */ }
      }
      return saved;
    }

    _restore() {
      const saved = this._saved;
      this._saved = null;
      if (!saved || !saved.el || !saved.el.isConnected) return null;
      try {
        if (saved.el !== document.body && typeof saved.el.focus === 'function') saved.el.focus({ preventScroll: true });
        else if (this._search) this._search.blur();
        if (saved.start !== undefined) saved.el.setSelectionRange(saved.start, saved.end, saved.dir || 'none');
        else if (saved.range) {
          const sel = document.getSelection();
          sel.removeAllRanges();
          sel.addRange(saved.range);
        }
      } catch (e) { /* the page changed underneath */ }
      return saved.el;
    }

    /** Where an action should act: the page, never this keyboard's own search box. */
    _pageTarget() {
      const A = this._A();
      const inSearch = this._root && this._root.activeElement === this._search;
      if (inSearch || this._saved) return this._restore() || A.deepActive();
      return A.deepActive();
    }

    _leaveSearch(quiet) {
      if (!this._search) return;
      if (!quiet && this._search.value) {
        this._search.value = '';
        this._renderResults();
        return;
      }
      if (this._root && this._root.activeElement === this._search) this._restore();
    }

    // ── What the keyboard shows ─────────────────────────────────────────────

    _refresh() {
      const A = this._A();
      const m = this._mods;
      this._keyButtons.forEach(({ def, button, main, sub }) => {
        if (def.mod) {
          const on = m[def.mod];
          main.textContent = def.label;
          sub.textContent = on ? 'held' : '';
          button.classList.toggle('on', on);
          button.setAttribute('aria-pressed', String(on));
          button.setAttribute('aria-label', def.name || def.label);
        } else if (def.k === 'CapsLock') {
          main.textContent = def.label;
          sub.textContent = this._caps ? 'on' : '';
          button.classList.toggle('on', this._caps);
          button.setAttribute('aria-pressed', String(this._caps));
          button.setAttribute('aria-label', def.name);
        } else if (def.char) {
          const upper = def.letter ? (m.shift !== this._caps) : m.shift;
          main.textContent = upper ? def.shifted : def.char;
          sub.textContent = def.letter ? '' : (upper ? def.char : def.shifted);
          button.setAttribute('aria-label', upper ? def.shifted : def.char);
          button.classList.toggle('on', this._main === def);
        } else {
          main.textContent = def.label || def.k;
          sub.textContent = '';
          button.setAttribute('aria-label', def.name || def.label || def.k);
          button.classList.toggle('on', this._main === def);
        }
      });

      // The line that shows a shortcut being built.
      const c = this._combo;
      const building = this._comboMode();
      this._renderLine();
      if (!building) return;
      while (c.chips.firstChild) c.chips.removeChild(c.chips.firstChild);
      const parts = [];
      if (m.win) parts.push('Windows');
      if (m.ctrl) parts.push('Ctrl');
      if (m.alt) parts.push('Alt');
      if (m.shift) parts.push('Shift');
      const key = this._comboKeyName();
      parts.forEach((p, i) => {
        if (i) c.chips.appendChild(this._plus());
        const kbd = document.createElement('kbd');
        kbd.textContent = p;
        c.chips.appendChild(kbd);
      });
      c.chips.appendChild(this._plus());
      const last = document.createElement('kbd');
      if (key) last.textContent = A.display(A.keyName(key));
      else { last.textContent = 'a key'; last.className = 'waiting'; }
      c.chips.appendChild(last);

      if (key) {
        const said = A.explain(A.comboOf(m, key));
        c.means.textContent = said.text;
        c.means.classList.toggle('cannot', said.reach === false);
        c.doit.disabled = false;
      } else {
        c.means.textContent = 'Now choose the key to go with it, then Do it.';
        c.means.classList.remove('cannot');
        c.doit.disabled = true;
      }
    }

    _plus() {
      const plus = document.createElement('span');
      plus.className = 'plus';
      plus.setAttribute('aria-hidden', 'true');
      plus.textContent = '+';
      return plus;
    }

    /** The line above the keys: what just happened, else the shortcut being built, else a hint. */
    _renderLine() {
      if (!this._line) return;
      const building = this._comboMode();
      const said = Boolean(this._said);
      this._combo.box.hidden = !building || said;
      this._message.hidden = building && !said;
      this._message.textContent = said ? this._said : HINT;
      this._message.classList.toggle('said', said);
      this._line.classList.toggle('building', building && !said);
    }

    _say(message) {
      if (!this._status) return;
      clearTimeout(this._statusTimer);
      this._said = message || '';
      this._status.textContent = this._said;
      this._renderLine();
      if (this._said) {
        this._statusTimer = setTimeout(() => {
          this._said = '';
          this._status.textContent = '';
          this._renderLine();
        }, 4500);
      }
    }

    _updateTarget() {
      if (!this._into) return;
      const A = this._A();
      const el = A.deepActive();
      if (el === this._search) return;
      if (A.isTextField(el)) {
        const P = window.AccessiFlowPageActions;
        const name = P ? P.nameOf(el) : (el.getAttribute('aria-label') || el.name || '');
        this._into.textContent = 'typing into ' + (name ? '“' + name.slice(0, 40) + '”' : 'this box');
      } else {
        this._into.textContent = 'click a box on the page to type into it';
      }
    }

    _onFocusIn(e) {
      const A = this._A();
      const el = e.composedPath ? e.composedPath()[0] : e.target;
      if (A.isOurs(el)) return;
      this._saved = null;
      this._updateTarget();
      this._updateSuggestions();
      if (A.isTextField(el)) this._reveal(el);
    }

    _onFocusOut() {
      setTimeout(() => {
        this._updateTarget();
        this._updateSuggestions();
      }, 0);
    }

    /** Scrolls the page so the box being typed in is not hidden under the keyboard. */
    _reveal(field) {
      const A = this._A();
      try {
        const r = field.getBoundingClientRect();
        const k = this._kb.getBoundingClientRect();
        if (!k.height || !r.height) return;
        if (r.right <= k.left || r.left >= k.right) return;
        if (r.bottom <= k.top - 8 || r.top >= k.bottom + 8) return;
        const keyboardLow = k.top + k.height / 2 > window.innerHeight / 2;
        const dy = keyboardLow ? r.bottom - (k.top - 16) : r.top - (k.bottom + 16);
        A.scrollBy(A.scrollerAt(field), dy);
      } catch (e) { /* ok */ }
    }

    // ── Where it is and how big ─────────────────────────────────────────────

    _defaultGeo() {
      const w = Math.max(MIN_W, Math.min(880, window.innerWidth - 32));
      const h = clamp(Math.round(w * 0.3), 170, 270);
      return { x: Math.round((window.innerWidth - w) / 2), y: null, w: w, h: h };
    }

    _loadGeo() {
      const use = geo => {
        this._geo = Object.assign(this._defaultGeo(), geo || {});
        this._layout();
      };
      try {
        chrome.storage.local.get(STORE_KEY, items => {
          void chrome.runtime.lastError;
          use(items && items[STORE_KEY]);
        });
      } catch (e) {
        use(null);
      }
    }

    _saveGeo() {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => {
        try { chrome.storage.local.set({ [STORE_KEY]: this._geo }); } catch (e) { /* kept for this page */ }
      }, 400);
    }

    _layout() {
      const g = this._geo;
      if (!g || !this._host) return;
      g.w = clamp(g.w, MIN_W, Math.max(MIN_W, window.innerWidth - 8));
      g.h = clamp(g.h, MIN_H, Math.max(MIN_H, Math.round(window.innerHeight * 0.7)));
      this._kb.style.width = g.w + 'px';
      this._keysArea.style.height = g.h + 'px';
      const rowHeight = (g.h - 5 * 5) / LAYOUT.length;
      this._kb.style.setProperty('--key-font', clamp(Math.round(rowHeight * 0.42), 11, 30) + 'px');

      const height = this._kb.getBoundingClientRect().height || g.h + 60;
      if (g.y === null || g.y === undefined) g.y = window.innerHeight - height - 12;
      g.x = clamp(g.x, 0, Math.max(0, window.innerWidth - g.w));
      g.y = clamp(g.y, 0, Math.max(0, window.innerHeight - height));
      this._host.style.left = Math.round(g.x) + 'px';
      this._host.style.top = Math.round(g.y) + 'px';
    }

    /** A− and A+: bigger or smaller about the bottom middle, where the hand is. */
    _scale(factor) {
      const g = this._geo;
      if (!g) return;
      const before = this._kb.getBoundingClientRect();
      const bottom = g.y + (before.height || 0);
      const middle = g.x + g.w / 2;
      g.w = Math.round(g.w * factor);
      g.h = Math.round(g.h * factor);
      this._layout();
      const after = this._kb.getBoundingClientRect();
      g.x = middle - g.w / 2;
      if (after.height) g.y = bottom - after.height;
      this._layout();
      this._saveGeo();
    }

    _onResize() { this._layout(); }

    // Moving and resizing: press and drag, or click once to pick it up and
    // again to put it down, for anyone who cannot keep a button held.
    _startCarry(kind, e) {
      if (e.button !== undefined && e.button !== 0) return;
      // Not preventDefault: that would also cancel the mousedown whose
      // default the keyboard already cancels, to keep focus in the page.
      e.stopPropagation();
      if (this._carrying) { this._endCarry(); return; }
      this._carrying = {
        kind: kind, x: e.clientX, y: e.clientY, geo: Object.assign({}, this._geo),
        moved: false, picked: false
      };
      window.addEventListener('pointermove', this._onCarryMove, true);
      window.addEventListener('pointerup', this._onCarryUp, true);
      window.addEventListener('pointerdown', this._onCarryDown, true);
    }

    _onCarryMove(e) {
      const c = this._carrying;
      if (!c) return;
      const dx = e.clientX - c.x;
      const dy = e.clientY - c.y;
      if (!c.moved && Math.hypot(dx, dy) < 4) return;
      c.moved = true;
      const g = this._geo;
      if (c.kind === 'move') {
        g.x = c.geo.x + dx;
        g.y = c.geo.y + dy;
      } else {
        g.w = c.geo.w + dx;
        g.h = c.geo.h + dy;
      }
      this._layout();
    }

    _onCarryUp() {
      const c = this._carrying;
      if (!c) return;
      if (!c.moved && !c.picked) {
        c.picked = true;
        this._say(c.kind === 'move'
          ? 'Move the pointer to where the keyboard should go, then click.'
          : 'Move the pointer to resize the keyboard, then click.');
        return;
      }
      if (!c.picked) this._endCarry();
    }

    _onCarryDown(e) {
      const c = this._carrying;
      if (!c || !c.picked) return;
      // The click that puts it down belongs to the keyboard, not the page.
      e.preventDefault();
      e.stopImmediatePropagation();
      this._endCarry();
      const swallow = ev => { ev.preventDefault(); ev.stopImmediatePropagation(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, true), 600);
      this._say('');
    }

    _endCarry() {
      if (!this._carrying) return;
      this._carrying = null;
      window.removeEventListener('pointermove', this._onCarryMove, true);
      window.removeEventListener('pointerup', this._onCarryUp, true);
      window.removeEventListener('pointerdown', this._onCarryDown, true);
      this._saveGeo();
    }
  }

  if (typeof window !== 'undefined') window.AccessiFlowScreenKeyboard = AccessiFlowScreenKeyboard;
})();
