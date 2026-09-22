// AccessiFlow page bridge
//
// The content script's one way of talking to page-hook.js, the small script
// AccessiFlow runs in the page's own JavaScript world. Two modules need it --
// the animation interceptor and the sound cues -- and it has one job that is
// easy to get wrong: the hook's <script> loads asynchronously, so anything
// posted before it has finished loading lands on a page with nobody listening
// and is silently lost. Messages are therefore queued until the hook says it
// is ready.
//
// Injected on first use rather than on every page, so a user who never turns
// on a feature that needs it never has extension code in their pages' world.
'use strict';

(function (root) {
  const CHANNEL = 'accessiflow-hook';

  const bridge = {
    _injected: false,
    _ready: false,
    _queue: [],
    _listeners: {},

    /** Injects the hook if it is not already there. */
    ensure() {
      if (this._injected) return;
      this._injected = true;

      window.addEventListener('message', event => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.channel !== CHANNEL || data.from !== 'hook') return;
        if (data.action === 'ready') {
          this._ready = true;
          const queued = this._queue;
          this._queue = [];
          queued.forEach(message => window.postMessage(message, '*'));
          return;
        }
        (this._listeners[data.action] || []).forEach(fn => {
          try { fn(data); } catch (e) { /* one listener must not break another */ }
        });
      });

      try {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('page-hook.js');
        script.onload = () => script.remove();
        script.onerror = () => {
          // A strict script-src on the site can refuse this. Features that
          // need the page world lose that part and keep everything else.
          console.warn('[AccessiFlow] page hook blocked, probably by the site security policy');
          script.remove();
        };
        (document.head || document.documentElement).appendChild(script);
      } catch (e) {
        console.warn('[AccessiFlow] page hook could not be injected: ' + e.message);
      }
    },

    /** Sends a command to the hook, now or as soon as it has loaded. */
    send(action, data) {
      this.ensure();
      const message = Object.assign({ channel: CHANNEL, from: 'extension', action: action }, data || {});
      if (this._ready) window.postMessage(message, '*');
      else this._queue.push(message);
    },

    /** Listens for events the hook reports, such as a sound starting. */
    on(action, fn) {
      (this._listeners[action] = this._listeners[action] || []).push(fn);
    },

    off(action, fn) {
      this._listeners[action] = (this._listeners[action] || []).filter(f => f !== fn);
    },

    get ready() { return this._ready; },
    get injected() { return this._injected; }
  };

  root.AccessiFlowPageBridge = bridge;
})(typeof globalThis !== 'undefined' ? globalThis : self);
