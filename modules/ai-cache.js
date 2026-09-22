// AccessiFlow AI cache and budget
//
// Loaded by the service worker (importScripts), which is the only place AI
// calls are made, so one cache serves every tab. The logic takes a storage
// adapter instead of calling chrome.storage directly, which keeps it testable
// under plain node.
//
// Two jobs:
//
//   * Remember answers. Alt text for a picture and a name for a button do not
//     change between visits, so the second visit to a page should cost
//     nothing and wait for nothing.
//   * Ration automatic calls. Healing runs without a button press, and
//     without a ceiling it would spend a user's whole hourly allowance on the
//     first busy page they opened.
'use strict';

(function (root) {

  // Query parameters that change on every deploy or request without changing
  // the picture. Stripping only these, rather than the whole query string, is
  // deliberate: plenty of sites serve different images from one path with
  // `?id=`, and dropping that would hand one picture's description to another.
  const CACHE_BUSTERS = ['v', 'ver', 'version', 'cb', 't', 'ts', 'timestamp', '_',
    'cache', 'cachebust', 'rev', 'nocache', 'bust', 'dt'];

  /**
   * An image URL with its cache-busting noise removed, so the same picture
   * redeployed with a new `?v=` still matches its remembered description.
   */
  function normalizeSrc(url) {
    try {
      const u = new URL(url);
      u.hash = '';
      CACHE_BUSTERS.forEach(name => u.searchParams.delete(name));
      u.searchParams.sort();
      return u.toString();
    } catch (e) {
      return String(url || '');
    }
  }

  /**
   * FNV-1a over UTF-16 code units, as a 13-character base-36 string.
   *
   * Keys are hashed so the cache does not keep a readable list of every page
   * the user has visited. It does not need to be cryptographic: nothing is
   * being protected from an attacker who already has the profile, and 53 bits
   * leaves collisions vanishingly unlikely across 2,000 entries.
   */
  function hash(text) {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
    }
    return ((h2 & 0x1fffff) * 4294967296 + h1).toString(36);
  }

  /** @param {string} kind e.g. 'alt', 'control', 'link', 'form', 'simplify' */
  function makeKey(kind, origin, signature) {
    return kind + ':' + hash(String(origin || '') + '|' + String(signature || ''));
  }

  // ── The cache ─────────────────────────────────────────────────────────────

  /**
   * @param {{get(key):Promise<any>, set(key, value):Promise<void>}} store
   * @param {{maxEntries:number, ttlDays:number, storageKey:string, now?:function}} opts
   */
  function AICache(store, opts) {
    this.store = store;
    this.max = opts.maxEntries || 2000;
    this.ttl = (opts.ttlDays || 30) * 86400000;
    this.storageKey = opts.storageKey;
    this.now = opts.now || (() => Date.now());
    this._entries = null;    // loaded once, then kept in memory
    this._loading = null;
    this._saveTimer = null;
  }

  AICache.prototype._load = function () {
    if (this._entries) return Promise.resolve(this._entries);
    if (this._loading) return this._loading;
    this._loading = this.store.get(this.storageKey).then(saved => {
      this._entries = (saved && typeof saved === 'object') ? saved : {};
      this._loading = null;
      return this._entries;
    });
    return this._loading;
  };

  /** The remembered text, or null. A hit refreshes its place in the LRU order. */
  AICache.prototype.get = function (key) {
    return this._load().then(entries => {
      const entry = entries[key];
      if (!entry) return null;
      if (this.now() - entry.ts > this.ttl) {
        delete entries[key];
        this._scheduleSave();
        return null;
      }
      entry.used = this.now();
      this._scheduleSave();
      return entry.t;
    });
  };

  AICache.prototype.set = function (key, text) {
    // An empty answer is not remembered. The model saying "unknown" today
    // should not stop a better answer being fetched on a later visit.
    if (!text) return Promise.resolve();
    return this._load().then(entries => {
      const now = this.now();
      entries[key] = { t: String(text), ts: now, used: now };
      this._trim();
      this._scheduleSave();
    });
  };

  /** Drops expired entries, then the least recently used, down to the limit. */
  AICache.prototype._trim = function () {
    const entries = this._entries;
    const now = this.now();
    Object.keys(entries).forEach(k => {
      if (now - entries[k].ts > this.ttl) delete entries[k];
    });
    const keys = Object.keys(entries);
    if (keys.length <= this.max) return;
    keys.sort((a, b) => entries[a].used - entries[b].used);
    for (let i = 0; i < keys.length - this.max; i++) delete entries[keys[i]];
  };

  /**
   * Writes are coalesced. A page of fifteen control names would otherwise
   * rewrite the whole cache in storage fifteen times in a second.
   */
  AICache.prototype._scheduleSave = function () {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.store.set(this.storageKey, this._entries);
    }, 250);
  };

  AICache.prototype.flush = function () {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    return this._entries ? this.store.set(this.storageKey, this._entries) : Promise.resolve();
  };

  AICache.prototype.size = function () {
    return this._load().then(entries => Object.keys(entries).length);
  };

  AICache.prototype.clear = function () {
    this._entries = {};
    return this.flush();
  };

  // ── The budget ────────────────────────────────────────────────────────────

  /**
   * Fixed hourly window. Persisted, because a service worker is stopped and
   * restarted freely by Chrome, and an in-memory counter would reset every
   * time it woke up.
   */
  function AIBudget(store, opts) {
    this.store = store;
    this.perHour = opts.perHour || 40;
    this.storageKey = opts.storageKey;
    this.now = opts.now || (() => Date.now());
  }

  AIBudget.prototype._hour = function () { return Math.floor(this.now() / 3600000); };

  /** Resolves true and spends one call if any are left this hour. */
  AIBudget.prototype.take = function () {
    const hour = this._hour();
    return this.store.get(this.storageKey).then(saved => {
      const state = (saved && saved.hour === hour) ? saved : { hour: hour, n: 0 };
      if (state.n >= this.perHour) return false;
      state.n++;
      return this.store.set(this.storageKey, state).then(() => true);
    });
  };

  AIBudget.prototype.remaining = function () {
    const hour = this._hour();
    return this.store.get(this.storageKey).then(saved => {
      const used = (saved && saved.hour === hour) ? saved.n : 0;
      return Math.max(0, this.perHour - used);
    });
  };

  root.ACCESSIFLOW_AI_CACHE = {
    normalizeSrc: normalizeSrc,
    hash: hash,
    makeKey: makeKey,
    AICache: AICache,
    AIBudget: AIBudget
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = root.ACCESSIFLOW_AI_CACHE;
})(typeof globalThis !== 'undefined' ? globalThis : self);
