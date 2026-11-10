// A new version is downloaded: a toast with "Update now" (main re-sends it on every update
// check, so an ignored one comes back; it also installs when the app quits). "Update now" first
// says Nova is about to restart, counting down 10 seconds, then installs and reopens.
(() => {
  const COUNTDOWN_S = 10;
  let timer = null;

  function countdown() {
    if (timer) return;
    let left = COUNTDOWN_S;
    // stays put under the cursor; a click just shows it again
    const show = () => {
      showToast('updating', 'Updating · back in a few seconds', String(left), 0, left * 1000 + 600, show);
    };
    show();
    timer = setInterval(() => {
      left -= 1;
      if (left > 0) {
        $('#t-value').textContent = String(left);
        $('#vt-value').textContent = String(left);
        return;
      }
      clearInterval(timer);
      bridge.installUpdate();
    }, 1000);
  }

  bridge.onUpdate((u) => {
    if (timer) return;
    showToast('update', `Update ready · ${u.version}`, 'Update now', 0, 20000, countdown);
  });
})();
