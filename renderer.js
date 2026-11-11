const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const bridge = window.nova;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const island = $('#island');
const ICON_X = '<svg class="s" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const ICON_PLUS = '<svg class="s" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';

const state = {
  hover: false,
  pinned: false,
  moving: false,
  mediaFront: false, // the player showing the media is the window in front
  dragging: false,
  tab: 'media',
  media: { has: false },
  mediaAt: 0,
  vol: null,
  muted: false,
  bright: -1,
  volLockUntil: 0,
  brightLockUntil: 0,
  peekUntil: 0,
  toast: null,
  toastUntil: 0,
  timer: { total: 0, remaining: 0, endAt: 0, running: false },
  dl: { active: false, title: '', tab: false }, // IDM Nova, filled by views/downloads.js
  features: {}, // switches from the Settings window; a missing key means on
  visible: true, // false while hidden (fullscreen app, or hidden from the menu)
  reminderUntil: 0, // a dhikr / du'a / verse card is on screen until then (views/reminders.js)
  reminderSize: [500, 140],
  sceneUntil: 0, // the island is a character (views/scene.js) until then
  radio: { on: false, name: '' }, // Quran Radio (plugin) playing, filled by views/radio.js
  radioTab: false, // the Quran Radio plugin is installed and on
};
const feat = (key) => state.features[key] !== false;

