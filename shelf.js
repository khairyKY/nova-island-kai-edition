// File shelf: files dropped on the island, kept as paths (nothing is copied). Screenshots added
// on their own carry an expiry time: they leave the shelf then (the file itself is never touched).
const fs = require('fs');
const path = require('path');
const { app, shell, nativeImage } = require('electron');
const settings = require('./settings');

const MAX_ITEMS = 24;
const EXPIRE_CHECK_MS = 30 * 1000;
// { path, until? } (older versions saved plain paths)
let items = settings.load('shelf.json', [])
  .map((x) => (typeof x === 'string' ? { path: x } : x))
  .filter((x) => x && typeof x.path === 'string' && fs.existsSync(x.path));
const icons = new Map();
const previews = new Map();
let onExpire = () => {};

async function iconFor(p) {
  if (!icons.has(p)) {
    let img = nativeImage.createEmpty();
    try {
      img = await app.getFileIcon(p, { size: 'large' });
    } catch {}
    icons.set(p, img);
  }
  return icons.get(p);
}

const has = (p) => items.some((x) => x.path === p);

async function previewFor(p) {
  if (!/\.(png|jpe?g|webp|bmp|gif|tiff?|avif)$/i.test(p)) return '';
  try {
    const stat = fs.statSync(p);
    const stamp = stat.mtimeMs + ':' + stat.size;
    const cached = previews.get(p);
    if (cached?.stamp === stamp) return cached.promise;
    const request = { stamp, promise: null };
    request.promise = nativeImage.createThumbnailFromPath(p, { width: 244, height: 144 })
      .then((image) => {
        if (!image.isEmpty()) return image.toDataURL();
        if (previews.get(p) === request) previews.delete(p);
        return '';
      })
      .catch(() => {
        if (previews.get(p) === request) previews.delete(p);
        return '';
      });
    previews.set(p, request);
    return request.promise;
  } catch { return ''; }
}

function pruneCaches() {
  const paths = new Set(items.map((item) => item.path));
  for (const cache of [icons, previews]) {
    for (const p of cache.keys()) if (!paths.has(p)) cache.delete(p);
  }
}

async function list() {
  const existing = items.filter((x) => fs.existsSync(x.path));
  if (existing.length !== items.length) items = existing;
  pruneCaches();
  const snapshot = items;
  const files = await Promise.all(
    snapshot.map(async ({ path: p, until }) => {
      const [img, preview] = await Promise.all([iconFor(p), previewFor(p)]);
      return { path: p, name: path.basename(p) || p, icon: img.isEmpty() ? '' : img.toDataURL(), preview, until: until || 0 };
    })
  );
  return snapshot === items ? files : list();
}

function save() {
  pruneCaches();
  settings.save('shelf.json', items);
}

// until: when the file leaves the shelf on its own (ms); none = it stays
function add(paths, until = 0) {
  for (const p of paths) {
    if (typeof p !== 'string' || !p || !fs.existsSync(p)) continue;
    items = [until ? { path: p, until } : { path: p }, ...items.filter((x) => x.path !== p)];
  }
  // over the limit: the oldest timed screenshots go first, then the oldest files
  while (items.length > MAX_ITEMS) {
    const i = items.map((x) => !!x.until).lastIndexOf(true);
    items.splice(i >= 0 ? i : items.length - 1, 1);
  }
  save();
}

function remove(p) {
  items = items.filter((x) => x.path !== p);
  save();
}

function clear() {
  items = [];
  save();
}

// timed items whose time is up leave the shelf (also those that ran out while the app was closed)
function expire() {
  const now = Date.now();
  const left = items.filter((x) => !x.until || x.until > now);
  if (left.length === items.length) return;
  items = left;
  save();
  onExpire();
}

function start(changed) {
  onExpire = changed;
  expire();
  setInterval(expire, EXPIRE_CHECK_MS);
}

function open(p) {
  if (has(p)) shell.openPath(p);
}

function reveal(p) {
  if (has(p)) shell.showItemInFolder(p);
}

function startDrag(webContents, p) {
  if (!has(p)) return;
  let icon = icons.get(p);
  if (!icon || icon.isEmpty()) icon = nativeImage.createFromBitmap(Buffer.alloc(16 * 16 * 4, 255), { width: 16, height: 16 });
  webContents.startDrag({ file: p, icon });
}

module.exports = { start, list, add, remove, clear, open, reveal, startDrag };
