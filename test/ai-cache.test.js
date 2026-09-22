// The AI cache and the automatic-call budget, then the service worker gate
// that uses them.
//
// The gate is where the privacy promise in the popup is kept or broken:
// nothing leaves the machine without a button press unless the user agreed,
// and even then no more than the hourly allowance. So background.js itself is
// loaded here, into a VM with a stand-in Chrome, rather than a copy of its
// logic being tested.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }

require(path.join(ROOT, 'modules/ai-cache.js'));
const AC = globalThis.ACCESSIFLOW_AI_CACHE;

// A storage adapter over a plain object, like chrome.storage.local.
const memoryStore = () => {
  const data = {};
  return {
    data: data,
    get: key => Promise.resolve(data[key]),
    set: (key, value) => { data[key] = JSON.parse(JSON.stringify(value)); return Promise.resolve(); }
  };
};

(async () => {
  // ── Image address normalisation ────────────────────────────────────────
  check(AC.normalizeSrc('https://cdn.x.com/a.jpg?v=123') === AC.normalizeSrc('https://cdn.x.com/a.jpg?v=456'),
    'a new cache-busting ?v= still matches the remembered description');
  check(AC.normalizeSrc('https://x.com/img.php?id=1') !== AC.normalizeSrc('https://x.com/img.php?id=2'),
    'but ?id= is kept, because it is what picks the picture: one image never inherits another’s description');
  check(AC.normalizeSrc('https://x.com/a.jpg?w=200&h=100') === AC.normalizeSrc('https://x.com/a.jpg?h=100&w=200'),
    'parameter order does not matter');
  check(AC.normalizeSrc('https://x.com/a.jpg#top') === AC.normalizeSrc('https://x.com/a.jpg'),
    'a fragment is ignored');

  // ── Keys ───────────────────────────────────────────────────────────────
  const k1 = AC.makeKey('aiLabelControl', 'https://bank.example', '/pay|div:1>button:2|btn-42|');
  check(k1 === AC.makeKey('aiLabelControl', 'https://bank.example', '/pay|div:1>button:2|btn-42|'),
    'the same control on the same site gives the same key on every visit');
  check(k1 !== AC.makeKey('aiLabelControl', 'https://evil.example', '/pay|div:1>button:2|btn-42|'),
    'the same signature on a different site gives a different key');
  check(k1.indexOf('bank.example') === -1 && k1.indexOf('/pay') === -1,
    'keys are hashed, so the cache is not a readable list of the pages visited: ' + k1);

  // ── The cache ──────────────────────────────────────────────────────────
  {
    let now = 1000000;
    const store = memoryStore();
    const cache = new AC.AICache(store, { maxEntries: 3, ttlDays: 30, storageKey: 'c', now: () => now });

    await cache.set('a', 'Close dialog');
    check((await cache.get('a')) === 'Close dialog', 'an answer is remembered');
    check((await cache.get('missing')) === null, 'a miss is null');

    await cache.set('empty', '');
    check((await cache.get('empty')) === null,
      'an empty answer is not remembered, so an unsure model today does not block a real answer tomorrow');

    // LRU: touch a, add b c d; b should be evicted, a kept.
    now += 10; await cache.set('b', 'B');
    now += 10; await cache.set('c', 'C');
    now += 10; await cache.get('a');
    now += 10; await cache.set('d', 'D');
    check((await cache.get('a')) === 'Close dialog' && (await cache.get('b')) === null,
      'at the size limit the least recently used answer goes, not the oldest written');
    check((await cache.size()) === 3, 'the cache stays at its limit');

    await cache.flush();
    check(store.data.c && typeof store.data.c === 'object', 'the cache is written to storage');
    const reloaded = new AC.AICache(store, { maxEntries: 3, ttlDays: 30, storageKey: 'c', now: () => now });
    check((await reloaded.get('d')) === 'D',
      'and read back by a fresh instance, as after Chrome stops and restarts the service worker');

    now += 31 * 86400000;
    check((await cache.get('a')) === null, 'an answer older than 30 days is dropped');
  }

  // ── The budget ─────────────────────────────────────────────────────────
  {
    let now = 7 * 3600000;
    const store = memoryStore();
    const budget = new AC.AIBudget(store, { perHour: 3, storageKey: 'b', now: () => now });
    const taken = [await budget.take(), await budget.take(), await budget.take(), await budget.take()];
    check(taken.join() === 'true,true,true,false', 'the fourth call in an hour of three is refused');
    check((await budget.remaining()) === 0, 'nothing left');
    now += 3600000;
    check((await budget.take()) === true, 'a new hour brings a new allowance');
    const again = new AC.AIBudget(store, { perHour: 3, storageKey: 'b', now: () => now });
    check((await again.remaining()) === 2,
      'the count survives the service worker restarting, which Chrome does freely');
  }

  // ── The service worker gate, as shipped ────────────────────────────────
  const storage = {};
  let fetches = [];
  let listener = null;
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener: fn => { listener = fn; } },
      onInstalled: { addListener() {} },
      getContexts: async () => [],
      sendMessage() {}
    },
    commands: { onCommand: { addListener() {} } },
    offscreen: { createDocument: async () => {} },
    tabs: { query() {}, sendMessage() {}, create() {} },
    storage: { local: {
      get: (keys, cb) => {
        const out = {};
        [].concat(keys).forEach(k => { if (k in storage) out[k] = storage[k]; });
        cb(out);
      },
      set: (obj, cb) => { Object.assign(storage, JSON.parse(JSON.stringify(obj))); if (cb) cb(); }
    } }
  };

  const sandbox = {
    chrome: chrome,
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, URL, Promise, JSON, Math, Date, Object, Array, String,
    crypto: require('crypto').webcrypto,
    TextEncoder, btoa: s => Buffer.from(s, 'binary').toString('base64'),
    fetch: async (url, init) => {
      fetches.push({ url: url, body: init && init.body ? JSON.parse(init.body) : null });
      if (String(url).indexOf('/v1/register') !== -1) {
        return new Response(JSON.stringify({ token: 't', installId: 'i', expiresAt: 9e9 }), { status: 200 });
      }
      if (String(url).indexOf('/v1/simplify') !== -1) {
        return new Response(JSON.stringify({ text: 'a\n\nb', rewrites: ['a', 'b'] }), { status: 200 });
      }
      return new Response(JSON.stringify({ text: 'Submit claim' }), { status: 200 });
    },
    Response, Headers, Request
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.importScripts = (...files) => files.forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox));
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), sandbox);

  check(typeof listener === 'function', 'the service worker registers its message listener');

  const PAGE = { origin: 'https://claims.example', url: 'https://claims.example/form' };
  const send = (msg, sender) => new Promise(resolve => {
    const keepOpen = listener(msg, sender || PAGE, resolve);
    if (keepOpen !== true) resolve(undefined);
  });
  const aiCalls = () => fetches.filter(f => String(f.url).indexOf('/v1/register') === -1).length;
  const control = { action: 'aiLabelControl', kind: 'button', classList: 'btn-42', cacheKey: '/form|button:1|btn-42|' };

  // Automatic, with no consent: refused, and nothing sent.
  let reply = await send(Object.assign({ auto: true }, control));
  check(reply && reply.success === false && reply.code === 'no_consent',
    'an automatic call without the user’s agreement is refused: ' + (reply && reply.code));
  check(aiCalls() === 0, 'and nothing at all reaches the network');

  // The same thing pressed by hand goes through, and is remembered.
  reply = await send(Object.assign({ auto: false }, control));
  check(reply.success && reply.text === 'Submit claim' && reply.cached === false,
    'a button press works without the automatic agreement');
  check(aiCalls() === 1, 'one call was made');

  await new Promise(r => setTimeout(r, 300));    // let the coalesced cache write land
  reply = await send(Object.assign({ auto: true }, control));
  check(reply.success && reply.cached === true && reply.text === 'Submit claim',
    'a remembered answer is served even to an automatic call, because it sends nothing');
  check(aiCalls() === 1, 'the second visit costs no network call at all');

  // Another site, same signature: no cross-site read.
  reply = await send(Object.assign({ auto: false }, control),
    { origin: 'https://evil.example', url: 'https://evil.example/' });
  check(reply.cached === false, 'another site cannot read this site’s remembered answers by copying the signature');

  // With consent, automatic calls work until the allowance runs out.
  reply = await send({ action: 'aiSetConsent', value: true });
  check(reply.success && reply.consent === true, 'consent can be given');
  const perHour = sandbox.ACCESSIFLOW_AI_CONFIG.AUTO_BUDGET_PER_HOUR;
  let refusedAt = -1;
  for (let i = 0; i < perHour + 2; i++) {
    const r = await send({ action: 'aiLabelControl', kind: 'button', classList: 'x' + i,
      cacheKey: 'unique-' + i, auto: true });
    if (!r.success) { refusedAt = i; check(r.code === 'budget', 'refused for the allowance'); break; }
  }
  check(refusedAt === perHour,
    'automatic calls stop exactly at the hourly allowance of ' + perHour + ' (stopped at ' + refusedAt + ')');

  reply = await send({ action: 'aiLabelControl', kind: 'button', classList: 'manual', cacheKey: 'manual-1', auto: false });
  check(reply.success,
    'a button press still works after the automatic allowance is spent, so background work never blocks the user');

  const status = await send({ action: 'aiAutoStatus' });
  check(status.consent === true && status.remaining === 0 && status.cached > 0,
    'the popup can see the agreement, the allowance left and how much is remembered: ' +
    JSON.stringify({ consent: status.consent, remaining: status.remaining, cached: status.cached }));

  // Structured replies round-trip through the cache.
  const simplifyMsg = { action: 'aiSimplify', paragraphs: ['one', 'two'], cacheKey: 'simplify|one|two' };
  reply = await send(simplifyMsg);
  check(reply.success && reply.rewrites && reply.rewrites.length === 2, 'the simplifier returns its rewrites');
  await new Promise(r => setTimeout(r, 300));
  const before = aiCalls();
  reply = await send(simplifyMsg);
  check(reply.cached && reply.rewrites.join('|') === 'a|b' && aiCalls() === before,
    'and a remembered rewrite comes back as rewrites, not as a string');

  // Withdrawing consent works, and clearing forgets.
  await send({ action: 'aiSetConsent', value: false });
  reply = await send({ action: 'aiLabelControl', kind: 'button', classList: 'y', cacheKey: 'new-after-withdrawal', auto: true });
  check(reply.code === 'no_consent', 'withdrawing consent stops automatic calls again');
  await send({ action: 'aiClearCache' });
  const cleared = await send({ action: 'aiAutoStatus' });
  check(cleared.cached === 0, 'Forget the remembered answers empties the cache');

  finish();
})().catch(err => { errors.push('threw: ' + err.stack); finish(); });

function finish() {
  console.log('\n=== PASS (' + ok.length + ') ===');
  ok.forEach(m => console.log('  + ' + m));
  if (errors.length) {
    console.log('\n=== FAIL (' + errors.length + ') ===');
    errors.forEach(m => console.log('  ! ' + m));
    process.exit(1);
  }
  console.log('\nAll checks passed.');
  process.exit(0);
}
