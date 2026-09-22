// AccessiFlow screen reader: the virtual buffer
//
// A screen reader does not read the screen. It reads the page as one long
// document, a line at a time, with a cursor of its own that is separate from
// keyboard focus. That document is this: every piece of visible text, every
// control and every picture, in reading order, flattened into a list.
//
// Each entry is one "line" to the user. Text runs until a block ends; links,
// buttons, fields and pictures are lines of their own, so that one press of
// the down arrow reaches each of them. Headings, links, landmarks, lists and
// tables are remembered as context on the lines inside them, which is what
// lets H jump to the next heading and lets the reader say "list, 4 items" on
// the way in.
//
// Built from the DOM, not from Chrome's accessibility tree: an extension can
// only reach that tree through the debugger, which puts a warning banner on
// every tab. The names come from naming.js, so they match everything else
// AccessiFlow says.
//
// Frames are part of the document, as they are in NVDA. A frame from the same
// site is read directly. One from another site (a payment form, a video, a
// map) cannot be, so its lines are supplied from outside: an agent inside that
// frame builds its own buffer and sends it up (sr-frame.js), and those lines
// are slotted in where the frame is.
'use strict';

(function (root) {
  const Naming = () => root.AccessiFlowNaming;

  // Long paragraphs are cut at sentence ends, so the down arrow moves through
  // them in pieces a listener can hold in mind, not a whole article at once.
  const MAX_LINE = 220;

  const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, META: 1, LINK: 1, TITLE: 1 };

  const BLOCK_TAGS = {
    ADDRESS: 1, ARTICLE: 1, ASIDE: 1, BLOCKQUOTE: 1, BODY: 1, CAPTION: 1, DD: 1, DETAILS: 1,
    DIALOG: 1, DIV: 1, DL: 1, DT: 1, FIELDSET: 1, FIGCAPTION: 1, FIGURE: 1, FOOTER: 1, FORM: 1,
    H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, HEADER: 1, HR: 1, LEGEND: 1, LI: 1, MAIN: 1,
    NAV: 1, OL: 1, P: 1, PRE: 1, SECTION: 1, SUMMARY: 1, TABLE: 1, TBODY: 1, THEAD: 1,
    TFOOT: 1, TR: 1, TD: 1, TH: 1, UL: 1
  };

  // Our own furniture: the reader must not read itself, or the announcer
  // regions that exist for other screen readers. Only these. Other things
  // AccessiFlow adds, like the skip link, are there for the user to reach.
  const OWN_ID = /^accessiflow-(announcer|shortcut-announce|kbnav-|sr-)/;

  // Roles that are one control: read as a single line, never descended into.
  const WIDGET_ROLES = {
    button: 'button', checkbox: 'checkbox', radio: 'radio', switch: 'checkbox',
    textbox: 'edit', searchbox: 'edit', combobox: 'combo', listbox: 'combo',
    slider: 'slider', spinbutton: 'edit', tab: 'tab', menuitem: 'menuitem',
    menuitemcheckbox: 'checkbox', menuitemradio: 'radio', option: 'option',
    treeitem: 'treeitem', img: 'graphic', image: 'graphic', progressbar: 'progress',
    separator: 'separator', meter: 'progress'
  };

  const LANDMARK_ROLES = {
    navigation: 'navigation', main: 'main', banner: 'banner', contentinfo: 'footer',
    complementary: 'complementary', search: 'search', region: 'region', form: 'form'
  };

  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

  /** Out of a same-site frame's document, to the frame element holding it. */
  function frameOf(n) {
    if (!n || n.nodeType !== 9) return null;
    try { return (n.defaultView && n.defaultView.frameElement) || null; } catch (e) { return null; }
  }

  function styleOf(el) {
    // Asked of the element's own window: a frame's styles live in the frame.
    try {
      const win = (el.ownerDocument && el.ownerDocument.defaultView) || root;
      return win.getComputedStyle(el);
    } catch (e) { return null; }
  }

  /** A frame's document, if it is from the same site; null otherwise. */
  function frameDocument(el) {
    try {
      const doc = el.contentDocument;
      return doc && doc.body ? doc : null;
    } catch (e) { return null; }
  }

  function frameName(el) {
    return clean(el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('name'));
  }

  function isHidden(el, style) {
    if (el.hidden) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.hasAttribute('inert')) return true;
    if (!style) return false;
    if (style.display === 'none') return true;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return true;
    if (style.contentVisibility === 'hidden') return true;
    return false;
  }

  function isBlock(el, style) {
    if (BLOCK_TAGS[el.tagName]) return true;
    const d = style && style.display;
    return !!d && !/^(inline|contents)/.test(d);
  }

  function explicitRole(el) {
    return clean(el.getAttribute('role')).split(' ')[0].toLowerCase();
  }

  /** What kind of one-line control this element is, or '' if it is not one. */
  function widgetKind(el) {
    const role = explicitRole(el);
    if (role === 'presentation' || role === 'none') return '';
    if (WIDGET_ROLES[role]) return WIDGET_ROLES[role];
    if (el.isContentEditable && !(el.parentElement && el.parentElement.isContentEditable)) return 'edit';

    const tag = el.tagName;
    if (tag === 'BUTTON') return 'button';
    if (tag === 'SELECT') return 'combo';
    if (tag === 'TEXTAREA') return 'edit';
    if (tag === 'IFRAME') return 'frame';
    if (tag === 'HR') return 'separator';
    if (tag === 'PROGRESS' || tag === 'METER') return 'progress';
    if (tag === 'VIDEO' || tag === 'AUDIO') return 'media';
    if (tag === 'IMG') return 'graphic';
    if (tag === 'svg' || tag === 'SVG') return 'graphic';
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'hidden') return '';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (['submit', 'button', 'reset', 'image'].indexOf(type) !== -1) return 'button';
      if (type === 'file' || type === 'color') return 'button';
      return 'edit';
    }
    return '';
  }

  function headingLevel(el) {
    if (/^H[1-6]$/.test(el.tagName) && explicitRole(el) !== 'presentation') return Number(el.tagName[1]);
    if (explicitRole(el) === 'heading') return Number(el.getAttribute('aria-level')) || 2;
    return 0;
  }

  function isLinkEl(el) {
    return (el.tagName === 'A' && el.hasAttribute('href') && !explicitRole(el)) || explicitRole(el) === 'link';
  }

  function labelled(el) {
    return !!(clean(el.getAttribute('aria-label')) || clean(el.getAttribute('aria-labelledby')));
  }

  /** A container the reader announces and can jump by: landmark, list, table. */
  function containerOf(el) {
    const role = explicitRole(el);
    const tag = el.tagName;
    if (role === 'presentation' || role === 'none') return null;
    const name = () => {
      const N = Naming();
      return N ? clean(el.getAttribute('aria-label')) || N.accessibleName(el).slice(0, 60) : '';
    };

    let landmark = LANDMARK_ROLES[role] || '';
    if (!landmark && !role) {
      if (tag === 'NAV') landmark = 'navigation';
      else if (tag === 'MAIN') landmark = 'main';
      else if (tag === 'ASIDE') landmark = 'complementary';
      else if ((tag === 'HEADER' || tag === 'FOOTER') &&
               !(el.parentElement && el.parentElement.closest('article, aside, main, nav, section'))) {
        landmark = tag === 'HEADER' ? 'banner' : 'footer';
      } else if ((tag === 'SECTION' || tag === 'FORM') && labelled(el)) {
        landmark = tag === 'SECTION' ? 'region' : 'form';
      }
    }
    // A region or form is only a landmark when it has a name; unnamed ones are
    // everywhere and would make D useless.
    if ((landmark === 'region' || landmark === 'form') && !labelled(el)) landmark = '';
    if (landmark) {
      return { kind: 'landmark', el: el, role: landmark,
               name: labelled(el) ? name() : '', start: -1 };
    }

    if (tag === 'UL' || tag === 'OL' || role === 'list' || (tag === 'DL' && !role)) {
      const items = Array.prototype.filter.call(el.children,
        c => c.tagName === 'LI' || c.tagName === 'DT' || explicitRole(c) === 'listitem').length;
      return { kind: 'list', el: el, role: 'list', count: items, start: -1 };
    }
    if (tag === 'LI' || role === 'listitem') return { kind: 'listitem', el: el, role: 'list item', start: -1 };
    if ((tag === 'TABLE' && !role) || role === 'table' || role === 'grid' || role === 'treegrid') {
      const rows = el.rows ? el.rows.length : el.querySelectorAll('[role="row"]').length;
      let cols = 0;
      if (el.rows && el.rows.length) {
        Array.prototype.forEach.call(el.rows, r => { cols = Math.max(cols, r.cells.length); });
      }
      return { kind: 'table', el: el, role: 'table', rows: rows, cols: cols, start: -1 };
    }
    if (tag === 'BLOCKQUOTE' || role === 'blockquote') return { kind: 'blockquote', el: el, role: 'block quote', start: -1 };
    if (role === 'dialog' || role === 'alertdialog' || (tag === 'DIALOG' && el.open)) {
      return { kind: 'dialog', el: el, role: 'dialogue', name: labelled(el) ? name() : '', start: -1 };
    }
    return null;
  }

  /** Collapses whitespace in one text node, remembering where each character came from. */
  function collapse(raw) {
    let text = '';
    const map = [];
    let space = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (/\s/.test(ch)) {
        if (!space) { text += ' '; map.push(i); }
        space = true;
      } else {
        text += ch;
        map.push(i);
        space = false;
      }
    }
    return { text: text, map: map };
  }

  /** Where to cut a long run: at sentence ends, and failing that at spaces. */
  function cuts(text) {
    const out = [];
    let start = 0;
    while (text.length - start > MAX_LINE) {
      const window = text.slice(start, start + MAX_LINE);
      let at = -1;
      const re = /[.!?।]["')\]]?\s/g;
      let m;
      while ((m = re.exec(window))) if (m.index > MAX_LINE / 3) at = m.index + m[0].length;
      if (at === -1) at = window.lastIndexOf(' ') + 1;
      if (at <= 0) at = MAX_LINE;
      out.push([start, start + at]);
      start += at;
    }
    out.push([start, text.length]);
    return out;
  }

  /**
   * Adds one text node to a run of text, collapsing whitespace across the
   * join, and remembering where each character came from.
   */
  function appendRun(acc, node) {
    const c = collapse(node.data);
    if (!c.text || (c.text === ' ' && !acc)) return acc;
    if (!acc) acc = { text: '', segs: [] };
    let text = c.text;
    let map = c.map;
    if (acc.text.endsWith(' ') && text[0] === ' ') { text = text.slice(1); map = map.slice(1); }
    if (!text) return acc;
    acc.segs.push({ node: node, start: acc.text.length, map: map });
    acc.text += text;
    return acc;
  }

  // Start and end, in the page's own text nodes, of characters a..b of a run.
  function rangeFor(segs, a, b) {
    const at = (pos, end) => {
      let seg = segs[0];
      for (let i = 0; i < segs.length; i++) if (segs[i].start <= pos) seg = segs[i];
      const local = Math.min(pos - seg.start, seg.map.length - 1);
      const offset = local < 0 ? 0 : seg.map[local] + (end ? 1 : 0);
      return { node: seg.node, offset: offset };
    };
    const s = at(a, false);
    const e = at(b - 1, true);
    return { startNode: s.node, startOffset: s.offset, endNode: e.node, endOffset: e.offset };
  }

  function trimmed(text, a, b) {
    while (a < b && text[a] === ' ') a++;
    while (b > a && text[b - 1] === ' ') b--;
    return [a, b];
  }

  // ── Building ──────────────────────────────────────────────────────────────

  /**
   * @param doc      the document to read
   * @param options  remote(frameEl) → lines, for frames from another site,
   *                 or null if not known yet; onRemoteFrame(frameEl), told of
   *                 each such frame whose lines are not known yet
   */
  function build(doc, options) {
    doc = doc || root.document;
    options = options || {};
    const items = [];
    const frames = [];                // same-site frames read directly
    const remoteObjects = new Map();  // ids in a frame's lines → one shared object each
    const containers = [];
    const firstIndex = new Map();     // element or text node → first line at or after it
    const whole = new Map();          // text node → the one uncut line it is part of
    const seen = new WeakMap();       // element → whether it was hidden when built
    let waiting = [];                 // entered, but no line produced yet

    const ctx = { heading: null, link: null, stack: [] };
    let acc = null;                   // { text, segs: [{ node, start, map }] }

    function emit(item) {
      item.index = items.length;
      item.heading = item.heading || ctx.heading;
      item.link = item.link || ctx.link;
      item.containers = ctx.stack.slice().concat(item.inner || []);
      delete item.inner;
      item.containers.forEach(c => { if (c.start === -1) c.start = item.index; });
      if (item.heading && item.heading.start === -1) item.heading.start = item.index;
      if (item.link && item.link.start === -1) item.link.start = item.index;
      items.push(item);
      waiting.forEach(n => firstIndex.set(n, item.index));
      waiting = [];
    }

    function flush() {
      if (!acc) return;
      const run = acc;
      acc = null;
      const text = run.text;
      const pieces = cuts(text);
      pieces.forEach(([from, to]) => {
        const [a, b] = trimmed(text, from, to);
        if (a >= b) return;
        const item = { kind: 'text', el: run.segs[0].node.parentElement, text: text.slice(a, b),
                       range: rangeFor(run.segs, a, b) };
        // A line that is its whole run can be re-joined in place when its
        // text changes: a clock, a counter, a score.
        if (pieces.length === 1) {
          item.nodes = run.segs.map(sg => sg.node);
          item.nodes.forEach(n => whole.set(n, items.length));
        }
        emit(item);
      });
    }

    function addText(node) {
      const before = acc ? acc.segs.length : 0;
      acc = appendRun(acc, node);
      if (acc && acc.segs.length > before) firstIndex.set(node, items.length);
    }

    function widgetItem(el, kind) {
      const N = Naming();
      const name = N ? N.accessibleName(el) : clean(el.textContent);
      if (kind === 'graphic') {
        const role = explicitRole(el);
        // Decoration by the page's own say-so, and tracking pixels.
        if (el.tagName === 'IMG' && el.hasAttribute('alt') && !clean(el.getAttribute('alt')) && !labelled(el)) return;
        if ((el.tagName === 'svg' || el.tagName === 'SVG') && !name && role !== 'img') return;
        try {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.width <= 2 && r.height <= 2) return;
        } catch (e) { /* no layout: keep it */ }
      }
      emit({ kind: 'object', role: kind, el: el, text: name });
    }

    /** One line from another site's frame, with its heading, link and containers made whole again. */
    function remoteItem(line, frameEl) {
      const shared = (id, make) => {
        const key = line.frameId + '|' + id;
        if (!remoteObjects.has(key)) remoteObjects.set(key, make(key));
        return remoteObjects.get(key);
      };
      return {
        kind: line.kind, role: line.role || '', el: frameEl, text: line.text || '', said: line.said || '',
        remote: { frameId: line.frameId, index: line.index },
        heading: line.heading ? shared(line.heading.id, () => ({ el: frameEl, level: line.heading.level, start: -1 })) : null,
        link: line.link ? shared(line.link.id, () => ({ el: frameEl, start: -1, remote: true })) : null,
        inner: (line.containers || []).map(c => shared(c.id, key => ({
          kind: c.kind, role: c.role, name: c.name || '', count: c.count, rows: c.rows, cols: c.cols,
          el: 'remote:' + key, start: -1   // the key, so it is the same container after a rebuild
        })))
      };
    }

    /** A frame is part of the page: read it where it stands. */
    function visitFrame(el) {
      flush();
      try {
        // Tracking pixels and hidden ad slots are frames too.
        const r = el.getBoundingClientRect();
        if ((r.width > 0 || r.height > 0) && r.width <= 2 && r.height <= 2) return;
      } catch (e) { /* no layout: keep it */ }

      const container = { kind: 'frame', el: el, role: 'frame', name: frameName(el), start: -1 };
      const before = items.length;
      const inner = frameDocument(el);
      if (inner) {
        frames.push(el);
        ctx.stack.push(container);
        containers.push(container);
        visit(inner.body);
        flush();
        ctx.stack.pop();
        return;
      }

      const lines = options.remote ? options.remote(el) : null;
      if (lines) {
        ctx.stack.push(container);
        containers.push(container);
        lines.forEach(line => emit(remoteItem(line, el)));
        ctx.stack.pop();
        return;
      }
      if (options.onRemoteFrame) options.onRemoteFrame(el);
      // Not readable yet: say it is there, so the user knows something is.
      if (items.length === before) emit({ kind: 'object', role: 'frame', el: el, text: container.name, pendingFrame: true });
    }

    function children(node) {
      if (node.shadowRoot) return node.shadowRoot.childNodes;
      if (node.tagName === 'SLOT' && node.assignedNodes) {
        const assigned = node.assignedNodes({ flatten: true });
        if (assigned.length) return assigned;
      }
      return node.childNodes;
    }

    function visit(node) {
      if (node.nodeType === 3) { addText(node); return; }
      if (node.nodeType !== 1 && node.nodeType !== 11) return;
      if (node.nodeType === 11) { Array.prototype.forEach.call(node.childNodes, n => visit(n)); return; }

      const el = node;
      if (SKIP_TAGS[el.tagName]) return;
      if (el.id && OWN_ID.test(el.id)) return;
      const style = styleOf(el);
      const hiddenNow = isHidden(el, style);
      seen.set(el, hiddenNow);
      if (hiddenNow) return;

      // Text still waiting to become a line belongs before this element, so
      // it is flushed first; only then does this element wait for its own
      // line. The other way round, a text box mapped to its label's line, and
      // focus landing in it put the cursor one line early.
      if (el.tagName === 'BR') { flush(); waiting.push(el); return; }
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') { flush(); waiting.push(el); visitFrame(el); return; }

      const kind = widgetKind(el);
      if (kind) {
        flush();
        waiting.push(el);
        widgetItem(el, kind);
        return;
      }

      const block = isBlock(el, style);
      const level = headingLevel(el);
      const link = isLinkEl(el) ? { el: el, start: -1 } : null;
      const container = containerOf(el);

      if (block || level || link || container) flush();
      waiting.push(el);

      // A link named by aria-label is read by that name, not by what is inside.
      if (link && labelled(el)) {
        const saved = ctx.link;
        ctx.link = link;
        emit({ kind: 'object', role: 'link', el: el, text: Naming() ? Naming().accessibleName(el) : '' });
        ctx.link = saved;
        return;
      }

      const saved = { heading: ctx.heading, link: ctx.link, depth: ctx.stack.length };
      if (level) ctx.heading = { el: el, level: level, start: -1 };
      if (link) ctx.link = link;
      if (container) { ctx.stack.push(container); containers.push(container); }

      const before = items.length;
      const open = el.tagName === 'DETAILS' ? el.open : true;
      let summarySeen = false;
      Array.prototype.forEach.call(children(el), child => {
        // A closed <details> shows only its summary.
        if (!open) {
          if (child.nodeType !== 1 || child.tagName !== 'SUMMARY' || summarySeen) return;
          summarySeen = true;
        }
        visit(child);
      });

      if (block || level || link || container) flush();

      // A link with nothing readable inside is still a link: say that it is there.
      if (link && items.length === before) {
        emit({ kind: 'object', role: 'link', el: el, text: '' });
      }

      ctx.heading = saved.heading;
      ctx.link = saved.link;
      ctx.stack.length = saved.depth;
    }

    if (doc.body) visit(doc.body);
    flush();
    waiting.forEach(n => firstIndex.set(n, items.length ? items.length - 1 : 0));

    const buffer = new Buffer(items, containers, firstIndex, whole, seen);
    buffer.frames = frames;
    return buffer;
  }

  // ── Looking things up ─────────────────────────────────────────────────────

  const FIELD_ROLES = { edit: 1, checkbox: 1, radio: 1, combo: 1, slider: 1, button: 1 };

  // What each quick-navigation key finds, as a test on one line.
  const KINDS = {
    heading: it => it.heading && it.heading.start === it.index,
    link: it => it.link && it.link.start === it.index,
    button: it => it.kind === 'object' && it.role === 'button',
    field: it => it.kind === 'object' && !!FIELD_ROLES[it.role],
    edit: it => it.kind === 'object' && it.role === 'edit',
    checkbox: it => it.kind === 'object' && it.role === 'checkbox',
    radio: it => it.kind === 'object' && it.role === 'radio',
    combo: it => it.kind === 'object' && it.role === 'combo',
    graphic: it => it.kind === 'object' && it.role === 'graphic',
    landmark: it => it.containers.some(c => c.kind === 'landmark' && c.start === it.index),
    list: it => it.containers.some(c => c.kind === 'list' && c.start === it.index),
    listitem: it => it.containers.some(c => c.kind === 'listitem' && c.start === it.index),
    table: it => it.containers.some(c => c.kind === 'table' && c.start === it.index),
    blockquote: it => it.containers.some(c => c.kind === 'blockquote' && c.start === it.index)
  };
  for (let n = 1; n <= 6; n++) {
    KINDS['heading' + n] = it => KINDS.heading(it) && it.heading.level === n;
  }

  class Buffer {
    constructor(items, containers, firstIndex, whole, seen) {
      this.items = items;
      this.containers = containers;
      this._first = firstIndex;
      this._whole = whole || new Map();
      this._seen = seen || new WeakMap();
      this._index = {};
      this._pending = new Set();       // lines patched, to be re-joined once the batch is in
    }

    /**
     * Takes one page change into the buffer without rebuilding it, where that
     * can be done exactly. True if taken; false means the buffer is out of
     * date and needs building again. Call settle() after the last change of
     * a batch: changes arrive together, after the fact, so a text node added
     * by one may already have been replaced by the next.
     *
     *
     * Rebuilding a 17,000-element page takes about 55 ms in Chrome. That is
     * fine once; it is not fine on every key press on a page with a ticking
     * clock or an animation, which is what happened before this.
     */
    patch(record) {
      if (record.type === 'characterData') {
        const index = this._whole.get(record.target);
        if (index === undefined) return false;
        this._pending.add(index);
        return true;
      }
      if (record.type === 'childList') {
        // A clock or counter set with textContent: one text node out, text in.
        const removed = Array.prototype.slice.call(record.removedNodes);
        const added = Array.prototype.slice.call(record.addedNodes);
        if (removed.length !== 1 || removed[0].nodeType !== 3 || added.some(n => n.nodeType !== 3)) return false;
        const index = this._whole.get(removed[0]);
        if (index === undefined) return false;
        const item = this.items[index];
        const at = item.nodes.indexOf(removed[0]);
        if (at < 0) return false;
        item.nodes.splice.apply(item.nodes, [at, 1].concat(added));
        this._whole.delete(removed[0]);
        added.forEach(n => { this._whole.set(n, index); this._first.set(n, index); });
        this._pending.add(index);
        return true;
      }
      if (record.type === 'attributes' && record.attributeName === 'style') {
        // An animation writing style every frame: only matters if it shows
        // or hides the element. A class can reach any element on the page,
        // so class changes are never waved through like this.
        const el = record.target;
        if (!this._seen.has(el)) return false;
        return isHidden(el, styleOf(el)) === this._seen.get(el);
      }
      return false;
    }

    /** Re-joins the lines changed in this batch. False if any can no longer be one line. */
    settle() {
      let ok = true;
      this._pending.forEach(index => { if (!this._rejoin(index)) ok = false; });
      this._pending.clear();
      return ok;
    }

    _rejoin(index) {
      const item = this.items[index];
      if (!item || !item.nodes) return false;
      let acc = null;
      // Nodes swapped in and out again within the batch are gone by now.
      item.nodes = item.nodes.filter(n => n.isConnected !== false);
      for (let i = 0; i < item.nodes.length; i++) acc = appendRun(acc, item.nodes[i]);
      if (!acc) return false;                          // emptied: the line should go
      const [a, b] = trimmed(acc.text, 0, acc.text.length);
      if (a >= b || b - a > MAX_LINE) return false;    // gone, or now too long for one line
      item.text = acc.text.slice(a, b);
      item.range = rangeFor(acc.segs, a, b);
      return true;
    }

    get length() { return this.items.length; }

    /** Every line a quick-navigation kind lands on, in order. */
    indexOf(kind) {
      if (!this._index[kind]) {
        const test = KINDS[kind];
        this._index[kind] = test ? this.items.filter(test).map(it => it.index) : [];
      }
      return this._index[kind];
    }

    /** The next (direction 1) or previous (-1) line of a kind, from a line. */
    find(kind, from, direction) {
      const list = this.indexOf(kind);
      if (direction > 0) {
        for (let i = 0; i < list.length; i++) if (list[i] > from) return list[i];
      } else {
        for (let i = list.length - 1; i >= 0; i--) if (list[i] < from) return list[i];
      }
      return -1;
    }

    /** The line for a node on the page: its own, or the first one after it. */
    lineOf(node) {
      for (let n = node; n; n = n.parentNode || n.host || frameOf(n)) {
        if (this._first.has(n)) return this._first.get(n);
      }
      return -1;
    }

    /** The line that came from line `index` of another site's frame. */
    lineOfRemote(frameId, index) {
      for (let i = 0; i < this.items.length; i++) {
        const r = this.items[i].remote;
        if (r && r.frameId === frameId && r.index === index) return i;
      }
      return -1;
    }

    /**
     * The buffer as plain data, for sending out of a frame to the page that
     * holds it. Lines that came from frames further in keep their own frame
     * and line, so a press on one goes straight to where it lives.
     */
    serialize(frameId) {
      const N = Naming();
      const ids = new Map();
      const id = o => { if (!ids.has(o)) ids.set(o, frameId + ':' + ids.size); return ids.get(o); };
      return this.items.map((it, i) => ({
        kind: it.kind,
        role: it.role || '',
        text: it.text || '',
        said: it.remote ? it.said : (it.kind === 'object' && N ? N.describeElement(it.el) : ''),
        frameId: it.remote ? it.remote.frameId : frameId,
        index: it.remote ? it.remote.index : i,
        heading: it.heading ? { id: id(it.heading), level: it.heading.level } : null,
        link: it.link ? { id: id(it.link) } : null,
        containers: it.containers.map(c => ({
          id: id(c), kind: c.kind, role: c.role, name: c.name || '', count: c.count, rows: c.rows, cols: c.cols
        }))
      }));
    }

    count(kind) { return this.indexOf(kind).length; }
  }

  const SRBuffer = { build, collapse, cuts, widgetKind, headingLevel, KINDS, MAX_LINE };
  root.AccessiFlowSRBuffer = SRBuffer;
})(typeof window !== 'undefined' ? window : globalThis);
