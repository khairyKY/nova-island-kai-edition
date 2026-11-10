// Plugins: extra features a user adds only when they want them. The list comes from the Nova
// plugin catalog on GitHub (NOVA-TECH-KIT/nova-island-plugins), its install counts from the release
// downloads there (no tracking of anyone). A plugin is one signed file (.nvp); a changed or
// foreign file is refused, from the catalog or from a file on disk alike.
// Plugins hold content only. The island implements each supported kind.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const settings = require('./settings');
const signing = require('./signing');
const log = require('./log');

const CATALOG_URL = 'https://raw.githubusercontent.com/NOVA-TECH-KIT/nova-island-plugins/main/plugins.json';
const RELEASES_URL = 'https://api.github.com/repos/NOVA-TECH-KIT/nova-island-plugins/releases?per_page=100';
const ASSET_URL = /^https:\/\/github\.com\/NOVA-TECH-KIT\/nova-island-plugins\/releases\/download\/[\w.-]+\/[\w.-]+\.nvp$/;
const CATALOG_MS = 6 * 60 * 60 * 1000;
const MAX_BYTES = 2 * 1024 * 1024;
const ID = /^[a-z0-9-]{2,40}$/;
const KAI_PLUGIN_ID = 'kais-flow';
const KAI_KIND = 'kai-flow';
const KAI_KEY = crypto.createPublicKey(fs.readFileSync(path.join(__dirname, 'kai-plugin-public.pem')));
// the hosts a radio plugin may stream from (the island's page allows exactly these, too)
const RADIO_URL = /^https:\/\/([\w-]+\.radiojar\.com|([\w-]+\.)?qurango\.net)\/[\w./?=&-]+$/;

const dir = () => path.join(app.getPath('userData'), 'plugins');
let state = settings.load('plugins.json', {}); // id -> { enabled, settings }
let cache = settings.load('plugins-cache.json', { catalog: [], counts: {}, at: 0 });

let installed = {}; // id -> manifest
let catalogError = '';
let busy = new Set();
let send = () => {};

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ---------- checking a plugin ----------
function checkRadio(m) {
  if (!Array.isArray(m.stations) || !m.stations.length || m.stations.length > 500) return null;
  const stations = [];
  for (const s of m.stations) {
    const name = text(s?.name, 80);
    if (!name || !ID.test(s.id || '') || !RADIO_URL.test(s.url || '')) return null;
    stations.push({ id: s.id, name, url: s.url, group: text(s.group, 40) });
  }
  return { stations };
}
const KINDS = { radio: checkRadio, [KAI_KIND]: () => ({}) };

function checkSettings(list) {
  const out = [];
  for (const s of Array.isArray(list) ? list.slice(0, 12) : []) {
    if (!/^[a-zA-Z]{1,30}$/.test(s?.key || '') || !['bool', 'station', 'range'].includes(s.type)) continue;
    const item = { key: s.key, type: s.type, label: text(s.label, 60), hint: text(s.hint, 120), default: s.default };
    if (s.type === 'range') Object.assign(item, { min: Number(s.min) || 0, max: Number(s.max) || 100, step: Number(s.step) || 10 });
    out.push(item);
  }
  return out;
}

// a bundle is { manifest, sig }; returns the clean manifest, or null
function checkBundle(bundle) {
  const m = bundle?.manifest;
  if (!m || !ID.test(m.id || '') || !/^\d+\.\d+\.\d+$/.test(m.version || '') || !Object.hasOwn(KINDS, m.kind)) return null;
  // The local key can authorize only the Kai plugin. The catalog and all other kinds use Nova's key.
  const kai = m.kind === KAI_KIND;
  if (kai !== (m.id === KAI_PLUGIN_ID) || !signing.verify(m, bundle.sig, kai ? KAI_KEY : undefined)) return null;
  const content = KINDS[m.kind](m);
  if (!content) return null;
  return {
    id: m.id, kind: m.kind, version: m.version, name: text(m.name, 40), description: text(m.description, 160),
    settings: checkSettings(m.settings), ...content,
  };
}

