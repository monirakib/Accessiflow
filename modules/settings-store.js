// AccessiFlow settings store
//
// Where a setting's value comes from, in one place, for the page, the popup
// and the setup page alike. Three layers, later ones winning:
//
//   1. the schema defaults (popup-schema.js)
//   2. "my setup": what the user chose once, applied on every website
//   3. this site's exceptions: only what the user changed for this one site
//
// Before this, every website kept a full copy of every setting, so choices
// made on one site never reached the next, and a blind user had to set
// AccessiFlow up again on each new website before it could read anything.
//
// Everything here except load/save is a pure function of its arguments, so it
// can be tested without a browser.
'use strict';

(function (root) {
  const SETUP_KEY = 'accessiflow_setup';
  const SITE_PREFIX = 'settings_';
  const READER_KEY = 'accessiflowScreenReader';
  // Site entries written by this version carry `_v: 2`. Anything older is a
  // full snapshot from the per-site days, and is trimmed on first read.
  const SITE_VERSION = 2;

  function schema() {
    return root.ACCESSIFLOW_SCHEMA || { sections: [] };
  }

  function controls() {
    const out = [];
    (schema().sections || []).forEach(section => {
      (section.controls || []).forEach(control => out.push(control));
    });
    return out;
  }

  function controlById(id) {
    return controls().find(control => control.id === id) || null;
  }

  /** The value of every setting before anyone has chosen anything. */
  function defaults() {
    const out = {};
    controls().forEach(control => {
      // The screen reader has its own global key; it is not a site setting.
      if (control.global) return;
      if (control.type === 'switch') out[control.id] = Boolean(control.defaultOn);
      else out[control.id] = control.default;
    });
    return out;
  }

  function siteKey(host) {
    return SITE_PREFIX + (host || '');
  }

  /** Only real settings, never the bookkeeping keys that start with "_". */
  function settingsOnly(obj, known) {
    const out = {};
    Object.keys(obj || {}).forEach(key => {
      if (key.charAt(0) === '_') return;
      if (known && !(key in known)) return;
      out[key] = obj[key];
    });
    return out;
  }

  /**
   * An old full snapshot becomes this site's exceptions: whatever differs from
   * the defaults. A site the user adjusted keeps its adjustments, and every
   * value they never touched starts following their setup.
   */
  function migrateSite(site, base) {
    if (!site || typeof site !== 'object') return null;
    if (site._v === SITE_VERSION) return site;
    base = base || defaults();
    const out = { _v: SITE_VERSION };
    Object.keys(site).forEach(key => {
      if (!(key in base)) return;          // global, retired, or not a setting
      if (site[key] !== base[key]) out[key] = site[key];
    });
    return out;
  }

  /**
   * What applies on a site. `paused` means the user turned AccessiFlow off
   * for this site: the page is left exactly as the site made it.
   */
  function resolve(setup, site, base) {
    base = base || defaults();
    const here = migrateSite(site, base) || {};
    if (here._off) return { settings: Object.assign({}, base), paused: true };
    const mine = settingsOnly(setup && setup.settings, base);
    return {
      settings: Object.assign({}, base, mine, settingsOnly(here, base)),
      paused: false
    };
  }

  /** Whether this site has its own value for a setting. */
  function isException(site, id) {
    return Boolean(site) && Object.prototype.hasOwnProperty.call(site, id) && id.charAt(0) !== '_';
  }

  function emptySetup() {
    return { v: 1, needs: [], ownScreenReader: false, settings: {} };
  }

  function emptySite() {
    return { _v: SITE_VERSION };
  }

  /**
   * A change made in the popup. "everywhere" goes into the setup and clears
   * this site's own value for it, so the change is visible here as well;
   * "site" is an exception for this site only. Returns new objects.
   */
  function change(state, changes, scope) {
    const setup = Object.assign(emptySetup(), state.setup || {});
    setup.settings = Object.assign({}, setup.settings || {});
    const site = Object.assign(emptySite(), state.site || {});
    Object.keys(changes).forEach(id => {
      if (scope === 'site') {
        site[id] = changes[id];
      } else {
        setup.settings[id] = changes[id];
        delete site[id];
      }
    });
    return { setup: setup, site: site };
  }

  /** "Use my setup" for one setting on this site. */
  function forget(state, id) {
    const site = Object.assign(emptySite(), state.site || {});
    delete site[id];
    return { setup: state.setup, site: site };
  }

  function setPaused(state, paused) {
    const site = Object.assign(emptySite(), state.site || {});
    if (paused) site._off = true;
    else delete site._off;
    return { setup: state.setup, site: site };
  }

  // ── Needs and bundles ────────────────────────────────────────────────────

  function profiles() {
    return root.ACCESSIFLOW_PROFILES || [];
  }

  /**
   * Several needs at once. Switches on in any bundle stay on, sliders take
   * the largest value, and a choice list keeps the first bundle's choice.
   */
  function mergeBundles(needIds) {
    const out = {};
    needIds.forEach(id => {
      const profile = profiles().find(p => p.id === id);
      if (!profile) return;
      Object.keys(profile.settings).forEach(key => {
        const value = profile.settings[key];
        if (!(key in out)) { out[key] = value; return; }
        if (typeof value === 'boolean') out[key] = out[key] || value;
        else if (typeof value === 'number') out[key] = Math.max(out[key], value);
      });
    });
    return out;
  }

  /**
   * Two settings that fight: the one that declares the conflict gives way,
   * because it is always the simpler of the two (the plain outline yields to
   * the focus halo, the line ruler to the reading lens).
   */
  function dropConflicts(settings) {
    const out = Object.assign({}, settings);
    controls().forEach(control => {
      if (!control.conflictsWith || !out[control.id]) return;
      if (control.conflictsWith.some(other => out[other])) out[control.id] = false;
    });
    return out;
  }

  /**
   * The answers from the setup page, turned into a setup.
   *
   * answers: { needs, ownScreenReader, textSize, ttsRate, bangla }
   * Returns { setup, screenReader }, the second being whether AccessiFlow's
   * own screen reader should be on.
   */
  function buildSetup(answers) {
    const a = answers || {};
    const needs = (a.needs || []).filter(id => profiles().some(p => p.id === id));
    const blind = needs.indexOf('blind') !== -1;
    const settings = mergeBundles(needs);

    if (blind) {
      // Reading what the mouse points at is no help without sight, and it
      // talks over everything else when the mouse is knocked.
      settings.ttsReadOnHover = false;
      if (a.ownScreenReader) {
        // Their own screen reader already echoes keys, reads focus and reads
        // selections. Doing it again means every key is spoken twice.
        settings.keyEcho = 'off';
        settings.ttsReadOnFocus = false;
        settings.ttsReadOnSelect = false;
      } else {
        // The built-in reader reads focus itself.
        settings.keyEcho = 'letters';
        settings.ttsReadOnFocus = false;
      }
    }
    if (typeof a.textSize === 'number') settings.textSize = a.textSize;
    if (typeof a.ttsRate === 'number') settings.ttsRate = a.ttsRate;
    if (a.bangla) settings.banglaFont = true;

    return {
      setup: {
        v: 1,
        needs: needs,
        ownScreenReader: Boolean(blind && a.ownScreenReader),
        bangla: Boolean(a.bangla),
        settings: dropConflicts(settings)
      },
      screenReader: blind && !a.ownScreenReader
    };
  }

  /**
   * One more need, added from a keyboard shortcut. Adds to the setup rather
   * than replacing it: one keypress must never undo a setup someone spent
   * time on.
   */
  function addNeed(setup, needId) {
    const current = Object.assign(emptySetup(), setup || {});
    const needs = current.needs.indexOf(needId) === -1 ? current.needs.concat(needId) : current.needs;
    const bundle = mergeBundles([needId]);
    return Object.assign({}, current, {
      needs: needs,
      settings: dropConflicts(Object.assign({}, current.settings, bundle))
    });
  }

  /**
   * The settings shown on the popup's home screen for these needs: the first
   * from each need, then the second from each, so every need is represented
   * before any gets a second row.
   */
  function homeControls(needIds, limit) {
    const lists = needIds.map(id => {
      const profile = profiles().find(p => p.id === id);
      return (profile && profile.home) || [];
    }).filter(list => list.length);
    if (!lists.length) lists.push(root.ACCESSIFLOW_HOME_DEFAULT || []);
    const out = [];
    for (let i = 0; out.length < limit; i++) {
      let any = false;
      lists.forEach(list => {
        if (i >= list.length) return;
        any = true;
        if (out.length < limit && out.indexOf(list[i]) === -1) out.push(list[i]);
      });
      if (!any) break;
    }
    return out;
  }

  // ── Storage ──────────────────────────────────────────────────────────────

  /**
   * Reads the setup and this site's exceptions. An old site snapshot is
   * trimmed and written back, once.
   */
  function load(host) {
    return new Promise(resolveLoad => {
      const key = siteKey(host);
      chrome.storage.local.get([SETUP_KEY, key, READER_KEY], data => {
        const raw = data && data[key];
        const site = migrateSite(raw);
        if (raw && raw._v !== SITE_VERSION && site) {
          try { chrome.storage.local.set({ [key]: site }); } catch (e) { /* next time */ }
        }
        resolveLoad({
          setup: (data && data[SETUP_KEY]) || null,
          site: site,
          reader: Boolean(data && data[READER_KEY])
        });
      });
    });
  }

  function save(host, state) {
    const out = {};
    if (state.setup) out[SETUP_KEY] = state.setup;
    if (host && state.site) out[siteKey(host)] = state.site;
    return new Promise(done => chrome.storage.local.set(out, () => done()));
  }

  root.AccessiFlowSettings = {
    SETUP_KEY: SETUP_KEY,
    READER_KEY: READER_KEY,
    SITE_VERSION: SITE_VERSION,
    siteKey: siteKey,
    controls: controls,
    controlById: controlById,
    defaults: defaults,
    migrateSite: migrateSite,
    resolve: resolve,
    isException: isException,
    change: change,
    forget: forget,
    setPaused: setPaused,
    mergeBundles: mergeBundles,
    dropConflicts: dropConflicts,
    buildSetup: buildSetup,
    addNeed: addNeed,
    homeControls: homeControls,
    load: load,
    save: save
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
