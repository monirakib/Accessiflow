// The setup page: it has to talk from the moment it opens, be usable with
// number keys and Enter alone, and save a setup that does the right thing for
// each answer, especially "blind, with NVDA" versus "blind, with nothing".
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }
const wait = ms => new Promise(r => setTimeout(r, ms));

/** Opens welcome.html fresh, with this storage and query string. */
function open(query, initial) {
  const store = Object.assign({}, initial || {});
  const spoken = [];
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'welcome.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'chrome-extension://test/welcome.html' + (query || '')
  });
  const { window } = dom;
  const uncaught = [];
  window.addEventListener('error', e => uncaught.push(e.message));
  window.close = () => { window.__closed = true; };
  window.chrome = {
    storage: { local: {
      get: (keys, cb) => {
        const out = {};
        [].concat(keys).forEach(k => { if (k in store) out[k] = JSON.parse(JSON.stringify(store[k])); });
        cb(out);
      },
      set: (obj, cb) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); if (cb) cb(); }
    } },
    tts: {
      speak: (text, opts) => spoken.push({ text, rate: opts && opts.rate }),
      stop: () => spoken.push({ stop: true })
    }
  };
  const scripts = Array.from(window.document.querySelectorAll('script[src]')).map(s => s.getAttribute('src'));
  scripts.forEach(f => window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  return { window, doc: window.document, store, spoken, uncaught };
}

