// App launcher: Start menu catalog (via `nova-helper apps`), pinned apps, icons, launching.
const path = require('path');
const { spawn } = require('child_process');
const { app, nativeImage } = require('electron');
const settings = require('./settings');

const DEFAULTS = [
  'WhatsApp', 'Telegram', 'Spotify', 'Google Chrome', 'Visual Studio Code', 'Discord',
  'Microsoft Edge', 'File Explorer', 'Calculator', 'Notepad', 'Photos', 'Settings',
];
const MAX_PINNED = 36; // pages of 6 x 2 on the island (1.8.6)

let catalog = settings.load('apps-cache.json', []);
let pinned = settings.load('apps.json', null);
const iconCache = new Map();
const sourceCache = new Map(); // media appId -> catalog entry (or null)
let onChange = () => {};

function scriptPath(name) {
  return path.join(__dirname, name).replace('app.asar', 'app.asar.unpacked');
}

function scanOnce() {
  return new Promise((resolve) => {
    const ps = spawn(scriptPath(path.join('helper', 'nova-helper.exe')), ['apps'], { windowsHide: true });
    let out = '';
    let errOut = '';
    ps.stdout.setEncoding('utf8');
    ps.stderr.setEncoding('utf8');
    ps.stdout.on('data', (d) => (out += d));
    ps.stderr.on('data', (d) => (errOut += d));
    ps.on('error', (err) => {
      console.error(`[apps] scan failed: ${err.message}`);
      resolve(false);
    });
    // 'close', not 'exit': it comes after the output is fully read, so the JSON is never cut short
    ps.on('close', (code) => {
      try {
        const list = JSON.parse(out.replace(/^﻿/, '').trim());
        const items = (Array.isArray(list) ? list : [list]).filter((a) => a && a.name && a.id);
        if (!items.length) throw new Error('empty list');
        catalog = items.sort((a, b) => a.name.localeCompare(b.name));
        iconCache.clear();
        sourceCache.clear();
        settings.save('apps-cache.json', catalog);
        resolve(true);
      } catch (err) {
        console.error(`[apps] scan failed (exit ${code}): ${err.message}`, errOut.trim().slice(0, 300));
        resolve(false);
      }
    });
  });
}

