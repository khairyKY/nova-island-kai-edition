// The companion: notices when you come back, greets the day, and minds your breaks.
//   - back after 5+ min away: "Welcome back" with what happened meanwhile (downloads, adhan,
//     meetings, internet) — only when something did, or after a long absence
//   - first time at the computer each day: a morning (or evening) card: weather, next prayer,
//     today's meetings, Hijri date
//   - 50 min of continuous use: a gentle break card (stand up / water / rest your eyes)
// Idle time comes from the bridge (Windows' last-input time) with every media update.
(() => {
  const AWAY_S = 5 * 60; // this long without input = away
  const LONG_AWAY_MS = 30 * 60e3;
  const WORK_MS = 50 * 60e3;
  const BRIEF_KEY = 'nova-brief-day';
  const CARE = [
    ['Stand up and move', '50 minutes at the screen. Two minutes of moving wakes up body and mind.'],
    ['Rest your eyes', 'Look at something 20 feet away for 20 seconds — the 20-20-20 rule.'],
    ['Take a deep breath', 'In for 4, hold for 4, out for 4. Three times.'],
  ];

  let awayFrom = 0; // when the current absence started
  let activeSince = Date.now();
  let careIdx = 0;
  let pending = null; // a card waiting for a calm moment

  const today = () => new Date().toDateString();
  const briefDone = () => { try { return localStorage.getItem(BRIEF_KEY) === today(); } catch { return false; } };
  const markBrief = () => { try { localStorage.setItem(BRIEF_KEY, today()); } catch {} };
  const mins = (ms) => {
    const m = Math.round(ms / 60000);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  };
  const line = (icon, html) => `<span class="ln">${icon} ${html}</span>`;
  // Arabic words (prayer names, Hijri date) keep their own direction inside the English lines
  const ar = (t) => `<bdi lang="ar">${t}</bdi>`;

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  async function brief() {
    markBrief();
    const lines = [];
    const now = new Date();
    const date = now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
    const hijri = $('#pr-hijri')?.textContent || '';
    lines.push(line('📆', `<b>${esc(date)}</b>${hijri ? ` · ${ar(esc(hijri))}` : ''}`));
    try {
      const w = (await bridge.system.snapshot())?.weather;
      if (w) lines.push(line('🌤️', `<b>${w.temp}°</b> in ${esc(w.city || 'your city')} · H ${w.hi}° L ${w.lo}°`));
    } catch {}
    const pr = window.nextPrayerText?.();
    if (pr && feat('tabPrayer')) {
      const [name, ...time] = pr.split(' ');
      lines.push(line('🕌', `Next prayer: <b>${ar(esc(name))}</b> ${esc(time.join(' '))}`));
    }
    const meets = window.meetingsToday?.() || [];
    if (meets.length) {
      const first = meets[0];
      const t = new Date(first.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      lines.push(line('📅', `${meets.length === 1 ? '1 meeting' : `${meets.length} meetings`} today · first: <b>${esc(first.title)}</b> ${t}`));
    }
    queue({ kind: 'brief', badge: greeting(), html: `<span class="big">${greeting()} 👋</span>${lines.join('')}`, ref: '', ms: 14000 });
  }

  function welcome(awayMs) {
    const since = Date.now() - awayMs;
    const news = happenings.filter((h) => h.at >= since);
    if (!news.length && awayMs < LONG_AWAY_MS) return;
    const lines = news.slice(-4).map((h) => line(h.icon, esc(h.text)));
    if (news.length > 4) lines.push(line('…', `and ${news.length - 4} more`));
    if (!lines.length) lines.push(line('☕', 'You missed nothing. All quiet.'));
    queue({ kind: 'welcome', badge: 'Welcome back', html: `<span class="big">Welcome back 👋</span><span class="ln">Away for ${mins(awayMs)}</span>${lines.join('')}`, ref: '', ms: 12000 });
  }

  function care() {
    const [title, text] = CARE[careIdx++ % CARE.length];
    queue({ kind: 'care', badge: 'Break', html: `<span class="big">${title} 🌿</span><span class="ln">${text}</span>`, ref: '', ms: 15000 });
  }

  // cards wait while the island is open, hidden, showing another card or a toast
  function queue(card) { pending = card; flush(); }
  function flush() {
    if (!pending) return;
    const now = Date.now();
    if (!state.visible || lastMode === 'expanded' || cardShowing() || window.sceneShowing?.() || (state.toast && now < state.toastUntil)) return;
    const c = pending;
    pending = null;
    const pose = c.kind === 'care' ? (c.html.includes('Rest your eyes') ? 'resting' : 'break') : 'welcome';
    if(!window.phoenix?.showMoment(c,pose))showCard(c);
  }
  setInterval(flush, 1000);

  bridge.onMedia((m) => {
    if (typeof m.idle !== 'number') return;
    const now = Date.now();
    if (m.idle >= AWAY_S) {
      if (!awayFrom) awayFrom = now - m.idle * 1000;
      return;
    }
    if (awayFrom && m.idle < 5) {
      // back at the computer
      const awayMs = now - awayFrom;
      awayFrom = 0;
      activeSince = now; // that was a real break
      if (feat('morningBrief') && !briefDone() && new Date().getHours() >= 4) brief();
      else if (feat('welcomeBack')) welcome(awayMs);
      return;
    }
    // minding breaks: long continuous use, never during focus, quiet hours or fullscreen
    if (feat('wellbeing') && now - activeSince >= WORK_MS && state.visible && !focusing()) {
      activeSince = now;
      care();
    }
  });

  // first start of the day (the PC was just switched on): greet once the island is settled
  setTimeout(() => {
    if (feat('morningBrief') && !briefDone() && new Date().getHours() >= 4) brief();
  }, 9000);
})();
