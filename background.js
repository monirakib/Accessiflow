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

importScripts('modules/ai-config.js', 'modules/ai-cache.js');

const CFG = globalThis.ACCESSIFLOW_AI_CONFIG;
const AI_CACHE = globalThis.ACCESSIFLOW_AI_CACHE;

function log(msg) { console.log('[AccessiFlow][BG] ' + msg); }
function warn(msg) { console.warn('[AccessiFlow][BG] ' + msg); }

// ── Storage helpers ───────────────────────────────────────────────────────

function getLocal(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function setLocal(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}

// ── Remembered answers, and the allowance for automatic calls ─────────────

const storageAdapter = {
  get: key => getLocal(key).then(found => found[key]),
  set: (key, value) => setLocal({ [key]: value })
};

const aiCache = new AI_CACHE.AICache(storageAdapter, {
  maxEntries: CFG.CACHE_MAX_ENTRIES,
  ttlDays: CFG.CACHE_TTL_DAYS,
  storageKey: CFG.STORAGE.cache
});

const aiBudget = new AI_CACHE.AIBudget(storageAdapter, {
  perHour: CFG.AUTO_BUDGET_PER_HOUR,
  storageKey: CFG.STORAGE.budget
});

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

  return res.json();
}

// ── AI operations exposed to the rest of the extension ────────────────────

const textOf = data => (data && data.text) || '';

const AI_OPERATIONS = {
  aiDescribeImage: msg => callProxy(CFG.ENDPOINTS.describeImage, {
    image: msg.image,
    hint: msg.hint || ''
  }).then(textOf),
  aiSummarizeText: msg => callProxy(CFG.ENDPOINTS.summarize, {
    text: msg.text
  }).then(textOf),
  aiLabelLink: msg => callProxy(CFG.ENDPOINTS.labelLink, {
    linkText: msg.linkText,
    context: msg.context || ''
  }).then(textOf),
  aiLabelControl: msg => callProxy(CFG.ENDPOINTS.labelControl, {
    kind: msg.kind,
    classList: msg.classList || '',
    context: msg.context || '',
    pageTitle: msg.pageTitle || '',
    formPurpose: msg.formPurpose || ''
  }).then(textOf),
  aiFormBrief: msg => callProxy(CFG.ENDPOINTS.formBrief, {
    fields: msg.fields
  }).then(textOf),
  aiSimplify: msg => callProxy(CFG.ENDPOINTS.simplify, {
    mode: 'plain',
    paragraphs: msg.paragraphs
  }).then(data => ({ text: textOf(data), rewrites: data.rewrites || [] })),
  aiBullets: msg => callProxy(CFG.ENDPOINTS.simplify, {
    mode: 'bullets',
    text: msg.text
  }).then(data => ({ text: textOf(data), bullets: data.bullets || [] }))
};

// Cached answers are stored as strings. Structured replies (the simplifier's
// rewrites, the TL;DR bullets) are tagged so they come back as objects.
function encode(result) {
  return typeof result === 'string' ? (result ? 'S' + result : '') : 'J' + JSON.stringify(result);
}
function decode(stored) {
  if (stored.charAt(0) === 'J') {
    try { return JSON.parse(stored.slice(1)); } catch (e) { return null; }
  }
  return stored.slice(1);
}

/** The site a message came from, taken from Chrome rather than from the message. */
function originOf(sender) {
  try { return new URL((sender && (sender.origin || sender.url)) || '').origin; } catch (e) { return ''; }
}

/**
 * Runs one AI operation, cache first.
 *
 * `msg.cacheKey` is a signature the content script builds (an image address,
 * a control's position and classes). It is combined with the sending site's
 * origin, as Chrome reports it, so one site can never read another's cached
 * answers by guessing a signature.
 *
 * `msg.auto` marks a call nobody pressed a button for. Those need the user's
 * standing consent and come out of the hourly allowance; a call the user
 * asked for directly does neither, because refusing a button press on account
 * of background work would be baffling.
 */
