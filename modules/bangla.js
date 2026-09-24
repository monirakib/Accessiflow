// AccessiFlow BanglaModule
// Bangla/Bengali language-specific accessibility features
// Bangla font optimization, TTS voice priority, form labels, RTL detection
'use strict';

class BanglaModule {
  constructor() {
    this._styleEl = null;
    this._fontInjected = false;
    this._formLabels = [];
    this._translatedEls = [];
  }

  _log(msg) { console.log('[AccessiFlow][Bangla] ' + msg); }
  _warn(msg) { console.warn('[AccessiFlow][Bangla] ' + msg); }

  _getStyle() {
    if (!this._styleEl || !document.head.contains(this._styleEl)) {
      this._styleEl = document.getElementById('accessiflow-bangla-style');
      if (!this._styleEl) {
        this._styleEl = document.createElement('style');
        this._styleEl.id = 'accessiflow-bangla-style';
        document.head.appendChild(this._styleEl);
      }
    }
    return this._styleEl;
  }

  buildCSS(s) {
    let css = '';
    try {
      // Bangla font optimization
      if (s.banglaFont) {
        css += "@font-face { font-family: 'Noto Sans Bengali'; src: url('https://fonts.gstatic.com/s/notosansbengali/v20/Cn-SJsCGWQxOjaGwMQ6fIiMywrNJIky6nvd8BjzVMvnOSw.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; unicode-range: U+0980-09FF; }\n";
        css += "@font-face { font-family: 'Noto Sans Bengali'; src: url('https://fonts.gstatic.com/s/notosansbengali/v20/Cn-SJsCGWQxOjaGwMQ6fIiMywrNJIky6nvd8BjzVMvnOSw.woff2') format('woff2'); font-weight: 700; font-style: normal; font-display: swap; unicode-range: U+0980-09FF; }\n";
        css += "* { font-family: 'Noto Sans Bengali', 'Kalpurush', 'SolaimanLipi', 'Hind Siliguri', sans-serif; }\n";
        // Better rendering for Bangla script
        css += '* { text-rendering: optimizeLegibility !important; -webkit-font-smoothing: antialiased !important; }\n';
        // Increase line height for Bangla conjuncts
        css += ':lang(bn), :lang(bn-BD), [lang="bn"], [lang="bn-BD"] { line-height: 1.8 !important; word-spacing: 0.05em !important; }\n';
      }

      // Larger Bangla text (Bangla glyphs need more space)
      if (s.banglaLargeText) {
        css += ':lang(bn), :lang(bn-BD), [lang="bn"], [lang="bn-BD"] { font-size: 120% !important; letter-spacing: 0.02em !important; }\n';
      }
    } catch (e) { this._warn('buildCSS: ' + e.message); }
    return css;
  }

  // ── Bangla TTS Voice Priority ─────────────────────────────
  applyBanglaTTS(active) {
    try {
      if (active) {
        // Check if page has Bangla content
        const hasBangla = this._detectBanglaContent();
        if (!hasBangla) {
          this._log('No Bangla content detected.');
          return;
        }

        // Try to set Bangla voice in speech synthesis
        const synth = window.speechSynthesis;
        const setBanglaVoice = () => {
          const voices = synth.getVoices();
          const banglaVoice = voices.find(v =>
            v.lang === 'bn-BD' || v.lang === 'bn-IN' ||
            v.lang === 'bn' || v.name.toLowerCase().includes('bangla') ||
            v.name.toLowerCase().includes('bengali')
          );
          if (banglaVoice) {
            this._log('Bangla voice found: ' + banglaVoice.name);
            // Store for TTS engine to use
            if (typeof chrome !== 'undefined' && chrome.storage) {
              chrome.storage.local.set({ accessiflow_bangla_voice: banglaVoice.name });
            }
          } else {
            this._log('No Bangla voice available; using default.');
          }
        };

        if (synth.getVoices().length > 0) {
          setBanglaVoice();
        } else {
          synth.addEventListener('voiceschanged', setBanglaVoice, { once: true });
        }
      }
    } catch (e) { this._warn('applyBanglaTTS: ' + e.message); }
  }

