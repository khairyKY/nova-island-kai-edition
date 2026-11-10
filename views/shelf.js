// Shelf tab: files dropped on the island. Click opens, right-click reveals, drag out to use.
// Screenshots put there on their own show the time left before they leave the shelf.
(() => {
  const view = $('#v-shelf');
  const itemsEl = $('#shelf-items');
  const count = $('#shelf-count');
  const badge = $('#shelf-badge');
  let current = [];

  const timeLeft = (until) => {
    const m = Math.max(1, Math.ceil((until - Date.now()) / 60000));
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
  };
  setInterval(() => {
    for (const el of itemsEl.querySelectorAll('[data-until]')) el.textContent = timeLeft(Number(el.dataset.until));
  }, 30 * 1000);

  function renderItems(items) {
    current = items;
    view.classList.toggle('empty-shelf', !items.length);
    badge.classList.toggle('on', items.length > 0);
    count.textContent = `${items.length} ${items.length === 1 ? 'file' : 'files'}`;
    itemsEl.innerHTML = '';
    for (const f of items) {
      const d = document.createElement('div');
      d.className = f.preview ? 'file has-preview' : 'file';
      d.draggable = true;
      d.title = `${f.path}\nClick to open · Right-click to show in folder · Drag to use`;
      d.innerHTML =
        `${f.preview ? `<img class="preview" src="${f.preview}" alt="Preview of ${esc(f.name)}">` : f.icon ? `<img src="${f.icon}" alt="">` : ''}` +
        `<span class="fname" dir="auto">${esc(f.name)}</span>` +
        `${f.until ? `<span class="left" data-until="${f.until}" title="Leaves the Shelf on its own">${timeLeft(f.until)}</span>` : ''}` +
        `<button class="x" aria-label="Remove ${esc(f.name)}">${ICON_X}</button>`;
      d.addEventListener('click', (e) => {
        if (e.target.closest('.x')) bridge.shelf.remove(f.path);
        else bridge.shelf.open(f.path);
      });
      d.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        bridge.shelf.reveal(f.path);
      });
      d.addEventListener('dragstart', (e) => {
        e.preventDefault();
        internalDrag = true;
        bridge.shelf.startDrag(f.path);
      });
      itemsEl.append(d);
    }
  }

  itemsEl.addEventListener('wheel', (e) => {
    // vertical wheel scrolls the row horizontally
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) itemsEl.scrollLeft += e.deltaY;
  });

  $('#shelf-clear').addEventListener('click', () => bridge.shelf.clear());

  bridge.onShelf(renderItems);
  bridge.shelf.list().then(renderItems);
})();