async function runOperation(action, msg, sender) {
  const operation = AI_OPERATIONS[action];
  const key = (typeof msg.cacheKey === 'string' && msg.cacheKey)
    ? AI_CACHE.makeKey(action, originOf(sender), msg.cacheKey)
    : null;

  if (key) {
    const hit = await aiCache.get(key);
    if (hit) {
      const value = decode(hit);
      if (value !== null) return { value: value, cached: true };
    }
  }

  if (msg.auto) {
    const consent = (await getLocal(CFG.STORAGE.consent))[CFG.STORAGE.consent];
    if (consent !== true) {
      throw new ProxyError('Automatic fixes are off until you agree to them in AccessiFlow.', 'no_consent');
    }
    if (!(await aiBudget.take())) {
      throw new ProxyError('AccessiFlow has used its automatic allowance for this hour.', 'budget');
    }
  }

  const value = await operation(msg);
  if (key) {
    const stored = encode(value);
    if (stored) await aiCache.set(key, stored);
  }
  return { value: value, cached: false };
}

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

const OFFSCREEN_FLAG = 'accessiflow_offscreen_version';
const OFFSCREEN_VERSION = 2;

function getSession(key) {
  if (!chrome.storage.session) return Promise.resolve(undefined);
  return new Promise(resolve => chrome.storage.session.get(key, found => resolve(found[key])));
}

function setSession(obj) {
  if (!chrome.storage.session) return Promise.resolve();
  return new Promise(resolve => chrome.storage.session.set(obj, resolve));
}

async function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;

  offscreenReady = (async () => {
    const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (existing && existing.length) {
      // A document made by an earlier version was created for audio playback
      // alone, and Chrome closes those after 30 seconds without sound -- which
      // would end live captions in the first quiet stretch of a video. It is
      // replaced once; the flag lives in session storage because this worker
      // is restarted freely and would forget.
      const made = await getSession(OFFSCREEN_FLAG);
      if (made === OFFSCREEN_VERSION) return true;
      try { await chrome.offscreen.closeDocument(); } catch (e) { /* already gone */ }
    }
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      // Only one offscreen document may exist, so both jobs share it:
      // speaking for languages the computer has no voice for, and capturing a
      // tab's sound for live captions.
      reasons: ['AUDIO_PLAYBACK', 'USER_MEDIA'],
      justification: 'Speaks text aloud in languages this computer has no voice for, ' +
        'and turns a tab\u2019s sound into live captions on this computer.'
    });
    await setSession({ [OFFSCREEN_FLAG]: OFFSCREEN_VERSION });
    return true;
  })().catch(err => {
    // A second call can lose the race to create it; that is not a failure.
    if (/already/i.test(err.message)) return true;
    offscreenReady = null;
    throw err;
  });

  return offscreenReady;
}

/**
 * Speaks with chrome.tts and replies once it has finished, been cut off, or
 * failed, so the page's queue can move on either way. A time limit too,
 * because a worker restarted mid-sentence never hears the end event.
 */
function speakSystem(message) {
  return new Promise(resolve => {
    if (!chrome.tts) { resolve({ success: false, error: 'no tts' }); return; }
    let done = false;
    const finish = reply => { if (!done) { done = true; clearTimeout(guard); resolve(reply); } };
    const text = String(message.text || '');
    const guard = setTimeout(() => finish({ success: true, finished: false }), Math.min(60000, 3000 + text.length * 120));
    try {
      chrome.tts.speak(text, {
        lang: message.lang || undefined,
        rate: Math.max(0.1, Math.min(10, Number(message.rate) || 1)),
        pitch: Math.max(0, Math.min(2, Number(message.pitch) || 1)),
        enqueue: false,
        onEvent: event => {
          if (event.type === 'end') finish({ success: true, finished: true });
          else if (event.type === 'interrupted' || event.type === 'cancelled') finish({ success: true, finished: false });
          else if (event.type === 'error') finish({ success: false, error: event.errorMessage || 'tts error' });
        }
      }, () => {
        if (chrome.runtime.lastError) finish({ success: false, error: chrome.runtime.lastError.message });
      });
    } catch (e) {
      finish({ success: false, error: e.message });
    }
  });
}

