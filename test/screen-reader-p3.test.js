// The screen reader, part three, under jsdom: frames (from the same site, and
// from another site through an agent), keeping up with busy pages without
// rebuilding, pictures with no description, and the stand-in names the
// repairs leave behind.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const ok = [];
function check(cond, msg) { (cond ? ok : errors).push(msg); }
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const tick = ms => new Promise(r => setTimeout(r, ms || 0));

function codeFor(key) {
  if (/^[a-z]$/i.test(key)) return 'Key' + key.toUpperCase();
  if (/^[0-9]$/.test(key)) return 'Digit' + key;
  return key;
}
function presser(win) {
  const doc = win.document;
  const deepActive = () => {
    let a = doc.activeElement;
    for (let i = 0; a && i < 10; i++) {
      if (a.shadowRoot && a.shadowRoot.activeElement) { a = a.shadowRoot.activeElement; continue; }
      if (a.tagName === 'IFRAME' && a.contentDocument && a.contentDocument.activeElement &&
          a.contentDocument.activeElement !== a.contentDocument.body) { a = a.contentDocument.activeElement; continue; }
      break;
    }
    return a;
  };
  const press = (key, opts, target) => {
    opts = opts || {};
    const t = target || deepActive() || doc.body;
    const W = t.ownerDocument.defaultView;
    const e = new W.KeyboardEvent('keydown', Object.assign({
      key: opts.shiftKey && key.length === 1 ? key.toUpperCase() : key,
      code: codeFor(key), bubbles: true, cancelable: true, composed: true
    }, opts));
    t.dispatchEvent(e);
    return e;
  };
  const withInsert = (key, opts, target) => {
    press('Insert', {}, target);
    const e = press(key, opts, target);
    const t = target || doc.body;
    t.dispatchEvent(new (t.ownerDocument.defaultView).KeyboardEvent('keyup', { key: 'Insert', code: 'Insert', bubbles: true }));
    return e;
  };
  return { press, withInsert };
}

function setup(html, url, files) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: url || 'https://shop.example/', pretendToBeVisual: true });
  const win = dom.window;
  win.console.log = () => {};
  win.console.warn = () => {};
  win.Element.prototype.scrollIntoView = function () {};
  win.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  win.scrollBy = () => {};
  (files || []).forEach(f => win.eval(read(f)));
  return win;
}

const READER = ['modules/color.js', 'modules/overlay.js', 'modules/naming.js', 'modules/page-actions.js',
  'modules/keyboard-nav.js', 'modules/sr-buffer.js', 'modules/sr-speech.js', 'modules/sr-live.js',
  'modules/sr-table.js', 'modules/sr-dialogs.js', 'modules/sr-frame.js', 'modules/screen-reader.js'];

function voice() {
  const spoken = [];
  return {
    spoken,
    last: () => spoken[spoken.length - 1],
    backend: { speak(t) { spoken.push(t); return new Promise(r => setTimeout(() => r(true), 2)); }, stop() {} }
  };
}

