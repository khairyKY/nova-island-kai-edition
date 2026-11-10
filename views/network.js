// Network companion: a toast when Wi-Fi connects, the internet drops, or it comes back (with how
// long it was gone), and the current connection in the System tab.
(() => {
  let downAt = 0;

  const label = (n) => (n.link === 'wifi' ? 'Wi-Fi' : n.link === 'ethernet' ? 'Ethernet' : 'Offline');
  const ago = (ms) => {
    const m = Math.round(ms / 60000);
    return m < 1 ? 'after a few seconds' : m < 60 ? `after ${m} min` : `after ${Math.floor(m / 60)} h ${m % 60} min`;
  };

  function row(n) {
    const off = n.link === 'none' || n.internet === false;
    $('#net-row').classList.toggle('off', off);
    const net = n.link !== 'none' && n.internet === false ? `${label(n)} · no internet` : label(n);
    $('#net-val').textContent = $('#net-val').title = net;
  }

  function update(n) {
    row(n);
    const p = n.prev;
    // the first reading after start is not news
    if (!p || p.internet === null || !feat('netToasts')) return;
    if (p.internet && n.internet === false) {
      downAt = Date.now();
      island.classList.add('net-down');
      setTimeout(() => island.classList.remove('net-down'), 4600);
      showToast('net-off', n.link === 'none' ? 'No connection' : 'Internet lost', '', 0, 4500);
      note('📡', 'Internet lost');
    } else if (p.internet === false && n.internet) {
      const gone = downAt ? Date.now() - downAt : 0;
      showToast('net-on', 'Back online', gone ? ago(gone) : label(n), 0, 3500);
      note('📶', `Back online ${gone ? ago(gone) : ''}`.trim());
      downAt = 0;
    } else if (n.link === 'wifi' && p.link !== 'wifi' && n.internet) {
      showToast('net-on', 'Connected to Wi-Fi', '', 0, 3000);
    }
  }

  bridge.onNetwork(update);
  bridge.network().then((n) => n && row(n));
})();
