// How closely does AccessiFlow's screen reader say what NVDA says?
//
//   node compare-nvda.js <accessiflow.txt> <nvda.txt> [--report report.md] [--json result.json]
//
// Getting the two transcripts for one page:
//
//   AccessiFlow  cd test/browser && node transcript.js <url>
//                Writes what reading everything (Insert+Down) would say, one
//                line per line, to test/eval/transcripts/.
//
//   NVDA         In Chrome with NVDA running, open the same URL. NVDA menu,
//                Tools, Speech Viewer. Click in the page, press Control+Home,
//                then NVDA+Down arrow and let it read to the end. Select all
//                in the Speech Viewer window, copy, and save as a .txt file.
//
// What is measured, with NVDA as the reference:
//
//   agreement    1 - word edit distance / NVDA's word count. The same idea as
//                word error rate in speech recognition: 100% means the same
//                words in the same order.
//   coverage     how much of what NVDA said AccessiFlow also said, in order
//                (longest common subsequence / NVDA's words).
//   precision    how much of what AccessiFlow said NVDA also said, in order.
//   structure    headings by level, links, landmarks, lists, tables and form
//                controls, counted in each transcript. These are what a blind
//                user navigates by, so a difference here matters more than a
//                difference in wording.
//
// The two readers word some things differently without either being wrong
// ("list with 3 items" and "list, 3 items"). Those are mapped to one form
// before comparing, so the score measures what was said, not house style.
'use strict';

const fs = require('fs');

// NVDA's wording → AccessiFlow's, applied to both, before comparing words.
const PHRASES = [
  [/\blist with (\d+) items?\b/g, 'list $1 items'],
  [/\blist, (\d+) items?\b/g, 'list $1 items'],
  [/\bunlabeled\b/g, 'unlabelled'],
  [/\bcontent ?info landmark\b/g, 'footer landmark'],
  [/\bcomplementary landmark\b/g, 'complementary landmark'],
  [/\bclickable\b/g, ''],
  [/\bvisited\b/g, ''],
  [/\bbullet\b/g, ''],
  [/\bsame page\b/g, ''],
  [/\bdialog\b/g, 'dialogue'],
  [/\bcolor\b/g, 'colour'],
  [/\bnot checked\b/g, 'not checked'],
  [/\bcheckbox\b/g, 'check box'],
  [/\bcombobox\b/g, 'combo box']
];

function normalise(text) {
  // NVDA's Speech Viewer separates the parts of one utterance with runs of spaces.
  let t = String(text).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[ 	]+/g, ' ');
  PHRASES.forEach(([re, to]) => { t = t.replace(re, to); });
  return t;
}

