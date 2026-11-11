// Preserve desktop notices while a panel, reminder or scene is already using the island.
(() => {
  const queue = [];
  const labels = {
    task_reminder: 'Task reminder', focus_done: 'Focus complete', test: 'Test notification',
    morning_digest: 'Morning digest', evening_nudge: 'Evening nudge', overdue: 'Overdue',
    claude_input: 'Needs you', claude_done: 'Finished',
  };
  const switches = {
    task_reminder: 'kaiTaskReminders', focus_done: 'kaiFocusDone', test: 'kaiTestNotices',
  };
  function allowed(notice) {
    return !!state.features.kaiNotifications && (notice.preview || !switches[notice.kind] || feat(switches[notice.kind]));
  }
  function next() {
    while (queue.length && !allowed(queue[0])) queue.shift();
    if (!queue.length) return;
    const mode = currentMode();
    if (!state.visible || ['expanded', 'scene', 'reminder'].includes(mode) || Date.now() < state.toastUntil) return;
    const notice = queue.shift();
    const toast = document.querySelector('.l-toast');
    toast.dataset.kind = notice.kind;
    const claude = notice.kind.startsWith('claude_');
    toast.dataset.source = (claude ? 'Claude · ' : 'Kai’s Flow · ') + (labels[notice.kind] || 'Notification');
    const duration = (state.features.kaiNoticeSeconds || 8) * 1000;
    showToast('kai-flow', notice.title, notice.body, 0, duration, claude ? null : () => bridge.apps.launch('com.kaisflow.garden'));
  }
  window.previewKaiNotice = (notice) => { queue.push(notice); next(); }; // Settings > Animations preview
  bridge.onKaiNotice((notice) => {
    if (!allowed(notice)) return;
    if (queue.length >= 20) queue.shift();
    queue.push(notice);
    next();
  });
  const requestNext = () => queueMicrotask(next);
  window.addEventListener('island:features', requestNext);
  window.addEventListener('island:mode', requestNext);
  window.addEventListener('island:toast-end', requestNext);
  bridge.onVisibility(requestNext);
  $('#kai-notice-close').addEventListener('click', event => {
    event.stopPropagation();
    if (lastMode !== 'toast' || state.toast !== 'kai-flow') return;
    state.hover = false;
    dismissToast();
  });
})();
