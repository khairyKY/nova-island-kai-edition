// Build a soft glass plate from pixels just outside our overlay window. The overlay stays
// visible in screenshots, and none of its own text/artwork can feed back into the glass.
// The native helper samples those pixels (`strips`): a column left and right of the window,
// a row above and below, base64 BGRA. Left/right blend across; without them, top/bottom
// blend down (a window flush with the screen's sides).
const W = 32, H = 64;
function stripBackdrop(s) {
  const dec = (b64) => (b64 ? Buffer.from(b64, 'base64') : null);
  const left = dec(s.left), right = dec(s.right), top = dec(s.top), bottom = dec(s.bottom);
  const horizontal = !!(left || right);
  const a = horizontal ? left || right : top || bottom;
  const b = horizontal ? right || left : bottom || top;
  if (!a) return null;
  const n = horizontal ? s.cols : s.rows;
  const bgra = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // position along the strips, and how far across from strip a to strip b
      const along = horizontal ? y / (H - 1) : x / (W - 1);
      const t = horizontal ? x / (W - 1) : y / (H - 1);
      const i = Math.round(along * (n - 1)) * 4;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) bgra[o + c] = Math.round(a[i + c] * (1 - t) + b[i + c] * t);
      bgra[o + 3] = 255;
    }
  }
  return { w: W, h: H, bgra };
}
module.exports = { stripBackdrop };

if (require.main === module) {
  // self-check: red on the left, blue on the right blends across, top-only falls back to rows
  const col = (r, g, b, n) => Buffer.from(Array.from({ length: n }, () => [b, g, r, 255]).flat()).toString('base64');
  const f = stripBackdrop({ left: col(255, 0, 0, 64), right: col(0, 0, 255, 64), top: null, bottom: null, cols: 64, rows: 32 });
  console.assert(f.bgra[2] === 255 && f.bgra[0] === 0, 'left edge red');
  console.assert(f.bgra[(W - 1) * 4] === 255 && f.bgra[(W - 1) * 4 + 2] === 0, 'right edge blue');
  const g = stripBackdrop({ left: null, right: null, top: col(0, 255, 0, 32), bottom: null, cols: 64, rows: 32 });
  console.assert(g.bgra[1] === 255, 'rows fallback');
  console.assert(stripBackdrop({ left: null, right: null, top: null, bottom: null }) === null, 'nothing visible');
  console.log('backdrop ok');
}
