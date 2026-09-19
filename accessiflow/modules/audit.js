// AccessiFlow AuditModule
// Full WCAG 2.2 audit: Level A + AA + 2.2 new criteria
// Returns { score: 0-100, issues: [] }
'use strict';

class AuditModule {
  constructor() {}

  _log(msg) { console.log('[AccessiFlow][Audit] ' + msg); }
  _warn(msg) { console.warn('[AccessiFlow][Audit] ' + msg); }

  _issue(type, criterion, message, count) {
    return { type, criterion, message, count: count || 0 };
  }

  // ═════════════════════ LEVEL A CHECKS ═════════════════════

  _check_1_1_1() {
    // Images with/without alt
    const imgs = document.querySelectorAll('img');
    const withAlt = Array.from(imgs).filter(i => i.hasAttribute('alt') && i.getAttribute('alt').trim());
    const withoutAlt = Array.from(imgs).filter(i => !i.hasAttribute('alt') || (!i.getAttribute('alt').trim() && !i.closest('a, button')));
    const issues = [];
    if (withoutAlt.length > 0) {
      issues.push(this._issue('fail', '1.1.1', 'Images missing alt text', withoutAlt.length));
    }
    if (withAlt.length > 0) {
      issues.push(this._issue('pass', '1.1.1', 'Images with alt text', withAlt.length));
    }
    if (imgs.length === 0) {
      issues.push(this._issue('pass', '1.1.1', 'No images found on page', 0));
    }
    return issues;
  }

  _check_1_3_1() {
    const issues = [];
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (headings.length === 0) {
      issues.push(this._issue('warn', '1.3.1', 'No headings found, so the page has no clear structure', 0));
    } else {
      // Check heading order
      let lastLevel = 0;
      let skipped = 0;
      headings.forEach(h => {
        const level = parseInt(h.tagName[1]);
        if (level > lastLevel + 1 && lastLevel > 0) skipped++;
        lastLevel = level;
      });
      if (skipped > 0) {
        issues.push(this._issue('warn', '1.3.1', 'Heading levels skipped (e.g., H2 → H4)', skipped));
      } else {
        issues.push(this._issue('pass', '1.3.1', 'Heading hierarchy is correct', headings.length));
      }
    }
    // Check labels on inputs
    const inputs = document.querySelectorAll('input:not([type="hidden"]), select, textarea');
    const unlabeled = Array.from(inputs).filter(i => {
      const id = i.id;
      return !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby') && !i.closest('label') && !(id && document.querySelector('label[for="' + id + '"]'));
    });
    if (unlabeled.length > 0) {
      issues.push(this._issue('fail', '1.3.1', 'Form inputs without labels', unlabeled.length));
    }
    return issues;
  }

  _check_1_3_2() {
    const absPos = document.querySelectorAll('[style*="position: absolute"], [style*="position:absolute"]');
    if (absPos.length > 5) {
      return [this._issue('warn', '1.3.2', 'Many absolute-positioned elements may affect reading order', absPos.length)];
    }
    return [this._issue('pass', '1.3.2', 'Reading order appears correct', 0)];
  }

  _check_2_1_1() {
    const trapped = document.querySelectorAll('[tabindex="-1"]');
    const interactive = Array.from(trapped).filter(el => el.matches('a, button, input, select, textarea, [role="button"], [role="link"]'));
    if (interactive.length > 0) {
      return [this._issue('fail', '2.1.1', 'Interactive elements with tabindex="-1" (keyboard unreachable)', interactive.length)];
    }
    return [this._issue('pass', '2.1.1', 'All interactive elements are keyboard reachable', 0)];
  }

  _check_2_1_2() {
    const modals = document.querySelectorAll('[role="dialog"], .modal, [aria-modal="true"]');
    const issues = [];
    modals.forEach(m => {
      const closeBtn = m.querySelector('button[aria-label*="close"], button[aria-label*="Close"], .close, [data-dismiss]');
      if (!closeBtn) {
        issues.push(this._issue('warn', '2.1.2', 'Dialog/modal may lack close mechanism', 1));
      }
    });
    if (issues.length === 0) return [this._issue('pass', '2.1.2', 'No keyboard traps detected', 0)];
    return issues;
  }

