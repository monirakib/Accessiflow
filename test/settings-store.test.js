// The settings store: where a setting's value comes from (the defaults, the
// user's setup, this site's exceptions), how old per-site snapshots are
// trimmed, and how the setup page's answers become a setup.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

const store = {};
const sandbox = {
  console,
  chrome: {
    storage: { local: {
      get: (keys, cb) => {
        const out = {};
        // null asks for everything, as in Chrome.
        (keys === null ? Object.keys(store) : [].concat(keys))
          .forEach(k => { if (k in store) out[k] = JSON.parse(JSON.stringify(store[k])); });
        cb(out);
      },
      set: (obj, cb) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); if (cb) cb(); },
      remove: (keys, cb) => { [].concat(keys).forEach(k => { delete store[k]; }); if (cb) cb(); }
    } }
  }
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
['modules/profiles.js', 'popup-schema.js', 'modules/settings-store.js'].forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});
const S = sandbox.AccessiFlowSettings;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  // ── Defaults ──────────────────────────────────────────────────────────────
  const base = S.defaults();
  check(base.textSize === 100 && base.highContrast === false, 'defaults come from the schema');
  check(base.focusLock === true && base.blindMode === true, 'including the switches that start on');
  check(base.keyEcho === 'off', 'key echo starts off');
  check(!('screenReader' in base), 'the global screen reader switch is not a site setting');

  // ── Layers ────────────────────────────────────────────────────────────────
  const setup = { v: 1, needs: ['visual'], settings: { textSize: 130, highContrast: true } };
  let r = S.resolve(setup, null);
  check(r.settings.textSize === 130 && r.settings.highContrast && r.settings.focusLock === true,
    'a site with no exceptions gets the setup on top of the defaults');
  r = S.resolve(setup, { _v: 2, textSize: 160 });
  check(r.settings.textSize === 160 && r.settings.highContrast, 'a site\'s own value beats the setup, and only for that setting');
  r = S.resolve(setup, { _v: 2, _off: true, textSize: 160 });
  check(r.paused && same(r.settings, base), 'a paused site gets nothing but the defaults');
  r = S.resolve({ settings: { retired: true, screenReader: true } }, null);
  check(!('retired' in r.settings) && !('screenReader' in r.settings),
    'settings AccessiFlow no longer has, or keeps globally, never leak through');

  // ── Migration from 2.x ────────────────────────────────────────────────────
  const old = Object.assign({}, base, { textSize: 120, focusLock: false, screenReader: true, gone: 1 });
  const migrated = S.migrateSite(old);
  check(same(migrated, { _v: 2, textSize: 120, focusLock: false }),
    'an old full snapshot keeps only what differs from the defaults: ' + JSON.stringify(migrated));
  check(S.migrateSite(migrated) === migrated, 'and is left alone once trimmed');

  // ── Changes ───────────────────────────────────────────────────────────────
  let state = { setup: setup, site: { _v: 2, textSize: 160 } };
  let next = S.change(state, { textSize: 140 }, 'everywhere');
  check(next.setup.settings.textSize === 140 && !('textSize' in next.site),
    'a change for every site goes into the setup and clears this site\'s own value, so it shows here');
  check(state.setup.settings.textSize === 130, 'without touching the objects it was given');
  next = S.change(state, { magnifier: true }, 'site');
  check(next.site.magnifier === true && !next.setup.settings.magnifier, 'a change for this site stays with this site');
  next = S.forget(next, 'magnifier');
  check(!('magnifier' in next.site), '"Use my setup" forgets one exception');
  check(S.setPaused(state, true).site._off === true && !('_off' in S.setPaused(S.setPaused(state, true), false).site),
    'pausing and un-pausing');
  check(S.isException({ _v: 2, a: 1 }, 'a') && !S.isException({ _v: 2 }, 'a') && !S.isException({ _v: 2 }, '_v'),
    'exceptions are real settings, never the bookkeeping keys');

  // ── Needs ─────────────────────────────────────────────────────────────────
  const merged = S.mergeBundles(['visual', 'senior']);
  check(merged.textSize === 140 && merged.highContrast && merged.bigTargets,
    'two needs together: switches from both, the larger text size: ' + merged.textSize);
  check(S.dropConflicts({ readingMask: true, lineRuler: true }).lineRuler === false,
    'the simpler of two conflicting settings gives way (line ruler yields to the reading lens)');
  check(S.mergeBundles(['cognitive']).lineRuler === true && S.buildSetup({ needs: ['cognitive'] }).setup.settings.lineRuler === false,
    'so the reading bundle does not switch on both');

  let built = S.buildSetup({ needs: ['blind'], ownScreenReader: false, ttsRate: 1.4 });
  check(built.screenReader === true, 'blind, no screen reader of their own: the built-in reader goes on');
  check(built.setup.settings.keyEcho === 'letters', 'and keys are read as they are typed');
  check(built.setup.settings.ttsReadOnHover === false && built.setup.settings.ttsReadOnFocus === false,
    'and pointer and focus reading stay off, since the reader already reads focus');
  check(built.setup.settings.ttsRate === 1.4, 'at the chosen speed');

  built = S.buildSetup({ needs: ['blind'], ownScreenReader: true });
  check(built.screenReader === false && built.setup.ownScreenReader === true,
    'with NVDA or similar: the built-in reader stays off');
  check(built.setup.settings.keyEcho === 'off' && built.setup.settings.ttsReadOnSelect === false &&
    built.setup.settings.ttsReadOnFocus === false,
    'and nothing their own reader already says is said a second time');
  check(built.setup.settings.blindMode === true, 'while the page repairs for their reader stay on');

  built = S.buildSetup({ needs: ['visual', 'nonsense'], textSize: 170, bangla: true });
  check(same(built.setup.needs, ['visual']), 'unknown needs are dropped');
  check(built.setup.settings.textSize === 170 && built.setup.settings.banglaFont === true && built.setup.bangla,
    'the chosen text size and Bangla answer are kept');
  check(built.screenReader === false, 'the reader is not turned on for low vision alone');

  // ── Adding a need from a shortcut ─────────────────────────────────────────
  const added = S.addNeed({ v: 1, needs: ['visual'], settings: { textSize: 150, dyslexiaFont: false } }, 'blind');
  check(same(added.needs, ['visual', 'blind']), 'a shortcut adds a need rather than replacing the setup');
  check(added.settings.textSize === 150 && added.settings.blindMode === true,
    'keeping what was there and adding the bundle');
  check(same(S.addNeed(added, 'blind').needs, ['visual', 'blind']), 'adding the same need twice lists it once');

  // ── Home screen ───────────────────────────────────────────────────────────
  check(same(S.homeControls(['visual', 'blind'], 4), ['textSize', 'screenReader', 'highContrast', 'keyEcho']),
    'Home takes one setting from each need in turn');
  check(same(S.homeControls(['visual', 'senior'], 6).filter(id => id === 'textSize'), ['textSize']),
    'without repeating one two needs share');
  check(S.homeControls([], 6).length > 0, 'and shows a sensible default before any setup');

  // ── Storage ───────────────────────────────────────────────────────────────
  store['settings_old.example'] = old;
  const loaded = await S.load('old.example');
  check(same(loaded.site, migrated), 'loading trims an old snapshot');
  check(store['settings_old.example']._v === 2, 'and writes the trimmed version back, once');
  await S.save('old.example', { setup: setup, site: { _v: 2, textSize: 110 } });
  check(store.accessiflow_setup.settings.textSize === 130 && store['settings_old.example'].textSize === 110,
    'saving writes the setup and the site under their own keys');

  // ── Reset everything ──────────────────────────────────────────────────────
  store['settings_paused.example'] = { _v: 2, _off: true };
  store.accessiflowScreenReader = true;
  store.accessiflow_ui_prefs = { theme: 'dark', scale: 120 };
  store.accessiflow_ai_consent = true;
  const removed = await S.reset();
  check(!('accessiflow_setup' in store) && !Object.keys(store).some(k => k.indexOf('settings_') === 0),
    'reset removes the setup and every site\'s own changes, pauses included: ' + removed + ' keys');
  check(store.accessiflowScreenReader === true,
    'but leaves the built-in screen reader on, so a blind user is not left in silence');
  check(store.accessiflow_ui_prefs.theme === 'dark' && store.accessiflow_ai_consent === true,
    'and the popup\'s own look and the AI consent, which change no website');
  const after = S.resolve(null, null).settings;
  check(same(after, S.defaults()), 'after which every site gets the settings a new install starts with');
  check(await S.reset() === 0, 'and a second reset has nothing left to remove');
  check(same(S.resetKeys(['accessiflow_setup', 'settings_a.org', 'accessiflowScreenReader', 'voicePanelSound']),
    ['accessiflow_setup', 'settings_a.org']), 'resetKeys picks only the setup and the site keys');

  console.log('\n=== PASS (' + ok.length + ') ===');
  ok.forEach(m => console.log('  + ' + m));
  if (errors.length) {
    console.log('\n=== FAIL (' + errors.length + ') ===');
    errors.forEach(m => console.log('  ! ' + m));
    process.exit(1);
  }
  console.log('\nAll checks passed.');
})();
