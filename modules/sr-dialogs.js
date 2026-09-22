// AccessiFlow screen reader: the Elements List and Find
//
// The Elements List (Insert+F7) is how many blind users actually get around a
// page: every heading, link, landmark, field or button in one list, filtered
// by typing, and Enter to go there. Reading a news site line by line to find
// "Sport" takes minutes; typing "spo" in the list takes a second.
//
// Find (Insert+Control+F) searches the page's text from the reading cursor.
//
// Both are real dialogs on the page, drawn for anyone sighted who is helping.
// The reader ignores focus inside AccessiFlow's own furniture (it would read
// its own list back twice), so these speak for themselves, through the same
// voice, as the user moves around in them.
'use strict';

(function (root) {
  const KINDS = [
    { id: 'heading', label: 'Headings' },
    { id: 'link', label: 'Links' },
    { id: 'landmark', label: 'Landmarks' },
    { id: 'field', label: 'Form fields' },
    { id: 'button', label: 'Buttons' }
  ];

  const STYLE = [
    ':host { all: initial; }',
    '.box { font: 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #f4f5f7; background: #16181d; ',
    '  border: 2px solid #ffd400; border-radius: 12px; padding: 16px 18px; width: min(460px, calc(100vw - 32px)); ',
    '  max-height: calc(100vh - 48px); display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; ',
    '  box-shadow: 0 10px 36px rgba(0,0,0,.6); }',
    'h2 { font-size: 17px; margin: 0; color: #ffd400; }',
    'fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 6px 12px; }',
    'legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }',
    'label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }',
    '.filter { display: flex; flex-direction: column; gap: 4px; }',
    'input[type="text"] { font: inherit; color: #111; background: #fff; border: 2px solid #555c69; border-radius: 6px; padding: 6px 8px; }',
    'ul { list-style: none; margin: 0; padding: 4px; overflow: auto; min-height: 120px; max-height: 45vh; ',
    '  border: 1px solid #555c69; border-radius: 8px; }',
    'li { padding: 5px 8px; border-radius: 5px; cursor: pointer; }',
    'li[aria-selected="true"] { background: #ffd400; color: #111; }',
    '.level { display: inline-block; min-width: 1.6em; font-weight: 700; opacity: .75; }',
    '.empty { padding: 8px; color: #a9b0bd; }',
    '.buttons { display: flex; gap: 8px; justify-content: flex-end; }',
    'button { font: 600 14px/1 system-ui, sans-serif; padding: 8px 12px; border-radius: 8px; cursor: pointer; ',
    '  background: #2a2e37; color: #fff; border: 1px solid #555c69; }',
    'button.primary { background: #ffd400; color: #111; border-color: #ffd400; }',
    ':focus-visible { outline: 3px solid #4fffb0; outline-offset: 2px; }'
  ].join('\n');

  function el(tag, attrs, text) {
    const n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(k => n.setAttribute(k, attrs[k]));
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /** A modal box of our own, in a shadow root the page's styles cannot reach. */
  function makeHost(id, label) {
    const host = document.createElement('div');
    host.id = id;
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483646; display: grid; ' +
      'place-items: center; background: rgba(0,0,0,.45);';
    const shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    // Letters typed into the filter are not the page's business: without
    // this, a site's own single-key shortcuts go off as the user types.
    ['keydown', 'keyup', 'keypress'].forEach(type => host.addEventListener(type, e => e.stopPropagation()));
    shadow.appendChild(el('style', {}, STYLE));
    const box = el('div', { class: 'box', role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
    shadow.appendChild(box);
    return { host: host, shadow: shadow, box: box };
  }

  /** Keeps Tab inside the box. */
  function trapTab(shadow, box, e) {
    if (e.key !== 'Tab') return;
    const stops = Array.prototype.filter.call(
      box.querySelectorAll('input, button, [tabindex="0"]'),
      n => !n.disabled && !(n.type === 'radio' && !n.checked));
    if (!stops.length) return;
    const i = stops.indexOf(shadow.activeElement);
    const next = e.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : (i === -1 || i === stops.length - 1 ? 0 : i + 1);
    e.preventDefault();
    stops[next].focus();
  }

  // ── The Elements List ────────────────────────────────────────────────────

  class ElementsList {
    /**
     * @param opts.items   kind → [{ label, spoken, line }] in page order
     * @param opts.say     text → void
     * @param opts.choose  (entry, activate) → void, after the list has closed
     * @param opts.close   () → void, when closed without choosing
     */
    constructor(opts) {
      this._opts = opts;
      this._kind = opts.kind || 'heading';
      this._all = [];
      this._shown = [];
      this._index = 0;
      this._filterTimer = null;
    }

    open() {
      const ui = makeHost('accessiflow-sr-elements', 'Elements list');
      this._ui = ui;
      const box = ui.box;

      box.appendChild(el('h2', {}, 'Elements list'));

      const types = el('fieldset');
      types.appendChild(el('legend', {}, 'Type of element'));
      KINDS.forEach(k => {
        const label = el('label');
        const radio = el('input', { type: 'radio', name: 'kind', value: k.id });
        radio.checked = k.id === this._kind;
        radio.addEventListener('change', () => { if (radio.checked) this._setKind(k.id, true); });
        radio.addEventListener('focus', () => this._say(k.label + ', radio button, ' + this._count(k.id)));
        label.append(radio, document.createTextNode(k.label));
        types.appendChild(label);
      });
      box.appendChild(types);

      const filterWrap = el('label', { class: 'filter' });
      filterWrap.appendChild(document.createTextNode('Filter'));
      const filter = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false' });
      filterWrap.appendChild(filter);
      box.appendChild(filterWrap);
      filter.addEventListener('focus', () => this._say('Filter, edit, ' + (filter.value || 'blank')));
      filter.addEventListener('input', () => {
        this._applyFilter();
        clearTimeout(this._filterTimer);
        this._filterTimer = setTimeout(() => this._say(this._countShown()), 350);
      });
      filter.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
          e.preventDefault();
          if (e.key === 'Enter' && this._shown.length) { this._choose(e.shiftKey); return; }
          this._list.focus();
        }
      });

      const list = el('ul', { role: 'listbox', tabindex: '0', 'aria-label': 'Elements' });
      list.addEventListener('focus', () => this._sayCurrent());
      list.addEventListener('keydown', e => this._onListKey(e));
      list.addEventListener('click', e => {
        const li = e.target.closest && e.target.closest('li[data-i]');
        if (li) { this._select(Number(li.getAttribute('data-i')), false); }
      });
      list.addEventListener('dblclick', () => this._choose(false));
      box.appendChild(list);

      const buttons = el('div', { class: 'buttons' });
      const move = el('button', { type: 'button', class: 'primary' }, 'Move to');
      const act = el('button', { type: 'button' }, 'Activate');
      const close = el('button', { type: 'button' }, 'Close');
      move.addEventListener('click', () => this._choose(false));
      act.addEventListener('click', () => this._choose(true));
      close.addEventListener('click', () => this.close(true));
      [move, act, close].forEach(b => b.addEventListener('focus', () => this._say(b.textContent + ', button')));
      buttons.append(move, act, close);
      box.appendChild(buttons);

      box.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(true); return; }
        trapTab(ui.shadow, box, e);
      });

      this._filter = filter;
      this._list = list;
      document.documentElement.appendChild(ui.host);

      this._setKind(this._kind, false);
      this._opening = true;
      list.focus();
      this._opening = false;
      this._say('Elements list. ' + this._label(this._kind) + ', ' + this._countShown() + '. ' + this._currentText(true));
    }

    get isOpen() { return !!this._ui; }

    close(cancelled) {
      if (!this._ui) return;
      clearTimeout(this._filterTimer);
      this._ui.host.remove();
      this._ui = null;
      if (cancelled && this._opts.close) this._opts.close();
    }

    _say(text) { if (!this._opening && this._opts.say) this._opts.say(text); }

    _label(kind) { return KINDS.find(k => k.id === kind).label; }

    _count(kind) {
      const n = this._opts.items(kind).length;
      return n + (n === 1 ? ' item' : ' items');
    }

    _countShown() {
      const n = this._shown.length;
      return n ? n + (n === 1 ? ' item' : ' items') : 'nothing matches';
    }

    _setKind(kind, spoken) {
      this._kind = kind;
      this._all = this._opts.items(kind);
      this._applyFilter();
      if (spoken) this._say(this._label(kind) + ', ' + this._countShown());
    }

    _applyFilter() {
      const words = (this._filter.value || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
      this._shown = this._all.filter(it => words.every(w => it.label.toLowerCase().indexOf(w) !== -1));
      this._index = 0;
      this._render();
    }

    _render() {
      const list = this._list;
      list.textContent = '';
      if (!this._shown.length) {
        list.appendChild(el('li', { class: 'empty', role: 'presentation' }, 'Nothing matches.'));
        list.removeAttribute('aria-activedescendant');
        return;
      }
      this._shown.forEach((it, i) => {
        const li = el('li', { role: 'option', id: 'opt-' + i, 'data-i': String(i), 'aria-selected': String(i === this._index) });
        if (it.level) li.appendChild(el('span', { class: 'level', 'aria-hidden': 'true' }, String(it.level)));
        li.appendChild(document.createTextNode(it.label));
        list.appendChild(li);
      });
      list.setAttribute('aria-activedescendant', 'opt-' + this._index);
    }

    _select(i, spoken) {
      if (!this._shown.length) return;
      this._index = Math.max(0, Math.min(this._shown.length - 1, i));
      Array.prototype.forEach.call(this._list.querySelectorAll('li[role="option"]'), (li, n) => {
        li.setAttribute('aria-selected', String(n === this._index));
        if (n === this._index && li.scrollIntoView) { try { li.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ok */ } }
      });
      this._list.setAttribute('aria-activedescendant', 'opt-' + this._index);
      if (spoken) this._sayCurrent();
    }

    _currentText(withPosition) {
      const it = this._shown[this._index];
      if (!it) return 'Nothing matches.';
      return it.spoken + (withPosition ? ', ' + (this._index + 1) + ' of ' + this._shown.length : '');
    }

    _sayCurrent() { this._say(this._currentText(true)); }

    _onListKey(e) {
      const page = 10;
      let handled = true;
      switch (e.key) {
        case 'ArrowDown': this._select(this._index + 1, true); break;
        case 'ArrowUp': this._select(this._index - 1, true); break;
        case 'Home': this._select(0, true); break;
        case 'End': this._select(this._shown.length - 1, true); break;
        case 'PageDown': this._select(this._index + page, true); break;
        case 'PageUp': this._select(this._index - page, true); break;
        case 'Enter': this._choose(e.shiftKey); break;
        case ' ': this._choose(false); break;
        default:
          // Typing in the list filters it, as the user plainly means to.
          if (e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            this._filter.focus();
            this._filter.value += e.key;
            this._filter.dispatchEvent(new Event('input'));
          } else handled = false;
      }
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    }

    _choose(activate) {
      const it = this._shown[this._index];
      if (!it) { this._say('Nothing to choose'); return; }
      this.close(false);
      this._opts.choose(it, !!activate);
    }
  }

  // ── Find ─────────────────────────────────────────────────────────────────

  class FindBox {
    /**
     * @param opts.last  the previous search, offered again
     * @param opts.say   text → void
     * @param opts.find  text → void
     * @param opts.close () → void, when closed without searching
     */
    constructor(opts) { this._opts = opts; }

    open() {
      const ui = makeHost('accessiflow-sr-find', 'Find');
      this._ui = ui;
      ui.box.appendChild(el('h2', {}, 'Find'));
      const label = el('label', { class: 'filter' });
      label.appendChild(document.createTextNode('Type the text to find'));
      const input = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false' });
      input.value = this._opts.last || '';
      label.appendChild(input);
      ui.box.appendChild(label);
      const buttons = el('div', { class: 'buttons' });
      const go = el('button', { type: 'button', class: 'primary' }, 'Find');
      const close = el('button', { type: 'button' }, 'Close');
      buttons.append(go, close);
      ui.box.appendChild(buttons);

      const submit = () => {
        const text = input.value.trim();
        if (!text) { this._opts.say('Type something to find first'); return; }
        this.close(false);
        this._opts.find(text);
      };
      go.addEventListener('click', submit);
      close.addEventListener('click', () => this.close(true));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
      ui.box.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(true); return; }
        trapTab(ui.shadow, ui.box, e);
      });

      document.documentElement.appendChild(ui.host);
      input.focus();
      if (input.select) input.select();
      this._opts.say('Find, edit, ' + (input.value ? input.value + ', selected' : 'blank') +
        '. Type what to look for and press Enter.');
    }

    get isOpen() { return !!this._ui; }

    close(cancelled) {
      if (!this._ui) return;
      this._ui.host.remove();
      this._ui = null;
      if (cancelled && this._opts.close) this._opts.close();
    }
  }

  root.AccessiFlowSRDialogs = { ElementsList, FindBox, KINDS };
})(typeof window !== 'undefined' ? window : globalThis);
