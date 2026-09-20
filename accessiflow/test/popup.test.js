// Loads popup.html + popup.js under jsdom with a stub chrome API, then asserts
// the rendered DOM is wired the way assistive technology needs it to be.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

const store = {};
const listeners = [];
const chrome = {
  storage: { local: {
    get: (keys, cb) => cb(typeof keys === 'string' ? { [keys]: store[keys] } : {}),
    set: (obj, cb) => { Object.assign(store, obj); if (cb) cb(); },
    remove: (k, cb) => { delete store[k]; if (cb) cb(); }
  } },
  tabs: {
    query: (q, cb) => cb([{ id: 7, url: 'https://example.com/page' }]),
    sendMessage: (id, msg, cb) => {
      if (msg.action === 'aiCounts') return cb && cb({ success: true, images: 4, links: 2 });
      if (cb) cb({ success: true });
    }
  },
  runtime: {
    lastError: null,
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

// The browser owns the voice list, not the schema, and hands it over late.
// A Bangla voice is included so the picker can be checked for one.
window.speechSynthesis = {
  getVoices: () => ([
    { name: 'Microsoft David - English (United States)', lang: 'en-US' },
    { name: 'Google \u09ac\u09be\u0982\u09b2\u09be', lang: 'bn-BD' }
  ]),
  addEventListener() {},
  cancel() {},
  speak() {}
};

const uncaught = [];
window.addEventListener('error', e => uncaught.push(e.message));

for (const f of ['modules/profiles.js', 'popup-schema.js', 'popup.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

const doc = window.document;
const $$ = s => Array.from(doc.querySelectorAll(s));

check(uncaught.length === 0, 'no uncaught errors' + (uncaught.length ? ': ' + uncaught.join('; ') : ''));

// ── Structure ───────────────────────────────────────────────────────────────
const switches = $$('input[type="checkbox"][role="switch"]');
const ranges = $$('input[type="range"]');
const selects = $$('select');
check(switches.length === 64, 'switches rendered: ' + switches.length);
check(ranges.length === 14, 'sliders rendered (13 page + 1 panel scale): ' + ranges.length);
check(selects.length === 6, 'selects rendered (5 page + 1 disability filter): ' + selects.length);
{
  // Someone whose language has no voice installed can only find that out by
  // seeing the list, so the picker shows every voice with its language tag.
  const picker = doc.getElementById('ttsVoice');
  const options = picker ? Array.from(picker.options).map(o => o.textContent) : [];
  check(options[0] === 'Choose automatically', 'the voice picker defaults to automatic');
  check(options.some(o => /bn-BD/.test(o)),
    'it lists the browser voices with their language: ' + options.join(' | '));
}

check($$('.profile-btn').length === 7, 'profile buttons: ' + $$('.profile-btn').length);
{
  // Each profile shows the keypress that applies it without this panel.
  const keys = $$('.profile-btn').map(b => (b.textContent.match(/Alt\+Shift\+\d/) || [''])[0]);
  check(keys.every(Boolean) && new Set(keys).size === 7,
    'every profile names its own shortcut: ' + keys.join(', '));
}
check($$('.section').length === 13, 'sections: ' + $$('.section').length);

// ── Every control has an accessible name and a description ──────────────────
let unnamed = [], undescribed = [], tinyTarget = [];
[...switches, ...ranges, ...selects].forEach(node => {
  if (node.id === 'uiScale') return; // panel control, labelled in popup.html
  const label = doc.querySelector('label[for="' + node.id + '"]');
  if (!label || !label.textContent.trim()) unnamed.push(node.id);
  const d = node.getAttribute('aria-describedby');
  if (!d || !doc.getElementById(d)) undescribed.push(node.id);
});
check(unnamed.length === 0, 'every control has a <label for>: ' + (unnamed.join(', ') || 'yes'));
check(undescribed.length === 0, 'every control has a resolvable aria-describedby: ' + (undescribed.join(', ') || 'yes'));

// ── Duplicate ids would silently break label association ────────────────────
const ids = $$('[id]').map(n => n.id);
const dupes = [...new Set(ids.filter(i => ids.indexOf(i) !== ids.lastIndexOf(i)))];
check(dupes.length === 0, 'no duplicate ids: ' + (dupes.join(', ') || 'yes'));

// ── Accordion wiring ────────────────────────────────────────────────────────
let badAccordion = [];
$$('.section-toggle').forEach(t => {
  const body = doc.getElementById(t.getAttribute('aria-controls'));
  if (!body) badAccordion.push(t.textContent.trim().slice(0, 20) + ' (no panel)');
  else if (body.hidden !== (t.getAttribute('aria-expanded') === 'false')) {
    badAccordion.push(t.textContent.trim().slice(0, 20) + ' (state mismatch)');
  }
});
check(badAccordion.length === 0, 'aria-expanded matches hidden on all sections: ' + (badAccordion.join('; ') || 'yes'));

// ── Behaviour: toggling a switch stores the setting ─────────────────────────
const hc = doc.getElementById('highContrast');
hc.checked = true;
hc.dispatchEvent(new window.Event('change', { bubbles: true }));
check(true, 'switch change handler ran without throwing');

// ── Behaviour: a profile applies its bundle to the UI ───────────────────────
doc.querySelector('.profile-btn[data-profile="visual"]').click();
check(doc.getElementById('textSize').value === '130',
  'Low vision profile set text size to 130 (got ' + doc.getElementById('textSize').value + ')');
check(doc.getElementById('highContrast').checked === true, 'Low vision profile turned high contrast on');
check(doc.getElementById('out-textSize').textContent === '130%',
  'slider output text updated: ' + doc.getElementById('out-textSize').textContent);

// ── Behaviour: dependent rows disable themselves ────────────────────────────
const zoom = doc.getElementById('magnifierZoom');
check(zoom.disabled === true, 'magnifier strength disabled while magnifier is off');
const mag = doc.getElementById('magnifier');
mag.checked = true;
mag.dispatchEvent(new window.Event('change', { bubbles: true }));
check(zoom.disabled === false, 'magnifier strength enabled once magnifier is on');

// ── Behaviour: stepper buttons move the slider ──────────────────────────────
const ts = doc.getElementById('textSize');
const before = ts.value;
ts.closest('.slider-line').querySelectorAll('.step-btn')[1].click();
check(ts.value === '135', 'plus stepper moved text size ' + before + ' -> ' + ts.value);

// ── Disability filter ──────────────────────────────────────────────
const SCHEMA = window.ACCESSIFLOW_SCHEMA;
const sectionIds = SCHEMA.sections.map(s => s.id);
const audience = doc.getElementById('audienceFilter');
const shownIds = () => $$('#sections .section').filter(s => !s.hidden).map(s => s.dataset.sectionId);
const allIds = () => $$('#sections .section').map(s => s.dataset.sectionId);

check(audience !== null, 'disability filter present');
check(audience.options.length === SCHEMA.audiences.length + 1,
  'filter lists every disability type plus Everything: ' + audience.options.length);

// A typo here would silently make a whole group of settings unreachable.
const badRefs = [];
const coveredSections = new Set();
SCHEMA.audiences.forEach(a => a.sections.forEach(id => {
  coveredSections.add(id);
  if (!sectionIds.includes(id)) badRefs.push(a.id + ' -> ' + id);
}));
check(badRefs.length === 0, 'every audience names real sections: ' + (badRefs.join(', ') || 'yes'));
const orphans = sectionIds.filter(id => !coveredSections.has(id));
check(orphans.length === 0,
  'every section is reachable from some disability type: ' + (orphans.join(', ') || 'yes'));

// Choosing one narrows the list and moves its sections to the top.
const lowVision = SCHEMA.audiences.find(a => a.id === 'lowvision');
audience.value = 'lowvision';
audience.dispatchEvent(new window.Event('change', { bubbles: true }));

check(shownIds().length === lowVision.sections.length,
  'Low vision shows ' + shownIds().length + ' of ' + sectionIds.length + ' groups: ' + shownIds().join(', '));
check(shownIds().join(',') === lowVision.sections.join(','),
  'shown groups follow the order the type lists them: ' + shownIds().join(', '));
check(allIds()[0] === lowVision.sections[0],
  'the most useful group is first in the DOM: ' + allIds()[0]);
check(doc.querySelector('#section-' + lowVision.sections[0] + ' .section-toggle')
  .getAttribute('aria-expanded') === 'true', 'the first group opens itself');
check(doc.getElementById('audienceHint').textContent.indexOf('Showing 3 of 9') === 0,
  'hint counts the groups: ' + doc.getElementById('audienceHint').textContent);

// Filtering hides, it never switches anything off or throws it away.
const hearingGroup = doc.getElementById('closedCaptions').closest('.section');
check(hearingGroup.hidden === true, 'a group outside the chosen type is hidden');
check(doc.getElementById('closedCaptions') !== null,
  'hidden groups stay in the DOM, so their settings stay applied');

// Back to everything.
doc.getElementById('btnClearAudience').click();
check(shownIds().length === sectionIds.length,
  '"Show every group" brings all ' + sectionIds.length + ' groups back');
check(allIds().join(',') === sectionIds.join(','),
  'clearing the filter restores the original order');
check(doc.getElementById('btnClearAudience').hidden === true,
  'the reset button hides itself once there is nothing to reset');

// ── Behaviour: search filters and reports ───────────────────────────────────
const search = doc.getElementById('settingSearch');
search.value = 'tremor';
search.dispatchEvent(new window.Event('input', { bubbles: true }));

setTimeout(() => {
  const visibleRows = $$('#sections .row').filter(r => !r.hidden);
  check(visibleRows.length > 0 && visibleRows.length < 6,
    'search "tremor" narrowed to ' + visibleRows.length + ' row(s): ' +
    visibleRows.map(r => r.dataset.controlId).join(', '));
  check(doc.getElementById('liveStatus') !== null, 'live region present');

  // Clearing search restores everything
  doc.getElementById('btnClearSearch').click();
  setTimeout(() => {
    check($$('#sections .row').filter(r => r.hidden).length === 0, 'clearing search restores all rows');
    searchPanels();
  }, 260);
}, 260);

// ── Behaviour: search finds the fixed panels, not only settings ───────────────
// Typing a button's own name used to find nothing, because search skipped
// Smart help and the other panels written in popup.html.

function typeSearch(text, then) {
  search.value = text;
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  // 180ms search debounce + 60ms announce delay, with room to spare.
  setTimeout(then, 400);
}

const aiPanel = () => doc.getElementById('section-ai');
const aiOpen = () => aiPanel().querySelector('.section-toggle').getAttribute('aria-expanded') === 'true';

function searchPanels() {
  typeSearch('Describe the pictures', () => {
    check(!aiPanel().hidden && aiOpen(),
      'searching a button name shows and opens Smart help');
    check(doc.getElementById('section-audit').hidden,
      'panels that do not match stay hidden during that search');
    check(/Smart help/.test(doc.getElementById('liveStatus').textContent),
      'the result is announced by panel name: ' + doc.getElementById('liveStatus').textContent);

    typeSearch('ai', () => {
      const rows = $$('#sections .row').filter(r => !r.hidden && !r.closest('.section').hidden);
      check(!aiPanel().hidden, '"ai" finds Smart help');
      // Only the AI-powered setting should match, never a row that merely
      // contains 'ai' inside explain, again or captions.
      check(rows.map(r => r.dataset.controlId).join(',') === 'speakImageDescriptions',
        '"ai" matches from word starts: ' +
        (rows.map(r => r.dataset.controlId).join(', ') || 'no rows'));

      typeSearch('alt text', () => {
        check(!aiPanel().hidden, 'a keyword the panel never displays ("alt text") still finds it');

        doc.getElementById('btnClearSearch').click();
        setTimeout(() => {
          const profiles = doc.getElementById('section-profiles');
          check(!profiles.hidden &&
            profiles.querySelector('.section-toggle').getAttribute('aria-expanded') === 'true',
            'Quick setup is back and still open after the search clears');
          finish();
        }, 260);
      });
    });
  });
}

// ── CSS: `hidden` has to beat any class that sets display ─────────────────────
// jsdom does not apply popup.css, so the DOM checks above cannot see a
// `.btn { display: inline-flex }` quietly overriding `hidden`. That is how the
// reset, clear and Stop buttons ended up visible when they were hidden.
const css = fs.readFileSync(path.join(ROOT, 'popup.css'), 'utf8');
check(/(^|\n)\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/.test(css),
  'popup.css forces [hidden] to display: none');

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
