// AccessiFlow FormsModule - predictive form-field summaries
//
// Before someone starts a long form, tell them what it will ask for. "You will
// need your bank routing number and a 10-digit patient ID" said up front is the
// difference between finishing a benefits application and abandoning it at
// step three to go and find a document. For people with memory, attention or
// fatigue-related disabilities that abandonment is where most online forms are
// lost.
//
// Every form of two questions or more gets one, the moment focus first enters
// it. The summary is written on this computer from the form's own labels, so
// nothing is sent anywhere. When the user has agreed to automatic Smart help,
// or asks with Alt+Shift+G, the AI's fuller summary is used instead. With the
// built-in screen reader on, the summary is read out after the field's name;
// with it off, it is only shown.
//
// The privacy rule is enforced by construction, not by care: the serialiser
// below never reads `.value`, never reads a `value` attribute, and never looks
// inside a password, hidden or payment field. There is no code path by which
// something the user typed could reach the network.
'use strict';

class FormsModule {
  constructor() {
    this._active = false;
    this._settings = {};
    this._focusHandler = null;
    this._briefed = new WeakSet();     // forms already summarised on this page
    this._panels = [];
    this._speak = null;
    this.cfg = (typeof globalThis !== 'undefined' && globalThis.ACCESSIFLOW_AI_CONFIG) || {};
  }

  _log(msg) { console.log('[AccessiFlow][Forms] ' + msg); }
  _warn(msg) { console.warn('[AccessiFlow][Forms] ' + msg); }

  buildCSS() { return ''; }

  /** Lets content.js read briefs aloud for screen reader users. */
  setSpeaker(fn) { this._speak = typeof fn === 'function' ? fn : null; }

  // ── What counts as a field, and what may be said about it ───────────────

  static get FIELD_SELECTOR() {
    return 'input, select, textarea, [role="textbox"], [role="combobox"], [role="listbox"], ' +
      '[role="radiogroup"], [role="checkbox"], [role="switch"]';
  }

  // autocomplete tokens for things that must never be described by name, even
  // though a label is not the user's data: saying "Card security code" to a
  // model is harmless, but the rule is simpler and safer as "these fields are
  // reported only by category".
  static get SENSITIVE_AUTOCOMPLETE() {
    return {
      'cc-number': 'payment card', 'cc-csc': 'payment card', 'cc-exp': 'payment card',
      'cc-exp-month': 'payment card', 'cc-exp-year': 'payment card', 'cc-name': 'payment card',
      'cc-type': 'payment card', 'current-password': 'password', 'new-password': 'password',
      'one-time-code': 'one-time code'
    };
  }

