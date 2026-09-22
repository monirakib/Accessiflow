// AccessiFlow FocusLockModule
//
// Modern sites open dialogs as plain divs. A sighted user sees a card appear
// over a dimmed page; a keyboard user gets nothing. Focus stays wherever it
// was, Tab walks through the page *behind* the dialog, and a screen reader
// reads content the user cannot see and cannot reach. WCAG 2.4.3 and 2.1.2
// both cover this, and it is one of the most common failures on the web.
//
// This detects that a dialog opened and makes the rest of the page inert.
//
// Note what is deliberately *not* here: a keydown handler that intercepts Tab.
// That is how most tools do it, and it fights the page's own scripts, breaks
// Shift+Tab at the boundaries, and traps the user for real if it misfires.
// The `inert` attribute removes a subtree from the tab order and from the
// accessibility tree at the same time, natively, with no key interception.
// The keyboard then does the right thing by itself.
'use strict';

class FocusLockModule {
  constructor() {
    this._active = false;
    this._observer = null;
    this._focusGuard = null;
    this._keyHandler = null;

    this._locked = null;          // the dialog we are holding
    this._returnTo = null;        // what had focus before it opened
    this._inerted = [];           // elements we set inert on, for an exact undo
    this._added = [];             // attributes we added, likewise
    this._armTimer = null;
    this._released = new WeakSet();   // dialogs the user told us to let go of
  }

  _log(msg) { console.log('[AccessiFlow][FocusLock] ' + msg); }
  _warn(msg) { console.warn('[AccessiFlow][FocusLock] ' + msg); }

  static get FOCUSABLE() {
    return 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
      'select:not([disabled]), textarea:not([disabled]), summary, iframe, ' +
      '[tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  }

  /** Dialogs the page has declared. No guessing needed for these. */
  static get DECLARED() {
    return 'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';
  }

  buildCSS() { return ''; }

  // ── Recognising a dialog ──────────────────────────────────────────────────

  _isDeclared(el) {
    return el.matches && el.matches(FocusLockModule.DECLARED);
  }

  /**
   * Whether an undeclared element is behaving like a modal.
   *
   * Every condition here is one a real dialog meets and an ordinary panel does
   * not. The bar is deliberately high: locking the keyboard into a sticky
   * header or a cookie strip would be worse than not locking at all, which is
   * why Alt+Shift+U exists as a way out.
   */
  _looksModal(el) {
    try {
      if (!el || el.nodeType !== 1) return false;
      if (el.id && el.id.indexOf('accessiflow-') === 0) return false;
      if (el.closest('[id^="accessiflow-"]')) return false;

      const cs = window.getComputedStyle(el);
      if (!cs) return false;
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (parseFloat(cs.opacity) < 0.5) return false;
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;

      // Something painted over the page sits above it.
      const z = parseInt(cs.zIndex, 10);
      if (isNaN(z) || z < 100) return false;

      const rect = el.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 100) return false;

      // Either it covers a real share of the screen, or it is centred over a
      // backdrop, which is the other shape a dialog takes.
      const coverage = (rect.width * rect.height) /
        (window.innerWidth * window.innerHeight);
      const centred = Math.abs((rect.left + rect.width / 2) - window.innerWidth / 2) < window.innerWidth * 0.2;
      if (coverage < 0.12 && !centred) return false;
      if (coverage > 0.98 && !this._focusableIn(el).length) return false;   // a plain backdrop

      // A dialog the keyboard cannot enter is not a dialog worth locking into.
      if (!this._focusableIn(el).length) return false;

      // Class and text hints, as a final confirmation rather than as the test.
      const hint = (el.className && typeof el.className === 'string' ? el.className : '') +
        ' ' + (el.getAttribute('data-testid') || '') + ' ' + (el.id || '');
      if (/modal|dialog|popup|lightbox|overlay|drawer|sheet/i.test(hint)) return true;

      // No hint, but it covers most of the screen and holds controls.
      return coverage >= 0.25;
    } catch (e) {
      return false;
    }
  }

