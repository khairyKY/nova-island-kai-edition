// Other apps' notifications on the island, the way the original Nova Island 1.8 shows them ("appnote"):
// one line in the pill with the app's icon, a soft wash of the app's colour from the left, its name
// and text (scrolling when it doesn't fit) and an Open button in the app's colour. They come from
// Windows' own notifications (mirrored by the helper) and from local senders such as Claude Code's
// hooks. Pady's notices are the exception: they fall out of the island as a drop (pady-drop.js).
(() => {
  // senders that don't come with an icon or colour of their own
  const KNOWN = {
    claude: {
      rgb: [217, 119, 87],
      aumid: 'Claude_pzs8sxrjxfjjc!Claude', // the Claude app, so Open brings it to the front
      icon: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2.5v19M2.5 12h19M5.3 5.3l13.4 13.4M18.7 5.3 5.3 18.7" stroke="#d97757" stroke-width="2.6" stroke-linecap="round"/></svg>'),
    },
  };
  const queue = [];
  // Claude can tell us twice about one moment (its own Windows notification, mirrored, and Claude
  // Code's hook): a second Claude notice within a few seconds is the same news
  const lastAt = new Map();
  const sender = (n) => (n.app === 'claude' || /^Claude_/.test(n.aumid || '') ? 'claude' : n.aumid || n.app);
  // The same news through two doors: an app that also sends its notices to the island directly
  // (Kai's Flow, Claude Code's hooks) raises a Windows notification too, which is mirrored here.
  // Titles seen in the last few seconds are remembered, and a mirrored copy of one is dropped.
  const KAIS_FLOW = 'com.kaisflow.garden';
  const recent = [];
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const seen = (title) => { recent.push([norm(title), Date.now()]); while (recent.length > 20) recent.shift(); };
  const seenRecently = (title) => { const t = norm(title); return !!t && recent.some(([r, at]) => Date.now() - at < 10000 && (r === t || r.startsWith(t) || t.startsWith(r))); };
  bridge.onKaiNotice((n) => seen(n.title));

  // right to left when most of its letters are from a right-to-left script
  const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/g;
  const LTR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/g;
  function direction(s) {
    const r = (String(s).match(RTL) || []).length, l = (String(s).match(LTR) || []).length;
    return r > l ? 'rtl' : r || l ? 'ltr' : 'auto';
  }

  // Windows hands over many app logos with lots of empty transparent space around them, so the logo
  // came out tiny in its 22 px: the empty border is trimmed off (once per icon)
  const trimmed = new Map();
  function trimIcon(src) {
    if (trimmed.has(src)) return Promise.resolve(trimmed.get(src));
    return new Promise((done) => {
      const keep = (out) => { if (trimmed.size > 60) trimmed.delete(trimmed.keys().next().value); trimmed.set(src, out); done(out); };
      const img = new Image();
      img.onerror = () => keep(src);
      img.onload = () => {
        const w = img.naturalWidth || 64, h = img.naturalHeight || 64;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, w, h);
        let px;
        try { px = x.getImageData(0, 0, w, h).data; } catch { return keep(src); }
        let top = h, left = w, bottom = -1, right = -1;
        for (let y = 0; y < h; y++) {
          for (let i = 0; i < w; i++) {
            if (px[(y * w + i) * 4 + 3] > 24) {
              if (y < top) top = y; if (y > bottom) bottom = y;
              if (i < left) left = i; if (i > right) right = i;
            }
          }
        }
        if (right < 0) return keep(src);
        const bw = right - left + 1, bh = bottom - top + 1, side = Math.max(bw, bh);
        if (side >= Math.max(w, h) * 0.86) return keep(src); // it already fills its square
        const pad = Math.round(side * 0.04), size = side + pad * 2;
        const o = document.createElement('canvas');
        o.width = o.height = size;
        o.getContext('2d').drawImage(c, left, top, bw, bh, pad + (side - bw) / 2, pad + (side - bh) / 2, bw, bh);
        keep(o.toDataURL('image/png'));
      };
      img.src = src;
    });
  }

  function show(n) {
    const known = KNOWN[n.app] || {};
    const icon = n.icon || known.icon || '';
    const rgb = Array.isArray(n.rgb) ? n.rgb : known.rgb;
    const aumid = n.aumid || known.aumid || '';
    const head = n.title || n.app;
    const text = (n.body ? `${head}: ${n.body}` : head) + (n.more ? ` (+${n.more})` : '');
    showToast('appnote', text, aumid ? 'Open' : '', 0, 6000, aumid ? () => bridge.appNotifyOpen(aumid) : null);
    const t = document.querySelector('.l-toast');
    t.classList.toggle('noicon', !icon);
    const shot = document.querySelector('.t-shot');
    if (icon) {
      shot.src = icon;
      shot.dataset.icon = icon;
      trimIcon(icon).then((src) => { if (shot.dataset.icon === icon) shot.src = src; }); // (still this notice's)
    }
    t.style.setProperty('--app-rgb', rgb ? rgb.join(', ') : 'var(--accent-rgb)');
    // a message in Arabic (or Hebrew, Persian...) reads right to left, even when the sender's name
    // before it is in Latin letters: the direction comes from the message itself
    const label = document.getElementById('t-label');
    label.dir = direction(n.body || head);
    // a text that doesn't fit scrolls once to its end, and the notice waits for it
    requestAnimationFrame(() => {
      if (!label || label.textContent !== text) return;
      // the name and the message each keep their own direction (<bdi>), so mixed scripts and the
      // punctuation between them don't get shuffled
      const span = document.createElement('span');
      const part = (s) => { const b = document.createElement('bdi'); b.textContent = s; return b; };
      if (n.body) span.append(part(head), ': ', part(n.body));
      else span.append(part(head));
      if (n.more) span.append(` (+${n.more})`);
      label.textContent = '';
      label.append(span);
      const over = span.offsetWidth - label.clientWidth;
      if (over <= 4) return;
      const rtl = getComputedStyle(label).direction === 'rtl';
      const ms = Math.max(2500, (over / 45) * 1000);
      span.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${rtl ? over : -over}px)` }], { duration: ms, delay: 1200, fill: 'forwards', easing: 'linear' });
      const total = 1200 + ms + 2000;
      if (total > 6000) {
        state.toastUntil = Date.now() + total;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(dismissToast, total + 50);
        render();
      }
    });
  }

  function next() {
    if (!queue.length) return;
    const mode = currentMode();
    if (!state.visible || ['expanded', 'scene', 'reminder'].includes(mode) || Date.now() < state.toastUntil) return;
    show(queue.shift());
  }
  // Settings > Animations preview: straight to the island (no dedupe, no per-app pause)
  window.previewAppNotice = (notice) => { queue.push(notice); next(); };
  bridge.onAppNotice((notice) => {
    if (state.features.appNotices === false) return;
    // Pady's quick notices never wait behind another: the drop hangs below the island
    if (notice.app === 'pady') {
      // a hint about the gesture that opens the island says nothing the island opening doesn't
      if (/ctrl\+alt\+i/i.test(notice.title)) return;
      if (state.features.padyDrops !== false && state.visible && window.padyDrop) window.padyDrop(notice);
      return;
    }
    const mirrored = !!notice.aumid && !KNOWN[notice.app];
    // Kai's Flow's own notices come through its own channel (with its card) while that's on
    if (mirrored && notice.aumid === KAIS_FLOW && state.features.kaiNotifications) return;
    if (mirrored && seenRecently(notice.title)) return;
    const who = sender(notice);
    if (who === 'claude' && Date.now() - (lastAt.get(who) || 0) < 12000) return;
    lastAt.set(who, Date.now());
    seen(notice.title);
    if (queue.length >= 20) queue.shift();
    queue.push(notice);
    next();
  });
  const requestNext = () => queueMicrotask(next);
  window.addEventListener('island:mode', requestNext);
  window.addEventListener('island:toast-end', requestNext);
  bridge.onVisibility(requestNext);
})();
