// AccessiFlow AIModule
// Finds what needs describing, prepares it, and applies what comes back.
//
// This module never touches an API key and never talks to a model provider.
// It asks the service worker, which is the extension's only AI client. There
// is nothing here for a user to configure and nothing here worth extracting.
'use strict';

class AIModule {
  constructor() {
    this.cfg = (typeof globalThis !== 'undefined' && globalThis.ACCESSIFLOW_AI_CONFIG) || null;
    this.cancelled = false;
    this._log('AIModule loaded');
  }

  _log(msg) { console.log('[AccessiFlow][AI] ' + msg); }
  _warn(msg) { console.warn('[AccessiFlow][AI] ' + msg); }

  // ── Talking to the service worker ───────────────────────────────────────

  _ask(action, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(Object.assign({ action: action }, payload), response => {
        if (chrome.runtime.lastError) {
          reject(new Error('AccessiFlow lost its connection. Please try again.'));
          return;
        }
        if (!response || !response.success) {
          const err = new Error((response && response.error) || 'That did not work.');
          err.code = response && response.code;
          reject(err);
          return;
        }
        resolve(response.text || '');
      });
    });
  }

  /** A message whose whole reply we need, not just the model's text. */
  _send(message) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(message, response => {
        void chrome.runtime.lastError;   // an unreachable worker is just a null reply
        resolve(response || null);
      });
    });
  }

  /** Lets the popup stop a long run part-way through. */
  cancel() { this.cancelled = true; }
  _resetCancel() { this.cancelled = false; }

  // ── Alt text (WCAG 1.1.1) ───────────────────────────────────────────────

  /**
   * Draws the image to a canvas at a reduced size and returns a data URL.
   * Returns null for images the browser will not let us read (cross-origin
   * without CORS headers), which is common and not an error worth reporting.
   */
  _toDataUrl(img) {
    const cfg = this.cfg;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h || w < cfg.IMAGE_MIN_EDGE || h < cfg.IMAGE_MIN_EDGE) return null;

    const scale = Math.min(1, cfg.IMAGE_MAX_EDGE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));

    try {
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', cfg.IMAGE_QUALITY);
    } catch (_) {
      return null; // tainted canvas
    }
  }

  /**
   * The same picture, fetched by the extension when the page itself may not
   * read it.
   *
   * A canvas is "tainted" for an image served by another origin without CORS
   * headers, and the page can no longer export its pixels. That is most sites
   * with a separate image host, so without this the feature would silently do
   * nothing on a large share of the web. The service worker holds the host
   * permissions, so it can fetch the file itself.
   */
  async _imageDataUrl(img) {
    const direct = this._toDataUrl(img);
    if (direct) return direct;

    const src = img.currentSrc || img.src || '';
    if (!/^https?:/i.test(src)) return null;

    const response = await this._send({ action: 'aiFetchImage', url: src });
    return (response && response.success && response.image) ? response.image : null;
  }

  /** Nearby text helps the model tell a decorative photo from a chart. */
  _imageContext(img) {
    const figure = img.closest('figure');
    const caption = figure ? figure.querySelector('figcaption') : null;
    if (caption && caption.textContent.trim()) return caption.textContent.trim().slice(0, 300);

    const container = img.closest('p, li, td, section, article, div');
    return container ? (container.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  }

  async describeImage(img) {
    if (!img || img.tagName !== 'IMG') return null;
    if (img.getAttribute('data-accessiflow-ai-alt') === 'true') return img.alt;

    const dataUrl = await this._imageDataUrl(img);
    if (!dataUrl) return null;

    const src = img.currentSrc || img.src || '';
    const cache = globalThis.ACCESSIFLOW_AI_CACHE;
    const text = await this._ask('aiDescribeImage', {
      image: dataUrl,
      hint: this._imageContext(img),
      // Only real addresses are remembered. A data: or blob: URL is either
      // unique per load or the image itself, and neither is worth keeping.
      cacheKey: /^https?:/i.test(src) && cache ? 'img|' + cache.normalizeSrc(src) : ''
    });

    if (text) {
      img.setAttribute('alt', text);
      img.setAttribute('data-accessiflow-ai-alt', 'true');
      this._log('Described: "' + text + '"');
    }
    return text;
  }

  /** The description the page itself gives, ignoring our own placeholder. */
  pageAltFor(img) {
    if (!img || img.tagName !== 'IMG') return '';
    if (img.getAttribute('data-accessiflow-alt-repaired') === 'placeholder') return '';
    if (img.getAttribute('data-accessiflow-ai-alt') === 'true') return '';
    return (img.getAttribute('alt') || '').trim();
  }

  /**
   * What to read out for one picture, for someone who cannot see it.
   *
   * The page's own alt text wins whenever it exists: it is instant, costs
   * nothing, and was usually written by someone who knew what the picture was
   * for. The AI is the fallback for the pictures that would otherwise be
   * silent. `onWaiting` fires only when a request actually has to be made, so
   * the caller can say "one moment" instead of leaving a blind user in
   * silence for several seconds.
   *
   * @returns {{text: ?string, source: 'page'|'ai'|'none', error: ?string}}
   */
  async describeForSpeech(img, onWaiting) {
    if (!img || img.tagName !== 'IMG') {
      return { text: null, source: 'none', error: 'That is not a picture.' };
    }

    // Described by us on an earlier press: saying it again costs nothing.
    if (img.getAttribute('data-accessiflow-ai-alt') === 'true') {
      return { text: (img.getAttribute('alt') || '').trim() || null, source: 'ai', error: null };
    }

    const own = this.pageAltFor(img);
    if (own) return { text: own, source: 'page', error: null };

    if (this._isCaptcha(img)) {
      return {
        text: null, source: 'none',
        error: 'This is a security check picture, which AccessiFlow does not describe.'
      };
    }

    if (typeof onWaiting === 'function') onWaiting();

    try {
      const text = await this.describeImage(img);
      if (text) return { text: text, source: 'ai', error: null };
      return { text: null, source: 'none', error: 'This picture could not be read.' };
    } catch (e) {
      return { text: null, source: 'none', error: e.message || 'This picture could not be described.' };
    }
  }

  /**
   * Never describe a CAPTCHA. Its whole job is to be unreadable to software,
   * so describing one would defeat the site's security check, and sending it
   * to an outside service is not ours to do.
   */
  _isCaptcha(img) {
    const own = [img.id, img.className, img.getAttribute('src') || '', img.getAttribute('name') || ''].join(' ');
    if (/captcha/i.test(own)) return true;
    return Boolean(img.closest('[id*="captcha" i], [class*="captcha" i]'));
  }

  /**
   * Images that carry meaning but have no real description yet.
   *
   * Screen reader repairs (on by default) runs first and gives every such
   * image the placeholder "[Image - description unavailable]", marked with
   * data-accessiflow-alt-repaired="placeholder". That text is a stand-in for
   * exactly what this module writes, so it must not count as a description,
   * or every picture on the page looks "already described".
   */
  _imagesNeedingAlt() {
    const all = document.querySelectorAll('img:not([data-accessiflow-ai-alt])');
    return Array.from(all).filter(img => {
      const placeholder = img.getAttribute('data-accessiflow-alt-repaired') === 'placeholder';
      if (!placeholder && img.alt && img.alt.trim()) return false; // already described
      if (this._isCaptcha(img)) return false;
      if (img.getAttribute('role') === 'presentation') return false;
      if (img.getAttribute('aria-hidden') === 'true') return false;
      if (img.alt === '' && img.hasAttribute('alt')) return false; // marked decorative
      const rect = img.getBoundingClientRect();
      return rect.width >= this.cfg.IMAGE_MIN_EDGE && rect.height >= this.cfg.IMAGE_MIN_EDGE;
    });
  }

  countImagesNeedingAlt() { return this._imagesNeedingAlt().length; }

  /**
   * @param {function} onProgress called as (done, total, lastResult)
   * @returns {{described:number, total:number, skipped:number, error:?string}}
   */
  async describeAllImages(onProgress) {
    this._resetCancel();
    const targets = this._imagesNeedingAlt().slice(0, this.cfg.MAX_IMAGES_PER_RUN);
    let described = 0;
    let skipped = 0;
    let error = null;

    for (let i = 0; i < targets.length; i++) {
      if (this.cancelled) break;
      try {
        const text = await this.describeImage(targets[i]);
        if (text) described++; else skipped++;
      } catch (err) {
        // A quota or outage affects every remaining image, so stop rather than
        // hammer the proxy with calls that will fail the same way.
        error = err.message;
        break;
      }
      if (onProgress) onProgress(i + 1, targets.length);
      await this._pause();
    }

    this._log('Described ' + described + ' of ' + targets.length + ' images');
    return { described: described, total: targets.length, skipped: skipped, error: error };
  }

  // ── Page summary (WCAG 3.1.5) ───────────────────────────────────────────

  _mainText() {
    const main = document.querySelector('main, [role="main"], article, #content, .content');
    const source = main || document.body;
    const clone = source.cloneNode(true);
    clone.querySelectorAll('script, style, nav, footer, aside, noscript').forEach(el => el.remove());
    return (clone.innerText || clone.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, this.cfg.PAGE_TEXT_LIMIT);
  }

  async summarizePage() {
    const text = this._mainText();
    if (text.length < 80) {
      throw new Error('There is not enough text on this page to summarise.');
    }

    const summary = await this._ask('aiSummarizeText', { text: text });
    if (summary) this._announceSummary(summary);
    return summary;
  }

  /**
   * Puts the summary where a screen reader will read it, and where a sighted
   * user with a reading difficulty can also see it. Earlier versions hid this
   * off-screen, which helped nobody who reads with their eyes.
   */
  _announceSummary(summary, bullets) {
    let panel = document.getElementById('accessiflow-page-summary');
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'accessiflow-page-summary';
      panel.setAttribute('role', 'status');
      panel.setAttribute('aria-live', 'polite');
      panel.setAttribute('aria-label', 'Page summary from AccessiFlow');
      panel.className = 'accessiflow-summary-panel';

      const heading = document.createElement('h2');
      heading.className = 'accessiflow-summary-heading';
      heading.textContent = 'Page summary';

      const body = document.createElement('p');
      body.className = 'accessiflow-summary-text';

      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'accessiflow-summary-close';
      dismiss.textContent = 'Close summary';
      dismiss.addEventListener('click', () => panel.remove());

      panel.append(heading, body, dismiss);
      document.body.prepend(panel);
    }

    const body = panel.querySelector('.accessiflow-summary-text');
    const oldList = panel.querySelector('.accessiflow-summary-list');
    if (oldList) oldList.remove();
    if (bullets && bullets.length) {
      body.textContent = '';
      body.hidden = true;
      const list = document.createElement('ul');
      list.className = 'accessiflow-summary-list';
      bullets.forEach(b => {
        const item = document.createElement('li');
        item.textContent = b;
        list.appendChild(item);
      });
      body.after(list);
      panel.querySelector('.accessiflow-summary-heading').textContent = 'The key points';
    } else {
      body.hidden = false;
      body.textContent = summary;
      panel.querySelector('.accessiflow-summary-heading').textContent = 'Page summary';
    }
    const closeBtn = panel.querySelector('.accessiflow-summary-close');
    if (closeBtn) closeBtn.focus();
  }

  // ── Link names (WCAG 2.4.4) ─────────────────────────────────────────────

  _isVague(anchor) {
    const text = (anchor.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!text) return false;
    if (anchor.getAttribute('aria-label')) return false; // already has a name
    return this.cfg.VAGUE_LINK_TEXTS.indexOf(text) !== -1;
  }

  _vagueLinks() {
    const all = document.querySelectorAll('a[href]:not([data-accessiflow-ai-link])');
    return Array.from(all).filter(a => this._isVague(a));
  }

  countVagueLinks() { return this._vagueLinks().length; }

  async relabelLink(anchor) {
    if (!anchor || !this._isVague(anchor)) return null;

    const container = anchor.closest('p, li, td, div, section, article');
    const context = container
      ? (container.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400)
      : '';

    const label = await this._ask('aiLabelLink', {
      linkText: (anchor.textContent || '').trim(),
      context: context,
      cacheKey: 'link|' + location.pathname + '|' + (anchor.getAttribute('href') || '') +
        '|' + (anchor.textContent || '').trim()
    });

    if (label) {
      anchor.setAttribute('aria-label', label);
      anchor.setAttribute('data-accessiflow-ai-link', 'true');
      this._log('Relabelled link: "' + label + '"');
    }
    return label;
  }

  async relabelAllLinks(onProgress) {
    this._resetCancel();
    const targets = this._vagueLinks().slice(0, this.cfg.MAX_LINKS_PER_RUN);
    let fixed = 0;
    let error = null;

    for (let i = 0; i < targets.length; i++) {
      if (this.cancelled) break;
      try {
        if (await this.relabelLink(targets[i])) fixed++;
      } catch (err) {
        error = err.message;
        break;
      }
      if (onProgress) onProgress(i + 1, targets.length);
      await this._pause();
    }

    this._log('Relabelled ' + fixed + ' of ' + targets.length + ' links');
    return { fixed: fixed, total: targets.length, error: error };
  }

  /** The whole reply from the service worker, for operations that return more than text. */
  _askFull(action, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(Object.assign({ action: action }, payload), response => {
        if (chrome.runtime.lastError) {
          reject(new Error('AccessiFlow lost its connection. Please try again.'));
          return;
        }
        if (!response || !response.success) {
          const err = new Error((response && response.error) || 'That did not work.');
          err.code = response && response.code;
          reject(err);
          return;
        }
        resolve(response);
      });
    });
  }

  /**
   * Errors that mean "stop quietly" rather than "tell the user". Automatic
   * healing runs with nobody watching; announcing that an hourly allowance ran
   * out, on every page load, would be noise.
   */
  _isQuietStop(err) {
    return err && (err.code === 'no_consent' || err.code === 'budget');
  }

  // ── Control names (WCAG 4.1.2): generative code healing ─────────────────
  //
  // Screen reader repairs (blind.js) names what it can for free, from an image
  // inside the button, an SVG <title> or an icon-font class. What it cannot
  // name gets the placeholder "Button (no description available)", marked
  // data-accessiflow-btn-repaired="placeholder". Those, and only those, come
  // here. The model is the fallback for what heuristics genuinely cannot do,
  // not a replacement for them.

  _controlsNeedingName() {
    const found = document.querySelectorAll(
      '[data-accessiflow-btn-repaired="placeholder"]:not([data-accessiflow-ai-control]), ' +
      '[data-accessiflow-link-repaired="placeholder"]:not([data-accessiflow-ai-control])'
    );
    return Array.from(found).filter(el => {
      if (el.closest('[id^="accessiflow-"]')) return false;
      if (this._isCaptcha(el)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    });
  }

  countControlsNeedingName() { return this._controlsNeedingName().length; }

  /**
   * A signature that stays the same on the next visit: where the control sits
   * in the page, what it is called in the markup, and for a link where it
   * goes. Deliberately excludes anything that changes per request, such as
   * generated ids with numbers in them.
   */
  _controlSignature(el) {
    const path = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && node !== document.body && depth < 8; depth++) {
      let index = 1;
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (sib.tagName === node.tagName) index++;
      }
      path.unshift(node.tagName.toLowerCase() + ':' + index);
      node = node.parentElement;
    }
    const classes = (typeof el.className === 'string' ? el.className : '')
      .split(/\s+/).filter(c => c && !/\d{3,}/.test(c)).sort().join('.');
    let href = '';
    if (el.tagName === 'A') {
      try { href = new URL(el.getAttribute('href') || '', location.href).pathname; } catch (e) { href = ''; }
    }
    return location.pathname + '|' + path.join('>') + '|' + classes + '|' + href;
  }

  /** What there is to go on for one control, in the shape the proxy expects. */
  _controlContext(el) {
    const clean = t => String(t || '').replace(/\s+/g, ' ').trim();

    const role = (el.getAttribute('role') || '').toLowerCase();
    const kind = el.tagName === 'A' ? 'link'
      : ['tab', 'menuitem', 'checkbox', 'radio'].indexOf(role) !== -1 ? role
        : 'button';

    // Class names frequently say what a control is for: btn-submit-claim,
    // icon-trash. The icon inside counts as much as the control itself.
    const bits = [];
    const collect = node => {
      if (!node) return;
      if (typeof node.className === 'string') bits.push(node.className);
      else if (node.className && node.className.baseVal) bits.push(node.className.baseVal);
      ['id', 'name', 'data-testid', 'data-action', 'data-icon', 'value'].forEach(attr => {
        const v = node.getAttribute && node.getAttribute(attr);
        if (v) bits.push(v);
      });
    };
    collect(el);
    el.querySelectorAll('i, svg, span, img, use').forEach(collect);
    const use = el.querySelector('use');
    if (use) bits.push(use.getAttribute('href') || use.getAttribute('xlink:href') || '');
    if (el.tagName === 'A') {
      try { bits.push(new URL(el.getAttribute('href') || '', location.href).pathname); } catch (e) { /* skip */ }
    }
    const classList = clean(bits.join(' ')).slice(0, 200);

    // What the surrounding form or section is for. "Submit" means nothing;
    // "Submit" inside "Medical history form" is the whole answer.
    let formPurpose = '';
    const form = el.closest('form, [role="form"], dialog, [role="dialog"], section, fieldset');
    if (form) {
      const legend = form.querySelector('legend, h1, h2, h3, h4, [role="heading"]');
      formPurpose = clean(
        form.getAttribute('aria-label') ||
        (legend && legend.textContent) ||
        form.getAttribute('name') ||
        form.getAttribute('id') ||
        ''
      );
      const action = form.getAttribute && form.getAttribute('action');
      if (action) formPurpose += ' (sends to ' + action.split('?')[0] + ')';
    }

    // Nearby text, minus the control's own (it has none; that is the problem).
    let context = '';
    const container = el.closest('li, td, p, div, section, article, header, nav, footer');
    if (container) {
      const clone = container.cloneNode(true);
      clone.querySelectorAll('script, style').forEach(n => n.remove());
      context = clean(clone.textContent).slice(0, 400);
    }

    return {
      kind: kind,
      classList: classList,
      formPurpose: formPurpose.slice(0, 200),
      pageTitle: clean(document.title).slice(0, 120),
      context: context
    };
  }

  /**
   * Names one control. Returns the name, or null if the model was not sure.
   * @param {boolean} auto true when nobody pressed a button for this
   */
  async nameControl(el, auto) {
    if (!el || el.getAttribute('data-accessiflow-ai-control')) return null;
    const ctx = this._controlContext(el);
    if (!ctx.classList && !ctx.context && !ctx.formPurpose) return null;

    const reply = await this._askFull('aiLabelControl', Object.assign(ctx, {
      cacheKey: this._controlSignature(el),
      auto: !!auto
    }));
    const name = (reply.text || '').trim();
    if (!name) return null;

    if (!this._originalLabels) this._originalLabels = new Map();
    if (!this._originalLabels.has(el)) this._originalLabels.set(el, el.getAttribute('aria-label'));
    el.setAttribute('aria-label', name);
    el.setAttribute('data-accessiflow-ai-control', reply.cached ? 'cached' : 'true');
    this._log('Named control: "' + name + '"' + (reply.cached ? ' (remembered)' : ''));
    return name;
  }

  /**
   * Names every unnamed control on the page, up to the per-page cap.
   *
   * @param {{auto?: boolean, onProgress?: function}} opts
   * @returns {{named:number, total:number, remembered:number, error:?string}}
   */
  async healControls(opts) {
    const o = opts || {};
    this._resetCancel();
    const targets = this._controlsNeedingName().slice(0, this.cfg.MAX_CONTROLS_PER_PAGE);
    let named = 0;
    let remembered = 0;
    let error = null;

    for (let i = 0; i < targets.length; i++) {
      if (this.cancelled) break;
      try {
        const name = await this.nameControl(targets[i], o.auto);
        if (name) {
          named++;
          if (targets[i].getAttribute('data-accessiflow-ai-control') === 'cached') remembered++;
        }
      } catch (err) {
        if (!this._isQuietStop(err)) error = err.message;
        break;
      }
      if (o.onProgress) o.onProgress(i + 1, targets.length);
      // A remembered answer cost nothing, so there is nothing to be polite about.
      if (targets[i].getAttribute('data-accessiflow-ai-control') !== 'cached') await this._pause();
    }

    if (targets.length) {
      this._log('Named ' + named + ' of ' + targets.length + ' controls (' + remembered + ' remembered)');
    }
    return { named: named, total: targets.length, remembered: remembered, error: error };
  }

  /** Puts every control name the AI wrote back the way it was. */
  revertControls() {
    if (!this._originalLabels) return;
    this._originalLabels.forEach((original, el) => {
      try {
        if (original === null) el.removeAttribute('aria-label');
        else el.setAttribute('aria-label', original);
        el.removeAttribute('data-accessiflow-ai-control');
      } catch (e) { /* element gone */ }
    });
    this._originalLabels = new Map();
  }

  // ── Plain language (WCAG 3.1.5): the article simplifier ─────────────────
  //
  // Rewrites dense paragraphs in place, with three guarantees:
  //
  //   * Reversible. The original child nodes are moved into a hidden wrapper,
  //     not copied, so restoring them brings back their event listeners too.
  //   * Visible. A persistent notice says the text was rewritten by AI. A
  //     simplifier that quietly changes the meaning of a medical, legal or
  //     financial page does real harm, and the reader has to be able to tell.
  //   * Honest about links. They cannot be reliably spliced into new prose, so
  //     each rewritten paragraph lists its original links underneath instead.

  _simplifiableParagraphs() {
    const root = document.querySelector('main, [role="main"], article') || document.body;
    return Array.from(root.querySelectorAll('p, li, dd, blockquote'))
      .filter(el => {
        if (el.hasAttribute('data-accessiflow-simplified')) return false;
        if (el.closest('[data-accessiflow-simplified]')) return false;
        if (el.closest('nav, footer, aside, header, [id^="accessiflow-"], form')) return false;
        // A list item that contains paragraphs is handled through them.
        if (el.querySelector('p, li, dd, blockquote')) return false;
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length < this.cfg.SIMPLIFY_MIN_CHARS) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 || rect.height > 0;
      })
      .slice(0, this.cfg.SIMPLIFY_MAX_PARAGRAPHS);
  }

  countSimplifiable() { return this._simplifiableParagraphs().length; }

  _batches(paragraphs) {
    const batches = [];
    let current = [];
    let chars = 0;
    paragraphs.forEach(el => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, this.cfg.SIMPLIFY_BATCH_CHARS);
      if (current.length && (current.length >= this.cfg.SIMPLIFY_BATCH_PARAGRAPHS ||
        chars + text.length > this.cfg.SIMPLIFY_BATCH_CHARS)) {
        batches.push(current);
        current = [];
        chars = 0;
      }
      current.push({ el: el, text: text });
      chars += text.length;
    });
    if (current.length) batches.push(current);
    return batches;
  }

  /**
   * @param {function} onProgress (done, total)
   * @returns {{rewritten:number, total:number, error:?string}}
   */
  async simplifyPage(onProgress) {
    this._resetCancel();
    const paragraphs = this._simplifiableParagraphs();
    if (!paragraphs.length) {
      throw new Error('There are no long paragraphs on this page to make simpler.');
    }

    const batches = this._batches(paragraphs);
    let rewritten = 0;
    let done = 0;
    let error = null;

    for (let b = 0; b < batches.length; b++) {
      if (this.cancelled) break;
      const batch = batches[b];
      try {
        const reply = await this._askFull('aiSimplify', {
          paragraphs: batch.map(p => p.text),
          cacheKey: 'simplify|' + batch.map(p => p.text).join('␞')
        });
        const rewrites = reply.rewrites || [];
        // The proxy has already refused mismatched batches; this is the
        // second line of defence, because putting one paragraph's rewrite in
        // another's place would change what the page says.
        if (rewrites.length === batch.length) {
          batch.forEach((p, i) => { if (this._applyRewrite(p.el, rewrites[i])) rewritten++; });
        }
      } catch (err) {
        error = err.message;
        break;
      }
      done += batch.length;
      if (onProgress) onProgress(done, paragraphs.length);
      await this._pause();
    }

    if (rewritten) this._showSimplifiedNotice();
    return { rewritten: rewritten, total: paragraphs.length, error: error };
  }

  _applyRewrite(el, text) {
    if (!text || !el.isConnected) return false;
    if (!this._simplified) this._simplified = [];

    // Links first, while they are still where the page put them.
    const links = Array.from(el.querySelectorAll('a[href]'));

    const original = document.createElement('span');
    original.className = 'accessiflow-simplified-original';
    original.hidden = true;
    while (el.firstChild) original.appendChild(el.firstChild);

    const rewrite = document.createElement('span');
    rewrite.className = 'accessiflow-simplified-text';
    rewrite.textContent = text;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'accessiflow-simplified-toggle';
    toggle.textContent = 'Show original';
    toggle.setAttribute('aria-pressed', 'false');
    toggle.addEventListener('click', () => {
      const showingOriginal = toggle.getAttribute('aria-pressed') === 'true';
      original.hidden = showingOriginal;
      rewrite.hidden = !showingOriginal;
      if (linkList) linkList.hidden = !showingOriginal;
      toggle.setAttribute('aria-pressed', showingOriginal ? 'false' : 'true');
      toggle.textContent = showingOriginal ? 'Show original' : 'Show simpler version';
    });

    let linkList = null;
    if (links.length) {
      linkList = document.createElement('span');
      linkList.className = 'accessiflow-simplified-links';
      linkList.appendChild(document.createTextNode('Links in this paragraph: '));
      links.forEach((a, i) => {
        const copy = a.cloneNode(true);
        copy.removeAttribute('id');
        linkList.appendChild(copy);
        if (i < links.length - 1) linkList.appendChild(document.createTextNode(', '));
      });
    }

    el.appendChild(rewrite);
    el.appendChild(document.createTextNode(' '));
    el.appendChild(toggle);
    if (linkList) el.appendChild(linkList);
    el.appendChild(original);
    el.setAttribute('data-accessiflow-simplified', 'true');

    this._simplified.push({ el: el, original: original });
    return true;
  }

  _showSimplifiedNotice() {
    let notice = document.getElementById('accessiflow-simplified-notice');
    if (notice) return;
    notice = document.createElement('div');
    notice.id = 'accessiflow-simplified-notice';
    notice.setAttribute('role', 'status');
    notice.className = 'accessiflow-simplified-notice';

    const text = document.createElement('span');
    text.textContent = 'Some text on this page has been rewritten in plain language by AI. ' +
      'Check anything important against the original. Alt+Shift+O restores it.';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.textContent = 'Restore the original text';
    restore.addEventListener('click', () => this.revertSimplified());

    notice.append(text, restore);
    document.body.appendChild(notice);
  }

  /** Puts every rewritten paragraph back exactly as it was. */
  revertSimplified() {
    const list = this._simplified || [];
    list.forEach(({ el, original }) => {
      try {
        const nodes = Array.from(original.childNodes);
        while (el.firstChild) el.removeChild(el.firstChild);
        nodes.forEach(n => el.appendChild(n));
        el.removeAttribute('data-accessiflow-simplified');
      } catch (e) { /* element gone */ }
    });
    this._simplified = [];
    const notice = document.getElementById('accessiflow-simplified-notice');
    if (notice) notice.remove();
    return list.length;
  }

  get simplifiedCount() { return (this._simplified || []).length; }

  // ── TL;DR: three bullet points ──────────────────────────────────────────

  async summarizeBullets() {
    const text = this._mainText();
    if (text.length < this.cfg.SIMPLIFY_MIN_CHARS) {
      throw new Error('There is not enough text on this page to summarise.');
    }
    const reply = await this._askFull('aiBullets', {
      text: text,
      // The whole text, not a prefix: the service worker hashes it, and a page
      // whose body changed below the first paragraph should not get yesterday's summary.
      cacheKey: 'bullets|' + location.pathname + '|' + text
    });
    const bullets = reply.bullets || [];
    if (bullets.length) this._announceSummary(bullets.join(' '), bullets);
    return bullets;
  }

  _pause() {
    return new Promise(resolve => setTimeout(resolve, this.cfg.REQUEST_SPACING_MS));
  }
}

if (typeof window !== 'undefined') window.AIModule = AIModule;
