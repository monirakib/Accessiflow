// AccessiFlow background service worker (MV3)
// Two jobs: relay messages between popup and content scripts, and act as the
// extension's only AI client.
//
// Why the AI calls live here and not in the content script: a fetch from a
// content script carries the *page's* origin, so the proxy could not tell a
// genuine AccessiFlow request from any website's, and the capability token
// would have to be handed to code running alongside untrusted page script.
// The service worker runs on the extension's own origin, so neither is true.
'use strict';

importScripts('modules/ai-config.js');

const CFG = globalThis.ACCESSIFLOW_AI_CONFIG;

function log(msg) { console.log('[AccessiFlow][BG] ' + msg); }
function warn(msg) { console.warn('[AccessiFlow][BG] ' + msg); }

// ── Storage helpers ───────────────────────────────────────────────────────

function getLocal(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function setLocal(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}

// ── Capability token ──────────────────────────────────────────────────────
// This is not an API key. It is a signed, expiring permission slip for three
// narrow operations. It cannot be used against Hugging Face directly, and it
// cannot be forged, because the signing key never leaves the proxy.

let tokenPromise = null; // collapses concurrent registrations into one call

function randomInstallId() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getToken(forceRefresh) {
  const store = CFG.STORAGE;
  const cached = await getLocal([store.token, store.tokenExpiry, store.installId]);
  const nowSec = Math.floor(Date.now() / 1000);

  // Refresh a day early so a long AI run never dies halfway through.
  const stillFresh = cached[store.token] &&
    cached[store.tokenExpiry] &&
    cached[store.tokenExpiry] - 86400 > nowSec;

  if (stillFresh && !forceRefresh) return cached[store.token];

  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    const installId = cached[store.installId] || randomInstallId();
    const res = await fetch(CFG.PROXY_ORIGIN + CFG.ENDPOINTS.register, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installId: installId })
    });

    if (!res.ok) {
      const body = await safeJson(res);
      throw new ProxyError(body.message || 'Could not connect to the AI helper.', body.error);
    }

    const data = await res.json();
    await setLocal({
      [store.token]: data.token,
      [store.tokenExpiry]: data.expiresAt,
      [store.installId]: data.installId || installId
    });
    log('Registered with AI proxy');
    return data.token;
  })().finally(() => { tokenPromise = null; });

  return tokenPromise;
}

class ProxyError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'unknown';
  }
}

async function safeJson(res) {
  try { return await res.json(); } catch (_) { return {}; }
}

/**
 * Calls one proxy endpoint. Retries exactly once on 401 with a fresh token, so
 * an expired install recovers without the user being told anything.
 */
async function callProxy(endpoint, payload, isRetry) {
  if (!CFG.PROXY_ORIGIN || CFG.PROXY_ORIGIN.includes('example.workers.dev')) {
    throw new ProxyError(
      'The AI helper has not been set up for this build yet.',
      'not_configured'
    );
  }

  const token = await getToken(Boolean(isRetry));

  let res;
  try {
    res = await fetch(CFG.PROXY_ORIGIN + endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(payload)
    });
  } catch (_) {
    throw new ProxyError('You appear to be offline. Please check your connection.', 'offline');
  }

  if (res.status === 401 && !isRetry) return callProxy(endpoint, payload, true);

  if (!res.ok) {
    const body = await safeJson(res);
    throw new ProxyError(body.message || 'The AI helper could not finish that.', body.error);
  }

  const data = await res.json();
  return data.text || '';
}

// ── AI operations exposed to the rest of the extension ────────────────────

const AI_OPERATIONS = {
  aiDescribeImage: msg => callProxy(CFG.ENDPOINTS.describeImage, {
    image: msg.image,
    hint: msg.hint || ''
  }),
  aiSummarizeText: msg => callProxy(CFG.ENDPOINTS.summarize, {
    text: msg.text
  }),
  aiLabelLink: msg => callProxy(CFG.ENDPOINTS.labelLink, {
    linkText: msg.linkText,
    context: msg.context || ''
  })
};

/**
 * Fetches one image and returns it downscaled, as a data URL.
 *
 * Only the service worker can do this: it holds the host permissions, and its
 * fetch is not bound by the page's cross-origin rules. Credentials are left
 * out on purpose, so this can never pull in a signed-in user's private image.
 */
