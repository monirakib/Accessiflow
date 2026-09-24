// AccessiFlow hand actions
//
// What a keyboard shortcut does, without the shortcut. The hold-click menu
// and the on-screen keyboard both run these, so "Copy" means the same thing
// whether it was chosen from the ring, pressed as Ctrl and then C on the
// on-screen keyboard, or found by typing "copy this" into its search.
//
// A web page cannot press keys for the computer. A key event made in script
// is marked as made in script: Chrome ignores it for its own shortcuts
// (Ctrl+T, Ctrl+W), and Windows never sees it at all (Win+Shift+S). So each
// action here does the thing itself: a new tab through the extension's tab
// API, a copy through the browser's editing commands, a screenshot through
// the capture API. A combination with no action here is sent to the page as
// key events, which is what a site's own shortcuts listen for, and so do
// AccessiFlow's Alt+Shift keys.
'use strict';

(function () {
  if (typeof window !== 'undefined' && window.AccessiFlowHandActions) return;

  // ── The catalogue ────────────────────────────────────────────────────────
  //
  //   keys       the combinations that mean this action, as written on screen
  //   words      what people call it when they do not know the keys. Search
  //              only; never shown
  //   pageFirst  the page gets the keys first, as it would from a real
  //              keyboard: a web app with its own undo or print handles them
  //              itself, and the browser's version runs only if it did not
  //   confirm    asks for a second press when chosen from a list, because a
  //              slip there cannot be taken back
  const ACTIONS = [
    { id: 'copy', group: 'Editing', label: 'Copy', keys: ['Ctrl+C'], pageFirst: true,
      words: 'copy duplicate clipboard কপি' },
    { id: 'cut', group: 'Editing', label: 'Cut', keys: ['Ctrl+X'], pageFirst: true,
      words: 'cut move remove clipboard কাট' },
    { id: 'paste', group: 'Editing', label: 'Paste', keys: ['Ctrl+V'], pageFirst: true,
      words: 'paste insert put clipboard পেস্ট' },
    { id: 'selectAll', group: 'Editing', label: 'Select all', keys: ['Ctrl+A'], pageFirst: true,
      words: 'select all everything whole highlight' },
    { id: 'undo', group: 'Editing', label: 'Undo', keys: ['Ctrl+Z'], pageFirst: true,
      words: 'undo mistake oops revert আনডু' },
    { id: 'redo', group: 'Editing', label: 'Redo', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], pageFirst: true,
      words: 'redo again repeat' },

    { id: 'back', group: 'This page', label: 'Back', keys: ['Alt+Left'],
      words: 'back previous page return last পেছনে' },
    { id: 'forward', group: 'This page', label: 'Forward', keys: ['Alt+Right'],
      words: 'forward next page' },
    { id: 'reload', group: 'This page', label: 'Reload', keys: ['Ctrl+R', 'F5'],
      words: 'reload refresh again broken stuck রিলোড' },
    { id: 'top', group: 'This page', label: 'Top of the page', keys: ['Ctrl+Home'],
      words: 'top start beginning up scroll' },
    { id: 'bottom', group: 'This page', label: 'Bottom of the page', keys: ['Ctrl+End'],
      words: 'bottom end down scroll' },
    { id: 'print', group: 'This page', label: 'Print', keys: ['Ctrl+P'], pageFirst: true,
      words: 'print printer paper pdf প্রিন্ট' },
    { id: 'screenshot', group: 'This page', label: 'Screenshot of this page', keys: ['Win+Shift+S', 'PrintScreen'],
      words: 'screenshot screen shot capture picture photo image snip snipping grab স্ক্রিনশট' },

    { id: 'newTab', group: 'Tabs and windows', label: 'New tab', keys: ['Ctrl+T'],
      words: 'new tab open blank নতুন ট্যাব' },
    { id: 'closeTab', group: 'Tabs and windows', label: 'Close this tab', keys: ['Ctrl+W', 'Ctrl+F4'], confirm: true,
      words: 'close tab shut exit quit বন্ধ ট্যাব' },
    { id: 'nextTab', group: 'Tabs and windows', label: 'Next tab', keys: ['Ctrl+Tab', 'Ctrl+PageDown'],
      words: 'next tab switch change right ট্যাব' },
    { id: 'prevTab', group: 'Tabs and windows', label: 'Previous tab', keys: ['Ctrl+Shift+Tab', 'Ctrl+PageUp'],
      words: 'previous tab switch change left last ট্যাব' },
    { id: 'newWindow', group: 'Tabs and windows', label: 'New window', keys: ['Ctrl+N'],
      words: 'new window open' },
    { id: 'history', group: 'Tabs and windows', label: 'History', keys: ['Ctrl+H'],
      words: 'history visited earlier before closed reopen' },
    { id: 'downloads', group: 'Tabs and windows', label: 'Downloads', keys: ['Ctrl+J'],
      words: 'downloads downloaded files saved' },

    { id: 'zoomIn', group: 'Size', label: 'Zoom in', keys: ['Ctrl+=', 'Ctrl+Shift+='],
      words: 'zoom in bigger larger enlarge magnify grow বড়' },
    { id: 'zoomOut', group: 'Size', label: 'Zoom out', keys: ['Ctrl+-'],
      words: 'zoom out smaller shrink reduce ছোট' },
    { id: 'zoomReset', group: 'Size', label: 'Normal size', keys: ['Ctrl+0'],
      words: 'zoom reset normal actual default size' }
  ];

  // Combinations people reach for that no web page can perform. Said plainly
  // rather than sent into the void, with the nearest thing that does work.
  const OUT_OF_REACH = {
    'Alt+Tab': 'Switching programs belongs to Windows, which a web page cannot reach. Next tab switches between tabs.',
    'Alt+F4': 'Closing the whole window is left to you. Close this tab closes one tab.',
    'Ctrl+Shift+T': 'Reopening a closed tab needs a permission AccessiFlow does not ask for. History lists what you closed.',
    'Ctrl+L': 'A web page cannot reach the address bar.',
    'Ctrl+F': 'A web page cannot open Chrome’s find bar.',
    'Ctrl+D': 'Bookmarks need a permission AccessiFlow does not ask for.'
  };
  const WINDOWS_KEYS = 'Windows key shortcuts belong to Windows itself, which a web page cannot reach.';

  // ── Key names ────────────────────────────────────────────────────────────

  const MOD_ORDER = ['Win', 'Ctrl', 'Alt', 'Shift'];
  const MOD_ALIASES = {
    win: 'Win', windows: 'Win', meta: 'Win', cmd: 'Win', super: 'Win',
    ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift'
  };
  // KeyboardEvent.key values, and what people write, to one spelling each.
  const KEY_ALIASES = {
    arrowleft: 'Left', left: 'Left', arrowright: 'Right', right: 'Right',
    arrowup: 'Up', up: 'Up', arrowdown: 'Down', down: 'Down',
    escape: 'Esc', esc: 'Esc', ' ': 'Space', space: 'Space', spacebar: 'Space',
    enter: 'Enter', return: 'Enter', tab: 'Tab', backspace: 'Backspace',
    delete: 'Delete', del: 'Delete', home: 'Home', end: 'End',
    pageup: 'PageUp', pgup: 'PageUp', pagedown: 'PageDown', pgdn: 'PageDown',
    printscreen: 'PrintScreen', prtsc: 'PrintScreen', plus: '=', minus: '-'
  };

  function keyName(key) {
    const raw = String(key == null ? '' : key);
    if (raw === ' ') return 'Space';
    const lower = raw.toLowerCase();
    if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
    if (/^f\d{1,2}$/.test(lower)) return lower.toUpperCase();
    return raw.length === 1 ? raw.toUpperCase() : raw;
  }

  /** "shift+win+s", "Win + Shift + S" and "win shift s" all become "Win+Shift+S". */
  function normalise(combo) {
    const parts = String(combo || '').split(/\s*\+\s*|\s+/).filter(Boolean);
    const mods = new Set();
    let main = '';
    parts.forEach(part => {
      const mod = MOD_ALIASES[part.toLowerCase()];
      if (mod) mods.add(mod);
      else main = keyName(part);
    });
    return MOD_ORDER.filter(m => mods.has(m)).concat(main ? [main] : []).join('+');
  }

  /** Joins held modifiers and a key: ({ ctrl: true }, 'c') gives "Ctrl+C". */
  function comboOf(mods, key) {
    const m = mods || {};
    const parts = [];
    if (m.win) parts.push('Win');
    if (m.ctrl) parts.push('Ctrl');
    if (m.alt) parts.push('Alt');
    if (m.shift) parts.push('Shift');
    if (key) parts.push(keyName(key));
    return parts.join('+');
  }

  const SPOKEN_KEYS = { Left: 'Left arrow', Right: 'Right arrow', Up: 'Up arrow', Down: 'Down arrow',
    PageUp: 'Page Up', PageDown: 'Page Down', PrintScreen: 'Print Screen', Win: 'Windows' };

  /** How a combination is written for people: "Ctrl + Shift + Tab". */
  function display(combo) {
    return normalise(combo).split('+').map(k => SPOKEN_KEYS[k] || k).join(' + ');
  }

  const BY_COMBO = new Map();
  ACTIONS.forEach(action => action.keys.forEach(k => BY_COMBO.set(normalise(k), action)));

  function forCombo(combo) { return BY_COMBO.get(normalise(combo)) || null; }
  function byId(id) { return ACTIONS.find(a => a.id === id) || null; }

  /**
   * What pressing this combination will do, for the on-screen keyboard to
   * show before the user commits to it.
   */
  function explain(combo) {
    const name = normalise(combo);
    const action = forCombo(name);
    if (action) return { action: action, text: action.label };
    if (OUT_OF_REACH[name]) return { action: null, reach: false, text: OUT_OF_REACH[name] };
    if (/^Win\+/.test(name)) return { action: null, reach: false, text: WINDOWS_KEYS };
    return { action: null, text: 'Sends ' + display(name) + ' to the page.' };
  }

  // ── Search: "what do you want to do?" ────────────────────────────────────
  //
  // Local and instant. Nothing typed here leaves the computer, which is the
  // point: the question is asked on every kind of page, including ones about
  // someone's health or money.

  const STOP_WORDS = new Set(('a an the to i im want wanna would like please can could you me my ' +
    'this that it of on in for and do make go get let how need some take').split(' '));

  function tokens(text) {
    return String(text || '').toLowerCase()
      .split(/[^a-z0-9ঀ-৿]+/)
      .filter(t => t.length > 1 && !STOP_WORDS.has(t));
  }

  const VOCABULARY = new Map();
  ACTIONS.forEach(action => {
    VOCABULARY.set(action.id, tokens(action.label + ' ' + action.words));
  });

  /** Written as keys: "ctrl c", "ctrl+shift+s", "win shift s". */
  function looksLikeCombo(text) {
    const parts = String(text || '').trim().split(/\s*\+\s*|\s+/).filter(Boolean);
    if (parts.length < 2) return false;
    return parts.slice(0, -1).every(p => MOD_ALIASES[p.toLowerCase()]);
  }

  /** Actions matching what the user typed, best first. Empty text lists everything. */
  function search(text) {
    const query = String(text || '').trim();
    if (!query) return ACTIONS.slice();
    if (looksLikeCombo(query)) {
      const action = forCombo(query);
      if (action) return [action];
    }
    const wanted = tokens(query);
    if (!wanted.length) return [];
    return ACTIONS
      .map((action, order) => {
        const vocabulary = VOCABULARY.get(action.id);
        let score = 0;
        wanted.forEach(t => {
          if (vocabulary.indexOf(t) !== -1) score += 2;
          // Typed so far: "scree" is on its way to "screenshot".
          else if (t.length >= 3 && vocabulary.some(w => w.indexOf(t) === 0)) score += 1;
        });
        return { action: action, score: score, order: order };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .map(r => r.action);
  }

  // ── Where keys and edits go ──────────────────────────────────────────────

  const TEXT_TYPES = ['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number'];

  /** AccessiFlow's own furniture, including what sits inside its shadow roots. */
  function isOurs(el) {
    for (let n = el; n; n = composedParent(n)) {
      if (n.id && n.id.indexOf('accessiflow-') === 0) return true;
    }
    return false;
  }

  function composedParent(el) {
    if (!el) return null;
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode ? el.getRootNode() : null;
    return root && root.host ? root.host : null;
  }

  /**
   * The element that really has focus: inside a web component's shadow root,
   * or a frame from the same site, not the host or the frame itself.
   */
  function deepActive(doc) {
    let el = (doc || document).activeElement;
    for (let i = 0; el && i < 12; i++) {
      if (el.shadowRoot && el.shadowRoot.activeElement) { el = el.shadowRoot.activeElement; continue; }
      if (el.tagName === 'IFRAME') {
        let inner = null;
        try { inner = el.contentDocument && el.contentDocument.activeElement; } catch (e) { inner = null; }
        if (inner && inner !== el.contentDocument.body) { el = inner; continue; }
      }
      break;
    }
    return el;
  }

  /** A box that takes typed text, and is not read-only. */
  function isTextField(el) {
    if (!el || el.nodeType !== 1 || el.disabled || el.readOnly) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    return TEXT_TYPES.indexOf((el.getAttribute('type') || '').toLowerCase()) !== -1;
  }

  // What a date box goes by, in its markup (hasDatepicker, birth_date,
  // dateOfBirth, txtDOB) or its label, in English or Bangla; and a format
  // written in it or beside it: YYYY-MM-DD, dd/mm/yyyy.
  const DATE_WORDS = /\b(date|dob|birth|calendar|flatpickr)|তারিখ|জন্ম/;
  const DATE_FORMAT = /\b(y{2,4}|m{1,2}|d{1,2})\s*[-/.]\s*(y{2,4}|m{1,2}|d{1,2})\b/;

  /**
   * A read-only box that a calendar fills in. Sites make date boxes read-only
   * so the date has to come from the calendar, which for a birth date means
   * clicking back a month at a time for years. Keys typed into one are let
   * in: typing the date is what the user is trying to do.
   */
  function isDateBox(el) {
    if (!el || el.nodeType !== 1 || el.tagName !== 'INPUT' || el.disabled || !el.readOnly) return false;
    if (['', 'text', 'search'].indexOf((el.getAttribute('type') || '').toLowerCase()) === -1) return false;
    const said = [el.id, el.name, typeof el.className === 'string' ? el.className : '',
      el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('title'),
      el.getAttribute('data-provide'), el.getAttribute('data-toggle')];
    try {
      Array.from(el.labels || []).forEach(label => said.push(label.textContent));
      const doc = el.ownerDocument || document;
      (el.getAttribute('aria-labelledby') || '').split(/\s+/).forEach(id => {
        const label = id && doc.getElementById(id);
        if (label) said.push(label.textContent);
      });
    } catch (e) { /* named by its markup alone */ }
    const raw = said.filter(Boolean).join(' ');
    const words = raw.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
    return DATE_WORDS.test(words) || DATE_FORMAT.test(raw.toLowerCase());
  }

  // A date box is not typed in by the browser, so what real typing brings
  // with it is sent from here: the key coming up, which is when a calendar
  // reads the box (jQuery UI's, bootstrap's), and a change event on leaving,
  // which Chrome sends only after real typing. Without the first, Enter
  // chose the day the calendar was still showing, over the date typed.
  const leaveWith = new WeakMap();

  function typedIntoDateBox(el, key) {
    try {
      const f = keyEventFields(key, /[A-Z]/.test(key));
      el.dispatchEvent(new KeyboardEvent('keyup', {
        key: f.key, code: f.code, keyCode: f.keyCode, which: f.keyCode, bubbles: true, cancelable: true, composed: true
      }));
    } catch (e) { /* a page that throws from its own listener */ }
    if (!leaveWith.has(el)) {
      el.addEventListener('blur', () => {
        const typed = leaveWith.get(el);
        leaveWith.delete(el);
        // Not when the calendar has put its own date in since: it said so.
        if (typed === el.value) el.dispatchEvent(new Event('change', { bubbles: true }));
      }, { once: true });
    }
    leaveWith.set(el, el.value);
  }

  /** Whether selectionStart and setRangeText work: not on email or number. */
  function hasCaret(el) {
    try { return el && typeof el.selectionStart === 'number'; } catch (e) { return false; }
  }

  function selectedText(el) {
    if (el && !el.isContentEditable && hasCaret(el)) {
      return String(el.value || '').slice(el.selectionStart, el.selectionEnd);
    }
    try {
      const doc = (el && el.ownerDocument) || document;
      return String(doc.getSelection ? doc.getSelection() : '');
    } catch (e) { return ''; }
  }

  function exec(el, command, value) {
    const doc = (el && el.ownerDocument) || document;
    try { return Boolean(doc.execCommand && doc.execCommand(command, false, value)); }
    catch (e) { return false; }
  }

  /**
   * Types text into a box the way a keyboard would. execCommand goes through
   * the browser's own editing, so the site's framework sees ordinary typing
   * and Undo can take it back; the fallback is for pages where it is missing.
   */
  function insertText(el, text) {
    if (!el) return false;
    if (exec(el, 'insertText', text)) return true;
    try {
      if (el.isContentEditable) {
        const doc = el.ownerDocument;
        const sel = doc.getSelection();
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const node = doc.createTextNode(text);
          range.insertNode(node);
          range.setStartAfter(node);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          el.appendChild(doc.createTextNode(text));
        }
      } else if (hasCaret(el) && typeof el.setRangeText === 'function') {
        el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
      } else {
        el.value = String(el.value || '') + text;
      }
      const Input = typeof InputEvent === 'function' ? InputEvent : Event;
      el.dispatchEvent(new Input('input', { bubbles: true, inputType: 'insertText', data: text }));
      if (isDateBox(el)) typedIntoDateBox(el, text.slice(-1));
      return true;
    } catch (e) { return false; }
  }

  /** Backspace (direction -1) or Delete (+1) in a box. */
  function deleteText(el, direction) {
    if (!el) return false;
    if (exec(el, direction < 0 ? 'delete' : 'forwardDelete')) return true;
    if (el.isContentEditable || !hasCaret(el)) return false;
    let start = el.selectionStart;
    let end = el.selectionEnd;
    if (start === end) {
      if (direction < 0) start = Math.max(0, start - 1);
      else end = Math.min(String(el.value).length, end + 1);
    }
    if (start === end) return false;
    el.setRangeText('', start, end, 'end');
    const Input = typeof InputEvent === 'function' ? InputEvent : Event;
    el.dispatchEvent(new Input('input', { bubbles: true,
      inputType: direction < 0 ? 'deleteContentBackward' : 'deleteContentForward' }));
    if (isDateBox(el)) typedIntoDateBox(el, direction < 0 ? 'Backspace' : 'Delete');
    return true;
  }

  // ── Key events for the page ──────────────────────────────────────────────

  const NAMED = {
    Enter: ['Enter', 'Enter', 13], Tab: ['Tab', 'Tab', 9], Esc: ['Escape', 'Escape', 27],
    Space: [' ', 'Space', 32], Backspace: ['Backspace', 'Backspace', 8], Delete: ['Delete', 'Delete', 46],
    Left: ['ArrowLeft', 'ArrowLeft', 37], Up: ['ArrowUp', 'ArrowUp', 38],
    Right: ['ArrowRight', 'ArrowRight', 39], Down: ['ArrowDown', 'ArrowDown', 40],
    Home: ['Home', 'Home', 36], End: ['End', 'End', 35],
    PageUp: ['PageUp', 'PageUp', 33], PageDown: ['PageDown', 'PageDown', 34],
    PrintScreen: ['PrintScreen', 'PrintScreen', 44]
  };
  // US layout: the key's code, and what Shift makes of it.
  const SYMBOLS = {
    '`': ['Backquote', '~', 192], '-': ['Minus', '_', 189], '=': ['Equal', '+', 187],
    '[': ['BracketLeft', '{', 219], ']': ['BracketRight', '}', 221], '\\': ['Backslash', '|', 220],
    ';': ['Semicolon', ':', 186], "'": ['Quote', '"', 222], ',': ['Comma', '<', 188],
    '.': ['Period', '>', 190], '/': ['Slash', '?', 191]
  };
  const SHIFTED_DIGITS = ')!@#$%^&*(';

  /** KeyboardEvent fields for a key name ("C", "Enter", "=") with or without Shift. */
  function keyEventFields(name, shift) {
    const k = keyName(name);
    if (NAMED[k]) return { key: NAMED[k][0], code: NAMED[k][1], keyCode: NAMED[k][2], printable: k === 'Space' };
    if (/^F\d{1,2}$/.test(k)) return { key: k, code: k, keyCode: 111 + Number(k.slice(1)), printable: false };
    if (/^[A-Z]$/.test(k)) {
      return { key: shift ? k : k.toLowerCase(), code: 'Key' + k, keyCode: k.charCodeAt(0), printable: true };
    }
    if (/^[0-9]$/.test(k)) {
      return { key: shift ? SHIFTED_DIGITS[Number(k)] : k, code: 'Digit' + k, keyCode: 48 + Number(k), printable: true };
    }
    if (SYMBOLS[k]) return { key: shift ? SYMBOLS[k][1] : k, code: SYMBOLS[k][0], keyCode: SYMBOLS[k][2], printable: true };
    return { key: k, code: '', keyCode: 0, printable: k.length === 1 };
  }

  /**
   * Presses a key, with modifiers held, as far as a page can: keydown,
   * keypress for a character, keyup. The page's own listeners hear it; the
   * browser and Windows do not. Returns whether the page said it handled it.
   */
  function sendKeys(target, mods, name) {
    const m = mods || {};
    const f = keyEventFields(name, m.shift);
    const init = {
      key: f.key, code: f.code, keyCode: f.keyCode, which: f.keyCode,
      ctrlKey: Boolean(m.ctrl), altKey: Boolean(m.alt), shiftKey: Boolean(m.shift), metaKey: Boolean(m.win),
      bubbles: true, cancelable: true, composed: true
    };
    const to = target || document.body || document.documentElement;
    let handled = false;
    try {
      const down = new KeyboardEvent('keydown', init);
      to.dispatchEvent(down);
      handled = down.defaultPrevented;
      if (!handled && f.printable && !m.ctrl && !m.alt && !m.win) {
        const press = new KeyboardEvent('keypress', Object.assign({}, init,
          { charCode: f.key.charCodeAt(0) }));
        to.dispatchEvent(press);
        handled = press.defaultPrevented;
      }
      to.dispatchEvent(new KeyboardEvent('keyup', init));
    } catch (e) { /* a page that throws from its own listener */ }
    return handled;
  }

  // ── Running an action ────────────────────────────────────────────────────

  // Text copied through AccessiFlow, for Paste to fall back on when Chrome
  // will not let it read the clipboard.
  let lastCopied = '';

  function tabOp(op) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ action: 'handTab', op: op }, reply => {
          void chrome.runtime.lastError;
          resolve(reply || { ok: false, message: 'AccessiFlow could not reach the browser. Reload the page and try again.' });
        });
      } catch (e) {
        resolve({ ok: false, message: 'AccessiFlow was updated. Reload the page to use this.' });
      }
    });
  }

  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const frame = () => new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });

  /** Hides AccessiFlow's own furniture for a moment, so a screenshot shows the page. */
  function hideOwn() {
    const hidden = [];
    Array.from(document.querySelectorAll('[id^="accessiflow-"]')).forEach(el => {
      if (el.parentElement !== document.documentElement && el.parentElement !== document.body) return;
      hidden.push([el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
      el.style.setProperty('visibility', 'hidden', 'important');
    });
    return () => hidden.forEach(([el, value, priority]) => {
      if (value) el.style.setProperty('visibility', value, priority);
      else el.style.removeProperty('visibility');
    });
  }

  function dataUrlToBlob(dataUrl) {
    const [head, body] = String(dataUrl).split(',');
    const type = (/data:([^;]+)/.exec(head) || [])[1] || 'image/png';
    const bytes = atob(body || '');
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) out[i] = bytes.charCodeAt(i);
    return new Blob([out], { type: type });
  }

  async function screenshot() {
    const restore = hideOwn();
    let reply;
    try {
      await frame();
      await frame();
      await pause(60);
      reply = await tabOp('screenshot');
    } finally {
      restore();
    }
    if (!reply || !reply.image) return (reply && reply.message) || 'The screenshot could not be taken.';
    try {
      if (!navigator.clipboard || typeof ClipboardItem !== 'function') throw new Error('no clipboard');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': dataUrlToBlob(reply.image) })]);
      return 'Screenshot copied. Paste it wherever you need it.';
    } catch (e) {
      // Chrome only lets a page write a picture to the clipboard on a secure
      // site, and a site can forbid it. Show it instead: right-click on a
      // picture offers Copy image and Save image as.
      Preview.show(reply.image);
      return 'Chrome would not let AccessiFlow copy the picture on this site, so it is shown instead. Right-click it to copy or save it.';
    }
  }

  async function paste(el) {
    if (!isTextField(el) && !isDateBox(el)) return 'Click in a box first, then Paste.';
    // Only works where Chrome lets extensions read the clipboard outright.
    if (exec(el, 'paste')) return 'Pasted.';
    // Chrome asks the user, once for each site.
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) { insertText(el, text); return 'Pasted.'; }
      }
    } catch (e) { /* refused, or not a secure site */ }
    if (lastCopied) {
      insertText(el, lastCopied);
      return 'Pasted what you last copied with AccessiFlow.';
    }
    return 'Chrome would not let AccessiFlow read what you copied. Allow it when Chrome asks, or copy with AccessiFlow first.';
  }

  function copy(el, cut) {
    const text = selectedText(el);
    if (!text) return 'Select some text first.';
    lastCopied = text;
    const done = exec(el, cut ? 'cut' : 'copy');
    if (!done) {
      try { navigator.clipboard.writeText(text).catch(() => { /* kept in lastCopied */ }); } catch (e) { /* ok */ }
      if (cut && isTextField(el)) deleteText(el, -1);
    }
    return cut ? 'Cut.' : 'Copied.';
  }

  function selectAll(el) {
    if (el && !el.isContentEditable && typeof el.select === 'function' && isTextField(el)) {
      el.select();
      return 'Selected everything in this box.';
    }
    if (exec(el, 'selectAll')) return 'Selected everything.';
    try {
      document.getSelection().selectAllChildren(document.body);
      return 'Selected everything.';
    } catch (e) { return 'Nothing could be selected here.'; }
  }

  const TAB_MESSAGES = {
    newTab: 'New tab.', closeTab: '', nextTab: '', prevTab: '', newWindow: 'New window.',
    history: 'History opened.', downloads: 'Downloads opened.'
  };

  /**
   * Runs an action by id. `target` is where edits go, when not the element
   * with focus now (a box the user was in before they clicked a list).
   * Resolves to the sentence to show the user, or '' for nothing to say.
   */
  async function run(id, options) {
    const o = options || {};
    const el = o.target || deepActive();
    const A = window.AccessiFlowPageActions;

    switch (id) {
      case 'copy': return copy(el, false);
      case 'cut': return copy(el, true);
      case 'paste': return paste(el);
      case 'selectAll': return selectAll(el);
      case 'undo': return exec(el, 'undo') ? 'Undone.' : 'Nothing to undo here.';
      case 'redo': return exec(el, 'redo') ? 'Redone.' : 'Nothing to redo here.';

      case 'back': history.back(); return 'Going back.';
      case 'forward': history.forward(); return 'Going forward.';
      case 'reload': location.reload(); return 'Reloading.';
      case 'top': return A ? A.scroll(-1, { amount: 'end' }) : (window.scrollTo(0, 0), 'At the top.');
      case 'bottom': return A ? A.scroll(1, { amount: 'end' }) : (window.scrollTo(0, 1e9), 'At the bottom.');
      // Printing stops the page until the dialog closes; let the reply show first.
      case 'print': setTimeout(() => { try { window.print(); } catch (e) { /* ok */ } }, 60); return '';
      case 'screenshot': return screenshot();

      case 'newTab': case 'closeTab': case 'nextTab': case 'prevTab':
      case 'newWindow': case 'history': case 'downloads':
      case 'zoomIn': case 'zoomOut': case 'zoomReset': {
        const reply = await tabOp(id);
        if (!reply.ok) return reply.message || 'That did not work.';
        return reply.message || TAB_MESSAGES[id] || '';
      }
    }
    return 'AccessiFlow does not know how to do that.';
  }

  /**
   * Runs a combination built one key at a time. The page hears it first
   * where a real keyboard would reach it; the action runs when the page did
   * not want it, or when only the browser could ever have answered.
   */
  async function runCombo(mods, key, options) {
    const o = options || {};
    const name = comboOf(mods, key);
    const action = forCombo(name);
    const el = o.target || deepActive();

    if (action && !action.pageFirst) return run(action.id, o);
    const handled = sendKeys(el, mods, key);
    if (handled) return 'Done.';
    if (action) return run(action.id, o);
    if (OUT_OF_REACH[name]) return OUT_OF_REACH[name];
    if (mods && mods.win) return WINDOWS_KEYS;
    return 'Pressed ' + display(name) + '. If nothing happened, this page does not use it.';
  }

  // ── Scrolling for the ring ───────────────────────────────────────────────

  function canScroll(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.scrollHeight <= el.clientHeight + 1) return false;
    try {
      const overflow = window.getComputedStyle(el).overflowY;
      return overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';
    } catch (e) { return false; }
  }

  /** What scrolls under the pointer: an inner panel if there is one, else the page. */
  function scrollerAt(el) {
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = composedParent(n)) {
      if (canScroll(n)) return n;
    }
    const A = window.AccessiFlowPageActions;
    return (A && A.scroller()) || document.scrollingElement || document.documentElement;
  }

  /** Scrolls by a number of pixels, at once, whatever smooth scrolling the page asked for. */
  function scrollBy(target, dy) {
    const isPage = !target || target === document.scrollingElement || target === document.documentElement ||
      target === document.body;
    try {
      if (isPage) window.scrollBy({ top: dy, behavior: 'instant' });
      else target.scrollBy({ top: dy, behavior: 'instant' });
    } catch (e) {
      if (isPage) window.scrollBy(0, dy);
      else target.scrollTop += dy;
    }
  }

  // ── A word on screen ─────────────────────────────────────────────────────

  const Toast = {
    _host: null,
    _text: null,
    _timer: null,

    show(message) {
      if (!message) return;
      if (!this._host || !this._host.isConnected) this._build();
      this._text.textContent = message;
      this._host.style.display = '';
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.hide(), 3500);
    },

    hide() {
      clearTimeout(this._timer);
      if (this._host) this._host.style.display = 'none';
    },

    destroy() {
      clearTimeout(this._timer);
      if (this._host) this._host.remove();
      this._host = null;
    },

    _build() {
      const host = document.createElement('div');
      host.id = 'accessiflow-hand-toast';
      host.style.cssText = 'all: initial; position: fixed; top: 16px; left: 50%; transform: translateX(-50%); ' +
        'z-index: 2147483646; pointer-events: none; display: none;';
      const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
      const text = document.createElement('div');
      text.setAttribute('role', 'status');
      text.setAttribute('aria-live', 'polite');
      text.style.cssText = 'font: 600 16px/1.4 system-ui, "Segoe UI", sans-serif; color: #111; background: #ffd400; ' +
        'border: 2px solid #111; border-radius: 10px; padding: 10px 16px; max-width: min(520px, calc(100vw - 32px)); ' +
        'box-shadow: 0 6px 18px rgba(0,0,0,.4);';
      root.appendChild(text);
      document.documentElement.appendChild(host);
      this._host = host;
      this._text = text;
    }
  };

  // The screenshot, shown when it could not be copied.
  const Preview = {
    _host: null,

    show(image) {
      this.hide();
      const host = document.createElement('div');
      host.id = 'accessiflow-hand-preview';
      host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483646; display: flex; ' +
        'align-items: center; justify-content: center; background: rgba(0,0,0,.6);';
      const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
      const box = document.createElement('div');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Screenshot');
      box.style.cssText = 'font: 15px/1.4 system-ui, "Segoe UI", sans-serif; color: #f4f5f7; background: #16181d; ' +
        'border: 2px solid #4fffb0; border-radius: 12px; padding: 14px; max-width: 80vw; display: grid; gap: 10px;';
      const img = document.createElement('img');
      img.src = image;
      img.alt = 'Screenshot of this page';
      img.style.cssText = 'max-width: 100%; max-height: 60vh; border: 1px solid #555c69;';
      const note = document.createElement('p');
      note.style.margin = '0';
      note.textContent = 'Right-click the picture and choose Copy image, or Save image as.';
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = 'Close';
      close.style.cssText = 'justify-self: end; font: 700 16px/1 system-ui, sans-serif; min-height: 44px; padding: 0 20px; ' +
        'color: #16181d; background: #4fffb0; border: 0; border-radius: 8px; cursor: pointer;';
      close.addEventListener('click', () => this.hide());
      box.append(img, note, close);
      root.appendChild(box);
      document.documentElement.appendChild(host);
      this._host = host;
    },

    hide() {
      if (this._host) this._host.remove();
      this._host = null;
    }
  };

  const HandActions = {
    ACTIONS, OUT_OF_REACH,
    byId, forCombo, explain, search, normalise, comboOf, display, keyName,
    run, runCombo, sendKeys, keyEventFields,
    deepActive, isTextField, isDateBox, hasCaret, insertText, deleteText, selectedText, isOurs, composedParent,
    scrollerAt, scrollBy,
    toast: message => Toast.show(message),
    destroy() { Toast.destroy(); Preview.hide(); }
  };

  if (typeof window !== 'undefined') window.AccessiFlowHandActions = HandActions;
})();