function words(text) {
  return normalise(text).replace(/[^\p{L}\p{N}\p{M}'\s]/gu, ' ').split(/\s+/).filter(Boolean);
}

/** Word-level edit distance, in two rows of memory: transcripts run to thousands of words. */
function editDistance(a, b) {
  let prev = new Int32Array(b.length + 1);
  let cur = new Int32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

function lcs(a, b) {
  let prev = new Int32Array(b.length + 1);
  let cur = new Int32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = 0;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

const STRUCTURE = {
  'heading level 1': /\bheading level 1\b/g,
  'heading level 2': /\bheading level 2\b/g,
  'heading level 3': /\bheading level 3\b/g,
  'heading level 4-6': /\bheading level [4-6]\b/g,
  'link': /\blink\b/g,
  'landmark': /\blandmark\b/g,
  'list': /\blist \d+ items\b/g,
  'table': /\btable with \d+ rows\b/g,
  'edit': /\bedit\b/g,
  'button': /\bbutton\b/g,
  'check box': /\bcheck box\b/g,
  'radio button': /\bradio button\b/g,
  'combo box': /\bcombo box\b/g,
  'graphic': /\bgraphic\b/g,
  'frame': /\bframe\b/g
};

function structure(text) {
  // Counted on the words alone, so commas and spacing never decide a match.
  const t = words(text).join(' ');
  const out = {};
  Object.keys(STRUCTURE).forEach(k => { out[k] = (t.match(STRUCTURE[k]) || []).length; });
  return out;
}

/** Words NVDA said noticeably more often than AccessiFlow, and the other way round. */
function wordGaps(ours, theirs, limit) {
  const count = list => list.reduce((m, w) => m.set(w, (m.get(w) || 0) + 1), new Map());
  const a = count(ours);
  const b = count(theirs);
  const all = new Set([...a.keys(), ...b.keys()]);
  const diffs = [...all].map(w => ({ word: w, nvda: b.get(w) || 0, accessiflow: a.get(w) || 0 }))
    .map(d => Object.assign(d, { gap: d.nvda - d.accessiflow }))
    .filter(d => d.gap !== 0);
  return {
    moreInNvda: diffs.filter(d => d.gap > 0).sort((x, y) => y.gap - x.gap).slice(0, limit),
    moreInAccessiflow: diffs.filter(d => d.gap < 0).sort((x, y) => x.gap - y.gap).slice(0, limit)
  };
}

function compare(oursText, nvdaText) {
  const ours = words(oursText);
  const nvda = words(nvdaText);
  const distance = editDistance(ours, nvda);
  const common = lcs(ours, nvda);
  const pct = x => Math.round(x * 1000) / 10;
  return {
    words: { accessiflow: ours.length, nvda: nvda.length },
    agreement: nvda.length ? pct(Math.max(0, 1 - distance / nvda.length)) : 0,
    coverage: nvda.length ? pct(common / nvda.length) : 0,
    precision: ours.length ? pct(common / ours.length) : 0,
    editDistance: distance,
    structure: { accessiflow: structure(oursText), nvda: structure(nvdaText) },
    gaps: wordGaps(ours, nvda, 12)
  };
}

function report(result, names) {
  const s = result.structure;
  const rows = Object.keys(s.nvda).map(k => {
    const a = s.accessiflow[k];
    const n = s.nvda[k];
    return '| ' + k + ' | ' + n + ' | ' + a + ' | ' + (a === n ? 'same' : (a > n ? '+' : '') + (a - n)) + ' |';
  });
  const gap = list => list.length ? list.map(d => d.word + ' (' + d.nvda + ' vs ' + d.accessiflow + ')').join(', ') : 'none';
  return [
    '# AccessiFlow and NVDA on the same page',
    '',
    'AccessiFlow transcript: `' + names[0] + '`  ',
    'NVDA transcript: `' + names[1] + '`',
    '',
    '| Measure | Value |',
    '|---|---|',
    '| Agreement (1 - word error rate, NVDA as reference) | ' + result.agreement + '% |',
    '| Coverage of what NVDA said, in order | ' + result.coverage + '% |',
    '| Precision: AccessiFlow words NVDA also said, in order | ' + result.precision + '% |',
    '| Words, NVDA / AccessiFlow | ' + result.words.nvda + ' / ' + result.words.accessiflow + ' |',
    '',
    '## Structure',
    '',
    '| What | NVDA | AccessiFlow | Difference |',
    '|---|---|---|---|'
  ].concat(rows).concat([
    '',
    '## Words said more by one reader',
    '',
    'More in NVDA: ' + gap(result.gaps.moreInNvda),
    '',
    'More in AccessiFlow: ' + gap(result.gaps.moreInAccessiflow),
    ''
  ]).join('\n');
}

module.exports = { compare, report, words, normalise, editDistance, lcs, structure };

if (require.main === module) {
  const args = process.argv.slice(2);
  const flag = name => { const i = args.indexOf(name); return i > -1 ? args.splice(i, 2)[1] : null; };
  const reportPath = flag('--report');
  const jsonPath = flag('--json');
  if (args.length < 2) {
    console.error('usage: node compare-nvda.js <accessiflow.txt> <nvda.txt> [--report report.md] [--json result.json]');
    process.exit(2);
  }
  const result = compare(fs.readFileSync(args[0], 'utf8'), fs.readFileSync(args[1], 'utf8'));
  const md = report(result, args);
  if (reportPath) fs.writeFileSync(reportPath, md);
  if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  console.log(md);
}