// Good news: sparkles fly out of the island's edges.
function celebrate(colors = ['#ffd479', '#30d158', '#8ab4ff', '#ff6b9d']) {
  if (!feat('celebrate')) return;
  window.phoenixCelebrate?.();
  if (anchor.vertical || state.features.noAnimations) return;
  const r = island.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  for (let i = 0; i < 18; i++) {
    const a = (Math.PI * 2 * i) / 18 + Math.random() * 0.3;
    // start on the pill's outline, fly outward
    const sx = cx + Math.cos(a) * r.width / 2;
    const sy = cy + Math.sin(a) * r.height / 2;
    const dist = 18 + Math.random() * 34;
    const p = document.createElement('i');
    p.className = 'spark';
    p.style.cssText = `left:${sx}px;top:${sy}px;background:${colors[i % colors.length]};--s:${(3 + Math.random() * 3).toFixed(1)}px`;
    document.body.append(p);
    p.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(a) * dist}px), calc(-50% + ${Math.sin(a) * dist}px)) scale(.2)`, opacity: 0 },
    ], { duration: 700 + Math.random() * 400, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => p.remove();
  }
}

// Things worth telling the user when they come back to the computer (views call note()).
const happenings = [];
function note(icon, text) {
  happenings.push({ at: Date.now(), icon, text });
  if (happenings.length > 40) happenings.shift();
}
let internalDrag = false; // set by the shelf while dragging a file out

const fmt = (sec) => {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

// ---------------- mode ----------------

function timerActive() {
  return state.timer.running || state.timer.remaining > 0;
}

// What the compact pill shows, by priority: timer, playing media, a running download. (The radio
// doesn't take the pill: the idle info keeps rotating, with a small "on air" mark by the prayer.)
// between two songs a player reports "paused" for a moment: the pill holds on through it, so the
// next song swaps in instead of the island collapsing and growing again
const SONG_GAP_MS = 1200;
function compactKind() {
  if (timerActive()) return 'timer';
  const playing = state.media.playing || Date.now() - (state.playingAt || 0) < SONG_GAP_MS;
  if (feat('mediaPill') && state.media.has && playing && !state.mediaFront) return 'media';
  if (state.dl.active) return 'dl';
  return '';
}

const NOTICES = ['kai-flow', 'appnote'];
function currentMode() {
  const now = Date.now();
  // a character scene (adhan, water, focus) owns the island until it ends or is closed
  if (state.sceneUntil > now && (!anchor.vertical || island.classList.contains('sc-phoenix') || island.classList.contains('sc-plain'))) return 'scene';
  // a toast with a button (Join) stays under the cursor so it can be clicked
  // notices stay put under the cursor too: hovering pauses them instead of opening the island
  if ((state.toastAction || NOTICES.includes(state.toast)) && state.toast && now < state.toastUntil && !state.pinned) return 'toast';
  // a reminder stays put under the cursor so it can be read (hovering pauses it)
  if (state.reminderUntil > now && !state.pinned && !state.dragging) {
    return state.toast && now < state.toastUntil ? 'toast' : 'reminder';
  }
  if (!state.moving && (state.hover || state.pinned || state.dragging)) return 'expanded';
  if (state.toast && now < state.toastUntil) return 'toast';
  if (now < state.peekUntil && !state.mediaFront) return 'peek';
  if (compactKind()) return 'compact';
  return 'idle';
}

let lastMode = '';
let swap = null; // a song → song change in progress (startSongSwap)
const SIZE ={ idle: 1, compact: 2, toast: 3, peek: 4, reminder: 4, scene: 4, expanded: 5 };

function render() {
  const mode = currentMode();
  const prev = lastMode;
  const changedMode = mode !== prev;
  if (changedMode) {
    // growing springs past its size a little; shrinking settles softer and quicker
    island.classList.toggle('shrinking', !!prev && SIZE[mode] < SIZE[prev]);
    island.classList.remove('idle', 'compact', 'toast', 'peek', 'reminder', 'scene', 'expanded');
    island.classList.add(mode);
    lastMode = mode;
  }
  const kaiNotice = mode === 'toast' && state.toast === 'kai-flow';
  const sideHud = mode === 'toast' && (state.toast === 'vol' || state.toast === 'bright');
  const changedToastSize = kaiNotice !== island.classList.contains('kai-notice') || sideHud !== island.classList.contains('side-hud');
  island.classList.toggle('kai-notice', kaiNotice);
  island.classList.toggle('side-hud', sideHud);
  const noticeClose = $('#kai-notice-close');
  if (noticeClose.hidden === kaiNotice) noticeClose.hidden = !kaiNotice;
  island.classList.toggle('kai-compact', state.features.kaiNoticeStyle === 'compact');
  island.classList.toggle('has-media', !!state.media.has);
  island.classList.toggle('playing', !!state.media.playing);
  const kind = compactKind();
  for (const el of [$('.l-compact'), $('.l-vcompact')]) {
    el.classList.toggle('timer', kind === 'timer');
    el.classList.toggle('dl', kind === 'dl');
  }
  const showTitle = kind === 'dl' || (kind === 'media' && feat('mediaTitle'));
  const wide = showTitle;
  const changedWidth = wide !== island.classList.contains('c-wide');
  island.classList.toggle('c-wide', wide);
  // mid song → song swap the pill keeps the old title until the swap brings in the new one
  setCompactTitle(!showTitle ? '' : kind === 'media' ? (swap && cTitle ? cTitle : state.media.title) : state.dl.title);
  $('.c-title').hidden = !showTitle;
  if (changedMode || changedWidth || changedToastSize) positionIsland();
  if (changedMode) {
    syncProgress();
    window.dispatchEvent(new CustomEvent('island:mode', { detail: { mode, prev } }));
  }
  syncAudioMeter();
}

// Title between the art and the equalizer; scrolls back and forth when it doesn't fit.
let cTitle = null;
let fitTimer = null;
function setCompactTitle(text) {
  text = text || '';
  if (text === cTitle) return;
  cTitle = text;
  $('#c-title').textContent = text;
  fitCompactTitle();
}
function fitCompactTitle() {
  const box = $('.c-title');
  box.classList.remove('scroll');
  clearTimeout(fitTimer);
  // measure once the pill has finished morphing to its width
  fitTimer = setTimeout(() => {
    const span = $('#c-title');
    const over = span.scrollWidth - box.clientWidth;
    if (over <= 2 || lastMode !== 'compact') return;
    box.style.setProperty('--dist', `${-over - 12}px`);
    box.style.setProperty('--dur', `${Math.max(5, over / 22 + 3)}s`);
    box.classList.toggle('rtl', getComputedStyle(span).direction === 'rtl');
    box.classList.add('scroll');
  }, 560);
}
window.addEventListener('island:mode', (e) => {
  if (e.detail.mode === 'compact') fitCompactTitle();
});

// ---------------- hover (main polls the cursor with hover intent) ----------------
// leaving waits a moment, so grazing the edge doesn't snap the panel shut
let hoverTimer = null;
bridge.onHover((v) => {
  clearTimeout(hoverTimer);
  // a notice under the cursor waits; it ends 2.5 s after the cursor leaves
  if (NOTICES.includes(state.toast) && lastMode === 'toast') {
    clearTimeout(toastTimer);
    if (v) state.toastUntil = Infinity;
    else { state.toastUntil = Date.now() + 2500; toastTimer = setTimeout(dismissToast, 2550); }
  }
  if (v) {
    state.hover = true;
    render();
  } else {
    hoverTimer = setTimeout(() => {
      state.hover = false;
      render();
    }, 160);
  }
});

let lastRect = '';
// Where the island is heading. While it morphs, the hitbox is already the final shape, so the
// cursor never falls out of a half-grown island and flickers it shut.
let target = null;
function reportRect() {
  // something on the island to click (a toast with a button, a reminder or a scene): over the
  // browser in "Stay in place" it takes the mouse again for as long as it's there
  const clickable = (lastMode === 'toast' && (!!state.toastAction || NOTICES.includes(state.toast)) && Date.now() < state.toastUntil) || lastMode === 'reminder' || lastMode === 'scene';
  // While the island shrinks the hitbox is already the final, smaller shape (so the cursor can't
  // slip out of a half-shrunk island and flicker it). While it grows, the hitbox is what's drawn:
  // leaving the island mid-open closes it from right there.
  let r = target && !state.moving ? target : island.getBoundingClientRect();
  if (target && !state.moving) {
    const now = island.getBoundingClientRect();
    if (now.width * now.height < target.width * target.height - 1) r = now;
  }
  // during a scene the card beside the character must take the mouse too
  if (lastMode === 'scene') {
    const c = $('#scene-card').getBoundingClientRect();
    const left = Math.min(r.left, c.left);
    const top = Math.min(r.top, c.top);
    r = { left, top, width: Math.max(r.right, c.right) - left, height: Math.max(r.bottom, c.bottom) - top };
  }
  const rect = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), scale: anchor.scale || 1, mode: lastMode, clickable };
  const key = JSON.stringify(rect);
  if (key !== lastRect) {
    lastRect = key;
    bridge.setRect(rect);
  }
}
const hitboxObserver = new ResizeObserver(reportRect);
hitboxObserver.observe(island);
hitboxObserver.observe($('#scene-card'));
island.addEventListener('transitionend', (e) => { if (e.target === island) reportRect(); });
$('#scene-card').addEventListener('transitionend', reportRect);

bridge.onToggle(() => {
  state.pinned = !state.pinned;
  if (!state.pinned) state.hover = false;
  bridge.setPinned(state.pinned);
  render();
});

// ---------------- drag to move (docks when dropped at the top edge) ----------------
const NO_DRAG = 'button, input, .slider, .file, .app, .pick, .picker, .clip-item, .shelf-items';
let press = null;
let justMoved = false;

island.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest(NO_DRAG)) return;
  press = { x: e.screenX, y: e.screenY, id: e.pointerId };
});
window.addEventListener('pointermove', (e) => {
  if (!press || state.moving) return;
  if (Math.hypot(e.screenX - press.x, e.screenY - press.y) < 5) return; // drag threshold
  state.moving = true;
  island.setPointerCapture(press.id);
  island.classList.add('moving');
  render();
  bridge.dragStart();
});
function endMove() {
  if (state.moving) {
    state.moving = false;
    state.hover = false;
    justMoved = true;
    setTimeout(() => (justMoved = false), 50);
    island.classList.remove('moving');
    bridge.dragEnd();
    render();
  }
  press = null;
}
window.addEventListener('pointerup', endMove);
island.addEventListener('lostpointercapture', endMove);

// a plain click on the collapsed island opens it (also right after a move)
island.addEventListener('click', (e) => {
  if (!justMoved && lastMode === 'toast' && state.toastAction) {
    const act = state.toastAction;
    dismissToast();
    act();
    return;
  }
  if (justMoved || lastMode === 'expanded' || lastMode === 'reminder' || lastMode === 'scene' || e.target.closest(NO_DRAG)) return;
  state.hover = true;
  render();
});

// ---------------- placement inside the window ----------------
// Main sends the pill's anchor (top-center) in window coordinates. Each mode is centered
// on it, then pushed back inside the window, so near the bottom or the sides the island
// opens upward / inward instead of off screen. Sizes mirror style.css.
const DIMS = {
  idle: [236, 32], compact: [300, 32], toast: [340, 34], peek: [400, 78], expanded: [548, 232],
};
const COMPACT_WIDE = 380; // compact with a title (media / download)
const VDIMS = { ...DIMS, idle: [44, 244], compact: [44, 136], toast: [44, 168] };
let anchor = { x: window.innerWidth / 2, y: 8, docked: false, vertical: false, side: 'right' };

function positionIsland() {
  let [w, h] = (anchor.vertical ? VDIMS : DIMS)[lastMode] || DIMS.idle;
  if (lastMode === 'toast' && state.toast === 'kai-flow') {
    [w, h] = state.features.kaiNoticeStyle === 'compact' ? [380, 74] : [420, 110];
  } else if (anchor.vertical && lastMode === 'toast' && !island.classList.contains('side-hud')) {
    [w, h] = [340, 76];
  }
  if (lastMode === 'compact' && !anchor.vertical && island.classList.contains('c-wide')) w = COMPACT_WIDE;
  if (lastMode === 'reminder') [w, h] = state.reminderSize;
  // in the browser's address bar: a slim pill, or a thin line while the user types there
  if (anchor.addr && !anchor.vertical && (lastMode === 'idle' || lastMode === 'compact')) {
    [w, h] = anchor.addr === 'line' ? [90, 3] : [anchor.sw, anchor.sh];
  }
  target = null;
  if (lastMode === 'scene') {
    // the body on the right, the card on its left: [card 430][gap 22][body 64], kept inside the window
    if(island.classList.contains('sc-phoenix') || island.classList.contains('sc-plain')){
      // sprite box, as in phoenix.css (Zaher is taller than wide)
      const [sprite, spriteH] = !island.classList.contains('sc-phoenix') ? [0, 0] : island.classList.contains('sc-zaher') ? [120, 142] : [140, 140];
      const gap = sprite ? 18 : 0;
      const card = $('#scene-card');
      const cardWidth = Math.min(390,window.innerWidth-sprite-gap-16);
      card.style.width = `${cardWidth}px`;
      const height = Math.max(spriteH,card.offsetHeight);
      const fullWidth = cardWidth+gap+sprite;
      const left = Math.max(8,Math.min(anchor.x-fullWidth/2,window.innerWidth-fullWidth-8));
      const desiredTop = anchor.addr ? anchor.rowBottom+10 : anchor.vertical ? anchor.y-height/2 : anchor.y+12;
      const top = Math.max(8,Math.min(desiredTop,window.innerHeight-height-8));
      const characterFirst = anchor.vertical && anchor.side === 'left';
      island.style.setProperty('--x',`${Math.round(characterFirst ? left : left+cardWidth+gap)}px`);
      island.style.setProperty('--y',`${Math.round(top+(height-spriteH)/2)}px`);
      card.style.left = `${Math.round(characterFirst ? left+sprite+gap : left)}px`;
      card.style.top = `${Math.round(top)}px`;
      reportRect();return;
    }
    const CW = 516;
    const left = Math.min(Math.max(anchor.x - CW / 2, 8), window.innerWidth - CW - 8);
    const sceneTop = anchor.addr ? anchor.rowBottom + 14 : anchor.y + 22;
    const top = anchor.docked ? 30 : Math.min(Math.max(sceneTop, 10), window.innerHeight - 130);
    island.style.setProperty('--x', `${Math.round(left + CW - 64)}px`);
    island.style.setProperty('--y', `${Math.round(top)}px`);
    const card = $('#scene-card');
    card.style.width = '';
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top - 14)}px`;
    reportRect();
    return;
  }
  const W = window.innerWidth;
  const H = window.innerHeight;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  let x;
  let y;
  if (anchor.vertical) {
    // Keep the slim states against the edge. Readable cards open inward.
    const inset = lastMode === 'idle' || lastMode === 'compact' || island.classList.contains('side-hud') ? 0 : 6;
    x = anchor.side === 'left' ? inset : W - w - inset;
    y = clamp(anchor.y - h / 2, 4, H - h - 4);
  } else {
    const belowBar = anchor.addr && lastMode !== 'idle' && lastMode !== 'compact';
    const panelLeft = belowBar ? Math.max(4, anchor.panelLeft) : 4;
    const panelRight = belowBar ? Math.min(W - 4, anchor.panelRight) : W - 4;
    x = panelRight - panelLeft >= w
      ? clamp(anchor.x - w / 2, panelLeft, panelRight - w)
      : clamp(anchor.x - w / 2, 4, W - w - 4);
    const bottom = H - h - 6;
    const centeredLine = anchor.addr === 'line' && !belowBar ? (anchor.sh - h) / 2 : 0;
    y = anchor.docked ? 0 : clamp(anchor.y + centeredLine, 0, bottom);
    if (belowBar) {
      const below = anchor.rowBottom + 8;
      const above = anchor.rowTop - h - 8;
      y = below > bottom && above >= 0 ? above : clamp(below, 0, bottom);
    }
  }
  island.style.setProperty('--x', `${Math.round(x)}px`);
  island.style.setProperty('--y', `${Math.round(y)}px`);
  target = { left: Math.round(x), top: Math.round(y), width: w, height: h };
  reportRect();
}

