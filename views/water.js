// Water: the Drop reminds you to drink. Doctors' usual advice is ~2–2.5 L a day for an adult,
// sipped through the day rather than at once, so by default: a glass (~250 ml) every 60 minutes
// you are at the computer, aiming at 8 glasses. Both are adjustable in Settings.
// Only time at the computer counts; a long absence starts the count again. It waits during a
// focus session, quiet hours, fullscreen, or while the island is busy.
(() => {
  const KEY = 'nova-water';
  const AWAY_RESET_S = 20 * 60; // away this long: start counting again
  const SNOOZE_MS = 15 * 60e3; // closed without drinking: ask again sooner
  let activeMs = 0;
  let last = Date.now();
  let idle = 0;

  const today = () => new Date().toDateString();
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v && v.day === today()) return v.n;
    } catch {}
    return 0;
  }
  function save(n) {
    try { localStorage.setItem(KEY, JSON.stringify({ day: today(), n })); } catch {}
  }
  const everyMs = () => (state.features.waterEvery || 60) * 60e3;
  const goal = () => state.features.waterGoal || 8;

  function quiet() {
    const f = state.features;
    if (!f.quietHours) return false;
    const d = new Date();
    const m = d.getHours() * 60 + d.getMinutes();
    const from = f.quietFrom ?? 1380;
    const to = f.quietTo ?? 420;
    return from <= to ? m >= from && m < to : m >= from || m < to;
  }

  function remind() {
    const n = load();
    const g = goal();
    const sub = n >= g
      ? `Daily goal reached (${g} glasses) 🎉 — one more won't hurt`
      : `<b>${n}</b> of ${g} glasses today`;
    return playScene({
      who: 'drop', phoenixPose:'water-reminder', props: ['glass'], arms: 'hold', tone: 'water', badge: '💧 Water',
      title: 'Drink a glass of water', sub, ms: 20000,
      button: { label: 'I drank ✓', onClick: drank },
      onClose: () => { activeMs = Math.max(0, everyMs() - SNOOZE_MS); },
    });
  }

  function drank() {
    const n = load() + 1;
    save(n);
    const g = goal();
    const shown = window.phoenix?.enabled('drinking') || (n === g && window.phoenix?.enabled('celebration'))
      ? playScene({who:'nova',phoenixPose:'drinking',phoenixSequence:n===g?[{pose:'celebration',at:2500}]:[],tone:'water',badge:'💧 Water',
        title:n>=g?'Water goal reached!':'Glass of water ✓',sub:`<b>${n}</b> of ${g} glasses today`,ms:n===g?5000:3000}) : false;
    if(!shown)showToast('done', n >= g ? 'Water goal reached!' : 'Glass of water ✓', `${n} / ${g}`, 0, 2400);
    if (n === g) celebrate(['#38bdf8', '#a5f3fc', '#ffd479']);
  }
  window.logWater = drank;

  bridge.onMedia((m) => { if (typeof m.idle === 'number') idle = m.idle; });

  setInterval(() => {
    const now = Date.now();
    const dt = now - last;
    last = now;
    if (!feat('water')) return;
    if (idle >= AWAY_RESET_S) { activeMs = 0; return; }
    if (idle < 120) activeMs += dt; // at the computer
    if (activeMs < everyMs()) return;
    // a calm moment only
    if (!state.visible || focusing() || quiet() || sceneShowing() || cardShowing() || lastMode === 'expanded') return;
    if (state.toast && now < state.toastUntil) return;
    if (remind()) activeMs = 0;
  }, 5000);
})();
