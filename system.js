// System status: CPU / RAM, clipboard history (memory only), weather.
const os = require('os');
const { clipboard } = require('electron');
const features = require('./features');
const settings = require('./settings');
const smartclip = require('./smartclip');

let send = () => {};

// ---- CPU / RAM ----
function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const k of Object.keys(c.times)) total += c.times[k];
    idle += c.times.idle;
  }
  return { idle, total };
}
let lastCpu = cpuTimes();
function tickStats() {
  const now = cpuTimes();
  const dTotal = now.total - lastCpu.total;
  const cpu = dTotal > 0 ? 1 - (now.idle - lastCpu.idle) / dTotal : 0;
  lastCpu = now;
  const total = os.totalmem();
  const used = total - os.freemem();
  send('stats', { cpu, ram: used / total, ramUsed: used, ramTotal: total });
}

// ---- clipboard (kept in memory only; may contain sensitive text) ----
// Read only when Windows reports a new copy (the helper's clipboard sequence). The helper also
// says whether a password manager marked the copy as private; those are never read.
// Pinned clips (1.8.6) come first, are kept when the history is trimmed or cleared, and are the
// only ones saved to disk: the user chose to keep them.
const MAX_CLIPS = 8; // unpinned
const MAX_PINS = 20;
const PIN_FILE = 'clip-pins.json';
let clips = features.get().clipboardHistory
  ? [].concat(settings.load(PIN_FILE, [])).filter((t) => typeof t === 'string' && t).slice(0, MAX_PINS).map((text) => ({ text, pinned: true }))
  : [];
const savePins = () => settings.save(PIN_FILE, clips.filter((c) => c.pinned).map((c) => c.text));
// what the island gets: 300 characters a clip; the full view asks for the rest (clipFull)
const clipView = () => clips.map(({ text, pinned }) => ({ text: text.slice(0, 300), pinned, long: text.length >= 300 || text.includes('\n'), chars: text.length }));
const announce = () => send('clipboard', clipView());
// a copy goes first among the unpinned; a pinned one stays where it is
function remember(text) {
  if (clips.some((c) => c.pinned && c.text === text)) return;
  const pins = clips.filter((c) => c.pinned);
  const rest = clips.filter((c) => !c.pinned && c.text !== text);
  clips = [...pins, { text, pinned: false }, ...rest].slice(0, pins.length + MAX_CLIPS);
}
let lastClip = '';
clipboard.readText().then((t) => { lastClip = t || ''; }).catch(() => {});
async function clipboardChanged(isPrivate) {
  if (isPrivate) return;
  let text = '';
  try { text = await clipboard.readText(); } catch { return; }
  if (typeof text !== 'string' || !text || text === lastClip) return;
  lastClip = text;
  if (!text.trim()) return;
  if (features.get().smartClipboard) {
    smart = smartclip.classify(text);
    if (smart) send('clip-smart', smart);
  }
  if (!features.get().clipboardHistory) return;
  remember(text);
  announce();
}
let smart = null; // what the last copy was recognised as (acted on by nova.js)
const lastSmart = () => smart;
// writing to the clipboard ourselves must not be announced again
function writeQuiet(text) {
  lastClip = text;
  clipboard.writeText(text).catch(() => {});
}

function copyClip(i) {
  const text = clips[i]?.text;
  if (typeof text !== 'string') return;
  lastClip = text;
  clipboard.writeText(text).catch(() => {});
  remember(text);
  announce();
}
// the whole text of a long clip, for the full view
const clipFull = (i) => clips[i]?.text ?? null;
// pinned: last among the pinned; unpinned: first among the rest
function pinClip(i, on) {
  const c = clips[i];
  if (!c || c.pinned === !!on) return;
  if (on && clips.filter((x) => x.pinned).length >= MAX_PINS) return;
  c.pinned = !!on;
  const others = clips.filter((x) => x !== c);
  const pins = others.filter((x) => x.pinned);
  const rest = others.filter((x) => !x.pinned);
  clips = on ? [...pins, c, ...rest] : [...pins, c, ...rest].slice(0, pins.length + MAX_CLIPS);
  savePins();
  announce();
}
// Clear keeps the pinned ones; all (history switched off) drops them too
function clearClips(all = false) {
  const hadPins = clips.some((c) => c.pinned);
  clips = all ? [] : clips.filter((c) => c.pinned);
  if (all && hadPins) savePins();
  announce();
}

