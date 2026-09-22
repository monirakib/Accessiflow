// AccessiFlow keyboard-only mode
//
// For people who cannot use a mouse, or cannot use one for long: tremor,
// arthritis, RSI, a missing or weak hand. Tab alone is not enough. On a
// typical news page the link you want is sixty presses away, and holding
// Shift+Tab to go back is a chord, which is exactly what a weak hand finds
// hardest.
//
// So every command here is a single key with no modifier:
//
//   F        put a letter label on everything you can click; type the letters
//   J / K    scroll down / up
//   N / P    next / previous heading
//   I        jump to the first text box
//   B        back a page
//   H or ?   show or hide the key guide
//   Esc      close the labels, or leave a text box so the keys work again
//
// Keys are only taken when the user is not typing, so a text box behaves as
// it always did. The guide in the corner is how anyone finds out any of this
// exists: a shortcut nobody knows about is not a feature.
'use strict';

(function () {
  // Home-row letters first: the ones the fewest finger movements reach.
  const HINT_CHARS = 'ASDFJKLGHQWERUIO';

  // Finding, clicking, scrolling and headings are shared with voice control,
  // in page-actions.js, which the manifest loads first.
  const A = () => window.AccessiFlowPageActions;
  const isEditable = el => A().isEditable(el);

  // The guide is rebuilt every time settings change, so whether it was open
  // lives out here, and in storage, rather than on the instance.
  let legendOpen = null;

  const KEYS = [
    { group: 'Moving around' },
    { keys: ['Tab'], what: 'Next item' },
    { keys: ['Shift', 'Tab'], what: 'Previous item', chord: true },
    { keys: ['J'], what: 'Scroll down' },
    { keys: ['K'], what: 'Scroll up' },
    { keys: ['N'], what: 'Next heading' },
    { keys: ['P'], what: 'Previous heading' },
    { keys: ['B'], what: 'Back a page' },
    { group: 'Clicking and typing' },
    { keys: ['F'], what: 'Label everything you can click, then type its letters' },
    { keys: ['Enter'], what: 'Open a link or press a button' },
    { keys: ['Space'], what: 'Tick a box or press a button' },
    { keys: ['I'], what: 'Jump to the first text box' },
    { keys: ['Esc'], what: 'Close the labels, or leave a text box' },
    { group: 'This guide' },
    { keys: ['H'], what: 'Show or hide this guide' }
  ];

  // The screen reader uses the same single letters, as NVDA does. While it
  // is on, its meaning wins; the fake-button Enter fix below still applies.
  function screenReaderOwnsKeys() {
    const Reader = window.AccessiFlowScreenReader;
    return !!(Reader && Reader.ownsKeys());
  }

  function log(msg) { console.log('[AccessiFlow][Keyboard] ' + msg); }
  function warn(msg) { console.warn('[AccessiFlow][Keyboard] ' + msg); }

  /**
   * Labels of one fixed length, so no label is the start of another and the
   * last letter always acts straight away, with no pause to see whether a
   * second one is coming.
   */
  function makeLabels(count) {
    const base = HINT_CHARS.length;
    let length = 1;
    while (Math.pow(base, length) < count) length++;
    const out = [];
    for (let i = 0; i < count; i++) {
      let n = i;
      let label = '';
      for (let d = 0; d < length; d++) {
        label = HINT_CHARS[n % base] + label;
        n = Math.floor(n / base);
      }
      out.push(label);
    }
    return out;
  }

  class KeyboardNav {
    constructor() {
      this._keyHandler = null;
      this._escHandler = null;
      this._armHandler = null;
      this._fireHandler = null;
      this._pending = null;         // an Enter or Space we may have to turn into a click
      this._closeHintsHandler = null;
      this._legendHost = null;
      this._legendRoot = null;
      this._statusTimer = null;
      this._hints = null;           // { host, items: [{ el, label, node }], typed }
      this.active = false;
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    enable() {
      if (this.active) return;
      this.active = true;

      this._keyHandler = e => this._onKey(e);
      // Capture on window, so a site's own single-key shortcuts (J and K on
      // many feeds) do not fire underneath ours.
      window.addEventListener('keydown', this._keyHandler, true);

      // Esc in a text box is handled late, in the bubble phase, so a page that
      // uses Esc to close its own autocomplete still gets it first.
      this._escHandler = e => {
        if (e.key !== 'Escape' || e.defaultPrevented || this._hints) return;
        if (screenReaderOwnsKeys()) return;              // there Escape means browse mode
        const target = this._target(e);
        if (!isEditable(target)) return;
        try { target.blur(); } catch (err) { /* ok */ }
        this._status('Left the text box. The single keys work again.');
      };
      window.addEventListener('keydown', this._escHandler, false);

      // Enter on a fake button. Plenty of sites build menus and tabs from an
      // <a> with no href, or a <div tabindex="0">, and only listen for mouse
      // clicks: Tab reaches them, Enter does nothing, and a keyboard user is
      // stuck. Armed in the capture phase, fired in the bubble phase, so a
      // page that does handle the key itself (by preventing the default or by
      // clicking) is seen to have done so and is not clicked twice.
      this._armHandler = e => this._armActivation(e);
      this._fireHandler = e => this._fireActivation(e);
      window.addEventListener('keydown', this._armHandler, true);
      window.addEventListener('keydown', this._fireHandler, false);

      this._buildLegend();
      log('keyboard-only mode on');
    }

    disable() {
      if (!this.active) return;
      this.active = false;
      this._closeHints();
      if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler, true);
      if (this._escHandler) window.removeEventListener('keydown', this._escHandler, false);
      this._keyHandler = null;
      this._escHandler = null;
      if (this._armHandler) window.removeEventListener('keydown', this._armHandler, true);
      if (this._fireHandler) window.removeEventListener('keydown', this._fireHandler, false);
      this._armHandler = null;
      this._fireHandler = null;
      this._clearPending();
      if (this._statusTimer) { clearTimeout(this._statusTimer); this._statusTimer = null; }
      if (this._legendHost) { this._legendHost.remove(); this._legendHost = null; this._legendRoot = null; }
      A().restoreHeadings();
    }

    // ── Keys ───────────────────────────────────────────────────────────────

    _target(e) {
      const path = e.composedPath ? e.composedPath() : null;
      return (path && path[0]) || e.target;
    }

    _onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;   // browser and AccessiFlow shortcuts
      if (screenReaderOwnsKeys()) return;               // its H, K, B, F mean something else

      if (this._hints) { this._onHintKey(e); return; }

      if (isEditable(this._target(e))) return;           // the user is typing

      const key = e.key === '?' ? 'H' : (e.key || '').toUpperCase();
      if (e.shiftKey && key !== 'H') return;             // Shift+Space, Shift+Tab stay native

      let done = true;
      switch (key) {
        case 'F': this.showHints(); break;
        case 'J': this.scroll(1, e.repeat); break;
        case 'K': this.scroll(-1, e.repeat); break;
        case 'N': this.heading(1); break;
        case 'P': this.heading(-1); break;
        case 'I': this.firstTextBox(); break;
        case 'B':
          this._status('Going back a page.');
          try { window.history.back(); } catch (err) { /* ok */ }
          break;
        case 'H': this.toggleLegend(); break;
        default: done = false;
      }

      if (done) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    // ── Enter and Space on controls that ignore them ───────────────────────

    /**
     * Whether a key on this element needs our help to act like a click.
     *
     * Native controls already do the right thing and are left alone. Enter
     * gets help on anything else the keyboard can reach: the user put the
     * keyboard there and pressed Enter, so a click is what they meant, and a
     * click on something with no click handler does nothing. Space is
     * stricter, because on a scrollable panel with tabindex="0" Space should
     * scroll, not click.
     */
    _needsClick(el, key) {
      if (!el || el.nodeType !== 1) return false;
      if (el === document.body || el === document.documentElement) return false;
      if (isEditable(el)) return false;
      const tag = el.tagName;
      if (['BUTTON', 'SUMMARY', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION'].indexOf(tag) !== -1) return false;
      if (tag === 'A' && el.hasAttribute('href')) return false;

      const role = (el.getAttribute('role') || '').toLowerCase();
      const clickRoles = ['button', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
        'option', 'switch', 'checkbox', 'radio', 'treeitem'];
      if (clickRoles.indexOf(role) !== -1) return true;
      if (role === 'link') return key === 'Enter';
      if (el.hasAttribute('onclick')) return true;

      if (key === 'Enter') return el.tabIndex >= 0;
      try { return el.tabIndex >= 0 && window.getComputedStyle(el).cursor === 'pointer'; }
      catch (e) { return false; }
    }

    _armActivation(e) {
      this._clearPending();
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return;
      if (this._hints) return;
      const target = this._target(e);
      if (!this._needsClick(target, e.key)) return;

      const pending = { target: target, event: e, clicked: false };
      pending.watch = ev => {
        const t = ev.target;
        if (t && (target === t || target.contains(t) || (t.contains && t.contains(target)))) pending.clicked = true;
      };
      document.addEventListener('click', pending.watch, true);
      this._pending = pending;
    }

    _fireActivation(e) {
      const pending = this._pending;
      if (!pending || pending.event !== e) return;
      this._clearPending();
      if (e.defaultPrevented || pending.clicked) return;   // the page dealt with it

      e.preventDefault();                                   // no page scroll on Space
      try { pending.target.click(); } catch (err) { warn('click failed: ' + err.message); }
    }

    _clearPending() {
      if (!this._pending) return;
      document.removeEventListener('click', this._pending.watch, true);
      this._pending = null;
    }

    // ── Scrolling, headings, text boxes ────────────────────────────────────

    scroll(direction, held) {
      A().scroll(direction, { instant: held });
    }

    heading(direction) {
      this._status(A().heading(direction));
    }

    firstTextBox() {
      const result = A().firstTextBox();
      this._status(result.found ? result.message + ' Press Esc to leave it.' : result.message);
    }

    // ── Letter labels ──────────────────────────────────────────────────────

    showHints() {
      this._closeHints();
      const targets = A().clickables();
      if (!targets.length) { this._status('Nothing on screen can be clicked. Try scrolling with J.'); return; }

      const labels = makeLabels(targets.length);
      const drawn = A().drawLabels('accessiflow-kbnav-hints', targets, labels);
      this._hints = { host: drawn.host, items: drawn.items, typed: '' };

      // Labels are painted where things were; once the page moves they point
      // at the wrong things, so they go.
      this._closeHintsHandler = () => {
        this._closeHints();
      };
      window.addEventListener('scroll', this._closeHintsHandler, { capture: true, passive: true });
      window.addEventListener('resize', this._closeHintsHandler, { passive: true });
      window.addEventListener('mousedown', this._closeHintsHandler, true);

      const length = labels[0].length;
      this._status(targets.length + ' things labelled. Type ' + (length === 1 ? 'a letter' : 'the ' + length + ' letters') +
        ' to choose one, or Esc to close.');
    }

    _onHintKey(e) {
      const hints = this._hints;
      const key = (e.key || '').toUpperCase();

      if (key === 'ESCAPE') {
        this._closeHints();
        this._status('Labels closed.');
      } else if (key === 'BACKSPACE') {
        hints.typed = hints.typed.slice(0, -1);
        this._filterHints();
      } else if (key.length === 1 && HINT_CHARS.indexOf(key) !== -1 && !e.shiftKey) {
        const typed = hints.typed + key;
        const matches = hints.items.filter(item => item.label.indexOf(typed) === 0);
        if (!matches.length) {
          this._status('No label starts with ' + typed.split('').join(' ') + '. Keep typing, or Esc to close.');
        } else if (matches.length === 1 && matches[0].label === typed) {
          this._closeHints();
          this._activate(matches[0].el);
        } else {
          hints.typed = typed;
          this._filterHints();
        }
      } else {
        // Any other key means the user has moved on: Tab, an arrow, Enter.
        // Close the labels and let the key do what it normally does.
        this._closeHints();
        return;
      }

      e.preventDefault();
      e.stopPropagation();
    }

    _filterHints() {
      const typed = this._hints.typed;
      this._hints.items.forEach(item => {
        const match = item.label.indexOf(typed) === 0;
        item.node.hidden = !match;
        if (!match) return;
        item.node.textContent = '';
        if (typed) {
          const done = document.createElement('span');
          done.className = 'typed';
          done.textContent = typed;
          item.node.appendChild(done);
        }
        item.node.appendChild(document.createTextNode(item.label.slice(typed.length)));
      });
    }

    _closeHints() {
      if (this._closeHintsHandler) {
        window.removeEventListener('scroll', this._closeHintsHandler, { capture: true });
        window.removeEventListener('resize', this._closeHintsHandler);
        window.removeEventListener('mousedown', this._closeHintsHandler, true);
        this._closeHintsHandler = null;
      }
      if (this._hints) {
        this._hints.host.remove();
        this._hints = null;
      }
    }

    _activate(el) {
      const result = A().activate(el);
      this._status(result.typing ? result.message + ' Press Esc to leave it.' : result.message);
    }

    // ── The key guide ──────────────────────────────────────────────────────

    _buildLegend() {
      if (this._legendHost) return;

      const host = document.createElement('div');
      host.id = 'accessiflow-kbnav-legend';
      host.style.cssText = 'all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483645;';
      const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

      const style = document.createElement('style');
      style.textContent = [
        ':host { all: initial; }',
        '.wrap { font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #f4f5f7; ',
        '  display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }',
        '.panel { background: #16181d; border: 2px solid #4fffb0; border-radius: 10px; padding: 12px 14px; ',
        '  width: 300px; max-width: calc(100vw - 32px); max-height: calc(100vh - 100px); overflow: auto; ',
        '  box-shadow: 0 8px 28px rgba(0,0,0,.5); }',
        '.panel[hidden] { display: none; }',
        '.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 6px; }',
        'h2 { font-size: 15px; font-weight: 700; margin: 0; color: #4fffb0; }',
        'h3 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; ',
        '  color: #a9b0bd; margin: 10px 0 4px; }',
        // A fixed key column, so every group lines up with the others.
        'dl { margin: 0; display: grid; grid-template-columns: 6.5em 1fr; gap: 5px 10px; align-items: baseline; }',
        'dt { white-space: nowrap; margin: 0; }',
        'dd { margin: 0; }',
        'kbd { display: inline-block; min-width: 1.4em; text-align: center; font: 700 12px/1.5 ui-monospace, Consolas, monospace; ',
        '  padding: 0 5px; border-radius: 4px; background: #2a2e37; border: 1px solid #555c69; border-bottom-width: 3px; color: #fff; }',
        '.plus { color: #a9b0bd; padding: 0 2px; }',
        '.note { margin: 10px 0 0; font-size: 12px; color: #a9b0bd; }',
        'button { font: 600 13px/1 system-ui, sans-serif; cursor: pointer; border-radius: 8px; }',
        '.pill { background: #16181d; color: #f4f5f7; border: 2px solid #4fffb0; padding: 9px 12px; ',
        '  box-shadow: 0 4px 14px rgba(0,0,0,.45); }',
        '.close { background: transparent; color: #f4f5f7; border: 1px solid #555c69; padding: 6px 9px; }',
        'button:focus-visible { outline: 3px solid #ffd400; outline-offset: 2px; }',
        '.status { background: #ffd400; color: #111; font-weight: 600; padding: 7px 11px; border-radius: 8px; ',
        '  max-width: 300px; box-shadow: 0 4px 14px rgba(0,0,0,.45); }',
        '.status:empty { display: none; }'
      ].join('\n');
      root.appendChild(style);

      const wrap = document.createElement('div');
      wrap.className = 'wrap';

      const status = document.createElement('div');
      status.className = 'status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');

      const panel = document.createElement('section');
      panel.className = 'panel';
      panel.id = 'panel';
      panel.setAttribute('aria-labelledby', 'kb-title');

      const head = document.createElement('div');
      head.className = 'head';
      const title = document.createElement('h2');
      title.id = 'kb-title';
      title.textContent = 'Keyboard-only mode';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'close';
      close.textContent = 'Hide (H)';
      close.addEventListener('click', () => this.toggleLegend(false));
      head.append(title, close);
      panel.appendChild(head);

      let list = null;
      KEYS.forEach(row => {
        if (row.group) {
          const h = document.createElement('h3');
          h.textContent = row.group;
          panel.appendChild(h);
          list = document.createElement('dl');
          panel.appendChild(list);
          return;
        }
        const dt = document.createElement('dt');
        row.keys.forEach((k, i) => {
          if (i) {
            const plus = document.createElement('span');
            plus.className = 'plus';
            plus.textContent = row.chord ? '+' : '/';
            dt.appendChild(plus);
          }
          const kbd = document.createElement('kbd');
          kbd.textContent = k;
          dt.appendChild(kbd);
        });
        const dd = document.createElement('dd');
        dd.textContent = row.what;
        list.append(dt, dd);
      });

      const note = document.createElement('p');
      note.className = 'note';
      note.textContent = 'The single keys work whenever you are not typing. Alt+Shift+E turns this mode off.';
      panel.appendChild(note);

      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'pill';
      pill.textContent = 'Keyboard keys (H)';
      pill.setAttribute('aria-controls', 'panel');
      pill.addEventListener('click', () => this.toggleLegend(true));

      wrap.append(status, panel, pill);
      root.appendChild(wrap);
      document.documentElement.appendChild(host);

      this._legendHost = host;
      this._legendRoot = root;
      this._legend = { panel: panel, pill: pill, status: status };

      if (legendOpen === null) {
        // First time on this page load: remember the user's last choice across
        // sites, and open it the very first time so the keys can be found.
        this._paintLegend(true);
        try {
          chrome.storage.local.get('accessiflowKbLegendOpen', data => {
            void chrome.runtime.lastError;
            if (data && typeof data.accessiflowKbLegendOpen === 'boolean') {
              legendOpen = data.accessiflowKbLegendOpen;
              this._paintLegend(legendOpen);
            }
          });
        } catch (e) { /* not in an extension: stay open */ }
      } else {
        this._paintLegend(legendOpen);
      }
    }

    _paintLegend(open) {
      if (!this._legend) return;
      this._legend.panel.hidden = !open;
      this._legend.pill.hidden = open;
      this._legend.pill.setAttribute('aria-expanded', String(open));
    }

    toggleLegend(force) {
      if (!this._legend) return;
      const open = typeof force === 'boolean' ? force : this._legend.panel.hidden;
      legendOpen = open;
      this._paintLegend(open);
      try { chrome.storage.local.set({ accessiflowKbLegendOpen: open }); } catch (e) { /* ok */ }
      this._status(open ? 'Key guide shown.' : 'Key guide hidden. Press H to bring it back.');
    }

    /** One short line, shown in the corner and read out by a screen reader. */
    _status(message) {
      if (!this._legend) return;
      const status = this._legend.status;
      status.textContent = message;
      if (this._statusTimer) clearTimeout(this._statusTimer);
      this._statusTimer = setTimeout(() => {
        status.textContent = '';
        this._statusTimer = null;
      }, 3500);
    }
  }

  KeyboardNav.makeLabels = makeLabels;
  KeyboardNav.isEditable = isEditable;

  if (typeof window !== 'undefined') window.AccessiFlowKeyboardNav = KeyboardNav;
})();
