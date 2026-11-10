// The reminder card's copy button (2.0): the verse, dhikr, du'a or hadith on the card goes to the
// clipboard as plain text, with its source on the next line when it has one (the surah and verse
// number). The app writes it, quietly: it doesn't land in Nova's own clipboard history. The
// button shows a tick for a moment.
(() => {
  const btn = document.getElementById('rm-copy');
  const text = document.getElementById('rm-text');
  const ref = document.getElementById('rm-ref');
  if (!btn || !text || !bridge.copyText) return;
  const COPY = btn.innerHTML;
  const TICK = '<svg class="s" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7"/></svg>';
  let back = null;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const body = (text.innerText || '').replace(/\s+/g, ' ').trim();
    if (!body) return;
    const src = (ref.innerText || '').replace(/\s+/g, ' ').trim();
    bridge.copyText(src ? `${body}\n${src}` : body);
    btn.innerHTML = TICK;
    btn.classList.add('done');
    clearTimeout(back);
    back = setTimeout(() => {
      btn.innerHTML = COPY;
      btn.classList.remove('done');
    }, 1600);
  });
})();
