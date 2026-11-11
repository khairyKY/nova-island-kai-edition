// Settings > Animations preview: each button plays one of the island's animations now, from made-up
// data. Nothing real happens: no song changes, no setting is switched, no water is logged.
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // a made-up album cover: a soft gradient with a lighter square, as base64 PNG
  function cover(a, b) {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 96, 96);
    g.addColorStop(0, a); g.addColorStop(1, b);
    x.fillStyle = g; x.fillRect(0, 0, 96, 96);
    x.fillStyle = 'rgba(255,255,255,.28)'; x.fillRect(26, 26, 44, 44);
    return c.toDataURL('image/png').split(',')[1];
  }
  const song = (title, artist, thumb) => ({ has: true, title, artist, album: 'Preview', app: 'Spotify.exe', playing: true, pos: 12, dur: 200, thumb,
    source: { id: 'spotify', name: 'Spotify', icon: 'assets/media/spotify.svg' } });
  // with a feature set the way the preview needs it, put back after
  async function withFeatures(patch, ms, fn) {
    const before = {};
    for (const k of Object.keys(patch)) before[k] = state.features[k];
    Object.assign(state.features, patch);
    try { await fn(); await sleep(ms); } finally { Object.assign(state.features, before); }
  }
  const settle = () => { state.pinned = false; state.hover = false; window.endScene?.(); render(); };

  const PREVIEWS = {
    'dust-soft': () => withFeatures({ softDust: true, dustStyle: 'soft', noAnimations: false }, 1600, async () => {
      state.pinned = true; render(); await sleep(1700); state.pinned = false; render();
    }),
    'dust-thanos': () => withFeatures({ softDust: true, dustStyle: 'thanos', noAnimations: false }, 1800, async () => {
      state.pinned = true; render(); await sleep(1900); state.pinned = false; render();
    }),
    'song-pill': () => withFeatures({ songChange: 'pill', mediaPill: true, mediaTitle: true }, 2200, async () => {
      window.previewMedia(song('Preview song one', 'Nova Island', cover('#e2564b', '#7a1f4f')), 7000);
      await sleep(1800);
      window.previewMedia(song('And the next one', 'Nova Island', cover('#3b82f6', '#1e3a8a')), 4200);
    }),
    'song-card': () => withFeatures({ songChange: 'card', mediaPill: true, mediaTitle: true }, 4800, async () => {
      window.previewMedia(song('Preview song one', 'Nova Island', cover('#e2564b', '#7a1f4f')), 9000);
      await sleep(1800);
      window.previewMedia(song('And the next one', 'Nova Island', cover('#3b82f6', '#1e3a8a')), 6500);
    }),
    'pady-drop': () => window.padyDrop?.({ app: 'pady', label: 'Clipboard', title: 'Copied', body: '' }),
    'app-notice': () => window.previewAppNotice?.({ app: 'claude', label: 'Finished', title: 'Claude finished the task', body: 'Preview of an app notice' }),
    'kai-notice': () => window.previewKaiNotice?.({ kind: 'test', title: 'Review the lecture notes', body: 'Preview of a Kai’s Flow notice' }),
    volume: () => showHud('vol', 0.62, false),
    brightness: () => showHud('bright', 0.48, false),
    'saver-on': () => window.saverToast({ on: true, pct: 42 }),
    'saver-stays': () => window.saverToast({ on: true, pct: 18, stays: true, at: 20 }),
    'saver-off': () => window.saverToast({ on: false, pct: 64 }),
    performance: () => window.saverToast({ on: false, pct: 64, perf: true, hz: 120 }),
    charging: () => showToast('charging', 'Charging', '64%', 0.64),
    'low-battery': () => showToast('low', 'On Battery', '12%', 0.12),
    'on-battery': () => showToast('battery', 'On Battery', '64%', 0.64),
    adhan: () => window.playScene?.({
      who: 'nova', phoenixPose: 'prayer', props: ['cap', 'rug'], arms: 'fold', tone: 'gold', badge: '☾ الأذان', lang: 'ar',
      title: 'أَقِمْ صَلَاتَكَ', quran: true, sub: 'حان الآن وقت صلاة <b>المغرب</b> (معاينة)', ms: 9000,
    }),
    water: () => window.playScene?.({
      who: 'drop', phoenixPose: 'water-reminder', props: ['glass'], arms: 'hold', tone: 'water', badge: '💧 Water',
      title: 'Drink a glass of water', sub: '<b>3</b> of 8 glasses today (preview)', ms: 8000,
    }),
    focus: () => window.playScene?.({
      who: 'nova', phoenixPose: 'focus', props: ['band', 'laptop'], arms: 'type', tone: 'focus', badge: '🎯 Focus',
      title: 'Focus time', sub: '<b>25 min</b> of deep work (preview)', ms: 6000,
    }),
    'focus-done': () => {
      window.playScene?.({
        who: 'nova', phoenixPose: 'focus-complete', phoenixSequence: [{ pose: 'celebration', at: 3000 }, { pose: 'break', at: 5000 }],
        props: ['band'], arms: 'rest', tone: 'focus', badge: '🎯 Focus', title: 'Well done! 🎉', sub: 'Focus session <b>1</b> done (preview)', ms: 8000,
      });
      window.celebrate?.(['#ff6b6b', '#ffd479', '#ff9f0a']);
    },
    celebration: () => {
      window.playScene?.({ who: 'nova', phoenixPose: 'celebration', badge: 'Celebration', title: 'Nicely done!', tone: 'gold', ms: 3500 });
      window.celebrate?.(['#38bdf8', '#a5f3fc', '#ffd479']);
    },
  };
  window.ANIMATION_PREVIEWS = Object.keys(PREVIEWS);
  bridge.onAnimationPreview?.((id) => {
    const play = PREVIEWS[id];
    if (!play) return;
    settle();
    // (a frame for the island to take its resting shape before the animation starts)
    requestAnimationFrame(() => Promise.resolve(play()).catch((err) => console.error('[preview]', id, err)));
  });
})();