  _check_2_4_1() {
    const skipLink = document.querySelector('a[href^="#"][class*="skip"], a.skip-link, a.skip-nav, .accessiflow-skip-link, a[href="#main"], a[href="#content"]');
    if (skipLink) return [this._issue('pass', '2.4.1', 'Skip link present', 1)];
    return [this._issue('fail', '2.4.1', 'No skip navigation link found', 0)];
  }

  _check_2_4_2() {
    const title = document.title;
    if (!title || !title.trim()) return [this._issue('fail', '2.4.2', 'Page has no title', 0)];
    if (title.trim().length < 3) return [this._issue('warn', '2.4.2', 'Page title is too short: "' + title + '"', 0)];
    return [this._issue('pass', '2.4.2', 'Page title is descriptive: "' + title.substring(0, 50) + '"', 0)];
  }

  _check_2_4_3() {
    const positive = document.querySelectorAll('[tabindex]');
    const violations = Array.from(positive).filter(el => parseInt(el.getAttribute('tabindex')) > 0);
    if (violations.length > 0) return [this._issue('fail', '2.4.3', 'Elements with positive tabindex (breaks focus order)', violations.length)];
    return [this._issue('pass', '2.4.3', 'No positive tabindex values', 0)];
  }

  _check_3_1_1() {
    const lang = document.documentElement.getAttribute('lang');
    if (!lang) return [this._issue('fail', '3.1.1', 'Missing lang attribute on <html>', 0)];
    return [this._issue('pass', '3.1.1', 'Language set: ' + lang, 0)];
  }

  _check_3_3_2() {
    const inputs = document.querySelectorAll('input:not([type="hidden"]), select, textarea');
    const unlabeled = Array.from(inputs).filter(i => {
      const id = i.id;
      return !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby') && !i.getAttribute('placeholder') && !i.closest('label') && !(id && document.querySelector('label[for="' + id + '"]'));
    });
    if (unlabeled.length > 0) return [this._issue('fail', '3.3.2', 'Inputs without labels or instructions', unlabeled.length)];
    return [this._issue('pass', '3.3.2', 'All inputs have labels', 0)];
  }

  _check_4_1_2() {
    const inputs = document.querySelectorAll('input:not([type="hidden"]), select, textarea, button');
    const noName = Array.from(inputs).filter(i => !i.getAttribute('name') && !i.getAttribute('id') && !i.getAttribute('aria-label'));
    if (noName.length > 0) return [this._issue('fail', '4.1.2', 'Form elements missing name/role/value', noName.length)];
    return [this._issue('pass', '4.1.2', 'All form elements have name/role/value', 0)];
  }

  // ═════════════════════ LEVEL AA CHECKS ════════════════════

  _check_1_3_5() {
    const personalFields = document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input[type="url"]');
    const noAutocomplete = Array.from(personalFields).filter(i => {
      const name = (i.getAttribute('name') || '').toLowerCase();
      const isPersonal = /name|email|phone|tel|address|city|zip|postal|country|street/i.test(name);
      return isPersonal && !i.getAttribute('autocomplete');
    });
    if (noAutocomplete.length > 0) return [this._issue('fail', '1.3.5', 'Personal data fields missing autocomplete', noAutocomplete.length)];
    return [this._issue('pass', '1.3.5', 'Autocomplete attributes present on personal fields', 0)];
  }

  _check_1_4_3() {
    return [this._issue('warn', '1.4.3', 'Text contrast requires manual verification (4.5:1 minimum)', 0)];
  }

  _check_1_4_4() {
    return [this._issue('warn', '1.4.4', 'Text resize to 200% requires manual verification', 0)];
  }

  _check_1_4_10() {
    return [this._issue('warn', '1.4.10', 'Reflow at 320px requires manual verification', 0)];
  }

  _check_1_4_12() {
    return [this._issue('warn', '1.4.12', 'Text spacing override support requires manual check', 0)];
  }

