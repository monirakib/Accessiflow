// Loads popup.html + popup.js under jsdom with a stub chrome API, then asserts
// the rendered DOM is wired the way assistive technology needs it to be, and
// that a change goes where the user asked: into the setup, for every site, or
// into this site's own exceptions.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

// What was there before the panel opened: a setup for low vision and
// blindness, the built-in reader on, and a site snapshot left by AccessiFlow
// 2.x, when every site kept a full copy of every setting.
const store = {
  accessiflow_setup: { v: 1, needs: ['visual', 'blind'], ownScreenReader: false, settings: { textSize: 130, highContrast: true, keyEcho: 'letters' } },
  accessiflowScreenReader: true,
  'settings_example.com': { textSize: 100, highContrast: false, magnifier: true, screenReader: true, retiredSetting: true }
};
const spokenByPanel = [];
const sent = [];
const opened = [];
const listeners = [];
const chrome = {
  storage: { local: {
    get: (keys, cb) => {
      // null asks for everything, as in Chrome.
      const list = keys === null ? Object.keys(store) : typeof keys === 'string' ? [keys] : keys;
      const out = {};
      list.forEach(k => { if (k in store) out[k] = JSON.parse(JSON.stringify(store[k])); });
      cb(out);
    },
    set: (obj, cb) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); if (cb) cb(); },
    remove: (keys, cb) => { [].concat(keys).forEach(k => { delete store[k]; }); if (cb) cb(); }
  } },
  tabs: {
    query: (q, cb) => cb([{ id: 7, url: 'https://example.com/page' }]),
    sendMessage: (id, msg, cb) => {
      sent.push(msg.action);
      if (msg.action === 'aiCounts') return cb && cb({ success: true, images: 4, links: 2 });
      if (msg.action === 'summarizeAloud') return cb && cb({ success: true, kind: 'bullets', bullets: ['One.'] });
      if (cb) cb({ success: true });
    },
    create: opts => opened.push(opts.url)
  },
  tts: {
    speak: (text, opts) => spokenByPanel.push({ text, rate: opts && opts.rate }),
    stop: () => {}
  },
  runtime: {
    lastError: null,
    getURL: p => 'chrome-extension://test/' + p,
    sendMessage: (msg, cb) => {
      if (msg.action === 'aiHealth') return cb && cb({ available: true, reason: 'ok' });
      if (cb) cb({ success: true });
    },
    onMessage: { addListener: fn => listeners.push(fn) }
  }
};

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8'), {
  runScripts: 'outside-only', pretendToBeVisual: true, url: 'chrome-extension://test/popup.html'
});
const { window } = dom;
window.chrome = chrome;
window.close = () => {};

// The browser owns the voice list, not the schema, and hands it over late.
// A Bangla voice is included so the picker can be checked for one.
window.speechSynthesis = {
  getVoices: () => ([
    { name: 'Microsoft David - English (United States)', lang: 'en-US' },
    { name: 'Google বাংলা', lang: 'bn-BD' }
  ]),
  addEventListener() {},
  cancel() {},
  speak() {}
};

const uncaught = [];
window.addEventListener('error', e => uncaught.push(e.message));

