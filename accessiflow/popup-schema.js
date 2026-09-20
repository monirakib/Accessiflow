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
    'section-ai': 'ai artificial intelligence smart help alt text image images picture pictures photo photos describe description caption summary summarise summarize explain overview what is this page about link links vague confusing click here rename',
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
        { id: 'highContrast', type: 'switch', label: 'High contrast', desc: 'Force a strong light-on-dark colour scheme.', wcag: '1.4.6', keywords: 'contrast bold visible' },
        { id: 'darkMode', type: 'switch', label: 'Dark background', desc: 'Turn bright pages dark to reduce glare.', wcag: '1.4.8', keywords: 'night glare dim' },
        { id: 'invertColors', type: 'switch', label: 'Invert colours', desc: 'Flip every colour to its opposite.', wcag: '1.4.8', keywords: 'negative reverse' },
        { id: 'dyslexiaFont', type: 'switch', label: 'Dyslexia-friendly text', desc: 'Use weighted letters that are harder to flip or confuse.', wcag: '1.4.8', keywords: 'dyslexia opendyslexic reading' },
        { id: 'highlightLinks', type: 'switch', label: 'Highlight links', desc: 'Give every link a strong colour and underline.', wcag: '1.4.1', keywords: 'underline visible anchors' },
        { id: 'hideImages', type: 'switch', label: 'Hide images', desc: 'Remove pictures and leave only the text.', wcag: '1.4.8', keywords: 'pictures declutter text only' },
        { id: 'readingGuide', type: 'switch', label: 'Reading guide', desc: 'Show a line under your pointer to keep your place.', wcag: '2.4.8', keywords: 'ruler track place' },
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
        { id: 'readingMask', type: 'switch', label: 'Reading mask', desc: 'Darken everything except one band of text.', wcag: '2.4.8', keywords: 'focus band strip' },
        { id: 'lineRuler', type: 'switch', label: 'Line ruler', desc: 'Show a straight line to read along.', wcag: '2.4.8', keywords: 'guide track straightedge' },
        { id: 'readingProgress', type: 'switch', label: 'Progress bar', desc: 'Show how far through the page you are.', wcag: '2.4.8', keywords: 'scroll position how far' },
        { id: 'showHeadings', type: 'switch', label: 'Outline the headings', desc: 'Mark each heading so the page structure is obvious.', wcag: '2.4.10', keywords: 'structure outline sections' },
        { id: 'altTextTooltips', type: 'switch', label: 'Show image descriptions', desc: 'Display each picture’s description underneath it.', wcag: '1.1.1', keywords: 'alt text captions pictures' },
        { id: 'dictionary', type: 'switch', label: 'Explain hard words', desc: 'Look up a word when you double-click it.', wcag: '3.1.3', keywords: 'definition meaning vocabulary' },
        { id: 'pauseMedia', type: 'switch', label: 'Pause moving content', desc: 'Stop sliders and carousels from moving on their own.', wcag: '2.2.2', keywords: 'carousel slider autoplay stop' },
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
        { id: 'enhancedFocus', type: 'switch', label: 'Strong focus outline', desc: 'Draw a thick ring around whatever the keyboard is on.', wcag: '2.4.11', keywords: 'keyboard outline ring where am i tab' },
        { id: 'tremorFilter', type: 'switch', label: 'Steady my clicks', desc: 'Ignore small shakes so one click stays one click.', wcag: '2.5.1', keywords: 'tremor shake parkinson steady double' },
        { id: 'clickAssist', type: 'switch', label: 'Forgiving clicks', desc: 'Accept clicks that land slightly off a button.', wcag: '2.5.8', keywords: 'miss accuracy near' },
        { id: 'dwellClick', type: 'switch', label: 'Click by hovering', desc: 'Click by resting the pointer still, with no button press.', wcag: '2.5.1', keywords: 'dwell hover hands free head mouse eye' },
        { id: 'dwellClickDelay', type: 'slider', label: 'Hold still for', desc: 'How long to rest before a hover becomes a click.', min: 400, max: 3000, step: 100, default: 1000, suffix: 'ms', wcag: '2.5.1', keywords: 'dwell delay timing', dependsOn: 'dwellClick' },
        { id: 'stickyHover', type: 'switch', label: 'Keep menus open', desc: 'Stop drop-down menus closing the moment you move away.', wcag: '1.4.13', keywords: 'menu dropdown closes too fast' },
        { id: 'keyboardOnly', type: 'switch', label: 'Keyboard navigation help', desc: 'Show shortcuts for moving around without a mouse.', wcag: '2.1.1', keywords: 'tab keys no mouse shortcuts' },
        { id: 'edgeScrolling', type: 'switch', label: 'Scroll at the edges', desc: 'Scroll the page by moving the pointer to its edge.', wcag: '2.5.1', keywords: 'scroll wheel drag' },
        { id: 'voiceCommands', type: 'switch', label: 'Voice commands', desc: 'Control the page by speaking. Needs microphone access.', wcag: '2.5.3', keywords: 'speech speak microphone hands free' },
        { id: 'stopAnimations', type: 'switch', label: 'Stop animations', desc: 'Freeze anything that moves on its own.', wcag: '2.3.3', keywords: 'motion movement still reduce' }
      ]
    },

    {
      id: 'listening',
      icon: 'sound',
      label: 'Having pages read aloud',
      desc: 'Text to speech, and repairs for screen readers.',
      controls: [
        { id: 'blindMode', type: 'switch', label: 'Screen reader repairs', desc: 'Quietly fix missing labels, landmarks and tab order.', wcag: '4.1.2', keywords: 'screen reader nvda jaws voiceover aria labels', defaultOn: true },
        { id: 'ttsReadOnSelect', type: 'switch', label: 'Read what I select', desc: 'Speak any text as soon as you highlight it.', wcag: '1.4.5', keywords: 'speak aloud selection highlight voice' },
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
      desc: 'Captions, and sound turned into something you can see.',
      controls: [
        { id: 'closedCaptions', type: 'switch', label: 'Turn captions on', desc: 'Switch on subtitles in videos that have them.', wcag: '1.2.2', keywords: 'subtitles cc video captions' },
        { id: 'captionStyling', type: 'switch', label: 'Easier-to-read captions', desc: 'Make subtitles larger with a solid backing.', wcag: '1.4.8', keywords: 'subtitle size background readable' },
        { id: 'liveTranscription', type: 'switch', label: 'Live transcript', desc: 'Write out speech as it is spoken. Needs microphone access.', wcag: '1.2.4', keywords: 'transcribe speech to text realtime' },
        { id: 'visualAlerts', type: 'switch', label: 'Flash instead of beep', desc: 'Show a visual signal when the page makes a sound.', wcag: '1.2.1', keywords: 'notification alert sound beep flash' },
        { id: 'soundVisualization', type: 'switch', label: 'Show sound levels', desc: 'Draw a meter so you can see when audio is playing.', wcag: '1.2.1', keywords: 'waveform meter audio visual' },
        { id: 'muteVideos', type: 'switch', label: 'Mute all video', desc: 'Silence every video on the page.', wcag: '1.4.2', keywords: 'silence quiet sound off' },
        { id: 'captionImages', type: 'switch', label: 'Label audio content', desc: 'Mark audio and video so nothing is missed.', wcag: '1.2.1', keywords: 'audio icon marker' }
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
        { id: 'speechToText', type: 'switch', label: 'Dictate into boxes', desc: 'Fill in form fields by speaking. Needs microphone access.', wcag: '2.5.3', keywords: 'dictation voice typing microphone' }
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
        { id: 'disableAutoplay', type: 'switch', label: 'Block autoplay', desc: 'Stop video and audio starting by themselves.', wcag: '1.4.2', keywords: 'autoplay video starts automatically' }
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
