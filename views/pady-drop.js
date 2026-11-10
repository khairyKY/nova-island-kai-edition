// Pady's notices ("Copied", "Pasted", a track skipped) as a drop of the island's own glass: it swells
// out of the island's lower edge, splits off just below it, opens into the notice, then rises and
// merges back. The island and the bead are one material through the #goo filter (index.html).
(() => {
  const wrap = $('#pady-drop');
  const body = wrap.querySelector('.pd-body');
  const bead = wrap.querySelector('.pd-bead');
  const text = wrap.querySelector('.pd-text');
  const R = 15;         // bead radius
  const HANG = 25;      // open notice: its centre this far below the island's lower edge
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = '600 13px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  let anim = null;
  const queue = [];

  // the drop is made of the island's own surface colour, made opaque
  function surface() {
    const c = getComputedStyle($('.clip')).backgroundColor.match(/[\d.]+/g) || [20, 20, 26];
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }

  function play(notice) {
    if (anim) { queue.push(notice); return; }
    const r = island.getBoundingClientRect();
    const fill = surface();
    body.style.background = bead.style.background = fill;
    Object.assign(body.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: getComputedStyle($('.clip')).borderRadius });
    text.firstChild.nodeValue = notice.title;
    wrap.hidden = false;
    anim = { start: performance.now(), cx: r.left + r.width / 2, edge: r.bottom, w: Math.max(96, measure.measureText(notice.title).width + 52) };
    requestAnimationFrame(tick);
  }

  // timeline (ms): swell 0-320, split 320-620, open 620-880, hold to 2280, close 2280-2520, rise and merge 2520-3040
  function tick(now) {
    const a = anim;
    if (!a) return;
    const ms = state.features.noAnimations ? Math.max(now - a.start, 620) : now - a.start;
    let cy, w, h, txt = 0;
    if (ms < 320) { const s = easeOut(ms / 320); cy = a.edge - 10 + 18 * s; w = h = 2 * R * (0.35 + 0.65 * s); }
    else if (ms < 620) { const s = smooth((ms - 320) / 300); cy = a.edge + 8 + (HANG - 8) * s; w = h = 2 * R; }
    else if (ms < 880) { const s = easeOut((ms - 620) / 260); cy = a.edge + HANG; w = 2 * R + (a.w - 2 * R) * s; h = 2 * R + 2 * s; txt = s; }
    else if (ms < 2280) { cy = a.edge + HANG + Math.sin(((ms - 880) / 1400) * Math.PI * 2) * 1.6; w = a.w; h = 2 * R + 2; txt = 1; }
    else if (ms < 2520) { const s = smooth((ms - 2280) / 240); cy = a.edge + HANG; w = a.w - (a.w - 2 * R) * s; h = 2 * R + 2 - 2 * s; txt = 1 - s * 1.6; }
    else if (ms < 3040) { const s = smooth((ms - 2520) / 520); cy = a.edge + HANG - (HANG + 6) * s; w = h = 2 * R * (1 - 0.55 * s); }
    else {
      wrap.hidden = true;
      anim = null;
      if (queue.length) play(queue.shift());
      return;
    }
    Object.assign(bead.style, { width: `${w}px`, height: `${h}px`, borderRadius: `${h / 2}px`, left: `${a.cx - w / 2}px`, top: `${cy - h / 2}px` });
    Object.assign(text.style, { left: `${a.cx}px`, top: `${cy}px`, opacity: clamp(txt, 0, 1) });
    requestAnimationFrame(tick);
  }

  window.padyDrop = (notice) => {
    if (!state.visible) return;
    if (queue.length >= 5) queue.shift();
    play(notice);
  };
})();