async function scan() {
  for (let i = 0; i < 3; i++) {
    if (await scanOnce()) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

function pickDefaults() {
  const out = [];
  for (const want of DEFAULTS) {
    const hit = catalog.find((a) => a.name.toLowerCase() === want.toLowerCase())
      || catalog.find((a) => a.name.toLowerCase().startsWith(want.toLowerCase()));
    if (hit && !out.includes(hit.id)) out.push(hit.id);
    if (out.length >= MAX_PINNED) break;
  }
  return out;
}

async function iconFor(entry) {
  if (!entry || (!entry.icon && !entry.image)) return '';
  if (iconCache.has(entry)) return iconCache.get(entry);
  let url = '';
  try {
    if (entry.image) {
      const img = nativeImage.createFromDataURL(entry.image);
      if (!img.isEmpty()) url = img.toDataURL();
    }
    if (!url && entry.kind === 'png') {
      const img = nativeImage.createFromPath(entry.icon);
      if (!img.isEmpty()) url = img.resize({ width: 64, height: 64, quality: 'best' }).toDataURL();
    } else if (!url && entry.icon) {
      const img = await app.getFileIcon(entry.icon, { size: 'large' });
      if (!img.isEmpty()) url = img.toDataURL();
    }
  } catch {}
  iconCache.set(entry, url); // failures too, so getFileIcon isn't retried every list()
  return url;
}

async function describe(id) {
  const entry = catalog.find((a) => a.id === id);
  if (!entry) return null;
  return { id, name: entry.name, icon: await iconFor(entry) };
}

async function list() {
  const items = await Promise.all((pinned || []).map(describe));
  return items.filter(Boolean);
}

async function all() {
  return Promise.all(catalog.map(async (a) => ({ id: a.id, name: a.name, icon: await iconFor(a) })));
}

function persist() {
  settings.save('apps.json', pinned);
  onChange();
}

function add(id) {
  if (!pinned) pinned = [];
  if (!catalog.some((a) => a.id === id) || pinned.includes(id) || pinned.length >= MAX_PINNED) return;
  pinned.push(id);
  persist();
}

function remove(id) {
  pinned = (pinned || []).filter((p) => p !== id);
  persist();
}

// New order from the renderer; must be the same set of ids.
function reorder(ids) {
  if (!Array.isArray(ids) || !pinned) return;
  const same = ids.length === pinned.length && ids.every((id) => pinned.includes(id));
  if (!same) return;
  pinned = [...ids];
  persist();
}

// A click brings the app's open window to the front (the helper looks for it), and only starts
// the app when none is open; a right-click (fresh) always starts a new one. The bridge in nova.js
// carries the helper's commands and answers.
let helperWrite = null;
const focusWaits = new Map(); // app id -> resolve
let runningWait = null;
const clean = (s) => String(s || '').replace(/[\t\r\n]/g, '');
const exeOf = (a) => (a.kind === 'file' && /\.exe$/i.test(a.icon) ? a.icon : '');

function setHelper(write) {
  helperWrite = write;
}

function onHelper(data) {
  if ('focusapp' in data) {
    const done = focusWaits.get(data.focusapp);
    focusWaits.delete(data.focusapp);
    done?.(data.result);
  } else if (Array.isArray(data.running) && runningWait) {
    const done = runningWait;
    runningWait = null;
    done(data.running);
  }
}

// one command to the helper; null when it doesn't answer in time
function ask(command, wait, ms) {
  return new Promise((resolve) => {
    if (!helperWrite) return resolve(null);
    const timer = setTimeout(() => resolve(null), ms);
    wait((v) => { clearTimeout(timer); resolve(v); });
    helperWrite(command);
  });
}

function start(id) {
  spawn('explorer.exe', [`shell:AppsFolder\\${id}`], { detached: true, stdio: 'ignore' }).unref();
}

async function launch(id, fresh = false) {
  const a = catalog.find((x) => x.id === id);
  if (!a) return;
  if (!fresh) {
    const key = clean(id);
    const result = await ask(`focusapp\t${key}\t${clean(exeOf(a))}`, (done) => focusWaits.set(key, done), 1500);
    if (result === 'focused') return;
  }
  start(id);
}

// pinned apps with a window open (the dot under their icon), asked when the Apps tab opens
async function running() {
  if (!pinned?.length || runningWait) return [];
  const pairs = pinned.map((id) => catalog.find((a) => a.id === id)).filter(Boolean)
    .map((a) => `${clean(a.id)}\t${clean(exeOf(a))}`);
  const timeout = setTimeout(() => (runningWait = null), 1600);
  const ids = await ask(`runningapps\t${pairs.join('\t')}`, (done) => (runningWait = done), 1500);
  clearTimeout(timeout);
  return ids || [];
}

async function init(changed) {
  onChange = changed;
  if (catalog.length && pinned) onChange();
  await scan();
  if (!pinned) pinned = pickDefaults();
  pinned = pinned.filter((id) => catalog.some((a) => a.id === id));
  persist();
}

function mediaSource(appId) {
  const id = String(appId || '').toLowerCase();
  if (!sourceCache.has(id)) sourceCache.set(id, catalog.find(a => a.id.toLowerCase() === id || (id.endsWith('.exe') && String(a.icon || '').toLowerCase().endsWith('\\' + id))) || null);
  const entry = sourceCache.get(id);
  const icon = entry && (entry.image || iconCache.get(entry));
  return icon ? {id:'app',name:entry.name,icon,vector:false} : null;
}
module.exports = { init, list, all, add, remove, reorder, launch, running, setHelper, onHelper, mediaSource, MAX_PINNED };
