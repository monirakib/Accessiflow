// AccessiFlow screen reader: things the page says by itself
//
// "Added to cart". "Password must be 8 characters". A new chat message. A
// sighted user sees these appear wherever they are looking; a blind user
// hears them only if something reads them out, because nothing moved focus
// there. Pages mark such places with aria-live, or with role="alert",
// "status" or "log", and a screen reader watches them.
//
// Polite changes wait for the current sentence to finish; assertive ones
// (and alerts) cut in. Text already there when the page loaded is not read:
// a live region announces changes, not its contents.
'use strict';

(function (root) {
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

  const ROLE_POLITENESS = { alert: 'assertive', alertdialog: 'assertive', status: 'polite', log: 'polite' };

  // Ours: AccessiFlow's announcers exist for other screen readers, and what
  // they say is already spoken in our own voice.
  const OWN_ID = /^accessiflow-(announcer|shortcut-announce|sr-|kbnav-)/;

  function isOurs(node) {
    for (let n = node; n; n = n.parentNode || n.host) {
      if (n.id && OWN_ID.test(n.id)) return true;
    }
    return false;
  }

  /** The live region a node is inside, with how it wants to be read. */
  function regionOf(node) {
    for (let n = node && node.nodeType === 3 ? node.parentElement : node; n; n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null) {
      if (n.nodeType !== 1) continue;
      const live = (n.getAttribute('aria-live') || '').toLowerCase();
      const role = (n.getAttribute('role') || '').toLowerCase().split(' ')[0];
      if (live === 'off') return null;
      if (live === 'polite' || live === 'assertive' || ROLE_POLITENESS[role]) {
        const atomic = n.getAttribute('aria-atomic');
        return {
          el: n,
          politeness: live === 'polite' || live === 'assertive' ? live : ROLE_POLITENESS[role],
          // Alerts and status messages are read whole unless the page says otherwise.
          atomic: atomic === 'true' || (atomic !== 'false' && (role === 'alert' || role === 'status'))
        };
      }
    }
    return null;
  }

  function hidden(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.getAttribute('aria-hidden') === 'true' || n.hidden) return true;
    }
    try {
      if (typeof el.checkVisibility === 'function') return !el.checkVisibility();
      const style = ((el.ownerDocument && el.ownerDocument.defaultView) || root).getComputedStyle(el);
      return style.display === 'none' || style.visibility === 'hidden';
    } catch (e) { return false; }
  }

  function textOf(node) {
    if (!node) return '';
    if (node.nodeType === 3) return clean(node.data);
    if (node.nodeType !== 1) return '';
    if (node.getAttribute('aria-hidden') === 'true') return '';
    const N = root.AccessiFlowNaming;
    // A picture announced on its own is announced by its description.
    if (node.tagName === 'IMG') return clean(node.getAttribute('alt'));
    const text = typeof node.innerText === 'string' && node.isConnected ? node.innerText : node.textContent;
    return clean(text) || (N ? clean(N.accessibleName(node)) : '');
  }

  class LiveWatcher {
    /** @param announce (text, 'polite' | 'assertive') */
    constructor(announce) {
      this._announce = announce;
      this._observer = null;
      this._recent = new Map();      // text → when it was last said
      this._busy = new Set();        // regions waiting for aria-busy to clear
      this._shown = new WeakSet();   // alerts on screen, so showing one again is news
    }

    start() {
      if (this._observer || typeof MutationObserver !== 'function') return;
      // Alerts already showing when the page loaded are not news.
      Array.prototype.forEach.call(document.querySelectorAll('[role="alert"]'), a => {
        if (!hidden(a)) this._shown.add(a);
      });
      this._observer = new MutationObserver(records => this._onRecords(records));
      this._observer.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['aria-busy', 'hidden', 'style', 'class']
      });
    }

    /** A same-site frame's document: its live regions are the page's too. */
    addDocument(doc) {
      if (!this._observer || !doc || !doc.documentElement) return;
      Array.prototype.forEach.call(doc.querySelectorAll('[role="alert"]'), a => {
        if (!hidden(a)) this._shown.add(a);
      });
      this._observer.observe(doc.documentElement, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['aria-busy', 'hidden', 'style', 'class']
      });
    }

    stop() {
      if (this._observer) { this._observer.disconnect(); this._observer = null; }
      this._busy.clear();
      this._recent.clear();
    }

    _onRecords(records) {
      // Gathered first, so ten text nodes added to one region are one announcement.
      const byRegion = new Map();
      const alerts = [];

      records.forEach(r => {
        if (isOurs(r.target)) return;

        if (r.type === 'attributes') {
          if (r.attributeName === 'aria-busy' && this._busy.has(r.target) &&
              r.target.getAttribute('aria-busy') !== 'true') {
            this._busy.delete(r.target);
            const region = regionOf(r.target);
            if (region) this._say(textOf(region.el), region.politeness);
          }
          // An alert that was already in the page and has just been shown:
          // the usual way a form reports an error.
          if (r.attributeName !== 'aria-busy' && r.target.getAttribute &&
              (r.target.getAttribute('role') || '').toLowerCase() === 'alert') {
            if (hidden(r.target)) this._shown.delete(r.target);
            else if (!this._shown.has(r.target)) alerts.push(r.target);
          }
          return;
        }

        const region = regionOf(r.target);
        if (region) {
          if (!byRegion.has(region.el)) byRegion.set(region.el, { region: region, nodes: [] });
          const entry = byRegion.get(region.el);
          if (r.type === 'characterData') entry.nodes.push(r.target);
          else Array.prototype.forEach.call(r.addedNodes, n => entry.nodes.push(n));
          return;
        }

        // Not inside a live region: an alert, or a new live region carrying
        // text, can still be added whole.
        Array.prototype.forEach.call(r.addedNodes || [], n => {
          if (n.nodeType !== 1 || isOurs(n)) return;
          const own = regionOf(n);
          if (own && own.el === n && own.politeness === 'assertive') alerts.push(n);
          else if (n.querySelectorAll) {
            Array.prototype.forEach.call(n.querySelectorAll('[role="alert"]'), a => alerts.push(a));
          }
        });
      });

      byRegion.forEach(({ region, nodes }) => {
        if (region.el.getAttribute('aria-busy') === 'true') { this._busy.add(region.el); return; }
        if (hidden(region.el)) return;
        const text = region.atomic ? textOf(region.el) : clean(nodes.map(textOf).join(' '));
        this._say(text, region.politeness);
      });
      alerts.forEach(a => {
        if (hidden(a) || this._shown.has(a)) return;
        this._shown.add(a);
        this._say(textOf(a), 'assertive', true);
      });
    }

    /**
     * @param shown  an alert that went from hidden to shown: that is news
     *               every time, and already counted once by _shown.
     */
    _say(text, politeness, shown) {
      if (!text) return;
      // The same words twice in a second is one message fired twice, which
      // pages do constantly (rendering, then re-rendering).
      const now = Date.now();
      const last = this._recent.get(text);
      if (last && now - last < 1000 && !shown) return;
      this._recent.set(text, now);
      if (this._recent.size > 50) this._recent.clear();
      try { this._announce(text.slice(0, 500), politeness); } catch (e) { /* the reader went away */ }
    }
  }

  LiveWatcher.regionOf = regionOf;
  root.AccessiFlowSRLive = LiveWatcher;
})(typeof window !== 'undefined' ? window : globalThis);