bridge.onAnchor((a) => {
  anchor = a;
  document.body.style.setProperty('--island-scale', a.scale || 1);
  island.classList.toggle('addr-slim', a.addr === 'slim');
  island.classList.toggle('addr-line', a.addr === 'line');
  if (a.addr) {
    island.style.setProperty('--sw', `${a.sw}px`);
    island.style.setProperty('--sh', `${a.sh}px`);
  }
  island.classList.toggle('docked', !!a.docked);
  island.classList.toggle('vertical', !!a.vertical);
  island.classList.toggle('side-left', !!a.vertical && a.side === 'left');
  island.classList.toggle('side-right', !!a.vertical && a.side === 'right');
  positionIsland();
  // the anchor arrives often (browser moves, foreground changes): only a new width re-measures,
  // otherwise the scrolling title would restart from the beginning every time
  const fitKey = `${a.addr}|${a.sw}|${a.vertical}|${a.scale}`;
  if (fitKey !== lastFitKey) {
    lastFitKey = fitKey;
    fitCompactTitle();
    fitBrowserStats();
  }
  syncAudioMeter();
});
let lastFitKey = '';

island.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (e.target.closest('.apps-grid, .file, input')) return;
  bridge.contextMenu();
});

// ---------------- glass backdrop ----------------
const bd = $('#bd');
const bdCtx = bd.getContext('2d');

function sizeCanvases() {
  // Glass is blurred anyway. Keep the backing surfaces smaller than the CSS box.
  const w = Math.ceil(window.innerWidth / 3), h = Math.ceil(window.innerHeight / 3);
  if (bd.width !== w) bd.width = w;
  if (bd.height !== h) bd.height = h;
  bd.style.width = `${window.innerWidth}px`;
  bd.style.height = `${window.innerHeight}px`;
}
sizeCanvases();
window.addEventListener('resize', () => { sizeCanvases(); positionIsland(); });

// the backdrop arrives as raw pixels (BGRA, Windows' order): swapped to RGBA, blurred into a
// spare canvas, then faded over the old glass in a few frames instead of swapping at once
const bdNext = new OffscreenCanvas(1, 1);
const bdNextCtx = bdNext.getContext('2d');
let bdSeq = 0;
let bdFade = 0;
function fadeBackdrop() {
  if (bdFade <= 0) return;
  bdCtx.globalAlpha = bdFade === 1 ? 1 : .2;
  bdCtx.drawImage(bdNext, 0, 0);
  bdCtx.globalAlpha = 1;
  bdFade--;
  if (bdFade > 0) requestAnimationFrame(fadeBackdrop);
}
bridge.onBackdrop(async (frame) => {
  const seq = ++bdSeq;
  let img;
  if (typeof frame === 'string') {
    img = new Image();
    img.src = frame;
    await img.decode();
  } else {
    const px = new Uint8ClampedArray(frame.bgra.buffer, frame.bgra.byteOffset, frame.bgra.byteLength);
    for (let i = 0; i < px.length; i += 4) {
      const b = px[i];
      px[i] = px[i + 2];
      px[i + 2] = b;
      px[i + 3] = 255;
    }
    img = await createImageBitmap(new ImageData(px, frame.w, frame.h));
  }
  if (seq !== bdSeq) return img.close?.(); // a newer frame arrived while this one decoded
  const { width: w, height: h } = bd;
  if (bdNext.width !== w || bdNext.height !== h) { bdNext.width = w; bdNext.height = h; }
  bdNextCtx.filter = 'none';
  bdNextCtx.drawImage(img, 0, 0, w, h);
  bdNextCtx.filter = 'blur(7px) saturate(180%) brightness(.92)';
  bdNextCtx.drawImage(img, -8, -8, w + 16, h + 16);
  img.close?.();
  const running = bdFade > 0;
  bdFade = state.features.noAnimations || !state.visible ? 1 : 10;
  if (!running) requestAnimationFrame(fadeBackdrop);
});

// ---------------- tabs ----------------
$$('.tab').forEach((btn) => btn.addEventListener('click', () => selectTab(btn.dataset.tab)));
const seg = $('.seg');
const segThumb = $('.seg-thumb');
const markTabs = (tab) => $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
// The thumb slides to where the active tab ends up once its label has opened. That spot is read
// once with transitions off (no per-frame layout reads), then the old state is put back so the
// labels and the thumb animate to it together.
function placeSegThumb(from) {
  const tab = $('.tab.active')?.dataset.tab;
  seg.classList.add('measuring');
  const a = $('.tab.active');
  const end = a && { w: a.offsetWidth, x: a.offsetLeft };
  if (from !== undefined) markTabs(from);
  void seg.offsetWidth; // commit the starting point while transitions are off
  seg.classList.remove('measuring');
  if (from !== undefined) markTabs(tab);
  if (!end) return;
  segThumb.style.width = `${end.w}px`;
  segThumb.style.transform = `translateX(${end.x}px)`;
}
function selectTab(tab) {
  const view = $(`#v-${tab}`);
  if (!view || view.classList.contains('active')) return;
  const from = state.tab;
  state.tab = tab;
  $$('.tab').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  placeSegThumb(lastMode === 'expanded' ? from : undefined);
  $('.view.active')?.classList.remove('active');
  view.classList.add('active');
  syncProgress();
  syncAudioMeter();
}

// ---------------- clock ----------------
const clockFormat = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', hour12: true });
function tickClock() {
  const d = new Date();
  const time = clockFormat.format(d);
  const date = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  $('#x-clock').textContent = $('#i-time').textContent = time;
  $('#x-date').textContent = $('#i-date').textContent = date;
  $('#i-stats-time').textContent = time;
  const period = clockFormat.formatToParts(d).find(part => part.type === 'dayPeriod')?.value || '';
  $('#v-time').textContent = period ? time.replace(period, '').trim() : time;
  $('#v-period').textContent = period;
  $('#v-day').textContent = d.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
  fitBrowserStats();
}
tickClock();
setInterval(tickClock, 5000);

// ---------------- idle pill: rotates clock/weather, CPU/RAM and the next prayer ----------------
// Fill the browser's wider pill, trimming detail before dropping either extra reading.
// Measure the real text: toolbar width, UI scale and locale all affect what fits.
function fitBrowserStats() {
  const slide = $('.stats-slide');
  slide.classList.remove('stats-tight', 'stats-no-clock', 'stats-no-battery');
  if (!island.classList.contains('addr-slim') || !slide.clientWidth) return;
  const fits = () => {
    const style = getComputedStyle(slide);
    const items = [...slide.children].filter(el => getComputedStyle(el).display !== 'none');
    const used = items.reduce((sum, el) => sum + el.getBoundingClientRect().width, 0)
      + Math.max(0, items.length - 1) * parseFloat(style.columnGap)
      + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    return used <= slide.clientWidth;
  };
  for (const compact of ['stats-tight', 'stats-no-clock', 'stats-no-battery']) {
    if (fits()) break;
    slide.classList.add(compact);
  }
}
new ResizeObserver(fitBrowserStats).observe($('.stats-slide'));

