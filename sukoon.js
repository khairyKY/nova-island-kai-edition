// Sukoon (Kai's glucose app for the Libre 2): the island follows the readings through Sukoon's Widget
// link, the same read-only Nightscout feed the Rainmeter glass widget uses: no password, only the
// link's token (kept encrypted by Windows). Once a minute it reads the last three hours, works out the
// state with Sukoon's own lines (urgent < 55, low < 70, high > 180, no reading for 10 min = no signal,
// and where the last 15 minutes point in 20 more), and tells the island the state and when it changes.
const fs = require('fs');
const path = require('path');
const os = require('os');

const FEED = 'https://xfanobficweqlhklsllg.supabase.co/functions/v1/nightscout';
const POLL_MS = 60 * 1000;
const FRESH_MIN = 10;
// Nightscout directions -> Sukoon's trend -2..2
const TREND = { DoubleUp: 2, SingleUp: 2, FortyFiveUp: 1, Flat: 0, FortyFiveDown: -1, SingleDown: -2, DoubleDown: -2 };

// a pasted full link works too: keep only the token
const tokenOf = (s) => (String(s || '').match(/token=([0-9a-f]{32,})/i) || String(s || '').trim().match(/^([0-9a-f]{32,})$/i) || [])[1] || '';

// the Rainmeter widget's link, when it's set up on this PC: the island can start from it
function rainmeterToken() {
  const roots = [path.join(os.homedir(), 'OneDrive', 'Documents'), path.join(os.homedir(), 'Documents')];
  for (const r of roots) {
    try {
      const ini = fs.readFileSync(path.join(r, 'Rainmeter', 'Skins', 'Glass', 'Sukoon', 'Sukoon.ini'), 'utf8');
      const t = tokenOf((ini.match(/^\s*Token\s*=\s*(.+)$/m) || [])[1]);
      if (t) return t;
    } catch {}
  }
  return '';
}

