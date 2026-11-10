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

  // timeline (ms): swell 0-420, split and sink 420-1300 (a soft spring: past its spot, then back up),
  // open 900-1200, float to 3000 (bob, sway, breathe), close 3000-3260, rise and merge 3260-4000
  const spring = (t) => 1 - Math.exp(-4.5 * t) * Math.cos(6.5 * t); // ~10% past, then settles
  const sine = (t) => 0.5 - Math.cos(Math.PI * t) / 2;
  function tick(now) {
    const a = anim;
    if (!a) return;
    const ms = state.features.noAnimations ? Math.max(now - a.start, 1200) : now - a.start;
    // the float: a slow bob, a slower sideways sway and a faint breath, all fading in once split
    const air = clamp((ms - 700) / 500, 0, 1) * (ms > 3000 ? clamp(1 - (ms - 3000) / 900, 0, 1) : 1);
    const bob = Math.sin(((ms - 700) / 2400) * Math.PI * 2) * 3 * air;
    const sway = Math.sin(((ms - 700) / 3100) * Math.PI * 2) * 2.2 * air;
    const breath = 1 + Math.sin(((ms - 700) / 1900) * Math.PI * 2) * 0.018 * air;
    let cy, w, h, txt = 0;
    if (ms < 420) { const s = easeOut(ms / 420); cy = a.edge - 10 + 18 * s; w = h = 2 * R * (0.35 + 0.65 * s); }
    else if (ms < 1300) { const s = spring((ms - 420) / 880); cy = a.edge + 8 + (HANG - 8) * s; w = h = 2 * R; }
    else cy = a.edge + HANG;
    if (ms >= 900 && ms < 3000) { const s = sine(clamp((ms - 900) / 300, 0, 1)); w = 2 * R + (a.w - 2 * R) * s; h = 2 * R + 2 * s; txt = s; }
    else if (ms >= 3000 && ms < 3260) { const s = sine((ms - 3000) / 260); w = a.w - (a.w - 2 * R) * s; h = 2 * R + 2 - 2 * s; txt = 1 - s * 1.6; }
    else if (ms >= 3260 && ms < 4000) { const s = sine((ms - 3260) / 740); cy = a.edge + HANG - (HANG + 6) * s; w = h = 2 * R * (1 - 0.55 * s); }
    else if (ms >= 4000) {
      wrap.hidden = true;
      anim = null;
      if (queue.length) play(queue.shift());
      return;
    }
    const x = a.cx + sway;
    cy += bob;
    w *= breath; h *= breath;
    Object.assign(bead.style, { width: `${w}px`, height: `${h}px`, borderRadius: `${h / 2}px`, left: `${x - w / 2}px`, top: `${cy - h / 2}px` });
    Object.assign(text.style, { left: `${x}px`, top: `${cy}px`, opacity: clamp(txt, 0, 1) });
    requestAnimationFrame(tick);
  }

  window.padyDrop = (notice) => {
    if (!state.visible) return;
    if (queue.length >= 5) queue.shift();
    play(notice);
  };
})();
