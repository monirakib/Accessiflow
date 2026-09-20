/**
 * AccessiFlow AI proxy (Cloudflare Worker)
 * =========================================
 * The Hugging Face token lives ONLY here, as an encrypted Worker secret.
 * The extension never receives it, so it cannot be extracted from the
 * extension bundle, from chrome.storage, or from the network tab.
 *
 * What the extension gets instead is a short-lived, server-signed capability
 * token that authorises three narrow operations:
 *
 *   POST /v1/register        -> issue an install token
 *   POST /v1/describe-image  -> alt text for one image        (WCAG 1.1.1)
 *   POST /v1/summarize       -> plain-language page summary   (WCAG 3.1.5)
 *   POST /v1/label-link      -> accessible name for a link    (WCAG 2.4.4)
 *   GET  /v1/health          -> availability check
 *
 * Deliberately NOT a chat passthrough: prompts are fixed server-side and
 * output is hard-capped, so a stolen install token buys an attacker nothing
 * more than alt text, which is worthless as a free general-purpose LLM.
 */
'use strict';

// ── Tunables (override via wrangler.toml [vars]) ─────────────────────────

const DEFAULTS = {
  // Vision model for alt text. Must be a warm image-text-to-text model.
  // Check availability: hf models ls --warm --pipeline-tag image-text-to-text
  VISION_MODEL: 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
  // Text model for summaries and link labels.
  TEXT_MODEL: 'meta-llama/Llama-3.1-8B-Instruct',

  TOKEN_TTL_SECONDS: 2592000,           // install token lifetime: 30 days
  PER_INSTALL_HOURLY: 60,               // AI calls per install per hour
  PER_IP_REGISTRATIONS_DAILY: 25,       // new installs per IP per day
  GLOBAL_DAILY: 4000,                   // hard ceiling on total AI calls/day

  MAX_IMAGE_BYTES: 1500000,             // ~1.5 MB of base64 image payload
  MAX_TEXT_CHARS: 6000,                 // page text accepted for summaries
  MAX_OUTPUT_TOKENS: 160,               // caps cost AND keeps alt text terse

  UPSTREAM_TIMEOUT_MS: 25000
};

const HF_ROUTER = 'https://router.huggingface.co/v1/chat/completions';

// Fixed, server-side prompts. The client cannot influence these.
const PROMPTS = {
  image:
    'You write alt text for blind and low-vision users, following WCAG 2.2 ' +
    'success criterion 1.1.1. Describe only what is visible and meaningful. ' +
    'Under 125 characters, one sentence, no trailing period. Never begin with ' +
    '"image of", "picture of", "photo of", or "graphic of". Reply with the alt ' +
    'text alone and nothing else.',
  summary:
    'You summarise web pages for screen reader users who have just landed on ' +
    'the page, and for readers who need plain language (WCAG 2.2 criterion ' +
    '3.1.5). Say what the page is for and what is on it, in at most two short ' +
    'sentences. Use common words and the active voice. Reply with the summary ' +
    'alone and nothing else.',
  link:
    'You rewrite vague link text into a descriptive accessible name, following ' +
    'WCAG 2.2 success criterion 2.4.4. Use the surrounding context to say where ' +
    'the link goes. At most 60 characters. Do not include the words "link" or ' +
    '"click". Reply with the replacement name alone and nothing else.'
};

// ── Entry point ─────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const cfg = Object.assign({}, DEFAULTS, overridesFromEnv(env));
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') return preflight(origin, env);

    try {
      const res = await route(url.pathname, request, env, cfg);
      return withCors(res, origin, env);
    } catch (err) {
      // Never leak upstream bodies or stack traces to the client.
      console.error('unhandled', err && err.stack ? err.stack : err);
      return withCors(
        fail(500, 'server_error', 'The AI helper is unavailable right now.'),
        origin,
        env
      );
    }
  }
};

