// Upcoming meetings from a private iCal link (Google Calendar, Outlook.com, iCloud: "secret
// address in iCal format"). No sign-in: the link itself is the key, so it is stored only in
// calendar.json in the app's data folder and never logged.
// ponytail: loaded on the first fetch, so it costs nothing unless a calendar is linked (~5 MB)
const settings = require('./settings');

const REFRESH_MS = 10 * 60 * 1000;
const RETRY_MS = 2 * 60 * 1000;
const AHEAD_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 12;
// meeting links worth a Join button
const JOIN = /https:\/\/(?:meet\.google\.com\/[a-z0-9-]+|teams\.(?:microsoft|live)\.com\/[^\s"'<>]+|(?:[\w-]+\.)?zoom\.us\/(?:j|my|w)\/[^\s"'<>]+|[\w-]+\.webex\.com\/[^\s"'<>]+)/i;

let send = () => {};
let cfg = settings.load('calendar.json', { url: '' });
let state = { events: [], error: '', updated: 0 };
let timer = null;

const normalize = (url) => String(url || '').trim().replace(/^webcal:\/\//i, 'https://');
const validUrl = (url) => /^https:\/\/[^\s]+$/i.test(url);

function joinLink(ev) {
  const fields = [ev.location, ev.url?.val || ev.url, ev.description, ev['GOOGLE-CONFERENCE'], ev['X-GOOGLE-CONFERENCE']];
  for (const f of fields) {
    const m = typeof f === 'string' && f.match(JOIN);
    if (m) return m[0].replace(/[).,;]+$/, '');
  }
  return '';
}

const text = (v) => (typeof v === 'string' ? v : v?.val || '').trim();

// one entry per occurrence in [from, to): recurring series expanded, moved / cancelled ones honoured
function occurrences(data, from, to) {
  const out = [];
  for (const ev of Object.values(data)) {
    if (ev.type !== 'VEVENT' || !ev.start || ev.status === 'CANCELLED') continue;
    const dur = (ev.end ? +ev.end : +ev.start) - +ev.start;
    const allDay = ev.datetype === 'date';
    const push = (start, src) => {
      const end = new Date(+start + dur);
      if (end <= from || start >= to || allDay) return;
      out.push({ id: `${ev.uid}|${+start}`, title: text(src.summary) || '(No title)', start: +start, end: +end, link: joinLink(src) });
    };
    if (ev.rrule) {
      const exdates = new Set(Object.values(ev.exdate || {}).map((d) => +d));
      for (const start of ev.rrule.between(new Date(+from - dur), to, true)) {
        const key = start.toISOString().slice(0, 10);
        const moved = ev.recurrences?.[key];
        if (moved) {
          if (moved.status !== 'CANCELLED') push(moved.start, moved);
        } else if (!exdates.has(+start)) {
          push(start, ev);
        }
      }
    } else {
      push(ev.start, ev);
    }
  }
  return out.sort((a, b) => a.start - b.start).slice(0, MAX_EVENTS);
}

async function refresh() {
  clearTimeout(timer);
  const url = normalize(cfg.url);
  if (!url) {
    state = { events: [], error: '', updated: 0 };
    send('calendar', state);
    return;
  }
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { accept: 'text/calendar' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = await r.text();
    if (!body.includes('BEGIN:VCALENDAR')) throw new Error('not an iCal file');
    const now = new Date();
    state = { events: occurrences(require('node-ical').sync.parseICS(body), now, new Date(+now + AHEAD_MS)), error: '', updated: Date.now() };
    timer = setTimeout(refresh, REFRESH_MS);
  } catch (err) {
    state = { ...state, error: err.name === 'TimeoutError' ? 'timeout' : err.message.slice(0, 120) };
    timer = setTimeout(refresh, RETRY_MS);
  }
  send('calendar', state);
}

function setUrl(url) {
  const clean = normalize(url);
  if (clean && !validUrl(clean)) return { ok: false };
  cfg = { url: clean };
  settings.save('calendar.json', cfg);
  refresh();
  return { ok: true };
}

const isJoinLink = (url) => typeof url === 'string' && JOIN.test(url) && url.match(JOIN)[0] === url;

function start(sender) {
  send = sender;
  refresh();
}

module.exports = {
  start, refresh, setUrl, occurrences, isJoinLink,
  snapshot: () => state,
  hasUrl: () => !!cfg.url,
};