  // ── Detect Bangla Content ─────────────────────────────────
  _detectBanglaContent() {
    try {
      // Check lang attribute
      const lang = document.documentElement.lang || '';
      if (lang.startsWith('bn')) return true;

      // Check for Bangla Unicode range (0x0980-0x09FF)
      const body = document.body.textContent || '';
      const sample = body.substring(0, 3000);
      const banglaRegex = /[\u0980-\u09FF]/;
      return banglaRegex.test(sample);
    } catch (e) { return false; }
  }

  // ── Bangla Form Field Labels ──────────────────────────────
  applyBanglaFormLabels(active) {
    try {
      if (active) {
        // Common form field patterns → Bangla labels
        const fieldMap = {
          'name': 'নাম',
          'full_name': 'পূর্ণ নাম',
          'first_name': 'প্রথম নাম',
          'last_name': 'শেষ নাম',
          'email': 'ইমেইল',
          'phone': 'ফোন নম্বর',
          'mobile': 'মোবাইল নম্বর',
          'address': 'ঠিকানা',
          'city': 'শহর',
          'state': 'রাজ্য/বিভাগ',
          'zip': 'পোস্ট কোড',
          'postal': 'পোস্ট কোড',
          'country': 'দেশ',
          'password': 'পাসওয়ার্ড',
          'confirm_password': 'পাসওয়ার্ড নিশ্চিত করুন',
          'username': 'ব্যবহারকারীর নাম',
          'search': 'অনুসন্ধান',
          'comment': 'মন্তব্য',
          'message': 'বার্তা',
          'subject': 'বিষয়',
          'date': 'তারিখ',
          'dob': 'জন্ম তারিখ',
          'date_of_birth': 'জন্ম তারিখ',
          'gender': 'লিঙ্গ',
          'occupation': 'পেশা',
          'company': 'প্রতিষ্ঠান',
          'website': 'ওয়েবসাইট',
          'submit': 'জমা দিন',
          'cancel': 'বাতিল',
          'register': 'নিবন্ধন',
          'login': 'লগইন',
          'sign_in': 'সাইন ইন',
          'sign_up': 'সাইন আপ',
          'forgot_password': 'পাসওয়ার্ড ভুলে গেছেন?'
        };

        document.querySelectorAll('input, textarea, select').forEach(field => {
          if (field.getAttribute('data-accessiflow-bn-label')) return;

          const name = (field.name || '').toLowerCase().replace(/[-\s]/g, '_');
          const id = (field.id || '').toLowerCase().replace(/[-\s]/g, '_');
          const type = (field.type || '').toLowerCase();
          const placeholder = (field.placeholder || '').toLowerCase().replace(/[-\s]/g, '_');

          let banglaLabel = null;
          // Try to find match
          for (const [key, bn] of Object.entries(fieldMap)) {
            if (name.includes(key) || id.includes(key) || placeholder.includes(key)) {
              banglaLabel = bn;
              break;
            }
          }
          // Type-based fallback
          if (!banglaLabel && type === 'email') banglaLabel = 'ইমেইল';
          if (!banglaLabel && type === 'tel') banglaLabel = 'ফোন নম্বর';
          if (!banglaLabel && type === 'search') banglaLabel = 'অনুসন্ধান';
          if (!banglaLabel && type === 'password') banglaLabel = 'পাসওয়ার্ড';
          if (!banglaLabel && type === 'url') banglaLabel = 'ওয়েবসাইট';

          if (banglaLabel) {
            field.setAttribute('data-accessiflow-bn-label', 'true');

            // Add Bangla hint label. In the page's own text colour: the
            // bright green it used to be is unreadable on a white page.
            const hint = document.createElement('span');
            hint.setAttribute('data-accessiflow-bn-hint', 'true');
            hint.style.cssText = 'display:block;font-size:12px;color:inherit;opacity:.85;font-family:"Noto Sans Bengali","Nirmala UI",sans-serif;margin-top:2px;';
            hint.textContent = banglaLabel;

            // Set Bangla placeholder if empty, and remember to take it away.
            const placeholderAdded = !field.placeholder && field.tagName !== 'SELECT';
            if (placeholderAdded) field.placeholder = banglaLabel;

            const parent = field.parentElement;
            if (parent) {
              parent.insertBefore(hint, field.nextSibling);
            }
            this._formLabels.push({ field, hint, placeholderAdded });
          }
        });

        // Translate common buttons
        document.querySelectorAll('button, input[type="submit"], input[type="button"], input[type="reset"]').forEach(btn => {
          if (btn.getAttribute('data-accessiflow-bn-label')) return;
          const text = (btn.textContent || btn.value || '').toLowerCase().trim();
          const map = {
            'submit': 'জমা দিন',
            'cancel': 'বাতিল',
            'reset': 'রিসেট',
            'search': 'অনুসন্ধান',
            'send': 'পাঠান',
            'save': 'সংরক্ষণ',
            'delete': 'মুছুন',
            'edit': 'সম্পাদনা',
            'close': 'বন্ধ',
            'next': 'পরবর্তী',
            'previous': 'পূর্ববর্তী',
            'back': 'ফিরে যান',
            'continue': 'চালিয়ে যান',
            'login': 'লগইন',
            'log in': 'লগইন',
            'sign up': 'সাইন আপ',
            'register': 'নিবন্ধন',
            'ok': 'ঠিক আছে',
            'yes': 'হ্যাঁ',
            'no': 'না'
          };
          if (map[text]) {
            btn.setAttribute('data-accessiflow-bn-label', 'true');
            btn.setAttribute('data-accessiflow-bn-orig', btn.textContent || btn.value);
            const hint = document.createElement('span');
            hint.setAttribute('data-accessiflow-bn-btn-hint', 'true');
            hint.style.cssText = 'font-size:.85em;color:inherit;margin-left:6px;font-family:"Noto Sans Bengali","Nirmala UI",sans-serif;';
            hint.textContent = '(' + map[text] + ')';
            if (btn.tagName === 'BUTTON') {
              btn.appendChild(hint);
            }
            this._formLabels.push({ field: btn, hint });
          }
        });
      } else {
        this._formLabels.forEach(({ field, hint, placeholderAdded }) => {
          try {
            field.removeAttribute('data-accessiflow-bn-label');
            field.removeAttribute('data-accessiflow-bn-orig');
            if (placeholderAdded) field.removeAttribute('placeholder');
            hint.remove();
          } catch (e) { /* skip */ }
        });
        this._formLabels = [];
      }
    } catch (e) { this._warn('applyBanglaFormLabels: ' + e.message); }
  }

