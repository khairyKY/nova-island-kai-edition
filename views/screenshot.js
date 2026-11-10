// Copied image / screenshot: a toast with the thumbnail. With "Save screenshots to Shelf" on, main
// already put it on the Shelf for a while ("Added to Shelf ✓", a click opens the Shelf);
// otherwise clicking saves it to Pictures\Nova Island and puts it on the Shelf.
(() => {
  bridge.onScreenshot((s) => {
    $('.t-shot').src = s.thumb;
    const portrait = s.height > s.width;
    if (s.auto) {
      showToast('shot-auto', portrait ? 'Image saved' : 'Screenshot saved', 'Added to Shelf ✓', 0, 4500, () => {
        selectTab('shelf');
        state.hover = true;
        render();
      });
      return;
    }
    const canSave = feat('tabShelf');
    showToast('shot', portrait ? 'Image copied' : 'Screenshot copied', canSave ? 'Add to Shelf' : '', 0, 6000, canSave ? () => bridge.shotToShelf() : null);
  });
  bridge.onShotSaved((s) => showToast('shot-saved', s.name, 'On the Shelf', 0, 2600));
})();