  /** The category a field belongs to if it must not be described, else null. */
  _sensitiveCategory(el) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'password') return 'password';
    const tokens = (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/);
    const map = FormsModule.SENSITIVE_AUTOCOMPLETE;
    for (let i = 0; i < tokens.length; i++) if (map[tokens[i]]) return map[tokens[i]];
    // Names and ids give away card fields that forgot their autocomplete token.
    const hint = ((el.getAttribute('name') || '') + ' ' + (el.id || '')).toLowerCase();
    if (/card.?(number|num|no)|ccnum|cvv|cvc|csc|security.?code/.test(hint)) return 'payment card';
    if (/passw|pwd|pin\b/.test(hint)) return 'password';
    return null;
  }

  _isSkipped(el) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset' ||
      type === 'image') return true;
    if (el.disabled) return true;
    if (el.closest('[id^="accessiflow-"]')) return true;
    // Size is deliberately not a test. The later steps of a multi-step form
    // are usually unrendered, and they are exactly what the user needs to hear
    // about in advance. A field hidden from assistive technology on purpose is
    // a honeypot or a template row, and is dropped.
    return !!el.closest('[aria-hidden="true"]');
  }

  /** The field's label, from the author's markup only. Never its contents. */
  _labelOf(el) {
    const clean = t => String(t || '').replace(/\s+/g, ' ').trim();
    const byIds = attr => clean((el.getAttribute(attr) || '').split(/\s+/)
      .map(id => { const n = id && document.getElementById(id); return n ? n.textContent : ''; })
      .join(' '));

    let label = byIds('aria-labelledby') || clean(el.getAttribute('aria-label'));
    if (!label && el.id) {
      const explicit = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
      if (explicit) label = this._labelText(explicit);
    }
    if (!label) {
      const wrapping = el.closest('label');
      if (wrapping) label = this._labelText(wrapping);
    }
    if (!label) label = clean(el.getAttribute('title'));
    // A placeholder is author text ("e.g. 10 digits"), not user data. It is
    // the only hint many modern forms give at all.
    const placeholder = clean(el.getAttribute('placeholder'));
    if (!label && placeholder) label = placeholder;
    else if (placeholder && placeholder !== label) label += ' (hint: ' + placeholder.slice(0, 60) + ')';
    return label.slice(0, 120);
  }

  /**
   * A label's text without the text of any field inside it, so a label that
   * wraps a select does not end up quoting every option in the list.
   */
  _labelText(label) {
    const clone = label.cloneNode(true);
    // Anything that can hold what the user typed is removed before the text is
    // read: a textarea's text is its contents, and so is a contenteditable box.
    clone.querySelectorAll('input, select, textarea, option, [contenteditable], [role="textbox"]')
      .forEach(n => n.remove());
    return String(clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  _describeType(el) {
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'SELECT' || role === 'combobox' || role === 'listbox') {
      const count = tag === 'SELECT' ? el.options.length : 0;
      return count ? 'choose from ' + count + ' options' : 'choice';
    }
    if (tag === 'TEXTAREA') return 'long answer';
    if (type === 'file') return 'file upload' + (el.getAttribute('accept') ? ', accepts ' + el.getAttribute('accept') : '');
    if (type === 'checkbox' || role === 'checkbox' || role === 'switch') return 'tick box';
    if (type === 'radio' || role === 'radiogroup') return 'pick one';
    if (type === 'date' || type === 'datetime-local' || type === 'month') return 'date';
    if (type === 'email') return 'email address';
    if (type === 'tel') return 'phone number';
    if (type === 'number') return 'number';
    if (type === 'url') return 'web address';
    return 'text';
  }

  /**
   * The form's structure as plain text for the model. Headings, labels, types,
   * whether required, length limits and format hints. Nothing the user typed.
   *
   * @returns {{text:string, fields:number}}
   */
  serialize(form) {
    const lines = [];
    const items = [];      // the same, as data, for the summary made here
    const clean = t => String(t || '').replace(/\s+/g, ' ').trim();

    const heading = form.querySelector('legend, h1, h2, h3, [role="heading"]') ||
      (form.previousElementSibling && /^H[1-4]$/.test(form.previousElementSibling.tagName)
        ? form.previousElementSibling : null);
    const title = clean(form.getAttribute('aria-label') || (heading && heading.textContent));
    if (title) lines.push('Form: ' + title.slice(0, 120));

    const steps = this._stepInfo(form);
    if (steps) lines.push('Steps: ' + steps);

    const seenRadioGroups = new Set();
    const sensitive = {};
    let fields = 0;
    let currentFieldset = null;

    const all = form.querySelectorAll(FormsModule.FIELD_SELECTOR);
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (this._isSkipped(el)) continue;

      // Radio buttons are one question, not one field per option.
      if ((el.getAttribute('type') || '').toLowerCase() === 'radio') {
        const name = el.getAttribute('name') || '';
        if (name && seenRadioGroups.has(name)) continue;
        if (name) seenRadioGroups.add(name);
      }

      const category = this._sensitiveCategory(el);
      if (category) {
        // Reported once per category, by category only.
        if (!sensitive[category]) {
          sensitive[category] = true;
          lines.push('- ' + category + ' details' + (el.required ? ' (required)' : ''));
          items.push({ sensitive: category, required: !!el.required });
          fields++;
        }
        continue;
      }

      const fieldset = el.closest('fieldset');
      if (fieldset && fieldset !== currentFieldset && form.contains(fieldset)) {
        currentFieldset = fieldset;
        const legend = fieldset.querySelector('legend');
        if (legend && clean(legend.textContent) && clean(legend.textContent) !== title) {
          lines.push('Section: ' + clean(legend.textContent).slice(0, 100));
        }
      }

      let label = this._labelOf(el);
      if ((el.getAttribute('type') || '').toLowerCase() === 'radio' && fieldset) {
        const legend = fieldset.querySelector('legend');
        if (legend) label = clean(legend.textContent).slice(0, 120) || label;
      }
      if (!label) label = '(unlabelled)';

      const facts = [this._describeType(el)];
      if (el.required || el.getAttribute('aria-required') === 'true') facts.push('required');
      const max = el.getAttribute('maxlength');
      const min = el.getAttribute('minlength');
      if (max && min && max === min) facts.push(max + ' characters');
      else if (max) facts.push('up to ' + max + ' characters');
      const pattern = el.getAttribute('pattern');
      const digits = pattern && pattern.match(/^\\d\{(\d+)\}$|^\[0-9\]\{(\d+)\}$/);
      if (digits) facts.push((digits[1] || digits[2]) + ' digits');

      lines.push('- ' + label + ' (' + facts.join(', ') + ')');
      items.push({
        label: label === '(unlabelled)' ? '' : label.replace(/\s*\(hint:.*\)$/, ''),
        type: facts[0],
        required: facts.indexOf('required') !== -1
      });
      fields++;
    }

    return { text: lines.join('\n').slice(0, 1500), fields: fields, items: items, title: title, steps: steps };
  }

  /**
   * A summary written here, from the serialised form, with no AI and nothing
   * sent. "This form has 6 questions. It asks for: NHS number, Date of birth,
   * Email (optional), a file to upload (Scan of your prescription), and
   * payment card details. This is step 2 of 4."
   */
  localSummary(serialized) {
    const s = serialized;
    const items = s.items || [];
    const anyRequired = items.some(i => i.required);
    const said = [];
    let unlabelled = 0;
    items.forEach(item => {
      const optional = anyRequired && !item.required ? ' (optional)' : '';
      if (item.sensitive) {
        said.push((item.sensitive === 'payment card' ? 'payment card details'
          : item.sensitive === 'password' ? 'a password' : 'a one-time code') + optional);
        return;
      }
      if (!item.label) { unlabelled++; return; }
      if (/^file upload/.test(item.type)) said.push('a file to upload (' + item.label + ')' + optional);
      else said.push(item.label + optional);
    });

    const shown = said.slice(0, 8);
    const more = said.length - shown.length + unlabelled;
    let list = shown.join(', ');
    if (more > 0) list += (list ? ', and ' : '') + more + (more === 1 ? ' more box' : ' more boxes');
    else if (shown.length === 2) list = shown[0] + ' and ' + shown[1];
    else if (shown.length > 2) list = shown.slice(0, -1).join(', ') + ', and ' + shown[shown.length - 1];

    // "It has", not "This form has": it sits under "Before you start this
    // form", and is read out straight after those words.
    const count = s.fields + (s.fields === 1 ? ' question' : ' questions');
    const parts = [(s.title ? 'The form "' + s.title + '" has ' : 'It has ') + count + '.'];
    if (list) parts.push('It asks for: ' + list + '.');
    if (anyRequired) {
      const required = items.filter(i => i.required).length;
      if (required === items.length) parts.push('All of them are required.');
    }
    if (s.steps) parts.push('This is ' + s.steps + '.');
    return parts.join(' ');
  }

  /** "Step 2 of 4", from whatever the form uses to say so. */
  _stepInfo(form) {
    const scope = form.closest('main, [role="main"], body') || form;
    const current = scope.querySelector('[aria-current="step"]');
    const list = current && current.closest('ol, ul');
    if (list) {
      const items = list.querySelectorAll(':scope > li');
      const index = Array.prototype.indexOf.call(items, current.closest('li'));
      if (items.length > 1 && index >= 0) return 'step ' + (index + 1) + ' of ' + items.length;
    }
    const text = (scope.textContent || '').match(/step\s+(\d+)\s+of\s+(\d+)/i);
    return text ? 'step ' + text[1] + ' of ' + text[2] : '';
  }

  // ── Showing the brief ───────────────────────────────────────────────────

  _eligible(form) {
    if (!form || this._briefed.has(form)) return false;
    if (form.closest('[id^="accessiflow-"]')) return false;
    // A one-box search bar or newsletter signup is not what this is for.
    return this.serialize(form).fields >= (this.cfg.FORM_MIN_FIELDS || 2);
  }

  /** Smart help's summary of the serialised form. Rejects with a code on refusal. */
  _askAI(serialized, auto) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'aiFormBrief',
        fields: serialized.text,
        cacheKey: 'form|' + location.pathname + '|' + serialized.text,
        auto: !!auto
      }, response => {
        if (chrome.runtime.lastError) { reject(new Error('AccessiFlow lost its connection.')); return; }
        if (!response || !response.success) {
          const err = new Error((response && response.error) || 'That did not work.');
          err.code = response && response.code;
          reject(err);
          return;
        }
        resolve((response.text || '').trim());
      });
    });
  }

  /**
   * Shows the form's summary above it, and resolves with its text.
   *
   * Smart help is asked first, because a remembered answer or an agreed
   * automatic one is better than anything made here. Without the user's
   * agreement it refuses at once, so the summary made here appears with no
   * wait. If the helper is slow, the local summary goes up after a moment,
   * and the helper's replaces its text quietly when it arrives, without
   * saying it a second time.
   *
   * @param {Element} form
   * @param {boolean} auto true when triggered by focus rather than a keypress
   * @param {boolean} [speak=true] false when the caller says it itself
   */
  describe(form, auto, speak) {
    const say = speak !== false;
    if (!form) return Promise.reject(new Error('There is no form here to describe.'));
    const serialized = this.serialize(form);
    if (serialized.fields < 2) return Promise.reject(new Error('This form is too short to need a summary.'));
    this._briefed.add(form);

    const local = this.localSummary(serialized);
    let shown = null;
    const show = (text, source) => { shown = source; this._showBrief(form, text, source, say); };
    const timer = setTimeout(() => { if (!shown) show(local, 'local'); }, this.cfg.FORM_AI_WAIT_MS || 2500);

    return this._askAI(serialized, auto).then(text => {
      clearTimeout(timer);
      if (!text) {
        if (!shown) show(local, 'local');
        return local;
      }
      if (shown) this._showBrief(form, text, 'ai', false);   // quietly: the local one was already said
      else show(text, 'ai');
      return text;
    }, err => {
      clearTimeout(timer);
      // No agreement, no allowance left, offline, or refused: the summary made
      // here stands. The user did not ask for Smart help, so its refusal is
      // not theirs to hear about.
      if (err.code !== 'no_consent' && err.code !== 'budget') this._warn(err.message);
      if (!shown) show(local, 'local');
      return local;
    });
  }

  /**
   * @param {string} source 'ai' or 'local', for the note under the summary
   * @param {boolean} speak whether to hand it to the speaker
   */
  _showBrief(form, text, source, speak) {
    const noteText = source === 'ai'
      ? 'Summary by AI from the form’s labels. Nothing you type is sent.'
      : 'Summary made on this computer from the form’s labels. Nothing is sent anywhere.';
    const existing = form.previousElementSibling;
    if (existing && existing.classList && existing.classList.contains('accessiflow-form-brief')) {
      // A quiet swap stays quiet for screen readers too: a status region
      // whose text changes is read out, and this one was read a moment ago.
      if (!speak) existing.setAttribute('aria-live', 'off');
      existing.querySelector('.accessiflow-form-brief-text').textContent = text;
      existing.querySelector('.accessiflow-form-brief-note').textContent = noteText;
      existing.dataset.source = source;
      if (!speak) setTimeout(() => existing.setAttribute('aria-live', 'polite'), 50);
      if (speak) this._say(text);
      return;
    }

    // Placed before the form rather than inside it, so it can never be
    // submitted with it, restyled by it, or break the form's own layout grid.
    const panel = document.createElement('div');
    panel.className = 'accessiflow-form-brief';
    panel.id = 'accessiflow-form-brief-' + (this._panels.length + 1);
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');

    const heading = document.createElement('strong');
    heading.className = 'accessiflow-form-brief-heading';
    heading.textContent = 'Before you start this form';

    const body = document.createElement('p');
    body.className = 'accessiflow-form-brief-text';
    body.textContent = text;

    const note = document.createElement('small');
    note.className = 'accessiflow-form-brief-note';
    note.textContent = noteText;
    panel.dataset.source = source;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'accessiflow-form-brief-close';
    close.textContent = 'Dismiss';
    close.addEventListener('click', () => panel.remove());

    panel.append(heading, body, note, close);
    form.parentNode.insertBefore(panel, form);
    this._panels.push(panel);
    if (speak) this._say(text);
  }

  // content.js decides whether to speak: only with the built-in screen
  // reader on. Anyone else sees the panel, and another screen reader
  // announces it through its role=status.
  _say(text) {
    if (!this._speak) return;
    try { this._speak('Before you start this form. ' + text); } catch (e) { /* skip */ }
  }

  /** Alt+Shift+G: the form the keyboard is in, or else the first on the page. */
  describeCurrent() {
    const active = document.activeElement;
    let form = active && active.closest ? active.closest('form, [role="form"]') : null;
    if (!form) form = document.querySelector('form, [role="form"]');
    if (form) this._briefed.delete(form);   // an explicit request always runs
    // Asked for, so Smart help may answer without the automatic agreement.
    // Whoever asked says the result: Alt+Shift+G out loud, the popup in its
    // own status line.
    return this.describe(form, false, false);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Always on, whatever the settings say: a form's summary is part of
   * AccessiFlow being on for the site, not a switch to find first. Only
   * pausing AccessiFlow for the site (destroy) takes it away.
   */
  apply(settings) {
    this._settings = settings || {};
    if (this._active) return;
    this._active = true;
    this._focusHandler = (e) => {
      const form = e.target && e.target.closest && e.target.closest('form, [role="form"]');
      if (!form || !this._eligible(form)) return;
      this.describe(form, true).catch(err => this._warn(err.message));
    };
    document.addEventListener('focusin', this._focusHandler, true);
  }

  destroy() {
    this._active = false;
    if (this._focusHandler) {
      document.removeEventListener('focusin', this._focusHandler, true);
      this._focusHandler = null;
    }
    this._panels.forEach(p => { try { p.remove(); } catch (e) { /* gone */ } });
    this._panels = [];
    this._briefed = new WeakSet();
  }
}

if (typeof window !== 'undefined') window.FormsModule = FormsModule;
