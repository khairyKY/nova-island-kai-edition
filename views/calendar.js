// Upcoming meetings: an idle slide ("Design review · in 25 min"), toasts 10 min and 1 min before,
// and at the start a toast whose Join button opens the meeting link.
(() => {
  const NOTICE_MIN = [10, 1];
  let events = [];
  const fired = new Set();

  const minutes = (ms) => Math.max(0, Math.round(ms / 60000));
  function when(ev, now) {
    if (ev.start <= now) return 'now';
    const m = minutes(ev.start - now);
    return m >= 60 ? `in ${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `in ${m} min`;
  }

  function tick() {
    const now = Date.now();
    const on = feat('meetings');
    // the next meeting still to come, or one running now
    const next = events.find((e) => e.end > now);
    const soon = on && next && next.start - now < 3 * 3600e3;
    $('.mt-slide').hidden = !soon;
    if (soon) {
      $('#i-mt-title').textContent = next.title;
      $('#i-mt-when').textContent = when(next, now);
    }
    if (!on) return;

    for (const ev of events) {
      const left = ev.start - now;
      for (const min of NOTICE_MIN) {
        const id = `${ev.id}|${min}`;
        if (left <= min * 60000 && left > (min - 1) * 60000 && !fired.has(id)) {
          fired.add(id);
          showToast('meet', ev.title, `in ${min} min`, 0, 5000);
        }
      }
      const startId = `${ev.id}|start`;
      if (left <= 0 && left > -60000 && !fired.has(startId)) {
        fired.add(startId);
        showToast('meet-now', ev.title, ev.link ? 'Join' : 'Now', 0, 12000, ev.link ? () => bridge.openMeeting(ev.link) : null);
        note('📅', `Meeting started: ${ev.title}`);
        island.classList.add('meet-flash');
        setTimeout(() => island.classList.remove('meet-flash'), 12200);
        playTones([[0, 660], [0.18, 880]], { peak: 0.16, decay: 0.5 });
      }
    }
  }

  function update(c) {
    events = Array.isArray(c?.events) ? c.events : [];
    tick();
  }

  // for the morning card: meetings left today
  window.meetingsToday = () => {
    const now = Date.now();
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return feat('meetings') ? events.filter((e) => e.end > now && e.start <= +end) : [];
  };

  bridge.onCalendar(update);
  bridge.calendar().then(update);
  setInterval(tick, 5000);
  window.addEventListener('island:features', tick);
})();