  _focusableIn(root) {
    try {
      return Array.from(root.querySelectorAll(FocusLockModule.FOCUSABLE))
        .filter(el => {
          if (el.closest('[inert]')) return false;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return false;
          const cs = window.getComputedStyle(el);
          return cs && cs.visibility !== 'hidden' && cs.display !== 'none';
        });
    } catch (e) {
      return [];
    }
  }

  _isVisible(el) {
    if (!el || !el.isConnected) return false;
    const cs = window.getComputedStyle(el);
    if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (el.hasAttribute('hidden')) return false;
    if (el.tagName === 'DIALOG' && !el.hasAttribute('open')) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  // ── Locking ───────────────────────────────────────────────────────────────

  _arm(dialog) {
    if (this._locked || this._released.has(dialog)) return;
    if (this._armTimer) return;

    // Never lock into something the keyboard cannot use.
    //
    // This applies to dialogs the page declared as well as ones we inferred.
    // A role="dialog" holding only a loading spinner is common, and making the
    // whole page inert around it would leave the user with nowhere to Tab to
    // and only Escape or Alt+Shift+U as a way out. That is a trap, which is
    // the exact thing this module exists to prevent.
    //
    // Nothing is lost by waiting: when the dialog fills in, the observer sees
    // the new children and we arm then.
    if (!this._focusableIn(dialog).length) return;

    // Give the page its own chance first. A well-built dialog moves focus
    // inside on open, and a correct one must not be fought.
    this._armTimer = setTimeout(() => {
      this._armTimer = null;
      if (!this._active || this._locked) return;
      if (!this._isVisible(dialog)) return;
      this._lock(dialog);
    }, 150);
  }

  _lock(dialog) {
    try {
      this._locked = dialog;
      this._returnTo = document.activeElement;

      const pageHandledFocus = dialog.contains(document.activeElement) &&
        document.activeElement !== document.body;

      this._makeBackgroundInert(dialog);
      this._nameIt(dialog);

      // Only move focus if the page did not. Stealing it from a dialog that
      // already placed it correctly would undo the site's own thinking.
      if (!pageHandledFocus) {
        const targets = this._focusableIn(dialog);
        if (targets.length) {
          targets[0].focus();
        } else {
          if (!dialog.hasAttribute('tabindex')) {
            dialog.setAttribute('tabindex', '-1');
            this._added.push({ el: dialog, attr: 'tabindex' });
          }
          dialog.focus();
        }
      }

      this._watchEscape();
      this._log('locked into ' + (dialog.tagName.toLowerCase()) +
        (dialog.id ? '#' + dialog.id : '') +
        (pageHandledFocus ? ' (page had already placed focus)' : ''));
    } catch (e) {
      this._warn('lock: ' + e.message);
      this._unlock();
    }
  }

  /**
   * Marks everything that is not the dialog as inert, level by level up the
   * tree. Only siblings are touched, never ancestors, or the dialog would be
   * inside an inert subtree and become unreachable itself.
   */
  _makeBackgroundInert(dialog) {
    const supportsInert = 'inert' in HTMLElement.prototype;
    let node = dialog;

    while (node && node.parentElement && node !== document.body.parentElement) {
      const parent = node.parentElement;
      const siblings = parent.children;

      for (let i = 0; i < siblings.length; i++) {
        const sibling = siblings[i];
        if (sibling === node) continue;
        if (sibling.id && sibling.id.indexOf('accessiflow-') === 0) continue;
        // HEAD matters here: the walk reaches <html>, where <body>'s sibling
        // is <head>. Marking it inert changes nothing on screen but does
        // mutate the document, and destroy() has to be able to prove it left
        // the DOM exactly as it found it.
        if (sibling.tagName === 'SCRIPT' || sibling.tagName === 'STYLE' ||
          sibling.tagName === 'LINK' || sibling.tagName === 'TEMPLATE' ||
          sibling.tagName === 'HEAD') continue;
        if (sibling.hasAttribute('inert')) continue;     // already inert, leave it that way

        if (supportsInert) {
          sibling.setAttribute('inert', '');
          this._inerted.push(sibling);
        } else {
          // Chrome has had inert since 102, so this is a belt-and-braces path.
          // aria-hidden alone would hide the background from a screen reader
          // without removing it from the tab order, which is the worse half.
          sibling.setAttribute('aria-hidden', 'true');
          sibling.setAttribute('data-accessiflow-inert-fallback', 'true');
          this._inerted.push(sibling);
        }
      }
      node = parent;
    }
  }

  /** Gives an undeclared dialog the role and name a screen reader needs. */
  _nameIt(dialog) {
    if (!dialog.hasAttribute('role') && dialog.tagName !== 'DIALOG') {
      dialog.setAttribute('role', 'dialog');
      this._added.push({ el: dialog, attr: 'role' });
    }
    if (!dialog.hasAttribute('aria-modal')) {
      dialog.setAttribute('aria-modal', 'true');
      this._added.push({ el: dialog, attr: 'aria-modal' });
    }

    const named = dialog.hasAttribute('aria-label') || dialog.hasAttribute('aria-labelledby');
    if (named) return;

    const heading = dialog.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
    if (heading && (heading.textContent || '').trim()) {
      if (!heading.id) {
        heading.id = 'accessiflow-dialog-title-' + Math.random().toString(36).slice(2, 8);
        this._added.push({ el: heading, attr: 'id' });
      }
      dialog.setAttribute('aria-labelledby', heading.id);
      this._added.push({ el: dialog, attr: 'aria-labelledby' });
    } else {
      dialog.setAttribute('aria-label', 'Dialog');
      this._added.push({ el: dialog, attr: 'aria-label' });
    }
  }

  /**
   * Escape closes the dialog, if the page has not already arranged that.
   * A keyboard user who cannot leave a dialog is worse off than one who never
   * got into it, so this is the safety valve rather than a convenience.
   */
  _watchEscape() {
    if (this._keyHandler) return;
    this._keyHandler = (e) => {
      if (!this._locked) return;
      if (e.key !== 'Escape' && e.key !== 'Esc') return;

      const dialog = this._locked;
      // Let the page act first. If the dialog is gone a moment later, it
      // handled Escape itself and there is nothing for us to do.
      setTimeout(() => {
        if (!this._locked || this._locked !== dialog) return;
        if (!this._isVisible(dialog)) { this._unlock(); return; }

        if (dialog.tagName === 'DIALOG' && typeof dialog.close === 'function') {
          try { dialog.close(); } catch (err) { /* already closed */ }
          return;
        }
        const closer = dialog.querySelector(
          '[aria-label*="close" i], [title*="close" i], [data-dismiss], ' +
          '[data-bs-dismiss], button[class*="close" i], [class*="close-button" i]');
        if (closer) {
          try { closer.click(); } catch (err) { /* skip */ }
        }
      }, 60);
    };
    document.addEventListener('keydown', this._keyHandler, true);
  }

  _unlock() {
    if (this._armTimer) { clearTimeout(this._armTimer); this._armTimer = null; }

    for (let i = 0; i < this._inerted.length; i++) {
      const el = this._inerted[i];
      try {
        el.removeAttribute('inert');
        if (el.getAttribute('data-accessiflow-inert-fallback') === 'true') {
          el.removeAttribute('aria-hidden');
          el.removeAttribute('data-accessiflow-inert-fallback');
        }
      } catch (e) { /* element is gone, which is fine */ }
    }
    this._inerted = [];

    for (let i = 0; i < this._added.length; i++) {
      try { this._added[i].el.removeAttribute(this._added[i].attr); } catch (e) { /* gone */ }
    }
    this._added = [];

    // Put the keyboard back where it was, the way a dialog is supposed to.
    const back = this._returnTo;
    this._returnTo = null;
    this._locked = null;

    if (back && back.isConnected && typeof back.focus === 'function') {
      try { back.focus(); } catch (e) { /* skip */ }
    }
  }

  /** Alt+Shift+U: let go, for when the guess was wrong. */
  release() {
    if (!this._locked) return false;
    this._released.add(this._locked);
    const name = this._locked.tagName.toLowerCase();
    this._unlock();
    this._log('released by the user');
    return name;
  }

  // ── Watching the page ─────────────────────────────────────────────────────

  _scan(roots) {
    for (let i = 0; i < roots.length; i++) {
      const node = roots[i];
      if (!node || node.nodeType !== 1) continue;

      if (this._isDeclared(node)) { this._arm(node); return; }
      if (this._looksModal(node)) { this._arm(node); return; }

      // A dialog nested inside whatever was just added.
      const declared = node.querySelector && node.querySelector(FocusLockModule.DECLARED);
      if (declared && this._isVisible(declared)) { this._arm(declared); return; }

      // The other direction: content arriving *inside* a dialog that is
      // already open. Dialogs routinely render a spinner first and their
      // buttons a moment later, and we decline to lock into one until it has
      // something focusable, so this second look is what picks it up. Without
      // it, a dialog that started empty would never be locked at all.
      const host = node.closest && node.closest(FocusLockModule.DECLARED);
      if (host && this._isVisible(host)) { this._arm(host); return; }
    }
  }

  _watch() {
    if (this._observer) return;

    this._observer = new MutationObserver(mutations => {
      if (!this._active) return;

      // First priority: has the dialog we are holding gone away? Leaving a
      // page permanently inert would be the worst bug this module could have.
      if (this._locked && !this._isVisible(this._locked)) {
        this._unlock();
      }

      if (this._locked) return;    // one at a time

      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === 'childList' && m.addedNodes.length) {
          this._scan(m.addedNodes);
        } else if (m.type === 'attributes' && m.target) {
          // A dialog that was in the DOM all along and has just been shown.
          const el = m.target;
          if (el.nodeType !== 1) continue;
          if (!this._isVisible(el)) continue;
          if (this._isDeclared(el) || this._looksModal(el)) this._arm(el);
        }
        if (this._locked || this._armTimer) break;
      }
    });