async function route(path, request, env, cfg) {
  if (path === '/v1/health' && request.method === 'GET') {
    return json({
      ok: true,
      features: ['describe-image', 'summarize', 'label-link'],
      configured: Boolean(env.HF_TOKEN && env.TOKEN_SIGNING_KEY)
    });
  }

  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.');

  if (!env.HF_TOKEN || !env.TOKEN_SIGNING_KEY) {
    return fail(503, 'not_configured', 'The AI helper is not set up yet.');
  }

  if (!originAllowed(request, env)) {
    return fail(403, 'origin_rejected', 'This request did not come from AccessiFlow.');
  }

  if (path === '/v1/register') return handleRegister(request, env, cfg);

  const handlers = {
    '/v1/describe-image': handleDescribeImage,
    '/v1/summarize': handleSummarize,
    '/v1/label-link': handleLabelLink
  };
  const op = handlers[path];
  if (!op) return fail(404, 'not_found', 'Unknown endpoint.');

  // Every AI operation is gated on a valid token and the quota ladder.
  const auth = await authenticate(request, env);
  if (!auth.ok) return fail(401, auth.code, auth.message);

  const limited = await enforceQuotas(env, cfg, auth.installId);
  if (limited) return limited;

  const body = await readJson(request, cfg);
  if (!body.ok) return fail(400, body.code, body.message);

  return op(body.value, env, cfg);
}

// ── /v1/register ────────────────────────────────────────────────────────

async function handleRegister(request, env, cfg) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const regs = await bump(env, 'reg:' + dayStamp() + ':' + (await sha256Hex(ip)), 86400);
  if (regs > cfg.PER_IP_REGISTRATIONS_DAILY) {
    return fail(429, 'too_many_installs', 'Too many new installs from this network today.');
  }

  const body = await readJson(request, cfg);
  if (!body.ok) return fail(400, body.code, body.message);

  // The client proposes an id. We only accept an opaque, random-looking one,
  // and we never treat it as a secret. It exists so quotas are per-install.
  const proposed = String(body.value.installId || '');
  const installId = /^[A-Za-z0-9_-]{16,64}$/.test(proposed) ? proposed : randomId();

  const expiresAt = nowSeconds() + cfg.TOKEN_TTL_SECONDS;
  const token = await signToken({ iid: installId, exp: expiresAt }, env.TOKEN_SIGNING_KEY);

  return json({ token, installId, expiresAt });
}

// ── AI operations ───────────────────────────────────────────────────────

async function handleDescribeImage(body, env, cfg) {
  const dataUrl = String(body.image || '');
  const ok = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(dataUrl);
  if (!ok) return fail(400, 'bad_image', 'That image could not be read.');
  if (dataUrl.length > cfg.MAX_IMAGE_BYTES) {
    return fail(413, 'image_too_large', 'That image is too large to describe.');
  }

  const hint = clampText(body.hint, 300);
  const userText = hint
    ? 'Write alt text for this image. Nearby page text, for context only: ' + hint
    : 'Write alt text for this image.';

  const text = await callModel(env, cfg, cfg.VISION_MODEL, PROMPTS.image, [
    { type: 'text', text: userText },
    { type: 'image_url', image_url: { url: dataUrl } }
  ]);

  return text === null
    ? fail(502, 'upstream_failed', 'The AI helper could not describe that image.')
    : json({ text: tidyAltText(text, 125) });
}

async function handleSummarize(body, env, cfg) {
  const text = clampText(body.text, cfg.MAX_TEXT_CHARS);
  if (text.length < 80) {
    return fail(400, 'not_enough_text', 'There is not enough text on this page to summarise.');
  }

  const out = await callModel(env, cfg, cfg.TEXT_MODEL, PROMPTS.summary, [
    { type: 'text', text: 'Summarise this page:\n\n' + text }
  ]);

  return out === null
    ? fail(502, 'upstream_failed', 'The AI helper could not summarise this page.')
    : json({ text: tidyText(out, 400) });
}

async function handleLabelLink(body, env, cfg) {
  const linkText = clampText(body.linkText, 120);
  const context = clampText(body.context, 400);
  if (!linkText) return fail(400, 'bad_link', 'No link text was supplied.');

  const out = await callModel(env, cfg, cfg.TEXT_MODEL, PROMPTS.link, [
    { type: 'text', text: 'Vague link text: "' + linkText + '"\nSurrounding text: "' + context + '"' }
  ]);

  return out === null
    ? fail(502, 'upstream_failed', 'The AI helper could not rewrite that link.')
    : json({ text: tidyText(out, 60) });
}

