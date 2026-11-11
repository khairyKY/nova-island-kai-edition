// One image at a time, using small copies of the user's transparent artwork.
(() => {
  const poses = new Map(PhoenixStates.map(pose => [pose.id,pose]));
  const idleImage = $('#phoenix-idle');
  let near = null, nearSince = 0, idleSeconds = 0, dwellTimer = null, blinkUntil = 0;
  let celebrationUntil = 0, celebrationTimer = null;
  const style = () => state.features.companionStyle || 'phoenix';
  const enabled = id => PhoenixStates.usesArtwork(style()) && !!poses.get(id) && feat(poses.get(id).key);
  function paint(image,id,characterStyle = style()) {
    const pose = poses.get(id);
    if (!pose) return;
    const src = PhoenixStates.sourceFor(pose,characterStyle);
    if (image.dataset.src === src) return;
    image.dataset.src = src;
    image.dataset.pose = id;
    image.src = src;
  }
  function idlePose() {
    if (!PhoenixStates.usesArtwork(style()) || !state.visible || state.hover || state.moving || lastMode !== 'idle') return null;
    const lingered = near && Date.now() - nearSince >= 3000;
    if (idleSeconds >= 120 && !near && enabled('resting')) return 'resting';
    if (!lingered) return null;
    if (style() === 'zaher-standing') return enabled('idle') ? 'idle' : null;
    if (Date.now() < blinkUntil && enabled('idle-blink') && !state.features.noAnimations) return 'idle-blink';
    if (near.dx < -20 && enabled('idle-look-left')) return 'idle-look-left';
    if (near.dx > 20 && enabled('idle-look-right')) return 'idle-look-right';
    return enabled('idle') ? 'idle' : null;
  }
  function drawIdle() {
    const pose = idlePose();
    island.classList.toggle('phoenix-idle',!!pose);
    if(pose)paint(idleImage,pose);
  }
  function select(scene,elapsed = 0) {
    const sequence = [{pose:scene.phoenixPose,at:0},...(scene.phoenixSequence || [])]
      .filter(step => poses.has(step.pose) && (scene.phoenixPreview || enabled(step.pose)));
    return sequence.filter(step => step.at <= elapsed).at(-1)?.pose || sequence[0]?.pose || null;
  }
  function showMoment(item,id) {
    if (!enabled(id) || !window.playScene) return false;
    const content = document.createElement('div'); content.innerHTML=item.html || '';
    const title=content.querySelector('.big');
    const heading=title?.textContent || item.badge || '';
    title?.remove();
    return playScene({who:'nova',phoenixPose:id,tone:'gold',badge:item.badge,title:heading,sub:content.innerHTML,ms:item.ms});
  }
  function flushCelebration() {
    clearTimeout(celebrationTimer);
    if(!enabled('celebration') || Date.now() >= celebrationUntil)return;
    if(!state.visible || ['expanded','scene','reminder'].includes(currentMode()) || state.moving || Date.now()<state.toastUntil){
      celebrationTimer=setTimeout(flushCelebration,400);return;
    }
    celebrationUntil=0;
    window.playScene?.({who:'nova',phoenixPose:'celebration',badge:'Celebration',title:'Nicely done!',tone:'gold',ms:3500});
  }
  window.phoenix={style,enabled,select,paint,showMoment};
  window.phoenixCelebrate=()=>{
    // Focus and water scenes already include their own celebration pose.
    if(!enabled('celebration') || window.sceneShowing?.())return;
    celebrationUntil=Date.now()+20000;flushCelebration();
  };
  bridge.onNear(value=>{
    if(value&&!near){nearSince=Date.now();clearTimeout(dwellTimer);dwellTimer=setTimeout(drawIdle,3020);}
    if(!value){nearSince=0;clearTimeout(dwellTimer);}
    near=value;drawIdle();
  });
  bridge.onMedia(value=>{if(typeof value.idle==='number'){const resting=idleSeconds>=120;idleSeconds=value.idle;if(resting!==(idleSeconds>=120))drawIdle();}});
  bridge.onHover(drawIdle);
  bridge.onVisibility(drawIdle);
  // decode every pose of the chosen character up front: a blink or pose swap is then instant
  // instead of a blank frame while the PNG decodes
  const decoded=new Set(), keep=[];
  function preload(){
    // Graphics: Low decodes a pose when it's shown instead of keeping them all
    if(!PhoenixStates.usesArtwork(style()) || state.features.graphics === 'low')return;
    for(const pose of poses.values()){
      const src=PhoenixStates.sourceFor(pose,style());
      if(decoded.has(src))continue;
      decoded.add(src);
      const image=new Image();image.src=src;image.decode().catch(()=>{});keep.push(image);
    }
  }
  window.addEventListener('island:features',()=>{preload();drawIdle();});
  window.addEventListener('island:mode',drawIdle);
  (function blink(){
    if(style() !== 'zaher-standing' && island.classList.contains('phoenix-idle') && enabled('idle-blink') && !state.features.noAnimations && idleSeconds<120){
      blinkUntil=Date.now()+150;drawIdle();setTimeout(drawIdle,170);
    }
    setTimeout(blink,3500+Math.random()*3000);
  })();
  bridge.onPhoenixPreview(id=>{
    const pose=poses.get(id);if(!pose)return;
    const previewStyle = PhoenixStates.usesArtwork(style()) ? style() : 'phoenix';
    const name = PhoenixStates.isZaher(previewStyle) ? 'Zaher' : 'Phoenix';
    window.playScene?.({who:'nova',phoenixPose:id,phoenixPreview:previewStyle,tone:'gold',badge:`${name} preview`,title:pose.label,sub:esc(pose.hint),ms:5000});
  });
})();