function createSukoon({ store, encrypt, decrypt, onChange = () => {}, onEvent = () => {}, log = () => {}, request = globalThis.fetch }) {
  let token = '';
  let snapshot = null, error = '', timer = null, lastKind = null, lastHeading = false;
  try {
    const saved = store.load('sukoon.json', {});
    if (saved.secret) token = decrypt(Buffer.from(saved.secret, 'base64'));
  } catch { token = ''; }

  function persist() {
    store.save('sukoon.json', { secret: token ? encrypt(token).toString('base64') : '' });
  }
  async function loadReadings() {
    const res = await request(`${FEED}/api/v1/entries/sgv.json?count=200&token=${token}`, { signal: AbortSignal.timeout(15000) });
    const json = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(json)) { const e = new Error(json?.error || `HTTP ${res.status}`); e.status = res.status || 400; throw e; }
    const since = Date.now() - 3 * 3600 * 1000;
    const all = json.filter((r) => r.sgv && r.date).map((r) => ({ at: r.date, v: r.sgv, trend: TREND[r.direction] ?? null })).sort((a, b) => a.at - b.at);
    const recent = all.filter((r) => r.at >= since);
    return recent.length ? recent : all.slice(-1);
  }

  // what the readings say: the app's own lines, the same as Sukoon's follow page
  function read(readings, now = Date.now()) {
    const last = readings[readings.length - 1];
    if (!last) return { kind: 'none' };
    const minutes = Math.max(0, Math.round((now - last.at) / 60000));
    const isFresh = minutes <= FRESH_MIN;
    const v = last.v;
    const kind = !isFresh ? 'gone' : v < 55 ? 'urgent' : v < 70 ? 'low' : v > 180 ? 'high' : 'ok';
    let headingIn = null;
    if (isFresh && kind === 'ok') {
      const span15 = readings.filter((r) => last.at - r.at <= 15 * 60000);
      const first = span15[0];
      const span = (last.at - first.at) / 60000;
      if (span15.length >= 3 && span >= 5) {
        const projected = v + ((v - first.v) / span) * 20;
        if (projected < 70) headingIn = Math.max(1, Math.round(((v - 70) * 20) / (v - projected)));
      }
    }
    // the last three hours, thinned to at most 48 points, for the sparkline
    const step = Math.max(1, Math.ceil(readings.length / 48));
    const spark = readings.filter((_, i) => i % step === 0 || i === readings.length - 1).map((r) => [Math.round((r.at - now) / 60000), r.v]);
    return { kind, v, trend: last.trend, minutes, fresh: isFresh, headingIn, spark };
  }

  function status() {
    return { connected: !!token, error, glucose: snapshot };
  }
  // tell the island what changed: going low, urgent, heading low, high, back in range, no signal
  function events(s) {
    const was = lastKind;
    lastKind = s.kind;
    const heading = !!s.headingIn;
    const wasHeading = lastHeading;
    lastHeading = heading;
    if (was === null || s.kind === 'none') return; // the first look just shows the state, no alert
    if (s.kind !== was) {
      if (['urgent', 'low', 'high', 'gone'].includes(s.kind)) onEvent({ type: s.kind, ...s });
      else if (s.kind === 'ok' && ['low', 'urgent', 'high'].includes(was)) onEvent({ type: 'inrange', from: was, ...s });
    } else if (s.kind === 'urgent') onEvent({ type: 'urgent', repeat: true, ...s }); // urgent keeps saying so, every reading
    if (heading && !wasHeading) onEvent({ type: 'heading', ...s });
  }

  async function poll() {
    clearTimeout(timer);
    timer = setTimeout(poll, POLL_MS);
    if (!token) return;
    try {
      snapshot = { ...read(await loadReadings()), self: true, at: Date.now() };
      error = '';
      events(snapshot);
    } catch (err) {
      if (err.status === 401 || err.status === 403 || err.status === 404) { log(`sukoon: link refused (${err.message})`); error = 'Sukoon doesn’t accept this link any more. Paste a new one.'; snapshot = null; }
      else { log(`sukoon: ${err.message}`); error = 'Offline'; }
    }
    onChange(status());
  }

  return {
    status,
    start() {
      if (!token) { const t = rainmeterToken(); if (t) { token = t; persist(); log('sukoon: using the Rainmeter widget link'); } }
      if (token) poll();
    },
    stop() { clearTimeout(timer); },
    refresh: poll,
    async setLink(link) {
      const t = tokenOf(link);
      if (!t) return { ok: false, error: 'That isn’t a Sukoon Widget link.' };
      token = t; lastKind = null; error = ''; persist();
      await poll();
      return error && error !== 'Offline' ? { ok: false, error } : { ok: true };
    },
    signOut() { token = ''; snapshot = null; lastKind = null; error = ''; persist(); onChange(status()); },
    read, tokenOf, // (for the self-check)
  };
}

module.exports = { createSukoon };

if (require.main === module) {
  // self-check of the state lines and the link parsing, with made-up readings
  const s = createSukoon({ store: { load: () => ({}), save() {} }, encrypt: (x) => Buffer.from(x), decrypt: (b) => b.toString() });
  const now = Date.now(), at = (m) => now - m * 60000;
  const k = (vals) => s.read(vals.map(([m, v, t = 0]) => ({ at: at(m), v, trend: t })), now);
  console.assert(k([[1, 120]]).kind === 'ok', 'in range');
  console.assert(k([[1, 64, -1]]).kind === 'low', 'low');
  console.assert(k([[1, 52, -2]]).kind === 'urgent', 'urgent');
  console.assert(k([[1, 210, 1]]).kind === 'high', 'high');
  console.assert(k([[25, 120]]).kind === 'gone', 'no signal');
  const falling = k([[15, 130], [10, 115], [5, 100], [0, 88]]);
  console.assert(falling.kind === 'ok' && falling.headingIn > 0, 'heading low');
  const tok = 'ab'.repeat(32);
  console.assert(s.tokenOf(`${FEED}/api/v1/entries.json?token=${tok}`) === tok && s.tokenOf(` ${tok} `) === tok && !s.tokenOf('nope'), 'link');
  console.log('sukoon ok', falling.headingIn, 'min to 70; rainmeter token', rainmeterToken() ? 'found' : 'none');
}