function loadInstalled() {
  installed = {};
  let names = [];
  try { names = fs.readdirSync(dir()).filter((n) => n.endsWith('.nvp')); } catch {}
  for (const n of names) {
    try {
      const m = checkBundle(JSON.parse(fs.readFileSync(path.join(dir(), n), 'utf8')));
      if (m && `${m.id}.nvp` === n) installed[m.id] = m;
      else log.info(`[plugins] ${n} failed its check, not loaded`);
    } catch {}
  }
}

// ---------- what the windows see ----------
function values(m) {
  const saved = state[m.id]?.settings || {};
  const out = {};
  for (const s of m.settings) out[s.key] = s.key in saved ? saved[s.key] : s.default;
  return out;
}

// for the island: installed and switched on
function active() {
  return Object.values(installed)
    .filter((m) => state[m.id]?.enabled !== false)
    .map((m) => ({ id: m.id, kind: m.kind, name: m.name, stations: m.stations, values: values(m) }));
}

const newer = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
};

// for Settings > Plugins: the catalog and whatever is installed (also from a file)
function list() {
  const rows = new Map();
  for (const c of cache.catalog) rows.set(c.id, { ...c, installs: cache.counts[c.id] ?? null });
  for (const m of Object.values(installed)) {
    const c = rows.get(m.id);
    rows.set(m.id, {
      ...(c || { id: m.id, name: m.name, description: m.description, version: m.version, size: 0, installs: null }),
      installed: m.version,
      update: !!c && newer(c.version, m.version),
      enabled: state[m.id]?.enabled !== false,
      settings: m.settings,
      values: values(m),
      stations: m.stations?.map((s) => ({ id: s.id, name: s.name, group: s.group })),
    });
  }
  return { plugins: [...rows.values()].map((r) => ({ ...r, busy: busy.has(r.id) })), error: catalogError };
}

function changed() {
  send('plugins', active());
  send('plugins-list', list());
}

// ---------- the catalog ----------
function cleanCatalog(list) {
  return (Array.isArray(list) ? list : [])
    .filter((p) => ID.test(p?.id || '') && p.id !== KAI_PLUGIN_ID && ASSET_URL.test(p.url || '') && /^\d+\.\d+\.\d+$/.test(p.version || '') && p.price === 'free')
    .map((p) => ({
      id: p.id, name: text(p.name, 40), description: text(p.description, 160), version: p.version,
      size: Number(p.size) || 0, price: 'free', url: p.url, sha256: /^[a-f0-9]{64}$/.test(p.sha256 || '') ? p.sha256 : '',
    }));
}

async function fetchJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function refresh(force = false) {
  if (!force && Date.now() - cache.at < CATALOG_MS) return;
  try {
    const cat = await fetchJson(CATALOG_URL);
    if (!signing.verify({ plugins: cat.plugins }, cat.sig)) throw new Error('catalog signature');
    const catalog = cleanCatalog(cat.plugins);
    const counts = {};
    try {
      for (const rel of await fetchJson(RELEASES_URL)) {
        for (const a of rel.assets || []) {
          const id = catalog.find((p) => a.name.startsWith(`${p.id}-`) && a.name.endsWith('.nvp'))?.id;
          if (id) counts[id] = (counts[id] || 0) + (a.download_count || 0);
        }
      }
    } catch {}
    cache = { catalog, counts, at: Date.now() };
    settings.save('plugins-cache.json', cache);
    catalogError = '';
  } catch (err) {
    const msg = String(err.message || err);
    if (catalogError !== msg) log.info(`[plugins] can't read the catalog: ${msg}`);
    catalogError = /HTTP|signature/.test(msg) ? msg : 'offline';
  }
  changed();
}

// ---------- install / remove ----------
function save(manifestBundle, m) {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), `${m.id}.nvp`), JSON.stringify(manifestBundle));
  state[m.id] = { enabled: true, settings: state[m.id]?.settings || {} };
  settings.save('plugins.json', state);
  installed[m.id] = m;
  log.info(`[plugins] ${m.id} ${m.version} installed`);
}

const progress = (id, data) => send('plugin-progress', { id, ...data });

