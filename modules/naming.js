// AccessiFlow naming
//
// Works out what to say about one element: its name, what kind of thing it is,
// and what state it is in — "Search, edit, blank", "Submit, button", "Accept
// terms, check box, not checked".
//
// This is the part of a screen reader that people actually rely on, and the
// reason the old readHovered() was useless: it read an element's whole text,
// so pointing at a button inside a card read the card. A name is not the same
// as the text inside something.
//
// It follows the shape of the accessible name calculation rather than the
// letter of it: aria-labelledby, then aria-label, then the label or alt or
// text that belongs to the element, then a title. Enough to be right on real
// pages, small enough to read.
'use strict';

(function (root) {
  const MAX_TEXT = 300;

  const ROLE_BY_TAG = {
    A: 'link', BUTTON: 'button', SELECT: 'combo box', TEXTAREA: 'edit',
    IMG: 'graphic', SUMMARY: 'disclosure', DETAILS: 'disclosure',
    TABLE: 'table', TD: 'cell', TH: 'column header', LI: 'list item',
    NAV: 'navigation', MAIN: 'main', FORM: 'form', PROGRESS: 'progress bar',
    VIDEO: 'video', AUDIO: 'audio', IFRAME: 'frame'
  };

  const ROLE_BY_INPUT = {
    checkbox: 'check box', radio: 'radio button', range: 'slider',
    file: 'file upload', submit: 'button', button: 'button', reset: 'button',
    image: 'button', password: 'password edit', search: 'search edit',
    email: 'edit', tel: 'edit', url: 'edit', number: 'edit', text: 'edit',
    date: 'date edit', color: 'colour picker'
  };

  const clean = text => String(text || '').replace(/\s+/g, ' ').trim();

  const SKIP_IN_TEXT = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, NOSCRIPT: 1 };

  // Tags whose text runs on from the text before it. Any other element starts
  // a new word, the way Chrome joins the parts of a name: without it, two
  // spans laid out as separate lines are read as one word ("visionBigger").
  const INLINE_TAGS = {
    A: 1, ABBR: 1, B: 1, BDI: 1, BDO: 1, CITE: 1, CODE: 1, DATA: 1, DFN: 1, EM: 1, FONT: 1, I: 1,
    KBD: 1, LABEL: 1, MARK: 1, Q: 1, S: 1, SAMP: 1, SMALL: 1, SPAN: 1, STRONG: 1, SUB: 1, SUP: 1,
    TIME: 1, U: 1, VAR: 1, WBR: 1
  };

  function styleOf(el) {
    try {
      const win = (el.ownerDocument && el.ownerDocument.defaultView) || root;
      return win.getComputedStyle ? win.getComputedStyle(el) : null;
    } catch (e) { return null; }
  }

  /**
   * The text inside an element as a screen reader hears it. What is hidden
   * from speech is left out (aria-hidden, the hidden attribute, display:
   * none), which is how an icon's "−" or a decorative "1" stays out of a
   * button's name, as it does in Chrome's; and so is anything `skip` says,
   * such as the control a label is naming.
   */
  function spokenText(node, skip) {
    let out = '';
    const walk = n => {
      if (out.length > MAX_TEXT * 2) return;
      if (n.nodeType === 3) { out += n.data; return; }
      if (n.nodeType !== 1 || SKIP_IN_TEXT[n.tagName] || (skip && skip(n))) return;
      if (n.hidden || n.getAttribute('aria-hidden') === 'true') return;
      const style = styleOf(n);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return;
      const block = style && style.display ? !/^inline/.test(style.display) : !INLINE_TAGS[n.tagName];
      if (block) out += ' ';
      for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (block) out += ' ';
    };
    for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
    return clean(out);
  }

  // Referenced by aria-labelledby, an element counts even if hidden itself,
  // as the name calculation says; what is hidden inside it still does not.
  function fromIds(el, attribute) {
    const ids = clean(el.getAttribute(attribute));
    if (!ids) return '';
    return ids.split(' ').map(id => {
      const target = el.ownerDocument.getElementById(id);
      return target ? spokenText(target) : '';
    }).filter(Boolean).join(' ');
  }

  // A label that holds its control as well as its text names the control by
  // the text alone: a select inside one is not named by all its options.
  const CONTROLS_IN_LABEL = 'input, select, textarea, output';
  const isControl = n => !!(n.matches && n.matches(CONTROLS_IN_LABEL));

  function labelFor(el) {
    const doc = el.ownerDocument;
    if (el.id) {
      // Walked rather than queried: an id can contain characters a selector
      // would choke on, and CSS.escape does not exist outside a browser.
      const labels = doc.getElementsByTagName('label');
      for (let i = 0; i < labels.length; i++) {
        if (labels[i].getAttribute('for') === el.id) return spokenText(labels[i], isControl);
      }
    }
    const wrapping = el.closest ? el.closest('label') : null;
    return wrapping ? spokenText(wrapping, isControl) : '';
  }

  /**
   * The screen reader repairs put a stand-in on anything they could not name
   * ("Link (no description available)", "[Image - description unavailable]")
   * and mark it, so the AI can find it later. That stand-in is a note to
   * ourselves, not a name: read aloud it sounds like one, and hides that
   * the thing is unlabelled.
   */
  function isPlaceholder(el) {
    return !!el && !!el.getAttribute && (
      el.getAttribute('data-accessiflow-alt-repaired') === 'placeholder' ||
      el.getAttribute('data-accessiflow-link-repaired') === 'placeholder' ||
      el.getAttribute('data-accessiflow-btn-repaired') === 'placeholder');
  }

  /** What this element is called, in the order a screen reader looks. */
  function accessibleName(el) {
    if (!el || !el.getAttribute) return '';
    const placeholder = isPlaceholder(el);

    const labelled = fromIds(el, 'aria-labelledby');
    if (labelled) return labelled;

    const aria = placeholder ? '' : clean(el.getAttribute('aria-label'));
    if (aria) return aria;

    const tag = el.tagName;

    if (tag === 'IMG') {
      // alt="" is the page saying this picture is decoration, not content.
      if (el.hasAttribute('alt') && !placeholder) return clean(el.getAttribute('alt'));
      return clean(el.getAttribute('title'));
    }

    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (tag === 'INPUT' && (type === 'submit' || type === 'button' || type === 'reset')) {
        return clean(el.value || el.getAttribute('title'));
      }
      return labelFor(el) ||
             clean(el.getAttribute('placeholder')) ||
             clean(el.getAttribute('title')) ||
             clean(el.getAttribute('name'));
    }

    const own = spokenText(el);
    if (own) return own.length > MAX_TEXT ? own.slice(0, MAX_TEXT) + '…' : own;

    // A link or button whose content is only a picture is named by that
    // picture, which is why so many icon buttons are silent without alt text.
    // The first picture that describes itself: a logo link often starts with
    // a decorative alt="" image before the one that carries the name.
    const imgs = el.querySelectorAll ? el.querySelectorAll('img[alt]') : [];
    for (let i = 0; i < imgs.length; i++) {
      const alt = clean(imgs[i].getAttribute('alt'));
      if (alt && !isPlaceholder(imgs[i])) return alt;
    }

    return clean(el.getAttribute('title'));
  }

  /** What kind of thing it is. */
  function roleOf(el) {
    if (!el || !el.getAttribute) return '';

    const explicit = clean(el.getAttribute('role')).split(' ')[0];
    if (explicit) {
      return { img: 'graphic', textbox: 'edit', checkbox: 'check box',
               radio: 'radio button', combobox: 'combo box', menuitem: 'menu item',
               tab: 'tab', switch: 'switch', slider: 'slider', dialog: 'dialogue',
               alert: 'alert', status: 'status', banner: 'banner',
               navigation: 'navigation', search: 'search', main: 'main',
               contentinfo: 'footer', region: 'region', article: 'article',
               listitem: 'list item', heading: 'heading' }[explicit] || explicit;
    }

    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) return 'heading level ' + tag[1];
    if (tag === 'A') return el.hasAttribute('href') ? 'link' : '';
    if (tag === 'INPUT') {
      return ROLE_BY_INPUT[(el.getAttribute('type') || 'text').toLowerCase()] || 'edit';
    }
    return ROLE_BY_TAG[tag] || '';
  }

  /** Checked, expanded, unavailable: the things that change what a press does. */
  function stateOf(el) {
    if (!el || !el.getAttribute) return '';
    const states = [];
    const tag = el.tagName;
    // No type attribute is a text box, and the commonest one on real forms.
    const type = (el.getAttribute('type') || 'text').toLowerCase();

    if (el.disabled || el.getAttribute('aria-disabled') === 'true') states.push('unavailable');

    // A check box the page has turned into something else (Wikipedia's menu
    // is <input type="checkbox" role="button">) is that something else, and
    // "not checked" would describe a control the user cannot see.
    const ownRole = (el.getAttribute('role') || '').toLowerCase();
    const stillACheckBox = !ownRole || /^(checkbox|radio|switch|menuitemcheckbox|menuitemradio)$/.test(ownRole);
    // A switch is on or off, as NVDA says it, not checked.
    const onOff = ownRole === 'switch';
    if (tag === 'INPUT' && (type === 'checkbox' || type === 'radio') && stillACheckBox) {
      states.push(onOff ? (el.checked ? 'on' : 'off') : el.checked ? 'checked' : 'not checked');
    } else if (el.hasAttribute('aria-checked')) {
      const value = el.getAttribute('aria-checked');
      if (onOff) states.push(value === 'true' ? 'on' : 'off');
      else states.push(value === 'true' ? 'checked' : value === 'mixed' ? 'partly checked' : 'not checked');
    }

    if (el.hasAttribute('aria-expanded')) {
      states.push(el.getAttribute('aria-expanded') === 'true' ? 'expanded' : 'collapsed');
    }
    if (el.required || el.getAttribute('aria-required') === 'true') states.push('required');
    if (el.getAttribute('aria-current') === 'true' || el.getAttribute('aria-current') === 'page') {
      states.push('current');
    }

    // An empty box is worth saying: silence there is indistinguishable from a
    // box that failed to read.
    if ((tag === 'INPUT' && ROLE_BY_INPUT[type] === 'edit') || tag === 'TEXTAREA') {
      states.push(clean(el.value) ? clean(el.value).slice(0, 100) : 'blank');
    }
    if (tag === 'SELECT' && el.selectedIndex > -1 && el.options[el.selectedIndex]) {
      states.push(clean(el.options[el.selectedIndex].textContent));
    }

    return states.join(', ');
  }

  /**
   * The nearest thing worth announcing.
   *
   * Pointing at the word inside a button means the button, not the word; at a
   * paragraph it means the paragraph. Climbing to the nearest element that
   * carries meaning is what makes pointing feel like it lands on something.
   */
  function targetFor(node) {
    let el = node && node.nodeType === 3 ? node.parentElement : node;
    if (!el || !el.closest) return null;

    // Never announce our own furniture back at the user. Matched on the
    // injected marker alone: AccessiFlow once gave the page's <main> an id
    // starting "accessiflow-" as a skip link target, and matching an id
    // prefix silenced the entire page. (That id is now #main-accessiflow.)
    if (el.closest('[data-accessiflow-injected], #accessiflow-shortcut-announce')) return null;

    const interactive = el.closest(
      'a[href], button, input, select, textarea, summary, [role], [tabindex]:not([tabindex="-1"])');
    if (interactive) return interactive;

    const block = el.closest('h1, h2, h3, h4, h5, h6, li, td, th, p, figcaption, blockquote, label, img');
    return block || el;
  }

  /** Everything, in the order it should be said. */
  function describeElement(node) {
    const el = targetFor(node);
    if (!el) return '';
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return '';

    const name = accessibleName(el);
    const role = roleOf(el);
    const state = stateOf(el);

    // A nameless piece of layout is not worth interrupting anyone for, but a
    // control with no name is: that is a bug on the page and the user needs to
    // know something is there.
    // alt="" and role=presentation are the page saying this carries no
    // meaning. Announcing it anyway is exactly the noise they exist to stop.
    const presentational = el.getAttribute && /^(presentation|none)$/.test(el.getAttribute('role') || '');
    if (presentational) return '';
    if (!name && el.tagName === 'IMG' && el.hasAttribute('alt') && !isPlaceholder(el)) return '';

    if (!name && !role) return '';
    if (!name && role) return 'unlabelled ' + role;

    return [name, role, state].filter(Boolean).join(', ');
  }

  /**
   * The longer help a page gives a control (aria-describedby, or
   * aria-description), which NVDA says after the name when focus lands on
   * it: "Email, edit, required, blank. We only use it for your receipt."
   * Parts hidden from speech are left out, and so is a description that
   * only repeats the name.
   */
  function descriptionOf(node) {
    const el = targetFor(node);
    if (!el || !el.getAttribute) return '';
    let text = '';
    const ids = clean(el.getAttribute('aria-describedby'));
    const doc = el.ownerDocument || root.document;
    if (ids && doc) {
      text = clean(ids.split(' ').map(id => {
        const ref = doc.getElementById(id);
        return ref ? spokenText(ref) : '';
      }).join(' '));
    }
    if (!text) text = clean(el.getAttribute('aria-description'));
    if (!text || text === clean(accessibleName(el))) return '';
    return text;
  }

  root.AccessiFlowNaming = { describeElement, descriptionOf, accessibleName, roleOf, stateOf, targetFor, isPlaceholder };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.AccessiFlowNaming;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
