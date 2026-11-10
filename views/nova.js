// Nova: two eyes in the idle pill that look at the cursor and blink. They appear only when the
// cursor lingers beside the island for a few seconds, and never stand in the way of opening it:
// once the cursor is on the island (hover), the island opens as usual and the eyes are gone.
(() => {
  const DWELL_MS = 3000;
  // the performance options turn the eyes off (the island stays still)
  const light = () => !!(state.features.noBlur || state.features.noAnimations);
  const eyes = $('.eyes');
  const pupils = [...$$('.eye b')];
  let near = null;
  let nearSince = 0;
  let dwellTimer = null;

  function apply() {
    const lingered = near && Date.now() - nearSince >= DWELL_MS;
    const show = state.features.companionStyle === 'classic' && feat('novaEyes') && !light() && !anchor.vertical && lingered && !state.hover && lastMode === 'idle';
    island.classList.toggle('eyes', !!show);
  }

  bridge.onNear((n) => {
    if (!n) {
      near = null;
      nearSince = 0;
      clearTimeout(dwellTimer);
      apply();
      return;
    }
    if (!near) {
      nearSince = Date.now();
      clearTimeout(dwellTimer);
      dwellTimer = setTimeout(apply, DWELL_MS + 20);
    }
    near = n;
    // pupils move up to 2.5px toward the cursor
    const d = Math.hypot(n.dx, n.dy) || 1;
    const k = Math.min(1, d / 120);
    const px = (n.dx / d) * 2.5 * k;
    const py = (n.dy / d) * 2.5 * k;
    pupils.forEach((p) => {
      p.style.setProperty('--px', `${px.toFixed(2)}px`);
      p.style.setProperty('--py', `${py.toFixed(2)}px`);
    });
    apply();
  });

  // natural blinking, now and then a double blink
  function blink() {
    eyes.classList.add('blink');
    setTimeout(() => eyes.classList.remove('blink'), 130);
  }
  (function loop() {
    if (island.classList.contains('eyes') && !state.features.noAnimations) {
      blink();
      if (Math.random() < 0.2) setTimeout(blink, 260);
    }
    setTimeout(loop, 2400 + Math.random() * 3600);
  })();

  bridge.onHover(apply);
  window.addEventListener('island:features', apply);
  window.addEventListener('island:mode', apply);
})();
