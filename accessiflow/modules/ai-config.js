// AccessiFlow AI configuration, shared by the service worker and content scripts.
// Attaches to globalThis so the same file works in a window and in a worker.
'use strict';

(function (root) {
  root.ACCESSIFLOW_AI_CONFIG = {
    /**
     * Your deployed proxy. The Hugging Face token lives there, never
     * here (see server/README.md). Replace this with the URL `wrangler deploy` prints,
     * and add the same origin to host_permissions in manifest.json.
     */
    PROXY_ORIGIN: 'https://accessiflow-ai.accessiflow-ai.workers.dev',

    ENDPOINTS: {
      register: '/v1/register',
      describeImage: '/v1/describe-image',
      summarize: '/v1/summarize',
      labelLink: '/v1/label-link',
      health: '/v1/health'
    },

    STORAGE: {
      token: 'accessiflow_ai_token',
      tokenExpiry: 'accessiflow_ai_token_expiry',
      installId: 'accessiflow_ai_install_id',
      consent: 'accessiflow_ai_consent'
    },

    // Downscale images before upload: smaller payload, faster, cheaper, and
    // plenty of detail for a 125-character description.
    IMAGE_MAX_EDGE: 512,
    IMAGE_QUALITY: 0.72,
    IMAGE_MIN_EDGE: 48, // skip spacers, tracking pixels and icons

    PAGE_TEXT_LIMIT: 6000,
    REQUEST_SPACING_MS: 350, // be a polite client
    MAX_IMAGES_PER_RUN: 25,
    MAX_LINKS_PER_RUN: 25,

    VAGUE_LINK_TEXTS: [
      'click here', 'here', 'read more', 'more', 'this', 'link', 'learn more',
      'details', 'continue', 'more info', 'go', 'see more', 'view', 'open',
      'download', 'info', 'read', 'next', 'click'
    ]
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
