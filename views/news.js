// News from the Nova team (main reads and checks news.json): a new item shows once as a toast
// for 30 s, only when the island is free (on screen, nothing else showing, not open); a click
// opens its link. Every item shown stays in the bell's list (header, beside the gear) until closed
// with ✕, and the bell has a dot while one is unread; opening the list reads them all.
(() => {
  const bell = $('#open-news');
  const list = $('#v-news .news-list');
  let next = null;
  let cards = [];

  function render() {
    // the bell stays; only "News from Nova" turned off in Settings takes it away
    bell.hidden = state.features?.news === false;
    bell.classList.toggle('unread', cards.some((c) => c.unread));
    list.innerHTML = cards.slice().reverse().map((c) => `
      <div class="news-item ${esc(c.type)}${c.unread ? ' unread' : ''}" data-id="${esc(c.id)}">
        <span class="news-dot"></span>
        <div class="news-txt"><b dir="auto">${esc(c.title)}</b>${c.body ? `<small dir="auto">${esc(c.body)}</small>` : ''}</div>
        <button class="news-x" aria-label="Close">${ICON_X}</button>
      </div>`).join('') || '<div class="news-empty">No news yet</div>';
    // turned off while the list is open: back to the first tab
    if (bell.hidden && state.tab === 'news') {
      const first = [...$$('.tab')].find((b) => !b.hidden);
      if (first) selectTab(first.dataset.tab);
    }
  }

  // the unread ones become read once the list is on screen
  function readAll() {
    const ids = cards.filter((c) => c.unread).map((c) => c.id);
    if (ids.length) bridge.newsRead(ids);
  }

  bell.addEventListener('click', () => {
    selectTab('news');
    readAll();
  });

  list.addEventListener('click', (e) => {
    const item = e.target.closest('.news-item');
    if (!item) return;
    if (e.target.closest('.news-x')) bridge.newsDismiss(item.dataset.id);
    else bridge.newsOpen(item.dataset.id);
  });

  const free = () => state.visible && (lastMode === 'idle' || lastMode === 'compact') && !state.pinned;

  function tryShow() {
    if (!next || !free()) return;
    const item = next;
    next = null;
    showToast(`news ${item.type}`, item.title, item.link ? 'Open' : '', 0, 30000, item.link ? () => bridge.newsOpen(item.id) : null);
    bridge.newsShown(item.id);
  }
  setInterval(tryShow, 5000);

  // "News from Nova" switched in Settings (renderer.js has already stored the new features)
  bridge.onFeatures(render);
  render();

  bridge.onNews((n) => {
    cards = n.cards || [];
    next = n.next;
    render();
    if (state.tab === 'news' && lastMode === 'expanded') readAll();
    tryShow();
  });
})();
