(() => {
  const button = $('#spotify-like');
  const feedback = $('#spotify-feedback');
  let spotify = {connected:false}, completed = '', failed = false, messageTimer = null;
  function draw() {
    const active = state.media.has && state.media.source?.id === 'spotify';
    button.hidden = !active;
    const track = spotify.track;
    button.disabled = active && spotify.connected && (!track || spotify.pending);
    button.setAttribute('aria-pressed', String(!!track?.liked));
    button.setAttribute('aria-busy', String(!!spotify.pending));
    button.setAttribute('aria-label', !spotify.connected ? 'Connect Spotify to save songs' : !track ? 'Song saving unavailable for this track' :
      track.liked ? 'Remove from Liked Songs' : 'Save to Liked Songs');
    const text = active ? completed : '';
    feedback.hidden = !text;
    feedback.textContent = text;
    feedback.classList.toggle('error', failed);
  }
  bridge.onSpotify(value => { if(spotify.track?.id !== value.track?.id){completed='';clearTimeout(messageTimer);} spotify=value;draw(); });
  bridge.spotifyStatus().then(value=>{if(value){spotify=value;draw();}});
  window.addEventListener('island:media', draw);
  button.addEventListener('click', async () => {
    if (!spotify.connected) { bridge.openSettings('island'); return; }
    const id=spotify.track?.id, liked=!spotify.track?.liked;
    if (!id || spotify.pending) return;
    const result=await bridge.spotifyLike(id,liked);
    if (spotify.track?.id === id) {
      failed=!result?.ok;
      completed=result?.ok ? liked ? 'Saved to Liked Songs' : 'Removed from Liked Songs' : result?.error || 'Couldn’t save this song.';
      clearTimeout(messageTimer);messageTimer=setTimeout(()=>{completed='';draw();},failed?5000:2500);
      draw();
    }
  });
})();
