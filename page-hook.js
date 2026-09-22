// AccessiFlow page hook
//
// This is the only AccessiFlow code that runs in the page's own JavaScript
// world. Content scripts live in an isolated world: they share the DOM but
// not the globals, so they cannot see or replace the page's
// requestAnimationFrame. Canvas animations, JS-driven tickers and smooth
// scrolling are all driven from there, and no stylesheet reaches them. So are
// sounds: a notification ping played with `new Audio(...).play()` or Web Audio
// never touches the DOM, and only this world can notice it starting.
//
// It is inert until told otherwise, it patches as little as it can, and every
// patch is reversible. Rules it follows, because this is the riskiest code in
// the extension:
//
//   * Originals are captured once, at load, before anything else can wrap them.
//   * Nothing is patched until a freeze is actually requested.
//   * thaw() puts every original back and restarts the loops it stopped, so
//     turning the setting off leaves the page working exactly as before.
//   * Anything that throws is swallowed. A page that breaks because an
//     accessibility tool got in the way is a worse outcome than a page that
//     keeps moving.
(function () {
  'use strict';

  const CHANNEL = 'accessiflow-hook';

  // Already installed, most likely by the content script before the
  // extension was reloaded. The page world outlives the content script, so a
  // new bridge is asking again: answer, or its commands queue forever.
  if (window.__accessiflowHook) {
    window.postMessage({ channel: CHANNEL, from: 'hook', action: 'ready' }, '*');
    return;
  }

  // Captured before any patch, so restoring is exact even if the page wraps
  // these itself afterwards.
  const native = {
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    scrollTo: window.scrollTo,
    scrollBy: window.scrollBy,
    elementScrollTo: window.Element && window.Element.prototype.scrollTo,
    elementScrollIntoView: window.Element && window.Element.prototype.scrollIntoView,
    mediaPlay: window.HTMLMediaElement && window.HTMLMediaElement.prototype.play,
    bufferStart: window.AudioBufferSourceNode && window.AudioBufferSourceNode.prototype.start,
    oscillatorStart: window.OscillatorNode && window.OscillatorNode.prototype.start
  };

  const state = {
    frozen: false,
    features: {},
    patched: false,
    currentCallback: null,     // the rAF callback running right now
    drawingCallbacks: new Set(),   // callbacks seen painting to a canvas
    frozenCallbacks: [],       // loops we stopped, kept so they can be restarted
    canvasPatches: []          // [object, method, original]
  };

  // ── Recognising a canvas animation ────────────────────────────────────────
  //
  // There is no way to ask "does this callback drive that canvas". So the
  // drawing calls are instrumented instead: whatever rAF callback is on the
  // stack when a paint happens is the one driving it. After one frame we know
  // which loops are animating a canvas and can stop only those, leaving
  // layout, input and data-fetching loops alone.

  const DRAW_METHODS_2D = ['drawImage', 'fillRect', 'clearRect', 'fill', 'stroke',
    'putImageData', 'fillText', 'strokeText'];
  const DRAW_METHODS_GL = ['drawArrays', 'drawElements', 'clear'];

  function instrumentDrawing() {
    const targets = [];
    if (window.CanvasRenderingContext2D) {
      targets.push([window.CanvasRenderingContext2D.prototype, DRAW_METHODS_2D]);
    }
    if (window.WebGLRenderingContext) {
      targets.push([window.WebGLRenderingContext.prototype, DRAW_METHODS_GL]);
    }
    if (window.WebGL2RenderingContext) {
      targets.push([window.WebGL2RenderingContext.prototype, DRAW_METHODS_GL]);
    }

    targets.forEach(function (entry) {
      const proto = entry[0];
      entry[1].forEach(function (method) {
        if (typeof proto[method] !== 'function') return;
        const original = proto[method];
        state.canvasPatches.push([proto, method, original]);
        proto[method] = function () {
          if (state.currentCallback !== null) {
            state.drawingCallbacks.add(state.currentCallback);
          }
          return original.apply(this, arguments);
        };
      });
    });
  }

  function removeDrawingInstrumentation() {
    state.canvasPatches.forEach(function (entry) {
      try { entry[0][entry[1]] = entry[2]; } catch (e) { /* skip */ }
    });
    state.canvasPatches = [];
  }

  // ── The patches ───────────────────────────────────────────────────────────

  function patch() {
    if (state.patched) return;
    // Nothing to wrap means nothing to do. Better to leave the page alone than
    // to install a broken patch over a missing global.
    if (typeof native.requestAnimationFrame !== 'function') return;
    state.patched = true;

    if (state.features.canvas) instrumentDrawing();

    window.requestAnimationFrame = function (callback) {
      if (typeof callback !== 'function') {
        return native.requestAnimationFrame.call(window, callback);
      }

      // A loop already identified as painting a canvas is not rescheduled.
      // Not calling it is what stops the animation: the loop asks for its next
      // frame from inside itself, so declining to run it ends the cycle. It is
      // kept so thaw() can start it again.
      if (state.frozen && state.features.canvas && state.drawingCallbacks.has(callback)) {
        state.frozenCallbacks.push(callback);
        return 0;
      }

      return native.requestAnimationFrame.call(window, function (timestamp) {
        const previous = state.currentCallback;
        state.currentCallback = callback;
        try {
          return callback(timestamp);
        } finally {
          state.currentCallback = previous;
        }
      });
    };

    if (state.features.scroll) {
      // Smooth scrolling is a vestibular trigger, and `scroll-behavior: auto`
      // in a stylesheet does not override a behavior passed in JavaScript.
      const forceInstant = function (original, context) {
        return function (options) {
          try {
            if (options && typeof options === 'object') {
              const copy = Object.assign({}, options);
              copy.behavior = 'auto';
              return original.call(this, copy);
            }
          } catch (e) { /* fall through to the original call */ }
          return original.apply(this, arguments);
        };
      };

      window.scrollTo = forceInstant(native.scrollTo);
      window.scrollBy = forceInstant(native.scrollBy);
      if (native.elementScrollTo) {
        window.Element.prototype.scrollTo = forceInstant(native.elementScrollTo);
      }
      if (native.elementScrollIntoView) {
        window.Element.prototype.scrollIntoView = function (options) {
          if (options && typeof options === 'object') {
            const copy = Object.assign({}, options);
            copy.behavior = 'auto';
            return native.elementScrollIntoView.call(this, copy);
          }
          // The boolean form has no behaviour to override.
          return native.elementScrollIntoView.apply(this, arguments);
        };
      }
    }
  }

  function unpatch() {
    if (!state.patched) return;
    state.patched = false;

    window.requestAnimationFrame = native.requestAnimationFrame;
    window.cancelAnimationFrame = native.cancelAnimationFrame;
    window.scrollTo = native.scrollTo;
    window.scrollBy = native.scrollBy;
    if (native.elementScrollTo) window.Element.prototype.scrollTo = native.elementScrollTo;
    if (native.elementScrollIntoView) {
      window.Element.prototype.scrollIntoView = native.elementScrollIntoView;
    }

    removeDrawingInstrumentation();
  }

  function freeze(features) {
    state.features = features || {};
    state.frozen = true;
    patch();
  }

  function thaw() {
    state.frozen = false;

    // Restart every loop that was stopped, before the patches come off, so
    // the page animates again instead of sitting frozen until it is reloaded.
    const stalled = state.frozenCallbacks.slice();
    state.frozenCallbacks = [];
    state.drawingCallbacks = new Set();

    unpatch();

    stalled.forEach(function (callback) {
      try { native.requestAnimationFrame.call(window, callback); } catch (e) { /* skip */ }
    });
  }

  // ── Noticing sounds ───────────────────────────────────────────────────────
  //
  // Reports that a sound started, and where on screen it came from when that
  // is knowable. A playing <audio> element has a position; a sound made with
  // Web Audio does not, and is reported without one rather than being guessed
  // at. A video that is visibly playing is left out: it is its own visual cue.

  const sound = { watching: false, last: {} };

  function report(kind, element) {
    const now = Date.now();
    // One cue per kind per 0.7 s, so a burst of clicks is one ripple.
    if (sound.last[kind] && now - sound.last[kind] < 700) return;
    sound.last[kind] = now;

    let rect = null;
    try {
      if (element && element.isConnected && element.getBoundingClientRect) {
        const r = element.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          rect = { top: r.top, left: r.left, width: r.width, height: r.height };
        }
      }
    } catch (e) { /* no position, then */ }

    window.postMessage({ channel: CHANNEL, from: 'hook', action: 'sound', kind: kind, rect: rect }, '*');
  }

  function isAudible(media) {
    try {
      if (media.muted || media.volume === 0) return false;
      if (media.tagName === 'VIDEO') {
        const r = media.getBoundingClientRect();
        const onScreen = r.width > 40 && r.height > 40 && r.bottom > 0 && r.top < window.innerHeight;
        if (onScreen) return false;
      }
      return true;
    } catch (e) {
      return true;
    }
  }

  function watchSound() {
    if (sound.watching) return;
    sound.watching = true;
    if (native.mediaPlay) {
      window.HTMLMediaElement.prototype.play = function () {
        try { if (isAudible(this)) report(this.tagName === 'VIDEO' ? 'video' : 'audio', this); } catch (e) { /* skip */ }
        return native.mediaPlay.apply(this, arguments);
      };
    }
    if (native.bufferStart) {
      window.AudioBufferSourceNode.prototype.start = function () {
        try { report('webaudio', null); } catch (e) { /* skip */ }
        return native.bufferStart.apply(this, arguments);
      };
    }
    if (native.oscillatorStart) {
      window.OscillatorNode.prototype.start = function () {
        try { report('tone', null); } catch (e) { /* skip */ }
        return native.oscillatorStart.apply(this, arguments);
      };
    }
  }

  function unwatchSound() {
    if (!sound.watching) return;
    sound.watching = false;
    if (native.mediaPlay) window.HTMLMediaElement.prototype.play = native.mediaPlay;
    if (native.bufferStart) window.AudioBufferSourceNode.prototype.start = native.bufferStart;
    if (native.oscillatorStart) window.OscillatorNode.prototype.start = native.oscillatorStart;
  }

  // ── Talking to the content script ─────────────────────────────────────────

  window.addEventListener('message', function (event) {
    // Only this window, and only our own channel. Anything else on the page
    // posting messages is none of our business.
    if (event.source !== window) return;
    const data = event.data;
    // Only commands from the extension. The hook's own events travel on the
    // same channel, and reacting to them would be a loop.
    if (!data || data.channel !== CHANNEL || data.from !== 'extension' || !data.action) return;

    try {
      if (data.action === 'freeze') freeze(data.features);
      else if (data.action === 'thaw') thaw();
      else if (data.action === 'watchSound') watchSound();
      else if (data.action === 'unwatchSound') unwatchSound();
    } catch (e) {
      // Never let a failure here take the page's own message handling with it.
    }
  }, false);

  window.__accessiflowHook = {
    freeze: freeze,
    thaw: thaw,
    watchSound: watchSound,
    unwatchSound: unwatchSound,
    get frozen() { return state.frozen; },
    get watchingSound() { return sound.watching; },
    get stalled() { return state.frozenCallbacks.length; }
  };

  // Tell the content script the hook is live, so it does not have to poll.
  window.postMessage({ channel: CHANNEL, from: 'hook', action: 'ready' }, '*');
})();