// ── Hugging Face call ───────────────────────────────────────────────────

async function callModel(env, cfg, model, systemPrompt, userContent) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.UPSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(HF_ROUTER, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': 'Bearer ' + env.HF_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: cfg.MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ]
      })
    });

    if (!res.ok) {
      // Logged for the operator; the client only ever sees a friendly message.
      const detail = (await res.text()).slice(0, 500);
      console.error('hf ' + res.status + ' ' + detail);
      return null;
    }

    const data = await res.json();
    const choice = data && data.choices && data.choices[0];
    const text = choice && choice.message ? choice.message.content : null;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  } catch (err) {
    console.error('hf fetch failed', err && err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Capability tokens (HMAC-SHA256; key never leaves the Worker) ─────────

function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signToken(payload, secret) {
  const body = b64uEncode(JSON.stringify(payload));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'v1.' + body + '.' + b64uFromBytes(new Uint8Array(sig));
}

const RECONNECT = 'Please close and reopen AccessiFlow to reconnect.';

async function authenticate(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const parts = token.split('.');

  if (parts.length !== 3 || parts[0] !== 'v1') {
    return { ok: false, code: 'no_token', message: RECONNECT };
  }

  let valid = false;
  try {
    const key = await hmacKey(env.TOKEN_SIGNING_KEY);
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      b64uToBytes(parts[2]),
      new TextEncoder().encode(parts[1])
    );
  } catch (_) {
    valid = false; // malformed signature
  }
  if (!valid) return { ok: false, code: 'bad_token', message: RECONNECT };

  let payload;
  try {
    payload = JSON.parse(b64uDecode(parts[1]));
  } catch (_) {
    return { ok: false, code: 'bad_token', message: RECONNECT };
  }

  if (!payload.exp || payload.exp < nowSeconds()) {
    return { ok: false, code: 'token_expired', message: RECONNECT };
  }

  // Lets you cut off a single abusive install without redeploying:
  //   wrangler kv key put --binding=RATE_LIMIT "revoked:<installId>" 1
  if (env.RATE_LIMIT && (await env.RATE_LIMIT.get('revoked:' + payload.iid))) {
    return { ok: false, code: 'revoked', message: 'This install can no longer use the AI helper.' };
  }

  return { ok: true, installId: String(payload.iid || 'unknown') };
}

// ── Quotas ──────────────────────────────────────────────────────────────

async function enforceQuotas(env, cfg, installId) {
  const global = await bump(env, 'global:' + dayStamp(), 86400);
  if (global > cfg.GLOBAL_DAILY) {
    return fail(429, 'daily_limit', 'The AI helper is busy today. Please try again tomorrow.', {
      'Retry-After': String(secondsUntilTomorrow())
    });
  }

  const mine = await bump(env, 'use:' + hourStamp() + ':' + installId, 3600);
  if (mine > cfg.PER_INSTALL_HOURLY) {
    return fail(429, 'hourly_limit', 'You have used the AI helper a lot this hour. Please try again soon.', {
      'Retry-After': '900'
    });
  }

  return null;
}

/**
 * Fixed-window counter in Workers KV. KV is eventually consistent, so a
 * determined attacker can overshoot a window slightly; GLOBAL_DAILY is what
 * actually protects the Hugging Face budget. Swap for a Durable Object if you
 * need exact counting (see server/README.md).
 */
async function bump(env, key, ttlSeconds) {
  if (!env.RATE_LIMIT) return 0; // no KV bound (local dev) -> do not block
  const current = parseInt(await env.RATE_LIMIT.get(key), 10) || 0;
  const next = current + 1;
  await env.RATE_LIMIT.put(key, String(next), {
    expirationTtl: Math.max(60, ttlSeconds)
  });
  return next;
}

// ── Request hygiene ─────────────────────────────────────────────────────

function allowedIds(env) {
  return (env.ALLOWED_EXTENSION_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function originAllowed(request, env) {
  const ids = allowedIds(env);
  if (!ids.length) return true; // unset => development mode
  const origin = request.headers.get('Origin') || '';
  return ids.some(id => origin === 'chrome-extension://' + id);
}

async function readJson(request, cfg) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.includes('application/json')) {
    return { ok: false, code: 'bad_request', message: 'Expected JSON.' };
  }
  const raw = await request.text();
  if (raw.length > cfg.MAX_IMAGE_BYTES + 8192) {
    return { ok: false, code: 'too_large', message: 'That request was too large.' };
  }
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, code: 'bad_request', message: 'Expected a JSON object.' };
    }
    return { ok: true, value: value };
  } catch (_) {
    return { ok: false, code: 'bad_request', message: 'That request could not be read.' };
  }
}

