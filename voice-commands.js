// AccessiFlow voice commands: what the spoken words mean
//
// Turns what the recogniser heard into one command, or into nothing. The
// rule that matters most: the whole phrase has to be a command. The first
// version of voice control searched for command words anywhere in what was
// said, so "table" ran "tab", "the next page" ran "next", and anyone talking
// near the microphone was driving the browser. A voice interface that acts on
// chatter is worse than none, because the person using it cannot reach for
// the mouse to undo it.
//
// Pure: no DOM, no chrome.*. The voice panel uses it, and so do the tests.
'use strict';

(function (root) {
  // Exact phrases, after tidying. Several ways to say each thing, because
  // people do not remember the one we picked.
  const PHRASES = {
    // Pausing by voice keeps listening, but only for the words that resume:
    // a microphone that turned itself off could never hear "resume".
    sleep: ['pause', 'pause voice', 'pause voice control', 'pause listening', 'pause commands',
      'go to sleep', 'sleep', 'stop listening'],
    wake: ['resume', 'resume voice', 'resume voice control', 'resume listening', 'unpause', 'un pause',
      'wake up', 'start listening'],
    help: ['what can i say', 'help', 'show commands', 'show help', 'commands'],

    // Numbers are a mode: on until one of the "off" phrases, and nothing else.
    numbers: ['show numbers', 'numbers', 'show number', 'show the numbers', 'numbers on', 'turn on numbers',
      'turn numbers on', 'enable numbers', 'show labels', 'number everything', 'label everything'],
    hideNumbers: ['no numbers', 'hide numbers', 'hide the numbers', 'disable numbers', 'numbers off',
      'turn off numbers', 'turn numbers off', 'stop numbers', 'remove numbers', 'clear numbers', 'hide labels'],
    closePopup: ['close', 'close pop up', 'close popup', 'close the pop up', 'close the popup', 'close this pop up',
      'close this popup', 'close it', 'close this', 'close dialog', 'close the dialog', 'close message',
      'close the message', 'close ad', 'close the ad', 'close advert', 'close banner', 'dismiss', 'dismiss it',
      'dismiss pop up', 'dismiss this', 'go away', 'get rid of this', 'get rid of it'],
    cancel: ['cancel', 'never mind', 'nevermind'],
    yes: ['yes', 'yes please', 'confirm', 'do it', 'go ahead'],
    no: ['no', 'no thanks', 'don\'t'],
    stop: ['stop', 'stop scrolling', 'stop it'],

    scrollDown: ['scroll down', 'down', 'move down', 'go down', 'scroll'],
    scrollUp: ['scroll up', 'up', 'move up', 'go up'],
    pageDown: ['page down', 'scroll a page', 'scroll down a page'],
    pageUp: ['page up', 'scroll up a page'],
    top: ['top', 'go to top', 'go to the top', 'scroll to top', 'scroll to the top', 'top of page', 'top of the page'],
    bottom: ['bottom', 'go to bottom', 'go to the bottom', 'scroll to bottom', 'scroll to the bottom',
      'bottom of page', 'bottom of the page'],
    keepDown: ['keep scrolling', 'keep scrolling down', 'keep going', 'keep going down'],
    keepUp: ['keep scrolling up', 'keep going up'],

    nextHeading: ['next heading', 'heading', 'next section'],
    prevHeading: ['previous heading', 'last heading', 'heading before', 'previous section'],
    textbox: ['text box', 'textbox', 'go to text box', 'go to the text box', 'first text box', 'type here'],
    nextField: ['next field', 'next box', 'next text box', 'next question'],
    submit: ['submit', 'submit form', 'submit the form', 'send form', 'send the form'],
    undoTyping: ['undo', 'delete that', 'scratch that', 'undo that'],

    back: ['go back', 'back', 'back a page', 'previous page'],
    forward: ['go forward', 'forward', 'forward a page'],
    reload: ['reload', 'refresh', 'reload page', 'refresh page', 'reload the page', 'refresh the page'],
    newTab: ['new tab', 'open new tab', 'open a new tab'],
    closeTab: ['close tab', 'close this tab', 'close the tab'],
    nextTab: ['next tab', 'switch tab'],
    prevTab: ['previous tab']
  };

  const LOOKUP = {};
  Object.keys(PHRASES).forEach(name => PHRASES[name].forEach(p => { LOOKUP[p] = name; }));

  // What each phrase name becomes.
  const BUILD = {
    scrollDown: () => ({ type: 'scroll', dir: 1 }),
    scrollUp: () => ({ type: 'scroll', dir: -1 }),
    pageDown: () => ({ type: 'scroll', dir: 1, amount: 'page' }),
    pageUp: () => ({ type: 'scroll', dir: -1, amount: 'page' }),
    top: () => ({ type: 'scroll', dir: -1, amount: 'end' }),
    bottom: () => ({ type: 'scroll', dir: 1, amount: 'end' }),
    keepDown: () => ({ type: 'scroll', dir: 1, keep: true }),
    keepUp: () => ({ type: 'scroll', dir: -1, keep: true }),
    nextHeading: () => ({ type: 'heading', dir: 1 }),
    prevHeading: () => ({ type: 'heading', dir: -1 })
  };

  // Where a command runs: in the panel, on the browser's tabs, or in the page.
  const WHERE = {
    sleep: 'panel', wake: 'panel', help: 'panel', yes: 'panel', no: 'panel', cancel: 'panel',
    back: 'tab', forward: 'tab', reload: 'tab', newTab: 'tab', closeTab: 'tab',
    nextTab: 'tab', prevTab: 'tab', search: 'tab'
  };

  // Things that change something the user cannot take back by voice.
  const CONFIRM = { closeTab: true, submit: true };

  const UNITS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70,
    eighty: 80, ninety: 90 };
  // Heard in place of a small number when it is said on its own.
  const SOUNDALIKES = { to: 2, too: 2, for: 4, fore: 4, won: 1, ate: 8, tree: 3, free: 3, sex: 6, sick: 6 };

  /** Lower case, no punctuation, no filler, single spaces. */
  function tidy(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[‘’]/g, '\'')
      .replace(/[.,!?;:।"]/g, ' ')
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(please|okay|ok|um|uh|hey) /, '')
      .replace(/ please$/, '')
      .trim();
  }

  /** "12", "twelve", "one hundred and five", "number 7". Null if not a number. */
  function toNumber(text, allowSoundalikes) {
    const t = tidy(text).replace(/^number /, '').replace(/^no /, '');
    if (/^\d{1,3}$/.test(t)) return parseInt(t, 10);
    if (allowSoundalikes && Object.prototype.hasOwnProperty.call(SOUNDALIKES, t)) return SOUNDALIKES[t];

    const words = t.split(' ').filter(w => w !== 'and');
    if (!words.length) return null;
    let total = 0;
    let current = 0;
    let any = false;
    for (const w of words) {
      if (Object.prototype.hasOwnProperty.call(UNITS, w)) { current += UNITS[w]; any = true; }
      else if (Object.prototype.hasOwnProperty.call(TENS, w)) { current += TENS[w]; any = true; }
      else if (w === 'hundred') { current = (current || 1) * 100; any = true; }
      else if (w === 'a' && !any) { /* "a hundred" */ }
      else if (/^\d+$/.test(w)) { current += parseInt(w, 10); any = true; }
      else return null;
    }
    total += current;
    return any && total > 0 && total < 1000 ? total : null;
  }

  function command(name, extra) {
    const built = BUILD[name] ? BUILD[name]() : { type: name };
    return Object.assign(built, extra || {}, {
      where: WHERE[name] || 'page',
      confirm: !!CONFIRM[name]
    });
  }

  /** One heard phrase to one command, or null when it is not a command. */
  function parse(heard) {
    const said = tidy(heard);
    if (!said) return null;

    if (Object.prototype.hasOwnProperty.call(LOOKUP, said)) return command(LOOKUP[said]);

    // A number on its own, or after click/choose/number: pick that label.
    const pick = /^(?:(?:click|press|choose|select|pick|tap|open)(?: on)? )?(?:number )?(.+)$/.exec(said);
    if (pick) {
      const bare = pick[1] === said || /^number /.test(said);
      const n = toNumber(pick[1], bare);
      if (n !== null) return command('pick', { n: n });
    }

    let m = /^(?:type|write|enter text) (.+)$/.exec(said);
    if (m) {
      // The words as spoken, not tidied: capitals and punctuation are theirs.
      const raw = String(heard).trim().replace(/^\s*(type|write|enter text)\s+/i, '');
      return command('type', { text: raw });
    }

    m = /^(?:search for|search|google|look up) (.+)$/.exec(said);
    if (m) return command('search', { query: m[1] });

    m = /^(?:click|press|choose|select|tap|open|go to)(?: on)?(?: the)? (.+)$/.exec(said);
    if (m && m[1].length > 1) return command('click', { name: m[1] });

    return null;
  }

  /**
   * The recogniser offers a few guesses at each phrase. The first that makes
   * a command wins, so "scroll dawn" still scrolls when its second guess was
   * right.
   */
  function parseAlternatives(alternatives) {
    const list = Array.isArray(alternatives) ? alternatives : [alternatives];
    for (const alt of list) {
      const text = alt && typeof alt === 'object' ? alt.transcript : alt;
      const cmd = parse(text);
      if (cmd) return Object.assign(cmd, { heard: tidy(text) });
    }
    return null;
  }

  /** What to show under "What can I say", grouped. */
  const HELP = [
    { group: 'Clicking', items: [
      ['show numbers', 'Number everything you can click. The numbers stay on'],
      ['12  (or click 12)', 'Click number 12'],
      ['click Contact', 'Click something by its name'],
      ['no numbers', 'Turn the numbers off'],
      ['close pop up', 'Close a pop-up or notice in the way']
    ] },
    { group: 'Moving around', items: [
      ['scroll down / scroll up', 'A third of the screen'],
      ['page down / page up', 'Most of a screen'],
      ['keep scrolling, then stop', 'Scroll until you say stop'],
      ['top / bottom', 'Either end of the page'],
      ['next heading / previous heading', 'Jump between sections']
    ] },
    { group: 'Typing', items: [
      ['text box', 'Go to the first text box'],
      ['type hello there', 'Type those words'],
      ['next field', 'Move to the next box'],
      ['undo', 'Take back what was typed'],
      ['submit', 'Send the form (asks first)']
    ] },
    { group: 'The browser', items: [
      ['go back / go forward / reload', 'Like the browser buttons'],
      ['search for bus times', 'Search in a new tab'],
      ['new tab / next tab / previous tab', 'Tabs'],
      ['close tab', 'Close this tab (asks first)']
    ] },
    { group: 'Voice control', items: [
      ['pause / resume', 'Stop acting on commands, and start again'],
      ['go to sleep / wake up', 'The same as pause and resume'],
      ['what can I say', 'Show this list']
    ] }
  ];

  const VoiceCommands = { parse, parseAlternatives, tidy, toNumber, PHRASES, HELP };

  if (typeof module !== 'undefined' && module.exports) module.exports = VoiceCommands;
  if (root) root.AccessiFlowVoiceCommands = VoiceCommands;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