(async () => {
  // ── Stand-ins and pictures ────────────────────────────────────────────────
  {
    const win = setup(`<!DOCTYPE html><html><head><title>Photos</title></head><body>
      <h1>Holiday</h1>
      <img id="beach" src="beach.jpg" alt="[Image - description unavailable]" data-accessiflow-alt-repaired="placeholder">
      <a id="icon" href="/cart" aria-label="Link (no description available)" data-accessiflow-link-repaired="placeholder"><img src="cart.png" alt="[Image - description unavailable]" data-accessiflow-alt-repaired="placeholder"></a>
      <img id="sea" src="sea.jpg" alt="[Image - description unavailable]" data-accessiflow-alt-repaired="placeholder">
      <img id="dog" src="dog.jpg" alt="A dog on the sand">
    </body></html>`, 'https://photos.example/', READER);
    const doc = win.document;
    const N = win.AccessiFlowNaming;
    check(N.accessibleName(doc.getElementById('beach')) === '', 'a stand-in alt text is not a name');
    check(N.describeElement(doc.getElementById('beach')) === 'unlabelled graphic',
      'hover and focus reading call it an unlabelled graphic, not "[Image - description unavailable]": ' +
      N.describeElement(doc.getElementById('beach')));
    check(N.describeElement(doc.getElementById('icon')) === 'unlabelled link',
      'a link with only a stand-in label is an unlabelled link: ' + N.describeElement(doc.getElementById('icon')));

    const logo = doc.createElement('a');
    logo.href = '/';
    logo.innerHTML = '<img src="w.svg" alt=""><span><img src="wordmark.svg" alt="Wikipedia"></span>';
    doc.body.appendChild(logo);
    check(N.describeElement(logo) === 'Wikipedia, link',
      'a logo link is named by its first picture that has a description, not a decorative one: ' + N.describeElement(logo));
    logo.remove();
    const menu = doc.createElement('input');
    menu.type = 'checkbox';
    menu.setAttribute('role', 'button');
    menu.setAttribute('aria-label', 'Main menu');
    doc.body.appendChild(menu);
    check(N.describeElement(menu) === 'Main menu, button',
      'a check box given the role of a button is not called checked or not: ' + N.describeElement(menu));
    menu.remove();

    const v = voice();
    const described = [];
    const reader = new win.AccessiFlowScreenReader();
    reader.enable(v.backend, {
      describe: (img, waiting) => {
        described.push(img.id || img.getAttribute('src'));
        waiting();
        return new Promise(r => setTimeout(() => r({ text: 'Waves on a sandy beach at sunset' }), 20));
      }
    });
    const { press, withInsert } = presser(win);
    press('g');
    check(v.last() === 'unlabelled graphic. Insert D describes it', 'the first picture with no description says how to hear one: ' + v.last());
    withInsert('d');
    check(v.last() === 'Describing this picture. One moment.', 'Insert+D says it is working');
    await tick(40);
    check(described[0] === 'beach' && v.last() === 'Waves on a sandy beach at sunset, graphic',
      'then reads the description of the picture under the cursor: ' + v.last());
    press('k');
    check(v.last() === 'unlabelled link', 'K reaches the icon link, unlabelled: ' + v.last());
    withInsert('d');
    await tick(40);
    check(described[1] === 'cart.png', 'Insert+D on a link that is only a picture describes that picture');
    press('g');
    check(v.last() === 'unlabelled graphic', 'the hint is given once per page, not on every picture: ' + v.last());
    press('g');
    check(v.last() === 'A dog on the sand, graphic', 'a picture the page described reads its description: ' + v.last());
    withInsert('d');
    await tick(40);
    check(described.length === 3, 'a picture the page described is still passed to the describer, which uses the page\'s own words first');
    reader.disable();
  }

  // ── Busy pages: patched, not rebuilt ──────────────────────────────────────
  {
    const win = setup(`<!DOCTYPE html><html><head><title>Live</title></head><body>
      <h1>Match</h1>
      <p>Score: <span id="score">0 - 0</span></p>
      <p id="clock">12:00:00</p>
      <div id="spinner" style="transform: rotate(0deg)">Loading</div>
      <div id="panel">Details</div>
    </body></html>`, 'https://live.example/', READER);
    const doc = win.document;
    const Buf = win.AccessiFlowSRBuffer;
    let builds = 0;
    const realBuild = Buf.build;
    Buf.build = function () { builds++; return realBuild.apply(this, arguments); };
    const v = voice();
    const reader = new win.AccessiFlowScreenReader();
    reader.enable(v.backend, {});
    const { press, withInsert } = presser(win);
    await tick(10);
    const start = builds;

    for (let i = 1; i <= 20; i++) doc.getElementById('clock').textContent = '12:00:' + String(i).padStart(2, '0');
    doc.getElementById('score').firstChild.data = '1 - 0';
    for (let i = 0; i < 20; i++) doc.getElementById('spinner').style.transform = 'rotate(' + (i * 18) + 'deg)';
    await tick(10);
    press('ArrowDown'); press('ArrowDown');
    await tick(500);
    check(builds === start, 'a ticking clock, a changing score and an animation cause no rebuild at all: ' + (builds - start));
    check(v.last() === '12:00:20', 'and the clock line reads its current time: ' + v.last());
    press('ArrowUp');
    check(v.last() === 'Score: 1 - 0', 'the score line was updated in place: ' + v.last());

    doc.getElementById('spinner').style.display = 'none';
    await tick(300);
    press('ArrowDown');
    check(builds === start + 1, 'an animation that hides the element does rebuild: ' + (builds - start));
    press('ArrowDown');
    check(v.last() === 'Details', 'and the hidden line is gone: ' + v.last());

    const before = builds;
    doc.getElementById('panel').className = 'open';
    await tick(300);
    press('ArrowUp');
    check(builds === before + 1, 'a class change rebuilds, since a class can show or hide anything');

    const b2 = builds;
    doc.getElementById('clock').textContent = 'The match has been postponed because of heavy rain. '.repeat(6);
    await tick(300);
    press('ArrowUp');
    check(builds === b2 + 1, 'text that grows too long for one line rebuilds, so it is cut into lines');
    reader.disable();
    Buf.build = realBuild;
  }

  // ── A frame from the same site ────────────────────────────────────────────
  {
    const win = setup(`<!DOCTYPE html><html><head><title>Docs</title></head><body>
      <h1>Editor</h1>
      <iframe id="ed" title="Comment box"></iframe>
      <p id="after">After the frame</p>
    </body></html>`, 'https://docs.example/', READER);
    const doc = win.document;
    const inner = doc.getElementById('ed').contentDocument;
    inner.body.innerHTML = '<h2>Your comment</h2><label for="c">Comment</label><textarea id="c"></textarea><p>Be kind.</p>';
    const v = voice();
    const reader = new win.AccessiFlowScreenReader();
    reader.enable(v.backend, {});
    const { press } = presser(win);
    press('h');
    check(v.last() === 'frame, Comment box, heading level 2, Your comment',
      'a same-site frame is read as part of the page, and named on the way in: ' + v.last());
    press('ArrowDown'); press('ArrowDown');
    check(v.last() === 'Comment, edit, blank', 'its fields are there too: ' + v.last());
    press('ArrowDown'); press('ArrowDown');
    check(v.last() === 'out of frame, After the frame', 'and leaving it says so: ' + v.last());

    press('e', { shiftKey: true });
    press('Enter');
    check(inner.activeElement === inner.getElementById('c') && reader.mode === 'focus',
      'Enter puts the keyboard in the frame\'s text box, in focus mode');
    const typed = press('h', {}, inner.getElementById('c'));
    check(!typed.defaultPrevented, 'letters typed inside the frame reach the text box');
    press('Escape', {}, inner.getElementById('c'));
    check(reader.mode === 'browse', 'Escape pressed inside the frame goes back to browse mode');
    const arrow = press('ArrowDown', {}, inner.getElementById('c'));
    check(arrow.defaultPrevented && v.last() === 'Be kind.', 'and the reader\'s keys work while focus is still inside the frame: ' + v.last());

    inner.body.insertAdjacentHTML('beforeend', '<p role="status" id="st"></p>');
    await tick(10);
    inner.getElementById('st').textContent = 'Comment saved';
    await tick(20);
    check(v.spoken.indexOf('Comment saved') > -1, 'a status message inside the frame is read out');
    reader.disable();
    const after = press('ArrowDown', {}, inner.body);
    check(!after.defaultPrevented, 'switched off, it stops listening inside the frame too');
  }

  // ── A frame from another site, through an agent ───────────────────────────
  {
    const top = setup(`<!DOCTYPE html><html><head><title>Checkout</title></head><body>
      <h1>Checkout</h1>
      <p>Your basket: 2 items.</p>
      <iframe id="pay" title="Payment"></iframe>
      <p>Thank you for shopping.</p>
    </body></html>`, 'https://shop.example/', READER);
    const frameEl = top.document.getElementById('pay');
    const frameWin = frameEl.contentWindow;
    // Another site: the page cannot see in.
    Object.defineProperty(frameEl, 'contentDocument', { get: () => null });

    const child = new JSDOM(`<!DOCTYPE html><html><body>
      <h2>Card details</h2>
      <label for="card">Card number</label><input id="card">
      <button id="payb" type="button">Pay now</button>
      <p>Secure payment</p>
    </body></html>`, { runScripts: 'outside-only', url: 'https://pay.example/', pretendToBeVisual: true }).window;
    child.console.log = () => {};
    child.console.warn = () => {};
    child.Element.prototype.scrollIntoView = function () {};
    child.matchMedia = top.matchMedia;
    const cdoc = child.document;
    let paid = 0;
    cdoc.getElementById('payb').addEventListener('click', () => paid++);

    // The service worker: frame ids, and messages between frames.
    const listeners = { 0: [], 7: [] };
    const reader = new top.AccessiFlowScreenReader();
    let injected = 0;
    function route(from, msg, cb) {
      setTimeout(() => {
        if (msg.action === 'srWhoAmI') return cb && cb({ frameId: from });
        if (msg.action === 'srInjectFrames') {
          injected++;
          if (injected === 1) {
            ['modules/naming.js', 'modules/page-actions.js', 'modules/sr-buffer.js', 'modules/sr-live.js',
              'modules/sr-frame.js'].forEach(f => child.eval(read(f)));
            // jsdom has no real frame tree, so the agent is started by hand,
            // with the shop page as the window its hello goes to.
            const agent = new child.AccessiFlowSRFrames.Agent({ parent: () => ({
              postMessage: data => top.dispatchEvent(new top.MessageEvent('message', { data: data, source: frameWin }))
            }) });
            child.__accessiflowSrAgent = agent;
            agent.start();
          }
          return cb && cb({ ok: true });
        }
        if (msg.action === 'srRelay') {
          const message = { action: 'srFrame', from: from, msg: msg.msg };
          if (msg.to === 0) return cb && cb(reader.onFrameMessage(from, msg.msg));
          const fns = listeners[msg.to] || [];
          if (!fns.length) return cb && cb(null);
          let answered = false;
          const respond = r => { if (!answered) { answered = true; if (cb) cb(r); } };
          fns.forEach(fn => { if (fn(message, {}, respond) !== true) { /* answered synchronously */ } });
          return;
        }
        if (cb) cb(null);
      }, 0);
    }
    const chromeFor = id => ({
      runtime: {
        id: 'accessiflow', lastError: null,
        onMessage: { addListener: fn => listeners[id].push(fn) },
        sendMessage: (msg, cb) => route(id, msg, cb)
      }
    });
    top.chrome = chromeFor(0);
    child.chrome = chromeFor(7);

    const v = voice();
    reader.enable(v.backend, {});
    const { press, withInsert } = presser(top);
    const cpress = presser(child).press;
    check(v.spoken[0] && /Checkout/.test(v.spoken[0]), 'the page is read before the frame\'s lines arrive');
    await tick(600);
    check(injected >= 1, 'a frame from another site makes the reader ask for agents in the frames');

    press('h');
    check(v.last() === 'frame, Payment, heading level 2, Card details',
      'the frame\'s heading is found by H, named as being in the frame: ' + v.last());
    press('ArrowDown');
    press('ArrowDown');
    check(v.last() === 'Card number, edit, blank', 'its lines read as if they were the page\'s: ' + v.last());

    press('Enter');
    await tick(30);
    check(cdoc.activeElement === cdoc.getElementById('card'), 'Enter on the card box puts focus in it, inside the other site\'s frame');
    check(reader.mode === 'focus' && v.last() === 'Card number, edit, blank',
      'the frame reports the focus, and the reader switches to focus mode and says where: ' + v.last());
    await tick(20);
    const typed = cpress('4', {}, cdoc.getElementById('card'));
    check(!typed.defaultPrevented, 'digits typed in the frame go into the card box');

    cpress('Escape', {}, cdoc.getElementById('card'));
    await tick(30);
    check(reader.mode === 'browse', 'Escape inside the frame is forwarded: browse mode');
    await tick(20);
    const down = cpress('ArrowDown', {}, cdoc.getElementById('card'));
    await tick(30);
    check(down.defaultPrevented, 'in browse mode the frame keeps the reader\'s keys from its page');
    check(v.last() === 'Pay now, button', 'and they move the reader\'s cursor: ' + v.last());
    cpress('Enter', {}, cdoc.getElementById('card'));
    await tick(40);
    check(paid === 1, 'Enter presses the frame\'s button, where it lives');

    cdoc.body.insertAdjacentHTML('beforeend', '<p role="alert">Card declined</p>');
    await tick(40);
    check(v.spoken.indexOf('Card declined') > -1, 'an alert inside the frame is read out at once');
    await tick(800);
    withInsert('f', { ctrlKey: true });
    const box = top.document.getElementById('accessiflow-sr-find');
    box.shadowRoot.querySelector('input').value = 'declined';
    press('Enter', {}, box.shadowRoot.querySelector('input'));
    check(/Card declined/.test(v.last()), 'the frame\'s new lines reach the page, so Find finds them: ' + v.last());

    withInsert('F7');
    const list = top.document.getElementById('accessiflow-sr-elements').shadowRoot;
    check(Array.from(list.querySelectorAll('li[role="option"]')).some(li => /Card details/.test(li.textContent)),
      'the elements list includes the frame\'s headings');
    press('Escape');

    // A page trying to point the frame at itself, or to read it, gets nothing.
    top.dispatchEvent(new top.MessageEvent('message', { data: { __accessiflowSr: 'hello', frameId: 7, nonce: 'guess' }, source: top }));
    let refused = null;
    route(0, { action: 'srRelay', to: 7, msg: { type: 'snapshot', nonce: 'guess' } }, r => { refused = r; });
    await tick(20);
    check(refused && refused.error && !refused.lines, 'a snapshot asked for with the wrong nonce is refused');

    let shortcut = null;
    top.document.addEventListener('keydown', e => { if (e.altKey && e.shiftKey) shortcut = e.code; });
    cpress('z', { altKey: true, shiftKey: true }, cdoc.body);
    await tick(30);
    check(shortcut === 'KeyZ', 'AccessiFlow shortcuts pressed inside the frame reach the page, where they are handled');

    reader.disable();
    await tick(30);
    const after = cpress('ArrowDown', {}, cdoc.body);
    check(!after.defaultPrevented, 'switched off, the frame gives its keys back to its page');
  }

  console.log('=== ' + (errors.length ? 'FAIL' : 'PASS') + ' (' + ok.length + ') ===');
  ok.forEach(m => console.log('  + ' + m));
  errors.forEach(m => console.log('  - ' + m));
  console.log(errors.length ? '\n' + errors.length + ' check(s) failed.' : '\nAll checks passed.');
  process.exit(errors.length ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