async function relayToOffscreen(message) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage(Object.assign({ target: 'offscreen' }, message));
}

// ── Live captions ─────────────────────────────────────────────────────────
//
// Chrome only lets an extension capture a tab the user has just invoked it
// on: by opening the popup, or pressing the captions shortcut. So captions
// can be started from those two places and nowhere else, and the popup says
// so rather than offering a button on the page that could never work.

async function captureStatus() {
  try {
    const reply = await relayToOffscreen({ action: 'captureStatus' });
    return reply || { running: false, tabId: null };
  } catch (e) {
    return { running: false, tabId: null };
  }
}

async function startCaptions(tabId) {
  if (!chrome.tabCapture) {
    return { success: false, error: 'This browser cannot capture tab audio.' };
  }
  // Chrome refuses a second capture of a tab that is already captured.
  const status = await captureStatus();
  if (status.running) await relayToOffscreen({ action: 'stopCapture', reason: 'replaced' });

  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (e) {
    warn('getMediaStreamId: ' + e.message);
    return {
      success: false, code: 'capture_refused',
      error: 'Chrome would not let AccessiFlow listen to this tab. Open AccessiFlow on the tab itself and try again.'
    };
  }
  return relayToOffscreen({ action: 'startCapture', streamId: streamId, tabId: tabId });
}

// ── Tabs, zoom and screenshots, for the hold-click menu and on-screen keyboard ──
//
// A key event a page makes never reaches Chrome's own shortcuts, so Ctrl+T
// pressed on the on-screen keyboard is done here instead. Only ever on the
// tab that asked, or its window: a page cannot reach anybody else's tabs.

// Chrome's own zoom steps, so Zoom in here matches Ctrl+Plus on a keyboard.
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

async function handTab(op, tab) {
  switch (op) {
    case 'nextTab':
    case 'prevTab': {
      const tabs = (await chrome.tabs.query({ windowId: tab.windowId })).sort((a, b) => a.index - b.index);
      if (tabs.length < 2) return { ok: false, message: 'This is the only tab in this window.' };
      const at = tabs.findIndex(t => t.id === tab.id);
      const next = tabs[(at + (op === 'nextTab' ? 1 : -1) + tabs.length) % tabs.length];
      await chrome.tabs.update(next.id, { active: true });
      return { ok: true };
    }
    case 'newTab':
      // Chrome's own new tab page is closed to every extension, so the ring
      // and the on-screen keyboard would vanish there, and with them the only
      // way this user has to type a search. Google's page looks the same and
      // AccessiFlow works on it.
      await chrome.tabs.create({ windowId: tab.windowId, url: 'https://www.google.com/' });
      return { ok: true };
    case 'closeTab':
      await chrome.tabs.remove(tab.id);
      return { ok: true };
    case 'newWindow':
      await chrome.windows.create({});
      return { ok: true };
    case 'history':
    case 'downloads':
      await chrome.tabs.create({ windowId: tab.windowId, index: tab.index + 1, url: 'chrome://' + op + '/' });
      return { ok: true };
    case 'zoomIn':
    case 'zoomOut':
    case 'zoomReset': {
      if (op === 'zoomReset') {
        await chrome.tabs.setZoom(tab.id, 0);   // 0 is the user's default zoom
        return { ok: true, message: 'Normal size.' };
      }
      const now = await chrome.tabs.getZoom(tab.id);
      const next = op === 'zoomIn'
        ? ZOOM_STEPS.find(z => z > now + 0.001) || ZOOM_STEPS[ZOOM_STEPS.length - 1]
        : ZOOM_STEPS.slice().reverse().find(z => z < now - 0.001) || ZOOM_STEPS[0];
      await chrome.tabs.setZoom(tab.id, next);
      return { ok: true, message: 'Zoom ' + Math.round(next * 100) + '%.' };
    }
    case 'screenshot': {
      // What is on screen in this tab, and nothing else. It goes back to the
      // page to be copied to the clipboard, never anywhere further.
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      return { ok: true, image: image };
    }
  }
  return { ok: false, message: 'AccessiFlow does not know how to do that.' };
}

