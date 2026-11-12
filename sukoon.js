// Sukoon (Kai's glucose app for the Libre 2): the island follows the readings the way Sukoon's own
// follow page does. The phone writes each reading to Sukoon's Supabase project; signed in here, the
// island reads its own (or a followed person's) readings once a minute, works out the state with the
// app's own lines (urgent < 55, low < 70, high > 180, no reading for 10 min = no signal, and where
// the last 15 minutes point in 20 more), and tells the island the state and when it changes.
// Only Supabase's refresh token is kept (encrypted with Windows' own store), never the password.

// Sukoon's project and its publishable key: public by design, row-level security decides who can
// read what (the same as web/config.js in the Sukoon repo)
const URL_BASE = 'https://xfanobficweqlhklsllg.supabase.co';
const KEY = 'sb_publishable_XyER7uPkJ6un8VmAzgqNIg_2p6cjmDw';
const POLL_MS = 60 * 1000;
const FRESH_MIN = 10;

function createSukoon({ store, encrypt, decrypt, onChange = () => {}, onEvent = () => {}, log = () => {}, request = globalThis.fetch }) {
  let session = null; // { access, refresh, expires, user, email }
  let people = [];    // [{ id, name, self }]
  let chosen = null;  // the person whose glucose the island shows
  let snapshot = null, error = '', timer = null, lastKind = null, lastHeading = false;
  try {
    const saved = store.load('sukoon.json', {});
    if (saved.secret) session = JSON.parse(decrypt(Buffer.from(saved.secret, 'base64')));
    chosen = saved.chosen || null;
  } catch { session = null; }

  function persist() {
    store.save('sukoon.json', { secret: session ? encrypt(JSON.stringify(session)).toString('base64') : '', chosen });
  }
  async function call(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { apikey: KEY, 'Content-Type': 'application/json' };
    if (auth && session) headers.Authorization = `Bearer ${session.access}`;
    const res = await request(URL_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(json.msg || json.error_description || json.message || `HTTP ${res.status}`); e.status = res.status; throw e; }
    return json;
  }
  function keep(json, email) {
    session = { access: json.access_token, refresh: json.refresh_token, expires: Date.now() + (json.expires_in || 3600) * 1000, user: json.user?.id || session?.user, email: email || json.user?.email || session?.email };
    persist();
  }
  async function fresh() {
    if (session && Date.now() > session.expires - 120000) {
      keep(await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh }, auth: false }));
    }
  }

  async function loadPeople() {
    const me = { id: session.user, name: 'Me', self: true };
    try {
      const mine = await call(`/rest/v1/profiles?id=eq.${session.user}&select=display_name`);
      if (mine[0]?.display_name) me.name = mine[0].display_name;
    } catch {}
    let others = [];
    try {
      const follows = await call(`/rest/v1/follows?follower=eq.${session.user}&select=owner`);
      const ids = follows.map((f) => f.owner);
      if (ids.length) {
        const names = await call(`/rest/v1/profiles?id=in.(${ids.join(',')})&select=id,display_name`);
        others = ids.map((id) => ({ id, name: names.find((n) => n.id === id)?.display_name || '…', self: false }));
      }
    } catch {}
    people = [me, ...others];
    if (!people.some((p) => p.id === chosen)) chosen = me.id;
  }
  async function loadReadings(id) {
    const since = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    const rows = await call(`/rest/v1/readings?user_id=eq.${id}&ts=gte.${encodeURIComponent(since)}&order=ts.asc&select=ts,mg_dl,trend`);
    if (rows.length) return rows.map((r) => ({ at: Date.parse(r.ts), v: r.mg_dl, trend: r.trend }));
    const last = await call(`/rest/v1/readings?user_id=eq.${id}&order=ts.desc&limit=1&select=ts,mg_dl,trend`);
    return last.map((r) => ({ at: Date.parse(r.ts), v: r.mg_dl, trend: r.trend }));
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

  function emit() {
    onChange(status());
  }
  function status() {
    return { connected: !!session, email: session?.email || '', people, chosen, error, glucose: snapshot };
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
      if (s.kind === 'urgent') onEvent({ type: 'urgent', ...s });
      else if (s.kind === 'low') onEvent({ type: 'low', ...s });
      else if (s.kind === 'high') onEvent({ type: 'high', ...s });
      else if (s.kind === 'gone') onEvent({ type: 'gone', ...s });
      else if (s.kind === 'ok' && ['low', 'urgent', 'high'].includes(was)) onEvent({ type: 'inrange', from: was, ...s });
    } else if (s.kind === 'urgent') onEvent({ type: 'urgent', repeat: true, ...s }); // urgent keeps saying so, every reading
    if (heading && !wasHeading) onEvent({ type: 'heading', ...s });
  }

  async function poll() {
    clearTimeout(timer);
    timer = setTimeout(poll, POLL_MS);
    if (!session) return;
    try {
      await fresh();
      if (!people.length) await loadPeople();
      const readings = await loadReadings(chosen);
      const person = people.find((p) => p.id === chosen);
      snapshot = { ...read(readings), name: person?.name || '', self: !!person?.self, at: Date.now() };
      error = '';
      events(snapshot);
    } catch (err) {
      if (err.status === 401 || err.status === 400) { log(`sukoon: signed out (${err.message})`); session = null; persist(); error = 'Signed out. Sign in again.'; snapshot = null; }
      else error = /fetch|network|timeout|abort/i.test(err.message) ? 'Offline' : err.message;
    }
    emit();
  }

  return {
    status,
    start() { if (session) poll(); },
    stop() { clearTimeout(timer); },
    refresh: poll,
    async signIn(email, password) {
      try {
        keep(await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false }), email);
        error = ''; people = []; lastKind = null;
        await loadPeople();
        persist();
        await poll();
        return { ok: true };
      } catch (err) {
        error = err.status ? (/confirm/i.test(err.message) ? 'Confirm your email first.' : 'That email and password don’t match a Sukoon account.') : 'Offline';
        emit();
        return { ok: false, error };
      }
    },
    signOut() { session = null; people = []; snapshot = null; lastKind = null; error = ''; persist(); emit(); },
    async choose(id) { if (people.some((p) => p.id === id)) { chosen = id; lastKind = null; persist(); await poll(); } },
    read, // (for the self-check)
  };
}

module.exports = { createSukoon };

if (require.main === module) {
  // self-check of the state lines, with made-up readings
  const s = createSukoon({ store: { load: () => ({}), save() {} }, encrypt: (x) => Buffer.from(x), decrypt: (b) => b.toString() });
  const now = Date.now(), at = (m) => now - m * 60000;
  const series = (vals) => vals.map(([m, v, t = 0]) => ({ at: at(m), v, trend: t }));
  const k = (vals) => s.read(series(vals), now);
  console.assert(k([[1, 120]]).kind === 'ok', 'in range');
  console.assert(k([[1, 64, -1]]).kind === 'low', 'low');
  console.assert(k([[1, 52, -2]]).kind === 'urgent', 'urgent');
  console.assert(k([[1, 210, 1]]).kind === 'high', 'high');
  console.assert(k([[25, 120]]).kind === 'gone', 'no signal');
  const falling = k([[15, 130], [10, 115], [5, 100], [0, 88]]);
  console.assert(falling.kind === 'ok' && falling.headingIn > 0, 'heading low ' + JSON.stringify(falling));
  console.log('sukoon ok', falling.headingIn, 'min to 70');
}
