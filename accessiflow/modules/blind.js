// AccessiFlow BlindModule (Most Critical)
// Silently repairs accessibility tree for screen readers
// Repairs: alt text, empty links/buttons, form labels, landmarks, ARIA, skip links, tab order, tables
'use strict';

class BlindModule {
  constructor() {
    this._repairs = [];
    this._observers = [];
    this._landmarkPanel = null;
    this._headingPanel = null;
    this._announcerEl = null;
    this._pageChangeObserver = null;
    this._titleObserver = null;
    this._lastUrl = location.href;
    this._ariaExpandedListeners = new Map();
    this._skipLinkInjected = false;
    this._pageSummaryTimeout = null;
  }

  // ─── Helper: log with prefix ───────────────────────────────
  _log(msg) {
    console.log('[AccessiFlow][Blind] ' + msg);
  }

  _warn(msg) {
    console.warn('[AccessiFlow][Blind] ' + msg);
  }

  // ─── Helper: track a repair for undo ───────────────────────
  _trackRepair(element, attribute, originalValue) {
    this._repairs.push({ element, attribute, originalValue });
  }

  // ─── Helper: create announcer live region ──────────────────
  _getAnnouncer() {
    if (this._announcerEl && document.body.contains(this._announcerEl)) {
      return this._announcerEl;
    }
    const el = document.createElement('div');
    el.id = 'accessiflow-announcer';
    el.setAttribute('aria-live', 'assertive');
    el.setAttribute('aria-atomic', 'true');
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;padding:0;margin:-1px;';
    document.body.appendChild(el);
    this._announcerEl = el;
    return el;
  }

  _announce(text) {
    try {
      const announcer = this._getAnnouncer();
      announcer.textContent = '';
      // Small delay so screen readers detect the change
      setTimeout(() => { announcer.textContent = text; }, 100);
    } catch (e) {
      this._warn('announce failed: ' + e.message);
    }
  }

  // ─── Helper: focus trap for modal dialogs ──────────────────
  _trapFocus(container) {
    const focusable = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const handler = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    container.addEventListener('keydown', handler);
    return handler;
  }