async function install(id) {
  const entry = cache.catalog.find((p) => p.id === id);
  if (!entry || busy.has(id)) return false;
  busy.add(id);
  progress(id, { pct: 0, name: entry.name });
  changed();
  try {
    const r = await fetch(entry.url, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const total = Number(r.headers.get('content-length')) || entry.size || 0;
    const chunks = [];
    let got = 0;
    for await (const chunk of r.body) {
      got += chunk.length;
      if (got > MAX_BYTES) throw new Error('too big');
      chunks.push(Buffer.from(chunk));
      if (total) progress(id, { pct: Math.min(0.99, got / total), name: entry.name });
    }
    const buf = Buffer.concat(chunks);
    if (entry.sha256 && crypto.createHash('sha256').update(buf).digest('hex') !== entry.sha256) throw new Error('checksum');
    const bundle = JSON.parse(buf.toString('utf8'));
    const m = checkBundle(bundle);
    if (!m || m.id !== id) throw new Error('signature');
    save(bundle, m);
    progress(id, { pct: 1, done: true, name: m.name });
    return true;
  } catch (err) {
    log.info(`[plugins] ${id} install failed: ${err.message}`);
    progress(id, { error: true, name: entry.name });
    return false;
  } finally {
    busy.delete(id);
    changed();
  }
}

// a .nvp file the user picked (offline, or a plugin not in the catalog yet)
function installFile(file) {
  try {
    if (fs.statSync(file).size > MAX_BYTES) return { ok: false, error: 'This file is too big for a plugin' };
    const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
    const m = checkBundle(bundle);
    if (!m) return { ok: false, error: 'This plugin’s signature is not trusted by this Nova Island build' };
    save(bundle, m);
    progress(m.id, { pct: 1, done: true, name: m.name });
    changed();
    return { ok: true };
  } catch {
    return { ok: false, error: "This isn't a Nova Island plugin file" };
  }
}

function remove(id) {
  if (!installed[id]) return;
  try { fs.rmSync(path.join(dir(), `${id}.nvp`), { force: true }); } catch {}
  delete installed[id];
  delete state[id];
  settings.save('plugins.json', state);
  log.info(`[plugins] ${id} removed`);
  changed();
}

function setEnabled(id, on) {
  if (!installed[id]) return;
  state[id] = { ...state[id], enabled: !!on };
  settings.save('plugins.json', state);
  changed();
}

// a setting from Settings or the island, checked against the plugin's own list
function setSetting(id, key, value) {
  const m = installed[id];
  const s = m?.settings.find((x) => x.key === key);
  if (!s) return;
  let v;
  if (s.type === 'bool') v = !!value;
  else if (s.type === 'station') v = m.stations.some((st) => st.id === value) ? value : undefined;
  else if (s.type === 'range' && Number.isFinite(value)) v = Math.min(Math.max(Math.round(value), s.min), s.max);
  if (v === undefined) return;
  state[id] = { enabled: state[id]?.enabled !== false, settings: { ...state[id]?.settings, [key]: v } };
  settings.save('plugins.json', state);
  changed();
}

// the list that ships with the app (signed like the online one), so Settings > Plugins shows the
// plugins right away, even offline or before the first read of the online list
function builtin() {
  try {
    const cat = require('./plugins-catalog.json');
    return signing.verify({ plugins: cat.plugins }, cat.sig) ? cleanCatalog(cat.plugins) : [];
  } catch {
    return [];
  }
}

function installBundledKai() {
  if (!app.isPackaged || settings.load('kai-bundle-installed.json', false)) return;
  const filename = `${KAI_PLUGIN_ID}.nvp`;
  const bundled = path.join(process.resourcesPath, 'bundled-plugins', filename);
  if (!fs.existsSync(bundled)) return;
  // Existing plugin choices are kept. Mark the bundle as handled so uninstalling it sticks.
  if (fs.existsSync(path.join(dir(), filename)) || installFile(bundled).ok) {
    settings.save('kai-bundle-installed.json', true);
  }
}

function start(sendFn) {
  send = sendFn;
  if (!cache.catalog.length) cache.catalog = builtin();
  loadInstalled();
  installBundledKai();
  send('plugins', active());
}

module.exports = { KAI_PLUGIN_ID, start, active, list, refresh, install, installFile, remove, setEnabled, setSetting };