  // ── Bangla Number Conversion ──────────────────────────────
  //
  // Each changed text node is remembered with what it said, and nothing is
  // written onto the page's elements. It used to mark the element instead,
  // skip any element already marked, and leave the marks behind when it put
  // the numbers back, so after any other setting changed (which switches
  // everything off and on again) the numbers stayed in English for good, and
  // only the first number in each element was ever changed.
  _eachText(test, change) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent || parent.closest('script, style, noscript, code, pre, textarea, [id^="accessiflow-"], [contenteditable="true"]')) {
          return NodeFilter.FILTER_REJECT;
        }
        return test(node.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach(n => {
      const before = n.data;
      const converted = change(before);
      if (converted === before) return;
      // Numbers and dates can both change one text; what it said first is
      // what comes back.
      if (!this._changedText.has(n)) {
        this._changedText.add(n);
        this._translatedEls.push({ node: n, original: before });
      }
      n.data = converted;
    });
  }

  _restoreText() {
    this._translatedEls.forEach(({ node, original }) => {
      try { node.data = original; } catch (e) { /* skip */ }
    });
    this._translatedEls = [];
    this._changedText = new WeakSet();
  }

  applyBanglaNumbers(active) {
    try {
      if (!this._changedText) this._changedText = new WeakSet();
      if (active) {
        const banglaDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
        this._eachText(text => /\d/.test(text), text => text.replace(/\d/g, d => banglaDigits[Number(d)]));
      } else {
        this._restoreText();
      }
    } catch (e) { this._warn('applyBanglaNumbers: ' + e.message); }
  }

  // ── Bangla Date Format ────────────────────────────────────
  applyBanglaDateFormat(active) {
    try {
      if (active) {
        const banglaMonths = {
          'january': 'জানুয়ারি', 'february': 'ফেব্রুয়ারি', 'march': 'মার্চ',
          'april': 'এপ্রিল', 'may': 'মে', 'june': 'জুন',
          'july': 'জুলাই', 'august': 'আগস্ট', 'september': 'সেপ্টেম্বর',
          'october': 'অক্টোবর', 'november': 'নভেম্বর', 'december': 'ডিসেম্বর',
          'jan': 'জানু', 'feb': 'ফেব্রু', 'mar': 'মার্চ', 'apr': 'এপ্রি',
          'jun': 'জুন', 'jul': 'জুলা', 'aug': 'আগ', 'sep': 'সেপ্টে',
          'oct': 'অক্টো', 'nov': 'নভে', 'dec': 'ডিসে'
        };
        const banglaDays = {
          'sunday': 'রবিবার', 'monday': 'সোমবার', 'tuesday': 'মঙ্গলবার',
          'wednesday': 'বুধবার', 'thursday': 'বৃহস্পতিবার', 'friday': 'শুক্রবার',
          'saturday': 'শনিবার',
          'sun': 'রবি', 'mon': 'সোম', 'tue': 'মঙ্গল', 'wed': 'বুধ',
          'thu': 'বৃহ', 'fri': 'শুক্র', 'sat': 'শনি'
        };

        const allTerms = Object.assign({}, banglaMonths, banglaDays);
        // Only in a date. Short forms and "May" are ordinary English words
        // too ("the sun", "she sat", "you may"), and used to be translated
        // wherever they appeared; now they change only beside a number, as in
        // "12 Mar" or "Sat 5". Full names of months and days change anywhere.
        const alwaysNames = Object.keys(allTerms).filter(k => k.length > 3 && k !== 'may');
        const dateOnly = Object.keys(allTerms).filter(k => alwaysNames.indexOf(k) === -1);
        if (!this._changedText) this._changedText = new WeakSet();
        const DIGIT = '[0-9\\u09E6-\\u09EF]';
        const pattern = new RegExp(
          '\\b(' + alwaysNames.join('|') + ')\\b' +
          '|(?<=' + DIGIT + '(?:st|nd|rd|th)?[\\s,./-]{0,3})\\b(' + dateOnly.join('|') + ')\\b' +
          '|\\b(' + dateOnly.join('|') + ')\\b(?=[\\s,./-]{0,3}' + DIGIT + ')', 'gi');
        this._eachText(text => { pattern.lastIndex = 0; return pattern.test(text); },
          text => { pattern.lastIndex = 0; return text.replace(pattern, match => allTerms[match.toLowerCase()] || match); });
      }
      // Put back with the numbers, which share this switch.
    } catch (e) { this._warn('applyBanglaDateFormat: ' + e.message); }
  }

  apply(settings) {
    try {
      const css = this.buildCSS(settings);
      this._getStyle().textContent = css;
      this.applyBanglaTTS(!!settings.banglaFont);
      this.applyBanglaFormLabels(!!settings.banglaFormLabels);
      // Dates first, while their numbers are still the ones a date is found by.
      this.applyBanglaDateFormat(!!settings.banglaNumbers); // shares toggle
      this.applyBanglaNumbers(!!settings.banglaNumbers);
    } catch (e) { this._warn('apply: ' + e.message); }
  }

  destroy() {
    try {
      if (this._styleEl) { this._styleEl.remove(); this._styleEl = null; }
      this.applyBanglaFormLabels(false);
      this._restoreText();
    } catch (e) { this._warn('destroy: ' + e.message); }
  }
}

if (typeof window !== 'undefined') window.BanglaModule = BanglaModule;