let infoSlide = 0;
setInterval(() => {
  if (lastMode !== 'idle') return;
  showSlide(infoSlide + 1);
}, 6000);

// Shows the n-th slide among those turned on; with all of them off the clock stays.
function showSlide(n) {
  const all = [...$$('.info-slide')];
  let slides = all.filter((s) => !s.hidden && !s.classList.contains('off'));
  if (!slides.length) slides = [all[0]];
  infoSlide = n % slides.length;
  all.forEach((s) => s.classList.toggle('on', s === slides[infoSlide]));
}

bridge.onStats((s) => {
  const set = (id, v) => {
    $(`#i-${id}`).textContent = `${Math.round(v * 100)}%`;
    const bar = $(`#i-${id}-bar`);
    bar.style.width = `${Math.round(v * 100)}%`;
    bar.classList.toggle('warn', v >= 0.7 && v < 0.9);
    bar.classList.toggle('hot', v >= 0.9);
  };
  set('cpu', s.cpu);
  set('ram', s.ram);
  $('#v-cpu').textContent = `${Math.round(s.cpu * 100)}%`;
  $('#v-ram').textContent = `${Math.round(s.ram * 100)}%`;
  fitBrowserStats();
});

// ---------------- sliders ----------------
function makeSlider(el, { onInput, onCommit } = {}) {
  const fill = el.querySelector('.fill');
  let value = 0;
  let dragging = false;
  const set = (v) => {
    value = Math.max(0, Math.min(1, v));
    fill.style.width = `${value * 100}%`;
    el.setAttribute('aria-valuenow', Math.round(value * 100));
  };
  const at = (e) => {
    const r = el.getBoundingClientRect();
    return (e.clientX - r.left) / r.width;
  };
  el.addEventListener('pointerdown', (e) => {
    dragging = true;
    el.classList.add('drag');
    el.setPointerCapture(e.pointerId);
    set(at(e));
    onInput?.(value);
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    set(at(e));
    onInput?.(value);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('drag');
    onCommit?.(value);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  return { set, get dragging() { return dragging; } };
}

function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const wait = ms - (Date.now() - last);
    clearTimeout(timer);
    if (wait <= 0) {
      last = Date.now();
      fn(...args);
    } else {
      timer = setTimeout(() => { last = Date.now(); fn(...args); }, wait);
    }
  };
}

// ---------------- media ----------------
const APP_NAMES = {
  spotify: 'Spotify', chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox', opera: 'Opera',
  vlc: 'VLC', zunemusic: 'Media Player', microsoftmediaplayer: 'Media Player', applemusic: 'Apple Music',
  brave: 'Brave', telegram: 'Telegram', whatsapp: 'WhatsApp', youtube: 'YouTube',
};
function appName(id) {
  if (!id) return '';
  const raw = id.split('!').pop().split('\\').pop().replace(/\.exe$/i, '');
  const key = raw.toLowerCase().replace(/[^a-z]/g, '');
  for (const k of Object.keys(APP_NAMES)) if (key.includes(k)) return APP_NAMES[k];
  return raw.split('.').pop();
}

function setAccent(r, g, b) {
  island.style.setProperty('--artwork-rgb', `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`);
  island.style.setProperty('--artwork-vivid', vivid(r, g, b).join(', '));
}
// the same hue, saturated and at a brightness a white icon reads on (grey art stays grey)
function vivid(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const l0 = (max + min) / 2;
  const s0 = d ? d / (1 - Math.abs(2 * l0 - 1)) : 0;
  const s = s0 < .08 ? s0 : Math.max(s0, .72);
  const l = Math.min(.52, Math.max(.4, l0));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h % 2 + 2) % 2 - 1)), m = l - c / 2;
  const [R, G, B] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [R, G, B].map((v) => Math.round((v + m) * 255));
}

const SOURCE_ACCENTS = {
  spotify: [30, 215, 96], youtube: [239, 61, 70], 'youtube-music': [239, 61, 70],
  opera: [238, 70, 94], apple: [231, 76, 118], soundcloud: [235, 110, 46],
  twitch: [150, 98, 229], vimeo: [50, 162, 218], vlc: [235, 145, 46],
  chrome: [61, 148, 222], msedge: [45, 162, 178], brave: [233, 119, 51], firefox: [224, 109, 61],
};
let artworkPalette = null;

function accentFromImage(img) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 24, 24);
    const px = ctx.getImageData(0, 0, 24, 24).data;
    // Pick the strongest hue family so contrasting cover colours don't average to grey.
    const hues = Array.from({length: 12}, () => [0, 0, 0, 0]);
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const max = Math.max(r, g, b), chroma = max - Math.min(r, g, b);
      if (px[i + 3] < 100 || max < 50 || chroma < 30) continue;
      const hue = max === r ? (g - b) / chroma : max === g ? 2 + (b - r) / chroma : 4 + (r - g) / chroma;
      const bucket = hues[(Math.round(hue * 2) + 12) % 12];
      bucket[0] += r * chroma;
      bucket[1] += g * chroma;
      bucket[2] += b * chroma;
      bucket[3] += chroma;
    }
    const [r, g, b, weight] = hues.reduce((best, bucket) => bucket[3] > best[3] ? bucket : best);
    if (!weight) return null;
    const lift = 235 / Math.max(r, g, b);
    return [r * lift, g * lift, b * lift];
  } catch { return null; }
}

