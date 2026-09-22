// AccessiFlow page actions
//
// The things a person does to a page with a mouse, done without one: find
// what can be clicked, click it the way the keyboard would, scroll whatever
// actually scrolls, move between headings, get into a text box. Keyboard-only
// mode and voice control both drive the page through these, so a fix to one
// (a fake button that ignores Enter, a panel that scrolls instead of the
// window) is a fix to both.
//
// Every action returns the sentence to tell the user, and leaves it to the
// caller to decide how: a line in the corner, a spoken reply, a panel log.
'use strict';

(function () {
  // Injected a second time into the page when the reader reaches into frames:
  // keep the copy already here, which remembers what it changed.
  if (typeof window !== 'undefined' && window.AccessiFlowPageActions) return;

  const TEXT_INPUT_TYPES = ['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number',
    'date', 'datetime-local', 'month', 'week', 'time'];

  const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

  const FALLBACK_SELECTOR = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, ' +
    '[role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';

  // Headings made focusable so the keyboard could land on them, to be put
  // back when the mode that did it is switched off.
  const addedTabindex = [];

  /** Whether keys pressed here belong to the user's typing. */
  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      return TEXT_INPUT_TYPES.indexOf(type) !== -1 || type === 'range' || type === 'color';
    }
    const role = (el.getAttribute('role') || '').toLowerCase();
    return role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'slider';
  }

  function isTextBox(el) {
    if (!el || el.nodeType !== 1 || el.disabled || el.readOnly) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    return TEXT_INPUT_TYPES.indexOf((el.getAttribute('type') || '').toLowerCase()) !== -1;
  }

  function motionOK() {
    try { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return true; }
  }

  /** What a screen reader would call it, cut to something sayable. */
  function nameOf(el) {
    let name = '';
    try {
      const naming = globalThis.AccessiFlowNaming;
      name = naming ? naming.accessibleName(el) : '';
    } catch (e) { /* fall through */ }
    if (!name) name = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '';
    name = String(name).replace(/\s+/g, ' ').trim();
    // The screen-reader repairs' stand-in for a control with no name at all.
    // Read out as a name it sounds like one; it is really the lack of one.
    if (/\(no description available\)$/.test(name)) return '';
    return name.slice(0, 80);
  }

  // ── Seeing through shadow roots ──────────────────────────────────────────

  /**
   * What is really at a point. document.elementFromPoint stops at the edge of
   * a web component and returns its host; the button inside is what the user
   * sees and means.
   */
  function deepElementFromPoint(x, y) {
    if (typeof document.elementFromPoint !== 'function') return null;
    let el = document.elementFromPoint(x, y);
    for (let i = 0; el && el.shadowRoot && i < 10; i++) {
      const inner = el.shadowRoot.elementFromPoint ? el.shadowRoot.elementFromPoint(x, y) : null;
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  /** The parent, crossing out of a shadow root to its host. */
  function composedParent(el) {
    if (!el) return null;
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode ? el.getRootNode() : null;
    return root && root.host ? root.host : null;
  }

  /** Whether `outer` contains `inner`, counting shadow roots on the way. */
  function composedContains(outer, inner) {
    for (let n = inner; n; n = composedParent(n)) if (n === outer) return true;
    return false;
  }

  function isOurs(el) {
    for (let n = el; n; n = composedParent(n)) {
      if (n.id && n.id.indexOf('accessiflow-') === 0) return true;
    }
    return false;
  }

  // ── Clicking ─────────────────────────────────────────────────────────────

  function onScreen(rect) {
    return rect.width >= 1 && rect.height >= 1 && rect.bottom > 0 && rect.right > 0 &&
      rect.top < window.innerHeight && rect.left < window.innerWidth;
  }

  /**
   * Everything clickable that a sighted user could actually aim at now, in
   * reading order: top to bottom, then left to right, so the numbers run
   * across the screen the way the eye does.
   *
   * Two passes. The first finds what the markup says is clickable: links,
   * buttons, things with a role. The second finds what only *looks*
   * clickable: the ✕ on a pop-up drawn as a <span>, the card that is a
   * <div> with a click handler. Those carry the pointer cursor, because the
   * site wanted mouse users to know, and that is the one signal they always
   * have. It samples the screen on a grid, so it only ever sees what is
   * actually on top.
   */
  function clickables() {
    const G = globalThis.AccessiFlowGeometry;
    const selector = G ? G.ACTIONABLE_SELECTOR : FALLBACK_SELECTOR;
    const found = [];
    const seen = new Set();
    const hasPointer = typeof document.elementFromPoint === 'function';

    const covered = (el, rect) => {
      if (!hasPointer) return false;
      const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
      const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + Math.min(rect.height / 2, 12)));
      const hit = deepElementFromPoint(x, y);
      return !!hit && hit !== el && !composedContains(el, hit) && !composedContains(hit, el);
    };
    const insideSeen = el => {
      for (let p = composedParent(el); p; p = composedParent(p)) if (seen.has(p)) return true;
      return false;
    };

    document.querySelectorAll(selector).forEach(el => {
      if (isOurs(el) || el.disabled) return;
      const rect = el.getBoundingClientRect();
      if (!onScreen(rect)) return;
      // Hidden behind something else, such as the page behind a pop-up: a
      // label on it would be a label on nothing.
      if (covered(el, rect)) return;
      // A link wrapping a button is one target, not two.
      if (insideSeen(el)) return;
      seen.add(el);
      found.push({ el: el, rect: rect });
    });

    if (hasPointer) {
      const cursorOf = new Map();
      const pointer = el => {
        if (!cursorOf.has(el)) {
          let c = '';
          try { c = window.getComputedStyle(el).cursor; } catch (e) { /* ok */ }
          cursorOf.set(el, c === 'pointer');
        }
        return cursorOf.get(el);
      };
      const tried = new Set();
      const step = 28;
      const screenArea = window.innerWidth * window.innerHeight;

      for (let y = step / 2; y < window.innerHeight; y += step) {
        for (let x = step / 2; x < window.innerWidth; x += step) {
          const hit = deepElementFromPoint(x, y);
          if (!hit || tried.has(hit)) continue;
          tried.add(hit);
          if (isOurs(hit) || hit === document.body || hit === document.documentElement) continue;

          // Already found by markup, or inside something that was.
          let known = false;
          for (let n = hit; n && !known; n = composedParent(n)) if (seen.has(n)) known = true;
          if (known || !pointer(hit)) continue;

          // The outermost element of this run of pointer cursors is the
          // control; the icon and text inside it inherit the cursor.
          let target = hit;
          for (let p = composedParent(hit); p && p !== document.body && pointer(p); p = composedParent(p)) target = p;
          if (seen.has(target)) continue;

          const rect = target.getBoundingClientRect();
          if (!onScreen(rect)) continue;
          // Anything this big is a backdrop or a whole card of content, not
          // a control anyone would aim for.
          if (rect.width * rect.height > screenArea * 0.4) continue;
          seen.add(target);
          found.push({ el: target, rect: rect });
        }
      }
    }

    // Reading order. Rows are bucketed so a control a few pixels lower than
    // its neighbour still counts as the same line.
    found.sort((a, b) => {
      const rowA = Math.round(a.rect.top / 16);
      const rowB = Math.round(b.rect.top / 16);
      return rowA - rowB || a.rect.left - b.rect.left;
    });
    return found;
  }

  /**
   * Does what a click would, the way the keyboard would do it. A text box or
   * a list wants the keyboard, not a click: clicking a select from script
   * does not open it, and focusing is what lets the user start typing.
   */
  function activate(el) {
    const name = nameOf(el).slice(0, 60);
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) { /* ok */ } }

    if (isEditable(el)) {
      return { typing: true, message: (name ? name + '. ' : '') + 'Ready to type.' };
    }
    try { el.click(); } catch (e) { return { message: 'That could not be clicked.' }; }
    return { message: name ? 'Chose ' + name + '.' : 'Done.' };
  }

  // ── Labels on screen ─────────────────────────────────────────────────────

  /**
   * Paints a label beside each target, in a layer of its own that the page's
   * styles cannot reach and that never shifts the page's layout.
   */
  function drawLabels(id, targets, labels, colours) {
    const c = colours || { bg: '#ffd400', fg: '#111', dim: '#8a6d00' };
    const host = document.createElement('div');
    host.id = id;
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;';
    const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    const style = document.createElement('style');
    style.textContent =
      '.hint { position: fixed; font: 700 14px/1 ui-monospace, "Cascadia Mono", Consolas, monospace; ' +
      'letter-spacing: 1px; padding: 3px 5px; border-radius: 4px; background: ' + c.bg + '; color: ' + c.fg + '; ' +
      'border: 2px solid #111; box-shadow: 0 2px 6px rgba(0,0,0,.45); white-space: nowrap; } ' +
      '.hint .typed { color: ' + c.dim + '; } ' +
      '.hint[hidden] { display: none; }';
    root.appendChild(style);

    const items = targets.map((t, i) => {
      const node = document.createElement('span');
      node.className = 'hint';
      node.textContent = labels[i];
      node.style.left = Math.max(0, Math.min(window.innerWidth - 40, t.rect.left - 4)) + 'px';
      node.style.top = Math.max(0, Math.min(window.innerHeight - 24, t.rect.top - 4)) + 'px';
      root.appendChild(node);
      return { el: t.el, label: labels[i], node: node };
    });

    document.documentElement.appendChild(host);
    return { host: host, items: items };
  }

  // ── Scrolling ────────────────────────────────────────────────────────────

  /**
   * Whatever actually scrolls here. Many web apps scroll an inner panel and
   * leave the window still, so scrolling the window would do nothing at all.
   */
  function scroller() {
    const canScroll = el => {
      if (!el || el.nodeType !== 1) return false;
      if (el.scrollHeight <= el.clientHeight + 1) return false;
      const overflow = window.getComputedStyle(el).overflowY;
      return overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';
    };

    let start = document.activeElement;
    if (!start || start === document.body || start === document.documentElement) {
      start = typeof document.elementFromPoint === 'function'
        ? document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
        : null;
    }
    for (let el = start; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (canScroll(el)) return el;
    }
    return document.scrollingElement || document.documentElement;
  }

  /**
   * Scrolls by a share of the screen. `amount` is 'step' (a third, the
   * default), 'page' (most of a screen) or 'end' (all the way).
   */
  function scroll(direction, options) {
    const o = options || {};
    const target = scroller();
    const isWindow = target === document.scrollingElement || target === document.documentElement;
    const behavior = o.instant || !motionOK() ? 'auto' : 'smooth';

    let top;
    if (o.amount === 'end') {
      top = direction > 0 ? 1e9 : -1e9;
    } else {
      const share = o.amount === 'page' ? 0.85 : 0.35;
      top = Math.max(80, Math.round(window.innerHeight * share)) * direction;
    }

    try {
      if (isWindow) window.scrollBy({ top: top, behavior: behavior });
      else target.scrollBy({ top: top, behavior: behavior });
    } catch (e) {
      window.scrollBy(0, top);
    }
    if (o.amount === 'end') return direction > 0 ? 'At the bottom.' : 'At the top.';
    return direction > 0 ? 'Scrolled down.' : 'Scrolled up.';
  }

  // ── Headings ─────────────────────────────────────────────────────────────

  function visibleHeadings() {
    return Array.from(document.querySelectorAll(HEADING_SELECTOR)).filter(h => {
      if (h.closest('[id^="accessiflow-"]')) return false;
      if (!(h.textContent || '').trim()) return false;
      return h.getClientRects().length > 0;
    });
  }

  function heading(direction) {
    const headings = visibleHeadings();
    if (!headings.length) return 'This page has no headings.';

    let index = headings.indexOf(document.activeElement);
    if (index === -1) {
      // Nothing chosen yet: go from where the reader is looking.
      if (direction > 0) {
        index = headings.findIndex(h => h.getBoundingClientRect().top > 8);
        index = index === -1 ? headings.length : index;
        index -= 1;
      } else {
        let last = headings.length;
        headings.forEach((h, i) => { if (h.getBoundingClientRect().top < -8) last = i; });
        index = last === headings.length ? 0 : last + 1;
      }
    }

    const next = headings[index + direction];
    if (!next) return direction > 0 ? 'No more headings below.' : 'No more headings above.';

    if (!next.hasAttribute('tabindex')) {
      next.setAttribute('tabindex', '-1');
      addedTabindex.push(next);
    }
    try { next.focus({ preventScroll: true }); } catch (e) { next.focus(); }
    try { next.scrollIntoView({ block: 'start', behavior: motionOK() ? 'smooth' : 'auto' }); }
    catch (e) { /* ok */ }

    const level = next.getAttribute('aria-level') || (/^H(\d)$/.exec(next.tagName) || [])[1] || '';
    return 'Heading' + (level ? ' ' + level : '') + ': ' + next.textContent.trim().slice(0, 80);
  }

  /** Puts back the tabindex added to headings along the way. */
  function restoreHeadings() {
    addedTabindex.forEach(el => {
      try { el.removeAttribute('tabindex'); } catch (e) { /* ok */ }
    });
    addedTabindex.length = 0;
  }

  // ── Text boxes ───────────────────────────────────────────────────────────

  function firstTextBox() {
    const boxes = Array.from(document.querySelectorAll('input, textarea, [contenteditable=""], [contenteditable="true"]'))
      .filter(el => isTextBox(el) && !el.closest('[id^="accessiflow-"]') && el.getClientRects().length > 0);
    if (!boxes.length) return { found: false, message: 'There is no text box on this page.' };

    // One already on screen is nearer than the first in the page.
    const onScreen = boxes.find(el => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    });
    const box = onScreen || boxes[0];
    try { box.scrollIntoView({ block: 'center' }); } catch (e) { /* ok */ }
    box.focus();
    const name = nameOf(box);
    return { found: true, el: box, message: 'In the ' + (name ? name + ' ' : '') + 'text box.' };
  }

  // ── Pop-ups ──────────────────────────────────────────────────────────────

  function stillShowing(el) {
    if (!el || !el.isConnected) return false;
    if (!el.getClientRects().length) return false;
    try {
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
    } catch (e) { /* ok */ }
    return true;
  }

  /**
   * The pop-up in the way, if there is one. A properly built one says so
   * (role="dialog", aria-modal, <dialog open>). Most do not, so the fallback
   * is what sits at the middle of the screen inside something fixed in place
   * and large: a modal and its backdrop, whatever they are made of.
   */
  function findPopup() {
    const declared = Array.from(document.querySelectorAll(
      'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]'))
      .filter(el => !isOurs(el) && stillShowing(el));
    if (declared.length) return declared[declared.length - 1];

    const hit = deepElementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    const screenArea = window.innerWidth * window.innerHeight;
    for (let n = hit; n && n !== document.body && n !== document.documentElement; n = composedParent(n)) {
      if (isOurs(n)) return null;
      let cs = null;
      try { cs = window.getComputedStyle(n); } catch (e) { /* ok */ }
      if (!cs || cs.position !== 'fixed') continue;
      const r = n.getBoundingClientRect();
      if (r.width * r.height >= screenArea * 0.15) return n;
    }
    return null;
  }

  // Words on a control that closes something. Bangla too: বন্ধ is "close".
  const CLOSE_WORDS = /(^|\b)(close|dismiss|cancel|no,? thanks|not now|maybe later|skip)(\b|$)|^[x×✕✖✗╳]$|বন্ধ/i;
  const ACCEPT_WORDS = /^(ok|okay|got it|i understand|understood|continue|accept|agree|i agree|accept all)$/i;

  /** The control inside a pop-up most likely to close it, or null. */
  function closeControlIn(popup) {
    const G = globalThis.AccessiFlowGeometry;
    const box = popup.getBoundingClientRect();
    let best = null;
    let bestScore = 0;

    popup.querySelectorAll('*').forEach(el => {
      if (isOurs(el)) return;
      const rect = el.getBoundingClientRect();
      if (!onScreen(rect) || rect.width > 320 || rect.height > 120) return;

      const words = [
        el.getAttribute('aria-label'), el.getAttribute('title'),
        el.getAttribute('data-dismiss'), el.getAttribute('data-bs-dismiss')
      ].filter(Boolean).join(' ');
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const cls = (typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '');

      let score = 0;
      if (CLOSE_WORDS.test(words) || /modal|dialog|popup|close/i.test(el.getAttribute('data-dismiss') || '')) score = 10;
      else if (text.length <= 20 && CLOSE_WORDS.test(text)) score = 9;
      else if (/(^|[-_\s])(close|dismiss)([-_\s]|$)|btn-close|closebtn|close-?button|close-?icon/i.test(cls)) score = 8;
      else if (text.length <= 20 && ACCEPT_WORDS.test(text)) score = 5;
      if (!score) return;

      // A real control beats the icon inside it; the top-right corner is
      // where a close button nearly always is.
      if (G && G.isActionable(el)) score += 1;
      if (rect.top - box.top < 80 && box.right - rect.right < 80) score += 1;

      // Prefer the outer control over its own icon when they tie.
      if (score > bestScore || (score === bestScore && best && el.contains(best))) {
        best = el;
        bestScore = score;
      }
    });
    return best;
  }

  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  function pressEscape(target) {
    const init = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true, composed: true };
    [target, document].forEach(t => {
      try { t.dispatchEvent(new KeyboardEvent('keydown', init)); } catch (e) { /* ok */ }
      try { t.dispatchEvent(new KeyboardEvent('keyup', init)); } catch (e) { /* ok */ }
    });
  }

  function clickAt(x, y) {
    const hit = deepElementFromPoint(x, y);
    if (!hit || isOurs(hit)) return false;
    const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
      try {
        const E = type.indexOf('pointer') === 0 && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
        hit.dispatchEvent(new E(type, init));
      } catch (e) { /* ok */ }
    });
    return true;
  }

  /**
   * Closes whatever pop-up is in the way, trying what a mouse user would:
   * its close button, then Esc, then a click on the dimmed page outside it.
   * Checks after each whether it has gone, so it only reports success when
   * it can see the pop-up is closed.
   */
  async function closePopup() {
    const popup = findPopup();
    if (!popup) return { ok: false, message: 'I cannot see a pop-up. If something is in the way, say show numbers.' };

    const control = closeControlIn(popup);
    if (control) {
      activate(control);
      await pause(450);
      if (!stillShowing(popup)) return { ok: true, message: 'Closed the pop-up.' };
    }

    pressEscape(document.activeElement && document.activeElement !== document.body ? document.activeElement : popup);
    await pause(450);
    if (!stillShowing(popup)) return { ok: true, message: 'Closed the pop-up.' };

    // Outside the pop-up's own box, on its backdrop. Corners first: the one
    // place a backdrop reliably shows and page content never does.
    const inner = Array.from(popup.children).find(c => {
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.width < window.innerWidth * 0.95;
    });
    const content = (inner || popup).getBoundingClientRect();
    const points = [[8, 8], [window.innerWidth - 8, window.innerHeight - 8], [8, window.innerHeight - 8]]
      .filter(([x, y]) => x < content.left || x > content.right || y < content.top || y > content.bottom);
    for (const [x, y] of points) {
      clickAt(x, y);
      await pause(350);
      if (!stillShowing(popup)) return { ok: true, message: 'Closed the pop-up.' };
    }

    return { ok: false, message: 'This pop-up would not close. Say show numbers and choose its button.' };
  }

  const PageActions = {
    isEditable, isTextBox, motionOK, nameOf,
    clickables, activate, drawLabels,
    scroller, scroll,
    visibleHeadings, heading, restoreHeadings,
    firstTextBox,
    deepElementFromPoint, findPopup, closeControlIn, closePopup
  };

  if (typeof window !== 'undefined') window.AccessiFlowPageActions = PageActions;
})();