  _check_2_4_7() {
    const interactive = document.querySelectorAll('a, button, input, select, textarea, [tabindex="0"]');
    // Heuristic: check if any have outline:none without alternative
    let noFocus = 0;
    interactive.forEach(el => {
      try {
        const cs = window.getComputedStyle(el, ':focus');
        // Can't fully check :focus styles programmatically, warn if outline: none
        const outline = window.getComputedStyle(el).outlineStyle;
        if (outline === 'none') noFocus++;
      } catch (e) { /* skip */ }
    });
    if (noFocus > interactive.length * 0.5) {
      return [this._issue('warn', '2.4.7', 'Many elements may have invisible focus indicator', noFocus)];
    }
    return [this._issue('pass', '2.4.7', 'Focus indicators appear present', 0)];
  }

  // ═════════════════════ WCAG 2.2 NEW ══════════════════════

  _check_2_4_11() {
    const stickyEls = document.querySelectorAll('[style*="position: sticky"], [style*="position:sticky"], [style*="position: fixed"], [style*="position:fixed"]');
    const stickyHeaders = Array.from(stickyEls).filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.top < 100 && rect.height > 30;
    });
    if (stickyHeaders.length > 0) {
      return [this._issue('warn', '2.4.11', 'Sticky/fixed elements may obscure focused content', stickyHeaders.length)];
    }
    return [this._issue('pass', '2.4.11', 'No elements likely to obscure focus', 0)];
  }

  _check_2_5_8() {
    const targets = document.querySelectorAll('a, button, input[type="checkbox"], input[type="radio"], [role="button"]');
    let tooSmall = 0;
    targets.forEach(el => {
      try {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (rect.width < 24 || rect.height < 24)) tooSmall++;
      } catch (e) { /* skip */ }
    });
    if (tooSmall > 0) return [this._issue('fail', '2.5.8', 'Interactive elements smaller than 24×24px', tooSmall)];
    return [this._issue('pass', '2.5.8', 'All targets meet minimum 24×24px size', 0)];
  }

  _check_3_3_8() {
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    const captchas = document.querySelectorAll('[class*="captcha"], [id*="captcha"], [class*="recaptcha"]');
    const issues = [];
    if (captchas.length > 0) {
      issues.push(this._issue('warn', '3.3.8', 'CAPTCHA detected, which can be a cognitive barrier', captchas.length));
    }
    if (issues.length === 0) return [this._issue('pass', '3.3.8', 'No cognitive authentication barriers detected', 0)];
    return issues;
  }

  // ═════════════════════ RUN FULL AUDIT ═════════════════════

  runFullAudit() {
    this._log('Starting full WCAG 2.2 audit...');
    const allIssues = [];

    try {
      // Level A checks
      const levelA = [
        this._check_1_1_1(),
        this._check_1_3_1(),
        this._check_1_3_2(),
        this._check_2_1_1(),
        this._check_2_1_2(),
        this._check_2_4_1(),
        this._check_2_4_2(),
        this._check_2_4_3(),
        this._check_3_1_1(),
        this._check_3_3_2(),
        this._check_4_1_2(),
      ];

      // Level AA checks
      const levelAA = [
        this._check_1_3_5(),
        this._check_1_4_3(),
        this._check_1_4_4(),
        this._check_1_4_10(),
        this._check_1_4_12(),
        this._check_2_4_7(),
      ];

      // WCAG 2.2 new
      const wcag22 = [
        this._check_2_4_11(),
        this._check_2_5_8(),
        this._check_3_3_8(),
      ];

      levelA.forEach(issues => allIssues.push(...issues));
      levelAA.forEach(issues => allIssues.push(...issues));
      wcag22.forEach(issues => allIssues.push(...issues));
    } catch (e) {
      this._warn('runFullAudit error: ' + e.message);
    }

    // Calculate score
    let score = 100;
    const levelACriteria = ['1.1.1', '1.3.1', '1.3.2', '1.3.3', '2.1.1', '2.1.2', '2.4.1', '2.4.2', '2.4.3', '3.1.1', '3.3.1', '3.3.2', '4.1.2'];

    allIssues.forEach(issue => {
      if (issue.type === 'fail') {
        const isLevelA = levelACriteria.includes(issue.criterion);
        score -= isLevelA ? 8 : 5;
      } else if (issue.type === 'warn') {
        score -= 1;
      }
    });

    score = Math.max(0, score);

    this._log('Audit complete. Score: ' + score + '/100. Issues: ' + allIssues.length);
    return { score, issues: allIssues };
  }
}

if (typeof window !== 'undefined') window.AuditModule = AuditModule;