  // ═══════════════════════════════════════════════════════════
  // 1. repairMissingAltText
  // ═══════════════════════════════════════════════════════════
  repairMissingAltText(root) {
    try {
      const scope = root || document;
      const images = scope.querySelectorAll('img:not([data-accessiflow-alt-repaired])');
      let repaired = 0;

      images.forEach(img => {
        try {
          const hasAlt = img.hasAttribute('alt');
          const altVal = img.getAttribute('alt');

          // Skip images that already have meaningful alt text
          if (hasAlt && altVal && altVal.trim().length > 0) return;

          // Check if decorative: inside <a> with text, or inside <button> with text
          const parentLink = img.closest('a');
          const parentButton = img.closest('button, [role="button"]');
          const isDecorative = (parentLink && parentLink.textContent.trim().replace(altVal || '', '').trim().length > 0) ||
                               (parentButton && parentButton.textContent.trim().replace(altVal || '', '').trim().length > 0);

          if (isDecorative) {
            // Decorative images should have empty alt
            if (!hasAlt || altVal !== '') {
              this._trackRepair(img, 'alt', hasAlt ? altVal : null);
              img.setAttribute('alt', '');
              img.setAttribute('data-accessiflow-alt-repaired', 'decorative');
              repaired++;
            }
          } else {
            // Content image with no alt attribute at all: add a placeholder. An
            // explicit alt="" is the author marking the image decorative (WCAG
            // technique H67), so it stays silent rather than becoming noise.
            if (!hasAlt) {
              this._trackRepair(img, 'alt', null);
              img.setAttribute('alt', '[Image - description unavailable]');
              img.setAttribute('data-accessiflow-alt-repaired', 'placeholder');
              repaired++;
            }
          }
        } catch (e) {
          this._warn('repairMissingAltText single img: ' + e.message);
        }
      });

      if (repaired > 0) this._log('Repaired alt text on ' + repaired + ' images');
      return repaired;
    } catch (e) {
      this._warn('repairMissingAltText: ' + e.message);
      return 0;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 2. repairEmptyLinks
  // ═══════════════════════════════════════════════════════════
  repairEmptyLinks(root) {
    try {
      const scope = root || document;
      const links = scope.querySelectorAll('a[href]:not([data-accessiflow-link-repaired])');
      let repaired = 0;

      links.forEach(link => {
        try {
          // Skip if already has accessible name
          const text = link.textContent.trim();
          const ariaLabel = link.getAttribute('aria-label');
          const ariaLabelledBy = link.getAttribute('aria-labelledby');
          const title = link.getAttribute('title');

          if (text || ariaLabel || ariaLabelledBy || title) return;

          let label = '';

          // Check if contains only an <img>
          const imgs = link.querySelectorAll('img');
          if (imgs.length === 1 && link.children.length === 1) {
            const imgAlt = imgs[0].getAttribute('alt');
            if (imgAlt && imgAlt.trim()) {
              label = imgAlt.trim();
            }
          }

          // Check if contains only an icon font element
          if (!label) {
            const iconEl = link.querySelector('i[class], span[class*="icon"], span[class*="fa-"]');
            if (iconEl) {
              const classes = iconEl.className;
              // Try to infer intent from class names like fa-home, icon-search, etc.
              const match = classes.match(/(?:fa-|icon-|glyphicon-|material-icons?\s*)(\w[\w-]*)/i);
              if (match) {
                // Convert class name to readable label: fa-home → Home
                label = match[1].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              }
            }
          }

          // Check for SVG with title
          if (!label) {
            const svg = link.querySelector('svg');
            if (svg) {
              const svgTitle = svg.querySelector('title');
              if (svgTitle && svgTitle.textContent.trim()) {
                label = svgTitle.textContent.trim();
              }
            }
          }

          // Fallback
          if (!label) {
            label = 'Link (no description available)';
          }

          this._trackRepair(link, 'aria-label', link.getAttribute('aria-label'));
          link.setAttribute('aria-label', label);
          link.setAttribute('data-accessiflow-link-repaired', 'true');
          repaired++;
        } catch (e) {
          this._warn('repairEmptyLinks single link: ' + e.message);
        }
      });

      if (repaired > 0) this._log('Repaired ' + repaired + ' empty links');
      return repaired;
    } catch (e) {
      this._warn('repairEmptyLinks: ' + e.message);
      return 0;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 3. repairEmptyButtons
  // ═══════════════════════════════════════════════════════════
  repairEmptyButtons(root) {
    try {
      const scope = root || document;
      const buttons = scope.querySelectorAll(
        'button:not([data-accessiflow-btn-repaired]), [role="button"]:not([data-accessiflow-btn-repaired])'
      );
      let repaired = 0;

      buttons.forEach(btn => {
        try {
          const text = btn.textContent.trim();
          const ariaLabel = btn.getAttribute('aria-label');
          const ariaLabelledBy = btn.getAttribute('aria-labelledby');
          const title = btn.getAttribute('title');

          if (text || ariaLabel || ariaLabelledBy || title) return;

          let label = '';

          // Check for img inside
          const img = btn.querySelector('img');
          if (img) {
            const imgAlt = img.getAttribute('alt');
            if (imgAlt && imgAlt.trim()) {
              label = imgAlt.trim();
            }
          }

          // Check for SVG with <title>
          if (!label) {
            const svg = btn.querySelector('svg');
            if (svg) {
              const svgTitle = svg.querySelector('title');
              if (svgTitle && svgTitle.textContent.trim()) {
                label = svgTitle.textContent.trim();
              }
            }
          }

          // Check for icon font classes
          if (!label) {
            const iconEl = btn.querySelector('i[class], span[class*="icon"], span[class*="fa-"]');
            if (iconEl) {
              const classes = iconEl.className;
              const match = classes.match(/(?:fa-|icon-|glyphicon-|material-icons?\s*)(\w[\w-]*)/i);
              if (match) {
                label = match[1].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              }
            }
          }

          // Fallback
          if (!label) {
            label = 'Button (no description available)';
          }

          this._trackRepair(btn, 'aria-label', btn.getAttribute('aria-label'));
          btn.setAttribute('aria-label', label);
          btn.setAttribute('data-accessiflow-btn-repaired', 'true');
          repaired++;
        } catch (e) {
          this._warn('repairEmptyButtons single btn: ' + e.message);
        }
      });

      if (repaired > 0) this._log('Repaired ' + repaired + ' empty buttons');
      return repaired;
    } catch (e) {
      this._warn('repairEmptyButtons: ' + e.message);
      return 0;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 4. repairMissingFormLabels
  // ═══════════════════════════════════════════════════════════
  repairMissingFormLabels(root) {
    try {
      const scope = root || document;
      const inputs = scope.querySelectorAll(
        'input:not([type="hidden"]):not([data-accessiflow-label-repaired]), ' +
        'select:not([data-accessiflow-label-repaired]), ' +
        'textarea:not([data-accessiflow-label-repaired])'
      );
      let repaired = 0;

      inputs.forEach(input => {
        try {
          // Check if already has an associated label
          const id = input.id;
          const hasLinkedLabel = id && document.querySelector('label[for="' + CSS.escape(id) + '"]');
          const ariaLabel = input.getAttribute('aria-label');
          const ariaLabelledBy = input.getAttribute('aria-labelledby');
          const parentLabel = input.closest('label');

          if (hasLinkedLabel || ariaLabel || ariaLabelledBy || parentLabel) {
            // Still check for aria-required
            if (input.hasAttribute('required') && !input.hasAttribute('aria-required')) {
              this._trackRepair(input, 'aria-required', null);
              input.setAttribute('aria-required', 'true');
            }
            return;
          }

          let label = '';

          // Check placeholder as fallback
          const placeholder = input.getAttribute('placeholder');
          if (placeholder && placeholder.trim()) {
            label = placeholder.trim();
          }

          // Check for adjacent text node or preceding <span>/<p>
          if (!label) {
            const prevSibling = input.previousElementSibling;
            if (prevSibling && (prevSibling.tagName === 'SPAN' || prevSibling.tagName === 'P' || prevSibling.tagName === 'LABEL')) {
              const sibText = prevSibling.textContent.trim();
              if (sibText) {
                label = sibText;
              }
            }
          }

          // Check for preceding text node
          if (!label) {
            const prevNode = input.previousSibling;
            if (prevNode && prevNode.nodeType === Node.TEXT_NODE) {
              const nodeText = prevNode.textContent.trim();
              if (nodeText) {
                label = nodeText;
              }
            }
          }

          // Check parent's direct text
          if (!label && input.parentElement) {
            const parentText = Array.from(input.parentElement.childNodes)
              .filter(n => n.nodeType === Node.TEXT_NODE)
              .map(n => n.textContent.trim())
              .filter(t => t.length > 0)
              .join(' ');
            if (parentText) {
              label = parentText.substring(0, 80);
            }
          }

          // Check title attribute
          if (!label) {
            const titleAttr = input.getAttribute('title');
            if (titleAttr && titleAttr.trim()) {
              label = titleAttr.trim();
            }
          }

          // Check name attribute as last resort
          if (!label) {
            const name = input.getAttribute('name');
            if (name) {
              label = name.replace(/[-_\[\]]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
            }
          }

          // Fallback by input type
          if (!label) {
            const type = (input.getAttribute('type') || input.tagName).toLowerCase();
            label = 'Input field (' + type + ')';
          }

          this._trackRepair(input, 'aria-label', input.getAttribute('aria-label'));
          input.setAttribute('aria-label', label);
          input.setAttribute('data-accessiflow-label-repaired', 'true');
          repaired++;

          // Add aria-required for required inputs
          if (input.hasAttribute('required') && !input.hasAttribute('aria-required')) {
            this._trackRepair(input, 'aria-required', null);
            input.setAttribute('aria-required', 'true');
          }
        } catch (e) {
          this._warn('repairMissingFormLabels single input: ' + e.message);
        }
      });

      if (repaired > 0) this._log('Repaired labels on ' + repaired + ' form fields');
      return repaired;
    } catch (e) {
      this._warn('repairMissingFormLabels: ' + e.message);
      return 0;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 5. repairMissingLandmarks
  // ═══════════════════════════════════════════════════════════
  repairMissingLandmarks() {
    try {
      let repaired = 0;

      // Main landmark
      const hasMain = document.querySelector('main, [role="main"]');
      if (!hasMain) {
        // Find the largest content block
        const candidates = document.querySelectorAll('div, section, article');
        let largest = null;
        let maxText = 0;
        candidates.forEach(el => {
          const len = el.textContent.length;
          // Ignore tiny or deeply nested wrappers; prefer blocks inside body
          if (len > maxText && el.closest('nav, aside, header, footer') === null) {
            maxText = len;
            largest = el;
          }
        });
        if (largest) {
          this._trackRepair(largest, 'role', largest.getAttribute('role'));
          largest.setAttribute('role', 'main');
          repaired++;
          this._log('Assigned role="main" to largest content block');
        }
      }

      // Navigation landmark
      const hasNav = document.querySelector('nav, [role="navigation"]');
      if (!hasNav) {
        // Find <ul> with mostly links
        const uls = document.querySelectorAll('ul');
        uls.forEach(ul => {
          if (document.querySelector('[role="navigation"]')) return; // already found one
          const items = ul.querySelectorAll('li');
          const links = ul.querySelectorAll('li > a');
          if (items.length >= 3 && links.length / items.length >= 0.6) {
            const wrapper = ul.parentElement && ul.parentElement.tagName !== 'BODY' ? ul.parentElement : ul;
            this._trackRepair(wrapper, 'role', wrapper.getAttribute('role'));
            wrapper.setAttribute('role', 'navigation');
            repaired++;
            this._log('Assigned role="navigation" to list with mostly links');
          }
        });
      }

      // Banner, <header> not inside article/section
      const headers = document.querySelectorAll('header');
      headers.forEach(header => {
        try {
          const insideContentSection = header.closest('article, section');
          if (!insideContentSection && !header.hasAttribute('role')) {
            this._trackRepair(header, 'role', null);
            header.setAttribute('role', 'banner');
            repaired++;
          }
        } catch (e) { /* skip */ }
      });

      // Contentinfo, <footer> not inside article/section
      const footers = document.querySelectorAll('footer');
      footers.forEach(footer => {
        try {
          const insideContentSection = footer.closest('article, section');
          if (!insideContentSection && !footer.hasAttribute('role')) {
            this._trackRepair(footer, 'role', null);
            footer.setAttribute('role', 'contentinfo');
            repaired++;
          }
        } catch (e) { /* skip */ }
      });

      if (repaired > 0) this._log('Repaired ' + repaired + ' missing landmarks');
      return repaired;
    } catch (e) {
      this._warn('repairMissingLandmarks: ' + e.message);
      return 0;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 6. injectLiveRegions
  // ═══════════════════════════════════════════════════════════
  injectLiveRegions(root) {
    try {
      const scope = root || document;
      const selectors = [
        '[class*="notification"]',
        '[class*="alert"]',
        '[class*="toast"]',
        '[class*="error"]',
        '[class*="status"]',
        '[class*="message"]',
        '[class*="cart"]',
        '[class*="count"]',
        '[class*="badge"]'
      ];

      const urgentSelectors = ['[class*="alert"]', '[class*="error"]'];
      let repaired = 0;

      selectors.forEach(selector => {
        try {
          const elements = scope.querySelectorAll(selector + ':not([data-accessiflow-live-repaired])');
          elements.forEach(el => {
            try {
              if (el.hasAttribute('aria-live')) return;

              const isUrgent = urgentSelectors.some(s => el.matches(s));

              this._trackRepair(el, 'aria-live', null);
              el.setAttribute('aria-live', isUrgent ? 'assertive' : 'polite');

              if (isUrgent) {
                this._trackRepair(el, 'aria-atomic', null);
                el.setAttribute('aria-atomic', 'true');
              }

              el.setAttribute('data-accessiflow-live-repaired', 'true');
              repaired++;
            } catch (e) { /* skip */ }
          });
        } catch (e) { /* selector may fail on some pages */ }
      });

      if (repaired > 0) this._log('Injected aria-live on ' + repaired + ' dynamic regions');
      return repaired;
    } catch (e) {
      this._warn('injectLiveRegions: ' + e.message);
      return 0;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 7. announcePageChanges
  // ═══════════════════════════════════════════════════════════
  announcePageChanges() {
    try {
      // Watch for URL changes (SPA navigation)
      this._lastUrl = location.href;

      this._pageChangeObserver = new MutationObserver((mutations) => {
        try {
          // Check for URL change
          if (location.href !== this._lastUrl) {
            this._lastUrl = location.href;
            const title = document.title || location.pathname;
            this._announce('Navigated to: ' + title);
            return;
          }

          // Check for large DOM subtree replacements
          for (const mutation of mutations) {
            if (mutation.type === 'childList' &&
                mutation.addedNodes.length > 5 &&
                mutation.target.closest &&
                (mutation.target.closest('main, [role="main"], article') || mutation.target === document.body)) {
              this._announce('Page content updated');
              break;
            }
          }
        } catch (e) {
          this._warn('announcePageChanges observer callback: ' + e.message);
        }
      });

      this._pageChangeObserver.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Watch for <title> changes
      const titleEl = document.querySelector('title');
      if (titleEl) {
        this._titleObserver = new MutationObserver(() => {
          try {
            this._announce('Page title changed to: ' + document.title);
          } catch (e) { /* skip */ }
        });
        this._titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
      }

      this._log('Page change announcer active');
    } catch (e) {
      this._warn('announcePageChanges: ' + e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 8. injectLandmarkNav
  // ═══════════════════════════════════════════════════════════
  injectLandmarkNav() {
    try {
      const handler = (e) => {
        if (e.altKey && e.shiftKey && e.key === 'L') {
          e.preventDefault();
          this._toggleLandmarkPanel();
          this._announce('Landmark navigation opened');
        }
      };
      document.addEventListener('keydown', handler);
      this._landmarkNavHandler = handler;
      this._log('Landmark navigation shortcut (Alt+Shift+L) registered');
    } catch (e) {
      this._warn('injectLandmarkNav: ' + e.message);
    }
  }

  _toggleLandmarkPanel() {
    try {
      // If already open, close it
      if (this._landmarkPanel && document.body.contains(this._landmarkPanel)) {
        this._closeLandmarkPanel();
        return;
      }

      // Gather all landmarks
      const landmarkSelectors = [
        { selector: 'main, [role="main"]', label: 'Main' },
        { selector: 'nav, [role="navigation"]', label: 'Navigation' },
        { selector: '[role="search"]', label: 'Search' },
        { selector: 'header, [role="banner"]', label: 'Banner' },
        { selector: 'footer, [role="contentinfo"]', label: 'Footer' },
        { selector: 'aside, [role="complementary"]', label: 'Aside' },
        { selector: '[role="region"][aria-label], section[aria-label]', label: 'Region' },
        { selector: 'form[aria-label], form[aria-labelledby], [role="form"]', label: 'Form' }
      ];

      const landmarks = [];
      landmarkSelectors.forEach(ls => {
        try {
          const found = document.querySelectorAll(ls.selector);
          found.forEach((el, idx) => {
            const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || '';
            const name = ariaLabel ? ls.label + ': ' + ariaLabel : ls.label + (found.length > 1 ? ' ' + (idx + 1) : '');
            landmarks.push({ element: el, name: name });
          });
        } catch (e) { /* skip */ }
      });

      if (landmarks.length === 0) {
        this._announce('No landmarks found on this page');
        return;
      }

      // Build panel
      const panel = document.createElement('div');
      panel.id = 'accessiflow-landmark-nav';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', 'Landmark Navigation');
      panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
        'background:#16181f;color:#e0e0e0;border:2px solid #4fffb0;border-radius:12px;' +
        'padding:20px;z-index:2147483647;max-width:400px;max-height:70vh;overflow-y:auto;' +
        'font-family:system-ui,-apple-system,sans-serif;font-size:14px;box-shadow:0 8px 32px rgba(0,0,0,0.6);';

      const title = document.createElement('h2');
      title.textContent = 'Landmarks';
      title.style.cssText = 'margin:0 0 12px 0;color:#4fffb0;font-size:16px;';
      panel.appendChild(title);

      const list = document.createElement('div');
      list.setAttribute('role', 'list');

      landmarks.forEach((lm) => {
        const btn = document.createElement('button');
        btn.textContent = lm.name;
        btn.setAttribute('role', 'listitem');
        btn.style.cssText = 'display:block;width:100%;padding:8px 12px;margin:4px 0;' +
          'background:#0e0f13;color:#e0e0e0;border:1px solid #333;border-radius:6px;' +
          'cursor:pointer;text-align:left;font-size:14px;font-family:inherit;';
        btn.addEventListener('mouseover', () => { btn.style.borderColor = '#4fffb0'; btn.style.color = '#4fffb0'; });
        btn.addEventListener('mouseout', () => { btn.style.borderColor = '#333'; btn.style.color = '#e0e0e0'; });
        btn.addEventListener('click', () => {
          this._closeLandmarkPanel();
          lm.element.setAttribute('tabindex', '-1');
          lm.element.focus();
          lm.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        list.appendChild(btn);
      });

      panel.appendChild(list);

      // Close button
      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close (ESC)';
      closeBtn.setAttribute('aria-label', 'Close landmark navigation');
      closeBtn.style.cssText = 'display:block;margin:12px auto 0;padding:6px 16px;' +
        'background:#4fffb0;color:#0e0f13;border:none;border-radius:6px;cursor:pointer;' +
        'font-weight:bold;font-size:13px;font-family:inherit;';
      closeBtn.addEventListener('click', () => this._closeLandmarkPanel());
      panel.appendChild(closeBtn);

      // ESC to close
      const escHandler = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          this._closeLandmarkPanel();
        }
      };
      panel.addEventListener('keydown', escHandler);
      panel._escHandler = escHandler;

      document.body.appendChild(panel);
      this._landmarkPanel = panel;

      // Focus trap
      this._trapFocus(panel);

      // Focus the first button
      const firstBtn = panel.querySelector('button');
      if (firstBtn) firstBtn.focus();
    } catch (e) {
      this._warn('_toggleLandmarkPanel: ' + e.message);
    }
  }

  _closeLandmarkPanel() {
    try {
      if (this._landmarkPanel && document.body.contains(this._landmarkPanel)) {
        this._landmarkPanel.remove();
        this._landmarkPanel = null;
        this._announce('Landmark navigation closed');
      }
    } catch (e) { /* skip */ }
  }

  // ═══════════════════════════════════════════════════════════
  // 9. injectHeadingNav
  // ═══════════════════════════════════════════════════════════
  injectHeadingNav() {
    try {
      const handler = (e) => {
        if (e.altKey && e.shiftKey && e.key === 'H') {
          e.preventDefault();
          this._toggleHeadingPanel();
          this._announce('Heading navigation opened');
        }
      };
      document.addEventListener('keydown', handler);
      this._headingNavHandler = handler;
      this._log('Heading navigation shortcut (Alt+Shift+H) registered');
    } catch (e) {
      this._warn('injectHeadingNav: ' + e.message);
    }
  }

  _toggleHeadingPanel() {
    try {
      if (this._headingPanel && document.body.contains(this._headingPanel)) {
        this._closeHeadingPanel();
        return;
      }

      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      if (headings.length === 0) {
        this._announce('No headings found on this page');
        return;
      }

      const panel = document.createElement('div');
      panel.id = 'accessiflow-heading-nav';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', 'Heading Navigation');
      panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
        'background:#16181f;color:#e0e0e0;border:2px solid #4fffb0;border-radius:12px;' +
        'padding:20px;z-index:2147483647;max-width:450px;max-height:70vh;overflow-y:auto;' +
        'font-family:system-ui,-apple-system,sans-serif;font-size:14px;box-shadow:0 8px 32px rgba(0,0,0,0.6);';

      const title = document.createElement('h2');
      title.textContent = 'Headings';
      title.style.cssText = 'margin:0 0 12px 0;color:#4fffb0;font-size:16px;';
      panel.appendChild(title);

      const tree = document.createElement('div');
      tree.setAttribute('role', 'tree');
      tree.setAttribute('aria-label', 'Page heading structure');

      const levelColors = {
        H1: '#9b59b6', H2: '#6366f1', H3: '#3b82f6',
        H4: '#22d3ee', H5: '#f59e0b', H6: '#ef4444'
      };

      headings.forEach((heading) => {
        const level = parseInt(heading.tagName.substring(1));
        const tag = heading.tagName;

        const btn = document.createElement('button');
        btn.setAttribute('role', 'treeitem');
        btn.setAttribute('aria-level', String(level));
        btn.style.cssText = 'display:block;width:100%;padding:6px 10px;margin:2px 0;' +
          'padding-left:' + (12 + (level - 1) * 18) + 'px;' +
          'background:#0e0f13;color:#e0e0e0;border:1px solid #333;border-radius:6px;' +
          'cursor:pointer;text-align:left;font-size:13px;font-family:inherit;';

        const badge = document.createElement('span');
        badge.textContent = tag;
        badge.style.cssText = 'display:inline-block;background:' + (levelColors[tag] || '#666') +
          ';color:#fff;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:bold;margin-right:8px;';
        btn.appendChild(badge);

        const text = document.createTextNode(heading.textContent.trim().substring(0, 60) +
          (heading.textContent.trim().length > 60 ? '...' : ''));
        btn.appendChild(text);

        btn.addEventListener('mouseover', () => { btn.style.borderColor = '#4fffb0'; });
        btn.addEventListener('mouseout', () => { btn.style.borderColor = '#333'; });
        btn.addEventListener('click', () => {
          this._closeHeadingPanel();
          heading.setAttribute('tabindex', '-1');
          heading.focus();
          heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });

        tree.appendChild(btn);
      });

      panel.appendChild(tree);

      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close (ESC)';
      closeBtn.setAttribute('aria-label', 'Close heading navigation');
      closeBtn.style.cssText = 'display:block;margin:12px auto 0;padding:6px 16px;' +
        'background:#4fffb0;color:#0e0f13;border:none;border-radius:6px;cursor:pointer;' +
        'font-weight:bold;font-size:13px;font-family:inherit;';
      closeBtn.addEventListener('click', () => this._closeHeadingPanel());
      panel.appendChild(closeBtn);

      const escHandler = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          this._closeHeadingPanel();
        }
      };
      panel.addEventListener('keydown', escHandler);

      document.body.appendChild(panel);
      this._headingPanel = panel;

      this._trapFocus(panel);

      const firstBtn = panel.querySelector('[role="treeitem"]');
      if (firstBtn) firstBtn.focus();
    } catch (e) {
      this._warn('_toggleHeadingPanel: ' + e.message);
    }
  }

  _closeHeadingPanel() {
    try {
      if (this._headingPanel && document.body.contains(this._headingPanel)) {
        this._headingPanel.remove();
        this._headingPanel = null;
        this._announce('Heading navigation closed');
      }
    } catch (e) { /* skip */ }
  }

  // ═══════════════════════════════════════════════════════════
  // 10. repairSkipLinks
  // ═══════════════════════════════════════════════════════════
  repairSkipLinks() {
    try {
      // Check if page already has a skip link
      const existingSkip = document.querySelector(
        'a[href^="#"][class*="skip"], a[href^="#main"], a.skip-link, a.skip-nav, .accessiflow-skip-link'
      );
      if (existingSkip) {
        this._log('Skip link already exists');
        return;
      }

      // Find the main content element
      const mainEl = document.querySelector('main, [role="main"]');
      const targetId = 'accessiflow-main';

      if (mainEl && !mainEl.id) {
        this._trackRepair(mainEl, 'id', mainEl.getAttribute('id'));
        mainEl.id = targetId;
      } else if (mainEl && mainEl.id) {
        // Use existing id
      }

      // Inject skip link as first child of body
      const skipLink = document.createElement('a');
      skipLink.href = '#' + (mainEl ? (mainEl.id || targetId) : targetId);
      skipLink.className = 'accessiflow-skip-link';
      skipLink.textContent = 'Skip to main content';
      skipLink.setAttribute('data-accessiflow-injected', 'true');
      skipLink.style.cssText = 'position:absolute;top:0;left:0;padding:12px 24px;' +
        'background:#4fffb0;color:#0e0f13;font-size:16px;font-weight:bold;z-index:2147483647;' +
        'text-decoration:none;transform:translateY(-100%);transition:transform 0.2s ease;' +
        'font-family:system-ui,-apple-system,sans-serif;border-radius:0 0 8px 0;';

      // Add focus style via a class approach
      skipLink.addEventListener('focus', () => {
        skipLink.style.transform = 'translateY(0)';
      });
      skipLink.addEventListener('blur', () => {
        skipLink.style.transform = 'translateY(-100%)';
      });

      document.body.insertBefore(skipLink, document.body.firstChild);
      this._skipLinkInjected = true;
      this._log('Skip link injected');
    } catch (e) {
      this._warn('repairSkipLinks: ' + e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 11. repairTabOrder
  // ═══════════════════════════════════════════════════════════
  repairTabOrder() {
    try {
      const positiveTabindex = document.querySelectorAll('[tabindex]');
      let violations = 0;
      let normalized = 0;

      positiveTabindex.forEach(el => {
        try {
          const val = parseInt(el.getAttribute('tabindex'), 10);
          if (val > 0) {
            violations++;
            this._trackRepair(el, 'tabindex', el.getAttribute('tabindex'));
            el.setAttribute('tabindex', '0');
            el.setAttribute('data-accessiflow-tabindex-repaired', 'true');
            normalized++;
          }
        } catch (e) { /* skip */ }
      });

      if (violations > 0) {
        this._log('Found ' + violations + ' positive tabindex violations, normalized ' + normalized + ' to 0');
      }
      return violations;
    } catch (e) {
      this._warn('repairTabOrder: ' + e.message);
      return 0;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 12. repairARIAExpanded
  // ═══════════════════════════════════════════════════════════
  repairARIAExpanded(root) {
    try {
      const scope = root || document;
      const selectors = [
        '[data-toggle]',
        '[data-collapse]',
        '.accordion-trigger',
        'button[onclick*="toggle"]',
        'button[onclick*="expand"]',
        '[data-bs-toggle]',
        '[data-target]',
        '.collapse-toggle',
        '[aria-controls]:not([aria-expanded])'
      ];

      let repaired = 0;

      selectors.forEach(selector => {
        try {
          const elements = scope.querySelectorAll(selector + ':not([data-accessiflow-expanded-repaired])');
          elements.forEach(el => {
            try {
              if (el.hasAttribute('aria-expanded')) return;

              this._trackRepair(el, 'aria-expanded', null);
              el.setAttribute('aria-expanded', 'false');
              el.setAttribute('data-accessiflow-expanded-repaired', 'true');
              repaired++;

              // Set up click listener to toggle aria-expanded
              if (!this._ariaExpandedListeners.has(el)) {
                const clickHandler = () => {
                  const current = el.getAttribute('aria-expanded');
                  el.setAttribute('aria-expanded', current === 'true' ? 'false' : 'true');

                  // Also update controlled panel if aria-controls is present
                  const controlsId = el.getAttribute('aria-controls') ||
                                     el.getAttribute('data-target') ||
                                     el.getAttribute('data-bs-target');
                  if (controlsId) {
                    const cleanId = controlsId.replace(/^#/, '');
                    const controlledPanel = document.getElementById(cleanId);
                    if (controlledPanel) {
                      const isExpanded = el.getAttribute('aria-expanded') === 'true';
                      controlledPanel.setAttribute('aria-hidden', isExpanded ? 'false' : 'true');
                    }
                  }
                };
                el.addEventListener('click', clickHandler);
                this._ariaExpandedListeners.set(el, clickHandler);
              }

              // Link trigger to controlled panel via aria-controls
              const target = el.getAttribute('data-target') || el.getAttribute('data-bs-target') || el.getAttribute('href');
              if (target && target.startsWith('#') && !el.hasAttribute('aria-controls')) {
                const targetId = target.replace(/^#/, '');
                if (targetId && document.getElementById(targetId)) {
                  this._trackRepair(el, 'aria-controls', null);
                  el.setAttribute('aria-controls', targetId);
                }
              }
            } catch (e) { /* skip */ }
          });
        } catch (e) { /* selector may fail */ }
      });

      if (repaired > 0) this._log('Repaired aria-expanded on ' + repaired + ' toggle elements');
      return repaired;
    } catch (e) {
      this._warn('repairARIAExpanded: ' + e.message);
      return 0;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 13. announcePageSummary
  // ═══════════════════════════════════════════════════════════
  announcePageSummary() {
    try {
      this._pageSummaryTimeout = setTimeout(() => {
        try {
          const title = document.title || 'Untitled';
          const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6').length;
          const landmarks = document.querySelectorAll(
            'main, [role="main"], nav, [role="navigation"], aside, [role="complementary"], ' +
            'header, [role="banner"], footer, [role="contentinfo"], [role="search"], [role="form"]'
          ).length;
          const links = document.querySelectorAll('a[href]').length;
          const formFields = document.querySelectorAll(
            'input:not([type="hidden"]), select, textarea'
          ).length;
          const images = document.querySelectorAll('img').length;
          const tables = document.querySelectorAll('table').length;

          const summary = 'Page loaded: ' + title + '. Contains ' +
            headings + ' headings, ' +
            landmarks + ' landmarks, ' +
            links + ' links, ' +
            formFields + ' form fields.';

          this._announce(summary);
          this._log(summary);

          // Remove announcement after 5 seconds
          setTimeout(() => {
            try {
              const announcer = this._announcerEl;
              if (announcer) announcer.textContent = '';
            } catch (e) { /* skip */ }
          }, 5000);
        } catch (e) {
          this._warn('announcePageSummary inner: ' + e.message);
        }
      }, 1500);
    } catch (e) {
      this._warn('announcePageSummary: ' + e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 14. repairDataTables
  // ═══════════════════════════════════════════════════════════
  repairDataTables(root) {
    try {
      const scope = root || document;
      const tables = scope.querySelectorAll('table:not([data-accessiflow-table-repaired])');
      let repaired = 0;

      tables.forEach(table => {
        try {
          // Distinguish layout tables from data tables
          const role = table.getAttribute('role');
          if (role === 'presentation' || role === 'none') return; // Layout table, skip

          const isLikelyLayout = !table.querySelector('th') &&
                                  !table.querySelector('thead') &&
                                  !table.getAttribute('summary') &&
                                  table.rows.length <= 1;
          if (isLikelyLayout) return;

          // Mark as data table if no role
          if (!role) {
            this._trackRepair(table, 'role', null);
            table.setAttribute('role', 'table');
          }

          // Add caption if missing
          if (!table.querySelector('caption')) {
            const caption = document.createElement('caption');
            caption.setAttribute('data-accessiflow-injected', 'true');

            // Try to find a heading just above the table
            let labelText = '';
            const ariaLabel = table.getAttribute('aria-label');

            if (ariaLabel) {
              labelText = ariaLabel;
            } else {
              // Look for a preceding heading
              let prev = table.previousElementSibling;
              let depth = 0;
              while (prev && depth < 3) {
                if (/^H[1-6]$/.test(prev.tagName)) {
                  labelText = prev.textContent.trim();
                  break;
                }
                prev = prev.previousElementSibling;
                depth++;
              }
            }

            if (labelText) {
              caption.textContent = labelText;
              // Use sr-only style if we're duplicating visible text
              caption.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;' +
                'clip:rect(0,0,0,0);white-space:nowrap;border:0;';
              table.insertBefore(caption, table.firstChild);
              repaired++;
            }
          }

          // Add scope to <th> elements if missing
          const ths = table.querySelectorAll('th:not([scope])');
          ths.forEach(th => {
            try {
              // Determine if this is a column header or row header
              const row = th.parentElement;
              const isInThead = th.closest('thead') !== null;
              const isFirstInRow = row && row.cells[0] === th;

              if (isInThead || (!isFirstInRow && row && Array.from(row.cells).indexOf(th) >= 0)) {
                this._trackRepair(th, 'scope', null);
                th.setAttribute('scope', 'col');
              } else if (isFirstInRow) {
                this._trackRepair(th, 'scope', null);
                th.setAttribute('scope', 'row');
              }
              repaired++;
            } catch (e) { /* skip */ }
          });

          // If data table has no headers at all, add aria-labels to cells
          if (!table.querySelector('th') && table.rows.length > 1) {
            // Treat first row as headers
            const firstRow = table.rows[0];
            if (firstRow) {
              const headerTexts = Array.from(firstRow.cells).map(cell => cell.textContent.trim());
              // Apply aria-labels to data cells
              for (let i = 1; i < table.rows.length; i++) {
                const row = table.rows[i];
                for (let j = 0; j < row.cells.length; j++) {
                  if (headerTexts[j]) {
                    row.cells[j].setAttribute('aria-label', headerTexts[j] + ': ' + row.cells[j].textContent.trim());
                  }
                }
              }
              repaired++;
            }
          }

          table.setAttribute('data-accessiflow-table-repaired', 'true');
        } catch (e) {
          this._warn('repairDataTables single table: ' + e.message);
        }
      });

      if (repaired > 0) this._log('Repaired ' + repaired + ' table accessibility issues');
      return repaired;
    } catch (e) {
      this._warn('repairDataTables: ' + e.message);
      return 0;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // repairNode, called by MutationObserver for new DOM nodes
  // ═══════════════════════════════════════════════════════════
  repairNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    try {
      this.repairMissingAltText(node);
      this.repairEmptyLinks(node);
      this.repairEmptyButtons(node);
      this.repairMissingFormLabels(node);
      this.injectLiveRegions(node);
      this.repairARIAExpanded(node);
      this.repairDataTables(node);
    } catch (e) {
      this._warn('repairNode: ' + e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // runAll, executes all repair functions on the full page
  // ═══════════════════════════════════════════════════════════
  runAll() {
    this._log('Running all accessibility repairs...');
    try {
      this.repairMissingAltText();
      this.repairEmptyLinks();
      this.repairEmptyButtons();
      this.repairMissingFormLabels();
      this.repairMissingLandmarks();
      this.injectLiveRegions();
      this.repairSkipLinks();
      this.repairTabOrder();
      this.repairARIAExpanded();
      this.repairDataTables();
      this.announcePageChanges();
      this.injectLandmarkNav();
      this.injectHeadingNav();
      this.announcePageSummary();
      this._log('All repairs complete');
    } catch (e) {
      this._warn('runAll: ' + e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // destroy, undo all repairs and clean up
  // ═══════════════════════════════════════════════════════════
  destroy() {
    try {
      // Restore all tracked repairs
      this._repairs.forEach(r => {
        try {
          // An AI description written over our placeholder is not ours to
          // undo: the user asked for it and it cost a request to make. Undoing
          // it would also strand the image, since it stays marked as described.
          if (r.attribute === 'alt' && r.element.getAttribute('data-accessiflow-ai-alt') === 'true') return;
          if (r.originalValue === null) {
            r.element.removeAttribute(r.attribute);
          } else {
            r.element.setAttribute(r.attribute, r.originalValue);
          }
        } catch (e) { /* element may no longer exist */ }
      });
      this._repairs = [];

      // Remove data attributes
      document.querySelectorAll(
        '[data-accessiflow-alt-repaired], [data-accessiflow-link-repaired], ' +
        '[data-accessiflow-btn-repaired], [data-accessiflow-label-repaired], ' +
        '[data-accessiflow-live-repaired], [data-accessiflow-expanded-repaired], ' +
        '[data-accessiflow-table-repaired], [data-accessiflow-tabindex-repaired], ' +
        '[data-accessiflow-injected]'
      ).forEach(el => {
        try {
          el.removeAttribute('data-accessiflow-alt-repaired');
          el.removeAttribute('data-accessiflow-link-repaired');
          el.removeAttribute('data-accessiflow-btn-repaired');
          el.removeAttribute('data-accessiflow-label-repaired');
          el.removeAttribute('data-accessiflow-live-repaired');
          el.removeAttribute('data-accessiflow-expanded-repaired');
          el.removeAttribute('data-accessiflow-table-repaired');
          el.removeAttribute('data-accessiflow-tabindex-repaired');
        } catch (e) { /* skip */ }
      });

      // Remove injected elements
      document.querySelectorAll('[data-accessiflow-injected]').forEach(el => {
        try { el.remove(); } catch (e) { /* skip */ }
      });

      // Clean up observers
      if (this._pageChangeObserver) {
        this._pageChangeObserver.disconnect();
        this._pageChangeObserver = null;
      }
      if (this._titleObserver) {
        this._titleObserver.disconnect();
        this._titleObserver = null;
      }

      // Clean up keyboard handlers
      if (this._landmarkNavHandler) {
        document.removeEventListener('keydown', this._landmarkNavHandler);
        this._landmarkNavHandler = null;
      }
      if (this._headingNavHandler) {
        document.removeEventListener('keydown', this._headingNavHandler);
        this._headingNavHandler = null;
      }

      // Clean up aria-expanded listeners
      this._ariaExpandedListeners.forEach((handler, el) => {
        try { el.removeEventListener('click', handler); } catch (e) { /* skip */ }
      });
      this._ariaExpandedListeners.clear();

      // Close panels
      this._closeLandmarkPanel();
      this._closeHeadingPanel();

      // Remove announcer
      if (this._announcerEl && document.body.contains(this._announcerEl)) {
        this._announcerEl.remove();
        this._announcerEl = null;
      }

      // Remove skip link
      const skipLink = document.querySelector('.accessiflow-skip-link');
      if (skipLink) skipLink.remove();

      // Clear timers
      if (this._pageSummaryTimeout) {
        clearTimeout(this._pageSummaryTimeout);
        this._pageSummaryTimeout = null;
      }

      this._log('All repairs undone, module destroyed');
    } catch (e) {
      this._warn('destroy: ' + e.message);
    }
  }
}

// Export for content.js (IIFE/module pattern, no bundler)
if (typeof window !== 'undefined') {
  window.BlindModule = BlindModule;
}
