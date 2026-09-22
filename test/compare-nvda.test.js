// The NVDA comparison tool: its numbers have to mean what the report says
// they mean, or a thesis chapter is built on sand.
const path = require('path');
const C = require(path.join(__dirname, 'eval', 'compare-nvda.js'));

const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

// The same page as each reader says it.
const NVDA = [
  'Corner Shop - Google Chrome',
  'banner landmark  link  Home',
  'navigation landmark  list  with 2 items  link  About',
  'link  Blog',
  'out of list',
  'main landmark  heading  level 1  Welcome',
  'We sell tea and bread.',
  'table  with 2 rows and 2 columns  Item  Price',
  'graphic  unlabeled',
  'Search  edit  blank',
  'content info landmark  Footer text'
].join('\n');
const OURS = [
  'banner landmark, Home, link',
  'Main, navigation landmark, list, 2 items, About, link',
  'Blog, link',
  'out of list, main landmark, heading level 1, Welcome',
  'We sell tea and bread.',
  'table with 2 rows and 2 columns, Item',
  'Price',
  'unlabelled graphic',
  'Search, edit, blank',
  'footer landmark, Footer text'
].join('\n');

{
  check(C.editDistance(['a', 'b', 'c'], ['a', 'c']) === 1, 'edit distance counts one deletion as one');
  check(C.editDistance([], ['a', 'b']) === 2 && C.editDistance(['a'], ['a']) === 0, 'and empty and equal inputs correctly');
  check(C.lcs(['a', 'x', 'b', 'c'], ['a', 'b', 'y', 'c']) === 3, 'the longest common subsequence keeps order');

  check(C.normalise('list with 3 items') === C.normalise('list, 3 items').replace(',', '') ||
    C.words('list with 3 items').join(' ') === C.words('list, 3 items').join(' '),
    'NVDA\'s "list with 3 items" and ours "list, 3 items" become the same words');
  check(C.words('graphic unlabeled').join(' ') === 'graphic unlabelled', 'American and British spellings of unlabelled match');
  check(C.words('content info landmark').join(' ') === 'footer landmark', 'NVDA\'s "content info" is our footer');
  check(C.words('link clickable visited Home').join(' ') === 'link home', 'words only NVDA adds, like "clickable", are set aside');
}

{
  const same = C.compare(OURS, OURS);
  check(same.agreement === 100 && same.coverage === 100 && same.precision === 100,
    'a transcript compared with itself agrees 100%');

  const r = C.compare(OURS, NVDA);
  check(r.agreement > 40 && r.agreement < 100, 'two readers of one page agree partly, word order differing: ' + r.agreement + '%');
  check(r.coverage > 70, 'but most of what NVDA says is said: ' + r.coverage + '%');
  check(r.words.nvda > 0 && r.words.accessiflow > 0, 'word counts are reported');

  const s = r.structure;
  check(s.nvda['heading level 1'] === 1 && s.accessiflow['heading level 1'] === 1, 'headings are counted by level in both');
  check(s.nvda.link === 3 && s.accessiflow.link === 3, 'links are counted in both: ' + s.nvda.link + ' / ' + s.accessiflow.link);
  check(s.nvda.landmark === 4 && s.accessiflow.landmark === 4, 'landmarks, with NVDA\'s "content info" counted: ' + s.nvda.landmark);
  check(s.nvda.list === 1 && s.accessiflow.list === 1, 'lists, whichever way they are worded');
  check(s.nvda.table === 1 && s.accessiflow.table === 1 && s.nvda.edit === 1, 'tables and fields');
  check(r.gaps.moreInNvda.some(d => d.word === 'google'), 'words only one reader said are listed: ' +
    r.gaps.moreInNvda.map(d => d.word).join(' '));

  const md = C.report(r, ['ours.txt', 'nvda.txt']);
  check(/Agreement/.test(md) && /\| heading level 1 \| 1 \| 1 \| same \|/.test(md), 'the report has the measures and a structure table');
}

console.log('=== ' + (errors.length ? 'FAIL' : 'PASS') + ' (' + ok.length + ') ===');
ok.forEach(m => console.log('  + ' + m));
errors.forEach(m => console.log('  - ' + m));
console.log(errors.length ? '\n' + errors.length + ' check(s) failed.' : '\nAll checks passed.');
process.exit(errors.length ? 1 : 0);
