// Apps tab (2.0's copy of views/apps.js): pinned launcher, up to 36 apps in pages of 6 x 2 that
// slide sideways (drag, the mouse wheel, or the dots in the bar). A click brings the app's open
// window to the front (or starts it), a right-click opens a new window; a dot marks the apps that
// are open, and those come first unless "Open apps first" is off. Add opens the Start menu picker;
// Edit shows the pinned order, where tiles can be removed (×) and dragged to a new position.
(() => {
  const grid = $('#apps-grid');
  const picker = $('#apps-picker');
  const listEl = $('#apps-list');
  const search = $('#apps-search');
  const addBtn = $('#apps-add');
  const editBtn = $('#apps-edit');
  const hint = $('#apps-hint');
  const MAX_PINNED = 36;
  const PER_PAGE = 12;
  const dots = document.createElement('span');
  dots.className = 'apps-dots';
  hint.after(dots);
  const SPRING = 'transform .32s cubic-bezier(.3, 1.3, .42, 1)';

  let pinned = [];
  let catalog = null;
  let editing = false;
  let drag = null;
  let running = new Set();

  const iconHtml = (a) => (a.icon ? `<img src="${a.icon}" alt="" draggable="false">` : esc((a.name || '?').trim()[0] || '?'));

  function updateBar() {
    editBtn.textContent = editing ? 'Done' : 'Edit';
    editBtn.classList.toggle('on', editing);
    editBtn.disabled = !pinned.length && !editing;
    addBtn.disabled = pinned.length >= MAX_PINNED;
    hint.textContent = editing
      ? 'Drag to reorder · × to remove'
      : `${pinned.length}/${MAX_PINNED} · Right-click for a new window`;
  }

  function setEditing(on) {
    if (editing === on) return;
    editing = on;
    renderGrid();
  }

  // what the grid shows: the open apps first (not while editing, which shows the real order)
  const shown = () => (editing || !feat('appsRunningFirst') ? pinned : [...pinned.filter((a) => running.has(a.id)), ...pinned.filter((a) => !running.has(a.id))]);
  const pageCount = () => Math.max(1, Math.ceil(grid.querySelectorAll('.app').length / PER_PAGE));
  const page = () => Math.round(grid.scrollLeft / Math.max(1, grid.clientWidth));
  const goPage = (n, smooth = true) => grid.scrollTo({ left: Math.max(0, Math.min(pageCount() - 1, n)) * grid.clientWidth, behavior: smooth ? 'smooth' : 'instant' });

  function renderDots() {
    const n = pageCount();
    dots.hidden = n < 2;
    dots.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const d = document.createElement('button');
      d.className = `dot${i === page() ? ' on' : ''}`;
      d.setAttribute('aria-label', `Page ${i + 1}`);
      d.addEventListener('click', () => goPage(i));
      dots.append(d);
    }
  }
  grid.addEventListener('scroll', () => dots.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('on', i === page())));
  // the wheel turns the pages
  let wheelAt = 0;
  grid.addEventListener('wheel', (e) => {
    if (pageCount() < 2) return;
    e.preventDefault();
    if (Date.now() - wheelAt < 350) return;
    wheelAt = Date.now();
    goPage(page() + (e.deltaY + e.deltaX > 0 ? 1 : -1));
  }, { passive: false });

  function renderGrid() {
    const at = page();
    grid.innerHTML = '';
    grid.classList.add('paged');
    if (!pinned.length) {
      grid.innerHTML = '<div class="apps-empty">No apps yet. Use Add to pin your favourites.</div>';
    }
    let box = null;
    shown().forEach((a, i) => {
      if (i % PER_PAGE === 0) {
        box = document.createElement('div');
        box.className = 'apps-page';
        grid.append(box);
      }
      const b = document.createElement('button');
      b.className = `app${running.has(a.id) ? ' running' : ''}`;
      b.dataset.id = a.id;
      b.title = `${a.name}
Right-click for a new window`;
      b.innerHTML =
        `<span class="app-ico ${a.icon ? '' : 'letter'}">${iconHtml(a)}</span>` +
        `<span class="app-name">${esc(a.name)}</span>` +
        `<span class="x" role="button" aria-label="Remove ${esc(a.name)}">${ICON_X}</span>`;
      b.addEventListener('click', (e) => {
        if (editing) {
          if (e.target.closest('.x')) bridge.apps.remove(a.id);
          return;
        }
        bridge.apps.launch(a.id);
        setTimeout(refreshRunning, 1500);
      });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (editing) return;
        bridge.apps.launch(a.id, true);
        setTimeout(refreshRunning, 1500);
      });
      box.append(b);
    });
    grid.classList.toggle('editing', editing);
    updateBar();
    renderDots();
    goPage(at, false);
  }

  // ---------- drag to reorder (edit mode) ----------
  grid.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.app');
    if (!editing || !el || e.button !== 0 || e.target.closest('.x')) return;
    drag = { el, id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
    el.setPointerCapture(e.pointerId);
  });

  grid.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { el } = drag;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      drag.moved = true;
      el.classList.add('lifted');
    }
    el.style.transform = `translate(${e.clientX - drag.sx}px, ${e.clientY - drag.sy}px)`;

    const tiles = [...grid.querySelectorAll('.app')];
    const target = tiles.find((t) => {
      if (t === el) return false;
      const r = t.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    // held at the left or right edge: the page beside it
    const gr = grid.getBoundingClientRect();
    if ((e.clientX < gr.left + 12 || e.clientX > gr.right - 12) && Date.now() - (drag.turned || 0) > 700) {
      drag.turned = Date.now();
      goPage(page() + (e.clientX < gr.left + 12 ? -1 : 1));
    }
    if (!target) return;

    // FLIP: remember where everything was, move the tile in the DOM, animate the others
    const others = tiles.filter((t) => t !== el);
    const first = new Map(others.map((t) => [t, t.getBoundingClientRect()]));
    const before = { x: el.offsetLeft, y: el.offsetTop };
    const forward = tiles.indexOf(el) < tiles.indexOf(target);
    target.parentNode.insertBefore(el, forward ? target.nextSibling : target);
    drag.sx += el.offsetLeft - before.x;
    drag.sy += el.offsetTop - before.y;
    el.style.transform = `translate(${e.clientX - drag.sx}px, ${e.clientY - drag.sy}px)`;
    for (const t of others) {
      const f = first.get(t);
      const r = t.getBoundingClientRect();
      const dx = f.left - r.left;
      const dy = f.top - r.top;
      if (!dx && !dy) continue;
      t.style.transition = 'none';
      t.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        t.style.transition = SPRING;
        t.style.transform = '';
      });
    }
  });

  function endDrag() {
    if (!drag) return;
    const { el, moved } = drag;
    drag = null;
    if (!moved) return;
    el.classList.remove('lifted');
    el.style.transition = SPRING;
    el.style.transform = '';
    setTimeout(() => (el.style.transition = ''), 350);
    const ids = [...grid.querySelectorAll('.app')].map((t) => t.dataset.id);
    pinned = ids.map((id) => pinned.find((p) => p.id === id)).filter(Boolean);
    bridge.apps.reorder(ids);
    renderGrid(); // pages of 12 again
  }
  grid.addEventListener('pointerup', endDrag);
  grid.addEventListener('pointercancel', endDrag);

  // ---------- picker ----------
  function renderList() {
    if (!catalog) {
      listEl.innerHTML = '<div class="clip-empty">Loading apps…</div>';
      return;
    }
    const q = search.value.trim().toLowerCase();
    const ids = new Set(pinned.map((p) => p.id));
    const items = catalog.filter((a) => !q || a.name.toLowerCase().includes(q)).slice(0, 150);
    listEl.innerHTML = '';
    if (!items.length) listEl.innerHTML = '<div class="clip-empty">No apps found</div>';
    for (const a of items) {
      const b = document.createElement('button');
      const on = ids.has(a.id);
      b.className = `pick${on ? ' on' : ''}`;
      b.title = on ? `Remove ${a.name}` : `Add ${a.name}`;
      b.innerHTML = `${a.icon ? `<img src="${a.icon}" alt="">` : `<span class="ph">${esc(a.name[0] || '?')}</span>`}<span>${esc(a.name)}</span>`;
      b.disabled = !on && pinned.length >= MAX_PINNED;
      b.addEventListener('click', () => (on ? bridge.apps.remove(a.id) : bridge.apps.add(a.id)));
      listEl.append(b);
    }
  }

  async function openPicker() {
    setEditing(false);
    picker.hidden = false;
    search.value = '';
    renderList();
    if (!catalog) {
      catalog = await bridge.apps.all();
      renderList();
    }
  }

  function closePicker() {
    if (picker.hidden) return;
    picker.hidden = true;
    search.blur();
    bridge.focusInput(false);
  }

  // the window is not focusable by default; ask for focus only while typing
  search.addEventListener('pointerdown', () => {
    bridge.focusInput(true);
    setTimeout(() => search.focus(), 60);
  });
  search.addEventListener('input', renderList);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePicker();
  });
  $('#apps-done').addEventListener('click', closePicker);

  addBtn.addEventListener('click', openPicker);
  editBtn.addEventListener('click', () => setEditing(!editing));
  grid.addEventListener('contextmenu', (e) => e.preventDefault());

  // the dots: asked when the Apps tab is on screen, not all the time
  async function refreshRunning() {
    if (lastMode !== 'expanded' || state.tab !== 'apps') return;
    const ids = new Set(await bridge.apps.running());
    if ([...ids].sort().join('|') === [...running].sort().join('|')) return;
    running = ids;
    // the open apps move to the front
    if (!drag) renderGrid();
  }
  window.addEventListener('island:mode', (e) => { if (e.detail.mode === 'expanded') refreshRunning(); });
  $('.tab[data-tab="apps"]').addEventListener('click', refreshRunning);

  window.addEventListener('island:mode', (e) => {
    if (e.detail.mode !== 'expanded') {
      closePicker();
      setEditing(false);
    }
  });

  const apply = (list) => {
    pinned = list;
    if (!pinned.length && editing) editing = false;
    if (!drag) renderGrid();
    if (!picker.hidden) renderList();
  };
  bridge.onApps(apply);
  bridge.apps.list().then(apply);
})();
