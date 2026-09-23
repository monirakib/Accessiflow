// AccessiFlow keyboard shortcuts
//
// Every key AccessiFlow answers to, written once. The popup's Help, the end
// of the setup page and Alt+Shift+9 all read from here, so the lists cannot
// drift apart. test/popup.test.js checks that every Alt+Shift key handled in
// content.js and every command in the manifest is in this list.
//
//   keys    as written on screen
//   what    what it does, in plain words
//   main    one of the few keys worth learning first; read by Alt+Shift+9
//   letter / digit / command   what the completeness test matches against
'use strict';

(function (root) {
  root.ACCESSIFLOW_SHORTCUTS = [
    { keys: 'Alt+Shift+Q', what: 'Open the AccessiFlow panel', main: true, command: '_execute_action' },
    { keys: 'Alt+Shift+R', what: 'Read this page aloud', main: true, letter: 'R' },
    { keys: 'Alt+Shift+B', what: 'Summarise this page, out loud', main: true, letter: 'B' },
    { keys: 'Ctrl', what: 'Stop reading, while something is being read', main: true },
    { keys: 'Shift', what: 'Pause reading, and press again to carry on from the same place', main: true },
    { keys: 'Alt+Shift+S', what: 'Stop reading', letter: 'S' },
    { keys: 'Alt+Shift+Z', what: 'Built-in screen reader on or off, for every site', main: true, letter: 'Z' },
    { keys: 'Alt+Shift+D', what: 'Describe the picture you are on, out loud', main: true, letter: 'D' },
    { keys: 'Alt+Shift+8', what: 'Pause AccessiFlow on this site, or turn it back on', main: true, digit: '8' },
    { keys: 'Alt+Shift+9', what: 'Hear the main keys', digit: '9' },
    { keys: 'Alt+Shift+1 to 7', what: 'Add a need to your setup: 1 low vision, 2 screen reader, 3 hand movement, 4 reading support, 5 focus, 6 seizure safety, 7 easier all round', digit: '1-7' },
    { keys: 'Alt+Shift+A', what: 'Turn AccessiFlow off or on for this page, until it reloads', command: 'toggle-accessiflow' },
    { keys: 'Alt+Shift+W', what: 'Start or stop live captions for this tab', command: 'toggle-captions' },
    { keys: 'Alt+Shift+X', what: 'Open voice control, to use pages by speaking', command: 'open-voice-control' },
    { keys: 'Alt+Shift+V', what: 'Dictate into the box you are in', letter: 'V' },
    { keys: 'Alt+Shift+E', what: 'Keyboard-only mode on or off', letter: 'E' },
    { keys: 'Alt+Shift+C', what: 'High contrast on or off', letter: 'C' },
    { keys: 'Alt+Shift+F', what: 'The ring that shows where the keyboard is, on or off', letter: 'F' },
    { keys: 'Alt+Shift+T', what: 'Large pointer on or off', letter: 'T' },
    { keys: 'Alt+Shift+M', what: 'Reading lens on or off', letter: 'M' },
    { keys: 'Alt+Shift+K', what: 'Hold the reading lens still, or let it follow again' },
    { keys: 'Alt+Shift+H', what: 'List the headings on this page' },
    { keys: 'Alt+Shift+L', what: 'List the main areas of this page' },
    { keys: 'Alt+Shift+U', what: 'Let the keyboard out of a pop-up', letter: 'U' },
    { keys: 'Alt+Shift+P', what: 'Rewrite this page in plain language', letter: 'P' },
    { keys: 'Alt+Shift+O', what: 'Bring back the original text', letter: 'O' },
    { keys: 'Alt+Shift+G', what: 'Hear what a form will ask for, before you start', letter: 'G' },
    { keys: 'Arrow keys', what: 'With the built-in screen reader on: read line by line, on websites and in AccessiFlow itself' },
    { keys: 'H', what: 'With the built-in screen reader on: next heading. K link, B button, F form field, X check box, D landmark, and Shift goes back, as in NVDA' },
    { keys: 'Insert+Down', what: 'With the built-in screen reader on: read everything from here' },
    { keys: 'Insert+H', what: 'With the built-in screen reader on: hear all of its keys' }
  ];

  // How a key is said aloud: "Alt Shift R", not "Alt plus Shift plus R".
  root.ACCESSIFLOW_SHORTCUTS.forEach(s => {
    s.spoken = s.keys.replace(/\+/g, ' ') + ', ' + s.what;
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
