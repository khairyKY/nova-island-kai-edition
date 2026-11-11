// Prayer tab: today's times, next prayer with a live countdown, Hijri date, and reminders
// (10 minutes before and at the time). Also feeds the idle pill and the vertical pill.
(() => {
  const ORDER = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const NAMES = { imsak: 'الإمساك', fajr: 'الفجر', sunrise: 'الشروق', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
  const PRAYERS = ORDER.filter((k) => k !== 'sunrise');
  const isRamadan = (d) => d?.today?.hijriMonth === 9;
  const SOON_MIN = 10;

  const view = $('#v-prayer');
  const listEl = $('#pr-list');
  const bell = $('#pr-alerts');

  let data = null;
  // reminders already shown today, kept across restarts so a restart in the late window doesn't replay one
  const fired = new Set((() => { try { return JSON.parse(localStorage.getItem('prayer-fired')) || []; } catch { return []; } })());
  fired.add = function (id) {
    Set.prototype.add.call(this, id);
    const today = id.slice(0, 10);
    try { localStorage.setItem('prayer-fired', JSON.stringify([...this].filter((x) => x.startsWith(today)))); } catch {}
    return this;
  };
  // the PC may wake from sleep (or the island start) a little after the adhan: it still plays then
  const LATE_MS = 3 * 60000;

  // the bell and the Settings window share one switch (prayerAlerts)
  let alertsOn = true;
  const showBell = () => bell.classList.toggle('on', alertsOn);
  showBell();
  window.addEventListener('island:features', (e) => {
    alertsOn = e.detail.prayerAlerts !== false;
    showBell();
  });
  bell.addEventListener('click', () => {
    alertsOn = !alertsOn;
    showBell();
    bridge.setFeatures({ prayerAlerts: alertsOn });
  });

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // "HH:MM" on `date` in the location's time zone -> the real moment (the PC may be elsewhere)
  let zone = '';
  function at(date, hhmm) {
    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi] = hhmm.split(':').map(Number);
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    if (!zone) return new Date(y, mo - 1, d, h, mi);
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
      }).formatToParts(new Date(guess)).map((x) => [x.type, Number(x.value)]));
      const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
      return new Date(guess - (shown - guess));
    } catch {
      return new Date(y, mo - 1, d, h, mi);
    }
  }
  // shown in the location's own time, like a mosque timetable
  const clock = (d) => {
    try {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...(zone ? { timeZone: zone } : {}) });
    } catch {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
  };
  const left = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  };
  const shortLeft = (ms) => {
    const m = Math.max(0, Math.ceil(ms / 60000));
    return m >= 60 ? `${Math.floor(m / 60)}:${pad(m % 60)}` : `${m}m`;
  };

  // The cached set may be from yesterday; pick the entries that belong to today/tomorrow.
  function days() {
    if (!data) return null;
    const today = ymd(new Date());
    if (data.today?.date === today) return { today: data.today, tomorrow: data.tomorrow };
    if (data.tomorrow?.date === today) return { today: data.tomorrow, tomorrow: null };
    return null;
  }

  function nextPrayer(d, now) {
    for (const k of PRAYERS) {
      const t = at(d.today.date, d.today.times[k]);
      if (t > now) return { key: k, time: t };
    }
    if (d.tomorrow) return { key: 'fajr', time: at(d.tomorrow.date, d.tomorrow.times.fajr) };
    return null;
  }

  function renderList(d, next, now) {
    listEl.innerHTML = '';
    // in Ramadan the list starts with imsak (cached data from before may lack it)
    const order = isRamadan(d) && d.today.times.imsak ? ['imsak', ...ORDER] : ORDER;
    for (const k of order) {
      const t = at(d.today.date, d.today.times[k]);
      const row = document.createElement('div');
      row.className = 'pr-row';
      if (k === 'sunrise' || k === 'imsak') row.classList.add('sunrise');
      if (k === 'maghrib' && isRamadan(d)) row.classList.add('iftar');
      if (next && next.key === k && next.time.toDateString() === t.toDateString()) row.classList.add('next');
      else if (t <= now) row.classList.add('past');
      row.innerHTML = `<b>${NAMES[k]}</b><span dir="ltr">${clock(t)}</span>`;
      listEl.append(row);
    }
  }

  function remind(d, now) {
    // the cached times can arrive while the later views are still loading: wait for the scene
    // (next tick, a second later) rather than spend the adhan on the plain toast
    if (!window.playScene) return;
    for (const k of PRAYERS) {
      const diff = at(d.today.date, d.today.times[k]) - now;
      const id = `${d.today.date}-${k}-ev`;
      if (diff <= 0 && diff > -LATE_MS && !fired.has(id)) {
        fired.add(id);
        window.dispatchEvent(new CustomEvent('island:adhan', { detail: { prayer: k } }));
      }
    }
    if (!alertsOn) return;
    for (const k of PRAYERS) {
      const t = at(d.today.date, d.today.times[k]);
      const diff = t - now;
      const id = `${d.today.date}-${k}`;
      if (diff <= 0 && diff > -LATE_MS && !fired.has(`${id}-now`)) {
        fired.add(`${id}-now`);
        note('🕌', `أذان ${NAMES[k]} ${clock(t)}`);
        chime();
        // Nova in her prayer cap on the rug; the plain toast when she's off or there's no room
        const iftar = k === 'maghrib' && isRamadan(d) ? ' · تقبّل الله صيامك' : '';
        const shown = (window.phoenix?.style() !== 'classic' || feat('novaPrayer')) && window.playScene?.({
          who: 'nova', phoenixPose:'prayer', props: ['cap', 'rug'], arms: 'fold', tone: 'gold', badge: '☾ الأذان', lang: 'ar',
          title: 'أَقِمْ صَلَاتَكَ', quran: true,
          sub: `حان الآن وقت صلاة <b>${NAMES[k]}</b><bdi dir="ltr">${clock(t)}</bdi>${iftar}`,
          ms: 45000,
        });
        if (!shown) {
          island.classList.add('prayer-alert');
          showToast('prayer', `حان الآن موعد صلاة ${NAMES[k]}`, clock(t), 0, 9000);
          setTimeout(() => island.classList.remove('prayer-alert'), 9200);
        }
      } else if (diff > 0 && diff <= SOON_MIN * 60000 && diff > (SOON_MIN - 1) * 60000 && !fired.has(`${id}-soon`)) {
        fired.add(`${id}-soon`);
        showToast('prayer-soon', `${NAMES[k]} بعد ${SOON_MIN} دقائق`, clock(t), 0, 5000);
      }
    }
  }

  // Ramadan: until maghrib count down to iftar, after it to the next imsak
  function ramadan(d, now) {
    const on = isRamadan(d) && d.today.times.imsak && feat('slidePrayer');
    $('.rmd-slide').hidden = !on;
    $('#pr-ramadan').hidden = !on;
    view.classList.toggle('ramadan', !!on);
    if (!on) return;
    const imsak = at(d.today.date, d.today.times.imsak);
    const iftar = at(d.today.date, d.today.times.maghrib);
    let label;
    let target;
    if (now >= imsak && now < iftar) {
      label = 'الإفطار';
      target = iftar;
    } else {
      label = 'الإمساك';
      target = now < imsak ? imsak : d.tomorrow?.times?.imsak ? at(d.tomorrow.date, d.tomorrow.times.imsak) : null;
    }
    if (!target) return;
    $('#i-rmd-name').textContent = label;
    $('#i-rmd-time').textContent = clock(target);
    $('#i-rmd-left').textContent = left(target - now);
    const ltr = (t) => `⁦${t}⁩`;
    $('#pr-ramadan').textContent = `رمضان كريم · ${label} ${ltr(clock(target))} · بعد ${ltr(left(target - now))}`;
  }

  // soft descending three-note bell (shared AudioContext, renderer.js playTones)
  const chime = () => playTones([[0, 784], [0.35, 659], [0.7, 523]], { peak: 0.18, attack: 0.03, decay: 1.4 });

  let lastListKey = '';
  function tick() {
    const d = days();
    zone = d?.today?.tz || '';
    view.classList.toggle('loading', !d);
    $('.pr-slide').hidden = !d;
    $('#v-pr-item').hidden = !d;
    if (!d) return;

    const now = new Date();
    const next = nextPrayer(d, now);
    if (next) {
      const ms = next.time - now;
      $('#pr-next-name').textContent = NAMES[next.key];
      $('#pr-count').textContent = left(ms);
      $('#pr-next-time').textContent = `${next.time.toDateString() === now.toDateString() ? 'اليوم' : 'غدًا'} ${clock(next.time)}`;
      $('#i-pr-name').textContent = NAMES[next.key];
      $('#i-pr-time').textContent = clock(next.time);
      $('#i-pr-left').textContent = left(ms);
      $('#v-pr-name').textContent = NAMES[next.key];
      $('#v-pr-left').textContent = shortLeft(ms);
    }
    $('#pr-hijri').textContent = d.today.hijri || '';
    ramadan(d, now);
    $('#pr-city').textContent = [data.city, d.today.method].filter(Boolean).join(' · ');

    // the list only changes when a prayer passes
    const key = `${d.today.date}-${next?.key}`;
    if (key !== lastListKey) {
      lastListKey = key;
      renderList(d, next, now);
    }
    remind(d, now);
  }

  // for the morning card: the next prayer as text
  window.nextPrayerText = () => {
    const d = days();
    if (!d) return '';
    const now = new Date();
    const n = nextPrayer(d, now);
    return n ? `${NAMES[n.key]} ${clock(n.time)}` : '';
  };

  bridge.onPrayer((p) => {
    data = p;
    lastListKey = '';
    tick();
  });
  bridge.prayerSnapshot().then((p) => {
    if (p && !data) {
      data = p;
      tick();
    }
  });
  setInterval(tick, 1000);
  tick();
})();