// The same scripts, in the same order, as popup.html loads them.
const scripts = Array.from(new JSDOM(fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8'))
  .window.document.querySelectorAll('script[src]')).map(s => s.getAttribute('src'));
for (const f of scripts) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

const doc = window.document;
const $$ = s => Array.from(doc.querySelectorAll(s));
const wait = ms => new Promise(r => setTimeout(r, ms));
const change = (node, value) => {
  if (typeof value === 'boolean') node.checked = value;
  else node.value = value;
  node.dispatchEvent(new window.Event(node.type === 'range' ? 'input' : 'change', { bubbles: true }));
  if (node.type === 'range') node.dispatchEvent(new window.Event('change', { bubbles: true }));
};

(async () => {
  await wait(20);   // the setup is read asynchronously
  check(uncaught.length === 0, 'no uncaught errors' + (uncaught.length ? ': ' + uncaught.join('; ') : ''));

  // ── Structure ─────────────────────────────────────────────────────────────
  // All settings renders every declared control exactly once; Home holds a few
  // copies with their own ids. Switches written by hand in popup.html (Smart
  // help consent, the site switch) are counted apart.
  const all = doc.getElementById('allView');
  const schema = window.ACCESSIFLOW_SCHEMA;
  const declared = { switch: [], slider: [], select: [] };
  schema.sections.forEach(section => {
    section.controls.forEach(control => { declared[control.type].push(control.id); });
  });
  const inAll = sel => Array.from(all.querySelectorAll(sel)).filter(n => !n.closest('[data-panel-control]'));
  const switches = inAll('input[type="checkbox"][role="switch"]');
  const ranges = inAll('input[type="range"]');
  const selects = inAll('select');

  const panelSwitches = $$('[data-panel-control] input[role="switch"]').map(n => n.id).sort();
  check(panelSwitches.join(',') === 'aiConsent,siteOn',
    'the hand-written switches are Smart help consent and "On for this site": ' + panelSwitches.join(', '));
  check(switches.length === declared.switch.length,
    'every declared switch rendered under All settings: ' + switches.length + ' of ' + declared.switch.length);
  check(ranges.length === declared.slider.length,
    'every declared slider rendered: ' + ranges.length + ' of ' + declared.slider.length);
  check(selects.length === declared.select.length,
    'every declared select rendered: ' + selects.length + ' of ' + declared.select.length);
  check(!doc.getElementById('audienceFilter') && !doc.querySelector('.profile-btn'),
    'the needs filter and the profile grid are gone: the setup replaced them');

  const knownIds = new Set([].concat(declared.switch, declared.slider, declared.select));
  {
    // A profile that sets a key no control declares is a setting the user can
    // never see, change or turn off again.
    const orphaned = [];
    const badHome = [];
    (window.ACCESSIFLOW_PROFILES || []).forEach(profile => {
      Object.keys(profile.settings).forEach(key => {
        if (!knownIds.has(key)) orphaned.push(profile.id + '.' + key);
      });
      (profile.home || []).forEach(id => { if (!knownIds.has(id)) badHome.push(profile.id + '.' + id); });
      if (!profile.need) badHome.push(profile.id + ' has no setup wording');
    });
    (window.ACCESSIFLOW_HOME_DEFAULT || []).forEach(id => { if (!knownIds.has(id)) badHome.push('default.' + id); });
    check(orphaned.length === 0,
      'every setting a profile applies is a control the user can also see' +
      (orphaned.length ? ', orphaned: ' + orphaned.join(', ') : ''));
    check(badHome.length === 0,
      'every Home setting a need names is a real control, and every need has setup wording' +
      (badHome.length ? ': ' + badHome.join(', ') : ''));

    const dangling = [];
    schema.sections.forEach(section => {
      section.controls.forEach(control => {
        if (control.dependsOn && !knownIds.has(control.dependsOn)) {
          dangling.push(control.id + ' dependsOn ' + control.dependsOn);
        }
        (control.conflictsWith || []).forEach(other => {
          if (!knownIds.has(other)) dangling.push(control.id + ' conflictsWith ' + other);
        });
      });
    });
    check(dangling.length === 0,
      'every dependsOn and conflictsWith points at a control that exists' +
      (dangling.length ? ': ' + dangling.join(', ') : ''));

    const rendered = new Set(switches.concat(ranges).concat(selects).map(n => n.id));
    const missing = [...knownIds].filter(id => !rendered.has(id));
    check(missing.length === 0,
      'no declared control is missing from the DOM' + (missing.length ? ': ' + missing.join(', ') : ''));
  }
  {
    const picker = doc.getElementById('ttsVoice');
    const options = picker ? Array.from(picker.options).map(o => o.textContent) : [];
    check(options[0] === 'Choose automatically', 'the voice picker defaults to automatic');
    check(options.some(o => /bn-BD/.test(o)),
      'it lists the browser voices with their language: ' + options.join(' | '));
  }
  check($$('.section').length === schema.sections.length + 3,
    'sections: the schema groups plus Smart help, the page check and your setup: ' + $$('.section').length);

  // ── Every control has an accessible name and a description ────────────────
  const allControls = $$('input[type="checkbox"][role="switch"], input[type="range"], select')
    .filter(n => n.id !== 'uiScale');
  const unnamed = [], undescribed = [];
  allControls.forEach(node => {
    const label = doc.querySelector('label[for="' + node.id + '"]');
    if (!label || !label.textContent.trim()) unnamed.push(node.id);
    const d = node.getAttribute('aria-describedby');
    if (!d || !doc.getElementById(d)) undescribed.push(node.id);
  });
  check(unnamed.length === 0, 'every control, on Home too, has a <label for>: ' + (unnamed.join(', ') || 'yes'));
  check(undescribed.length === 0, 'every control has a resolvable aria-describedby: ' + (undescribed.join(', ') || 'yes'));

  const ids = $$('[id]').map(n => n.id);
  const dupes = [...new Set(ids.filter(i => ids.indexOf(i) !== ids.lastIndexOf(i)))];
  check(dupes.length === 0, 'no duplicate ids, even with Home copies: ' + (dupes.join(', ') || 'yes'));

  const badAccordion = [];
  $$('.section-toggle').forEach(t => {
    const body = doc.getElementById(t.getAttribute('aria-controls'));
    if (!body) badAccordion.push(t.textContent.trim().slice(0, 20) + ' (no panel)');
    else if (body.hidden !== (t.getAttribute('aria-expanded') === 'false')) {
      badAccordion.push(t.textContent.trim().slice(0, 20) + ' (state mismatch)');
    }
  });
  check(badAccordion.length === 0, 'aria-expanded matches hidden on all sections: ' + (badAccordion.join('; ') || 'yes'));

  // ── Home ──────────────────────────────────────────────────────────────────
  check(!doc.getElementById('homeView').hidden && all.hidden, 'the panel opens on Home');
  const homeIds = $$('#homeControls .row').map(r => r.dataset.controlId);
  check(homeIds.length > 0 && homeIds.length <= 6, 'Home shows at most six settings: ' + homeIds.join(', '));
  check(homeIds[0] === 'textSize' && homeIds[1] === 'screenReader',
    'taking the first of each chosen need in turn, low vision then blind: ' + homeIds.join(', '));
  check(/Low vision/.test(doc.getElementById('setupNeeds').textContent) &&
    /Screen reader/.test(doc.getElementById('setupNeeds').textContent),
    'the setup is named on Home: ' + doc.getElementById('setupNeeds').textContent);
  check(doc.getElementById('btnChangeSetup').getAttribute('aria-label') === 'Change my setup',
    'the short "Change" button has a full accessible name');
  check(doc.getElementById('home-textSize').value === '130' && doc.getElementById('textSize').value === '130',
    'the setup\'s text size shows on both copies of the control');
  check(doc.getElementById('siteOn').checked, 'AccessiFlow starts on for this site');

  // ── The 2.x snapshot became this site's exceptions ────────────────────────
  const site = store['settings_example.com'];
  check(site && site._v === 2 && site.magnifier === true,
    'an old site snapshot is trimmed to what differs from the defaults: ' + JSON.stringify(site));
  check(site && !('textSize' in site) && !('highContrast' in site) && !('screenReader' in site) && !('retiredSetting' in site),
    'so default values, the global reader switch and retired settings no longer pin this site');
  check(doc.getElementById('highContrast').checked === true,
    'and the setup\'s high contrast now reaches it, where the old snapshot had it off');
  const magnifierMark = doc.getElementById('magnifier').closest('.row').querySelector('.row-site');
  check(magnifierMark && !magnifierMark.hidden,
    'a value the site keeps for itself is marked "Only on this site"');

  // ── A change goes into the setup, for every site ──────────────────────────
  change(doc.getElementById('highlightLinks'), true);
  await wait(120);
  check(store.accessiflow_setup.settings.highlightLinks === true,
    'a switch changed under All settings goes into the setup');
  check(!('highlightLinks' in store['settings_example.com']), 'and not into this site');

  change(doc.getElementById('home-textSize'), '150');
  await wait(120);
  check(store.accessiflow_setup.settings.textSize === 150,
    'a Home control saves the same way: ' + store.accessiflow_setup.settings.textSize);
  check(doc.getElementById('textSize').value === '150' &&
    doc.getElementById('out-textSize').textContent === '150%',
    'and its twin under All settings follows, output and all');

  // ── Only on this site ─────────────────────────────────────────────────────
  const onlyHere = doc.querySelector('input[name="scope"][value="site"]');
  onlyHere.checked = true;
  onlyHere.dispatchEvent(new window.Event('change', { bubbles: true }));
  change(doc.getElementById('dyslexiaFont'), true);
  await wait(120);
  check(store['settings_example.com'].dyslexiaFont === true && !store.accessiflow_setup.settings.dyslexiaFont,
    'with "Only this site" chosen, the change is this site\'s exception, not the setup\'s');
  const dysMark = doc.getElementById('dyslexiaFont').closest('.row').querySelector('.row-site');
  check(!dysMark.hidden, 'and the row says so');
  dysMark.querySelector('button').click();
  await wait(20);
  check(!('dyslexiaFont' in store['settings_example.com']) && !doc.getElementById('dyslexiaFont').checked,
    '"Use my setup" removes the exception and shows the setup\'s value again');
  const everywhere = doc.querySelector('input[name="scope"][value="everywhere"]');
  everywhere.checked = true;
  everywhere.dispatchEvent(new window.Event('change', { bubbles: true }));

  // ── The built-in reader is one global key, never part of the setup ────────
  change(doc.getElementById('home-screenReader'), false);
  await wait(120);
  check(store.accessiflowScreenReader === false && !('screenReader' in store.accessiflow_setup.settings),
    'the screen reader switch writes its own global key only');
  check(doc.getElementById('screenReader').checked === false, 'and its twin follows');
  change(doc.getElementById('home-screenReader'), true);

  // ── Pausing this site ─────────────────────────────────────────────────────
  change(doc.getElementById('siteOn'), false);
  await wait(20);
  check(store['settings_example.com']._off === true, '"On for this site" off pauses only this site');
  check(!doc.getElementById('pausedNote').hidden, 'and All settings explains why changes do not show here');
  change(doc.getElementById('siteOn'), true);
  await wait(20);
  check(!store['settings_example.com']._off, 'and on again un-pauses it');

  // ── Dependent rows, steppers ──────────────────────────────────────────────
  const zoom = doc.getElementById('magnifierZoom');
  change(doc.getElementById('magnifier'), false);
  check(zoom.disabled === true, 'magnifier strength disabled while magnifier is off');
  change(doc.getElementById('magnifier'), true);
  check(zoom.disabled === false, 'magnifier strength enabled once magnifier is on');

  const ts = doc.getElementById('textSize');
  const before = ts.value;
  ts.closest('.slider-line').querySelectorAll('.step-btn')[1].click();
  check(ts.value === String(Number(before) + 5), 'plus stepper moved text size ' + before + ' -> ' + ts.value);

  // ── The big buttons ───────────────────────────────────────────────────────
  sent.length = 0;
  doc.getElementById('btnHomeSummary').click();
  doc.getElementById('btnHomeStop').click();
  doc.getElementById('btnHomeRead').click();
  check(sent.join(',') === 'summarizeAloud,ttsStop,ttsReadPage',
    'Summarise, Stop and Read reach the page: ' + sent.join(', '));
  check(/key points/.test(doc.getElementById('homeStatus').textContent) || /Reading/.test(doc.getElementById('homeStatus').textContent),
    'and the result is written where a screen reader hears it');

  // ── The panel speaks for itself while the built-in reader is on ───────────
  check(spokenByPanel.some(s => /^AccessiFlow panel\. On for example\.com/.test(s.text)),
    'with the built-in reader on, the panel introduces itself aloud: ' + (spokenByPanel[0] && spokenByPanel[0].text));
  spokenByPanel.length = 0;
  change(doc.getElementById('bigTargets'), true);
  check(spokenByPanel.some(s => /Bigger buttons and links on/.test(s.text)),
    'and says what a change did');
  spokenByPanel.length = 0;
  doc.getElementById('bigTargets').dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
  check(spokenByPanel.some(s => /^Bigger buttons and links, switch, on\. Grow everything/.test(s.text)),
    'and names what has focus, with its role, state and description: ' + (spokenByPanel[0] && spokenByPanel[0].text));

  // ── Views ─────────────────────────────────────────────────────────────────
  doc.getElementById('btnAllSettings').click();
  check(doc.getElementById('homeView').hidden && !all.hidden, '"All settings" opens the full list');
  check(doc.activeElement === doc.getElementById('allTitle'), 'with focus on its heading');
  doc.getElementById('btnBackHome').click();
  check(!doc.getElementById('homeView').hidden && all.hidden, '"Home" goes back');
  check(doc.activeElement === doc.getElementById('btnAllSettings'), 'with focus back where it was');

  doc.getElementById('btnChangeSetup').click();
  check(opened.some(u => /welcome\.html\?again=1$/.test(u)), '"Change" opens the setup page again');

  // ── Help lists every shortcut ─────────────────────────────────────────────
  doc.getElementById('btnHelp').click();
  const helpRows = $$('#dialogExtra tbody tr');
  check(helpRows.length === window.ACCESSIFLOW_SHORTCUTS.length,
    'Help lists every shortcut: ' + helpRows.length);
  check(helpRows.some(r => /Alt\+Shift\+Z/.test(r.textContent)),
    'including Alt+Shift+Z, which the old list left out');
  doc.getElementById('dialogCancel').click();
  check(doc.getElementById('dialogBackdrop').hidden && doc.getElementById('dialogExtra').hidden,
    'and closes cleanly');

  {
    // Every Alt+Shift key content.js answers, and every manifest command, is in
    // the list, so Help cannot fall behind again.
    const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
    const letters = [...new Set((content.match(/case '([A-Z])':/g) || []).map(m => m[6]))];
    const listed = window.ACCESSIFLOW_SHORTCUTS;
    const missingLetters = letters.filter(l => !listed.some(s => s.letter === l));
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const missingCommands = Object.keys(manifest.commands).filter(c => !listed.some(s => s.command === c));
    const missingDigits = ['8', '9', '1-7'].filter(d => !listed.some(s => s.digit === d));
    check(letters.length >= 10 && !missingLetters.length && !missingCommands.length && !missingDigits.length,
      'the shortcut list covers ' + letters.length + ' Alt+Shift letters, the digits and every command' +
      (missingLetters.length ? '; missing letters: ' + missingLetters.join(' ') : '') +
      (missingCommands.length ? '; missing commands: ' + missingCommands.join(' ') : '') +
      (missingDigits.length ? '; missing digits: ' + missingDigits.join(' ') : ''));
  }

  // ── Search ────────────────────────────────────────────────────────────────
  doc.getElementById('btnAllSettings').click();
  const search = doc.getElementById('settingSearch');
  const typeSearch = async text => {
    search.value = text;
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    await wait(400);   // 180ms search debounce + 60ms announce delay
  };

  await typeSearch('tremor');
  const visibleRows = $$('#sections .row').filter(r => !r.hidden);
  check(visibleRows.length > 0 && visibleRows.length < 6,
    'search "tremor" narrowed to ' + visibleRows.length + ' row(s): ' +
    visibleRows.map(r => r.dataset.controlId).join(', '));

  await typeSearch('typed keys');
  check($$('#sections .row').filter(r => !r.hidden).some(r => r.dataset.controlId === 'keyEcho'),
    '"typed keys" finds the new key echo setting');

  const aiPanel = () => doc.getElementById('section-ai');
  const aiOpen = () => aiPanel().querySelector('.section-toggle').getAttribute('aria-expanded') === 'true';
  await typeSearch('Describe the pictures');
  check(!aiPanel().hidden && aiOpen(), 'searching a button name shows and opens Smart help');
  check(doc.getElementById('section-audit').hidden, 'panels that do not match stay hidden during that search');

  await typeSearch('ai');
  {
    const rows = $$('#sections .row').filter(r => !r.hidden && !r.closest('.section').hidden);
    check(!aiPanel().hidden, '"ai" finds Smart help');
    const midWordOnly = rows.filter(r => !/\bai/.test(r.dataset.search));
    check(midWordOnly.length === 0,
      '"ai" never matches mid-word' +
      (midWordOnly.length ? ', but did on: ' + midWordOnly.map(r => r.dataset.controlId).join(', ') : ''));
    check(!rows.some(r => r.dataset.controlId === 'dictionary'),
      '"Explain hard words" is not dragged in by the "ai" inside "explain"');
  }

  await typeSearch('change my setup');
  check(!doc.getElementById('section-data').hidden, '"change my setup" finds the setup section');
  await typeSearch('turn off everything');
  check(!doc.getElementById('section-data').hidden, '"turn off everything" finds Reset everything');

  doc.getElementById('btnClearSearch').click();
  await wait(260);
  check($$('#sections .row').filter(r => r.hidden).length === 0, 'clearing search restores all rows');

  // ── CSS: `hidden` has to beat any class that sets display ─────────────────
  const css = fs.readFileSync(path.join(ROOT, 'popup.css'), 'utf8');
  check(/(^|\n)\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/.test(css),
    'popup.css forces [hidden] to display: none');

  // ── Reset everything ──────────────────────────────────────────────────────
  // Last, because it empties the setup every check above relies on.
  {
    doc.getElementById('btnBackHome').click();
    store['settings_paused.example'] = { _v: 2, _off: true };
    store.accessiflow_ui_prefs = { theme: 'dark', scale: 110 };
    const homeReset = doc.getElementById('btnHomeReset');
    const allReset = doc.getElementById('btnResetAll');
    check(homeReset && !homeReset.closest('[hidden]') && /Reset everything/.test(homeReset.textContent),
      'Home has a Reset everything button, in plain sight');
    check(allReset && allReset.closest('#body-data'), 'and All settings has one beside Forget this site\'s changes');
    check(doc.getElementById('highContrast').checked, 'high contrast is on before the reset');

    spokenByPanel.length = 0;
    homeReset.focus();            // pressed from the keyboard, as a blind user would
    homeReset.click();
    await wait(10);
    const backdrop = doc.getElementById('dialogBackdrop');
    check(!backdrop.hidden && doc.getElementById('dialogTitle').textContent === 'Reset everything?',
      'pressing it asks first');
    check(/on every website/.test(doc.getElementById('dialogBody').textContent) &&
      /The built-in screen reader stays on/.test(doc.getElementById('dialogBody').textContent),
      'saying it covers every website and that the screen reader stays on');
    check(doc.activeElement === doc.getElementById('dialogConfirm'), 'with focus on the answer');
    doc.getElementById('dialogCancel').click();
    await wait(10);
    check(store.accessiflow_setup && store['settings_paused.example'] && doc.activeElement === homeReset,
      'Cancel leaves everything as it was, and focus goes back to the button');

    homeReset.click();
    await wait(10);
    doc.getElementById('dialogConfirm').click();
    await wait(30);
    check(!('accessiflow_setup' in store) && !Object.keys(store).some(k => k.indexOf('settings_') === 0),
      'Reset everything removes the setup and every site\'s changes, the paused site too');
    check(store.accessiflowScreenReader === true && doc.getElementById('screenReader').checked,
      'the built-in screen reader stays on');
    check(store.accessiflow_ui_prefs && store.accessiflow_ui_prefs.theme === 'dark', 'and so does the popup\'s own look');
    check(!doc.getElementById('highContrast').checked && doc.getElementById('textSize').value === '100',
      'every control shows it: high contrast off, text back to 100%');
    check(doc.getElementById('siteOn').checked && doc.getElementById('setupNeeds').textContent === 'Not set up yet.',
      'Home shows the site on and no setup');
    check(spokenByPanel.some(s => /Everything is reset, on every website/.test(s.text) && /screen reader is still on/.test(s.text)),
      'and it says what it did, out loud: ' + ((spokenByPanel.find(s => /Everything is reset/.test(s.text)) || {}).text || ''));
  }

  check(uncaught.length === 0, 'still no uncaught errors' + (uncaught.length ? ': ' + uncaught.join('; ') : ''));
  finish();
})();

function finish() {
  console.log('\n=== PASS (' + ok.length + ') ===');
  ok.forEach(m => console.log('  + ' + m));
  if (errors.length) {
    console.log('\n=== FAIL (' + errors.length + ') ===');
    errors.forEach(m => console.log('  ! ' + m));
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}