function clampText(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

// Models like to add quotes, an "Alt text:" preamble, or a trailing period.
function tidyAltText(text, max) {
  let out = tidyText(text, max);
  out = out.replace(/^(?:alt\s*text|description)\s*[:-]\s*/i, '');
  out = out.replace(
    /^(?:an?\s+)?(?:image|picture|photo|photograph|graphic|screenshot)\s+(?:of|showing|depicting)\s+/i,
    ''
  );
  out = out.replace(/\.$/, '');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function tidyText(text, max) {
  const clean = String(text)
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/^["'“‘]/, '')
    .replace(/["'”’]$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return clean.length <= max ? clean : trimToWord(clean, max);
}

/**
 * Cuts to `max` on a word boundary rather than mid-word.
 *
 * These strings are spoken: AccessiFlow reads a description out loud when a
 * blind user presses a picture. "…fees effective September 1," stops a voice
 * in the middle of a thought, and a shorter whole phrase is worth more than a
 * longer broken one. The dangling comma or dash goes too.
 */
function trimToWord(text, max) {
  let out = text.slice(0, max);
  const lastSpace = out.lastIndexOf(' ');
  // Only back up to the last space when that still leaves most of the text;
  // one very long word should not shrink the whole description to nothing.
  if (lastSpace > max * 0.6) out = out.slice(0, lastSpace);
  return out.replace(/[\s,;:–—-]+$/, '');
}

// ── HTTP helpers ────────────────────────────────────────────────────────

function corsHeaders(origin, env) {
  const ids = allowedIds(env);
  const permit = !ids.length || ids.some(id => origin === 'chrome-extension://' + id);
  return {
    'Access-Control-Allow-Origin': permit && origin ? origin : 'null',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function preflight(origin, env) {
  return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
}

function withCors(res, origin, env) {
  const headers = new Headers(res.headers);
  const cors = corsHeaders(origin, env);
  for (const key of Object.keys(cors)) headers.set(key, cors[key]);
  return new Response(res.body, { status: res.status, headers: headers });
}

function json(obj, status, extra) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  };
  for (const key of Object.keys(extra || {})) headers[key] = extra[key];
  return new Response(JSON.stringify(obj), { status: status || 200, headers: headers });
}

/** `message` is written for a disabled end user, not for a developer. */
function fail(status, code, message, extra) {
  return json({ error: code, message: message }, status, extra);
}

// ── Small utilities ─────────────────────────────────────────────────────

function overridesFromEnv(env) {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (env[key] === undefined) continue;
    if (typeof DEFAULTS[key] === 'number') {
      const n = Number(env[key]);
      if (Number.isFinite(n)) out[key] = n;
    } else {
      out[key] = env[key];
    }
  }
  return out;
}

function nowSeconds() { return Math.floor(Date.now() / 1000); }
function dayStamp() { return new Date().toISOString().slice(0, 10); }
function hourStamp() { return new Date().toISOString().slice(0, 13); }

function secondsUntilTomorrow() {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.floor((midnight - now.getTime()) / 1000));
}

function randomId() {
  return b64uFromBytes(crypto.getRandomValues(new Uint8Array(24)));
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function b64uFromBytes(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uEncode(text) {
  return b64uFromBytes(new TextEncoder().encode(text));
}

function b64uToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function b64uDecode(value) {
  return new TextDecoder().decode(b64uToBytes(value));
}
