// Scenes: for a moment the island itself becomes a character (Nova, or the Drop) with a card
// beside it — the adhan, a glass of water, a focus session. The island's own morph (size and
// place) does the transformation; the skin, face, limbs and props fade in after it.
//
//   playScene({ who: 'nova' | 'drop', props: ['cap', 'rug', 'band', 'laptop', 'glass'],
//               arms: 'rest' | 'fold' | 'type' | 'hold', tone: 'gold' | 'water' | 'focus',
//               badge, title, quran, sub (html), button: { label, onClick }, ms,
//               lang: 'ar' (right-to-left card; English otherwise),
//               onClose (closed with × or timed out, not by the button) })
(() => {
  const card = $('#scene-card');
  const face = $('.sc-face');
  const bar = $('.sc-bar b');
  const PROPS = ['cap', 'rug', 'band', 'laptop', 'glass'];
  let total = 0;
  let current = null;
  let lastTick = Date.now();
  let currentPose = null;

  function character(s) {
    const style = s.phoenixPreview || window.phoenix?.style() || 'classic';
    const elapsed = Math.max(0,total-(state.sceneUntil-Date.now()));
    const artwork = PhoenixStates.usesArtwork(style);
    const pose = artwork ? window.phoenix?.select(s,elapsed) : null;
    const usePhoenix = !!pose;
    island.classList.toggle('sc-phoenix',usePhoenix);
    island.classList.toggle('sc-zaher',usePhoenix && PhoenixStates.isZaher(style));
    island.classList.toggle('sc-plain',style === 'none' || (artwork && !pose));
    document.body.classList.toggle('phoenix-scene-active',style === 'none' || artwork);
    if(usePhoenix)window.phoenix.paint($('#phoenix-scene'),pose,style);
    if(currentPose !== pose){currentPose=pose;positionIsland();}
  }

  function classes(on, s) {
    island.classList.toggle('sc-nova', on && s.who !== 'drop');
    island.classList.toggle('sc-drop', on && s.who === 'drop');
    for (const p of PROPS) island.classList.toggle(`p-${p}`, on && s.props?.includes(p));
    for (const a of ['rest', 'fold', 'type', 'hold']) island.classList.toggle(`arms-${a}`, on && (s.arms || 'rest') === a);
    island.classList.toggle('glow-gold', on && s.tone === 'gold');
  }

  function end(how = 'closed') {
    const closing = current;
    const visible = !!closing || !!state.sceneUntil || card.classList.contains('on');
    current = null;
    card.classList.remove('on');
    if (!visible) return;
    state.sceneUntil = 0;
    document.body.classList.remove('phoenix-scene-active');
    state.hover = false;
    render();
    positionIsland();
    reportRect();
    island.classList.remove('sc-phoenix','sc-plain','sc-zaher');
    // let the island morph back before classic Nova's skin and props go
    setTimeout(() => { if (!current) classes(false, closing || {}); }, 420);
    if (how !== 'button') closing?.onClose?.();
  }

  window.playScene = (s) => {
    const style = s.phoenixPreview || window.phoenix?.style() || 'classic';
    if (anchor.vertical && style === 'classic') return false;
    // replacing a scene: swap the content in place, no collapse in between (and the old one
    // wasn't closed by the user, so no onClose)
    if (current) classes(false, current);
    current = s;
    classes(true, s);
    card.className = `scene-card ${s.tone || 'gold'}`;
    card.lang = s.lang || 'en';
    card.dir = s.lang === 'ar' ? 'rtl' : 'ltr';
    $('#sc-badge').textContent = s.badge || '';
    const title = $('#sc-title');
    title.textContent = s.title || '';
    title.classList.toggle('quran', !!s.quran);
    $('#sc-sub').innerHTML = s.sub || '';
    const btn = $('#sc-btn');
    btn.hidden = !s.button;
    if (s.button) btn.textContent = s.button.label;
    total = s.ms || 30000;
    state.sceneUntil = Date.now() + total;
    character(s);
    bar.style.width = '100%';
    state.hover = false;
    render();
    positionIsland();
    card.classList.add('on');
    reportRect();
    return true;
  };
  window.sceneShowing = () => !!current;
  window.endScene = end;
  window.addEventListener('island:features',()=>{if(current){character(current);render();positionIsland();}});

  $('#sc-close').addEventListener('click', (e) => { e.stopPropagation(); end(); });
  $('#sc-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const fn = current?.button?.onClick;
    end('button');
    fn?.();
  });

  // countdown (paused while the mouse is on it), and a blink now and then
  setInterval(() => {
    const now = Date.now();
    const dt = now - lastTick;
    lastTick = now;
    if (!current) return;
    if (state.hover) state.sceneUntil += dt;
    if (now >= state.sceneUntil) return end();
    character(current);
    bar.style.width = `${Math.max(0, (state.sceneUntil - now) / total) * 100}%`;
  }, 250);
  (function blink() {
    if (current) {
      face.classList.add('blink');
      setTimeout(() => face.classList.remove('blink'), 130);
    }
    setTimeout(blink, 2600 + Math.random() * 3200);
  })();
})();