    this._observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open', 'style', 'class', 'hidden', 'aria-modal', 'role', 'aria-hidden']
    });

    // A backstop for focus that is moved programmatically into the inert
    // background, which `inert` prevents for the keyboard but a script can
    // still attempt.
    this._focusGuard = (e) => {
      if (!this._locked) return;
      if (this._locked.contains(e.target)) return;
      if (e.target === document.body || e.target === document.documentElement) return;
      if (e.target.closest && e.target.closest('[id^="accessiflow-"]')) return;

      const targets = this._focusableIn(this._locked);
      if (targets.length) targets[0].focus();
    };
    document.addEventListener('focusin', this._focusGuard, true);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  apply(settings) {
    const want = !!(settings && settings.focusLock);

    if (want && !this._active) {
      this._active = true;
      this._watch();
      // A dialog may already be open when the setting is switched on.
      const existing = document.querySelectorAll(FocusLockModule.DECLARED);
      for (let i = 0; i < existing.length; i++) {
        if (this._isVisible(existing[i])) { this._arm(existing[i]); break; }
      }
      this._log('watching for dialogs');
    } else if (!want && this._active) {
      this.destroy();
    }
  }

  destroy() {
    this._active = false;
    this._unlock();

    if (this._observer) { this._observer.disconnect(); this._observer = null; }
    if (this._focusGuard) {
      document.removeEventListener('focusin', this._focusGuard, true);
      this._focusGuard = null;
    }
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler, true);
      this._keyHandler = null;
    }
    this._released = new WeakSet();
  }

  get isLocked() { return this._locked !== null; }
}

/**
 * A plain focus trap for the extension's own panels.
 *
 * Returns the function that undoes it. BlindModule used to install a keydown
 * listener here and never return a handle, so the listener outlived every
 * panel it was opened for and stacked up one per open.
 */
function accessiflowTrapFocus(container) {
  if (!container) return () => {};

  const handler = (e) => {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(container.querySelectorAll(FocusLockModule.FOCUSABLE))
      .filter(el => !el.disabled && (el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement));
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}

if (typeof window !== 'undefined') {
  window.FocusLockModule = FocusLockModule;
  window.accessiflowTrapFocus = accessiflowTrapFocus;
}