// ---- weather (Open-Meteo, location from IP) ----
// The last weather and the last IP location are kept on disk, so a start without internet
// still shows them; a failing service is logged once, not on every retry.
const WEATHER_FRESH = 3 * 60 * 60 * 1000;
let weather = null;
{
  const saved = settings.load('weather-cache.json', null);
  if (saved && Date.now() - saved.at < WEATHER_FRESH) weather = saved.weather;
}

// JSON from a URL, or an error for a non-OK answer or a page that is not JSON
async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  try {
    return await r.json();
  } catch {
    throw new Error('not JSON');
  }
}

// IP geolocation with fallbacks (free services rate-limit often)
async function locate() {
  const services = [
    ['https://ipwho.is/', (j) => j.success !== false && { lat: j.latitude, lon: j.longitude, city: j.city, country: j.country_code, timezone: j.timezone?.id }],
    ['https://get.geojs.io/v1/ip/geo.json', (j) => ({ lat: Number(j.latitude), lon: Number(j.longitude), city: j.city, country: j.country_code, timezone: j.timezone })],
    ['https://ipapi.co/json/', (j) => ({ lat: j.latitude, lon: j.longitude, city: j.city, country: j.country_code, timezone: j.timezone })],
  ];
  for (const [url, pick] of services) {
    try {
      const loc = pick(await getJson(url));
      if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) return loc;
    } catch {}
  }
  throw new Error('no location');
}

// A city picked in Settings wins; otherwise the IP location, looked up again once a day
// (a laptop travels), falling back to the last one found. Shared with the prayer times.
const DAY = 24 * 60 * 60 * 1000;
let manual = settings.load('location.json', null);
let location = settings.load('location-cache.json', null);
let locatedAt = 0;
const changed = [];

// First start with no internet and no location saved yet: the capital of the PC's time zone, so
// prayer times show at once. Marked approximate, never saved; the real place replaces it as soon
// as a lookup works.
const CAPITALS = {
  'Africa/Cairo': ['Cairo', 30.0444, 31.2357, 'EG'], 'Asia/Riyadh': ['Riyadh', 24.7136, 46.6753, 'SA'],
  'Asia/Dubai': ['Dubai', 25.2048, 55.2708, 'AE'], 'Asia/Kuwait': ['Kuwait City', 29.3759, 47.9774, 'KW'],
  'Asia/Qatar': ['Doha', 25.2854, 51.531, 'QA'], 'Asia/Bahrain': ['Manama', 26.2285, 50.586, 'BH'],
  'Asia/Muscat': ['Muscat', 23.588, 58.3829, 'OM'], 'Asia/Amman': ['Amman', 31.9539, 35.9106, 'JO'],
  'Asia/Beirut': ['Beirut', 33.8938, 35.5018, 'LB'], 'Asia/Damascus': ['Damascus', 33.5138, 36.2765, 'SY'],
  'Asia/Baghdad': ['Baghdad', 33.3152, 44.3661, 'IQ'], 'Asia/Aden': ["Sana'a", 15.3694, 44.191, 'YE'],
  'Asia/Gaza': ['Gaza', 31.5017, 34.4668, 'PS'], 'Asia/Hebron': ['Hebron', 31.5326, 35.0998, 'PS'],
  'Africa/Casablanca': ['Rabat', 34.0209, -6.8416, 'MA'], 'Africa/Algiers': ['Algiers', 36.7538, 3.0588, 'DZ'],
  'Africa/Tunis': ['Tunis', 36.8065, 10.1815, 'TN'], 'Africa/Tripoli': ['Tripoli', 32.8872, 13.1913, 'LY'],
  'Africa/Khartoum': ['Khartoum', 15.5007, 32.5599, 'SD'], 'Europe/Istanbul': ['Istanbul', 41.0082, 28.9784, 'TR'],
  'Asia/Karachi': ['Karachi', 24.8607, 67.0011, 'PK'], 'Asia/Jakarta': ['Jakarta', -6.2088, 106.8456, 'ID'],
  'Asia/Kuala_Lumpur': ['Kuala Lumpur', 3.139, 101.6869, 'MY'], 'Europe/London': ['London', 51.5072, -0.1276, 'GB'],
  'Europe/Paris': ['Paris', 48.8566, 2.3522, 'FR'], 'America/New_York': ['New York', 40.7128, -74.006, 'US'],
};
function capitalOfZone() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const c = CAPITALS[zone];
  return c && { city: c[0], lat: c[1], lon: c[2], country: c[3], timezone: zone, approx: true };
}

