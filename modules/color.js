// AccessiFlow colour maths
//
// Pure functions. No DOM, no chrome APIs, no state. That is deliberate: the
// dark mode engine, the focus halo and the WCAG audit all need the same
// arithmetic, and keeping it side-effect free means it can be unit tested
// against the published WCAG reference pairs instead of by squinting at a
// screenshot.
//
// Attaches to globalThis, like modules/ai-config.js, so the same file works in
// a content script, in the popup, and in the service worker.
'use strict';

(function (root) {

  // ── Parsing ───────────────────────────────────────────────────────────────

  // getComputedStyle always hands back rgb()/rgba() in a real browser, so that
  // is the path that matters for speed. The rest is for author-written values
  // in inline styles, which we still meet often enough to care about.
  const NAMED = {
    transparent: [0, 0, 0, 0],
    black: [0, 0, 0, 1], white: [255, 255, 255, 1], red: [255, 0, 0, 1],
    green: [0, 128, 0, 1], blue: [0, 0, 255, 1], yellow: [255, 255, 0, 1],
    cyan: [0, 255, 255, 1], aqua: [0, 255, 255, 1], magenta: [255, 0, 255, 1],
    fuchsia: [255, 0, 255, 1], gray: [128, 128, 128, 1], grey: [128, 128, 128, 1],
    silver: [192, 192, 192, 1], maroon: [128, 0, 0, 1], olive: [128, 128, 0, 1],
    lime: [0, 255, 0, 1], teal: [0, 128, 128, 1], navy: [0, 0, 128, 1],
    purple: [128, 0, 128, 1], orange: [255, 165, 0, 1]
  };

  /**
   * @param {string} str any CSS colour
   * @returns {?{r:number,g:number,b:number,a:number}} 0-255 channels, 0-1 alpha
   */
  function parseColor(str) {
    if (!str) return null;
    if (typeof str === 'object') {
      // Already parsed. Tolerating this keeps call sites from double-guarding.
      return (typeof str.r === 'number') ? str : null;
    }

    const s = String(str).trim().toLowerCase();
    if (!s) return null;

    const named = NAMED[s];
    if (named) return { r: named[0], g: named[1], b: named[2], a: named[3] };

    // rgb(1 2 3), rgb(1,2,3), rgba(1,2,3,.5), rgb(1 2 3 / 50%)
    if (s.indexOf('rgb') === 0) {
      const inside = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')'));
      const parts = inside.replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
      if (parts.length < 3) return null;
      const r = channel(parts[0]);
      const g = channel(parts[1]);
      const b = channel(parts[2]);
      const a = parts.length > 3 ? alpha(parts[3]) : 1;
      if (r === null || g === null || b === null) return null;
      return { r: r, g: g, b: b, a: a };
    }

    if (s[0] === '#') {
      const hex = s.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        const v = hex.split('').map(c => parseInt(c + c, 16));
        if (v.some(isNaN)) return null;
        return { r: v[0], g: v[1], b: v[2], a: hex.length === 4 ? v[3] / 255 : 1 };
      }
      if (hex.length === 6 || hex.length === 8) {
        const v = [];
        for (let i = 0; i < hex.length; i += 2) v.push(parseInt(hex.slice(i, i + 2), 16));
        if (v.some(isNaN)) return null;
        return { r: v[0], g: v[1], b: v[2], a: hex.length === 8 ? v[3] / 255 : 1 };
      }
      return null;
    }

    if (s.indexOf('hsl') === 0) {
      const inside = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')'));
      const parts = inside.replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
      if (parts.length < 3) return null;
      const h = parseFloat(parts[0]);
      const sat = parseFloat(parts[1]) / 100;
      const li = parseFloat(parts[2]) / 100;
      if (isNaN(h) || isNaN(sat) || isNaN(li)) return null;
      const rgb = hslToRgb(h, sat, li);
      rgb.a = parts.length > 3 ? alpha(parts[3]) : 1;
      return rgb;
    }

    // color(srgb 0.1 0.2 0.3 / .5) — increasingly common in modern stylesheets.
    if (s.indexOf('color(') === 0 && s.indexOf('srgb') !== -1) {
      const inside = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')'));
      const parts = inside.replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
      const nums = parts.slice(1).map(parseFloat).filter(n => !isNaN(n));
      if (nums.length < 3) return null;
      return {
        r: clamp255(nums[0] * 255),
        g: clamp255(nums[1] * 255),
        b: clamp255(nums[2] * 255),
        a: nums.length > 3 ? Math.max(0, Math.min(1, nums[3])) : 1
      };
    }

    return null;
  }

  function channel(part) {
    if (part.slice(-1) === '%') {
      const pct = parseFloat(part);
      return isNaN(pct) ? null : clamp255(pct * 2.55);
    }
    const n = parseFloat(part);
    return isNaN(n) ? null : clamp255(n);
  }

  function alpha(part) {
    if (part.slice(-1) === '%') {
      const pct = parseFloat(part);
      return isNaN(pct) ? 1 : Math.max(0, Math.min(1, pct / 100));
    }
    const n = parseFloat(part);
    return isNaN(n) ? 1 : Math.max(0, Math.min(1, n));
  }

  function clamp255(n) { return Math.max(0, Math.min(255, Math.round(n))); }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return { r: clamp255((rgb[0] + m) * 255), g: clamp255((rgb[1] + m) * 255), b: clamp255((rgb[2] + m) * 255), a: 1 };
  }

  // ── Formatting ────────────────────────────────────────────────────────────

  function toRgbString(c) {
    if (!c) return '';
    return (c.a !== undefined && c.a < 1)
      ? 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + round(c.a, 3) + ')'
      : 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')';
  }

  function toHex(c) {
    if (!c) return '';
    const h = n => ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2);
    return '#' + h(c.r) + h(c.g) + h(c.b);
  }

  function round(n, places) {
    const f = Math.pow(10, places || 0);
    return Math.round(n * f) / f;
  }

  // ── Contrast (WCAG 2.2, criterion 1.4.3) ─────────────────────────────────

  function srgbToLinear(c) {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(v) {
    const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return clamp255(c * 255);
  }

  /** WCAG relative luminance, 0 (black) to 1 (white). */
  function relativeLuminance(color) {
    const c = parseColor(color);
    if (!c) return 0;
    return 0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b);
  }

  /** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
  function contrastRatio(a, b) {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const light = Math.max(la, lb);
    const dark = Math.min(la, lb);
    return (light + 0.05) / (dark + 0.05);
  }

  /**
   * Composites a translucent colour over an opaque one. Needed everywhere,
   * because a page that sets `rgba(0,0,0,.6)` on text has no single colour
   * until you know what is behind it.
   */
  function blend(fg, bg) {
    const f = parseColor(fg);
    const b = parseColor(bg);
    if (!f) return b;
    if (!b) return f;
    const a = f.a === undefined ? 1 : f.a;
    if (a >= 1) return { r: f.r, g: f.g, b: f.b, a: 1 };
    return {
      r: Math.round(f.r * a + b.r * (1 - a)),
      g: Math.round(f.g * a + b.g * (1 - a)),
      b: Math.round(f.b * a + b.b * (1 - a)),
      a: 1
    };
  }

  /**
   * The ratio this text actually has to meet. WCAG calls 18.66px bold or
   * 24px regular "large text", and lets it pass at 3:1 instead of 4.5:1.
   *
   * @param {number} fontSizePx computed font-size
   * @param {number|string} fontWeight computed font-weight
   * @param {number} [base] the normal-text target, 4.5 for AA and 7 for AAA
   */
  function requiredRatio(fontSizePx, fontWeight, base) {
    const target = base || 4.5;
    const weight = parseInt(fontWeight, 10) || (String(fontWeight).indexOf('bold') !== -1 ? 700 : 400);
    const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && weight >= 700);
    if (!large) return target;
    // AAA drops large text to 4.5, AA drops it to 3.
    return target >= 7 ? 4.5 : 3;
  }

  // ── OKLab / OKLCH (Björn Ottosson) ───────────────────────────────────────
  //
  // Lightness is adjusted in OKLCH rather than HSL because OKLCH lightness is
  // perceptually uniform. Darkening an HSL colour shifts its apparent hue —
  // which is exactly why naive dark mode tools turn blues purple.

  function srgbToOklab(color) {
    const c = parseColor(color);
    if (!c) return { L: 0, a: 0, b: 0 };
    const r = srgbToLinear(c.r);
    const g = srgbToLinear(c.g);
    const bl = srgbToLinear(c.b);

    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl;

    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    return {
      L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
      a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
      b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    };
  }

  function oklabToSrgb(lab) {
    const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
    const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
    const s_ = lab.L - 0.0894841775 * lab.a - 1.2914855480 * lab.b;

    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    return {
      r: linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
      a: 1
    };
  }

  function toOKLCH(color) {
    const lab = srgbToOklab(color);
    const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
    let H = Math.atan2(lab.b, lab.a) * 180 / Math.PI;
    if (H < 0) H += 360;
    const src = parseColor(color);
    return { L: lab.L, C: C, H: H, a: src && src.a !== undefined ? src.a : 1 };
  }

  function fromOKLCH(lch) {
    const rad = lch.H * Math.PI / 180;
    const rgb = oklabToSrgb({
      L: Math.max(0, Math.min(1, lch.L)),
      a: Math.cos(rad) * lch.C,
      b: Math.sin(rad) * lch.C
    });
    rgb.a = lch.a === undefined ? 1 : lch.a;
    return rgb;
  }

  /**
   * Brings a colour back inside the sRGB gamut by desaturating it, rather
   * than by clipping channels. Clipping is what shifts hue; dropping chroma
   * keeps the colour recognisably itself.
   */
  function gamutMap(lch) {
    let C = lch.C;
    for (let i = 0; i < 12; i++) {
      const candidate = { L: lch.L, C: C, H: lch.H, a: lch.a };
      if (inGamut(candidate)) return candidate;
      C *= 0.8;
    }
    return { L: lch.L, C: 0, H: lch.H, a: lch.a };
  }

  function inGamut(lch) {
    const rad = lch.H * Math.PI / 180;
    const l_ = lch.L + 0.3963377774 * (Math.cos(rad) * lch.C) + 0.2158037573 * (Math.sin(rad) * lch.C);
    const m_ = lch.L - 0.1055613458 * (Math.cos(rad) * lch.C) - 0.0638541728 * (Math.sin(rad) * lch.C);
    const s_ = lch.L - 0.0894841775 * (Math.cos(rad) * lch.C) - 1.2914855480 * (Math.sin(rad) * lch.C);
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    const lin = [
      +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
    return lin.every(v => v >= -0.0005 && v <= 1.0005);
  }

  // ── The one function the dark mode engine is built on ────────────────────

  /**
   * Returns a colour as close to `fg` as possible that reaches `target`
   * contrast against `bg`, preserving hue and chroma and moving only
   * perceptual lightness.
   *
   * Contrast against a fixed background is monotonic in luminance distance,
   * so once we know which way to move — away from the background — a binary
   * search finds the *smallest* change that passes. Making the smallest change
   * matters: the point is a page that still looks like itself, not a page
   * repainted in black and white.
   *
   * @param {string|object} fg the colour to adjust
   * @param {string|object} bg what it sits on, opaque
   * @param {number} [target] ratio to reach, 4.5 by default
   * @returns {{r,g,b,a}} always a colour, even when the target is unreachable
   */
  function adjustToContrast(fg, bg, target) {
    const want = target || 4.5;
    const bgc = parseColor(bg);
    const fgc = parseColor(fg);
    if (!bgc) return fgc || { r: 0, g: 0, b: 0, a: 1 };
    if (!fgc) return { r: 255, g: 255, b: 255, a: 1 };

    const flat = blend(fgc, bgc);
    if (contrastRatio(flat, bgc) >= want) return fgc;

    const lch = toOKLCH(flat);
    const bgLum = relativeLuminance(bgc);

    // Move away from the background: lighter on a dark page, darker on a light one.
    const goLighter = bgLum < 0.5;
    let lo = lch.L;
    let hi = goLighter ? 1 : 0;

    const at = L => {
      const c = fromOKLCH(gamutMap({ L: L, C: lch.C, H: lch.H, a: 1 }));
      return { color: c, ratio: contrastRatio(c, bgc) };
    };

    // The endpoints are pure white and pure black, not the hue-preserving
    // colours at L=1 and L=0.
    //
    // Keeping chroma at the extremes leaves a residue -- L=0 with a blue hue
    // comes back as #010007 rather than #000000 -- which costs about 0.03 of
    // contrast ratio. That is invisible on screen and irrelevant in the middle
    // of the range, but against a background whose ceiling is exactly 7.00:1 it
    // is the difference between meeting AAA and missing it. There is no hue to
    // preserve in black anyway.
    const WHITE = { r: 255, g: 255, b: 255, a: 1 };
    const BLACK = { r: 0, g: 0, b: 0, a: 1 };
    const endpoint = goLighter ? WHITE : BLACK;
    const endpointRatio = contrastRatio(endpoint, bgc);

    // If even the endpoint cannot reach the target, take whichever extreme
    // gets closest. A colour that falls short is still the best available, and
    // returning the original would leave genuinely unreadable text on the page.
    if (endpointRatio < want) {
      const other = goLighter ? BLACK : WHITE;
      const best = contrastRatio(other, bgc) > endpointRatio ? other : endpoint;
      return { r: best.r, g: best.g, b: best.b, a: fgc.a === undefined ? 1 : fgc.a };
    }

    // From here the endpoint is known to pass, so `best` always holds a colour
    // that meets the target and the search can only improve on how little it
    // had to change.
    let best = endpoint;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      const probe = at(mid);
      if (probe.ratio >= want) { best = probe.color; hi = mid; }
      else { lo = mid; }
    }

    return { r: best.r, g: best.g, b: best.b, a: fgc.a === undefined ? 1 : fgc.a };
  }

  /**
   * Maps a colour's lightness into a band, keeping hue and chroma. This is the
   * primitive behind Smart Dark Mode: a light background at L=0.98 and one at
   * L=0.90 must stay visibly different from each other after the flip, or
   * every card, table stripe and input box merges into one flat rectangle.
   *
   * @param {string|object} color
   * @param {number} lo bottom of the destination band
   * @param {number} hi top of the destination band
   * @param {boolean} [invert] true to flip light into dark
   */
  function mapLightness(color, lo, hi, invert) {
    const lch = toOKLCH(color);
    const source = invert ? (1 - lch.L) : lch.L;
    const L = lo + source * (hi - lo);
    return fromOKLCH(gamutMap({ L: Math.max(0, Math.min(1, L)), C: lch.C, H: lch.H, a: lch.a }));
  }

  /** True when a colour is see-through enough that what is behind it decides. */
  function isTransparent(color) {
    const c = parseColor(color);
    return !c || c.a === undefined ? true : c.a < 0.05;
  }

  /** Picks whichever candidate reads best against a background. */
  function bestContrasting(bg, candidates) {
    let best = null;
    let bestRatio = -1;
    for (let i = 0; i < candidates.length; i++) {
      const ratio = contrastRatio(candidates[i], bg);
      if (ratio > bestRatio) { bestRatio = ratio; best = candidates[i]; }
    }
    return { color: best, ratio: bestRatio };
  }

  root.ACCESSIFLOW_COLOR = {
    parseColor: parseColor,
    toRgbString: toRgbString,
    toHex: toHex,
    relativeLuminance: relativeLuminance,
    contrastRatio: contrastRatio,
    requiredRatio: requiredRatio,
    blend: blend,
    isTransparent: isTransparent,
    toOKLCH: toOKLCH,
    fromOKLCH: fromOKLCH,
    gamutMap: gamutMap,
    adjustToContrast: adjustToContrast,
    mapLightness: mapLightness,
    bestContrasting: bestContrasting
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
