// AccessiFlow settings catalogue
//
// Every control in the popup is described once, here. popup.js renders this
// into accessible markup, so a setting cannot drift out of sync with its
// label, its description, or the search index.
//
// Writing rules for this file:
//   • `label` is what the user reads. Plain words, no jargon, sentence case.
//   • `desc` says what will visibly change, in one short sentence. WCAG 2.2
//     criterion 3.1.5 (Reading Level) applies to our own interface too.
//   • `wcag` is the criterion the setting helps satisfy. Shown on request,
//     never in the accessible name, because it is noise to someone who just
//     wants bigger text.
//   • `keywords` widens search beyond the label, so a user typing the
//     clinical term ("dyslexia", "tremor") still finds the plain-language row.
'use strict';

const SCHEMA = {
  /**
   * Preset bundles on the home panel, from modules/profiles.js so the page
   * can apply the same bundles from a keyboard shortcut.
   */
  profiles: (typeof globalThis !== 'undefined' && globalThis.ACCESSIFLOW_PROFILES) || [],

  /**
   * Disability types the user can filter by. Each one names the setting
   * sections that help with it, most useful first, and the popup shows only
   * those. Nine sections is a lot to read through when three of them matter
   * to you, so this is the difference between finding a setting and giving up.
   * Every section id below must exist in `sections`, and between them these
   * lists must cover all of them, or a setting becomes unreachable.
   */
  audiences: [
    {
      id: 'blind', icon: 'sound',
      label: 'Blind, or using a screen reader',
      sections: ['listening', 'reading', 'moving']
    },
    {
      id: 'lowvision', icon: 'eye',
      label: 'Low vision',
      sections: ['seeing', 'moving', 'reading']
    },
    {
      id: 'motor', icon: 'hand',
      label: 'Hand movement or tremor',
      sections: ['moving', 'speaking']
    },
    {
      id: 'cognitive', icon: 'book',
      label: 'Dyslexia, reading or memory',
      sections: ['reading', 'seeing', 'calm']
    },
    {
      id: 'attention', icon: 'focus',
      label: 'Attention and focus',
      sections: ['calm', 'reading']
    },
    {
      id: 'hearing', icon: 'ear',
      label: 'Deaf or hard of hearing',
      sections: ['hearing', 'reading']
    },
    {
      id: 'speech', icon: 'chat',
      label: 'Difficulty speaking or typing',
      sections: ['speaking', 'listening']
    },
    {
      id: 'seizure', icon: 'shield',
      label: 'Seizures or motion sickness',
      sections: ['safety', 'seeing', 'calm']
    },
    {
      id: 'autism', icon: 'focus',
      label: 'Autism or sensory sensitivity',
      sections: ['calm', 'reading', 'seeing']
    },
    {
      id: 'senior', icon: 'person',
      label: 'Ageing, or easier all round',
      sections: ['seeing', 'moving', 'reading']
    },
    {
      id: 'bangla', icon: 'globe',
      label: 'Reading in Bangla',
      sections: ['bangla', 'seeing', 'reading']
    }
  ],

  /**
   * Search terms for the panels written directly in popup.html. Their own
   * heading, description and button text are searched as well; these add the
   * words people type when they do not know what we called it ("ai",
   * "alt text", "summary"). Keys are the panel's section id.
   */
  panels: {
    'section-profiles': 'profile profiles preset presets quick setup bundle start turn off disable everything',
    'section-ai': 'ai artificial intelligence smart help alt text image images picture pictures photo photos describe description caption summary summarise summarize explain overview what is this page about link links vague confusing click here rename button buttons unlabelled unnamed icon heal repair automatic plain language simple simplify simpler rewrite easy read jargon tldr key points bullets form forms fields documents need ready prepare',
    'section-audit': 'audit check checker test score wcag report scan problems issues errors how accessible',
    'section-data': 'save load export import backup file json settings reset start again clear forget'
  },

  /** Collapsible sections, rendered in this order. */
  sections: [
    {
      id: 'seeing',
      icon: 'eye',
      label: 'Seeing',
      desc: 'Text size, colour and contrast.',
      controls: [
        { id: 'textSize', type: 'slider', label: 'Text size', desc: 'Make all text on the page bigger or smaller.', min: 80, max: 200, step: 5, default: 100, suffix: '%', wcag: '1.4.4', keywords: 'zoom bigger larger font enlarge' },
        { id: 'lineHeight', type: 'slider', label: 'Space between lines', desc: 'Add room between each line of text.', min: 1, max: 2.5, step: 0.1, default: 1.5, suffix: '', wcag: '1.4.12', keywords: 'leading spacing crowded' },
        { id: 'letterSpacing', type: 'slider', label: 'Space between letters', desc: 'Pull letters apart so words are easier to tell apart.', min: 0, max: 10, step: 0.5, default: 0, suffix: 'px', wcag: '1.4.12', keywords: 'tracking dyslexia crowded' },
        { id: 'wordSpacing', type: 'slider', label: 'Space between words', desc: 'Add room between words.', min: 0, max: 20, step: 1, default: 0, suffix: 'px', wcag: '1.4.12', keywords: 'gap spacing' },
        { id: 'saturation', type: 'slider', label: 'Colour strength', desc: 'Make colours stronger or fade them towards grey.', min: 0, max: 200, step: 10, default: 100, suffix: '%', wcag: '1.4.1', keywords: 'saturation vivid grey greyscale' },
        { id: 'iconScaling', type: 'slider', label: 'Icon size', desc: 'Make small icons and symbols larger.', min: 1, max: 3, step: 0.25, default: 1, suffix: '×', wcag: '1.4.4', keywords: 'symbols bigger' },
        { id: 'fontFamily', type: 'select', label: 'Typeface', desc: 'Change the shape of the letters.', default: '', wcag: '1.4.8', keywords: 'font dyslexia opendyslexic arial', options: [
          { value: '', label: 'Keep the site’s own' },
          { value: 'OpenDyslexic', label: 'OpenDyslexic (for dyslexia)' },
          { value: 'Arial', label: 'Arial (plain)' },
          { value: 'Verdana', label: 'Verdana (wide)' },
          { value: 'Tahoma', label: 'Tahoma (narrow)' },
          { value: 'Georgia', label: 'Georgia (serif)' },
          { value: 'Courier New', label: 'Courier New (fixed width)' }
        ] },
        { id: 'textAlign', type: 'select', label: 'Text alignment', desc: 'Line text up to one side. Left is easiest for most readers.', default: 'default', wcag: '1.4.8', keywords: 'justify centre ragged', options: [
          { value: 'default', label: 'Keep the site’s own' },
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Centre' },
          { value: 'right', label: 'Right' },
          { value: 'justify', label: 'Both edges' }
        ] },
        { id: 'colorFilter', type: 'select', label: 'Colour blindness filter', desc: 'Shift colours so they are easier to tell apart.', default: 'none', wcag: '1.4.1', keywords: 'colour blind daltonism protanopia deuteranopia tritanopia', options: [
          { value: 'none', label: 'Off' },
          { value: 'protanopia', label: 'Red-blind (protanopia)' },
          { value: 'deuteranopia', label: 'Green-blind (deuteranopia)' },
          { value: 'tritanopia', label: 'Blue-blind (tritanopia)' },
          { value: 'achromatopsia', label: 'No colour (achromatopsia)' }
        ] },
        { id: 'smartDarkMode', type: 'switch', label: 'Smart dark mode', desc: 'Turn the page dark without spoiling photos, charts or codes, and keep every piece of text readable.', wcag: '1.4.3', keywords: 'dark night glare dim smart safe contrast readable photos charts barcode qr images invert better' },
        { id: 'smartDarkContrast', type: 'slider', label: 'Text readability', desc: 'The lowest contrast any text is allowed to have. Higher is easier to read.', min: 4.5, max: 7, step: 0.5, default: 4.5, suffix: ':1', wcag: '1.4.3', keywords: 'contrast ratio aa aaa readable', dependsOn: 'smartDarkMode' },
        { id: 'smartDarkStrength', type: 'slider', label: 'How dark', desc: 'How deep the background goes. Lower keeps more of the page’s own shading.', min: 1, max: 10, step: 1, default: 5, suffix: '', wcag: '1.4.8', keywords: 'darkness level depth black', dependsOn: 'smartDarkMode' },
        { id: 'highContrast', type: 'switch', label: 'High contrast', desc: 'Force a strong light-on-dark colour scheme.', wcag: '1.4.6', keywords: 'contrast bold visible' },
        { id: 'darkMode', type: 'switch', label: 'Dark background', desc: 'Turn bright pages dark to reduce glare. Simpler than smart dark mode, and harder on images.', wcag: '1.4.8', keywords: 'night glare dim', conflictsWith: ['smartDarkMode'] },
        { id: 'invertColors', type: 'switch', label: 'Invert colours', desc: 'Flip every colour to its opposite.', wcag: '1.4.8', keywords: 'negative reverse', conflictsWith: ['smartDarkMode'] },
        { id: 'dyslexiaFont', type: 'switch', label: 'Dyslexia-friendly text', desc: 'Use weighted letters that are harder to flip or confuse.', wcag: '1.4.8', keywords: 'dyslexia opendyslexic reading' },
        { id: 'highlightLinks', type: 'switch', label: 'Highlight links', desc: 'Give every link a strong colour and underline.', wcag: '1.4.1', keywords: 'underline visible anchors' },
        { id: 'hideImages', type: 'switch', label: 'Hide images', desc: 'Remove pictures and leave only the text.', wcag: '1.4.8', keywords: 'pictures declutter text only' },
        { id: 'readingGuide', type: 'switch', label: 'Reading guide', desc: 'Show a band under your pointer to keep your place.', wcag: '2.4.8', keywords: 'ruler track place', conflictsWith: ['readingMask'] },
        { id: 'focusMode', type: 'switch', label: 'Dim everything else', desc: 'Darken the page except the part you are reading.', wcag: '2.4.8', keywords: 'spotlight dim concentrate' },
        { id: 'magnifier', type: 'switch', label: 'Magnifier', desc: 'Show a zoomed circle that follows your pointer.', wcag: '1.4.4', keywords: 'zoom loupe enlarge' },
        { id: 'magnifierZoom', type: 'slider', label: 'Magnifier strength', desc: 'How much the magnifier zooms in.', min: 1.5, max: 5, step: 0.5, default: 2, suffix: '×', wcag: '1.4.4', keywords: 'zoom level', dependsOn: 'magnifier' },
        { id: 'bionicReading', type: 'switch', label: 'Bold word starts', desc: 'Thicken the first letters of each word to speed up reading.', wcag: '1.4.8', keywords: 'bionic fixation skim' },
        { id: 'lineNumbering', type: 'switch', label: 'Number the lines', desc: 'Put a number beside each paragraph so you can find it again.', wcag: '2.4.8', keywords: 'numbers reference place' }
      ]
    },

    {
      id: 'reading',
      icon: 'book',
      label: 'Reading and understanding',
      desc: 'Simpler pages, fewer distractions, memory help.',
      controls: [
        { id: 'simplifyPage', type: 'switch', label: 'Simplify the page', desc: 'Strip the page back to its headings and text.', wcag: '3.1.5', keywords: 'reader mode declutter clean plain' },
        { id: 'distractionFree', type: 'switch', label: 'Hide distractions', desc: 'Remove ads, pop-ups and sidebars.', wcag: '2.2.4', keywords: 'ads popups banners clutter' },
        { id: 'readingMask', type: 'switch', label: 'Reading lens', desc: 'Darken the page except the line you are reading. The lens follows the text itself, not just the pointer. Alt+Shift+K holds it still.', wcag: '2.4.8', keywords: 'focus band strip mask lens dim spotlight darken concentrate line place lose my place dyslexia' },
        { id: 'maskMode', type: 'select', label: 'How much to show', desc: 'How much text the lens uncovers at once.', default: 'line', wcag: '2.4.8', keywords: 'line sentence paragraph amount size', dependsOn: 'readingMask', options: [
          { value: 'line', label: 'One line' },
          { value: 'sentence', label: 'One sentence' },
          { value: 'paragraph', label: 'One paragraph' },
          { value: 'band', label: 'A fixed strip' }
        ] },
        { id: 'maskDim', type: 'slider', label: 'How dark the rest goes', desc: 'How much the rest of the page is dimmed.', min: 0.3, max: 0.95, step: 0.05, default: 0.75, suffix: '', wcag: '2.4.8', keywords: 'dim darkness opacity shade', dependsOn: 'readingMask' },
        { id: 'maskTint', type: 'select', label: 'Dimming colour', desc: 'A warm or cool shade can be easier on the eyes than plain black.', default: 'black', wcag: '1.4.8', keywords: 'tint colour warm cool black overlay irlen scotopic', dependsOn: 'readingMask', options: [
          { value: 'black', label: 'Black' },
          { value: 'warm', label: 'Warm' },
          { value: 'cool', label: 'Cool' }
        ] },
        { id: 'lineRuler', type: 'switch', label: 'Line ruler', desc: 'Show a straight line to read along.', wcag: '2.4.8', keywords: 'guide track straightedge', conflictsWith: ['readingMask'] },
        { id: 'readingProgress', type: 'switch', label: 'Progress bar', desc: 'Show how far through the page you are.', wcag: '2.4.8', keywords: 'scroll position how far' },
        { id: 'showHeadings', type: 'switch', label: 'Outline the headings', desc: 'Mark each heading so the page structure is obvious.', wcag: '2.4.10', keywords: 'structure outline sections' },
        { id: 'altTextTooltips', type: 'switch', label: 'Show image descriptions', desc: 'Display each picture’s description underneath it.', wcag: '1.1.1', keywords: 'alt text captions pictures' },
        { id: 'dictionary', type: 'switch', label: 'Explain hard words', desc: 'Look up a word when you double-click it.', wcag: '3.1.3', keywords: 'definition meaning vocabulary' },
        { id: 'pauseMedia', type: 'switch', label: 'Pause moving content', desc: 'Stop sliders and carousels from moving on their own.', wcag: '2.2.2', keywords: 'carousel slider autoplay stop' },
        { id: 'formBriefs', type: 'switch', label: 'Tell me what a form needs first', desc: 'When you start a long form, say what it will ask for, such as documents or ID numbers. Only the form\u2019s own labels are sent to Smart help, never what you type. Alt+Shift+G asks at any time.', wcag: '3.3.2', keywords: 'form forms prepare documents need ready before start summary fields what will it ask id number routing ai', defaultOn: true },
        { id: 'formSteps', type: 'switch', label: 'One question at a time', desc: 'Break long forms into single steps.', wcag: '3.3.2', keywords: 'forms wizard steps long' },
        { id: 'activeFieldHighlight', type: 'switch', label: 'Highlight the current box', desc: 'Make the form field you are typing in stand out.', wcag: '2.4.11', keywords: 'form input focus where am i' },
        { id: 'memoryAid', type: 'switch', label: 'Remember what I filled in', desc: 'Keep a note of what you typed in case the page reloads.', wcag: '3.3.7', keywords: 'redundant entry autofill remember' },
        { id: 'breakTimer', type: 'switch', label: 'Remind me to rest', desc: 'Nudge you to take a break at a set interval.', wcag: '2.2.1', keywords: 'break rest pause timer fatigue' },
        { id: 'breakTimerMinutes', type: 'slider', label: 'Rest reminder every', desc: 'Minutes between rest reminders.', min: 5, max: 60, step: 5, default: 20, suffix: ' min', wcag: '2.2.1', keywords: 'interval minutes', dependsOn: 'breakTimer' }
      ]
    },

    {
      id: 'moving',
      icon: 'hand',
      label: 'Moving and clicking',
      desc: 'Bigger targets, steadier pointer, keyboard control.',
      controls: [
        { id: 'bigTargets', type: 'switch', label: 'Bigger buttons and links', desc: 'Grow everything clickable to at least 44 pixels.', wcag: '2.5.8', keywords: 'target size tap hit area small' },
        { id: 'largeCursor', type: 'switch', label: 'Large pointer', desc: 'Replace the mouse pointer with a much bigger one.', wcag: '2.5.8', keywords: 'cursor mouse big find' },
        { id: 'cursorSize', type: 'slider', label: 'Pointer size', desc: 'How big the large pointer is.', min: 1.5, max: 4, step: 0.5, default: 2, suffix: '×', wcag: '2.5.8', keywords: 'cursor scale', dependsOn: 'largeCursor' },
        { id: 'focusLock', type: 'switch', label: 'Keep the keyboard inside pop-ups', desc: 'When a pop-up opens, move the keyboard into it and stop Tab wandering off behind it. Alt+Shift+U lets you out.', wcag: '2.4.3', keywords: 'modal dialog popup trap focus keyboard tab escapes behind stuck lightbox overlay cookie', defaultOn: true },
        { id: 'focusHalo', type: 'switch', label: 'Show me where the keyboard is', desc: 'Draw a bright ring around the current item, with a note of which key activates it. Works even where a normal outline gets cut off.', wcag: '2.4.11', keywords: 'keyboard outline ring where am i tab focus halo highlight lost which key shortcut' },
        { id: 'focusHaloPulse', type: 'switch', label: 'Make the ring pulse', desc: 'Fade the ring in and out so it catches the eye. Turns itself off when you have asked for less motion.', wcag: '2.4.11', keywords: 'pulse flash animate blink attention', defaultOn: true, dependsOn: 'focusHalo' },
        { id: 'focusHaloTooltip', type: 'switch', label: 'Show the key to press', desc: 'Name the current item and the key that activates it.', wcag: '2.4.6', keywords: 'tooltip hint key enter space which button label', defaultOn: true, dependsOn: 'focusHalo' },
        { id: 'focusHaloSize', type: 'slider', label: 'Ring thickness', desc: 'How heavy the ring around the current item is.', min: 2, max: 10, step: 1, default: 4, suffix: 'px', wcag: '2.4.11', keywords: 'thick bold width', dependsOn: 'focusHalo' },
        { id: 'enhancedFocus', type: 'switch', label: 'Strong focus outline', desc: 'Draw a thick ring around whatever the keyboard is on. The simpler version of the setting above.', wcag: '2.4.11', keywords: 'keyboard outline ring where am i tab', conflictsWith: ['focusHalo'] },
        { id: 'tremorFilter', type: 'switch', label: 'Steady my clicks', desc: 'Ignore small shakes so one click stays one click.', wcag: '2.5.1', keywords: 'tremor shake parkinson steady double' },
        { id: 'tremorInterval', type: 'slider', label: 'Ignore repeats within', desc: 'How close together two clicks have to be before the second is treated as a shake.', min: 100, max: 1000, step: 50, default: 300, suffix: 'ms', wcag: '2.5.1', keywords: 'tremor timing window debounce speed', dependsOn: 'tremorFilter' },
        { id: 'clickSnapping', type: 'switch', label: 'Pull my clicks onto buttons', desc: 'Mark the nearest button or link and send your click there, so a near miss still counts.', wcag: '2.5.8', keywords: 'miss accuracy near snap magnet tremor shake aim target forgiving clicks off' },
        { id: 'clickSnapRadius', type: 'slider', label: 'How far a click can miss', desc: 'How far from a button a click can land and still reach it.', min: 8, max: 120, step: 4, default: 28, suffix: 'px', wcag: '2.5.8', keywords: 'snap distance radius tolerance', dependsOn: 'clickSnapping' },
        { id: 'dwellClick', type: 'switch', label: 'Click by hovering', desc: 'Click by resting the pointer still, with no button press.', wcag: '2.5.1', keywords: 'dwell hover hands free head mouse eye' },
        { id: 'dwellClickDelay', type: 'slider', label: 'Hold still for', desc: 'How long to rest before a hover becomes a click.', min: 400, max: 3000, step: 100, default: 1000, suffix: 'ms', wcag: '2.5.1', keywords: 'dwell delay timing', dependsOn: 'dwellClick' },
        { id: 'stickyHover', type: 'switch', label: 'Hold menu colours', desc: 'Keep a menu item looking highlighted after the pointer leaves it. It cannot stop the site closing its own menus.', wcag: '1.4.13', keywords: 'menu dropdown closes too fast hover highlight' },
        { id: 'keyboardOnly', type: 'switch', label: 'Keyboard-only mode', desc: 'Use pages without a mouse, one key at a time. F labels everything you can click, J and K scroll, and a guide in the corner lists every key. Alt+Shift+E turns it on and off.', wcag: '2.1.1', keywords: 'keyboard only no mouse without mouse keys shortcuts navigate navigation hints labels click vimium legend guide hand arthritis rsi tremor one hand single key tab' },
        { id: 'edgeScrolling', type: 'switch', label: 'Scroll at the edges', desc: 'Scroll the page by moving the pointer to its edge.', wcag: '2.5.1', keywords: 'scroll wheel drag' },
        { id: 'stopAnimations', type: 'switch', label: 'Stop animations', desc: 'Freeze anything that moves on its own.', wcag: '2.3.3', keywords: 'motion movement still reduce' }
      ],
      // Voice control is not a per-site switch: it is a panel beside every
      // site, opened once, and listening until it is closed.
      actions: [
        { id: 'btnVoiceControl', label: 'Start voice control (no mouse or keyboard)', style: 'primary',
          keywords: 'voice control commands speak speech talk microphone hands free no hands dictate click by voice say' }
      ]
    },

    {
      id: 'listening',
      icon: 'sound',
      label: 'Having pages read aloud',
      desc: 'Text to speech, and repairs for screen readers.',
      controls: [
        { id: 'screenReader', type: 'switch', label: 'Built-in screen reader', desc: 'Read and move through pages with the keyboard, like NVDA. Arrow keys read, H jumps to headings, K to links, Insert+H lists every key. On for every website. Alt+Shift+Z turns it on and off.', wcag: '4.1.2', global: true, keywords: 'screen reader nvda jaws voiceover blind browse mode focus mode arrow keys headings links landmarks read aloud speak navigate virtual cursor say all' },
        { id: 'srVerbosity', type: 'select', label: 'How much the screen reader says', desc: 'Low reads just the text and controls. Normal also says when you enter a list, table or landmark. High adds each list item\'s position.', default: 'normal', wcag: '4.1.2', keywords: 'screen reader verbosity detail chatty quiet brief landmarks lists tables', dependsOn: 'screenReader', options: [
          { value: 'low', label: 'Low' },
          { value: 'normal', label: 'Normal' },
          { value: 'high', label: 'High' }
        ] },
        { id: 'srPunctuation', type: 'select', label: 'Punctuation read out', desc: 'All names every symbol, for checking an email address or a price.', default: 'some', wcag: '4.1.2', keywords: 'screen reader punctuation symbols comma dot at sign read out spell', dependsOn: 'screenReader', options: [
          { value: 'none', label: 'None' },
          { value: 'some', label: 'Some' },
          { value: 'all', label: 'All' }
        ] },
        { id: 'srSpeechViewer', type: 'switch', label: 'Show what the screen reader says', desc: 'A caption box in the corner, for anyone helping or testing.', wcag: '4.1.2', keywords: 'speech viewer caption screen reader helper sighted test', dependsOn: 'screenReader' },
        { id: 'blindMode', type: 'switch', label: 'Screen reader repairs', desc: 'Quietly fix missing labels, landmarks and tab order.', wcag: '4.1.2', keywords: 'screen reader nvda jaws voiceover aria labels', defaultOn: true },
        { id: 'aiAutoHeal', type: 'switch', label: 'Name unlabelled buttons with AI', desc: 'Where the repairs above cannot name a button, ask Smart help. Runs by itself only once you have agreed to automatic fixes in Smart help.', wcag: '4.1.2', keywords: 'ai button buttons unlabelled unnamed icon name label heal automatic screen reader', defaultOn: true, dependsOn: 'blindMode' },
        { id: 'ttsReadOnSelect', type: 'switch', label: 'Read what I select', desc: 'Speak any text as soon as you highlight it.', wcag: '1.4.5', keywords: 'speak aloud selection highlight voice' },
        { id: 'ttsReadOnHover', type: 'switch', label: 'Read what I point at', desc: 'Say what each button, link or piece of text is as you point at it.', wcag: '1.4.5', keywords: 'hover mouse point read aloud speak screen reader nvda buttons labels' },
        { id: 'hoverReadDelay', type: 'slider', label: 'Wait before speaking', desc: 'How long to rest on something before it is read out.', min: 150, max: 1500, step: 50, default: 400, suffix: 'ms', wcag: '2.2.1', keywords: 'hover delay dwell wait pause', dependsOn: 'ttsReadOnHover' },
        { id: 'ttsReadOnFocus', type: 'switch', label: 'Read what I tab to', desc: 'Say each control as the keyboard reaches it.', wcag: '1.4.5', keywords: 'focus keyboard tab read aloud speak screen reader nvda' },
        { id: 'naturalBanglaVoice', type: 'switch', label: 'Natural Bangla voice', desc: 'A clearer, human-sounding Bangla voice instead of the robotic one. Needs a one-time 73 MB download.', wcag: '1.4.5', keywords: 'bangla bengali natural neural human clear quality robotic download voice' },
        { id: 'speakImageDescriptions', type: 'switch', label: 'Describe pictures out loud', desc: 'Tab to a picture and press Enter, or press Alt+Shift+D, to hear what it shows.', wcag: '1.1.1', keywords: 'blind image picture photo describe alt text speak aloud ai what is this read image' },
        { id: 'ttsVoice', type: 'select', label: 'Voice', desc: 'Which voice reads text aloud. Automatic picks one that matches the language on the page.', default: '', wcag: '1.4.5', keywords: 'voice speaker accent bangla bengali language which voice', voices: true, options: [
          { value: '', label: 'Choose automatically' }
        ] },
        { id: 'ttsRate', type: 'slider', label: 'Speaking speed', desc: 'How fast the voice talks.', min: 0.5, max: 2, step: 0.1, default: 1, suffix: '×', wcag: '1.4.5', keywords: 'speed rate fast slow voice' },
        { id: 'ttsPitch', type: 'slider', label: 'Voice pitch', desc: 'How high or low the voice sounds.', min: 0.5, max: 2, step: 0.1, default: 1, suffix: '', wcag: '1.4.5', keywords: 'pitch tone voice' }
      ],
      actions: [
        { id: 'btnTTSRead', label: 'Read this page aloud', style: 'primary' },
        { id: 'btnTTSStop', label: 'Stop reading', style: 'secondary' },
        { id: 'btnDownloadVoice', label: 'Download the natural Bangla voice', style: 'secondary' }
      ]
    },

    {
      id: 'hearing',
      icon: 'ear',
      label: 'Hearing',
      desc: 'Live captions for any tab, and sound turned into something you can see.',
      controls: [
        { id: 'captionFontSize', type: 'slider', label: 'Caption size', desc: 'How big live captions and video subtitles are.', min: 14, max: 48, step: 2, default: 22, suffix: 'px', wcag: '1.4.4', keywords: 'caption subtitle text size bigger larger font' },
        { id: 'captionColor', type: 'select', label: 'Caption colour', desc: 'The colour of caption text.', default: 'white', wcag: '1.4.8', keywords: 'caption subtitle colour color yellow text', options: [
          { value: 'white', label: 'White' },
          { value: 'yellow', label: 'Yellow' },
          { value: 'cyan', label: 'Cyan' },
          { value: 'green', label: 'Green' }
        ] },
        { id: 'captionBg', type: 'select', label: 'Caption backing', desc: 'What sits behind caption text.', default: 'dark', wcag: '1.4.8', keywords: 'caption subtitle background box black', options: [
          { value: 'dark', label: 'Dark, slightly see-through' },
          { value: 'solid', label: 'Solid black' },
          { value: 'blue', label: 'Dark blue' },
          { value: 'clear', label: 'Lighter, shows more of the page' }
        ] },
        { id: 'captionLines', type: 'slider', label: 'Lines of captions', desc: 'How many finished lines stay on screen.', min: 1, max: 6, step: 1, default: 3, suffix: '', wcag: '1.2.4', keywords: 'caption lines history rows' },
        { id: 'closedCaptions', type: 'switch', label: 'Turn video subtitles on', desc: 'Switch on the subtitles that videos already have.', wcag: '1.2.2', keywords: 'subtitles cc video captions track' },
        { id: 'captionStyling', type: 'switch', label: 'Restyle video subtitles', desc: 'Give video subtitles the size and colours above.', wcag: '1.4.8', keywords: 'subtitle size background readable' },
        { id: 'visualAlerts', type: 'switch', label: 'Show where sounds come from', desc: 'A glow at the edge of the screen when the page makes a sound, on the side it came from.', wcag: '1.2.1', keywords: 'notification alert sound beep flash ping chime ripple glow direction visual deaf' },
        { id: 'soundVisualization', type: 'switch', label: 'Show sound levels', desc: 'A meter of how loud the tab is, left and right. Works while live captions are running.', wcag: '1.2.1', keywords: 'waveform meter audio visual level loud' },
        { id: 'liveTranscription', type: 'switch', label: 'Transcribe my microphone', desc: 'Write out what is said near you, using the browser\u2019s speech service. For the sound of a tab, use live captions below.', wcag: '1.2.4', keywords: 'transcribe speech to text realtime microphone room conversation' },
        { id: 'muteVideos', type: 'switch', label: 'Mute all video', desc: 'Silence every video on the page.', wcag: '1.4.2', keywords: 'silence quiet sound off' },
        { id: 'captionImages', type: 'switch', label: 'Label audio content', desc: 'Mark audio and video so nothing is missed.', wcag: '1.2.1', keywords: 'audio icon marker' }
      ],
      actions: [
        { id: 'btnCaptionsStart', label: 'Start live captions for this tab', style: 'primary' },
        { id: 'btnCaptionsStop', label: 'Stop live captions', style: 'secondary' },
        { id: 'btnCaptionModel', label: 'Download the caption engine (41 MB, once)', style: 'secondary' }
      ]
    },

    {
      id: 'speaking',
      icon: 'chat',
      label: 'Speaking and typing',
      desc: 'Tools for people who cannot speak or type easily.',
      controls: [
        { id: 'aacBoard', type: 'switch', label: 'Picture board', desc: 'Show a board of symbols that speak when tapped.', wcag: '2.5.3', keywords: 'aac symbols nonverbal communication board' },
        { id: 'quickResponses', type: 'switch', label: 'Quick phrases', desc: 'Keep common replies one tap away.', wcag: '2.5.3', keywords: 'phrases shortcuts canned replies' },
        { id: 'textInputBar', type: 'switch', label: 'Type and speak', desc: 'Show a box that reads out whatever you type.', wcag: '2.5.3', keywords: 'speak aloud type voice output' },
        { id: 'speechToText', type: 'switch', label: 'Dictate into boxes', desc: 'Fill in forms by speaking instead of typing. Alt+Shift+V starts and stops. Needs microphone access.', wcag: '2.5.3', keywords: 'dictation dictate voice typing speech to text microphone write forms hands free' },
        { id: 'dictationLanguage', type: 'select', label: 'Dictation language', desc: 'The language you will speak. Automatic follows the page.', default: '', wcag: '2.5.3', keywords: 'dictation language bangla bengali english speech recognition', dependsOn: 'speechToText', options: [
          { value: '', label: 'Automatic (follow the page)' },
          { value: 'en-US', label: 'English (United States)' },
          { value: 'en-GB', label: 'English (United Kingdom)' },
          { value: 'bn-BD', label: '\u09ac\u09be\u0982\u09b2\u09be (Bangladesh)' },
          { value: 'bn-IN', label: '\u09ac\u09be\u0982\u09b2\u09be (India)' },
          { value: 'hi-IN', label: '\u0939\u093f\u0928\u094d\u0926\u0940 (India)' }
        ] }
      ]
    },

    {
      id: 'safety',
      icon: 'shield',
      label: 'Seizure safety',
      desc: 'Stops flashing and sudden motion.',
      controls: [
        { id: 'flashDetection', type: 'switch', label: 'Block flashing content', desc: 'Watch for rapid flashing and cover it before it can harm.', wcag: '2.3.1', keywords: 'photosensitive epilepsy strobe flash blink' },
        { id: 'reduceMotion', type: 'switch', label: 'Reduce motion', desc: 'Turn off sliding, zooming and parallax effects.', wcag: '2.3.3', keywords: 'vestibular motion sickness parallax dizzy' },
        { id: 'staticGifs', type: 'switch', label: 'Freeze animated images', desc: 'Show only the first frame of moving images.', wcag: '2.2.2', keywords: 'gif animation still freeze' },
        { id: 'disableAutoplay', type: 'switch', label: 'Block autoplay', desc: 'Stop video and audio starting by themselves.', wcag: '1.4.2', keywords: 'autoplay video starts automatically' },
        { id: 'motionInterceptor', type: 'switch', label: 'Freeze everything that moves', desc: 'Goes further than Reduce motion: stops scrolling tickers, live counters, blinking text and smooth scrolling. Cannot reach content inside another site embedded in this one.', wcag: '2.2.2', keywords: 'ticker counter crawler marquee blink parallax scroll jump stock price countdown live updating distracting adhd freeze stop everything' },
        { id: 'freezeCanvas', type: 'switch', label: 'Freeze drawn animations too', desc: 'Also stop games, charts and backgrounds that draw themselves. Powerful, but some pages need this movement to work.', wcag: '2.2.2', keywords: 'canvas webgl game chart background animation drawn particles', dependsOn: 'motionInterceptor' }
      ]
    },

    {
      id: 'calm',
      icon: 'focus',
      label: 'Calm and focus',
      desc: 'A quieter page for sensory and attention needs.',
      controls: [
        { id: 'lowStimulation', type: 'switch', label: 'Low stimulation', desc: 'Soften colours and remove anything loud or busy.', wcag: '2.3.3', keywords: 'autism sensory overwhelm quiet calm' },
        { id: 'reduceClutter', type: 'switch', label: 'Less on screen', desc: 'Hide anything that is not the main content.', wcag: '2.4.8', keywords: 'declutter minimal simple busy' },
        { id: 'neuroColorTheme', type: 'select', label: 'Colour mood', desc: 'Recolour the page to something gentler.', default: 'none', wcag: '1.4.8', keywords: 'palette calm warm cool pastel muted', options: [
          { value: 'none', label: 'Keep the site’s own' },
          { value: 'calm', label: 'Calm' },
          { value: 'warm', label: 'Warm' },
          { value: 'cool', label: 'Cool' },
          { value: 'muted', label: 'Muted' },
          { value: 'pastel', label: 'Pastel' }
        ] },
        { id: 'focusTimer', type: 'switch', label: 'Focus timer', desc: 'Work in timed stretches with breaks in between.', wcag: '2.2.1', keywords: 'pomodoro adhd concentrate timer' },
        { id: 'focusTimerMinutes', type: 'slider', label: 'Focus stretch of', desc: 'How long each stretch of focused work lasts.', min: 5, max: 60, step: 5, default: 25, suffix: ' min', wcag: '2.2.1', keywords: 'pomodoro length minutes', dependsOn: 'focusTimer' },
        { id: 'contentWarnings', type: 'switch', label: 'Warn me first', desc: 'Flag upsetting content before it appears.', wcag: '3.3.4', keywords: 'trigger warning sensitive distressing' },
        { id: 'consistentNav', type: 'switch', label: 'Steady navigation', desc: 'Keep menus in the same place as you move around.', wcag: '3.2.3', keywords: 'predictable consistent menu moves' },
        { id: 'socialCues', type: 'switch', label: 'Explain tone', desc: 'Point out sarcasm, idioms and figures of speech.', wcag: '3.1.3', keywords: 'autism idiom sarcasm literal meaning' }
      ]
    },

    {
      id: 'bangla',
      icon: 'globe',
      label: 'বাংলা (Bangla)',
      desc: 'Typography and forms for Bangla readers.',
      controls: [
        { id: 'banglaFont', type: 'switch', label: 'Bangla typeface', desc: 'Use a font drawn properly for Bangla letters.', wcag: '1.4.8', keywords: 'bengali bangla font script' },
        { id: 'banglaLargeText', type: 'switch', label: 'Larger Bangla text', desc: 'Bangla needs more height than Latin text to stay legible.', wcag: '1.4.4', keywords: 'bengali size bigger' },
        { id: 'banglaFormLabels', type: 'switch', label: 'Bangla form labels', desc: 'Translate form labels into Bangla.', wcag: '3.3.2', keywords: 'bengali forms translate labels' },
        { id: 'banglaNumbers', type: 'switch', label: 'Bangla numerals', desc: 'Show numbers as ১২৩ rather than 123.', wcag: '3.1.5', keywords: 'bengali digits numerals' }
      ]
    }
  ]
};

if (typeof window !== 'undefined') window.ACCESSIFLOW_SCHEMA = SCHEMA;
