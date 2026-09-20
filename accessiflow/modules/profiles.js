// AccessiFlow profiles
//
// One bundle of settings per disability, shared by the popup and the page.
//
// These live here rather than in popup-schema.js because someone who cannot
// see the screen cannot open a panel and hunt for the right switch. The page
// itself has to be able to turn a whole profile on from a keypress, so the
// content script needs the same list the popup renders. `key` is the digit in
// Alt+Shift+<digit> that applies it.
'use strict';

(function (root) {
  root.ACCESSIFLOW_PROFILES = [
    {
      id: 'visual', key: '1',
      icon: 'eye',
      label: 'Low vision',
      desc: 'Bigger text, stronger colours, clearer links.',
      settings: {
        highContrast: true, textSize: 130, lineHeight: 1.7,
        dyslexiaFont: true, highlightLinks: true, enhancedFocus: true
      }
    },
    {
      id: 'blind', key: '2',
      icon: 'sound',
      label: 'Screen reader',
      desc: 'Repairs labels and landmarks, reads selected text.',
      settings: { blindMode: true, ttsReadOnSelect: true, speakImageDescriptions: true }
    },
    {
      id: 'motor', key: '3',
      icon: 'hand',
      label: 'Hand movement',
      desc: 'Bigger buttons, larger pointer, steadier clicks.',
      settings: {
        largeCursor: true, cursorSize: 2.5, bigTargets: true,
        enhancedFocus: true, stopAnimations: true, tremorFilter: true
      }
    },
    {
      id: 'cognitive', key: '4',
      icon: 'book',
      label: 'Reading support',
      desc: 'Simpler pages, wider spacing, a line to follow.',
      settings: {
        readingMask: true, lineHeight: 1.8, letterSpacing: 2,
        simplifyPage: true, lineRuler: true, dyslexiaFont: true
      }
    },
    {
      id: 'adhd', key: '5',
      icon: 'focus',
      label: 'Focus',
      desc: 'Fewer distractions, break reminders, progress bar.',
      settings: {
        focusTimer: true, distractionFree: true, readingProgress: true,
        reduceClutter: true, breakTimer: true
      }
    },
    {
      id: 'seizure', key: '6',
      icon: 'shield',
      label: 'Seizure safety',
      desc: 'Stops flashing, motion and autoplaying video.',
      settings: {
        flashDetection: true, reduceMotion: true, staticGifs: true,
        disableAutoplay: true, stopAnimations: true
      }
    },
    {
      id: 'senior', key: '7',
      icon: 'person',
      label: 'Easier all round',
      desc: 'Larger everything, with clear focus and links.',
      settings: {
        textSize: 140, lineHeight: 2.0, largeCursor: true,
        bigTargets: true, enhancedFocus: true, highlightLinks: true
      }
    }
  ];
})(typeof globalThis !== 'undefined' ? globalThis : self);
