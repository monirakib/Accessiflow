// AccessiFlow profiles
//
// One bundle of settings per need, shared by the popup, the setup page and
// the page itself.
//
// These live here rather than in popup-schema.js because someone who cannot
// see the screen cannot open a panel and hunt for the right switch. The page
// itself has to be able to turn a whole profile on from a keypress, so the
// content script needs the same list the popup renders. `key` is the digit in
// Alt+Shift+<digit> that adds it; the setup page uses the same digits, so a
// number learned there works everywhere.
//
//   need      how the setup page asks about it, in the user's own terms
//   settings  what it turns on
//   home      the settings the popup's home screen shows for this need, most
//             useful first. Everything else stays under "All settings".
'use strict';

(function (root) {
  root.ACCESSIFLOW_PROFILES = [
    {
      id: 'visual', key: '1',
      icon: 'eye',
      label: 'Low vision',
      need: 'Low vision',
      desc: 'Bigger text, stronger colours, clearer links.',
      settings: {
        highContrast: true, textSize: 130, lineHeight: 1.7,
        dyslexiaFont: true, highlightLinks: true, focusHalo: true
      },
      home: ['textSize', 'highContrast', 'smartDarkMode', 'magnifier', 'highlightLinks']
    },
    {
      id: 'blind', key: '2',
      icon: 'sound',
      label: 'Screen reader',
      need: 'Blind, or I use a screen reader',
      desc: 'Repairs labels and landmarks, reads selected text.',
      settings: {
        blindMode: true, ttsReadOnSelect: true, speakImageDescriptions: true,
        ttsReadOnHover: true, ttsReadOnFocus: true, focusLock: true
      },
      home: ['screenReader', 'keyEcho', 'ttsRate', 'speakImageDescriptions', 'blindMode']
    },
    {
      id: 'motor', key: '3',
      icon: 'hand',
      label: 'Hand movement',
      need: 'Hand movement or tremor',
      desc: 'Bigger buttons, steadier clicks, and near misses still land.',
      settings: {
        largeCursor: true, cursorSize: 2.5, bigTargets: true,
        focusHalo: true, stopAnimations: true, tremorFilter: true,
        clickSnapping: true, focusLock: true, speechToText: true
      },
      home: ['bigTargets', 'keyboardOnly', 'clickSnapping', 'largeCursor', 'tremorFilter']
    },
    {
      id: 'cognitive', key: '4',
      icon: 'book',
      label: 'Reading support',
      need: 'Reading, dyslexia or memory',
      desc: 'Simpler pages, wider spacing, a line to follow.',
      settings: {
        readingMask: true, lineHeight: 1.8, letterSpacing: 2,
        simplifyPage: true, lineRuler: true, dyslexiaFont: true
      },
      home: ['readingMask', 'dyslexiaFont', 'simplifyPage', 'lineHeight', 'dictionary']
    },
    {
      id: 'adhd', key: '5',
      icon: 'focus',
      label: 'Focus',
      need: 'Focus, attention or sensory overload',
      desc: 'Fewer distractions, break reminders, progress bar.',
      settings: {
        focusTimer: true, distractionFree: true, readingProgress: true,
        reduceClutter: true, breakTimer: true
      },
      home: ['distractionFree', 'reduceClutter', 'lowStimulation', 'focusTimer', 'readingProgress']
    },
    {
      id: 'seizure', key: '6',
      icon: 'shield',
      label: 'Seizure safety',
      need: 'Seizures or motion sickness',
      desc: 'Stops flashing, motion and autoplaying video.',
      settings: {
        flashDetection: true, reduceMotion: true, staticGifs: true,
        disableAutoplay: true, stopAnimations: true
      },
      home: ['flashDetection', 'motionInterceptor', 'disableAutoplay', 'reduceMotion']
    },
    {
      id: 'senior', key: '7',
      icon: 'person',
      label: 'Easier all round',
      need: 'Easier all round',
      desc: 'Larger everything, with clear focus and links.',
      settings: {
        textSize: 140, lineHeight: 2.0, largeCursor: true,
        bigTargets: true, focusHalo: true, highlightLinks: true,
        clickSnapping: true
      },
      home: ['textSize', 'bigTargets', 'largeCursor', 'highlightLinks']
    },
    {
      id: 'hearing',
      icon: 'ear',
      label: 'Hearing',
      need: 'Deaf or hard of hearing',
      desc: 'Subtitles on and readable, and sounds shown on screen.',
      settings: {
        closedCaptions: true, captionStyling: true, visualAlerts: true
      },
      home: ['closedCaptions', 'visualAlerts', 'captionFontSize', 'liveTranscription']
    },
    {
      id: 'speaking',
      icon: 'chat',
      label: 'Speaking and typing',
      need: 'Difficulty speaking or typing',
      desc: 'Fill in boxes by speaking, and have what you type said aloud.',
      settings: {
        speechToText: true, textInputBar: true
      },
      home: ['speechToText', 'textInputBar', 'quickResponses', 'aacBoard']
    }
  ];

  // What the home screen shows before any setup: one thing for each of the
  // commonest needs, so the first open is never an empty screen.
  root.ACCESSIFLOW_HOME_DEFAULT = ['textSize', 'screenReader', 'smartDarkMode', 'readingMask', 'bigTargets', 'keyEcho'];
})(typeof globalThis !== 'undefined' ? globalThis : self);
