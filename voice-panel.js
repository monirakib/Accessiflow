// AccessiFlow voice control panel
//
// Listens for as long as the panel is open, and turns each phrase into one
// command: on the browser's tabs (back, reload, next tab), or on the page
// beside the panel (numbers, clicks, scrolling, typing), which
// modules/voice-nav.js carries out.
//
// Recognition stops by itself: after silence, after about a minute, when the
// network blips. Each time it is started again, with a growing pause if it
// keeps failing, so the user never has to do anything to keep it going.
'use strict';

(function () {
  const VC = window.AccessiFlowVoiceCommands;
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  if (params.get('setup') === '1') { runSetupPage(); return; }

  let recognition = null;
  let running = false;        // the microphone is meant to be on
  let asleep = false;         // paused: listening, but only for "resume"
  let pending = null;         // a command waiting for yes or no
  let failures = 0;           // restarts in a row that ended in an error
  let restartTimer = null;
  let sound = true;
  let audio = null;
  let selfTabId = null;       // set when this page is a tab rather than the panel
  let numbersOn = false;      // numbers stay on every page until "no numbers"

  // ── State shown at the top ───────────────────────────────────────────────

  const STATES = {
    listening: ['Listening', 'Say “what can I say” for the list of commands.'],
    asleep: ['Paused', 'Say “resume” to start again.'],
    micOff: ['Microphone off', 'Nothing can be heard, so saying resume will not work. Press Microphone on.'],
    starting: ['Starting…', '']
  };

  function setState(kind, label, hint) {
    const preset = STATES[kind] || [];
    $('mic').dataset.state = kind === 'starting' ? 'off' : kind;
    $('stateLabel').textContent = label || preset[0] || '';
    $('stateHint').textContent = hint !== undefined ? hint : (preset[1] || '');
  }

  function reply(message, ok) {
    const el = $('reply');
    el.textContent = message;
    el.dataset.ok = String(ok !== false);
  }

  function addLog(heard, did, ok) {
    const li = document.createElement('li');
    if (ok === false) li.className = 'failed';
    const said = document.createElement('span');
    said.className = 'said';
    said.textContent = '“' + heard + '”';
    const result = document.createElement('span');
    result.className = 'did';
    result.textContent = did;
    li.append(said, result);
    const log = $('log');
    log.insertBefore(li, log.firstChild);
    while (log.children.length > 6) log.removeChild(log.lastChild);
  }

  /** A short tone: high when something happened, low when it did not. */
  function beep(ok) {
    if (!sound) return;
    try {
      audio = audio || new AudioContext();
      if (audio.state === 'suspended') audio.resume();
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = ok ? 880 : 240;
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, audio.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (ok ? 0.09 : 0.18));
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + 0.2);
    } catch (e) { /* no sound is not a failure */ }
  }

  function finish(heard, result) {
    const ok = result.ok !== false;
    reply(result.message, ok);
    addLog(heard, result.message, ok);
    beep(ok);
  }

  // ── Help ─────────────────────────────────────────────────────────────────

  function renderHelp() {
    const host = $('helpList');
    VC.HELP.forEach(group => {
      const h = document.createElement('h3');
      h.textContent = group.group;
      const dl = document.createElement('dl');
      group.items.forEach(([say, does]) => {
        const dt = document.createElement('dt');
        dt.textContent = say;
        const dd = document.createElement('dd');
        dd.textContent = does;
        dl.append(dt, dd);
      });
      host.append(h, dl);
    });
  }

  function flashHelp() {
    const help = document.querySelector('.help');
    help.dataset.flash = 'true';
    try { help.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* ok */ }
    setTimeout(() => { help.dataset.flash = 'false'; }, 2000);
  }

  // ── Which tab to act on ──────────────────────────────────────────────────

  /**
   * The page beside the panel: the active tab in this window. When this page
   * is itself a tab (the setup page, or a test), the tab used most recently
   * before it.
   */
  async function targetTab() {
    const tabs = (await chrome.tabs.query({ currentWindow: true })).filter(t => t.id !== selfTabId);
    const active = tabs.find(t => t.active);
    if (active) return active;
    return tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
  }

  function sendToPage(tab, command) {
    return new Promise(resolve => {
      chrome.tabs.sendMessage(tab.id, { action: 'voiceCommand', command: command }, answer => {
        if (chrome.runtime.lastError || !answer) {
          // Either Chrome's own pages, where no extension may run, or a page
          // that was open before AccessiFlow was installed or updated.
          const web = /^(https?|file):/.test(tab.url || '');
          resolve({
            ok: false,
            message: web
              ? 'This page opened before voice control was ready. Say reload.'
              : 'Chrome does not let extensions work on this page. Say go back, next tab, or search for something.'
          });
          return;
        }
        resolve(answer);
      });
    });
  }

  // ── Browser commands ─────────────────────────────────────────────────────

  async function runOnTabs(cmd, tab) {
    const all = (await chrome.tabs.query({ currentWindow: true })).filter(t => t.id !== selfTabId);
    try {
      switch (cmd.type) {
        case 'back':
          await chrome.tabs.goBack(tab.id);
          return { ok: true, message: 'Went back.' };
        case 'forward':
          await chrome.tabs.goForward(tab.id);
          return { ok: true, message: 'Went forward.' };
        case 'reload':
          await chrome.tabs.reload(tab.id);
          return { ok: true, message: 'Reloaded.' };
        case 'newTab':
          await chrome.tabs.create({});
          return { ok: true, message: 'New tab. Say search for, then what you want.' };
        case 'search':
          await chrome.tabs.create({ url: 'https://www.google.com/search?q=' + encodeURIComponent(cmd.query) });
          return { ok: true, message: 'Searching for ' + cmd.query + '.' };
        case 'nextTab':
        case 'prevTab': {
          if (all.length < 2) return { ok: false, message: 'There is only one tab.' };
          const at = all.findIndex(t => t.id === tab.id);
          const step = cmd.type === 'nextTab' ? 1 : -1;
          const to = all[(at + step + all.length) % all.length];
          await chrome.tabs.update(to.id, { active: true });
          return { ok: true, message: to.title ? 'Now on ' + to.title.slice(0, 60) + '.' : 'Switched tab.' };
        }
        case 'closeTab':
          await chrome.tabs.remove(tab.id);
          return { ok: true, message: 'Tab closed.' };
      }
    } catch (e) {
      if (cmd.type === 'back') return { ok: false, message: 'There is nothing to go back to.' };
      if (cmd.type === 'forward') return { ok: false, message: 'There is nothing to go forward to.' };
      return { ok: false, message: 'That did not work: ' + e.message };
    }
    return { ok: false, message: 'Unknown command.' };
  }

  // ── Running a command ────────────────────────────────────────────────────

  function ask(cmd, tab, question) {
    pending = { cmd: Object.assign({}, cmd, { confirmed: true }), tab: tab };
    $('confirmText').textContent = question;
    $('confirm').hidden = false;
    return { ok: true, message: question };
  }

  function clearPending() {
    pending = null;
    $('confirm').hidden = true;
  }

  async function run(cmd) {
    // The panel's own commands.
    if (cmd.type === 'sleep') {
      asleep = true;
      clearPending();
      setState('asleep');
      return { ok: true, message: 'Paused. Say resume to start again.' };
    }
    if (cmd.type === 'wake') return { ok: true, message: 'Already listening.' };
    if (cmd.type === 'help') { flashHelp(); return { ok: true, message: 'Here is what you can say.' }; }
    if (cmd.type === 'yes' || cmd.type === 'no') return { ok: false, message: 'There is nothing to answer yes or no to.' };

    const tab = cmd.confirmed && pending ? pending.tab : await targetTab();
    if (!tab) return { ok: false, message: 'There is no page to control.' };

    if (cmd.where === 'tab') {
      if (cmd.confirm && !cmd.confirmed) {
        return ask(cmd, tab, 'Close ' + (tab.title ? '“' + tab.title.slice(0, 50) + '”' : 'this tab') + '? Say yes or no.');
      }
      return runOnTabs(cmd, tab);
    }

    // Only a yes-or-no question can be cancelled. It does not touch the
    // numbers: those go only when the user says so.
    if (cmd.type === 'cancel') return { ok: true, message: 'Nothing to cancel.' };

    const answer = await sendToPage(tab, cmd);
    if (answer.confirm) return ask(cmd, tab, answer.message);
    if (cmd.type === 'numbers' && answer.ok !== false) setNumbersMode(true);
    if (cmd.type === 'hideNumbers') setNumbersMode(false);
    return answer;
  }

  // ── Numbers follow the user ──────────────────────────────────────────────
  //
  // The page forgets its numbers when it is replaced by the next one, and
  // another tab never had them. The panel remembers the mode and puts the
  // numbers back on whatever page is beside it.

  function setNumbersMode(on) {
    numbersOn = on;
    $('numbersChip').hidden = !on;
  }

  function renumber(tabId, attempt) {
    if (!numbersOn) return;
    chrome.tabs.sendMessage(tabId, { action: 'voiceCommand', command: { type: 'numbers', quiet: true } }, answer => {
      // The page's scripts may not be ready the moment it finishes loading.
      if ((chrome.runtime.lastError || !answer) && (attempt || 0) < 4) {
        setTimeout(() => renumber(tabId, (attempt || 0) + 1), 600);
      }
    });
  }

  async function renumberIfBeside(tabId) {
    if (!numbersOn) return;
    const tab = await targetTab();
    if (tab && tab.id === tabId) renumber(tabId, 0);
  }

  try {
    chrome.tabs.onActivated.addListener(info => renumberIfBeside(info.tabId));
    chrome.tabs.onUpdated.addListener((tabId, change) => {
      if (change.status === 'complete') renumberIfBeside(tabId);
    });
  } catch (e) { /* tests */ }

  /** One finished phrase from the recogniser, with its alternatives. */
  async function hear(alternatives) {
    const heard = String((alternatives[0] && alternatives[0].transcript) || '').trim();
    if (!heard) return;
    $('hearing').textContent = '';
    const cmd = VC.parseAlternatives(alternatives);

    if (asleep) {
      if (cmd && cmd.type === 'wake') {
        asleep = false;
        setState('listening');
        finish(heard, { ok: true, message: 'Resumed. Listening for commands.' });
      }
      return;   // anything else said while asleep is not for us
    }

    if (pending) {
      if (cmd && cmd.type === 'yes') {
        const job = pending;
        clearPending();
        finish(heard, await run(job.cmd));
        return;
      }
      const wasPending = pending;
      clearPending();
      if (!cmd || cmd.type === 'no' || cmd.type === 'cancel') {
        void wasPending;
        finish(heard, { ok: true, message: 'Cancelled. Nothing was changed.' });
        return;
      }
      // Anything else: the question is dropped and the new command runs.
    }

    if (!cmd) {
      // Only answer short phrases that were heard clearly. Long speech is
      // usually someone talking near the microphone, not to it.
      const confidence = alternatives[0].confidence || 0;
      if (heard.split(/\s+/).length <= 6 && (confidence === 0 || confidence >= 0.5)) {
        finish(heard, { ok: false, message: 'That is not a command. Say what can I say.' });
      }
      return;
    }

    let result;
    try { result = await run(cmd); }
    catch (e) { result = { ok: false, message: 'That did not work: ' + e.message }; }
    finish(heard, result);
  }

  // ── Listening ────────────────────────────────────────────────────────────

  function language() {
    // The commands are English for now; an English variant the user speaks
    // is recognised better than a fixed US one.
    const own = navigator.language || '';
    return /^en(-|$)/i.test(own) ? own : 'en-US';
  }

  function start() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setState('error', 'Not available', 'This browser has no speech recognition.');
      return;
    }
    if (recognition) return;

    running = true;
    $('setup').hidden = true;
    $('btnPause').hidden = false;
    $('btnPause').textContent = 'Microphone off';

    const r = new Recognition();
    r.lang = language();
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 3;

    r.onstart = () => setState(asleep ? 'asleep' : 'listening');
    r.onspeechstart = () => { if (!asleep) $('mic').dataset.state = 'hearing'; };
    r.onspeechend = () => { $('mic').dataset.state = asleep ? 'asleep' : 'listening'; };

    r.onresult = event => {
      failures = 0;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal) {
          if (!asleep) $('hearing').textContent = 'Hearing: ' + result[0].transcript;
          continue;
        }
        const alternatives = [];
        for (let j = 0; j < result.length; j++) {
          alternatives.push({ transcript: result[j].transcript, confidence: result[j].confidence });
        }
        hear(alternatives);
      }
    };

    r.onerror = event => {
      switch (event.error) {
        case 'no-speech':
        case 'aborted':
          return;   // ordinary: it is restarted when it ends
        case 'not-allowed':
        case 'service-not-allowed':
          running = false;
          needPermission('denied-now');
          return;
        case 'audio-capture':
          failures++;
          setState('error', 'No microphone', 'Plug in a microphone. Voice control will keep trying.');
          return;
        case 'network':
          failures++;
          setState('error', 'Cannot reach the speech service', 'Check the internet connection. Voice control will keep trying.');
          return;
        default:
          failures++;
          setState('error', 'Listening stopped', 'Error: ' + event.error + '. Trying again.');
      }
    };

    r.onend = () => {
      recognition = null;
      if (!running) return;
      // Straight back on after an ordinary stop; a growing pause after
      // failures, so a lost connection is not hammered.
      const wait = failures ? Math.min(10000, 500 * Math.pow(2, failures)) : 200;
      restartTimer = setTimeout(() => { restartTimer = null; if (running) start(); }, wait);
    };

    recognition = r;
    try { r.start(); } catch (e) {
      recognition = null;
      setState('error', 'Could not start', e.message);
    }
  }

  function stop() {
    running = false;
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    if (recognition) { try { recognition.abort(); } catch (e) { /* ok */ } recognition = null; }
  }

  // ── The microphone permission ────────────────────────────────────────────

  function needPermission(reason) {
    stop();
    $('btnPause').hidden = true;
    $('setup').hidden = false;
    setState('error', 'Microphone needed', '');
    $('setupText').textContent = reason === 'denied'
      ? 'The microphone is blocked for AccessiFlow. The button opens a page that shows how to allow it again.'
      : 'AccessiFlow needs your microphone to hear commands. This is asked once, and then works on every site.';
  }

  async function checkPermission() {
    let status = null;
    try { status = await navigator.permissions.query({ name: 'microphone' }); } catch (e) { /* not supported */ }
    if (!status) { start(); return; }

    const act = () => {
      if (status.state === 'granted') { if (!running) start(); }
      else needPermission(status.state === 'denied' ? 'denied' : 'prompt');
    };
    // Allowed in the setup tab: start here without anyone touching the panel.
    status.onchange = act;
    act();
  }

  // ── The one-off page that asks for the microphone ────────────────────────

  function runSetupPage() {
    $('panel').hidden = true;
    $('setupPage').hidden = false;
    document.title = 'Allow the microphone for AccessiFlow';
    const text = $('setupPageText');
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      stream.getTracks().forEach(t => t.stop());
      text.textContent = 'Done. Voice control is starting in the side panel. This tab closes by itself.';
      setTimeout(() => {
        chrome.tabs.getCurrent(tab => { if (tab) chrome.tabs.remove(tab.id); });
      }, 2000);
    }).catch(err => {
      text.textContent = err && err.name === 'NotAllowedError'
        ? 'The microphone is blocked. Click the icon at the left end of the address bar, set Microphone to Allow, then reload this page.'
        : 'No microphone could be opened: ' + ((err && err.message) || 'unknown error') + '.';
    });
  }

  // ── Start ────────────────────────────────────────────────────────────────

  $('btnAllow').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('voice-panel.html?setup=1') });
  });

  $('btnPause').addEventListener('click', () => {
    if (running) {
      stop();
      asleep = false;
      $('btnPause').textContent = 'Microphone on';
      setState('micOff');
    } else {
      $('btnPause').textContent = 'Microphone off';
      start();
    }
  });

  $('btnYes').addEventListener('click', () => hear([{ transcript: 'yes', confidence: 1 }]));
  $('btnNo').addEventListener('click', () => hear([{ transcript: 'no', confidence: 1 }]));

  $('optSound').addEventListener('change', e => {
    sound = e.target.checked;
    try { chrome.storage.local.set({ voicePanelSound: sound }); } catch (err) { /* ok */ }
  });
  try {
    chrome.storage.local.get('voicePanelSound', data => {
      if (data && typeof data.voicePanelSound === 'boolean') {
        sound = data.voicePanelSound;
        $('optSound').checked = sound;
      }
    });
  } catch (e) { /* ok */ }

  renderHelp();
  setState('starting');

  // Tests drive the panel with words instead of a microphone.
  window.__accessiflowVoiceHear = text => hear([{ transcript: text, confidence: 1 }]);

  chrome.tabs.getCurrent(tab => {
    selfTabId = tab ? tab.id : null;
    checkPermission();
  });
})();
