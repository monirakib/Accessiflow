// AccessiFlow word prediction
//
// Whole words offered above the on-screen keyboard, so a long word costs a
// few clicks instead of one for every letter. The words come from three
// places, all of them on this computer:
//   • the page being read, because what someone types is usually about it
//     (a name on a form, a product, a place), and because that works in any
//     language, Bangla included, with no dictionary to ship
//   • what the user has typed on this page, counted more heavily
//   • a short list of the commonest English words, for pages with little
//     text of their own, such as a search page or a login form
// Nothing is kept once the page closes and nothing is sent anywhere.
'use strict';

(function () {
  if (typeof window !== 'undefined' && window.AccessiFlowWordPredict) return;

  const COMMON = (
    'the be to of and in that have it for not on with he as you do at this but his by from they we say her she or ' +
    'an will my one all would there their what so up out if about who get which go me when make can like time no just ' +
    'him know take people into year your good some could them see other than then now look only come its over think ' +
    'also back after use two how our work first well way even new want because any these give day most us is was are ' +
    'were been has had did said got made went thing tell very where find here should need feel life child world school ' +
    'still try last ask never leave call keep hand high place same while might great little own old right big different ' +
    'small large next early young important few public bad able long help show hear play run move live believe hold ' +
    'bring happen write provide sit stand lose pay meet include continue set learn change lead understand watch follow ' +
    'stop create speak read allow add spend grow open walk win offer remember love consider appear buy wait serve die ' +
    'send expect build stay fall cut reach kill remain suggest raise pass sell require report decide pull please thank ' +
    'thanks hello welcome today tomorrow yesterday morning evening night week month home house family friend mother ' +
    'father money business service information number name email address phone city country government company ' +
    'question problem answer result reason example point group part system program office health doctor hospital ' +
    'medicine water food order price account password login search message letter form date birth student teacher ' +
    'university college job class book story news video picture photo music game member area room door car road ' +
    'street market shop bank card payment ticket travel train flight hotel weather again always sometimes often ' +
    'maybe really already another around before between during without against under through together however ' +
    'something nothing everything anything someone everyone anyone yes okay sorry sure fine best better more less ' +
    'many much every each both such those being having doing going coming getting making taking using looking working ' +
    'please information available application download update contact support message online free social national ' +
    'international local private personal special possible necessary interested certain clear full real true'
  ).split(' ');

  // Letters of any script, their accent marks, digits, and the joiners words use.
  const WORD = /[\p{L}\p{M}][\p{L}\p{M}\p{N}'’-]*/gu;
  const TAIL = /[\p{L}\p{M}][\p{L}\p{M}\p{N}'’-]*$/u;
  const MIN_LENGTH = 3;
  const PAGE_CHARS = 200000;      // enough for any real page; a cap for the rest
  const STALE_MS = 20000;         // the page is read again at most this often

  const lower = w => w.toLocaleLowerCase();

  class WordPredictor {
    /**
     * @param {object} [options]
     * @param {function(): string} [options.text] the page's text, read when needed
     */
    constructor(options) {
      const o = options || {};
      this._text = o.text || (() => '');
      this._page = new Map();     // lower-case word -> { count, shown }
      this._typed = new Map();    // lower-case word -> times typed on this page
      this._readAt = 0;
      this._common = new Map();
      COMMON.forEach((w, i) => { if (!this._common.has(w)) this._common.set(w, 3 - (i / COMMON.length) * 2); });
    }

    /** Reads the page's words again, unless it did so recently. */
    _readPage(force) {
      if (!force && this._readAt && Date.now() - this._readAt < STALE_MS) return;
      this._readAt = Date.now();
      const counts = new Map();
      let text = '';
      try { text = String(this._text() || '').slice(0, PAGE_CHARS); } catch (e) { text = ''; }
      const found = text.match(WORD) || [];
      for (let i = 0; i < found.length; i++) {
        const shown = found[i].replace(/['’-]+$/, '');
        if (shown.length < MIN_LENGTH) continue;
        const key = lower(shown);
        const entry = counts.get(key);
        if (!entry) counts.set(key, { count: 1, shown: shown });
        else {
          entry.count++;
          // Lower case wins if it is ever seen that way: "The" at the start
          // of a sentence is still "the". A name keeps its capital.
          if (shown === key) entry.shown = shown;
        }
      }
      this._page = counts;
    }

    /** A word the user has finished typing. Counted for the rest of this page. */
    learn(word) {
      const w = String(word || '').replace(/['’-]+$/, '');
      if (w.length < MIN_LENGTH || !TAIL.test(w)) return;
      const key = lower(w);
      const entry = this._typed.get(key);
      if (entry) entry.count++;
      else this._typed.set(key, { count: 1, shown: w });
    }

    /**
     * Words that complete `prefix`, best first. Written the way the user
     * started it: "Dh" gives "Dhaka", "DH" gives "DHAKA".
     */
    suggest(prefix, limit) {
      const start = String(prefix || '');
      if (!start || !TAIL.test(start)) return [];
      this._readPage(false);
      const key = lower(start);
      const max = limit || 3;
      const scored = [];
      const seen = new Set();
      const consider = word => {
        if (seen.has(word)) return;
        seen.add(word);
        if (word.length <= key.length || word.indexOf(key) !== 0) return;
        const page = this._page.get(word);
        const typed = this._typed.get(word);
        const score = Math.log2(1 + (page ? page.count : 0)) * 2 +
          (typed ? typed.count : 0) * 4 +
          (this._common.get(word) || 0);
        scored.push({ word: word, shown: (page && page.shown) || (typed && typed.shown) || word, score: score });
      };
      this._typed.forEach((entry, word) => consider(word));
      this._page.forEach((entry, word) => consider(word));
      this._common.forEach((weight, word) => consider(word));
      scored.sort((a, b) => b.score - a.score || a.word.length - b.word.length || (a.word < b.word ? -1 : 1));

      const allCaps = start.length > 1 && start === start.toLocaleUpperCase() && start !== lower(start);
      const capital = start[0] !== lower(start[0]);
      return scored.slice(0, max).map(s => {
        if (allCaps) return s.shown.toLocaleUpperCase();
        if (capital) return s.shown[0].toLocaleUpperCase() + s.shown.slice(1);
        return s.shown;
      });
    }

    /** Forgets the page's words, so the next suggestion reads it again. */
    refresh() { this._readAt = 0; }
  }

  /** The part-typed word just before the caret, and where it starts; null if none. */
  function wordBefore(field) {
    try {
      if (!field) return null;
      if (field.isContentEditable) {
        const sel = (field.ownerDocument || document).getSelection();
        if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
        const node = sel.anchorNode;
        if (!node || node.nodeType !== 3) return null;
        const before = node.data.slice(0, sel.anchorOffset);
        const m = TAIL.exec(before);
        return m ? { word: m[0], node: node, start: sel.anchorOffset - m[0].length, end: sel.anchorOffset } : null;
      }
      if (typeof field.selectionStart !== 'number' || field.selectionStart !== field.selectionEnd) return null;
      const before = String(field.value || '').slice(0, field.selectionStart);
      const m = TAIL.exec(before);
      return m ? { word: m[0], start: field.selectionStart - m[0].length, end: field.selectionStart } : null;
    } catch (e) { return null; }
  }

  window.AccessiFlowWordPredict = {
    create: options => new WordPredictor(options),
    wordBefore: wordBefore,
    COMMON: COMMON
  };
})();
