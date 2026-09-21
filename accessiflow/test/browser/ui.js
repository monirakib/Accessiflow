// Runs in real Chrome. Checks the parts of the caption box, sound cues and
// meter that depend on the CSS cascade, which jsdom does not compute: that
// inline positions beat the page reset, that cue animations actually run, and
// that the overlays survive a page restyling divs, paragraphs and buttons.
(async () => {
  const results = [];
  const check = (cond, msg) => results.push({ ok: !!cond, msg: msg });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const cs = el => getComputedStyle(el);

  try {
    const hearing = new HearingModule();
    hearing.apply({ captionFontSize: 30, captionColor: 'yellow', captionBg: 'solid', visualAlerts: false,
      soundVisualization: true, captionLines: 3 });

    // ── The caption box ────────────────────────────────────────────────────
    hearing.onCaptionEvent({ type: 'state', state: 'running' });
    hearing.onCaptionEvent({ type: 'caption', text: 'Your appointment is on Tuesday.', final: true, id: 1 });
    const box = document.getElementById('accessiflow-live-captions');
    const r0 = box.getBoundingClientRect();
    check(Math.abs((r0.left + r0.width / 2) - innerWidth / 2) < 2 && innerHeight - r0.bottom < 40,
      'the caption box starts at the bottom centre, like broadcast subtitles');

    const line = box.querySelector('.accessiflow-live-captions-line');
    check(cs(line).fontSize === '30px', 'caption text is the chosen size despite the page shrinking paragraphs: ' + cs(line).fontSize);
    check(cs(line).color === 'rgb(255, 225, 77)', 'and the chosen colour, not the page’s near-white: ' + cs(line).color);
    check(cs(box).backgroundColor === 'rgb(0, 0, 0)', 'on the chosen solid backing');

    const buttons = Array.from(box.querySelectorAll('button'));
    check(buttons.length === 2 && buttons.every(b => cs(b).display !== 'none' && b.getBoundingClientRect().width > 0),
      'its buttons stay visible on a page that hides every button');

    // Move it with the keyboard, as the grip allows.
    const grip = box.querySelector('.accessiflow-live-captions-grip');
    for (let i = 0; i < 5; i++) grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    const r1 = box.getBoundingClientRect();
    check(r0.top - r1.top >= 90,
      'five presses of the up arrow really move the box on screen: ' + Math.round(r0.top - r1.top) + ' px, despite the page reset');

    // ── Sound cues: the animation must actually run ────────────────────────
    hearing.showSoundCue({ pan: -0.9, strength: 1 });
    const cue = document.querySelector('.accessiflow-sound-cue--left');
    await wait(260);
    const midOpacity = parseFloat(cs(cue).opacity);
    check(midOpacity > 0.5,
      'a sound cue becomes visible while it plays: opacity ' + midOpacity.toFixed(2) + ' at 0.26 s');
    const cr = cue.getBoundingClientRect();
    check(cr.left === 0 && cr.height >= innerHeight - 1 && cr.width >= 40,
      'a left cue runs the full height of the left edge');
    await wait(1500);
    check(!document.body.contains(cue), 'and has removed itself by 1.8 s');

    hearing.showSoundCue({ rect: { top: 200, left: 300, width: 120, height: 40 }, strength: 1 });
    const ring = document.querySelector('.accessiflow-sound-cue--at');
    await wait(400);
    const rr = ring.getBoundingClientRect();
    const transform = cs(ring).transform;
    check(Math.abs((rr.left + rr.width / 2) - 360) < 60 && Math.abs((rr.top + rr.height / 2) - 220) < 60,
      'a cue for an element appears where the element is');
    check(transform && transform !== 'none',
      'and ripples outward while it plays: transform ' + transform);

    hearing.apply({ visualAlerts: true, reduceMotion: true });
    hearing.showSoundCue({ rect: { top: 400, left: 300, width: 120, height: 40 }, strength: 1 });
    const calm = Array.from(document.querySelectorAll('.accessiflow-sound-cue--at')).pop();
    await wait(300);
    const calmTransform = cs(calm).transform;
    check((calmTransform === 'none' || calmTransform === 'matrix(1, 0, 0, 1, 0, 0)') && parseFloat(cs(calm).opacity) > 0.3,
      'with Reduce motion on it still shows, but does not move: transform ' + calmTransform);

    // ── The meter ──────────────────────────────────────────────────────────
    hearing.apply({ soundVisualization: true });
    hearing.onCaptionEvent({ type: 'level', left: 0.2, right: 0.002 });
    const fills = document.querySelectorAll('.accessiflow-sound-meter-fill');
    const lw = fills[0].getBoundingClientRect().width;
    const rw = fills[1].getBoundingClientRect().width;
    check(lw > rw * 1.5 && lw > 20, 'the meter’s bars really have width on screen: left ' + Math.round(lw) + ' px, right ' + Math.round(rw) + ' px');

    window.__result = { ok: true, results: results };
  } catch (e) {
    window.__result = { ok: false, error: String(e && e.stack || e), results: results };
  }
})();
