// Pady's notices ("Copied", "Pasted", a track skipped) as a drop of the island's own glass: it swells
// out of the island's lower edge, eases down a little, opens into the notice and floats, then closes
// and rises back into the island. The island and the bead are one material through the #goo filter
// (index.html), but only while they touch (splitting off, merging back): the filter is redrawn on the
// CPU every frame, so while the notice floats it is a plain pill on a CSS animation instead.
(() => {
  const wrap = $('#pady-drop');
  const goo = wrap.querySelector('.pd-goo');
  const body = wrap.querySelector('.pd-body');
  const bead = wrap.querySelector('.pd-bead');
  const pill = wrap.querySelector('.pd-pill');
  const text = pill.querySelector('.pd-text');
  const R = 15;        // bead radius
  const HANG = 24;     // open notice: its centre this far below the island's lower edge
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = '600 13px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (t) => 0.5 - Math.cos(Math.PI * clamp(t, 0, 1)) / 2;   // slow in, slow out
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const HOLD_MS = 1300;
  let anim = null;
  const queue = [];

  // the drop is made of the island's own surface colour, made opaque
  function surface() {
    const c = getComputedStyle($('.clip')).backgroundColor.match(/[\d.]+/g) || [20, 20, 26];
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }
  function place(el, cx, cy, w, h) {
    Object.assign(el.style, { width: `${w}px`, height: `${h}px`, borderRadius: `${h / 2}px`, left: `${cx - w / 2}px`, top: `${cy - h / 2}px` });
  }

  // how long the open notice floats, then the way home (restarted when a new notice joins it)
  function hold(a) {
    clearTimeout(a.timer); clearTimeout(a.timer2);
    const ms = state.features.noAnimations ? 900 : HOLD_MS;
    // the text fades out first, then the pill hands back to the goo for the way home
    a.timer = setTimeout(() => { text.style.opacity = 0; }, ms - 160);
    a.timer2 = setTimeout(() => {
      // where the float has the pill right now (as drawn), so the way back starts there without a jump
      const rc = pill.getBoundingClientRect();
      a.offset = rc.top + rc.height / 2 - (a.edge + HANG);
      pill.hidden = true;
      goo.hidden = false;
      a.phase = 'back';
      a.start = performance.now();
      requestAnimationFrame(tick);
    }, ms);
  }

  function play(notice) {
    // a notice while a drop is out joins it (copy, then paste): new text, and the float starts over;
    // only once the drop is on its way home does the next one wait for its own
    if (anim && anim.phase !== 'back') {
      text.textContent = notice.title;
      anim.w = Math.max(96, measure.measureText(notice.title).width + 52);
      if (anim.phase === 'float') {
        place(pill, anim.cx, anim.edge + HANG, anim.w, 2 * R + 2);
        text.style.opacity = 1;
        hold(anim);
      }
      return;
    }
    if (anim) { queue.push(notice); return; }
    const r = island.getBoundingClientRect();
    const fill = surface();
    body.style.background = bead.style.background = pill.style.background = fill;
    Object.assign(body.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: getComputedStyle($('.clip')).borderRadius });
    text.textContent = notice.title;
    text.style.opacity = 0;
    pill.hidden = true;
    goo.hidden = false;
    wrap.hidden = false;
    const w = Math.max(96, measure.measureText(notice.title).width + 52);
    anim = { phase: 'out', start: performance.now(), cx: r.left + r.width / 2, edge: r.bottom, w };
    place(bead, anim.cx, r.bottom - 10, 2 * R * 0.35, 2 * R * 0.35); // not where the last drop left it
    requestAnimationFrame(tick);
  }

  // out (0-700 ms): swell 0-250, ease down 180-560, open 520-700, then the pill floats on CSS
  // back (0-520 ms after the float): close 0-160, rise and merge 120-520
  function tick(now) {
    const a = anim;
    if (!a) return;
    const ms = state.features.noAnimations ? 1e6 : now - a.start;
    const hang = a.edge + HANG;
    if (a.phase === 'out') {
      const swell = easeOut(ms / 250);
      const down = ease((ms - 180) / 380);
      const open = ease((ms - 520) / 180);
      const cy = a.edge - 10 + 14 * swell + (HANG - 4) * down;
      const d = 2 * R * (0.35 + 0.65 * swell);
      place(bead, a.cx, cy, d + (a.w - d) * open, d + 2 * open);
      if (ms < 700) { requestAnimationFrame(tick); return; }
      // free of the island: hand over to the plain pill, floating on the compositor
      place(pill, a.cx, hang, a.w, 2 * R + 2);
      pill.hidden = false;
      goo.hidden = true;
      requestAnimationFrame(() => { text.style.opacity = 1; });
      a.phase = 'float';
      hold(a);
      return;
    }
    if (a.phase === 'back') {
      const close = ease(ms / 160);
      const rise = ease((ms - 120) / 400);
      const cy = hang + (a.offset || 0) * (1 - rise) - (HANG + 6) * rise;
      const k = 1 - 0.55 * rise;   // the bead shrinks as it rises into the island
      place(bead, a.cx, cy, (a.w + (2 * R - a.w) * close) * k, (2 * R + 2 - 2 * close) * k);
      if (ms < 520) { requestAnimationFrame(tick); return; }
      wrap.hidden = true;
      anim = null;
      if (queue.length) play(queue.shift());
    }
  }

  window.padyDrop = (notice) => {
    if (!state.visible) return;
    if (queue.length >= 5) queue.shift();
    play(notice);
  };
})();