// ── Message router ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return;

  if (message.action === 'handTab') {
    const tab = sender && sender.tab;
    if (!tab || tab.id === undefined) { sendResponse({ ok: false, message: 'Only a page can ask for this.' }); return; }
    handTab(message.op, tab)
      .then(sendResponse)
      .catch(err => {
        warn('handTab ' + message.op + ': ' + err.message);
        sendResponse({ ok: false, message: 'Chrome would not allow that here.' });
      });
    return true;
  }

  // AI operations: always async, always resolve to {success, text|error}.
  if (AI_OPERATIONS[message.action]) {
    runOperation(message.action, message, sender)
      .then(result => {
        const reply = { success: true, cached: result.cached };
        if (typeof result.value === 'string') reply.text = result.value;
        else Object.assign(reply, result.value);
        sendResponse(reply);
      })
      .catch(err => {
        warn(message.action + ' failed: ' + err.message);
        sendResponse({ success: false, error: err.message, code: err.code || 'unknown' });
      });
    return true;
  }

  // ── The screen reader's reach into frames ──
  // Its lines, keys and focus pass between the frames of one tab through here,
  // addressed by frame id, so the page's own scripts never see them.
  if (message.action === 'srWhoAmI') {
    sendResponse({ frameId: sender.frameId });
    return;
  }
  if (message.action === 'srRelay') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId === undefined || typeof message.to !== 'number') { sendResponse(null); return; }
    chrome.tabs.sendMessage(tabId, { action: 'srFrame', from: sender.frameId, msg: message.msg },
      { frameId: message.to }, reply => {
        void chrome.runtime.lastError;
        sendResponse(reply === undefined ? null : reply);
      });
    return true;
  }
  if (message.action === 'srInjectFrames') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId === undefined) { sendResponse({ ok: false }); return; }
    // Every frame at once; the agent only starts in frames from another
    // site, and the top copy of each file is left as it was.
    chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      files: ['modules/naming.js', 'modules/page-actions.js', 'modules/sr-buffer.js',
        'modules/sr-live.js', 'modules/sr-frame.js']
    }).then(() => sendResponse({ ok: true }), err => {
      // Some frames can never be entered (another extension's, the browser's own).
      warn('srInjectFrames: ' + err.message);
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }

  // Speech through the computer's own voices, from here rather than the page.
  // A page may not speak until the user has pressed a key or clicked in it,
  // so a blind user arriving on a new page would hear nothing at all, not
  // even its title, until they happened to press something. chrome.tts has
  // no such rule.
  if (message.action === 'speakSystem') {
    speakSystem(message).then(sendResponse);
    return true;
  }

  // Stopping is sent on every key the screen reader handles. If the offscreen
  // document does not exist, nothing of ours is playing there: say so rather
  // than creating a whole document just to tell it to be quiet.
  if (message.action === 'stopOffline' && message.target !== 'offscreen') {
    try { if (chrome.tts) chrome.tts.stop(); } catch (e) { /* nothing was speaking */ }
    chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
      .then(existing => {
        if (!existing || !existing.length) return { success: true };
        return relayToOffscreen(message);
      })
      .then(reply => sendResponse(reply || { success: true }))
      .catch(() => sendResponse({ success: true }));
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

  // Live captions. Starting needs a user gesture on this tab, which only the
  // popup and the keyboard command carry, so a page cannot start them.
  if (message.action === 'startCaptions') {
    if (sender && sender.tab) {
      sendResponse({ success: false, error: 'Captions can only be started from AccessiFlow itself.' });
      return;
    }
    startCaptions(message.tabId)
      .then(reply => sendResponse(reply || { success: false, error: 'No reply from the caption engine.' }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'stopCaptions') {
    relayToOffscreen({ action: 'stopCapture', reason: 'user' })
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'captionsStatus') {
    captureStatus().then(status => {
      // A page is told only about itself.
      const tabId = sender && sender.tab ? sender.tab.id : message.tabId;
      sendResponse({ success: true, running: !!status.running && status.tabId === tabId, anyTab: !!status.running });
    });
    return true;
  }

  if (message.action === 'captionModelStatus' || message.action === 'downloadCaptionModel') {
    relayToOffscreen({ action: message.action })
      .then(reply => sendResponse(reply || { success: false }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // From the offscreen document, for the page in the captured tab.
  if (message.action === 'captionEvent') {
    if (typeof message.tabId === 'number') {
      chrome.tabs.sendMessage(message.tabId, { action: 'captionEvent', event: message.event },
        () => { void chrome.runtime.lastError; });
    }
    return;
  }

  // Download progress goes straight to the popup; nothing to do here.
  if (message.action === 'captionProgress') return;

  // What the popup shows about automatic fixes: whether the user has agreed,
  // how much of this hour's allowance is left, and how much is remembered.
  if (message.action === 'aiAutoStatus') {
    Promise.all([
      getLocal(CFG.STORAGE.consent),
      aiBudget.remaining(),
      aiCache.size()
    ]).then(([consent, remaining, cached]) => sendResponse({
      success: true,
      consent: consent[CFG.STORAGE.consent] === true,
      remaining: remaining,
      perHour: CFG.AUTO_BUDGET_PER_HOUR,
      cached: cached
    }));
    return true;
  }

  if (message.action === 'aiSetConsent') {
    setLocal({ [CFG.STORAGE.consent]: message.value === true })
      .then(() => sendResponse({ success: true, consent: message.value === true }));
    return true;
  }

  if (message.action === 'aiClearCache') {
    aiCache.clear().then(() => sendResponse({ success: true }));
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

chrome.commands.onCommand.addListener((command, tab) => {
  // Voice control lives in the side panel. Chrome only opens it in direct
  // answer to the user, so it is opened here, synchronously, with the tab the
  // command came with rather than one looked up afterwards.
  if (command === 'open-voice-control') {
    if (chrome.sidePanel && tab && tab.windowId !== undefined) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(e => warn('side panel: ' + e.message));
    }
    return;
  }

  // The captions shortcut carries the user gesture tab capture needs, so it
  // works without opening the popup. It toggles.
  if (command === 'toggle-captions') {
    chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
      const tab = tabs[0];
      if (!tab || !tab.id) return;
      const status = await captureStatus();
      const tell = event => chrome.tabs.sendMessage(tab.id, { action: 'captionEvent', event: event },
        () => { void chrome.runtime.lastError; });
      if (status.running && status.tabId === tab.id) {
        await relayToOffscreen({ action: 'stopCapture', reason: 'user' });
        return;
      }
      const reply = await startCaptions(tab.id);
      if (!reply || !reply.success) {
        tell({ type: 'state', state: 'stopped', reason: (reply && reply.code) || 'failed',
          message: (reply && reply.error) || 'Live captions could not start.' });
      }
    });
    return;
  }

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

// The setup page opens by itself and starts talking, so a blind user who has
// just installed AccessiFlow hears where they are without having to find
// anything first. Someone updating from 2.x, when every setting was kept per
// site, is shown it once, since otherwise they would never learn that a setup
// can now follow them to every website.
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'welcome.html' });
  } else if (details.reason === 'update' && /^2\./.test(details.previousVersion || '')) {
    chrome.tabs.create({ url: 'welcome.html?from=2' });
  }
});
