// The island's timer, longer and louder (2.0): any length, set with − and + beside Start (5
// minutes a press, up to 3 hours; while it runs, they add or take time off), and an end that
// can't be missed: the sound again and again and the island pulsing for 30 seconds, until the
// island is touched. Loaded after renderer.js and uses its timer (state.timer, setTimer,
// drawTimer, render, showToast).
(() => {
  const STEP = 5;
  const MAX = 180;
  const ALARM_MS = 30_000;
  const EVERY_MS = 2_000;

  const actions = document.querySelector('.tm-actions');
  const start = document.getElementById('tm-start');
  if (!actions || !start) return;

  const make = (id, sign, label) => {
    const b = document.createElement('button');
    b.id = id;
    b.className = 'pill tm-step';
    b.textContent = sign;
    b.setAttribute('aria-label', label);
    b.title = label;
    return b;
  };
  const minus = make('tm-minus', '−', `${STEP} minutes less`);
  const plus = make('tm-plus', '+', `${STEP} minutes more`);
  actions.insertBefore(minus, start);
  actions.insertBefore(plus, start);

  function step(dir) {
    const t = state.timer;
    if (t.running) {
      // a running timer: time added, or taken off (a minute stays at least)
      const left = Math.max(0, (t.endAt - Date.now()) / 1000);
      const next = Math.min(MAX * 60, Math.max(60, left + dir * STEP * 60));
      t.endAt = Date.now() + next * 1000;
      t.total = Math.max(t.total, next);
      drawTimer();
      return;
    }
    const now = Math.round((t.total || 0) / 60);
    // from a length off the steps (1, 10…), the next step up or down
    const base = dir > 0 ? Math.floor(now / STEP) * STEP : Math.ceil(now / STEP) * STEP;
    const min = Math.min(MAX, Math.max(1, base + dir * STEP));
    setTimer(min, t.phase || null);
  }
  minus.addEventListener('click', () => step(-1));
  plus.addEventListener('click', () => step(1));

  // the end: the sound every 2 s and the island pulsing, for 30 s or until it's touched
  let ringing = null;
  function stop() {
    if (!ringing) return;
    clearInterval(ringing.tick);
    clearTimeout(ringing.end);
    ringing = null;
    island.classList.remove('alert');
    // the card that said so goes too
    if (state.toast === 'done') {
      state.toastUntil = 0;
      render();
    }
  }
  window.timerAlarm = (sound) => {
    stop();
    const ring = () => {
      try { sound(); } catch {}
      island.classList.remove('alert');
      void island.offsetWidth; // the pulse starts again
      island.classList.add('alert');
      setTimeout(() => island.classList.remove('alert'), 1000);
    };
    ring();
    ringing = { tick: setInterval(ring, EVERY_MS), end: setTimeout(stop, ALARM_MS) };
  };
  island.addEventListener('pointerdown', stop, true);
  window.timerAlarmMs = ALARM_MS;
})();
