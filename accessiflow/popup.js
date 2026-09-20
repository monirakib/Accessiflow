// AccessiFlow popup
//
// Renders every control from popup-schema.js, so a setting's label, help text
// and search terms are defined in exactly one place. Nothing here builds markup
// from strings: each row is assembled with DOM calls, which keeps the ARIA
// wiring identical for all 70-odd controls and keeps us inside the extension
// content security policy.
'use strict';

(function () {
  const SCHEMA = window.ACCESSIFLOW_SCHEMA;

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
  let settings = {};
  let pageReachable = true;

  // Flattened views of the schema, built once at render time.
  const CONTROLS = new Map();   // id -> control definition
  const SWITCHES = [];
  const SLIDERS = [];
  const SELECTS = [];

  SCHEMA.sections.forEach(section => {
    section.controls.forEach(control => {
      CONTROLS.set(control.id, control);
      if (control.type === 'switch') SWITCHES.push(control.id);
      else if (control.type === 'slider') SLIDERS.push(control.id);
      else if (control.type === 'select') SELECTS.push(control.id);
    });
  });

  const UI_PREFS_KEY = 'accessiflow_ui_prefs';

  // Which disability type the settings list is narrowed to, and what the last
  // filter pass produced. 'all' means no narrowing.
  const AUDIENCES = SCHEMA.audiences || [];
  let currentAudience = 'all';
  let filterState = { groupsShown: SCHEMA.sections.length, hiddenElsewhere: 0 };

  // ── Announcements ───────────────────────────────────────────────────────
  // One polite live region for the whole popup. Several competing live regions
  // make a screen reader talk over itself, so everything funnels through here.

  let announceTimer = null;
  function announce(message) {
    const region = $('#liveStatus');
    if (!region) return;
    // Re-setting identical text does not re-announce, so clear first.
    region.textContent = '';
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { region.textContent = message; }, 60);
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
      scale: parseInt($('#uiScale').value, 10) || 100,
      audience: currentAudience
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
        const prefs = saveUiPrefs();
        announce('Appearance set to ' + $('#themeStateLabel').textContent + '.');
        void prefs;
      });
    });

    const scale = $('#uiScale');
    scale.addEventListener('input', () => {
      $('#out-uiScale').textContent = scale.value + '%';
      saveUiPrefs();
    });

    // The stepper buttons beside the scale slider, authored in popup.html.
    document.querySelectorAll('.step-btn[data-target="uiScale"]').forEach(button => {
      button.addEventListener('click', () => {
        const step = (parseInt(scale.step, 10) || 5) * (button.dataset.step === 'up' ? 1 : -1);
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
      const prefs = data[UI_PREFS_KEY] || {};
      applyUiPrefs(prefs);
      // Silently: reopening the popup is not the moment to be told what you
      // already chose last time.
      setAudience(prefs.audience || 'all', false);
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

  /** Switch row: label + description + a real checkbox with role="switch". */
  function renderSwitch(control) {
    const row = el('div', 'row');
    const descId = 'desc-' + control.id;

    // The whole top line is the label, so the entire width is a hit target,
    // a 44px-tall strip instead of a 30px toggle.
    const main = el('label', 'row-main');
    main.setAttribute('for', control.id);
    main.appendChild(el('span', 'row-label', control.label));

    const input = el('input', 'switch');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.id = control.id;
    input.setAttribute('aria-describedby', descId);
    main.appendChild(input);

    const desc = el('p', 'row-desc', control.desc);
    desc.id = descId;
    if (control.wcag) desc.appendChild(el('span', 'row-wcag', 'WCAG ' + control.wcag));

    row.append(main, desc);

    input.addEventListener('change', () => {
      settings[control.id] = input.checked;
      clearProfileSelection();
      commit();
      announce(control.label + ' ' + (input.checked ? 'on' : 'off') + '.');
      refreshDependants();
    });

    return row;
  }

  /** Slider row: stepper buttons either side, because dragging is not universal. */
  function renderSlider(control) {
    const row = el('div', 'row control-row--slider');
    const descId = 'desc-' + control.id;

    const label = el('label', null, control.label);
    label.setAttribute('for', control.id);

    const line = el('div', 'slider-line');

    const input = el('input');
    input.type = 'range';
    input.id = control.id;
    input.min = control.min;
    input.max = control.max;
    input.step = control.step;
    input.value = control.default;
    input.setAttribute('aria-describedby', descId);

    const out = el('output', null, control.default + control.suffix);
    out.id = 'out-' + control.id;
    out.setAttribute('for', control.id);

    const minus = stepButton('−', 'Less ' + control.label.toLowerCase(), input, -1, out, control);
    const plus = stepButton('+', 'More ' + control.label.toLowerCase(), input, 1, out, control);

    line.append(minus, input, plus, out);

    const desc = el('p', 'row-desc', control.desc);
    desc.id = descId;
    if (control.wcag) desc.appendChild(el('span', 'row-wcag', 'WCAG ' + control.wcag));

    row.append(label, line, desc);

    const onInput = () => {
      const value = roundStep(parseFloat(input.value), control.step);
      out.textContent = value + control.suffix;
      settings[control.id] = value;
      syncStepButtons(input, minus, plus);
      clearProfileSelection();
      commit();
    };
    input.addEventListener('input', onInput);
    // A keyboard or stepper change is worth announcing; a drag is not, or the
    // screen reader never stops talking.
    input.addEventListener('change', () => {
      announce(control.label + ': ' + out.textContent + '.');
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

  function renderSelect(control) {
    const row = el('div', 'row control-row--select');
    const descId = 'desc-' + control.id;

    const label = el('label', null, control.label);
    label.setAttribute('for', control.id);

    const select = el('select');
    select.id = control.id;
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
    if (control.wcag) desc.appendChild(el('span', 'row-wcag', 'WCAG ' + control.wcag));

    row.append(label, select, desc);

    select.addEventListener('change', () => {
      settings[control.id] = select.value;
      clearProfileSelection();
      commit();
      announce(control.label + ': ' + select.options[select.selectedIndex].text + '.');
    });

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
      const row = control.type === 'switch' ? renderSwitch(control)
                : control.type === 'slider' ? renderSlider(control)
                : renderSelect(control);
      row.dataset.controlId = control.id;
      // The group name counts too, so "Hearing" or "বাংলা" lists that whole group.
      row.dataset.search = searchTerms(control) + searchText(section.label);
      if (control.dependsOn) row.dataset.dependsOn = control.dependsOn;
      body.appendChild(row);
    });

    if (section.actions) {
      const actions = el('div', 'section-actions');
      section.actions.forEach(action => {
        const button = el('button', 'btn btn-full ' +
          (action.style === 'primary' ? 'btn-primary' : 'btn-quiet'), action.label);
        button.type = 'button';
        button.id = action.id;
        actions.appendChild(button);
      });
      body.appendChild(actions);
    }

    wrapper.append(heading, body);
    return wrapper;
  }

  function renderProfiles() {
    const grid = $('#profileGrid');
    SCHEMA.profiles.forEach(profile => {
      const button = el('button', 'profile-btn');
      button.type = 'button';
      button.dataset.profile = profile.id;
      button.setAttribute('aria-pressed', 'false');
      button.append(
        iconSvg(profile.icon, 'profile-icon'),
        el('span', 'profile-label', profile.label),
        el('span', 'profile-desc', profile.desc)
      );
      // The shortcut is part of the button's name on purpose: it is how
      // someone who cannot see this panel learns the bundle exists at all.
      if (profile.key) {
        button.appendChild(el('span', 'profile-key', 'Alt+Shift+' + profile.key));
      }
      button.addEventListener('click', () => toggleProfile(profile, button));
      grid.appendChild(button);
    });
  }

  function renderAll() {
    renderProfiles();
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

  // ── Dependent controls ──────────────────────────────────────────────────
  // A magnifier strength slider means nothing with the magnifier off. Those
  // rows are dimmed and marked aria-disabled rather than hidden, so the
  // relationship stays visible and nothing vanishes under a screen reader.

  function refreshDependants() {
    document.querySelectorAll('[data-depends-on]').forEach(row => {
      const active = Boolean(settings[row.dataset.dependsOn]);
      row.classList.toggle('row--inactive', !active);
      row.querySelectorAll('input, select, button').forEach(node => {
        node.disabled = !active;
      });
      if (active) {
        const control = CONTROLS.get(row.dataset.controlId);
        const input = row.querySelector('input[type="range"]');
        const minus = row.querySelector('.step-btn');
        const plus = row.querySelectorAll('.step-btn')[1];
        if (input && minus && plus) syncStepButtons(input, minus, plus);
        void control;
      }
    });
  }

  // ── Settings state ──────────────────────────────────────────────────────

  function defaults() {
    const out = {};
    SWITCHES.forEach(id => { out[id] = Boolean(CONTROLS.get(id).defaultOn); });
    SLIDERS.forEach(id => { out[id] = CONTROLS.get(id).default; });
    SELECTS.forEach(id => { out[id] = CONTROLS.get(id).default; });
    return out;
  }

  function paintFromSettings() {
    SWITCHES.forEach(id => {
      const input = document.getElementById(id);
      if (input) input.checked = Boolean(settings[id]);
    });

    SLIDERS.forEach(id => {
      const control = CONTROLS.get(id);
      const input = document.getElementById(id);
      const out = document.getElementById('out-' + id);
      if (!input) return;
      const value = settings[id] !== undefined ? settings[id] : control.default;
      input.value = value;
      if (out) out.textContent = roundStep(parseFloat(value), control.step) + control.suffix;
      const steps = input.parentElement.querySelectorAll('.step-btn');
      if (steps.length === 2) syncStepButtons(input, steps[0], steps[1]);
    });

    SELECTS.forEach(id => {
      const select = document.getElementById(id);
      if (select) select.value = settings[id] || CONTROLS.get(id).default;
    });

    refreshDependants();
    updateAudienceHint();
  }

  /**
   * Saves to storage and pushes to the page. Storage first: on a page we cannot
   * reach, the choice must still survive for next time.
   *
   * Debounced, because dragging a slider fires `input` on every pixel and the
   * content script rebuilds all of its modules on each applySettings. Without
   * this, the page stutters exactly for the users least able to tolerate it.
   */
  let commitTimer = null;
  function commit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
      if (currentHostname) {
        chrome.storage.local.set({ ['settings_' + currentHostname]: settings });
      }
      if (!currentTabId) return;
      chrome.tabs.sendMessage(currentTabId, { action: 'applySettings', data: settings }, () => {
        if (chrome.runtime.lastError) markPageUnreachable();
      });
    }, 80);
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

  // ── Profiles ────────────────────────────────────────────────────────────

  function toggleProfile(profile, button) {
    const wasOn = button.getAttribute('aria-pressed') === 'true';

    document.querySelectorAll('.profile-btn').forEach(other => {
      other.setAttribute('aria-pressed', 'false');
    });

    settings = defaults();

    if (wasOn) {
      announce(profile.label + ' turned off. Everything is back to normal.');
    } else {
      button.setAttribute('aria-pressed', 'true');
      Object.assign(settings, profile.settings);
      announce(profile.label + ' turned on.');
    }

    paintFromSettings();
    commit();
  }

  /** A hand-picked change means the active preset no longer describes reality. */
  function clearProfileSelection() {
    document.querySelectorAll('.profile-btn[aria-pressed="true"]').forEach(button => {
      button.setAttribute('aria-pressed', 'false');
    });
  }

  function initTurnOff() {
    $('#btnTurnOff').addEventListener('click', async () => {
      const yes = await confirmDialog(
        'Turn everything off?',
        'Every adjustment for this website will be switched off. You can turn them back on whenever you like.',
        'Turn everything off'
      );
      if (!yes) return;
      settings = defaults();
      clearProfileSelection();
      paintFromSettings();
      commit();
      announce('Everything is off. The page is back to normal.');
    });
  }

  // ── Filtering: disability type, then search ───────────────────────
  //
  // Both narrow the same list, so they run in one pass. The chosen disability
  // type decides which sections exist for you at all; the search box looks
  // inside whatever is left. Nothing is deleted and nothing is switched off:
  // "Everything" brings every group straight back.

  function audienceById(id) {
    return AUDIENCES.find(audience => audience.id === id) || null;
  }

  /**
   * Search text for each fixed panel: what it visibly says, plus the schema's
   * extra keywords. Built once, after rendering, so it includes the profile
   * buttons that popup.js adds to Quick setup.
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

  /** Section ids for a disability type: the ones it needs, then the rest. */
  function audiencePlan(id) {
    const audience = audienceById(id);
    if (!audience) return null;
    const all = SCHEMA.sections.map(section => section.id);
    const wanted = audience.sections.filter(sectionId => all.includes(sectionId));
    return {
      wanted,
      order: wanted.concat(all.filter(sectionId => !wanted.includes(sectionId)))
    };
  }

  /** Moves the chosen type's sections to the top, in the order it lists them. */
  function sortSections() {
    const host = $('#sections');
    if (!host) return;
    const plan = audiencePlan(currentAudience);
    const order = plan ? plan.order : SCHEMA.sections.map(section => section.id);
    order.forEach(sectionId => {
      const section = document.getElementById('section-' + sectionId);
      if (section) host.appendChild(section);
    });
  }

  /**
   * One pass over every section and row.
   *
   * `reset` recollapses the accordion and opens the top section of a chosen
   * disability type, so its settings are on screen without a further click.
   */
  function applyFilters(options) {
    const opts = options || {};
    const input = $('#settingSearch');
    const query = input ? input.value.trim() : '';
    const words = searchWords(query);
    const plan = audiencePlan(currentAudience);
    const scope = plan ? new Set(plan.wanted) : null;

    let matches = 0;
    let hiddenElsewhere = 0;
    let groupsShown = 0;
    let opened = false;

    document.querySelectorAll('#sections .section').forEach(section => {
      let hits = 0;
      section.querySelectorAll('.row').forEach(row => {
        const hit = !words.length || matchesAll(row.dataset.search, words);
        row.hidden = !hit;
        if (hit) hits++;
      });

      // Outside the chosen type. Counted but not shown, so a search can say
      // where the rest of its matches went rather than pretend they are not
      // there.
      if (scope && !scope.has(section.dataset.sectionId)) {
        section.hidden = true;
        if (words.length) hiddenElsewhere += hits;
        return;
      }

      section.hidden = words.length > 0 && hits === 0;
      if (!section.hidden) {
        groupsShown++;
        matches += hits;
      }

      const toggle = section.querySelector('.section-toggle');
      if (!toggle) return;
      if (words.length) {
        setSectionOpen(toggle, hits > 0);
      } else if (opts.reset) {
        const open = Boolean(scope) && !section.hidden && !opened;
        setSectionOpen(toggle, open);
        if (open) opened = true;
      }
    });

    // The fixed panels (Smart help, Check this page, ...) are searched by
    // their own text plus the schema's keywords, so typing a button's name
    // finds its button. A match opens the panel; a miss hides it but leaves
    // its open state alone, so Quick setup is still open once search clears.
    // A disability type never hides them: none is specific to one need.
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

    filterState = { groupsShown, hiddenElsewhere };
    updateAudienceHint();
    return { matches, hiddenElsewhere, groupsShown, panelsFound, query };
  }

  /**
   * Settings the user has changed that the chosen type is hiding. A setting
   * that is on but off screen is the one real risk of filtering, so the hint
   * says so plainly instead of leaving someone to hunt for it.
   */
  function hiddenActiveCount() {
    const plan = audiencePlan(currentAudience);
    if (!plan) return 0;
    const base = defaults();
    let count = 0;
    SCHEMA.sections.forEach(section => {
      if (plan.wanted.includes(section.id)) return;
      section.controls.forEach(control => {
        const value = settings[control.id];
        if (value !== undefined && value !== base[control.id]) count++;
      });
    });
    return count;
  }

  function updateAudienceHint() {
    const hint = $('#audienceHint');
    const reset = $('#btnClearAudience');
    const audience = audienceById(currentAudience);

    if (reset) reset.hidden = !audience;
    if (!hint) return;

    // Off screen when nothing is filtered: it would only repeat the select,
    // and a 600px popup has no height to spare. aria-describedby still reads
    // hidden text, so screen readers keep this as the select's description.
    hint.hidden = !audience;
    if (!audience) {
      hint.textContent = 'Choose a need to show only the settings that help with it.';
      return;
    }

    let text = 'Showing ' + filterState.groupsShown + ' of ' +
      SCHEMA.sections.length + ' setting groups.';

    if (filterState.hiddenElsewhere > 0) {
      text += ' ' + filterState.hiddenElsewhere + ' more ' +
        (filterState.hiddenElsewhere === 1 ? 'setting matches' : 'settings match') +
        ' in the groups this hides.';
    }

    const active = hiddenActiveCount();
    if (active > 0) {
      text += ' ' + active + (active === 1 ? ' setting is' : ' settings are') +
        ' still on in a hidden group.';
    }

    hint.textContent = text;
  }

  function setAudience(id, spoken) {
    currentAudience = audienceById(id) ? id : 'all';

    const select = $('#audienceFilter');
    if (select && select.value !== currentAudience) select.value = currentAudience;

    sortSections();
    const result = applyFilters({ reset: true });
    saveUiPrefs();
    if (!spoken) return;

    const audience = audienceById(currentAudience);
    announce(audience
      ? 'Showing ' + result.groupsShown + ' setting groups for ' + audience.label +
        '. The first one is open.'
      : 'Showing every setting group.');
  }

  function initAudience() {
    const select = $('#audienceFilter');
    if (!select) return;

    const everything = el('option', null, 'Everything');
    everything.value = 'all';
    select.appendChild(everything);

    AUDIENCES.forEach(audience => {
      const option = el('option', null, audience.label);
      option.value = audience.id;
      select.appendChild(option);
    });

    select.addEventListener('change', () => setAudience(select.value, true));

    const reset = $('#btnClearAudience');
    if (reset) {
      reset.addEventListener('click', () => {
        setAudience('all', true);
        select.focus();
      });
    }
  }

  // ── Search ──────────────────────────────────────────────────

  function initSearch() {
    const input = $('#settingSearch');
    const clear = $('#btnClearSearch');

    const run = () => {
      const query = input.value.trim();
      clear.hidden = !query;

      if (!query) {
        applyFilters({ reset: true });
        announce('Search cleared.');
        return;
      }

      const result = applyFilters();
      const found = [];
      if (result.matches) {
        found.push(result.matches + (result.matches === 1 ? ' setting' : ' settings'));
      }
      if (result.panelsFound.length) found.push(result.panelsFound.join(' and '));
      let message = found.length
        ? 'Found ' + found.join(', and ') + '.'
        : 'Nothing matches ' + query + '.';

      if (result.hiddenElsewhere > 0) {
        const audience = audienceById(currentAudience);
        message += ' ' + result.hiddenElsewhere + ' more ' +
          (result.hiddenElsewhere === 1 ? 'is' : 'are') + ' outside ' +
          (audience ? audience.label : 'the chosen need') + '.';
      }

      announce(message);
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

  function confirmDialog(title, body, confirmLabel, cancelLabel) {
    const backdrop = $('#dialogBackdrop');
    const dialog = $('#dialog');
    const confirmBtn = $('#dialogConfirm');
    const cancelBtn = $('#dialogCancel');
    const previouslyFocused = document.activeElement;

    $('#dialogTitle').textContent = title;
    $('#dialogBody').textContent = body;
    confirmBtn.textContent = confirmLabel || 'Yes';
    cancelBtn.textContent = cancelLabel || 'Cancel';
    backdrop.hidden = false;
    confirmBtn.focus();

    return new Promise(resolve => {
      const finish = answer => {
        backdrop.hidden = true;
        if (releaseDialog) releaseDialog();
        releaseDialog = null;
        if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
        resolve(answer);
      };

      const onKeydown = e => {
        if (e.key === 'Escape') { e.stopPropagation(); finish(false); return; }
        if (e.key !== 'Tab') return;
        // Keep Tab inside the dialog: with only two buttons, alternate them.
        const focusables = [cancelBtn, confirmBtn];
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

  function initTTS() {
    const read = $('#btnTTSRead');
    const stop = $('#btnTTSStop');
    if (read) read.addEventListener('click', () => {
      sendAction('ttsReadPage');
      announce('Reading the page aloud.');
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

  function setAiBusy(busy) {
    ['#btnAiAltText', '#btnAiSummary', '#btnAiLinks'].forEach(sel => {
      $(sel).disabled = busy;
    });
    $('#btnAiCancel').hidden = !busy;
    $('#aiProgress').hidden = !busy;
    if (!busy) $('#aiProgressFill').style.width = '0';
  }

  // Set once the proxy answers; the counts need both this and a known tab, and
  // the two arrive in whichever order they please.
  let aiAvailable = false;

  function refreshAiCounts() {
    if (!aiAvailable || !currentTabId) return;
    sendAction('aiCounts', response => {
      if (!response || !response.success) return;
      const images = $('#aiImageCount');
      const links = $('#aiLinkCount');
      images.textContent = response.images > 0 ? String(response.images) : '';
      links.textContent = response.links > 0 ? String(response.links) : '';

      if (response.images === 0 && response.links === 0) {
        setAiStatus('This page already describes its pictures and names its links well.');
      }
    });
  }

  function initAI() {
    chrome.runtime.onMessage.addListener(message => {
      if (message && message.action === 'voiceProgress') {
        const button = $('#btnDownloadVoice');
        if (button) button.textContent = 'Downloading the natural voice… ' + message.percent + '%';
        // Every tenth, so a screen reader is informed but not flooded.
        if (message.percent % 20 === 0) announce(message.percent + ' per cent downloaded.');
        return;
      }
      if (!message || message.action !== 'aiProgress') return;
      const percent = message.total ? Math.round((message.done / message.total) * 100) : 0;
      $('#aiProgressFill').style.width = percent + '%';
      setAiStatus(message.kind === 'images'
        ? 'Describing picture ' + message.done + ' of ' + message.total + '…'
        : 'Rewriting link ' + message.done + ' of ' + message.total + '…');
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
        if (!response || !response.success) {
          setAiStatus((response && response.error) || 'That did not work. Please try again.', 'error');
          return;
        }
        const r = response.result;
        if (r.error) {
          setAiStatus(r.described > 0
            ? 'Described ' + r.described + ' pictures, then stopped: ' + r.error
            : r.error, 'error');
        } else if (r.total === 0) {
          setAiStatus('Every picture on this page already has a description.', 'success');
        } else {
          const skipped = r.skipped > 0
            ? ' ' + r.skipped + ' could not be read by the browser.' : '';
          setAiStatus('Described ' + r.described + ' of ' + r.total + ' pictures.' + skipped, 'success');
        }
        announce($('#aiStatus').textContent);
        refreshAiCounts();
      });
    });

    $('#btnAiSummary').addEventListener('click', () => {
      setAiBusy(true);
      setAiStatus('Reading the page…');

      sendAction('aiSummarizePage', response => {
        setAiBusy(false);
        if (!response || !response.success) {
          setAiStatus((response && response.error) || 'That did not work. Please try again.', 'error');
          announce($('#aiStatus').textContent);
          return;
        }
        setAiStatus('Summary added to the top of the page.', 'success');
        announce('Summary added to the top of the page. ' + (response.summary || ''));
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

    // If the proxy is not reachable, say so before the user presses anything.
    chrome.runtime.sendMessage({ action: 'aiHealth' }, health => {
      if (chrome.runtime.lastError || !health) return;
      if (health.available) {
        aiAvailable = true;
        refreshAiCounts();
        return;
      }

      ['#btnAiAltText', '#btnAiSummary', '#btnAiLinks'].forEach(sel => {
        $(sel).disabled = true;
      });
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
      : 'This page is hard to use. Turn on a profile above to make it workable.';
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

  function initDataActions() {
    $('#btnResetSettings').addEventListener('click', async () => {
      const yes = await confirmDialog(
        'Start again for ' + currentHostname + '?',
        'Your saved choices for this website will be forgotten and the page will go back to normal. Other websites keep their settings.',
        'Start again'
      );
      if (!yes) return;

      sendAction('resetSettings');
      chrome.storage.local.remove('settings_' + currentHostname);
      settings = defaults();
      clearProfileSelection();
      paintFromSettings();
      commit();
      announce('Settings for this website have been cleared.');
    });

    $('#btnExportSettings').addEventListener('click', () => {
      const payload = {
        version: 2,
        site: currentHostname,
        savedOn: new Date().toISOString().slice(0, 10),
        settings: settings
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      );
      const link = el('a');
      link.href = url;
      link.download = 'accessiflow-' + currentHostname + '.json';
      link.click();
      URL.revokeObjectURL(url);
      announce('Settings saved to a file.');
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
          // Accept both the v2 wrapper and a bare v1 settings object, and keep
          // only keys we still recognise, so an old file cannot inject junk.
          const incoming = parsed.settings && typeof parsed.settings === 'object'
            ? parsed.settings
            : parsed;

          const clean = defaults();
          let applied = 0;
          Object.keys(incoming).forEach(key => {
            if (!CONTROLS.has(key)) return;
            clean[key] = incoming[key];
            applied++;
          });

          if (!applied) throw new Error('nothing recognised');

          settings = clean;
          clearProfileSelection();
          paintFromSettings();
          commit();
          announce('Loaded ' + applied + ' settings from the file.');
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

  // ── Help ────────────────────────────────────────────────────────────────

  function initHelp() {
    $('#btnHelp').addEventListener('click', () => {
      confirmDialog(
        'Keyboard shortcuts',
        'Alt+Shift+1 to 7 turn on a profile without opening this panel: ' +
        '1 low vision, 2 screen reader, 3 hand movement, 4 reading support, ' +
        '5 focus, 6 seizure safety, 7 easier all round. ' +
        'Alt+Shift+8 turns everything off and Alt+Shift+9 reads the list aloud. ' +
        'Alt+Shift+Q opens AccessiFlow. Alt+Shift+A turns it on and off. ' +
        'Alt+Shift+R reads the page aloud and Alt+Shift+S stops. ' +
        'Alt+Shift+C switches high contrast, and Alt+Shift+M switches the reading mask. ' +
        'Inside this panel, Tab moves between controls and Space switches them on or off.',
        'Got it', 'Close'
      );
    });
  }

  // ── Start ───────────────────────────────────────────────────────────────

  function init() {
    renderAll();
    buildPanelSearch();
    initAudience();
    initAppearance();
    initSearch();
    initTurnOff();
    initTTS();
    initVoiceDownload();
    initAI();
    initAudit();
    initDataActions();
    initHelp();

    settings = defaults();
    paintFromSettings();

    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs && tabs[0];
      if (!tab) return;

      currentTabId = tab.id;
      try {
        currentHostname = new URL(tab.url).hostname || 'this page';
      } catch (_) {
        currentHostname = 'this page';
      }
      $('#currentHostname').textContent = currentHostname;

      chrome.storage.local.get('settings_' + currentHostname, data => {
        const saved = data['settings_' + currentHostname];
        if (saved) settings = Object.assign(defaults(), saved);
        paintFromSettings();
        matchProfileToSettings();
      });

      // Confirms the content script is present, so the "cannot change this
      // page" notice appears before the user tries anything.
      chrome.tabs.sendMessage(currentTabId, { action: 'ping' }, () => {
        if (chrome.runtime.lastError) markPageUnreachable();
      });

      refreshAiCounts(); // no-op unless the health check already came back

    });
  }

  /** If saved settings happen to be exactly one profile, show it as selected. */
  function matchProfileToSettings() {
    const base = defaults();
    SCHEMA.profiles.forEach(profile => {
      const expected = Object.assign({}, base, profile.settings);
      const same = Object.keys(expected).every(key => settings[key] === expected[key]);
      if (!same) return;
      const button = document.querySelector('.profile-btn[data-profile="' + profile.id + '"]');
      if (button) button.setAttribute('aria-pressed', 'true');
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
