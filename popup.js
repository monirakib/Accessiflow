// AccessiFlow popup
//
// Two screens. Home is what most people open the panel for: whether
// AccessiFlow is on for this site, what their setup is, four big buttons
// (read, stop, summarise, describe the pictures), the few settings that
// matter for the needs they chose, and Reset everything. "All settings"
// holds everything else, with search, exactly as before.
//
// Every control is rendered from popup-schema.js, so a setting's label, help
// text and search terms are defined in exactly one place. Nothing here builds
// markup from strings: each row is assembled with DOM calls, which keeps the
// ARIA wiring identical for all the controls and keeps us inside the
// extension content security policy.
//
// Where a change goes is decided by modules/settings-store.js: into the
// setup, for every website, unless "Only this site" is chosen. The popup only
// writes to storage; every open page follows the change by itself.
'use strict';

(function () {
  const SCHEMA = window.ACCESSIFLOW_SCHEMA;
  const Store = window.AccessiFlowSettings;
  const Voice = window.AccessiFlowUiVoice;
  const PROFILES = window.ACCESSIFLOW_PROFILES || [];
  const SHORTCUTS = window.ACCESSIFLOW_SHORTCUTS || [];

  const $ = sel => document.querySelector(sel);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  // ── State ───────────────────────────────────────────────────────────────

  let currentTabId = null;
  let currentHostname = '';
  // The setup and this site's exceptions, as stored; and what they add up to
  // here, which is what the controls show.
  let state = { setup: null, site: null };
  let settings = {};
  // Where the next change goes: 'everywhere' (the setup) or 'site'. Back to
  // 'everywhere' every time the panel opens.
  let scope = 'everywhere';

  // Switches that apply to every website at once, in a storage key of their
  // own, never in the setup, so no preset can switch them off by accident.
  const GLOBAL_KEYS = { screenReader: Store.READER_KEY };
  const globals = {};
  let pageReachable = true;

  // Flattened views of the schema, built once at render time.
  const CONTROLS = new Map();   // id -> control definition
  SCHEMA.sections.forEach(section => {
    section.controls.forEach(control => CONTROLS.set(control.id, control));
  });

  // Rows on the Home screen are copies of rows under All settings. Their ids
  // carry this prefix so each id stays unique on the page.
  const HOME_PREFIX = 'home-';
  const HOME_LIMIT = 6;

  const UI_PREFS_KEY = 'accessiflow_ui_prefs';

  // ── Announcements ───────────────────────────────────────────────────────
  // One polite live region for the whole popup. Several competing live regions
  // make a screen reader talk over itself, so everything funnels through here.
  // With AccessiFlow's own screen reader on, it is also spoken aloud, by that
  // reader, which leaves live regions to this function here rather than
  // read each message twice.

  let announceTimer = null;
  function announce(message, opts) {
    const region = $('#liveStatus');
    if (region) {
      // Re-setting identical text does not re-announce, so clear first.
      region.textContent = '';
      clearTimeout(announceTimer);
      announceTimer = setTimeout(() => { region.textContent = message; }, 60);
    }
    // `silent` when the page is about to speak: the panel's voice and the
    // page's share one speech engine, and would cut each other off.
    if (!(opts && opts.silent)) Voice.say(message);
  }

  // ── Appearance of the popup itself ──────────────────────────────────────

  function applyUiPrefs(prefs) {
    const theme = prefs.theme || 'auto';
    const scale = prefs.scale || 100;

    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.setProperty('--ui-scale', String(scale / 100));

    const radio = document.querySelector('input[name="uiTheme"][value="' + theme + '"]');
    if (radio) radio.checked = true;

    const slider = $('#uiScale');
    if (slider) {
      slider.value = scale;
      $('#out-uiScale').textContent = scale + '%';
    }

    const labels = {
      auto: 'match my device', light: 'light', dark: 'dark', contrast: 'high contrast'
    };
    $('#themeStateLabel').textContent = labels[theme] || theme;
  }

  function saveUiPrefs() {
    const checked = document.querySelector('input[name="uiTheme"]:checked');
    const prefs = {
      theme: checked ? checked.value : 'auto',
      scale: parseInt($('#uiScale').value, 10) || 100
    };
    chrome.storage.local.set({ [UI_PREFS_KEY]: prefs });
    applyUiPrefs(prefs);
    return prefs;
  }

  function initAppearance() {
    const button = $('#btnTheme');
    const menu = $('#themeMenu');

    const close = () => {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    };

    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') === 'true';
      menu.hidden = open;
      button.setAttribute('aria-expanded', String(!open));
      if (!open) {
        const first = menu.querySelector('input[name="uiTheme"]:checked') ||
                      menu.querySelector('input[name="uiTheme"]');
        if (first) first.focus();
      }
    });

    document.querySelectorAll('input[name="uiTheme"]').forEach(radio => {
      radio.addEventListener('change', () => {
        saveUiPrefs();
        announce('Appearance set to ' + $('#themeStateLabel').textContent + '.');
      });
    });

    const scale = $('#uiScale');
    scale.addEventListener('input', () => {
      $('#out-uiScale').textContent = scale.value + '%';
      saveUiPrefs();
    });

    // The stepper buttons beside the scale slider, authored in popup.html.
    document.querySelectorAll('.step-btn[data-target="uiScale"]').forEach(stepper => {
      stepper.addEventListener('click', () => {
        const step = (parseInt(scale.step, 10) || 5) * (stepper.dataset.step === 'up' ? 1 : -1);
        const next = (parseInt(scale.value, 10) || 100) + step;
        scale.value = Math.min(parseInt(scale.max, 10), Math.max(parseInt(scale.min, 10), next));
        scale.dispatchEvent(new Event('input', { bubbles: true }));
        announce('Panel size ' + scale.value + ' per cent.');
      });
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !menu.hidden) {
        close();
        button.focus();
      }
    });

    document.addEventListener('click', e => {
      if (menu.hidden) return;
      if (!menu.contains(e.target) && !button.contains(e.target)) close();
    });

    chrome.storage.local.get(UI_PREFS_KEY, data => {
      applyUiPrefs(data[UI_PREFS_KEY] || {});
    });
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  function iconSvg(name, className) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon ' + (className || ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function searchTerms(control) {
    return searchText([control.label, control.desc, control.keywords || ''].join(' '));
  }

  // Search matches from the start of a word, so "ai" finds AI rather than
  // the middle of "explain" and "again". Text is stored padded with spaces,
  // which makes a word start simply " " + word. Marks (\p{M}) count as part
  // of a word because Bangla vowel signs are marks.

  function searchWords(text) {
    return String(text).toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  }

  function searchText(text) {
    return ' ' + searchWords(text).join(' ') + ' ';
  }

  function matchesAll(haystack, words) {
    return words.every(word => haystack.includes(' ' + word));
  }

  /**
   * The WCAG criterion a setting helps meet. Shown, but hidden from screen
   * readers: it is noise to someone who just wants bigger text.
   */
  function wcagTag(control) {
    const tag = el('span', 'row-wcag', 'WCAG ' + control.wcag);
    tag.setAttribute('aria-hidden', 'true');
    return tag;
  }

  /** Switch row: label + description + a real checkbox with role="switch". */
  function renderSwitch(control, prefix) {
    const row = el('div', 'row');
    const id = prefix + control.id;
    const descId = 'desc-' + id;

    // The whole top line is the label, so the entire width is a hit target,
    // a 44px-tall strip instead of a 30px toggle.
    const main = el('label', 'row-main');
    main.setAttribute('for', id);
    main.appendChild(el('span', 'row-label', control.label));

    const input = el('input', 'switch');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.id = id;
    input.setAttribute('aria-describedby', descId);
    main.appendChild(input);

    const desc = el('p', 'row-desc', control.desc);
    desc.id = descId;
    if (control.wcag) desc.appendChild(wcagTag(control));

    row.append(main, desc);

    // Filled in by refreshDependants when another setting overrides this one.
    // It lives inside the description so a screen reader picks it up as part
    // of the switch's own explanation rather than as loose text after it.
    if (control.conflictsWith) {
      const conflict = el('span', 'row-conflict');
      conflict.hidden = true;
      desc.appendChild(conflict);
    }

    input.addEventListener('change', () => {
      setValue(control.id, input.checked);
      if (GLOBAL_KEYS[control.id]) {
        announce(control.label + ' ' + (input.checked ? 'on, for every website' : 'off') + '.');
      } else {
        announce(control.label + ' ' + (input.checked ? 'on' : 'off') + whereSaid() + '.');
      }
    });

    return row;
  }

  /** Slider row: stepper buttons either side, because dragging is not universal. */
  function renderSlider(control, prefix) {
    const row = el('div', 'row control-row--slider');
    const id = prefix + control.id;
    const descId = 'desc-' + id;

    const label = el('label', null, control.label);
    label.setAttribute('for', id);

    const line = el('div', 'slider-line');

    const input = el('input');
    input.type = 'range';
    input.id = id;
    input.min = control.min;
    input.max = control.max;
    input.step = control.step;
    input.value = control.default;
    input.setAttribute('aria-describedby', descId);

    const out = el('output', null, control.default + control.suffix);
    out.id = 'out-' + id;
    out.setAttribute('for', id);

    const minus = stepButton('−', 'Less ' + control.label.toLowerCase(), input, -1, out, control);
    const plus = stepButton('+', 'More ' + control.label.toLowerCase(), input, 1, out, control);

    line.append(minus, input, plus, out);

    const desc = el('p', 'row-desc', control.desc);
    desc.id = descId;
    if (control.wcag) desc.appendChild(wcagTag(control));

    row.append(label, line, desc);

    input.addEventListener('input', () => {
      const value = roundStep(parseFloat(input.value), control.step);
      out.textContent = value + control.suffix;
      syncStepButtons(input, minus, plus);
      setValue(control.id, value);
    });
    // A keyboard or stepper change is worth announcing; a drag is not, or the
    // screen reader never stops talking.
    input.addEventListener('change', () => {
      announce(control.label + ': ' + out.textContent + whereSaid() + '.');
    });

    return row;
  }

  function stepButton(glyph, accessibleName, input, direction, out, control) {
    const button = el('button', 'step-btn');
    button.type = 'button';
    button.appendChild(el('span', null, glyph)).setAttribute('aria-hidden', 'true');
    button.appendChild(el('span', 'sr-only', accessibleName));
    button.addEventListener('click', () => {
      const step = parseFloat(input.step) || 1;
      const next = roundStep(parseFloat(input.value) + step * direction, step);
      input.value = Math.min(parseFloat(input.max), Math.max(parseFloat(input.min), next));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      announce(control.label + ': ' + out.textContent + '.');
    });
    return button;
  }

  /** Avoids 1.7000000000000002 showing up in the output. */
  function roundStep(value, step) {
    const decimals = (String(step).split('.')[1] || '').length;
    return parseFloat(value.toFixed(decimals));
  }

  function syncStepButtons(input, minus, plus) {
    const value = parseFloat(input.value);
    minus.disabled = value <= parseFloat(input.min);
    plus.disabled = value >= parseFloat(input.max);
  }

  function fillVoices(select, control) {
    const synth = window.speechSynthesis;
    if (!synth) return;

    const fill = () => {
      const chosen = settings[control.id] || select.value || '';
      const voices = synth.getVoices() || [];

      while (select.options.length > 1) select.remove(1);
      voices.forEach(voice => {
        const option = el('option', null, voice.name + ' (' + voice.lang + ')');
        option.value = voice.name;
        select.appendChild(option);
      });

      // A voice saved on another computer may not exist on this one; leaving
      // the select on Automatic is the honest answer.
      select.value = Array.from(select.options).some(o => o.value === chosen) ? chosen : '';
    };

    fill();
    try { synth.addEventListener('voiceschanged', fill); }
    catch (e) { synth.onvoiceschanged = fill; }
  }

  function renderSelect(control, prefix) {
    const row = el('div', 'row control-row--select');
    const id = prefix + control.id;
    const descId = 'desc-' + id;

    const label = el('label', null, control.label);
    label.setAttribute('for', id);

    const select = el('select');
    select.id = id;
    select.setAttribute('aria-describedby', descId);
    control.options.forEach(option => {
      const node = el('option', null, option.label);
      node.value = option.value;
      select.appendChild(node);
    });
    select.value = control.default;

    // A voice list has to come from the browser, not the schema. It also
    // arrives late: getVoices() is empty until Chrome has built it, so this
    // fills in again when it changes. Seeing the list is the only way a user
    // can tell whether their browser has a voice for their language at all.
    if (control.voices) fillVoices(select, control);

    const desc = el('p', 'row-desc', control.desc);
    desc.id = descId;
    if (control.wcag) desc.appendChild(wcagTag(control));

    row.append(label, select, desc);

    select.addEventListener('change', () => {
      setValue(control.id, select.value);
      announce(control.label + ': ' + select.options[select.selectedIndex].text + whereSaid() + '.');
    });

    return row;
  }

  /**
   * One setting's row, for All settings (prefix '') or Home. A row whose
   * value is this site's own, not the setup's, says so and offers the way back.
   */
  function renderRow(control, prefix) {
    const row = control.type === 'switch' ? renderSwitch(control, prefix)
              : control.type === 'slider' ? renderSlider(control, prefix)
              : renderSelect(control, prefix);
    row.dataset.controlId = control.id;
    if (control.dependsOn) row.dataset.dependsOn = control.dependsOn;
    if (control.conflictsWith) row.dataset.conflictsWith = control.conflictsWith.join(' ');

    if (!control.global) {
      const mark = el('p', 'row-site');
      mark.hidden = true;
      mark.appendChild(el('span', null, 'Only on this site. '));
      const back = el('button', 'link-btn', 'Use my setup');
      back.type = 'button';
      back.setAttribute('aria-label', 'Use my setup for ' + control.label);
      back.addEventListener('click', () => forgetHere(control.id));
      mark.appendChild(back);
      row.appendChild(mark);
    }
    return row;
  }

  function renderSection(section) {
    const wrapper = el('section', 'section');
    wrapper.id = 'section-' + section.id;
    wrapper.dataset.sectionId = section.id;

    const bodyId = 'body-' + section.id;
    const heading = el('h2', 'section-heading');
    const toggle = el('button', 'section-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', bodyId);

    const title = el('span', 'section-title');
    title.appendChild(el('span', 'section-label', section.label));
    title.appendChild(el('span', 'section-desc', section.desc));

    toggle.append(iconSvg(section.icon, 'section-icon'), title, iconSvg('chevron', 'chevron'));
    heading.appendChild(toggle);

    const body = el('div', 'section-body');
    body.id = bodyId;
    body.hidden = true;

    section.controls.forEach(control => {
      const row = renderRow(control, '');
      // The group name counts too, so "Hearing" or "বাংলা" lists that whole group.
      row.dataset.search = searchTerms(control) + searchText(section.label);
      body.appendChild(row);
    });

    if (section.actions) {
      const actions = el('div', 'section-actions');
      section.actions.forEach(action => {
        const button = el('button', 'btn btn-full ' +
          (action.style === 'primary' ? 'btn-primary' : 'btn-quiet'), action.label);
        button.type = 'button';
        button.id = action.id;
        // Searchable like a setting, so "voice" finds the voice control button.
        button.dataset.search = searchText(action.label + ' ' + (action.keywords || '')) + searchText(section.label);
        actions.appendChild(button);
      });
      body.appendChild(actions);
    }

    wrapper.append(heading, body);
    return wrapper;
  }

  function renderAll() {
    const host = $('#sections');
    SCHEMA.sections.forEach(section => host.appendChild(renderSection(section)));

    // Static panels are authored in popup.html; give them the same toggles.
    document.querySelectorAll('.section-toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        setSectionOpen(toggle, !expanded);
      });
    });
  }

  function setSectionOpen(toggle, open) {
    toggle.setAttribute('aria-expanded', String(open));
    const body = document.getElementById(toggle.getAttribute('aria-controls'));
    if (body) body.hidden = !open;
    const section = toggle.closest('.section');
    if (section) section.classList.toggle('section--open', open);
  }

  // ── Home ────────────────────────────────────────────────────────────────

  function needsOf(setup) {
    return (setup && setup.needs) || [];
  }

  /** The settings for the chosen needs, as rows on the Home screen. */
  function renderHome() {
    const host = $('#homeControls');
    host.textContent = '';
    Store.homeControls(needsOf(state.setup), HOME_LIMIT)
      .filter(id => CONTROLS.has(id))
      .forEach(id => host.appendChild(renderRow(CONTROLS.get(id), HOME_PREFIX)));
  }

  /** "Low vision · Screen reader"; spoken, with commas and a full stop. */
  function setupSentence(spoken) {
    const needs = needsOf(state.setup);
    if (!needs.length) return 'Not set up yet.';
    const labels = needs.map(id => {
      const profile = PROFILES.find(p => p.id === id);
      return profile ? profile.label : id;
    });
    return spoken ? labels.join(', ') + '.' : labels.join(' · ');
  }

  function paintHome() {
    const paused = Boolean(state.site && state.site._off);
    $('#siteOn').checked = !paused;
    $('#pausedNote').hidden = !paused;
    $('#setupNeeds').textContent = setupSentence();
    const hasSetup = needsOf(state.setup).length > 0;
    const change = $('#btnChangeSetup');
    change.textContent = hasSetup ? 'Change' : 'Set up';
    change.setAttribute('aria-label', hasSetup ? 'Change my setup' : 'Set up AccessiFlow');
  }

  function openSetup() {
    flush();
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html?again=1') });
    window.close();
  }

  function setHomeStatus(message, tone, opts) {
    const status = $('#homeStatus');
    status.textContent = message;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
    announce(message, opts);
  }

  function initHome() {
    $('#siteOn').addEventListener('change', () => {
      flush();
      const on = $('#siteOn').checked;
      state = Store.setPaused(state, !on);
      settings = currentSettings();
      Store.save(currentHostname, state);
      paintFromSettings();
      announce(on
        ? 'AccessiFlow is on for ' + currentHostname + ' again.'
        : 'AccessiFlow is off for ' + currentHostname + '. The page is back to how the site made it.');
    });

    $('#btnChangeSetup').addEventListener('click', openSetup);

    // The page does the talking for these three, so the panel stays silent
    // rather than cut its own words off.
    $('#btnHomeRead').addEventListener('click', () => {
      sendAction('ttsReadPage');
      setHomeStatus('Reading the page aloud. Stop reading, or Ctrl on the page, stops it.', null, { silent: true });
    });
    $('#btnHomeStop').addEventListener('click', () => {
      sendAction('ttsStop');
      setHomeStatus('Stopped reading.');
    });
    $('#btnHomeSummary').addEventListener('click', () => {
      const button = $('#btnHomeSummary');
      button.disabled = true;
      setHomeStatus('Summarising this page…', null, { silent: true });
      sendAction('summarizeAloud', response => {
        button.disabled = false;
        if (!response) {
          setHomeStatus('This page cannot be summarised.', 'error');
        } else if (response.kind === 'bullets') {
          setHomeStatus('The key points are being read out, and are at the top of the page.', 'success', { silent: true });
        } else {
          setHomeStatus('Smart help was not available, so an outline of the page is being read out instead.', null, { silent: true });
        }
      });
    });
    $('#btnHomePictures').addEventListener('click', () => {
      const button = $('#btnHomePictures');
      button.disabled = true;
      setHomeStatus('Looking at the pictures on this page…');
      sendAction('aiDescribeImages', response => {
        button.disabled = false;
        setHomeStatus(describeResult(response), response && response.success ? 'success' : 'error');
        refreshAiCounts();
      });
    });

    $('#btnAllSettings').addEventListener('click', () => showView('all'));
    $('#btnBackHome').addEventListener('click', () => showView('home'));
  }

  function showView(name) {
    flush();
    $('#homeView').hidden = name !== 'home';
    $('#allView').hidden = name !== 'all';
    $('main').scrollTop = 0;
    if (name === 'all') {
      $('#allTitle').focus();
      announce('All settings. Search, or open a group.');
    } else {
      // Rows on Home may have changed under All settings.
      paintFromSettings();
      $('#btnAllSettings').focus();
    }
  }

  // ── Dependent controls ──────────────────────────────────────────────────
  // A magnifier strength slider means nothing with the magnifier off. Those
  // rows are dimmed and marked aria-disabled rather than hidden, so the
  // relationship stays visible and nothing vanishes under a screen reader.

  function refreshDependants() {
    // A setting that another setting overrides is shown as unavailable rather
    // than hidden: someone who turned on "Dark background" and then switched
    // on smart dark mode needs to see why their first choice stopped mattering.
    document.querySelectorAll('[data-conflicts-with]').forEach(row => {
      const blockers = row.dataset.conflictsWith.split(' ').filter(id => settings[id]);
      const blocked = blockers.length > 0;
      row.classList.toggle('row--inactive', blocked);
      row.querySelectorAll('input, select, .step-btn').forEach(node => { node.disabled = blocked; });
      const hint = row.querySelector('.row-conflict');
      if (hint) {
        hint.hidden = !blocked;
        if (blocked) {
          const label = CONTROLS.has(blockers[0]) ? CONTROLS.get(blockers[0]).label : blockers[0];
          hint.textContent = 'Not used while ' + label + ' is on.';
        }
      }
    });

    document.querySelectorAll('[data-depends-on]').forEach(row => {
      const active = Boolean(settings[row.dataset.dependsOn]);
      row.classList.toggle('row--inactive', !active);
      row.querySelectorAll('input, select, .step-btn').forEach(node => {
        node.disabled = !active;
      });
      if (active) {
        const input = row.querySelector('input[type="range"]');
        const steps = row.querySelectorAll('.step-btn');
        if (input && steps.length === 2) syncStepButtons(input, steps[0], steps[1]);
      }
    });
  }

  // ── Settings state ──────────────────────────────────────────────────────

  function currentSettings() {
    return Store.resolve(state.setup, state.site).settings;
  }

  /** Both copies of a control, on Home and under All settings. */
  function paintControl(id) {
    const control = CONTROLS.get(id);
    if (!control) return;
    ['', HOME_PREFIX].forEach(prefix => {
      const input = document.getElementById(prefix + id);
      if (!input) return;
      if (control.type === 'switch') {
        input.checked = Boolean(settings[id]);
      } else if (control.type === 'slider') {
        const value = settings[id] !== undefined ? settings[id] : control.default;
        input.value = value;
        const out = document.getElementById('out-' + prefix + id);
        if (out) out.textContent = roundStep(parseFloat(value), control.step) + control.suffix;
        const steps = input.parentElement.querySelectorAll('.step-btn');
        if (steps.length === 2) syncStepButtons(input, steps[0], steps[1]);
      } else {
        const wanted = settings[id] != null ? settings[id] : control.default;
        if (Array.from(input.options).some(o => o.value === wanted)) input.value = wanted;
      }
    });
  }

  /** Marks the rows whose value is this site's own. */
  function paintSiteMarks() {
    document.querySelectorAll('.row[data-control-id]').forEach(row => {
      const mark = row.querySelector('.row-site');
      if (mark) mark.hidden = !Store.isException(state.site, row.dataset.controlId);
    });
  }

  function paintFromSettings() {
    Object.keys(GLOBAL_KEYS).forEach(id => { settings[id] = Boolean(globals[id]); });
    CONTROLS.forEach((control, id) => paintControl(id));
    refreshDependants();
    paintSiteMarks();
    paintHome();
  }

  /** How an announcement says where the change went. */
  function whereSaid() {
    return scope === 'site' ? ', on this site only' : '';
  }

  /**
   * One setting changed, from either copy of its control. Saved into the
   * setup or as this site's exception, depending on the scope chosen.
   */
  let pending = {};
  function setValue(id, value) {
    settings[id] = value;
    if (GLOBAL_KEYS[id]) {
      globals[id] = value;
      try { chrome.storage.local.set({ [GLOBAL_KEYS[id]]: value }); } catch (e) { /* ok */ }
      if (id === 'screenReader') {
        if (value) Voice.enable({ rate: settings.ttsRate || 1 });
        else Voice.disable();
      }
    } else {
      pending[id] = value;
      commit();
      if (id === 'ttsRate') Voice.setRate(value);
    }
    paintControl(id);
    refreshDependants();
  }

  /**
   * Debounced, because dragging a slider fires `input` on every pixel and
   * each open page rebuilds its modules when the setup changes. Without
   * this, the page stutters exactly for the users least able to tolerate it.
   */
  let commitTimer = null;
  function commit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(flush, 80);
  }

  function flush() {
    clearTimeout(commitTimer);
    commitTimer = null;
    if (!Object.keys(pending).length) return;
    state = Store.change(state, pending, scope);
    pending = {};
    Store.save(currentHostname, state);
    paintSiteMarks();
  }

  /** "Use my setup" for one setting on this site. */
  function forgetHere(id) {
    flush();
    state = Store.forget(state, id);
    settings = currentSettings();
    Store.save(currentHostname, state);
    paintFromSettings();
    const control = CONTROLS.get(id);
    announce((control ? control.label : 'That setting') + ' now follows your setup on this site.');
  }

  function sendAction(action, callback) {
    if (!currentTabId) { if (callback) callback(null); return; }
    chrome.tabs.sendMessage(currentTabId, { action }, response => {
      if (chrome.runtime.lastError) {
        markPageUnreachable();
        if (callback) callback(null);
        return;
      }
      if (callback) callback(response);
    });
  }

  function markPageUnreachable() {
    if (!pageReachable) return;
    pageReachable = false;

    const note = el('p', 'panel-note');
    note.setAttribute('role', 'status');
    note.textContent = 'AccessiFlow cannot change this particular page. Browser ' +
      'pages and the Chrome Web Store are off limits. Your choices are saved and ' +
      'will apply on ordinary websites.';
    $('main').prepend(note);
    announce('AccessiFlow cannot change this page.');
  }

  // ── Scope: every site, or this one ──────────────────────────────────────

  function initScope() {
    document.querySelectorAll('input[name="scope"]').forEach(radio => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        flush();
        scope = radio.value;
        announce(scope === 'site'
          ? 'Changes now apply to ' + currentHostname + ' only.'
          : 'Changes now apply to every site.');
      });
    });
  }

  // ── Search ──────────────────────────────────────────────────────────────

  /**
   * Search text for each fixed panel: what it visibly says, plus the schema's
   * extra keywords.
   */
  const PANEL_SEARCH = {};
  function buildPanelSearch() {
    const extra = SCHEMA.panels || {};
    Object.keys(extra).forEach(id => {
      const section = document.getElementById(id);
      if (!section) return;
      const visible = Array.from(section.querySelectorAll('.section-label, .section-desc, button'))
        .map(node => node.textContent)
        .join(' ');
      PANEL_SEARCH[id] = searchText(visible + ' ' + extra[id]);
    });
  }

  /** One pass over every section and row under All settings. */
  function applyFilters() {
    const input = $('#settingSearch');
    const query = input ? input.value.trim() : '';
    const words = searchWords(query);

    let matches = 0;

    document.querySelectorAll('#sections .section').forEach(section => {
      let hits = 0;
      section.querySelectorAll('.row').forEach(row => {
        const hit = !words.length || matchesAll(row.dataset.search, words);
        row.hidden = !hit;
        if (hit) hits++;
      });
      // A class, not `hidden`: several of these buttons are shown and hidden
      // by their own state (a Stop button while captions run), and search
      // must not undo that.
      section.querySelectorAll('.section-actions .btn').forEach(button => {
        const hit = !words.length || matchesAll(button.dataset.search || '', words);
        button.classList.toggle('search-miss', !hit);
        if (hit && words.length && !button.hidden) hits++;
      });

      section.hidden = words.length > 0 && hits === 0;
      if (!section.hidden) matches += hits;

      const toggle = section.querySelector('.section-toggle');
      if (!toggle) return;
      if (words.length) setSectionOpen(toggle, hits > 0);
      else setSectionOpen(toggle, false);
    });

    // The fixed panels (Smart help, Check this page, ...) are searched by
    // their own text plus the schema's keywords, so typing a button's name
    // finds its button. A match opens the panel.
    const panelsFound = [];
    Object.keys(PANEL_SEARCH).forEach(id => {
      const section = document.getElementById(id);
      if (!section) return;
      const hit = !words.length || matchesAll(PANEL_SEARCH[id], words);
      section.hidden = !hit;
      if (!words.length || !hit) return;
      const toggle = section.querySelector('.section-toggle');
      if (toggle) setSectionOpen(toggle, true);
      const label = section.querySelector('.section-label');
      panelsFound.push(label ? label.textContent : id);
    });

    return { matches, panelsFound, query };
  }

  function initSearch() {
    const input = $('#settingSearch');
    const clear = $('#btnClearSearch');

    const run = () => {
      const query = input.value.trim();
      clear.hidden = !query;

      if (!query) {
        applyFilters();
        announce('Search cleared.');
        return;
      }

      const result = applyFilters();
      const found = [];
      if (result.matches) {
        found.push(result.matches + (result.matches === 1 ? ' setting' : ' settings'));
      }
      if (result.panelsFound.length) found.push(result.panelsFound.join(' and '));
      announce(found.length
        ? 'Found ' + found.join(', and ') + '.'
        : 'Nothing matches ' + query + '.');
    };

    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(run, 180);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Escape' && input.value) {
        e.stopPropagation();
        input.value = '';
        run();
      }
    });

    clear.addEventListener('click', () => {
      input.value = '';
      run();
      input.focus();
    });
  }

  // ── Dialog ──────────────────────────────────────────────────────────────
  // Replaces confirm(). A native dialog cannot be themed, ignores high
  // contrast, and on some platforms closing it also closes the popup.

  let releaseDialog = null;

  /** `extra`, if given, is a node shown under the body text, such as a table. */
  function confirmDialog(title, body, confirmLabel, cancelLabel, extra) {
    const backdrop = $('#dialogBackdrop');
    const dialog = $('#dialog');
    const confirmBtn = $('#dialogConfirm');
    const cancelBtn = $('#dialogCancel');
    const extraHost = $('#dialogExtra');
    const previouslyFocused = document.activeElement;

    $('#dialogTitle').textContent = title;
    $('#dialogBody').textContent = body;
    confirmBtn.textContent = confirmLabel || 'Yes';
    cancelBtn.textContent = cancelLabel || 'Cancel';
    extraHost.textContent = '';
    extraHost.hidden = !extra;
    if (extra) extraHost.appendChild(extra);
    backdrop.hidden = false;
    confirmBtn.focus();

    return new Promise(resolve => {
      const finish = answer => {
        backdrop.hidden = true;
        extraHost.hidden = true;
        extraHost.textContent = '';
        if (releaseDialog) releaseDialog();
        releaseDialog = null;
        if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
        resolve(answer);
      };

      const onKeydown = e => {
        if (e.key === 'Escape') { e.stopPropagation(); finish(false); return; }
        if (e.key !== 'Tab') return;
        // Keep Tab inside the dialog. The extra content, when there is any,
        // is a scrollable region and takes a turn too.
        const focusables = (extra ? [extraHost] : []).concat([cancelBtn, confirmBtn]);
        const index = focusables.indexOf(document.activeElement);
        const next = e.shiftKey ? index - 1 : index + 1;
        if (next < 0 || next >= focusables.length || index === -1) {
          e.preventDefault();
          focusables[next < 0 ? focusables.length - 1 : 0].focus();
        }
      };

      const onConfirm = () => finish(true);
      const onCancel = () => finish(false);

      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
      dialog.addEventListener('keydown', onKeydown);

      releaseDialog = () => {
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        dialog.removeEventListener('keydown', onKeydown);
      };
    });
  }

  // ── Text to speech ──────────────────────────────────────────────────────

  /**
   * The natural Bangla voice is 73 MB, so it is never fetched behind the
   * user's back: this button is the consent. Progress is announced rather
   * than only drawn, because the people who need this voice cannot see a
   * progress bar.
   */
  function initVoiceDownload() {
    const button = $('#btnDownloadVoice');
    if (!button) return;

    const setLabel = text => { button.textContent = text; };

    chrome.runtime.sendMessage({ action: 'voiceStatus' }, reply => {
      void chrome.runtime.lastError;
      if (reply && reply.downloaded) {
        setLabel('Natural Bangla voice is ready');
        button.disabled = true;
      }
    });

    button.addEventListener('click', () => {
      button.disabled = true;
      setLabel('Downloading the natural voice…');
      announce('Downloading the natural Bangla voice. This happens once, and is about 73 megabytes.');

      chrome.runtime.sendMessage({ action: 'downloadVoice' }, reply => {
        void chrome.runtime.lastError;
        if (reply && reply.success) {
          setLabel('Natural Bangla voice is ready');
          announce('The natural Bangla voice is ready. Turn it on with the switch above.');
        } else {
          button.disabled = false;
          setLabel('Download the natural Bangla voice');
          announce((reply && reply.error) || 'The voice could not be downloaded.');
        }
      });
    });
  }

  // ── Live captions ───────────────────────────────────────────────────────
  //
  // Chrome allows a tab to be captured only right after the user invokes the
  // extension on it, which opening this popup does. So the start button lives
  // here, and on the page there is only the Alt+Shift+W shortcut, which
  // carries the same permission.

  let captionModelReady = false;

  function refreshCaptions() {
    const start = $('#btnCaptionsStart');
    const stop = $('#btnCaptionsStop');
    if (!start || !stop || !currentTabId) return;
    chrome.runtime.sendMessage({ action: 'captionsStatus', tabId: currentTabId }, status => {
      void chrome.runtime.lastError;
      const running = !!(status && status.running);
      start.hidden = running;
      stop.hidden = !running;
    });
  }

  function initCaptions() {
    const start = $('#btnCaptionsStart');
    const stop = $('#btnCaptionsStop');
    const model = $('#btnCaptionModel');
    if (!start || !stop || !model) return;
    stop.hidden = true;

    const modelReady = () => {
      captionModelReady = true;
      model.textContent = 'Caption engine is ready, on this computer';
      model.disabled = true;
    };

    chrome.runtime.sendMessage({ action: 'captionModelStatus' }, reply => {
      void chrome.runtime.lastError;
      if (reply && reply.downloaded) modelReady();
    });

    chrome.runtime.onMessage.addListener(message => {
      if (!message || message.action !== 'captionProgress') return;
      model.textContent = 'Downloading the caption engine… ' + message.percent + '%';
      if (message.percent % 20 === 0) announce(message.percent + ' per cent downloaded.');
    });

    model.addEventListener('click', () => {
      model.disabled = true;
      model.textContent = 'Downloading the caption engine…';
      announce('Downloading the caption engine. This happens once, and is about 41 megabytes. ' +
        'After that, captions work without sending any sound anywhere.');
      chrome.runtime.sendMessage({ action: 'downloadCaptionModel' }, reply => {
        void chrome.runtime.lastError;
        if (reply && reply.success) {
          modelReady();
          announce('The caption engine is ready. Start live captions whenever you like.');
        } else {
          model.disabled = false;
          model.textContent = 'Download the caption engine (41 MB, once)';
          announce((reply && reply.error) || 'The caption engine could not be downloaded.');
        }
      });
    });

    start.addEventListener('click', () => {
      if (!currentTabId) return;
      if (!captionModelReady) {
        announce('Download the caption engine first. It is 41 megabytes, and only needed once.');
        model.focus();
        return;
      }
      start.disabled = true;
      chrome.runtime.sendMessage({ action: 'startCaptions', tabId: currentTabId }, reply => {
        void chrome.runtime.lastError;
        start.disabled = false;
        if (reply && reply.success) {
          start.hidden = true;
          stop.hidden = false;
          announce('Starting live captions. The first caption can take about ten seconds. ' +
            'They appear at the bottom of the page, and Alt+Shift+W stops them.');
        } else {
          announce((reply && reply.error) || 'Live captions could not start.');
          if (reply && reply.code === 'model_missing') model.focus();
        }
      });
    });

    stop.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'stopCaptions' }, () => {
        void chrome.runtime.lastError;
        stop.hidden = true;
        start.hidden = false;
        announce('Live captions stopped.');
        start.focus();
      });
    });
  }

  function initTTS() {
    const read = $('#btnTTSRead');
    const stop = $('#btnTTSStop');
    if (read) read.addEventListener('click', () => {
      sendAction('ttsReadPage');
      announce('Reading the page aloud.', { silent: true });
    });
    if (stop) stop.addEventListener('click', () => {
      sendAction('ttsStop');
      announce('Stopped reading.');
    });
  }

  // ── AI panel ────────────────────────────────────────────────────────────

  function setAiStatus(message, tone) {
    const status = $('#aiStatus');
    status.textContent = message;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  }

  const AI_BUTTONS = ['#btnAiAltText', '#btnAiLinks', '#btnAiControls',
    '#btnAiSimplify', '#btnAiForm', '#btnHomePictures'];

  function setAiBusy(busy) {
    AI_BUTTONS.forEach(sel => { $(sel).disabled = busy; });
    $('#btnAiRestore').disabled = busy;
    $('#btnAiCancel').hidden = !busy;
    $('#aiProgress').hidden = !busy;
    if (!busy) $('#aiProgressFill').style.width = '0';
  }

  /** What "Describe the pictures" did, in one sentence. */
  function describeResult(response) {
    if (!response || !response.success) {
      return (response && response.error) || 'That did not work. Please try again.';
    }
    const r = response.result;
    if (r.error) {
      return r.described > 0
        ? 'Described ' + r.described + ' pictures, then stopped: ' + r.error
        : r.error;
    }
    if (r.total === 0) return 'Every picture on this page already has a description.';
    const skipped = r.skipped > 0 ? ' ' + r.skipped + ' could not be read by the browser.' : '';
    return 'Described ' + r.described + ' of ' + r.total + ' pictures.' + skipped;
  }

  // Set once the proxy answers; the counts need both this and a known tab, and
  // the two arrive in whichever order they please.
  let aiAvailable = false;

  function refreshAiCounts() {
    if (!aiAvailable || !currentTabId) return;
    sendAction('aiCounts', response => {
      if (!response || !response.success) return;
      $('#aiImageCount').textContent = response.images > 0 ? String(response.images) : '';
      $('#aiLinkCount').textContent = response.links > 0 ? String(response.links) : '';
      $('#aiControlCount').textContent = response.controls > 0 ? String(response.controls) : '';
      $('#aiParagraphCount').textContent = response.paragraphs > 0 ? String(response.paragraphs) : '';
      $('#btnAiRestore').hidden = !(response.simplified > 0);

      if (response.images === 0 && response.links === 0 && !response.controls) {
        setAiStatus('This page already describes its pictures and names its links and buttons well.');
      }
    });
  }

  let refreshAutoStatus = () => {};

  function initAI() {
    chrome.runtime.onMessage.addListener(message => {
      if (message && message.action === 'voiceProgress') {
        const button = $('#btnDownloadVoice');
        if (button) button.textContent = 'Downloading the natural voice… ' + message.percent + '%';
        // Every fifth, so a screen reader is informed but not flooded.
        if (message.percent % 20 === 0) announce(message.percent + ' per cent downloaded.');
        return;
      }
      if (!message || message.action !== 'aiProgress') return;
      const percent = message.total ? Math.round((message.done / message.total) * 100) : 0;
      $('#aiProgressFill').style.width = percent + '%';
      const what = {
        images: 'Describing picture',
        links: 'Rewriting link',
        controls: 'Naming button',
        paragraphs: 'Rewriting paragraph'
      }[message.kind] || 'Working on';
      setAiStatus(what + ' ' + message.done + ' of ' + message.total + '…');
    });

    $('#btnAiCancel').addEventListener('click', () => {
      sendAction('aiCancel');
      setAiStatus('Stopping…');
    });

    $('#btnAiAltText').addEventListener('click', () => {
      setAiBusy(true);
      setAiStatus('Looking at the pictures on this page…');
      sendAction('aiDescribeImages', response => {
        setAiBusy(false);
        setAiStatus(describeResult(response), response && response.success && !response.result.error ? 'success' : 'error');
        announce($('#aiStatus').textContent);
        refreshAiCounts();
      });
    });

    $('#btnAiLinks').addEventListener('click', () => {
      setAiBusy(true);
      setAiStatus('Looking for confusing links…');

      sendAction('aiFixLinks', response => {
        setAiBusy(false);
        if (!response || !response.success) {
          setAiStatus((response && response.error) || 'That did not work. Please try again.', 'error');
          return;
        }
        const r = response.result;
        if (r.error) {
          setAiStatus(r.error, 'error');
        } else if (r.total === 0) {
          setAiStatus('No confusing links found. This page names its links well.', 'success');
        } else {
          setAiStatus('Rewrote ' + r.fixed + ' of ' + r.total + ' links.', 'success');
        }
        announce($('#aiStatus').textContent);
        refreshAiCounts();
      });
    });

    // A shared finish for the simpler actions: busy off, say what happened.
    const finishAi = (response, describe) => {
      setAiBusy(false);
      if (!response || !response.success) {
        setAiStatus((response && response.error) || 'That did not work. Please try again.', 'error');
      } else {
        const outcome = describe(response);
        setAiStatus(outcome.text, outcome.tone || 'success');
      }
      announce($('#aiStatus').textContent);
      refreshAiCounts();
      refreshAutoStatus();
    };

    $('#btnAiControls').addEventListener('click', () => {
      setAiBusy(true);
      setAiStatus('Looking for buttons with no name…');
      sendAction('aiHealControls', response => finishAi(response, r => {
        const result = r.result;
        if (result.error) return { text: result.error, tone: 'error' };
        if (result.total === 0) return { text: 'Every button on this page already has a name.' };
        return {
          text: 'Named ' + result.named + ' of ' + result.total + ' buttons.' +
            (result.remembered ? ' ' + result.remembered + ' were already remembered.' : '') +
            (result.named < result.total ? ' The rest could not be named with confidence.' : '')
        };
      }));
    });

    $('#btnAiSimplify').addEventListener('click', () => {
      setAiBusy(true);
      setAiStatus('Reading the long paragraphs…');
      sendAction('aiSimplifyPage', response => finishAi(response, r => {
        const result = r.result;
        if (result.error && !result.rewritten) return { text: result.error, tone: 'error' };
        return {
          text: 'Rewrote ' + result.rewritten + ' of ' + result.total + ' paragraphs. ' +
            'Each one has a button to show the original.' +
            (result.error ? ' Then stopped: ' + result.error : '')
        };
      }));
    });

    $('#btnAiRestore').addEventListener('click', () => {
      sendAction('aiRevertSimplified', response => finishAi(response, r => ({
        text: 'Restored ' + r.restored + ' paragraphs to the original.'
      })));
    });

    $('#btnAiForm').addEventListener('click', () => {
      setAiBusy(true);
      setAiStatus('Looking at the form…');
      sendAction('aiFormBrief', response => finishAi(response, r => (r.text
        ? { text: 'Added above the form: ' + r.text }
        : { text: 'This form could not be summarised.', tone: 'error' })));
    });

    // Automatic fixes: the one-time agreement, and what it has done so far.
    const consent = $('#aiConsent');
    refreshAutoStatus = () => {
      chrome.runtime.sendMessage({ action: 'aiAutoStatus' }, status => {
        if (chrome.runtime.lastError || !status || !status.success) return;
        consent.checked = status.consent;
        const remembered = status.cached === 1 ? '1 answer remembered' : status.cached + ' answers remembered';
        $('#aiAutoStatus').textContent = status.consent
          ? remembered + ', ' + status.remaining + ' of ' + status.perHour + ' automatic fixes left this hour.'
          : remembered + '.';
      });
    };
    consent.addEventListener('change', () => {
      chrome.runtime.sendMessage({ action: 'aiSetConsent', value: consent.checked }, () => {
        void chrome.runtime.lastError;
        announce(consent.checked
          ? 'Automatic fixes on. Unlabelled buttons will be named on every site.'
          : 'Automatic fixes off. Nothing will be sent without a button press.');
        refreshAutoStatus();
      });
    });
    $('#btnAiForget').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'aiClearCache' }, () => {
        void chrome.runtime.lastError;
        announce('Remembered answers forgotten.');
        refreshAutoStatus();
      });
    });
    refreshAutoStatus();

    // If the proxy is not reachable, say so before the user presses anything.
    // The Summarise button stays: without the helper it reads an outline.
    chrome.runtime.sendMessage({ action: 'aiHealth' }, health => {
      if (chrome.runtime.lastError || !health) return;
      if (health.available) {
        aiAvailable = true;
        refreshAiCounts();
        return;
      }

      AI_BUTTONS.forEach(sel => { $(sel).disabled = true; });
      setAiStatus(health.reason === 'offline'
        ? 'Smart help needs an internet connection.'
        : 'Smart help is not available in this build yet.', 'error');
    });
  }

  // ── Audit ───────────────────────────────────────────────────────────────

  function initAudit() {
    const button = $('#btnRunAudit');

    button.addEventListener('click', () => {
      button.disabled = true;
      button.textContent = 'Checking…';
      announce('Checking this page.');

      sendAction('runAudit', response => {
        button.disabled = false;
        button.textContent = 'Check this page again';

        const list = $('#auditResultsList');
        list.textContent = '';

        if (!response || !response.success || !response.data) {
          list.appendChild(el('p', 'empty-note',
            'The check could not run. Try reloading the page first.'));
          announce('The check could not run.');
          return;
        }
        showAudit(response.data.score, response.data.issues || []);
      });
    });
  }

  function showAudit(score, issues) {
    $('#auditScoreArea').hidden = false;
    $('#auditScoreValue').textContent = score;

    const dial = $('#auditScoreCircle');
    dial.dataset.band = score < 40 ? 'low' : score < 70 ? 'mid' : 'high';

    // 2*pi*52, matching the ring radius in popup.html.
    const circumference = 327;
    $('#scoreRingValue').style.strokeDashoffset =
      String(circumference - (circumference * Math.max(0, Math.min(100, score))) / 100);

    const verdict = score >= 85 ? 'This page is in good shape.'
      : score >= 70 ? 'This page is mostly fine, with a few rough edges.'
      : score >= 40 ? 'This page has real problems. AccessiFlow can fix many of them.'
      : 'This page is hard to use. Your setup, or Smart help, can make it workable.';
    $('#auditScoreCaption').textContent = verdict;

    const list = $('#auditResultsList');
    if (!issues.length) {
      list.appendChild(el('p', 'empty-note', 'No problems found on this page.'));
    } else {
      issues.forEach(issue => {
        const row = el('div', 'issue');
        row.dataset.type = issue.type || 'info';
        row.appendChild(el('span', 'issue-badge', issue.type || 'info'));
        row.appendChild(el('span', 'issue-text',
          issue.message + (issue.count > 0 ? ' (' + issue.count + ')' : '')));
        if (issue.criterion) {
          row.appendChild(el('span', 'issue-criterion', 'WCAG ' + issue.criterion));
        }
        list.appendChild(row);
      });
    }

    announce('This page scores ' + score + ' out of 100. ' + verdict + ' ' +
      issues.length + (issues.length === 1 ? ' problem listed.' : ' problems listed.'));
  }

  // ── Save, load, reset ───────────────────────────────────────────────────

  /** Only settings AccessiFlow still has, and never the global switches. */
  function cleanSettings(incoming) {
    const out = {};
    Object.keys(incoming || {}).forEach(key => {
      const control = CONTROLS.get(key);
      if (!control || control.global) return;
      out[key] = incoming[key];
    });
    return out;
  }

  /**
   * Reset everything: every setting back to where a new install starts, on
   * every website, after a yes. The built-in screen reader stays on, and
   * says so, because Reset pressed by someone blind must not leave them in
   * silence. Open pages follow by themselves, as they follow any change.
   */
  async function resetEverything() {
    const readerOn = Boolean(globals.screenReader);
    const yes = await confirmDialog(
      'Reset everything?',
      'Everything you have switched on goes back off, on every website: your setup, each site’s own ' +
        'changes, and any site you turned AccessiFlow off for. ' +
        (readerOn ? 'The built-in screen reader stays on. ' : '') +
        'You can answer the setup questions again at any time.',
      'Reset everything'
    );
    if (!yes) return;

    // Changes still waiting to be saved would come back after the reset.
    clearTimeout(commitTimer);
    commitTimer = null;
    pending = {};
    await Store.reset();
    state = { setup: null, site: null };
    settings = currentSettings();
    Voice.setRate(settings.ttsRate || 1);
    renderHome();
    paintFromSettings();
    announce('Everything is reset, on every website. AccessiFlow is back to how it starts.' +
      (readerOn ? ' The built-in screen reader is still on.' : ''));
  }

  function initDataActions() {
    $('#btnRunSetup').addEventListener('click', openSetup);
    document.querySelectorAll('[data-reset-all]').forEach(button => {
      button.addEventListener('click', resetEverything);
    });

    $('#btnResetSettings').addEventListener('click', async () => {
      const yes = await confirmDialog(
        'Forget ' + currentHostname + '’s own changes?',
        'This site goes back to your setup, and AccessiFlow is switched back on here if it was off. Your setup and every other site stay as they are.',
        'Forget them'
      );
      if (!yes) return;

      flush();
      state = { setup: state.setup, site: null };
      settings = currentSettings();
      chrome.storage.local.remove(Store.siteKey(currentHostname));
      paintFromSettings();
      announce('This site now follows your setup.');
    });

    $('#btnExportSettings').addEventListener('click', () => {
      flush();
      const payload = {
        version: 3,
        savedOn: new Date().toISOString().slice(0, 10),
        setup: state.setup || { v: 1, needs: [], settings: {} },
        site: currentHostname,
        siteChanges: state.site || null
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      );
      const link = el('a');
      link.href = url;
      link.download = 'accessiflow-setup.json';
      link.click();
      URL.revokeObjectURL(url);
      announce('Your setup was saved to a file.');
    });

    const file = $('#importFile');
    $('#btnImportSettings').addEventListener('click', () => file.click());

    file.addEventListener('change', event => {
      const chosen = event.target.files[0];
      if (!chosen) return;

      const reader = new FileReader();
      reader.onload = e => {
        try {
          const parsed = JSON.parse(e.target.result);
          let applied = 0;

          if (parsed && parsed.version === 3 && parsed.setup) {
            // A setup saved by this version.
            const setup = Object.assign({ v: 1, needs: [] }, parsed.setup);
            setup.needs = (setup.needs || []).filter(id => PROFILES.some(p => p.id === id));
            setup.settings = cleanSettings(parsed.setup.settings);
            applied = Object.keys(setup.settings).length + setup.needs.length;
            state = { setup: setup, site: state.site };
            if (parsed.site === currentHostname && parsed.siteChanges) {
              state.site = Object.assign({ _v: Store.SITE_VERSION }, cleanSettings(parsed.siteChanges));
            }
          } else {
            // A file from 2.x: one site's settings, taken as the setup, with
            // only what differs from the defaults so nothing is pinned.
            const incoming = cleanSettings(parsed && parsed.settings && typeof parsed.settings === 'object'
              ? parsed.settings : parsed);
            const base = Store.defaults();
            const changed = {};
            Object.keys(incoming).forEach(key => {
              if (incoming[key] !== base[key]) changed[key] = incoming[key];
            });
            if (!Object.keys(incoming).length) throw new Error('nothing recognised');
            applied = Object.keys(changed).length;
            state = Store.change(state, changed, 'everywhere');
          }

          if (!applied) throw new Error('nothing recognised');
          settings = currentSettings();
          Store.save(currentHostname, state);
          renderHome();
          paintFromSettings();
          announce('Loaded a setup with ' + applied + ' choices from the file.');
        } catch (_) {
          confirmDialog(
            'That file could not be read',
            'It does not look like a file AccessiFlow saved. Try choosing a different one.',
            'OK', 'Close'
          );
        }
        file.value = '';
      };
      reader.readAsText(chosen);
    });
  }

  // ── Voice control ───────────────────────────────────────────────────────
  //
  // Opens the side panel that listens. Chrome only opens a side panel in
  // direct answer to a click, so this is called straight from the handler,
  // with the window id fetched beforehand rather than awaited inside it.

  function initVoiceControl() {
    const button = $('#btnVoiceControl');
    if (!button) return;
    let windowId = null;
    try { chrome.windows.getCurrent(w => { windowId = w && w.id; }); } catch (e) { /* ok */ }

    button.addEventListener('click', () => {
      if (!chrome.sidePanel || windowId === null) {
        announce('Voice control needs a newer version of Chrome.');
        return;
      }
      chrome.sidePanel.open({ windowId: windowId })
        .then(() => window.close())
        .catch(() => announce('The voice control panel could not open. Press Alt+Shift+X instead.'));
    });
  }

  // ── Help ────────────────────────────────────────────────────────────────
  // Every key AccessiFlow answers to, from modules/shortcuts.js, with a
  // button that reads them all aloud.

  function shortcutTable() {
    const table = el('table', 'shortcut-table');
    const head = el('thead');
    const headRow = el('tr');
    ['Keys', 'What happens'].forEach(text => {
      const th = el('th', null, text);
      th.scope = 'col';
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    const body = el('tbody');
    SHORTCUTS.forEach(s => {
      const tr = el('tr');
      const keys = el('td');
      keys.appendChild(el('kbd', null, s.keys));
      tr.append(keys, el('td', null, s.what));
      body.appendChild(tr);
    });
    table.append(head, body);
    return table;
  }

  function initHelp() {
    $('#btnHelp').addEventListener('click', async () => {
      const table = shortcutTable();
      $('#dialogExtra').setAttribute('aria-label', 'Keyboard shortcuts');
      const read = await confirmDialog(
        'Keyboard shortcuts',
        'These keys work on any website. Inside this panel, Tab moves between controls and Space switches them on or off.',
        'Read them aloud', 'Close', table
      );
      if (read) {
        Voice.preview('AccessiFlow keys. ' + SHORTCUTS.map(s => s.spoken).join('. ') + '.',
          settings.ttsRate || 1);
      }
    });
  }

  // ── Start ───────────────────────────────────────────────────────────────

  function init() {
    renderAll();
    buildPanelSearch();
    initAppearance();
    initHome();
    initScope();
    initSearch();
    initTTS();
    initVoiceDownload();
    initCaptions();
    initAI();
    initAudit();
    initDataActions();
    initVoiceControl();
    initHelp();

    settings = Store.defaults();
    renderHome();
    paintFromSettings();

    // Nothing may be lost when the panel closes straight after a change.
    window.addEventListener('pagehide', flush);

    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs && tabs[0];
      if (!tab) return;

      currentTabId = tab.id;
      try {
        currentHostname = new URL(tab.url).hostname || '';
      } catch (_) {
        currentHostname = '';
      }
      const shown = currentHostname || 'this page';
      $('#currentHostname').textContent = shown;
      document.querySelectorAll('.scope-host').forEach(node => { node.textContent = shown; });

      Store.load(currentHostname).then(loaded => {
        state = { setup: loaded.setup, site: loaded.site };
        globals.screenReader = loaded.reader;
        settings = currentSettings();
        renderHome();
        paintFromSettings();

        // With AccessiFlow's own screen reader on, it runs in this panel too
        // (ui-voice.js starts it), so the panel reads with the same keys as
        // any website, and speaks for itself as things change.
        if (globals.screenReader) {
          Voice.enable({ rate: settings.ttsRate || 1 });
          const paused = Boolean(state.site && state.site._off);
          Voice.say('AccessiFlow panel. ' +
            (paused ? 'Off for ' + shown + '. ' : 'On for ' + shown + '. ') +
            'Your setup: ' + setupSentence(true) + ' The arrow keys read the panel, H jumps to a heading, ' +
            'B to a button, Tab moves between controls, and Escape closes it.');
        }
      });

      // Confirms the content script is present, so the "cannot change this
      // page" notice appears before the user tries anything.
      chrome.tabs.sendMessage(currentTabId, { action: 'ping' }, () => {
        if (chrome.runtime.lastError) markPageUnreachable();
      });

      refreshAiCounts(); // no-op unless the health check already came back
      refreshCaptions();
    });
  }

  // Run once, whenever the document is ready. Waiting purely on the event
  // loses the race if the script is ever deferred or injected late, and the
  // guard keeps a second event from rendering every control twice.
  let started = false;
  function start() {
    if (started) return;
    started = true;
    init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
