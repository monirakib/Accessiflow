// Stand-ins for the extension APIs hearing.js touches. A file rather than an
// inline script, because the page is served under the extension's own CSP,
// which allows no inline scripts either.
window.chrome = {
  runtime: { lastError: null, getURL: p => '/' + p, sendMessage: (m, cb) => cb && cb({ success: true }) },
  storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } }
};
