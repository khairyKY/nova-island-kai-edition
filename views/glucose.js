// Sukoon on the island (sukoon.js reads it in the main process): the glucose slide in the collapsed
// pill, with a number that rolls like an odometer, an arrow that turns with the trend, a live dot,
// the colour of the state and the last three hours drawing themselves; and an animated notice when
// the state changes (glucose.css). Low and urgent low keep the slide in front until they pass.
(() => {
  const slide = $('.gl-slide');
  const num = $('#i-gl-num');
  const ARROW_DEG = [90, 45, 0, -45, -90]; // trend -2..2: straight down … straight up
  const ARROW_CH = ['↓', '↘', '→', '↗', '↑'];
  const PINNED = ['low', 'urgent'];
  let real = null; // the latest from Sukoon (the preview borrows the slide and gives it back)
  let previewing = false;
  let lastDrawn = 0;

  // each digit is a column 0-9 that slides to its place; a new number of digits starts from 0
  function roll(el, value, from) {
    const text = String(value);
    const start = from != null && String(from).length === text.length ? String(from) : null;
    if (el.childElementCount !== text.length || el.dataset.text?.length !== text.length) {
      el.innerHTML = [...text].map((_, i) => `<span class="gl-d"><span class="gl-col" style="--i:${i}">${'0123456789'.split('').map((d) => `<i>${d}</i>`).join('')}</span></span>`).join('');
      [...el.children].forEach((d, i) => d.firstChild.style.setProperty('--n', start ? start[i] : 0));
      void el.offsetWidth; // so the first value rolls in too
    } else if (start) {
      el.classList.add('gl-snap');
      [...el.children].forEach((d, i) => d.firstChild.style.setProperty('--n', start[i]));
      void el.offsetWidth;
      el.classList.remove('gl-snap');
    }
    el.dataset.text = text;
    [...el.children].forEach((d, i) => d.firstChild.style.setProperty('--n', text[i]));
  }
  const arrowDeg = (trend) => ARROW_DEG[trend + 2] ?? 0;
  const ago = (m) => (m < 1 ? 'now' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`);

  // the last three hours, the 70-180 band behind it; redrawn (it draws itself) on a new reading
  function spark(g) {
    const svg = $('.gl-spark');
    const pts = g.spark || [];
    if (pts.length < 2) { svg.classList.add('empty'); return; }
    svg.classList.remove('empty');
    const W = 56, H = 16;
    const vs = pts.map((p) => p[1]);
    const lo = Math.min(60, ...vs) - 5, hi = Math.max(200, ...vs) + 5;
    const x = (m) => ((m + 180) / 180) * W;
    const y = (v) => H - ((v - lo) / (hi - lo)) * H;
    svg.querySelector('.gl-band').setAttribute('y', y(180).toFixed(1));
    svg.querySelector('.gl-band').setAttribute('height', (y(70) - y(180)).toFixed(1));
    svg.querySelector('.gl-line').setAttribute('d', pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(''));
    const end = pts[pts.length - 1];
    svg.querySelector('.gl-end').setAttribute('cx', x(end[0]).toFixed(1));
    svg.querySelector('.gl-end').setAttribute('cy', y(end[1]).toFixed(1));
    if (g.at !== lastDrawn) {
      lastDrawn = g.at;
      svg.classList.remove('draw');
      void svg.getBoundingClientRect();
      svg.classList.add('draw');
    }
  }

  function show(g) {
    const on = !!g && g.kind !== 'none' && g.v != null;
    slide.hidden = !on;
    if (!on) { slide.classList.remove('pin'); return; }
    slide.dataset.kind = g.kind;
    roll(num, g.v);
    const arrow = $('.gl-arrow');
    arrow.style.setProperty('--rot', `${arrowDeg(g.trend)}deg`);
    arrow.classList.toggle('gone', g.trend == null || g.kind === 'gone');
    $('#i-gl-ago').textContent = ago(g.minutes || 0);
    $('#i-gl-who').textContent = g.self === false ? g.name : '';
    spark(g);
    const pin = PINNED.includes(g.kind);
    const was = slide.classList.contains('pin');
    slide.classList.toggle('pin', pin || previewing);
    if (pin && !was) showSlide(0); // straight to the front
  }

  function onStatus(s) {
    real = s?.connected ? s.glucose : null;
    if (!previewing) show(real);
  }
  bridge.sukoonStatus().then(onStatus);
  bridge.onSukoon(onStatus);

  // ---- the notices ----
  const ALERTS = {
    urgent: { label: 'Urgent low', ms: 60000, tones: [[0, 880], [0.18, 660], [0.36, 880], [0.54, 660]] },
    low: { label: 'Going low', ms: 9000, tones: [[0, 740], [0.3, 587]] },
    heading: { label: (g) => `Under 70 in ~${g.headingIn} min`, ms: 9000 },
    high: { label: 'High', ms: 7000 },
    inrange: { label: 'Back in range', ms: 5000, tones: [[0, 523], [0.16, 659], [0.32, 784]] },
    gone: { label: 'No signal', ms: 6000 },
  };
  function alert(e, from) {
    const a = ALERTS[e.type];
    if (!a) return;
    const label = typeof a.label === 'function' ? a.label(e) : a.label;
    const who = e.self === false && e.name ? `${e.name} · ` : '';
    showToast(`gl-${e.type}`, who + label, e.type === 'gone' ? `${e.minutes} min ago` : '', 0, a.ms);
    if (e.type !== 'gone') {
      const v = $('#t-value');
      v.innerHTML = `<b class="gl-num"></b><svg class="s gl-arrow" viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg>`;
      const arrow = v.querySelector('.gl-arrow');
      arrow.style.setProperty('--rot', '0deg');
      void arrow.getBoundingClientRect();
      arrow.style.setProperty('--rot', `${arrowDeg(e.trend)}deg`);
      roll(v.querySelector('.gl-num'), e.v, from);
      $('#vt-value').textContent = `${e.v}${ARROW_CH[e.trend + 2] || ''}`;
    }
    if (a.tones) playTones(a.tones, { peak: 0.14, attack: 0.02, decay: 0.5 });
  }
  let prevV = null;
  bridge.onSukoonAlert((e) => {
    alert(e, prevV);
    prevV = e.v;
  });
  bridge.onSukoon((s) => { if (s?.glucose?.v != null) prevV = s.glucose.v; });

  // ---- Settings › Preview animations: made-up readings only ----
  const demoSpark = (vals) => vals.map((v, i) => [Math.round(-180 + (180 * i) / (vals.length - 1)), v]);
  const DEMO = {
    low: { type: 'low', v: 64, trend: -1, from: 74 },
    urgent: { type: 'urgent', v: 52, trend: -2, from: 61 },
    heading: { type: 'heading', v: 88, trend: -2, headingIn: 6, from: 100 },
    high: { type: 'high', v: 212, trend: 1, from: 176 },
    inrange: { type: 'inrange', v: 112, trend: 0, from: 66 },
    gone: { type: 'gone', v: 120, trend: 0, minutes: 14 },
  };
  window.glucosePreview = (type) => {
    if (type !== 'slide') {
      const d = DEMO[type];
      return d && alert({ ...d, self: true }, d.from);
    }
    // the pill walks through the states: in range, falling, low, urgent, and back
    const steps = [
      [132, 0, 'ok'], [118, -1, 'ok'], [96, -2, 'ok'], [64, -1, 'low'], [52, -2, 'urgent'], [71, 1, 'ok'], [104, 2, 'ok'],
    ];
    const series = [150, 146, 140, 138, 135, 133, 132];
    previewing = true;
    steps.forEach(([v, trend, kind], i) => setTimeout(() => {
      series.push(v);
      show({ kind, v, trend, minutes: 0, self: true, spark: demoSpark(series.slice(-12)), at: Date.now() });
      if (i === 0) { slide.classList.add('pin'); showSlide(0); }
    }, i * 1700));
    setTimeout(() => { previewing = false; slide.classList.remove('pin'); show(real); showSlide(0); }, steps.length * 1700 + 1200);
  };
})();
