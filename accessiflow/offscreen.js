// AccessiFlow offline speech
//
// Speaks languages the computer has no voice for, using eSpeak NG compiled to
// WebAssembly and shipped inside the extension (vendor/espeak). Windows will
// not have a Bangla voice unless somebody installs a language pack, and asking
// a blind user to do that before they can hear their own language is the wall
// this removes. It needs no network, no account and no server.
//
// The voice is robotic. That is the trade: eSpeak is 1.5 MB and always there,
// and it is the same engine NVDA uses for Bengali, so the sound is familiar to
// the people who rely on it.
'use strict';

(function () {
  const DATA_FILES = [
    'phondata', 'phonindex', 'phontab', 'intonations',
    'bn_dict', 'lang/inc/bn'
  ];

  // Languages this build carries data for. Anything else stays with the
  // browser's own voices.
  const SUPPORTED = { bn: 'bn' };

  const DATA_ROOT = '/usr/share/espeak-ng-data';

  function log(msg) { console.log('[AccessiFlow][Speech] ' + msg); }
  function warn(msg) { console.warn('[AccessiFlow][Speech] ' + msg); }

  let dataPromise = null;
  let current = null;        // the sound playing right now
  let natural = null;        // the neural voice, once someone asks for it
  let naturalBroken = false; // one failure is enough; fall back and stay there

  /** The voice data, fetched once and kept for the life of the document. */
  function loadData() {
    if (dataPromise) return dataPromise;
    dataPromise = Promise.all(DATA_FILES.map(name =>
      fetch(chrome.runtime.getURL('vendor/espeak/espeak-ng-data/' + name))
        .then(res => {
          if (!res.ok) throw new Error('missing voice data: ' + name);
          return res.arrayBuffer();
        })
        .then(buffer => [name, new Uint8Array(buffer)])
    )).then(pairs => {
      const files = {};
      pairs.forEach(([name, bytes]) => { files[name] = bytes; });
      return files;
    });
    return dataPromise;
  }

  /**
   * The same engine, asked for phonemes rather than sound.
   *
   * This is what makes the neural voice cheap: Piper needs phonemes, eSpeak
   * produces exactly the ones its Bangla voice was trained on, and eSpeak is
   * already here for the robotic fallback. No second phonemiser to ship.
   */
  async function phonemise(text, lang) {
    const files = await loadData();
    const voice = SUPPORTED[lang];
    if (!voice) throw new Error('no phonemes for ' + lang);

    return new Promise((resolve, reject) => {
      const lines = [];
      const engine = {
        arguments: ['-v', voice, '-q', '--ipa', text],
        print: line => lines.push(line),
        printErr: function () { /* the CLI chatters; nothing useful here */ },
        preRun: [function () { writeData(engine.FS, files); }],
        postRun: function () { resolve(lines.join(' ').trim()); }
      };
      try { EspeakNg(engine); } catch (e) { reject(e); }
    });
  }

  /**
   * One run of the engine, producing a WAV.
   *
   * eSpeak is a command line program; this build keeps that shape, so the
   * arguments are the command line and the result is a file in its in-memory
   * filesystem. Around 30ms for a sentence.
   */
  async function synthesise(text, lang, rate, pitch) {
    const files = await loadData();
    const voice = SUPPORTED[lang];
    if (!voice) throw new Error('no bundled voice for ' + lang);

    // eSpeak counts speed in words per minute and pitch from 0 to 99.
    const speed = Math.max(80, Math.min(450, Math.round(175 * (rate || 1))));
    const tone = Math.max(0, Math.min(99, Math.round(50 * (pitch || 1))));

    return new Promise((resolve, reject) => {
      const engine = {
        arguments: ['-v', voice, '-s', String(speed), '-p', String(tone), '-w', '/out.wav', text],
        preRun: [function () { writeData(engine.FS, files); }],
        postRun: function () {
          try { resolve(engine.FS.readFile('/out.wav')); }
          catch (e) { reject(new Error('the engine produced no sound')); }
        },
        printErr: function (line) { warn(line); }
      };

      try { EspeakNg(engine); } catch (e) { reject(e); }
    });
  }

  /** The engine reads its data from a filesystem, so it gets one. */
  function writeData(FS, files) {
    [DATA_ROOT, DATA_ROOT + '/lang', DATA_ROOT + '/lang/inc'].forEach(dir => {
      try { FS.mkdir(dir); } catch (e) { /* already there */ }
    });
    DATA_FILES.forEach(name => FS.writeFile(DATA_ROOT + '/' + name, files[name]));
  }

  /**
   * The natural voice, if the user has asked for it and it is on this
   * computer. Never downloads on its own: 73 MB behind someone's back is not
   * ours to spend. Any failure falls back to the voice that always works.
   */
  async function naturalWav(message) {
    if (!message.natural || naturalBroken || !self.AccessiFlowVoice || !self.ort) return null;

    try {
      if (!natural) {
        natural = new self.AccessiFlowVoice.NaturalVoice({
          resolve: path => chrome.runtime.getURL(path)
        });
      }
      if (!natural.session && !(await natural.isDownloaded())) return null;   // not here yet

      const phonemes = await phonemise(message.text, message.lang);
      return await natural.speak(phonemes, message.rate);
    } catch (e) {
      warn('natural voice failed, using the built-in one: ' + e.message);
      naturalBroken = true;
      return null;
    }
  }

  /** Fetches the model once, reporting progress to whoever asked. */
  async function downloadVoice(respond) {
    try {
      if (!self.AccessiFlowVoice || !self.ort) throw new Error('the voice runtime is missing');
      if (!natural) {
        natural = new self.AccessiFlowVoice.NaturalVoice({
          resolve: path => chrome.runtime.getURL(path)
        });
      }

      let last = -1;
      await natural.load(fraction => {
        const percent = Math.round(fraction * 100);
        if (percent === last || percent % 10) return;   // every tenth, not every chunk
        last = percent;
        chrome.runtime.sendMessage({ action: 'voiceProgress', percent: percent },
          () => { void chrome.runtime.lastError; });
      });
      naturalBroken = false;
      respond({ success: true });
    } catch (e) {
      warn('download failed: ' + e.message);
      respond({ success: false, error: e.message });
    }
  }

  function stop() {
    if (!current) return;
    try { current.audio.pause(); } catch (e) { /* ok */ }
    try { URL.revokeObjectURL(current.url); } catch (e) { /* ok */ }
    const done = current.done;
    current = null;
    if (done) done({ success: true, stopped: true });
  }

  /** Synthesises, plays, and answers only once the sound has finished. */
  async function speak(message, respond) {
    stop();
    try {
      const wav = (await naturalWav(message)) ||
                  (await synthesise(message.text, message.lang, message.rate, message.pitch));
      const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      const audio = new Audio(url);
      current = { audio: audio, url: url, done: respond };

      const finish = outcome => {
        if (!current || current.audio !== audio) return;   // already replaced
        URL.revokeObjectURL(url);
        current = null;
        respond(outcome);
      };

      audio.onended = () => finish({ success: true });
      audio.onerror = () => finish({ success: false, error: 'the sound could not be played' });
      await audio.play();
      log('speaking ' + message.lang + ', ' + wav.length + ' bytes');
    } catch (e) {
      warn('speak: ' + e.message);
      current = null;
      respond({ success: false, error: e.message });
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.target !== 'offscreen') return;

    if (message.action === 'speakOffline') {
      speak(message, sendResponse);
      return true;              // answered when the sound ends
    }

    if (message.action === 'stopOffline') {
      stop();
      sendResponse({ success: true });
      return;
    }

    if (message.action === 'canSpeakOffline') {
      sendResponse({ success: true, languages: Object.keys(SUPPORTED) });
      return;
    }

    if (message.action === 'downloadVoice') {
      downloadVoice(sendResponse);
      return true;
    }

    if (message.action === 'voiceStatus') {
      (natural ? natural.isDownloaded() : new self.AccessiFlowVoice.NaturalVoice({}).isDownloaded())
        .then(ready => sendResponse({ success: true, downloaded: ready }))
        .catch(() => sendResponse({ success: true, downloaded: false }));
      return true;
    }
  });

  log('offline speech ready for: ' + Object.keys(SUPPORTED).join(', '));
})();
