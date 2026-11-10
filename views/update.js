// A new version is downloaded (2.0, in place of 1.x's): it can't be missed now.
//   the card    "Update ready · 1.8.x · Update now" stays a minute, and comes back every 15
//               minutes until the update is installed (1.x showed it 20 s, again every 6 hours)
//   the dot     a small green dot on the island the whole time an update is waiting
//   Settings    "Update now" in Settings > General asks the island to do what its own card does
// "Update now" first says Nova is about to restart, counting down 10 seconds, then installs and
// reopens. It also installs when the app quits.
(() => {
  const COUNTDOWN_S = 10;
  const SHOW_MS = 60_000;
  const AGAIN_MS = 15 * 60_000;
  let timer = null;
  let ready = null;
  let again = null;

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

  function offer() {
    if (timer || !ready) return;
    showToast('update', `Update ready · ${ready}`, 'Update now', 0, SHOW_MS, countdown);
  }

  bridge.onUpdate((u) => {
    if (timer || !u || !u.version) return;
    const first = ready == null;
    ready = u.version;
    island.classList.add('update-ready');
    offer();
    if (first || !again) {
      clearInterval(again);
      again = setInterval(offer, AGAIN_MS);
    }
  });
  // Settings' "Update now"
  bridge.onUpdateNow?.(() => {
    if (ready) countdown();
  });
})();
