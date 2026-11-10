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
    if (icon) document.querySelector('.t-shot').src = icon;
    t.style.setProperty('--app-rgb', rgb ? rgb.join(', ') : 'var(--accent-rgb)');
    // a text that doesn't fit scrolls once to its end, and the notice waits for it
    requestAnimationFrame(() => {
      const label = document.getElementById('t-label');
      if (!label || label.textContent !== text) return;
      const span = document.createElement('span');
      span.textContent = text;
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
  bridge.onAppNotice((notice) => {
    if (state.features.appNotices === false) return;
    // Pady's quick notices never wait behind another: the drop hangs below the island
    if (notice.app === 'pady' && window.padyDrop) { if (state.visible) window.padyDrop(notice); return; }
    const who = sender(notice);
    if (who === 'claude' && Date.now() - (lastAt.get(who) || 0) < 4000) return;
    lastAt.set(who, Date.now());
    if (queue.length >= 20) queue.shift();
    queue.push(notice);
    next();
  });
  const requestNext = () => queueMicrotask(next);
  window.addEventListener('island:mode', requestNext);
  window.addEventListener('island:toast-end', requestNext);
  bridge.onVisibility(requestNext);
})();
