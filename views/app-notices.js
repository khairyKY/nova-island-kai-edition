// Other apps' notices (Claude Code through its hooks): the island's own notice style, in the
// app's accent colour. Kai's Flow keeps its botanical card; these never borrow it.
(() => {
  const APPS = {
    claude: { name: 'Claude', rgb: '217, 119, 87', icon: 'spark' },
  };
  const queue = [];
  function next() {
    if (!queue.length) return;
    const mode = currentMode();
    if (!state.visible || ['expanded', 'scene', 'reminder'].includes(mode) || Date.now() < state.toastUntil) return;
    const notice = queue.shift();
    const app = APPS[notice.app] || { name: notice.app, rgb: '', icon: 'bell' };
    if (app.rgb) island.style.setProperty('--app-rgb', app.rgb);
    else island.style.removeProperty('--app-rgb');
    showToast('app-notice', notice.title, notice.body, 0, (state.features.kaiNoticeSeconds || 8) * 1000);
    const toast = document.querySelector('.l-toast');
    toast.dataset.source = notice.label ? `${app.name} · ${notice.label}` : app.name;
    toast.dataset.icon = app.icon;
  }
  bridge.onAppNotice((notice) => {
    if (state.features.appNotices === false) return;
    if (queue.length >= 20) queue.shift();
    queue.push(notice);
    next();
  });
  const requestNext = () => queueMicrotask(next);
  window.addEventListener('island:mode', requestNext);
  window.addEventListener('island:toast-end', requestNext);
  bridge.onVisibility(requestNext);
})();
