// AccessiFlow — AIModule (Claude API Integration)
// Alt text generation, page summaries, link context via Claude API
'use strict';

class AIModule {
  constructor() {
    this._log('AIModule loaded');
  }

  _log(msg) { console.log('[AccessiFlow][AI] ' + msg); }
  _warn(msg) { console.warn('[AccessiFlow][AI] ' + msg); }

  // ── API Key Management ────────────────────────────────────

  async getStoredAPIKey() {
    return new Promise(resolve => {
      chrome.storage.local.get('accessiflow_claude_api_key', data => {
        resolve(data.accessiflow_claude_api_key || '');
      });
    });
  }

  async setAPIKey(key) {
    return new Promise(resolve => {
      chrome.storage.local.set({ accessiflow_claude_api_key: key }, () => {
        this._log('API key saved');
        resolve();
      });
    });
  }

  async hasAPIKey() {
    const key = await this.getStoredAPIKey();
    return !!key;
  }

  // ── Claude API Helper ─────────────────────────────────────

  async callClaude(messages, systemPrompt) {
    const apiKey = await this.getStoredAPIKey();
    if (!apiKey) {
      this._warn('No API key set — skipping AI call');
      return null;
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 150,
          system: systemPrompt,
          messages: messages
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        this._warn('Claude API error ' + response.status + ': ' + errText);
        return null;
      }

      const data = await response.json();
      return data.content[0].text;
    } catch (e) {
      this._warn('callClaude failed: ' + e.message);
      return null;
    }
  }

  // ── Feature 1: Generate Alt Text ──────────────────────────

  async generateAltText(imgElement) {
    if (!imgElement || imgElement.tagName !== 'IMG') return null;
    if (imgElement.getAttribute('data-accessiflow-ai-alt') === 'true') return imgElement.alt;

    this._log('Generating alt text for image: ' + (imgElement.src || '').substring(0, 80));

    // Convert image to base64 via canvas
    let base64 = null;
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = Math.min(imgElement.naturalWidth || 300, 512);
      canvas.height = Math.min(imgElement.naturalHeight || 300, 512);
      ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
      base64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
    } catch (e) {
      this._warn('Cannot convert image to base64 (CORS?): ' + e.message);
      return null;
    }

    const systemPrompt = "You are an accessibility expert. Generate concise, descriptive alt text for this image following WCAG 1.1.1 guidelines. Keep it under 125 characters. Do not start with 'Image of' or 'Picture of'. Describe what is meaningful and relevant. Respond with ONLY the alt text, nothing else.";

    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: base64
            }
          },
          {
            type: 'text',
            text: 'Generate alt text for this image.'
          }
        ]
      }
    ];

    const altText = await this.callClaude(messages, systemPrompt);
    if (altText) {
      imgElement.setAttribute('alt', altText);
      imgElement.setAttribute('data-accessiflow-ai-alt', 'true');
      this._log('Alt text applied: "' + altText + '"');
    }
    return altText;
  }

  // ── Feature 2: Generate Page Summary ──────────────────────

  async generatePageSummary() {
    const main = document.querySelector('main, [role="main"], article, .content, #content');
    const contentEl = main || document.body;
    const text = (contentEl.innerText || '').substring(0, 2000).trim();

    if (!text || text.length < 50) {
      this._warn('Not enough page content for a summary');
      return null;
    }

    this._log('Generating page summary...');

    const systemPrompt = "Summarize this webpage content in one sentence (max 100 words) for a blind user arriving on the page. Focus on the purpose and main content.";
    const messages = [
      { role: 'user', content: text }
    ];

    const summary = await this.callClaude(messages, systemPrompt);
    if (summary) {
      // Inject into an aria-live region
      let liveRegion = document.getElementById('accessiflow-page-summary');
      if (!liveRegion) {
        liveRegion = document.createElement('div');
        liveRegion.id = 'accessiflow-page-summary';
        liveRegion.setAttribute('aria-live', 'polite');
        liveRegion.setAttribute('role', 'status');
        liveRegion.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;';
        document.body.appendChild(liveRegion);
      }
      liveRegion.textContent = 'Page summary: ' + summary;
      this._log('Page summary injected: "' + summary.substring(0, 80) + '..."');
    }
    return summary;
  }

  // ── Feature 3: Generate Link Context ──────────────────────

  async generateLinkContext(anchor) {
    if (!anchor || anchor.tagName !== 'A') return null;
    if (anchor.getAttribute('data-accessiflow-ai-link') === 'true') return anchor.getAttribute('aria-label');

    const text = (anchor.textContent || '').trim().toLowerCase();
    const vagueTexts = ['click here', 'here', 'read more', 'more', 'this', 'link', 'learn more', 'details', 'continue'];
    if (!vagueTexts.includes(text)) return null;

    // Get surrounding context
    const parent = anchor.closest('p, li, div, td, span');
    const context = parent ? (parent.textContent || '').substring(0, 200).trim() : '';

    this._log('Generating link context for: "' + text + '"');

    const systemPrompt = "Generate a descriptive aria-label for this link based on context. The visible text is '" + text + "'. The surrounding context is '" + context + "'. Respond with ONLY the aria-label text, max 60 characters.";
    const messages = [
      { role: 'user', content: 'Link text: "' + text + '"\nSurrounding context: "' + context + '"' }
    ];

    const label = await this.callClaude(messages, systemPrompt);
    if (label) {
      anchor.setAttribute('aria-label', label);
      anchor.setAttribute('data-accessiflow-ai-link', 'true');
      this._log('Link context applied: "' + label + '"');
    }
    return label;
  }

  // ── Batch: Process All images / links ─────────────────────

  async processAllImages() {
    const imgs = document.querySelectorAll('img:not([data-accessiflow-ai-alt])');
    const noAlt = Array.from(imgs).filter(i => !i.alt || !i.alt.trim());
    this._log('Processing ' + noAlt.length + ' images without alt text');
    let processed = 0;
    for (const img of noAlt) {
      const result = await this.generateAltText(img);
      if (result) processed++;
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    }
    this._log('AI alt text generated for ' + processed + '/' + noAlt.length + ' images');
    return processed;
  }

  async processAllVagueLinks() {
    const anchors = document.querySelectorAll('a:not([data-accessiflow-ai-link])');
    const vagueTexts = ['click here', 'here', 'read more', 'more', 'this', 'link', 'learn more', 'details', 'continue'];
    const vague = Array.from(anchors).filter(a => vagueTexts.includes((a.textContent || '').trim().toLowerCase()));
    this._log('Processing ' + vague.length + ' vague links');
    let processed = 0;
    for (const a of vague) {
      const result = await this.generateLinkContext(a);
      if (result) processed++;
      await new Promise(r => setTimeout(r, 500));
    }
    this._log('AI link context generated for ' + processed + '/' + vague.length + ' links');
    return processed;
  }
}

if (typeof window !== 'undefined') window.AIModule = AIModule;