// Gradient tile with a note, used until (or when) the player provides no artwork.
function placeholderArt(seed, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const ctx = c.getContext('2d');
  let h = 210;
  for (const ch of seed || '') h = (h * 31 + ch.charCodeAt(0)) % 360;
  const g = ctx.createLinearGradient(0, 0, 160, 160);
  g.addColorStop(0, color ? `rgb(${color.join(',')})` : `hsl(${h}, 70%, 58%)`);
  g.addColorStop(1, color ? `rgb(${color.map(n => Math.round(n * .42)).join(',')})` : `hsl(${(h + 45) % 360}, 65%, 28%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 160, 160);
  ctx.translate(32, 32);
  ctx.scale(4, 4);
  ctx.fillStyle = 'rgba(255,255,255,.88)';
  ctx.fill(new Path2D('M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z'));
  return c.toDataURL('image/png');
}

let currentArtUrl = '';
function setArt(url, real = false) {
  if (currentArtUrl === url) return;
  currentArtUrl = url;
  ['#c-art', '#vc-art', '#p-art', '#m-art', '#m-art-glow'].forEach((s) => ($(s).src = url));
  if (!real) return;
  const img = $('#m-art');
  img.decode().then(() => {
    if (currentArtUrl !== url || !state.media.has) return;
    artworkPalette = accentFromImage(img);
    setAccent(...(artworkPalette || SOURCE_ACCENTS[state.media.source?.id] || [107, 160, 215]));
  }).catch(() => {
    if (currentArtUrl !== url || !state.media.has) return;
    hasArtwork = false;
    const m = state.media;
    setArt(placeholderArt(m.title + m.app, SOURCE_ACCENTS[m.source?.id]));
  });
}

function setSongText(m) {
  $('#m-title').textContent = $('#p-title').textContent = m.title || 'Unknown';
  const sub = m.artist || m.album || appName(m.app);
  $('#m-artist').textContent = $('#p-artist').textContent = sub;
  $('#p-eyebrow').textContent = `Now Playing · ${m.source?.name || appName(m.app) || 'Media'}`;
}

// ---- song → song: the old song slides out and the new one in, in place (no collapse between) ----
const SONG_ART = ['#c-art', '#p-art', '#m-art', '#m-art-glow'];
const SONG_TEXT = ['#c-title', '#p-title', '#p-artist', '#m-title', '#m-artist'];
const SWAP_OUT = 170;  // old song away
const SWAP_WAIT = 300; // the new artwork usually lands a moment after the title: wait for it, briefly
// artwork that lands after the swap (or after a placeholder) fades in instead of popping
function artArrives() {
  for (const sel of SONG_ART) {
    const el = $(sel);
    if (!el.getAnimations().length) el.animate([{ opacity: 0, transform: sel === '#m-art-glow' ? 'none' : 'scale(.92)' }, {}], { duration: 260, easing: 'cubic-bezier(.2, .8, .3, 1)' });
  }
}
const SWAP_IN = 440;   // new song in
// implicit keyframes ({}) start/end at each element's own look (the glow keeps its blur and dimness)
const away = (sel, up) => sel === '#m-art-glow' ? { opacity: 0 }
  : SONG_ART.includes(sel) ? { opacity: 0, transform: 'scale(.8)' }
  : { opacity: 0, transform: `translateY(${up ? -7 : 8}px)`, filter: 'blur(3px)' };
function putInSong(thumb) {
  const m = state.media;
  if (m.has) {
    if (thumb) { hasArtwork = true; setArt(`data:image/png;base64,${thumb}`, true); }
    else if (!hasArtwork) setArt(placeholderArt(m.title + m.app, SOURCE_ACCENTS[m.source?.id]));
    setSongText(m);
  }
  render(); // the pill's title
}
// The old song turns to soft dust and reforms as the new one (views/soft-dust.js); with the dust
// off it slides out and the new one slides in instead. card: Settings > Song change > Card, the pill
// grows into the Now Playing card first (still the old song) and the change happens in there.
const CARD_SETTLE = 420; // the card's grow, before its dust
const CARD_MS = 4200;    // how long the card stays: its grow, the dust, then ~3 s of the new song
function startSongSwap(key, card, cardUp = false) {
  const s = swap = { key, thumb: '', at: performance.now() };
  const dust = !!window.songDust?.enabled();
  if (!dust && !card) {
    for (const sel of [...SONG_ART, ...SONG_TEXT]) {
      const el = $(sel);
      el.getAnimations().forEach((a) => a.cancel());
      el.animate([{}, away(sel, true)], { duration: SWAP_OUT, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
    }
  }
  const bringIn = async () => {
    if (swap !== s) return; // another song came first: its swap carries on from here
    const waited = performance.now() - s.at;
    if ((!s.thumb && waited < SWAP_WAIT) || (card && !cardUp && waited < CARD_SETTLE)) { setTimeout(bringIn, 40); return; }
    if (dust && window.songDust.can()) {
      // the new artwork decoded first, so it goes into the dust and onto the island in one go
      let art = null;
      if (s.thumb) {
        art = new Image();
        art.src = `data:image/png;base64,${s.thumb}`;
        await art.decode().catch(() => { art = null; });
        if (swap !== s) return;
      }
      const from = window.songDust.from(); // the old song as it's shown, before it goes
      island.classList.add('song-dusting');
      swap = null;
      putInSong(s.thumb);
      window.songDust.play(from, art);
      return;
    }
    swap = null;
    putInSong(s.thumb);
    if (dust || card) return; // nothing to dust (or no dust in the card): just the new song
    SONG_ART.concat(SONG_TEXT).forEach((sel, i) => {
      const el = $(sel);
      el.getAnimations().forEach((a) => a.cancel());
      // the artwork first, the words a beat behind it
      el.animate([away(sel, false), {}], { duration: SWAP_IN, delay: SONG_ART.includes(sel) ? 0 : 60 + i * 12, easing: 'cubic-bezier(.2, .9, .3, 1.08)', fill: 'backwards' });
    });
  };
  setTimeout(bringIn, dust ? 0 : SWAP_OUT);
}

function setPlayingUI(playing) {
  const view = $('#v-media');
  view.classList.toggle('playing', playing);
  view.classList.toggle('paused', state.media.has && !playing);
  $$('.eq').forEach((e) => e.classList.toggle('paused', !playing));
}

const meterElements = {
  compact: $('.l-compact .audio-meter'), side: $('.l-vcompact .audio-meter'),
  peek: $('.l-peek .audio-meter'), expanded: $('#v-media .audio-meter'),
};
const silentBands = [0, 0, 0, 0, 0];
let activeMeter = null;
let meterBands = silentBands;
function syncAudioMeter() {
  let next = null;
  if (state.visible && state.media.has && state.media.playing && !state.muted) {
    if (lastMode === 'compact' && compactKind() === 'media') next = meterElements[anchor.vertical ? 'side' : 'compact'];
    else if (lastMode === 'peek' || (lastMode === 'expanded' && state.tab === 'media')) next = meterElements[lastMode];
  }
  if (next === activeMeter) return;
  const wasOn = !!activeMeter;
  activeMeter = next;
  if (activeMeter) { shownBands = [0, 0, 0, 0, 0]; drawAudioBands(meterBands); }
  else meterBands = silentBands;
  island.classList.toggle('audio-meter-live', !!activeMeter);
  if (wasOn !== !!activeMeter) bridge.setAudioMeter(!!activeMeter);
}
// The helper sends ~30 band sets a second; the bars ease toward them every frame (quick rise,
// slow fall like a real meter), and the frame loop stops once they've settled.
let shownBands = [0, 0, 0, 0, 0];
let meterFrame = 0;
function meterStep() {
  meterFrame = 0;
  if (!activeMeter) return;
  let moving = false;
  for (let i = 0; i < activeMeter.children.length; i++) {
    const want = Math.min(1, Math.max(0, meterBands[i] || 0));
    const d = want - shownBands[i];
    shownBands[i] += d * (d > 0 ? .5 : .16);
    if (Math.abs(want - shownBands[i]) > .004) moving = true;
    else shownBands[i] = want;
    activeMeter.children[i].style.setProperty('--audio-level', shownBands[i].toFixed(3));
  }
  if (moving) meterFrame = requestAnimationFrame(meterStep);
}
function drawAudioBands(bands) {
  if (!activeMeter) return;
  meterBands = bands;
  if (!meterFrame) meterFrame = requestAnimationFrame(meterStep);
}
bridge.onAudioBands(drawAudioBands);

// True while the user is looking at the player itself (e.g. the YouTube tab in Chrome),
// so the island doesn't repeat what is already on screen.
const BROWSERS = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi'];
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function isMediaInFront(m) {
  if (!m.has || !m.fgProc) return false;
  const proc = m.fgProc.toLowerCase();
  const appId = (m.app || '').toLowerCase();
  const sameApp = appId.includes(proc) || (proc === 'firefox' && appId === '308046b0af4a39cb');
  if (!sameApp) return false;
  if (!BROWSERS.includes(proc)) return true;
  // browsers: only when the active tab is the one playing
  const title = norm(m.fgTitle);
  return (!!m.title && title.includes(norm(m.title))) || title.includes('youtube');
}

let lastTrack = null;
let hasArtwork = false;
let lastSourceKey = null;
function updateMediaSource(m) {
  const source = m.has ? m.source : null;
  const key = source ? `${source.id}|${source.icon}` : '';
  if (key === lastSourceKey) return;
  lastSourceKey = key;
  island.classList.toggle('has-source', !!source);
  island.dataset.mediaSource = source?.id || '';
  $$('.media-source-icon').forEach(el => {
    el.hidden = !source;
    el.setAttribute('aria-label', source ? `${source.name} logo` : '');
    const vector = source?.vector !== false;
    el.classList.toggle('source-image', !vector);
    if (source && vector) {
      el.style.maskImage = `url("${source.icon}")`;
      el.replaceChildren();
    } else if (source) {
      el.style.maskImage = 'none';
      if (el.firstChild?.src !== source.icon) {
        const img = new Image(); img.src = source.icon; img.alt = ''; el.replaceChildren(img);
      }
    }
  });
  $('#v-media').classList.toggle('spotify-source', source?.id === 'spotify');
}
function onMediaUpdate(m) {
  if (m.error) return;
  const previous = state.media;
  const lock = state.playLock;
  if (lock && Date.now() < lock.until && m.has && m.playing !== lock.value) {
    m.playing = lock.value;
    m.pos = mediaPos();
  } else if (lock && m.playing === lock.value) {
    state.playLock = null;
  }
  state.media = m;
  // the last moment it was playing (the gap counts from when it stopped)
  if (m.playing || previous.playing) state.playingAt = Date.now();
  if (!m.playing && previous.playing) setTimeout(render, SONG_GAP_MS + 30); // a real pause: collapse after the gap
  state.mediaAt = performance.now();
  state.mediaFront = isMediaInFront(m);
  updateMediaSource(m);
  const battery = $('#i-battery-group');
  const batteryText = typeof m.bat === 'number' && m.bat >= 0 && m.bat <= 100 ? `${Math.round(m.bat)}%` : '';
  const batteryChanged = $('#i-battery').textContent !== batteryText;
  if (batteryChanged || m.ac !== previous.ac) {
    battery.hidden = !batteryText;
    $('#i-battery').textContent = batteryText;
    battery.classList.toggle('charging', !!m.ac);
    battery.classList.toggle('low', !!batteryText && m.bat <= 20 && !m.ac);
    battery.title = batteryText ? `Battery ${batteryText}${m.ac ? ' · charging' : ''}` : '';
  }
  if (batteryChanged) fitBrowserStats();

  const key = m.has ? `${m.title}|${m.artist}|${m.app}` : null;
  const trackChanged = key !== lastTrack;
  const sourceChanged = m.source?.id !== previous.source?.id || m.source?.name !== previous.source?.name;
  if (key !== lastTrack) {
    window.songDust?.forget(); // the dust's pictures of the pill, card and panel show the old song
    const songToSong = key && lastTrack && m.title && !state.mediaFront && !quietMedia;
    // Settings > Song change: 'card' grows the pill into the Now Playing card and changes the song
    // in there; 'pill' changes it in place. The open panel changes in place either way.
    const card = songToSong && state.features.songChange === 'card' && lastMode !== 'expanded';
    const cardUp = lastMode === 'peek'; // already showing (a skip from the island): no grow to wait for
    if (card) {
      state.peekUntil = Date.now() + CARD_MS;
      setTimeout(render, CARD_MS + 100);
    }
    const inPlace = (compactKind() === 'media' && feat('mediaTitle')) || lastMode === 'expanded';
    // (the card without the dust just shows the new song)
    if (songToSong && !state.features.noAnimations && (card ? !!window.songDust?.enabled() : inPlace)) {
      startSongSwap(key, card, cardUp);
    }
    lastTrack = key;
    hasArtwork = false;
    artworkPalette = null;
    currentArtUrl = '';
  }
  const sourceColor = SOURCE_ACCENTS[m.source?.id];
  if (m.has && !artworkPalette && (trackChanged || sourceChanged)) setAccent(...(sourceColor || [107, 160, 215]));
  if (swap) {
    if (m.thumb) swap.thumb = m.thumb; // the swap brings it in with the title
  } else if (m.thumb) {
    const late = !hasArtwork && !trackChanged && !state.features.noAnimations;
    hasArtwork = true;
    setArt(`data:image/png;base64,${m.thumb}`, true);
    if (late) artArrives();
  } else if (m.has && !hasArtwork && (trackChanged || sourceChanged)) {
    setArt(placeholderArt(m.title + m.app, sourceColor));
  }
  island.classList.toggle('artwork-accent', !!m.has);

  if (!swap && m.has && (trackChanged || sourceChanged || m.album !== previous.album)) setSongText(m);
  if (trackChanged || sourceChanged || m.has !== previous.has) {
    $('#x-app-name').textContent = m.has ? m.source?.name || appName(m.app) || 'Media' : 'Idle';
    $('#v-media').classList.toggle('browser-src', m.has && BROWSERS.some((b) => (m.app || '').toLowerCase().includes(b)) && !(m.app || '').toLowerCase().includes('firefox'));
    $('#v-media').classList.toggle('none', !m.has);
    window.dispatchEvent(new CustomEvent('island:media'));
  }
  if (!!m.playing !== !!previous.playing) setPlayingUI(!!m.playing);
  if (m.has !== previous.has || (m.dur > 0) !== (previous.dur > 0)) $('#m-progress').classList.toggle('hidden', !(m.dur > 0));

  handleVolume(m);
  handleBrightness(m);
  render();
  syncProgress();
}
// Settings > Animations preview: fake songs for a while; the player's own updates wait, then come
// back quietly (no song change animation for going back to the real song)
let previewUntil = 0, realMedia = null, quietMedia = false, previewTimer = 0;
window.previewMedia = (m, ms) => {
  previewUntil = Date.now() + ms;
  onMediaUpdate(m);
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewUntil = 0;
    quietMedia = true;
    onMediaUpdate(realMedia || { has: false });
    quietMedia = false;
  }, ms);
};
bridge.onMedia((m) => {
  if (m.error) return;
  realMedia = m;
  if (Date.now() >= previewUntil) onMediaUpdate(m);
});

function mediaPos() {
  const m = state.media;
  let pos = m.pos || 0;
  if (m.playing) pos += (performance.now() - state.mediaAt) / 1000;
  return Math.min(pos, m.dur || 0);
}

const seek = makeSlider($('#m-bar'), {
  onInput: () => tickProgress(),
  onCommit: (v) => {
    const m = state.media;
    if (!m.has || !(m.dur > 0)) return;
    const sec = v * m.dur;
    bridge.mediaCmd(`seek ${sec.toFixed(1)}`);
    state.media.pos = sec;
    state.mediaAt = performance.now();
    tickProgress();
  },
});

function tickProgress() {
  const m = state.media;
  if (!m.has || !(m.dur > 0)) return;
  const pos = seek.dragging ? parseFloat($('#m-bar').getAttribute('aria-valuenow')) / 100 * m.dur : mediaPos();
  const elapsed = fmt(pos), remaining = `-${fmt(m.dur - pos)}`;
  if ($('#m-pos').textContent !== elapsed) $('#m-pos').textContent = elapsed;
  if ($('#m-dur').textContent !== remaining) $('#m-dur').textContent = remaining;
  if (!seek.dragging) seek.set(pos / m.dur);
}

let progressTimer = null;
function syncProgress() {
  const visible = state.visible && lastMode === 'expanded' && state.tab === 'media' && state.media.has;
  if (visible) tickProgress();
  if (visible && state.media.playing && state.media.dur > 0) {
    if (progressTimer === null) progressTimer = setInterval(tickProgress, 250);
  } else if (progressTimer !== null) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

$$('[data-cmd]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const cmd = btn.dataset.cmd;
    bridge.mediaCmd(cmd);
    // Song change > Card: a skip goes to the card right away (still this song; the player takes a
    // moment), so leaving the island shows the card and the new song dusts in there, not the pill
    if ((cmd === 'next' || cmd === 'prev') && state.features.songChange === 'card' && state.media.has && !state.mediaFront) {
      state.peekUntil = Date.now() + CARD_MS + 2000;
      setTimeout(render, CARD_MS + 2100);
    }
    if (cmd === 'toggle' && state.media.has) {
      // optimistic UI; hold it until the player reports the new state (it lags ~0.5 s),
      // otherwise the island morphs back and forth for a moment
      state.media.pos = mediaPos();
      state.mediaAt = performance.now();
      state.media.playing = !state.media.playing;
      state.playLock = { value: state.media.playing, until: Date.now() + 1800 };
      setPlayingUI(state.media.playing);
      render();
      syncProgress();
    }
  })
);

// ---------------- mini player ----------------
const pipBtn = $('#pip-btn');
function flashError(text) {
  const el = $('#m-artist');
  const prev = el.textContent;
  el.textContent = text;
  el.classList.add('err');
  setTimeout(() => {
    el.classList.remove('err');
    el.textContent = prev;
  }, 3500);
}
pipBtn.addEventListener('click', async () => {
  const m = state.media;
  if (!m.has || pipBtn.classList.contains('busy')) return;
  pipBtn.classList.add('busy');
  const res = await bridge.miniOpen({ app: m.app, title: m.title, pos: mediaPos(), playing: !!m.playing });
  pipBtn.classList.remove('busy');
  if (!res?.ok) {
    flashError(res?.error === 'no-url' ? "Couldn't find this video's YouTube link" : 'Works with YouTube in Chrome, Edge or Brave');
    return;
  }
  state.hover = false;
  state.pinned = false;
  render();
});

// ---------------- volume ----------------
function volIconClass(el, vol, muted) {
  el.classList.toggle('vol-mute', muted || vol === 0);
  el.classList.toggle('vol-low', !muted && vol > 0 && vol < 0.4);
}

const sendVol = throttle((v) => bridge.mediaCmd(`vol ${v.toFixed(3)}`), 60);
function setVolume(v) {
  state.vol = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
  state.muted = false;
  state.volLockUntil = Date.now() + 900;
  volSlider.set(state.vol);
  showVolPct(state.vol, false);
  sendVol(state.vol);
}
function showVolPct(vol, muted) {
  volIconClass($('.vol'), vol, muted);
  $('#vol-pct').textContent = muted ? 'Muted' : `${Math.round(vol * 100)}%`;
}
const volSlider = makeSlider($('#vol-slider'), { onInput: setVolume });

$('#vol-btn').addEventListener('click', () => {
  state.muted = !state.muted;
  state.volLockUntil = Date.now() + 900;
  showVolPct(state.vol ?? 0, state.muted);
  syncAudioMeter();
  bridge.mediaCmd('mute');
});

island.addEventListener('wheel', (e) => {
  if (e.target.closest('.picker-list, .clip-list, .shelf-items') || state.vol === null) return;
  e.preventDefault();
  // proportional to the scroll distance: one mouse notch ≈ 3%, touchpads move in fine steps
  const perPx = e.deltaMode === 1 ? 0.01 : 0.0003;
  const step = Math.max(-0.05, Math.min(0.05, -e.deltaY * perPx));
  setVolume(state.vol + step);
  if (state.tab !== 'media' || lastMode !== 'expanded') showHud('vol', state.vol, false);
}, { passive: false });

function handleVolume(m) {
  if (typeof m.vol !== 'number') return;
  const locked = Date.now() < state.volLockUntil;
  const changed = state.vol !== null && (Math.abs(m.vol - state.vol) > 0.004 || !!m.muted !== state.muted);
  if (locked || (m.vol === state.vol && !!m.muted === state.muted)) return;
  state.vol = m.vol;
  state.muted = !!m.muted;
  if (!volSlider.dragging) volSlider.set(m.vol);
  showVolPct(m.vol, state.muted);
  if (changed && !(lastMode === 'expanded' && state.tab === 'media')) showHud('vol', m.vol, state.muted);
}

// ---------------- brightness ----------------
const sendBright = throttle((v) => bridge.mediaCmd(`bright ${Math.round(v * 100)}`), 150);
const brightSlider = makeSlider($('#bright-slider'), {
  onInput: (v) => {
    state.bright = Math.round(v * 100);
    state.brightLockUntil = Date.now() + 2500;
    $('#bright-val').textContent = `${state.bright}%`;
    sendBright(v);
  },
});

function handleBrightness(m) {
  if (typeof m.bright !== 'number') return;
  const row = $('#bright-row');
  if (row.hidden !== (m.bright < 0)) row.hidden = m.bright < 0;
  if (m.bright < 0 || m.bright === state.bright || Date.now() < state.brightLockUntil) return;
  const changed = state.bright >= 0 && m.bright !== state.bright;
  state.bright = m.bright;
  if (!brightSlider.dragging) brightSlider.set(m.bright / 100);
  $('#bright-val').textContent = `${m.bright}%`;
  if (changed && lastMode !== 'expanded') showHud('bright', m.bright / 100);
}

// ---------------- toasts & HUD ----------------
let toastTimer = null;
function dismissToast() {
  clearTimeout(toastTimer);
  state.toast = null;
  state.toastAction = null;
  state.toastUntil = 0;
  render();
  reportRect();
  window.dispatchEvent(new Event('island:toast-end'));
}
// notices with their own animation around the island (style-2.css): the class plays it once
const TOAST_FX = { perf: 1500, saver: 1600, 'saver-stays': 1500, 'saver-off': 1100, charging: 1400, low: 1400, battery: 1000 };
let toastFxTimer = 0;
function toastFx(kind) {
  const cls = kind === 'perf' ? 'perf-burst' : `fx-${kind}`;
  island.classList.remove(...[...island.classList].filter((c) => c.startsWith('fx-') || c === 'perf-burst'));
  clearTimeout(toastFxTimer);
  if (!TOAST_FX[kind] || state.features.noAnimations) return;
  void island.offsetWidth; // so it plays again on a second one in a row
  island.classList.add(cls, 'fx-burst');
  toastFxTimer = setTimeout(() => island.classList.remove(cls, 'fx-burst'), TOAST_FX[kind]);
}
function showToast(kind, label, value, pct, ms = 3200, action = null) {
  state.toastAction = action;
  const t = $('.l-toast');
  t.className = `layer l-toast ${kind}`;
  $('#t-label').textContent = label;
  $('#t-value').textContent = value;
  $('.l-toast .batt b').style.width = `${Math.round((pct ?? 0) * 100)}%`;
  $('.t-bar b').style.width = `${Math.round((pct ?? 0) * 100)}%`;
  // vertical variant
  $('.l-vtoast').className = `layer vlayer l-vtoast ${kind}`;
  $('#vt-value').textContent = kind === 'kai-flow' ? label : kind === 'done' ? 'Done' : value;
  $('.v-bar b').style.height = `${Math.round((pct ?? 0) * 100)}%`;
  state.toast = kind;
  state.toastUntil = Date.now() + ms;
  render();
  reportRect();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(dismissToast, ms + 50);
  toastFx(kind);
}

function showHud(kind, value, muted) {
  if (!feat(kind === 'vol' ? 'hudVolume' : 'hudBrightness')) return;
  const pct = muted ? 0 : value;
  showToast(kind, '', muted ? 'Muted' : `${Math.round(value * 100)}%`, pct, 1600);
  if (kind === 'vol') {
    volIconClass($('.l-toast'), value, !!muted);
    volIconClass($('.l-vtoast'), value, !!muted);
  }
}

// ---------------- battery ----------------
if (navigator.getBattery) {
  navigator.getBattery().then((b) => {
    let lowShown = false;
    const pct = () => `${Math.round(b.level * 100)}%`;
    b.addEventListener('chargingchange', () => {
      if (!feat('battery')) return;
      if (b.charging) showToast('charging', 'Charging', pct(), b.level);
      else showToast(b.level <= 0.2 ? 'low' : 'battery', 'On Battery', pct(), b.level);
    });
    b.addEventListener('levelchange', () => {
      if (!b.charging && b.level <= 0.2 && !lowShown && feat('battery')) {
        lowShown = true;
        showToast('low', 'Low Battery', pct(), b.level, 4500);
      }
      if (b.level > 0.2) lowShown = false;
    });
  });
}

// ---------------- file drag & drop (routes to the shelf) ----------------
const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
function endDrop() {
  state.dragging = false;
  island.classList.remove('dropping');
  render();
}
window.addEventListener('dragenter', (e) => {
  // with the Shelf tab switched off the island doesn't take files at all
  if (internalDrag || !hasFiles(e) || !feat('tabShelf')) return;
  e.preventDefault();
  if (!state.dragging) {
    state.dragging = true;
    island.classList.add('dropping');
    selectTab('shelf');
    render();
  }
});
window.addEventListener('dragover', (e) => {
  if (internalDrag || !hasFiles(e) || !feat('tabShelf')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) endDrop();
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files || []);
  endDrop();
  if (internalDrag || !files.length) return;
  if (!bridge.shelf.addFiles(files)) showToast('dl-error', "Couldn't add these files to the shelf", '', 0, 3500);
});
document.addEventListener('pointermove', (e) => {
  if (internalDrag && e.buttons === 0) internalDrag = false;
});

// ---------------- timer ----------------
const RING = 276.46;

function setTimer(min, phase = null) {
  state.timer = { total: min * 60, remaining: min * 60, endAt: 0, running: false, phase };
  island.classList.toggle('focus-on', phase === 'focus');
  island.classList.toggle('break-on', phase === 'break');
  $$('[data-min]').forEach((b) => b.classList.toggle('sel', Number(b.dataset.min) === min));
  drawTimer();
  render();
}

function drawTimer() {
  const t = state.timer;
  const rem = t.running ? Math.max(0, (t.endAt - Date.now()) / 1000) : t.remaining;
  const text = fmt(Math.ceil(rem));
  $('#tm-digits').textContent = text;
  $('#c-time').textContent = $('#vc-time').textContent = text;
  $('#tm-ring').style.strokeDashoffset = t.total ? RING * (1 - rem / t.total) : RING;
  const started = t.remaining > 0 && t.remaining < t.total;
  $('#tm-start').textContent = t.running ? 'Pause' : started ? 'Resume' : 'Start';
  const label = t.phase === 'focus' ? `Focus ${focus.round + 1}` : t.phase === 'break' ? 'Break' : 'Running';
  $('#tm-state').textContent = t.running ? label : started ? 'Paused' : t.total ? 'Ready' : 'Pick a time';
  $('#tm-focus').classList.toggle('sel', !!t.phase);
  $('#tm-reset').disabled = !t.total;
  return rem;
}

// One AudioContext for every sound: Chromium limits how many can be open, so creating one
// per alert made sounds silently stop after a while.
let audioCtx = null;
function playTones(notes, { peak = 0.25, attack = 0.02, decay = 0.35, type = 'sine' } = {}) {
  try {
    audioCtx ||= new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    for (const [d, f] of notes) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(peak, t0 + d + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + decay);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + d);
      o.stop(t0 + d + decay + 0.05);
    }
  } catch {}
}

function beep() {
  playTones([[0, 880], [0.22, 1108], [0.44, 1318]], { peak: 0.25, decay: 0.35 });
}

$$('[data-min]').forEach((b) => b.addEventListener('click', () => setTimer(Number(b.dataset.min))));

$('#tm-start').addEventListener('click', () => {
  if (!state.timer.total) setTimer(5);
  const t = state.timer;
  if (t.running) {
    t.remaining = Math.max(0, (t.endAt - Date.now()) / 1000);
    t.running = false;
  } else if (t.remaining > 0) {
    t.endAt = Date.now() + t.remaining * 1000;
    t.running = true;
  }
  drawTimer();
  render();
});

// ---- focus sessions: focus, then a break that starts by itself (longer after every 4th) ----
const focus = { round: 0 };
function startPhase(phase) {
  const f = state.features;
  const min = phase === 'focus' ? f.focusMin || 25 : (focus.round % 4 === 0 ? f.longBreakMin || 15 : f.breakMin || 5);
  setTimer(min, phase);
  state.timer.endAt = Date.now() + state.timer.remaining * 1000;
  state.timer.running = true;
  drawTimer();
  render();
  // Nova puts her headband on and opens her laptop
  if (phase === 'focus' && (window.phoenix?.style() !== 'classic' || feat('novaFocus'))) {
    $('.sc-laptop-time').textContent = `${min}:00`;
    window.playScene?.({
      who: 'nova', phoenixPose:'focus', props: ['band', 'laptop'], arms: 'type', tone: 'focus', badge: '🎯 Focus',
      title: 'Focus time',
      sub: `<b>${min} min</b> of deep work — reminders stay quiet until it ends`,
      ms: 6000,
    });
  }
}
// while focusing, reminders and other gentle interruptions wait
const focusing = () => state.timer.phase === 'focus' && timerActive();
$('#tm-focus').addEventListener('click', () => {
  if (state.timer.phase) return;
  focus.round = 0;
  startPhase('focus');
});

$('#tm-reset').addEventListener('click', () => {
  focus.round = 0;
  island.classList.remove('focus-on', 'break-on');
  state.timer = { total: 0, remaining: 0, endAt: 0, running: false };
  $$('[data-min]').forEach((b) => b.classList.remove('sel'));
  drawTimer();
  render();
});

setInterval(() => {
  if (!state.timer.running) return;
  const rem = drawTimer();
  if (rem <= 0 && state.timer.phase) {
    const wasFocus = state.timer.phase === 'focus';
    island.classList.add('alert');
    setTimeout(() => island.classList.remove('alert'), 1000);
    if (wasFocus) {
      focus.round++;
      startPhase('break');
      const brk = Math.round(state.timer.total / 60);
      const shown = (window.phoenix?.style() !== 'classic' || feat('novaFocus')) && window.playScene?.({
        who: 'nova', phoenixPose:'focus-complete', phoenixSequence:[{pose:'celebration',at:3000},{pose:'break',at:5000}], props: ['band'], arms: 'rest', tone: 'focus', badge: '🎯 Focus',
        title: 'Well done! 🎉',
        sub: `Focus session <b>${focus.round}</b> done · <b>${brk} min</b> break`,
        ms: 8000,
      });
      if (!shown) showToast('done', `Focus ${focus.round} done`, `Break ${brk} min`, 0, 4500);
      celebrate(['#ff6b6b', '#ffd479', '#ff9f0a']);
      const done = () => playTones([[0, 784], [0.2, 988]], { peak: 0.2, decay: 0.6 });
      if (window.timerAlarm) window.timerAlarm(done); else done();
    } else {
      setTimer(state.features.focusMin || 25, null);
      island.classList.remove('focus-on', 'break-on');
      showToast('done', 'Break over', 'Focus', 0, window.timerAlarmMs || 9000, () => startPhase('focus'));
      if (window.timerAlarm) window.timerAlarm(beep); else beep();
    }
    return;
  }
  if (rem <= 0) {
    state.timer = { total: 0, remaining: 0, endAt: 0, running: false };
    $$('[data-min]').forEach((b) => b.classList.remove('sel'));
    drawTimer();
    showToast('done', 'Timer Done', '', 0, window.timerAlarmMs || 4000);
    if (window.timerAlarm) window.timerAlarm(beep); else beep();
  }
}, 250);

// ---------------- settings ----------------
const TAB_FEATURE = { media: 'tabMedia', apps: 'tabApps', shelf: 'tabShelf', prayer: 'tabPrayer', timer: 'tabTimer', system: 'tabSystem' };

// Hide tabs that are switched off (Downloads shows itself only around download activity).
function refreshTabs() {
  $$('.tab').forEach((b) => {
    const t = b.dataset.tab;
    // Downloads shows itself around download activity, Radio only with its plugin
    const hide = t === 'downloads' ? !state.dl.tab : t === 'radio' ? !state.radioTab : !feat(TAB_FEATURE[t]);
    if (b.hidden !== hide) b.hidden = hide;
  });
  if ($(`.tab[data-tab="${state.tab}"]`)?.hidden) {
    const first = [...$$('.tab')].find((b) => !b.hidden);
    if (first) selectTab(first.dataset.tab);
  }
  placeSegThumb();
}

function applyFeatures(f) {
  state.features = f || {};
  if (state.toast === 'kai-flow' && !state.features.kaiNotifications) state.toastUntil = 0;
  // performance options (or the battery saver): a solid island, and no movement
  document.body.classList.toggle('no-blur', state.features.noBlur === true);
  document.body.classList.toggle('no-anim', state.features.noAnimations === true);
  // the island's theme (themes.css); a theme without glass needs no backdrop
  document.body.dataset.theme = state.features.theme || 'original';
  document.body.classList.toggle('th-solid', !getComputedStyle(document.body).getPropertyValue('--th-glass').trim());
  $$('[data-feat]').forEach((el) => el.classList.toggle('off', !feat(el.dataset.feat)));
  if ($('.info-slide.on')?.classList.contains('off')) showSlide(0);
  refreshTabs();
  render();
  positionIsland();
  window.dispatchEvent(new CustomEvent('island:features', { detail: state.features }));
}
bridge.onFeatures(applyFeatures);
// a screen recorder is running (NVIDIA Instant Replay, OBS): a glass theme turns solid until it's gone
bridge.onRecording((on) => document.body.classList.toggle('th-rec', !!on));
// the battery saver switched off, the PC on Ultimate Performance: its own notice (style-2.css)
function performanceMode(s) {
  showToast('perf', 'Performance mode', s.hz ? `Ultimate · ${s.hz} Hz` : 'Ultimate', 0, 4500); // (its burst: toastFx)
}
window.saverToast = (s) => s.perf ? performanceMode(s) : showToast(s.stays ? 'saver-stays' : s.on ? 'saver' : 'saver-off',
  s.stays ? 'Battery saver stays on' : s.on ? 'Battery saver is on' : 'Battery saver is off',
  s.stays ? `${s.pct}% · below ${s.at}%` : s.pct >= 0 ? `${s.pct}%` : '', 0, 3500);
bridge.onSaver(window.saverToast);
bridge.onVisibility((v) => {
  state.visible = !!v;
  syncProgress();
  syncAudioMeter();
  if (v) reportRect();
});
bridge.features().then(applyFeatures);
$('#open-settings').addEventListener('click', () => bridge.openSettings());

selectTab('media');
document.fonts.ready.then(() => placeSegThumb());
drawTimer();
render();
