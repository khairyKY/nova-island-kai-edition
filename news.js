// News from the Nova team (a new plugin, an update worth trying, any news): news.json in the
// GitHub repository, read two minutes after start, every 15 minutes and when the PC wakes up or gets
// back online. Every item is signed with AmerTech's key; an item shows once, one a day at most,
// and links only to Nova's own pages. Nothing is sent from the PC: the file is only read.
const { app } = require('electron');
const settings = require('./settings');
const signing = require('./signing');
const log = require('./log');

const URL = 'https://raw.githubusercontent.com/NOVA-TECH-KIT/nova-island/main/news.json';
const FIRST_MS = 2 * 60 * 1000;
const EVERY_MS = 15 * 60 * 1000; // a ~1 KB file; GitHub itself caches it for about 5 minutes
const DAY_MS = 24 * 60 * 60 * 1000;
// no 'update': those point at the original's installer, and this edition updates from its own releases
const TYPES = ['plugin', 'news'];
// nova://plugins/<id>, nova://settings/<page>, or Nova's own pages on the web
const LINK = /^(nova:\/\/(plugins|settings)\/[\w-]+|https:\/\/(github\.com\/NOVA-TECH-KIT\/[\w./#?=&-]*|ko-fi\.com\/binamer|ipn\.eg\/S\/binamerbm\/[\w/]+))$/;

let send = () => {};
let enabled = false;
let timer = null;
let items = []; // valid items from the last read
// shown: ids already on screen once; dismissed: closed with ✕; read: seen in the bell's list or
// opened; lastShown: the one-a-day limit
let seen = { shown: [], dismissed: [], read: [], lastShown: 0, ...settings.load('news-seen.json', {}) };
let failedOnce = '';

const save = () => settings.save('news-seen.json', seen);

function newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function valid(item) {
  if (!item || typeof item !== 'object') return false;
  const { sig, ...body } = item;
  if (!signing.verify(body, sig)) return false;
  if (typeof body.id !== 'string' || !/^[\w-]{1,60}$/.test(body.id)) return false;
  if (!TYPES.includes(body.type) || typeof body.title !== 'string' || !body.title) return false;
  if (body.link && !LINK.test(body.link)) return false;
  const v = app.getVersion();
  if (body.minVersion && newer(body.minVersion, v)) return false;
  if (body.maxVersion && newer(v, body.maxVersion)) return false;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (body.start && today < body.start) return false;
  if (body.end && today > body.end) return false;
  return true;
}

const card = (i) => ({
  id: i.id, type: i.type, title: i.title.slice(0, 120), body: String(i.body || '').slice(0, 240), link: i.link || '',
  unread: !seen.read.includes(i.id),
});

// tell the island: the bell's list (shown, not closed) and at most one new item a day
function publish() {
  const cards = items.filter((i) => seen.shown.includes(i.id) && !seen.dismissed.includes(i.id)).map(card);
  const next = Date.now() - seen.lastShown >= DAY_MS ? items.find((i) => !seen.shown.includes(i.id)) : null;
  send('news', { cards, next: next ? card(next) : null });
}

async function read() {
  if (!enabled) return;
  try {
    const r = await fetch(URL, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const list = await r.json();
    const all = Array.isArray(list) ? list : [];
    items = all.filter(valid);
    if (all.length > items.length) log.info(`[news] ${all.length - items.length} item(s) skipped (not signed or not for this version)`);
    failedOnce = '';
    publish();
  } catch (err) {
    // one line per kind of failure, none while offline
    const msg = String(err.message || err);
    if (!/fetch failed|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|aborted|timeout/i.test(msg) && msg !== failedOnce) {
      failedOnce = msg;
      log.info(`[news] can't read news.json: ${msg}`);
    }
  }
}

function setEnabled(on) {
  enabled = !!on;
  clearTimeout(timer);
  clearInterval(timer);
  if (!enabled) {
    items = [];
    send('news', { cards: [], next: null });
    return;
  }
  timer = setTimeout(() => {
    read();
    timer = setInterval(read, EVERY_MS);
  }, FIRST_MS);
}

function start(sendFn, on) {
  send = sendFn;
  setEnabled(on);
}

// the island showed it (once the island was free), or the user closed its card
function shown(id) {
  if (!items.some((i) => i.id === id) || seen.shown.includes(id)) return;
  seen.shown = [...seen.shown, id].slice(-200);
  seen.lastShown = Date.now();
  save();
  publish();
}
function dismiss(id) {
  if (!items.some((i) => i.id === id) || seen.dismissed.includes(id)) return;
  seen.dismissed = [...seen.dismissed, id].slice(-200);
  save();
  publish();
}
// the bell's list was opened, or an item's link
function markRead(ids) {
  const add = ids.filter((id) => items.some((i) => i.id === id) && !seen.read.includes(id));
  if (!add.length) return;
  seen.read = [...seen.read, ...add].slice(-200);
  save();
  publish();
}
// the link of an item main itself read and checked, never one from the page
function linkOf(id) {
  return items.find((i) => i.id === id)?.link || '';
}

module.exports = { start, setEnabled, retrySoon: () => enabled && read(), shown, dismiss, markRead, linkOf };
