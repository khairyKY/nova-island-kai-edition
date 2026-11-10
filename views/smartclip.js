// Smart clipboard toasts: what was just copied, and one click to act on it.
(() => {
  let idmOnline = false;
  bridge.onDownloads((p) => { idmOnline = !!p?.online && !p?.outdated; });

  bridge.onClipSmart((s) => {
    if (!feat('smartClipboard') || cardShowing()) return;
    switch (s.type) {
      case 'url': {
        const dl = idmOnline;
        showToast('clip-url', s.host, dl ? 'Download' : 'Open', 0, 5000, () => bridge.clipAction(dl ? 'download' : 'open'));
        break;
      }
      case 'color':
        island.style.setProperty('--sw', s.color);
        showToast('clip-color', s.color, '', 0, 3000);
        break;
      case 'math':
        showToast('clip-math', `${s.expr} =`, s.result, 0, 6000, () => {
          bridge.clipAction('copy');
          showToast('done', 'Copied', s.result, 0, 1400);
        });
        break;
      case 'text':
        showToast('clip-text', `${s.words.toLocaleString()} words`, `${s.chars.toLocaleString()} chars`, 0, 2600);
        break;
      default:
        break;
    }
  });
})();