async function getLocation() {
  if (manual) return { lat: manual.lat, lon: manual.lon, city: manual.name, country: manual.countryCode || '', timezone: manual.timezone };
  if (!location || location.approx || Date.now() - locatedAt > DAY) {
    try {
      location = await locate();
      locatedAt = Date.now();
      settings.save('location-cache.json', location);
    } catch (err) {
      if (!location) location = capitalOfZone();
      if (!location) throw err;
      locatedAt = Date.now() - DAY + 30 * 60 * 1000; // try again in 30 minutes
    }
  }
  return location;
}

// after sleep or a lost connection: weather (and a guessed or failed location) right away
function refreshNow() {
  if (location?.approx) locatedAt = 0;
  weatherFails = 0;
  fetchWeather();
}

function locationInfo() {
  return manual ? { mode: 'manual', ...manual } : { mode: 'auto', name: location?.city || '' };
}

// city search for Settings (Open-Meteo geocoding, no key)
async function searchCity(query) {
  const q = String(query || '').trim().slice(0, 80);
  if (q.length < 2) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=6&language=ar&format=json&name=${encodeURIComponent(q)}`;
  const j = await getJson(url);
  return (j.results || []).map((r) => ({
    name: r.name, country: r.country || '', countryCode: r.country_code || '', admin: r.admin1 || '', lat: r.latitude, lon: r.longitude, timezone: r.timezone || '',
  }));
}

// null = back to automatic
function setLocation(loc) {
  const ok = loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon) && typeof loc.name === 'string';
  manual = ok
    ? {
      name: loc.name.slice(0, 80), country: String(loc.country || '').slice(0, 80), countryCode: /^[A-Za-z]{2}$/.test(loc.countryCode) ? loc.countryCode.toUpperCase() : '',
      lat: loc.lat, lon: loc.lon, timezone: String(loc.timezone || '').slice(0, 60),
    }
    : null;
  settings.save('location.json', manual);
  location = null;
  fetchWeather();
  changed.forEach((fn) => fn(locationInfo()));
}
const onLocationChange = (fn) => changed.push(fn);

let weatherTimer = null;
let weatherFails = 0;
// after a failure: 2, 5, then every 15 minutes
const RETRY_MIN = [2, 5, 15];
async function fetchWeather() {
  clearTimeout(weatherTimer);
  try {
    const { lat, lon, city } = await getLocation();
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1';
    const w = await getJson(url);
    weather = {
      city: city || '',
      temp: Math.round(w.current.temperature_2m),
      code: w.current.weather_code,
      isDay: !!w.current.is_day,
      hi: Math.round(w.daily.temperature_2m_max[0]),
      lo: Math.round(w.daily.temperature_2m_min[0]),
    };
    settings.save('weather-cache.json', { at: Date.now(), weather });
    send('weather', weather);
    if (weatherFails) console.warn('[weather] back');
    weatherFails = 0;
    weatherTimer = setTimeout(fetchWeather, 20 * 60 * 1000);
  } catch (err) {
    if (!weatherFails) console.warn('[weather]', err.message, '(retrying quietly)');
    weatherTimer = setTimeout(fetchWeather, RETRY_MIN[Math.min(weatherFails, RETRY_MIN.length - 1)] * 60 * 1000);
    weatherFails++;
  }
}

function snapshot() {
  return { clips: clipView(), weather };
}

// CPU / RAM every 2 s, every 5 s with the performance options (or the battery saver) on
let statsTimer = null;
function setStatsEvery(ms) {
  clearInterval(statsTimer);
  statsTimer = setInterval(tickStats, ms);
}

function start(sender) {
  send = sender;
  setStatsEvery(2000);
  if (weather) send('weather', weather); // the saved one, until a fresh one arrives
  fetchWeather();
}

module.exports = { start, setStatsEvery, copyClip, clipFull, pinClip, clearClips, snapshot, getLocation, refreshNow, locationInfo, searchCity, setLocation, onLocationChange, lastSmart, writeQuiet, clipboardChanged };
