// Opening and closing the island (pill <-> panel): the content turns to soft dust and drifts into
// the new layout while the glass springs to its new shape. The dust is made from pictures of each
// state, taken when that state was last on screen and had settled; the first time a state shows
// there's no picture yet, so that one change uses the plain crossfade.
(() => {
  const DUST_MODES = ['idle', 'compact', 'peek', 'expanded'];
  const big = (m) => m === 'peek' || m === 'expanded';
  const DUR = 620;
  // Settings > Dust speed
  const pace = () => ({ slow: 1.45, fast: 0.7 })[state.features.dustSpeed] || 1;
  // the open panel looks different on every tab, so it gets a picture per tab
  const key = (mode) => (mode === 'expanded' ? `expanded:${state.tab}` : mode);
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
  // Graphics: Low keeps no pictures and draws no dust (it's all on the CPU there)
  const low = () => state.features.graphics === 'low';
  async function snap(mode) {
    if (low() || anim || lastMode !== mode || !DUST_MODES.includes(mode) || state.moving || !state.visible) return;
    const r = island.getBoundingClientRect();
    let pic;
    try { pic = await bridge.snapIsland({ x: r.left, y: r.top, width: r.width, height: r.height }); } catch { return; }
    if (!pic || anim || lastMode !== mode) return;
    const radius = parseFloat(getComputedStyle($('.clip')).borderTopLeftRadius) || 0;
    snaps.set(key(mode), { pts: grains(pic, r.width, r.height, radius) });
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
    const step = 2.2;
    const pts = [];
    for (let y = step / 2; y < h; y += step) {
      for (let x = step / 2; x < w; x += step) {
        if (!inside(x, y)) continue;
        const i = at(x, y);
        const b = px[i], g = px[i + 1], r = px[i + 2];
        if (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb) > 70) pts.push({ x, y, c: `rgb(${r},${g},${b})` });
      }
    }
    // keep it light: at most ~6000 grains
    const keep = Math.max(1, Math.ceil(pts.length / 6000));
    return keep === 1 ? pts : pts.filter((_, i) => i % keep === 0);
  }

  // ---- the change ----
  function stop() {
    if (!anim) return;
    const song = anim.hide === 'song-dusting';
    anim = null;
    island.classList.remove('dusting', 'song-dusting');
    canvas.hidden = true;
    if (song) scheduleSnap(lastMode); // the pictures of this mode still show the old song
  }
  function start(a, hide) {
    anim = a;
    a.hide = hide;
    island.classList.add(hide);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.ceil(innerWidth * dpr); canvas.height = Math.ceil(innerHeight * dpr);
    layer.width = Math.ceil(canvas.width / 2); layer.height = Math.ceil(canvas.height / 2);
    canvas.hidden = false;
    Object.assign(a, { start: performance.now(), dpr, shown: false });
    requestAnimationFrame(tick);
  }
  window.addEventListener('island:mode', (e) => {
    const { mode, prev } = e.detail;
    scheduleSnap(mode);
    // turned back mid-change (the pointer left while it was still opening): the same dust turns
    // around from wherever it is, instead of starting over
    if (anim && anim.kind === 'soft' && mode === anim.prev && prev === anim.mode) {
      const t = clamp((performance.now() - anim.start) / anim.dur, 0, 1);
      for (const p of anim.seed) {
        [p.sx, p.tx] = [p.tx, p.sx]; [p.sy, p.ty] = [p.ty, p.sy]; [p.sc, p.tc] = [p.tc, p.sc];
        p.at = 0.14 - p.at; // (1 - 0.86): each grain stays at the same point of its curve
      }
      anim.start = performance.now() - (1 - t) * anim.dur;
      anim.mode = mode; anim.prev = prev;
      anim.shown = 1 - t >= 0.5;
      island.classList.toggle('dusting', !anim.shown);
      return;
    }
    stop();
    const from = snaps.get(key(prev)), to = snaps.get(key(mode));
    if (state.features.softDust === false || state.features.noAnimations || reduced.matches || low()) return;
    if (!from || !to || !DUST_MODES.includes(mode) || !DUST_MODES.includes(prev) || big(mode) === big(prev) || !target || state.moving) return;
    // the island still has its old geometry this frame (its size transition hasn't moved yet)
    const ra = island.getBoundingClientRect();
    const rb = target;
    const src = from.pts.map((p) => ({ x: ra.left + p.x, y: ra.top + p.y, c: p.c }));
    const dst = to.pts.map((p) => ({ x: rb.left + p.x, y: rb.top + p.y, c: p.c }));
    if (!src.length || !dst.length) return;
    const thanos = state.features.dustStyle === 'thanos';
    const a = thanos ? snapSeed(src, dst, ra, rb) : softSeed(src, dst, ra);
    a.mode = mode; a.prev = prev;
    start(a, 'dusting');
  });

  // ---- a new song where one is showing: its words and artwork turn to dust and reform as the new
  // song's, in place. The new song has never been on screen, so there's no picture of it: both are
  // drawn here, off screen, from the elements' own places, fonts, colours and images.
  const SONG = { compact: ['#c-art', '#c-title'], peek: ['#p-art', '#p-title', '#p-artist'], expanded: ['#m-art', '#m-title', '#m-artist'] };
  const pad = document.createElement('canvas');
  const pctx = pad.getContext('2d', { willReadFrequently: true });
  function songEls() {
    const sels = SONG[lastMode];
    if (!sels || (lastMode === 'expanded' && state.tab !== 'media')) return [];
    return sels.map((s) => $(s)).filter((el) => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
    });
  }
  function songGrains(els, art) { // art: the new song's decoded artwork, drawn in place of the <img>s
    const box = island.getBoundingClientRect();
    pad.width = Math.max(1, Math.ceil(box.width)); pad.height = Math.max(1, Math.ceil(box.height));
    pctx.clearRect(0, 0, pad.width, pad.height);
    for (const el of els) {
      const r = el.getBoundingClientRect(), x = r.left - box.left, y = r.top - box.top;
      pctx.save();
      if (el.tagName === 'IMG') {
        const img = art || el;
        if (img.naturalWidth) {
          pctx.beginPath();
          pctx.roundRect(x, y, r.width, r.height, parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0);
          pctx.clip();
          const k = Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight); // object-fit: cover
          pctx.drawImage(img, x + (r.width - img.naturalWidth * k) / 2, y + (r.height - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
        }
      } else {
        // the pill's title scrolls inside its box: clip to the box, draw where the words are now
        const cs = getComputedStyle(el), c = (el.parentElement.classList.contains('c-title') ? el.parentElement : el).getBoundingClientRect();
        pctx.beginPath(); pctx.rect(c.left - box.left, c.top - box.top, c.width, c.height); pctx.clip();
        pctx.font = cs.font; pctx.fillStyle = cs.color; pctx.direction = cs.direction;
        const rtl = cs.direction === 'rtl';
        pctx.textAlign = rtl ? 'right' : 'left'; pctx.textBaseline = 'middle';
        pctx.fillText(el.textContent, rtl ? x + r.width : x, y + r.height / 2);
      }
      pctx.restore();
    }
    const px = pctx.getImageData(0, 0, pad.width, pad.height).data, pts = [];
    for (let y = 1.1; y < pad.height; y += 1.6) {
      for (let x = 1.1; x < pad.width; x += 1.6) {
        const i = ((y | 0) * pad.width + (x | 0)) * 4;
        if (px[i + 3] > 90) pts.push({ x: box.left + x, y: box.top + y, c: `rgb(${px[i]},${px[i + 1]},${px[i + 2]})` });
      }
    }
    const keep = Math.max(1, Math.ceil(pts.length / 6000));
    return { pts: keep === 1 ? pts : pts.filter((_, i) => i % keep === 0), box };
  }
  const enabled = () => state.features.softDust !== false && !state.features.noAnimations && !reduced.matches && !low();
  window.songDust = {
    enabled,
    can: () => enabled() && !anim && songEls().length > 0,
    // a new song: the pictures of the places it shows in are of the old one
    forget: () => { for (const k of [...snaps.keys()]) if (k === 'compact' || k === 'peek' || k === 'expanded:media') snaps.delete(k); },
    // the old song as it's shown right now (before the new one is put in)
    from: () => songGrains(songEls()),
    // call with the new song already in place and hidden (the 'song-dusting' class)
    play(from, art) {
      const to = songGrains(songEls(), art);
      if (!from.pts.length || !to.pts.length || anim) { island.classList.remove('song-dusting'); return; }
      const a = state.features.dustStyle === 'thanos' ? snapSeed(from.pts, to.pts, from.box, to.box) : softSeed(from.pts, to.pts, from.box);
      start(a, 'song-dusting');
    },
  };

  const hash = (i) => Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);

  // Soft: every grain glides on one gentle curve from the old layout to its place in the new one.
  function softSeed(src, dst, ra) {
    const order = (p) => p.x + p.y * 0.35;
    src.sort((m, n) => order(m) - order(n)); dst.sort((m, n) => order(m) - order(n));
    const n = Math.max(src.length, dst.length), seed = new Array(n);
    for (let i = 0; i < n; i++) {
      const s = src[Math.floor(i * src.length / n)], d = dst[Math.floor(i * dst.length / n)];
      const mx = (s.x + d.x) / 2, my = (s.y + d.y) / 2, f = field(mx, my);
      seed[i] = { sx: s.x, sy: s.y, tx: d.x, ty: d.y, sc: s.c, tc: d.c,
        cx: mx + Math.cos(f * 1.4) * 10, cy: my + Math.sin(f * 1.4) * 6 - 4,
        // nearly together, so the dust moves as one body
        at: (s.x - ra.left) / Math.max(ra.width, 1) * 0.05 + hash(i) * 0.03 };
    }
    return { kind: 'soft', seed, dur: DUR * pace() };
  }

  // Thanos snap: the old content crumbles into ash that blows off up and to the right in a ragged
  // sweep; the new content is blown in the same way, reversed, and settles into place.
  const ASH = [118, 104, 92];
  function snapSeed(src, dst, ra, rb) {
    const grain = (p, i, r, out) => {
      const h1 = hash(i + (out ? 0 : 7919)), h2 = hash(i * 3 + 11), h3 = hash(i * 7 + 5);
      const along = (p.x - r.left) / Math.max(r.width, 1);
      const rgb = p.c.match(/\d+/g).map(Number);
      return { x: p.x, y: p.y, rgb,
        // where the wind takes it: right and up, with a curl
        vx: 26 + h1 * 64, vy: -(12 + h2 * 46), curl: (h3 - 0.5) * 24,
        // the ragged edge of the sweep: left to right, with noise
        at: along * 0.42 + h2 * 0.16, size: 1.6 + h3 * 1.6 };
    };
    return { kind: 'thanos', out: src.map((p, i) => grain(p, i, ra, true)), in: dst.map((p, i) => grain(p, i, rb, false)), dur: 900 * pace() };
  }

  function tick(now) {
    const a = anim;
    if (!a) return;
    const t = clamp((now - a.start) / a.dur, 0, 1);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, layer.width, layer.height);
    lctx.setTransform(a.dpr / 2, 0, 0, a.dpr / 2, 0, 0);
    let blur;
    if (a.kind === 'soft') {
      // the real content comes back under the settling dust
      if (t >= 0.5 && !a.shown) { a.shown = true; island.classList.remove(a.hide); }
      const fadeOut = 1 - glide((t - 0.5) / 0.5);
      const fadeIn = glide(t / 0.12); // the old content melts into its dust instead of vanishing
      for (const p of a.seed) {
        const u = glide((t - p.at) / 0.86);
        const v = 1 - u;
        const x = v * v * p.sx + 2 * v * u * p.cx + u * u * p.tx;
        const y = v * v * p.sy + 2 * v * u * p.cy + u * u * p.ty;
        const air = Math.sin(Math.PI * u);
        const size = 2.6 + 2.8 * air;
        lctx.globalAlpha = (0.8 - 0.3 * air) * fadeOut * fadeIn;
        lctx.fillStyle = u < 0.5 ? p.sc : p.tc;
        lctx.fillRect(x - size / 2, y - size / 2, size, size);
      }
      blur = 0.8 + 2.6 * Math.sin(Math.PI * t);
    } else {
      if (t >= 0.86 && !a.shown) { a.shown = true; island.classList.remove(a.hide); }
      const settle = 1 - glide((t - 0.86) / 0.14);
      const ash = (rgb, k) => `rgb(${rgb[0] + (ASH[0] - rgb[0]) * k | 0},${rgb[1] + (ASH[1] - rgb[1]) * k | 0},${rgb[2] + (ASH[2] - rgb[2]) * k | 0})`;
      // out: from 0 to ~0.7 of the change
      for (const p of a.out) {
        const q = clamp((t * 1.35 - p.at) / 0.55, 0, 1);
        if (q >= 1) continue;
        const e = q * q * (3 - 2 * q);
        lctx.globalAlpha = 0.9 * (1 - q);
        lctx.fillStyle = ash(p.rgb, Math.min(1, q * 1.6));
        const s = p.size * (1 - 0.45 * q);
        lctx.fillRect(p.x + p.vx * e + Math.sin(e * 3) * p.curl * 0.3 - s / 2, p.y + p.vy * e + Math.cos(e * 2.4) * p.curl * 0.2 - s / 2, s, s);
      }
      // in: blown in from the same wind, settling from ~0.3
      for (const p of a.in) {
        const q = clamp(((t - 0.3) * 1.5 - p.at * 0.5) / 0.6, 0, 1);
        if (q <= 0) continue;
        const e = 1 - (1 - q) * (1 - q) * (1 - q);
        const r = 1 - e;
        lctx.globalAlpha = 0.9 * e * settle;
        lctx.fillStyle = ash(p.rgb, r);
        const s = p.size * (0.6 + 0.4 * e);
        lctx.fillRect(p.x + p.vx * r + Math.sin(r * 3) * p.curl * 0.3 - s / 2, p.y + p.vy * r + Math.cos(r * 2.4) * p.curl * 0.2 - s / 2, s, s);
      }
      blur = 0.4 + 0.6 * Math.sin(Math.PI * t); // ash stays grainy
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.filter = `blur(${(blur * a.dpr).toFixed(2)}px)`;
    ctx.drawImage(layer, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';
    if (t < 1) requestAnimationFrame(tick);
    else stop();
  }

  // hidden (a fullscreen app): no frames come, so don't leave a half-done dust to flash on return
  bridge.onVisibility((v) => { if (!v) stop(); });

  // anything clicked in the open panel (another tab, a button) changes it: a fresh picture shortly after
  island.addEventListener('click', () => { if (lastMode === 'expanded') scheduleSnap('expanded'); });

  // the first picture of whatever state the island starts in
  scheduleSnap(lastMode);
})();