const key = (page, k) => page.doc.activeElement.dispatchEvent(
  new page.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const click = (page, id) => page.doc.getElementById(id).click();
const heard = page => page.spoken.filter(s => s.text).map(s => s.text).join(' ');
const shown = (page, step) => !page.doc.getElementById('step-' + step).hidden;

(async () => {
  // ── First install: it talks at once ───────────────────────────────────────
  {
    const page = open('');
    await wait(20);
    check(page.uncaught.length === 0, 'the setup page loads without errors' +
      (page.uncaught.length ? ': ' + page.uncaught.join('; ') : ''));
    check(/^Welcome to AccessiFlow\. This page talks/.test(heard(page)),
      'on first install it speaks straight away, with no click: ' + heard(page).slice(0, 80));
    check(/press Escape to turn this voice off/.test(heard(page)),
      'and first tells a screen reader user how to silence it');
    check(/1, Low vision\. 2, Blind, or I use a screen reader\./.test(heard(page)),
      'then reads the choices with their numbers');
    check(page.doc.getElementById('btnVoice').getAttribute('aria-pressed') === 'true',
      'the voice switch shows the voice is on');
    check(page.doc.querySelectorAll('#needList input[type="checkbox"]').length === window_profiles_count(page),
      'every need is a real check box');
    const first = page.doc.querySelector('#needList input');
    check(page.doc.querySelector('label[for="' + first.id + '"]') &&
      page.doc.getElementById(first.getAttribute('aria-describedby')),
      'each labelled and described');

    // ── Number keys ─────────────────────────────────────────────────────────
    page.spoken.length = 0;
    key(page, '2');
    check(page.doc.getElementById('need-blind').checked, 'pressing 2 chooses "Blind"');
    check(/Blind, or I use a screen reader, chosen\./.test(heard(page)), 'and says so');
    key(page, '9');
    key(page, '9');
    check(!page.doc.getElementById('need-speaking').checked, 'pressing a number twice un-chooses it');

    page.spoken.length = 0;
    key(page, 'r');
    check(/^Question 1 of 3/.test(heard(page)), 'R repeats the question');

    // ── Enter moves on ──────────────────────────────────────────────────────
    key(page, 'Enter');
    check(shown(page, 'details'), 'Enter goes to the details');
    check(!page.doc.getElementById('qReader').hidden && !page.doc.getElementById('qRate').hidden,
      'which ask a blind user about their screen reader and speaking speed');
    check(page.doc.getElementById('qText').hidden, 'and not about text size, which they did not need');
    check(/whether you already use a screen reader/.test(heard(page)), 'and are introduced aloud');

    page.spoken.length = 0;
    const rate = page.doc.getElementById('rate');
    rate.value = '1.6';
    rate.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    await wait(300);
    check(page.spoken.some(s => s.text === 'This is how fast I will talk.' && s.rate === 1.6),
      'moving the speed slider speaks at the new speed, so it is chosen by ear');

    key(page, 'Enter');
    check(shown(page, 'review'), 'Enter goes on to the review');
    check(/AccessiFlow’s own screen reader/.test(page.doc.getElementById('summaryList').textContent),
      'which says the built-in reader will be on');
    check(/Keys worth knowing: Alt Shift Q/.test(heard(page)), 'and reads the keys worth knowing');

    key(page, 'Enter');
    await wait(20);
    const setup = page.store.accessiflow_setup;
    check(setup && setup.needs.join(',') === 'blind', 'Enter saves the setup: ' + JSON.stringify(setup && setup.needs));
    check(page.store.accessiflowScreenReader === true, 'with the built-in reader on, for every site');
    check(setup.settings.keyEcho === 'letters' && setup.settings.ttsRate === 1.6,
      'key echo on and the chosen speed kept');
    check(shown(page, 'saved') && /Saved\. Your setup is on for every website/.test(heard(page)),
      'and it confirms, out loud');
    check(page.doc.querySelectorAll('#allKeys tr').length === page.window.ACCESSIFLOW_SHORTCUTS.length,
      'the finished page lists every shortcut');

    // Escape silences it for good.
    key(page, 'Escape');
    check(page.doc.getElementById('btnVoice').getAttribute('aria-pressed') === 'false',
      'Escape turns the voice off');
    page.spoken.length = 0;
    key(page, 'r');
    check(heard(page) === '', 'and it stays quiet after that');
  }

  // ── Blind, with their own screen reader ───────────────────────────────────
  {
    const page = open('');
    await wait(20);
    key(page, '2');
    key(page, 'Enter');
    page.doc.querySelector('input[name="ownReader"][value="yes"]').click();
    click(page, 'btnDetailsNext');
    click(page, 'btnSave');
    await wait(20);
    const s = page.store.accessiflow_setup;
    check(page.store.accessiflowScreenReader === false && s.ownScreenReader === true,
      'with NVDA or similar, the built-in reader stays off');
    check(s.settings.keyEcho === 'off' && s.settings.ttsReadOnFocus === false,
      'and nothing their reader already says is repeated');
  }

  // ── Low vision: text size, with a preview ─────────────────────────────────
  {
    const page = open('');
    await wait(20);
    key(page, '1');
    key(page, 'Enter');
    check(!page.doc.getElementById('qText').hidden && page.doc.getElementById('qReader').hidden,
      'low vision is asked about text size, not screen readers');
    check(page.doc.getElementById('textSize').value === '130', 'starting at what the bundle would choose');
    const size = page.doc.getElementById('textSize');
    size.value = '170';
    size.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    check(page.doc.getElementById('textPreview').style.fontSize === '170%', 'with a live preview of the size');
    page.doc.querySelector('input[name="bangla"][value="yes"]').click();
    click(page, 'btnDetailsNext');
    click(page, 'btnSave');
    await wait(20);
    const s = page.store.accessiflow_setup;
    check(s.settings.textSize === 170 && s.settings.banglaFont === true && s.bangla === true,
      'the size and the Bangla answer are saved');
    check(page.store.accessiflowScreenReader === false, 'and no screen reader is turned on');
  }

  // ── Skipping writes nothing ───────────────────────────────────────────────
  {
    const page = open('');
    await wait(20);
    click(page, 'btnSkip');
    check(shown(page, 'saved') && !('accessiflow_setup' in page.store),
      '"Skip for now" leaves everything as it was');
  }

  // ── Coming back from the panel ────────────────────────────────────────────
  {
    const page = open('?again=1', {
      accessiflow_setup: { v: 1, needs: ['visual', 'motor'], ownScreenReader: false, bangla: true,
        settings: { textSize: 160 } }
    });
    await wait(20);
    check(heard(page) === '', 'opened again by a sighted user, it stays quiet');
    check(page.doc.getElementById('need-visual').checked && page.doc.getElementById('need-motor').checked,
      'and the earlier answers are already chosen');
    check(page.doc.getElementById('textSize').value === '160' &&
      page.doc.querySelector('input[name="bangla"][value="yes"]').checked,
      'including the details');
    click(page, 'btnNeedsNext');
    click(page, 'btnDetailsNext');
    check(!page.doc.getElementById('replaceNote').hidden, 'and it warns that saving replaces the current setup');
  }
  {
    const page = open('?again=1', { accessiflowScreenReader: true });
    await wait(20);
    check(/Welcome to AccessiFlow/.test(heard(page)),
      'but for someone who uses the built-in reader, it talks again');
  }

  console.log('\n=== PASS (' + ok.length + ') ===');
  ok.forEach(m => console.log('  + ' + m));
  if (errors.length) {
    console.log('\n=== FAIL (' + errors.length + ') ===');
    errors.forEach(m => console.log('  ! ' + m));
    process.exit(1);
  }
  console.log('\nAll checks passed.');
})();

function window_profiles_count(page) {
  return (page.window.ACCESSIFLOW_PROFILES || []).length;
}
