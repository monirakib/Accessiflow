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
      labelControl: '/v1/label-control',
      formBrief: '/v1/form-brief',
      simplify: '/v1/simplify',
      health: '/v1/health'
    },

    STORAGE: {
      token: 'accessiflow_ai_token',
      tokenExpiry: 'accessiflow_ai_token_expiry',
      installId: 'accessiflow_ai_install_id',
      consent: 'accessiflow_ai_consent',
      cache: 'accessiflow_ai_cache',
      budget: 'accessiflow_ai_budget'
    },

    // Remembered answers. A description or a control name is the same on the
    // next visit, so paying for it again is waste, and waiting for it again
    // is worse: a screen reader user hears the repaired page instantly.
    CACHE_MAX_ENTRIES: 2000,
    CACHE_TTL_DAYS: 30,

    // Calls the extension may make on its own, without a button press, per
    // hour. Kept below the proxy's 60 so that a busy afternoon of automatic
    // healing never leaves a user unable to press "Describe this picture".
    AUTO_BUDGET_PER_HOUR: 40,

    // Automatic healing on one page load, at most. Beyond this the page is
    // likely generated markup where AI names would be guesses anyway.
    MAX_CONTROLS_PER_PAGE: 15,

    // A form's summary: from two questions up (a one-box search bar needs
    // none), and how long to wait for Smart help before showing the one made
    // on this computer instead.
    FORM_MIN_FIELDS: 2,
    FORM_AI_WAIT_MS: 2500,
    SIMPLIFY_MAX_PARAGRAPHS: 20,
    SIMPLIFY_BATCH_PARAGRAPHS: 4,
    SIMPLIFY_BATCH_CHARS: 2800,
    SIMPLIFY_MIN_CHARS: 200,

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