async function fetchImageAsDataUrl(url) {
  if (!/^https?:\/\//i.test(url)) throw new ProxyError('That picture cannot be read.', 'bad_image');

  const res = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
  if (!res.ok) throw new ProxyError('That picture could not be downloaded.', 'bad_image');

  const blob = await res.blob();
  if (!/^image\//.test(blob.type)) throw new ProxyError('That file is not a picture.', 'bad_image');
  if (blob.size > 12000000) throw new ProxyError('That picture is too large.', 'image_too_large');

  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, CFG.IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale))
  );
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: CFG.IMAGE_QUALITY });
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return 'data:image/jpeg;base64,' + btoa(binary);
}

async function checkHealth() {
  if (!CFG.PROXY_ORIGIN || CFG.PROXY_ORIGIN.includes('example.workers.dev')) {
    return { available: false, reason: 'not_configured' };
  }
  try {
    const res = await fetch(CFG.PROXY_ORIGIN + CFG.ENDPOINTS.health);
    if (!res.ok) return { available: false, reason: 'unreachable' };
    const data = await res.json();
    return {
      available: Boolean(data.ok && data.configured),
      reason: data.configured ? 'ok' : 'not_configured'
    };
  } catch (_) {
    return { available: false, reason: 'offline' };
  }
}

// ── Offline speech ────────────────────────────────────────────────────────
// Windows has no Bangla voice unless somebody installs a language pack, so a
// blind Bangla speaker gets silence from every browser on every computer
// until they do. The extension carries its own engine for those languages.
// It runs in an offscreen document because a content script cannot use
// WebAssembly on sites with a strict policy, and audio started by a page
// dies when the page navigates.

let offscreenReady = null;

async function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;

  offscreenReady = (async () => {
    const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (existing && existing.length) return true;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Speaks text aloud in languages this computer has no voice for.'
    });
    return true;
  })().catch(err => {
    // A second call can lose the race to create it; that is not a failure.
    if (/already/i.test(err.message)) return true;
    offscreenReady = null;
    throw err;
  });

  return offscreenReady;
}

async function relayToOffscreen(message) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage(Object.assign({ target: 'offscreen' }, message));
}

// ── Message router ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return;

  // AI operations: always async, always resolve to {success, text|error}.
  const operation = AI_OPERATIONS[message.action];
  if (operation) {
    operation(message)
      .then(text => sendResponse({ success: true, text: text }))
      .catch(err => {
        warn(message.action + ' failed: ' + err.message);
        sendResponse({ success: false, error: err.message, code: err.code || 'unknown' });
      });
    return true;
  }

  if (message.action === 'speakOffline' || message.action === 'stopOffline' ||
      message.action === 'canSpeakOffline' || message.action === 'downloadVoice' ||
      message.action === 'voiceStatus') {
    // Never bounce a message that is already on its way to the offscreen
    // document: that would be a loop.
    if (message.target === 'offscreen') return;
    relayToOffscreen(message)
      .then(reply => sendResponse(reply || { success: true }))
      .catch(err => {
        warn(message.action + ' failed: ' + err.message);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.action === 'aiFetchImage') {
    fetchImageAsDataUrl(message.url)
      .then(image => sendResponse({ success: true, image: image }))
      .catch(err => {
        warn('aiFetchImage failed: ' + err.message);
        sendResponse({ success: false, error: err.message, code: err.code || 'unknown' });
      });
    return true;
  }

  if (message.action === 'aiHealth') {
    checkHealth().then(sendResponse);
    return true;
  }

  try {
    if (message.action === 'relayToContent') {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, message.data, response => {
            void chrome.runtime.lastError; // a closed tab is not an error worth surfacing
            sendResponse(response || { success: true });
          });
        } else {
          sendResponse({ error: 'No active tab found' });
        }
      });
      return true;
    }

    if (message.action === 'relayToPopup') {
      chrome.runtime.sendMessage(message.data, () => { void chrome.runtime.lastError; });
      sendResponse({ success: true });
      return;
    }

    if (message.action === 'getActiveTab') {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        sendResponse(tabs[0] || null);
      });
      return true;
    }
  } catch (e) {
    warn('Error: ' + e.message);
    sendResponse({ error: e.message });
  }
});

// ── Keyboard command: toggle the whole extension ──────────────────────────

chrome.commands.onCommand.addListener(command => {
  if (command !== 'toggle-accessiflow') return;
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0] && tabs[0].id) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleExtension' }, () => {
        void chrome.runtime.lastError;
      });
    }
  });
});

// ── First run ─────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'welcome.html' });
  }
});
