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

    const dataUrl = this._toDataUrl(img);
    if (!dataUrl) return null;

    const text = await this._ask('aiDescribeImage', {
      image: dataUrl,
      hint: this._imageContext(img)
    });

    if (text) {
      img.setAttribute('alt', text);
      img.setAttribute('data-accessiflow-ai-alt', 'true');
      this._log('Described: "' + text + '"');
    }
    return text;
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
  _announceSummary(summary) {
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

    panel.querySelector('.accessiflow-summary-text').textContent = summary;
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
      context: context
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

  _pause() {
    return new Promise(resolve => setTimeout(resolve, this.cfg.REQUEST_SPACING_MS));
  }
}

if (typeof window !== 'undefined') window.AIModule = AIModule;
