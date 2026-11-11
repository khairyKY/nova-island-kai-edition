// Opening and closing the island (pill <-> panel): the content turns to soft dust and drifts into
// the new layout while the glass springs to its new shape. The dust is made from pictures of each
// state, taken when that state was last on screen and had settled; the first time a state shows
// there's no picture yet, so that one change uses the plain crossfade.
(() => {
  const DUST_MODES = ['idle', 'compact', 'peek', 'expanded'];
  const big = (m) => m === 'peek' || m === 'expanded';
  const DUR = 950;
  const snaps = new Map(); // mode -> { pts: [{ x, y, c }] } (x, y from the island's top-left)
  const canvas = document.createElement('canvas');
  canvas.className = 'soft-dust';
  canvas.hidden = true;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  const layer = document.createElement('canvas');
  const lctx = layer.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const glide = (x) => { x = clamp(x, 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); }; // zero speed at both ends
  const field = (x, y) => Math.sin(x * 0.021) + Math.sin(y * 0.027) + Math.sin((x - y) * 0.013);
  let anim = null;
  let snapTimer = 0;

  // ---- pictures of each state ----
  function scheduleSnap(mode) {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => snap(mode), 700);
  }
  async function snap(mode) {
    if (anim || lastMode !== mode || !DUST_MODES.includes(mode) || state.moving || !state.visible) return;
    const r = island.getBoundingClientRect();
    let pic;
    try { pic = await bridge.snapIsland({ x: r.left, y: r.top, width: r.width, height: r.height }); } catch { return; }
    if (!pic || anim || lastMode !== mode) return;
    const radius = parseFloat(getComputedStyle($('.clip')).borderTopLeftRadius) || 0;
    snaps.set(mode, { pts: grains(pic, r.width, r.height, radius) });
  }
  // the content: pixels that stand out from the island's own surface, inside its rounded shape
  function grains(pic, w, h, radius) {
    const px = pic.bgra;
    const sx = pic.w / w, sy = pic.h / h;
    const at = (x, y) => (Math.min(pic.h - 1, Math.round(y * sy)) * pic.w + Math.min(pic.w - 1, Math.round(x * sx))) * 4;
    const inside = (x, y) => {
      const dx = Math.max(radius - x, 0, x - (w - radius)), dy = Math.max(radius - y, 0, y - (h - radius));
      return dx * dx + dy * dy <= (radius - 2) * (radius - 2) || (dx === 0 && dy === 0);
    };
    // the surface colour: the average of a ring just inside the edge
    const ring = [];
    const inset = Math.min(5, h / 4);
    for (let i = 1; i < 12; i++) ring.push([w * i / 12, inset], [w * i / 12, h - inset]);
    let sb = 0, sg = 0, sr = 0;
    for (const [x, y] of ring) { const i = at(x, y); sb += px[i]; sg += px[i + 1]; sr += px[i + 2]; }
    const [bb, bg, br] = [sb / ring.length, sg / ring.length, sr / ring.length];
    const step = 2.5;
    const pts = [];
    for (let y = step / 2; y < h; y += step) {
      for (let x = step / 2; x < w; x += step) {
        if (!inside(x, y)) continue;
        const i = at(x, y);
        const b = px[i], g = px[i + 1], r = px[i + 2];
        if (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb) > 70) pts.push({ x, y, c: `rgb(${r},${g},${b})` });
      }
    }
    // keep it light: at most ~5000 grains
    const keep = Math.max(1, Math.ceil(pts.length / 5000));
    return keep === 1 ? pts : pts.filter((_, i) => i % keep === 0);
  }

  // ---- the change ----
  function stop() {
    if (!anim) return;
    anim = null;
    island.classList.remove('dusting');
    canvas.hidden = true;
  }
  window.addEventListener('island:mode', (e) => {
    const { mode, prev } = e.detail;
    stop();
    scheduleSnap(mode);
    const from = snaps.get(prev), to = snaps.get(mode);
    if (state.features.softDust === false || state.features.noAnimations || reduced.matches) return;
    if (!from || !to || !DUST_MODES.includes(mode) || !DUST_MODES.includes(prev) || big(mode) === big(prev) || !target || state.moving) return;
    // the island still has its old geometry this frame (its size transition hasn't moved yet)
    const a = island.getBoundingClientRect();
    const b = target;
    const order = (p) => p.x + p.y * 0.35;
    const src = [...from.pts].sort((m, n) => order(m) - order(n)).map((p) => ({ x: a.left + p.x, y: a.top + p.y, c: p.c }));
    const dst = [...to.pts].sort((m, n) => order(m) - order(n)).map((p) => ({ x: b.left + p.x, y: b.top + p.y, c: p.c }));
    if (!src.length || !dst.length) return;
    const n = Math.max(src.length, dst.length);
    const seed = new Array(n);
    for (let i = 0; i < n; i++) {
      const s = src[Math.floor(i * src.length / n)], d = dst[Math.floor(i * dst.length / n)];
      const mx = (s.x + d.x) / 2, my = (s.y + d.y) / 2, f = field(mx, my);
      const h = Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
      seed[i] = { sx: s.x, sy: s.y, tx: d.x, ty: d.y, sc: s.c, tc: d.c,
        cx: mx + Math.cos(f * 1.4) * 14, cy: my + Math.sin(f * 1.4) * 8 - 5,
        at: (s.x - a.left) / Math.max(a.width, 1) * 0.18 + h * 0.04 };
    }
    island.classList.add('dusting');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.ceil(innerWidth * dpr); canvas.height = Math.ceil(innerHeight * dpr);
    layer.width = Math.ceil(canvas.width / 2); layer.height = Math.ceil(canvas.height / 2);
    canvas.hidden = false;
    anim = { seed, start: performance.now(), dpr, shown: false };
    requestAnimationFrame(tick);
  });

  function tick(now) {
    const a = anim;
    if (!a) return;
    const t = clamp((now - a.start) / DUR, 0, 1);
    // the real content comes back under the settling dust
    if (t >= 0.62 && !a.shown) { a.shown = true; island.classList.remove('dusting'); }
    const fadeOut = 1 - glide((t - 0.62) / 0.38);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, layer.width, layer.height);
    lctx.setTransform(a.dpr / 2, 0, 0, a.dpr / 2, 0, 0);
    for (const p of a.seed) {
      const u = glide((t - p.at) / 0.72);
      const v = 1 - u;
      const x = v * v * p.sx + 2 * v * u * p.cx + u * u * p.tx;
      const y = v * v * p.sy + 2 * v * u * p.cy + u * u * p.ty;
      const air = Math.sin(Math.PI * u);
      const size = 2.4 + 2.4 * air;
      lctx.globalAlpha = (0.8 - 0.3 * air) * fadeOut;
      lctx.fillStyle = u < 0.5 ? p.sc : p.tc;
      lctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.filter = `blur(${((0.7 + 2.2 * Math.sin(Math.PI * t)) * a.dpr).toFixed(2)}px)`;
    ctx.drawImage(layer, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';
    if (t < 1) requestAnimationFrame(tick);
    else stop();
  }

  // the first picture of whatever state the island starts in
  scheduleSnap(lastMode);
})();
