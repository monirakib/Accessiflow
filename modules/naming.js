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

  function fromIds(el, attribute) {
    const ids = clean(el.getAttribute(attribute));
    if (!ids) return '';
    return ids.split(' ').map(id => {
      const target = el.ownerDocument.getElementById(id);
      return target ? clean(target.textContent) : '';
    }).filter(Boolean).join(' ');
  }

  function labelFor(el) {
    const doc = el.ownerDocument;
    if (el.id) {
      // Walked rather than queried: an id can contain characters a selector
      // would choke on, and CSS.escape does not exist outside a browser.
      const labels = doc.getElementsByTagName('label');
      for (let i = 0; i < labels.length; i++) {
        if (labels[i].getAttribute('for') === el.id) return clean(labels[i].textContent);
      }
    }
    const wrapping = el.closest ? el.closest('label') : null;
    return wrapping ? clean(wrapping.textContent) : '';
  }

  /** What this element is called, in the order a screen reader looks. */
  function accessibleName(el) {
    if (!el || !el.getAttribute) return '';

    const labelled = fromIds(el, 'aria-labelledby');
    if (labelled) return labelled;

    const aria = clean(el.getAttribute('aria-label'));
    if (aria) return aria;

    const tag = el.tagName;

    if (tag === 'IMG') {
      // alt="" is the page saying this picture is decoration, not content.
      if (el.hasAttribute('alt')) return clean(el.getAttribute('alt'));
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

    const own = clean(el.textContent);
    if (own) return own.length > MAX_TEXT ? own.slice(0, MAX_TEXT) + '…' : own;

    // A link or button whose content is only a picture is named by that
    // picture, which is why so many icon buttons are silent without alt text.
    const img = el.querySelector ? el.querySelector('img[alt]') : null;
    if (img) return clean(img.getAttribute('alt'));

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
    const type = (el.getAttribute('type') || '').toLowerCase();

    if (el.disabled || el.getAttribute('aria-disabled') === 'true') states.push('unavailable');

    if (tag === 'INPUT' && (type === 'checkbox' || type === 'radio')) {
      states.push(el.checked ? 'checked' : 'not checked');
    } else if (el.hasAttribute('aria-checked')) {
      const value = el.getAttribute('aria-checked');
      states.push(value === 'true' ? 'checked' : value === 'mixed' ? 'partly checked' : 'not checked');
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
    // injected marker alone: AccessiFlow also renames the page's own elements
    // (the skip link needs a target, so <main> becomes #accessiflow-main), and
    // matching an id prefix silenced the entire page.
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
    if (!name && el.tagName === 'IMG' && el.hasAttribute('alt')) return '';

    if (!name && !role) return '';
    if (!name && role) return 'unlabelled ' + role;

    return [name, role, state].filter(Boolean).join(', ');
  }

  root.AccessiFlowNaming = { describeElement, accessibleName, roleOf, stateOf, targetFor };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.AccessiFlowNaming;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
