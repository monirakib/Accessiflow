// AccessiFlow setup page
//
// Opens by itself when AccessiFlow is installed, and again from the panel's
// "Change my setup". Three questions: what the user needs, a few details for
// those needs, and a check before saving. The answers become "my setup",
// which modules/settings-store.js applies on every website.
//
// It talks from the moment it opens (ui-voice.js, through chrome.tts),
// because the people who most need AccessiFlow set up are the ones who cannot
// see a Start button. Everything it says is also on screen, and everything
// can be done with the keyboard: number keys choose needs, Enter moves on,
// R repeats the question, and Escape silences the voice.
//
// While it talks, AccessiFlow's screen reader runs here too, so the page can
// be read the way NVDA reads one: the arrows line by line, H to a heading,
// B to a button, X to a check box. The keys above are this page's own and
// stay so; the reader asks the page first (pageKey).
'use strict';

(function () {
  const Store = window.AccessiFlowSettings;
  const Voice = window.AccessiFlowUiVoice;
  const PROFILES = window.ACCESSIFLOW_PROFILES || [];
  const SHORTCUTS = window.ACCESSIFLOW_SHORTCUTS || [];

  const params = new URLSearchParams(location.search);
  const again = params.get('again') === '1';
  const updated = params.get('from') === '2';

  const $ = sel => document.querySelector(sel);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  // The needs, in the order of their numbers. The first seven match the
  // Alt+Shift digits, so a number learned here works on every website.
  const NEEDS = PROFILES.map((profile, i) => ({ profile: profile, number: String(i + 1) }));

  const STEPS = ['needs', 'details', 'review', 'saved'];
  let step = 'needs';
  let savedOnce = false;

  // ── Talking ─────────────────────────────────────────────────────────────

  function announce(message) {
    const live = $('#live');
    if (live) {
      live.textContent = '';
      setTimeout(() => { live.textContent = message; }, 60);
    }
    Voice.say(message);
  }

  function setVoice(on, spoken) {
    const button = $('#btnVoice');
    button.setAttribute('aria-pressed', String(on));
    $('#voiceLabel').textContent = on ? 'Voice on' : 'Voice off';
    if (on) {
      Voice.enable({ rate: currentRate(), hostKey: pageKey });
      if (spoken) Voice.say('Voice on. ' + intro(step));
    } else {
      Voice.disable();
    }
  }

  function currentRate() {
    return parseFloat($('#rate').value) || 1;
  }

  // ── What each step says ─────────────────────────────────────────────────

  function needsIntro() {
    const list = NEEDS.map(n => n.number + ', ' + n.profile.need).join('. ');
    return 'Question 1 of 3. What do you need help with? Press a number to choose it, ' +
      'and again to un-choose it. ' + list + '. Press Enter when you are done, ' +
      'or Tab to go through the choices. Press R to hear this again.';
  }

  function detailsIntro() {
    const asks = [];
    if (!$('#qReader').hidden) asks.push('whether you already use a screen reader');
    if (!$('#qRate').hidden) asks.push('how fast I should talk');
    if (!$('#qText').hidden) asks.push('how big text should be');
    asks.push('whether you read Bangla');
    return 'Question 2 of 3. A few details: ' + asks.join(', ') +
      '. Press Tab to move through them, and Enter when you are done.';
  }

  function reviewIntro() {
    const items = Array.from(document.querySelectorAll('#summaryList li')).map(li => li.textContent);
    const keys = SHORTCUTS.filter(s => s.main).map(s => s.spoken);
    return 'Question 3 of 3. Here is your setup. ' + items.join(' ') +
      ' Keys worth knowing: ' + keys.join('. ') + '. Press Enter to save, or Tab to the Back button.';
  }

  function intro(name) {
    if (name === 'needs') return needsIntro();
    if (name === 'details') return detailsIntro();
    if (name === 'review') return reviewIntro();
    return $('#savedText').textContent + ' Press Tab to find the keyboard shortcuts.';
  }

  // ── Steps ───────────────────────────────────────────────────────────────

  function show(name, speak) {
    step = name;
    STEPS.forEach(id => { $('#step-' + id).hidden = id !== name; });
    const index = STEPS.indexOf(name);
    $('#progress').textContent = index < 3 ? 'Question ' + (index + 1) + ' of 3' : 'Done';
    $('#progress').hidden = index >= 3;
    if (name === 'details') prepareDetails();
    if (name === 'review') prepareReview();
    // Focus first, so a screen reader lands on the heading; then the fuller
    // spoken introduction.
    focusQuietly($('#step-' + name + ' h2'));
    if (speak !== false) announce(intro(name));
  }

  /**
   * Moves focus without our voice naming the new spot: the introduction that
   * follows says more, and starting one sentence only to cut it off at once
   * is heard as a stutter.
   */
  function focusQuietly(node) {
    if (!node) return;
    Voice.focusQuietly(node, { preventScroll: node.id === 'h-needs' });
  }

  // ── 1. Needs ────────────────────────────────────────────────────────────

  function renderNeeds() {
    const host = $('#needList');
    NEEDS.forEach(item => {
      const p = item.profile;
      const id = 'need-' + p.id;
      const descId = 'desc-' + p.id;

      const label = el('label', 'need');
      label.setAttribute('for', id);

      const input = el('input');
      input.type = 'checkbox';
      input.id = id;
      input.value = p.id;
      input.setAttribute('aria-describedby', descId);

      const num = el('span', 'need-num', item.number);
      num.setAttribute('aria-hidden', 'true');

      // Named by the need alone and described by the rest, so a screen
      // reader says "Low vision, check box" and then the help, not all of
      // the help twice.
      const text = el('span', 'need-text');
      const name = el('span', 'need-label', p.need);
      name.id = 'name-' + p.id;
      input.setAttribute('aria-labelledby', name.id);
      text.appendChild(name);
      const desc = el('span', 'need-desc', p.desc + ' Key ' + item.number + '.');
      desc.id = descId;
      text.appendChild(desc);

      label.append(input, num, text);
      host.appendChild(label);

      input.addEventListener('change', () => {
        announce(p.need + (input.checked ? ', chosen.' : ', not chosen.'));
      });
    });
  }

  function chosenNeeds() {
    return Array.from(document.querySelectorAll('#needList input:checked')).map(i => i.value);
  }

  function toggleNeedByNumber(number) {
    const item = NEEDS.find(n => n.number === number);
    if (!item) return;
    const input = $('#need-' + item.profile.id);
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── 2. Details ──────────────────────────────────────────────────────────

  function prepareDetails() {
    const needs = chosenNeeds();
    const blind = needs.indexOf('blind') !== -1;
    const seeing = needs.indexOf('visual') !== -1 || needs.indexOf('senior') !== -1;
    $('#qReader').hidden = !blind;
    $('#qRate').hidden = !blind;
    $('#qText').hidden = !seeing;

    // The text size starts at what the chosen bundles would pick, unless the
    // user has already moved it.
    const size = $('#textSize');
    if (seeing && !size.dataset.touched) {
      const bundle = Store.mergeBundles(needs);
      if (bundle.textSize) setSlider(size, bundle.textSize);
    }
  }

  function setSlider(input, value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function initSliders() {
    const rate = $('#rate');
    const size = $('#textSize');
    let previewTimer = null;

    rate.addEventListener('input', () => {
      const value = parseFloat(rate.value);
      $('#rateOut').textContent = value + '×';
      Voice.setRate(value);
      // Heard as it changes, so the right speed is found by ear.
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        if (Voice.on) Voice.say('This is how fast I will talk.');
      }, 250);
    });

    size.addEventListener('input', () => {
      $('#textSizeOut').textContent = size.value + '%';
      $('#textPreview').style.fontSize = size.value + '%';
    });
    size.addEventListener('change', () => {
      size.dataset.touched = '1';
      announce('Text size ' + size.value + ' per cent.');
    });

    document.querySelectorAll('.step-btn').forEach(button => {
      button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.target);
        const stepBy = parseFloat(input.step) * Number(button.dataset.dir);
        const decimals = (String(input.step).split('.')[1] || '').length;
        const next = Math.min(parseFloat(input.max), Math.max(parseFloat(input.min),
          parseFloat((parseFloat(input.value) + stepBy).toFixed(decimals))));
        setSlider(input, next);
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (input === rate && !Voice.on) Voice.preview('This is how fast I will talk.', next);
      });
    });

    $('#btnTryRate').addEventListener('click', () => {
      Voice.preview('This is how fast I will talk. You can change it again later.', currentRate());
    });

    document.querySelectorAll('input[name="ownReader"], input[name="bangla"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const label = radio.closest('label');
        announce((label ? label.textContent.replace(/\s+/g, ' ').trim() : radio.value) + ', selected.');
      });
    });
  }

  // ── 3. Review ───────────────────────────────────────────────────────────

  function answers() {
    const needs = chosenNeeds();
    const seeing = needs.indexOf('visual') !== -1 || needs.indexOf('senior') !== -1;
    const blind = needs.indexOf('blind') !== -1;
    const own = document.querySelector('input[name="ownReader"]:checked');
    const bangla = document.querySelector('input[name="bangla"]:checked');
    return {
      needs: needs,
      ownScreenReader: blind && own && own.value === 'yes',
      textSize: seeing ? parseInt($('#textSize').value, 10) : undefined,
      ttsRate: blind ? currentRate() : undefined,
      bangla: Boolean(bangla && bangla.value === 'yes')
    };
  }

  function summaryItems(a, built) {
    const items = [];
    a.needs.forEach(id => {
      const profile = PROFILES.find(p => p.id === id);
      if (profile) items.push(profile.label + ': ' + profile.desc);
    });
    if (built.screenReader) {
      items.push('AccessiFlow’s own screen reader, on every site. Alt+Shift+Z turns it off and on.');
      items.push('Keys you type are read aloud.');
    } else if (a.needs.indexOf('blind') !== -1) {
      items.push('Works alongside your own screen reader: pages are repaired for it, and nothing is read twice.');
    }
    if (typeof a.textSize === 'number') items.push('Text at ' + a.textSize + ' per cent.');
    if (typeof a.ttsRate === 'number' && a.ttsRate !== 1) items.push('Speaking speed ' + a.ttsRate + ' times normal.');
    if (a.bangla) items.push('A typeface drawn properly for Bangla.');
    if (!items.length) {
      items.push('Nothing is switched on yet. Every setting is still there in the AccessiFlow panel.');
    }
    return items;
  }

  function prepareReview() {
    const a = answers();
    const built = Store.buildSetup(a);
    const list = $('#summaryList');
    list.textContent = '';
    summaryItems(a, built).forEach(text => list.appendChild(el('li', null, text)));
    $('#replaceNote').hidden = !(again || savedOnce);
  }

  function save() {
    const built = Store.buildSetup(answers());
    const out = {};
    out[Store.SETUP_KEY] = built.setup;
    out[Store.READER_KEY] = built.screenReader;
    chrome.storage.local.set(out, () => {
      savedOnce = true;
      $('#savedText').textContent = built.setup.needs.length
        ? 'Saved. Your setup is on for every website, including the tabs you already have open.'
        : 'Saved. Nothing is switched on yet. Open AccessiFlow whenever you want to change that.';
      show('saved');
    });
  }

  // ── Shortcut tables ─────────────────────────────────────────────────────

  function keysCell(keys) {
    const td = el('td');
    keys.split(/\s+to\s+/).forEach((part, i) => {
      if (i) td.appendChild(document.createTextNode(' to '));
      part.split('+').forEach((key, j) => {
        if (j) td.appendChild(document.createTextNode('+'));
        td.appendChild(el('kbd', null, key));
      });
    });
    return td;
  }

  function fillKeys(tbody, list) {
    list.forEach(s => {
      const tr = el('tr');
      tr.append(keysCell(s.keys), el('td', null, s.what));
      tbody.appendChild(tr);
    });
  }

  // ── Keys on this page ───────────────────────────────────────────────────

  /**
   * The keys this page tells people about. `target` is what the key would
   * press: the focused element, or, with the screen reader running here,
   * what its cursor is on. True if the key was used.
   */
  function pageKey(e, target) {
    if (e.altKey || e.ctrlKey || e.metaKey) return false;
    if ((e.key === 'r' || e.key === 'R') && !e.shiftKey) {
      Voice.say(intro(step));
      return true;
    }
    if (step === 'needs' && /^[1-9]$/.test(e.key)) {
      toggleNeedByNumber(e.key);
      return true;
    }
    // Enter moves on, except on a button or a link, which Enter presses.
    if (e.key === 'Enter') {
      const tag = target && target.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return false;
      if (step === 'needs') show('details');
      else if (step === 'details') show('review');
      else if (step === 'review') save();
      return true;
    }
    return false;
  }

  function onKeydown(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target;
    const typing = target && (target.tagName === 'INPUT' && target.type !== 'checkbox' && target.type !== 'radio' && target.type !== 'range');
    if (typing) return;

    if (e.key === 'Escape') {
      // In the screen reader's focus mode (on the speed slider, say) Escape
      // goes back to browse mode, as in NVDA, which is what anyone pressing
      // it there means; it does not silence the page.
      if (Voice.mode() === 'focus') return;
      if (Voice.on) { setVoice(false); announce('Voice off.'); }
      return;
    }
    if (pageKey(e, target)) e.preventDefault();
  }

  // ── Pre-filling from an existing setup ──────────────────────────────────

  function prefill(setup) {
    if (!setup) return;
    (setup.needs || []).forEach(id => {
      const input = $('#need-' + id);
      if (input) input.checked = true;
    });
    const s = setup.settings || {};
    if (setup.ownScreenReader) document.querySelector('input[name="ownReader"][value="yes"]').checked = true;
    if (typeof s.ttsRate === 'number') setSlider($('#rate'), s.ttsRate);
    if (typeof s.textSize === 'number') {
      setSlider($('#textSize'), s.textSize);
      $('#textSize').dataset.touched = '1';
    }
    if (setup.bangla) document.querySelector('input[name="bangla"][value="yes"]').checked = true;
  }

  // ── Start ───────────────────────────────────────────────────────────────

  function init() {
    renderNeeds();
    initSliders();
    fillKeys($('#mainKeys'), SHORTCUTS.filter(s => s.main));
    fillKeys($('#allKeys'), SHORTCUTS);

    $('#btnVoice').addEventListener('click', () => {
      setVoice($('#btnVoice').getAttribute('aria-pressed') !== 'true', true);
    });
    $('#btnNeedsNext').addEventListener('click', () => show('details'));
    $('#btnDetailsNext').addEventListener('click', () => show('review'));
    $('#btnSave').addEventListener('click', save);
    $('#btnSkip').addEventListener('click', () => {
      $('#savedText').textContent = 'No problem. Nothing is switched on. Open AccessiFlow with ' +
        'Alt+Shift+Q whenever you want to set it up.';
      show('saved');
    });
    $('#btnClose').addEventListener('click', () => window.close());
    document.querySelectorAll('[data-back]').forEach(button => {
      button.addEventListener('click', () => show(button.dataset.back));
    });
    document.addEventListener('keydown', onKeydown);

    chrome.storage.local.get([Store.SETUP_KEY, Store.READER_KEY], data => {
      prefill(data[Store.SETUP_KEY]);
      if (updated) {
        $('.hero-lead').textContent = 'AccessiFlow can now remember what you need and use it on ' +
          'every website. Three short questions set it up.';
      }
      // First install: talk straight away. Coming back later: talk only for
      // someone who uses AccessiFlow's own screen reader, since a sighted
      // helper re-running setup does not want the page to start talking.
      const talk = (!again && !updated) || Boolean(data[Store.READER_KEY]);
      setVoice(talk, false);
      focusQuietly($('#h-needs'));
      if (talk) {
        Voice.say('Welcome to AccessiFlow. This page talks, so you can set it up without ' +
          'seeing the screen. If you already use a screen reader, press Escape to turn ' +
          'this voice off. The arrow keys read the page line by line, as in NVDA. ' + needsIntro());
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // For the tests.
  window.__accessiflowSetup = { answers: answers, show: show, save: save, toggleNeedByNumber: toggleNeedByNumber };
})();
