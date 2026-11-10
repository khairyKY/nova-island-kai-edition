const {
  app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, globalShortcut, shell, dialog, powerMonitor, safeStorage,
} = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Kai Edition keeps its own data folder, so it never shares settings or the single-instance lock
// with the original Nova Island on the same PC. The first run copies the original's folder
// (settings, pinned apps, prayer place), minus caches and lock files. Must run before any module
// below reads app.getPath('userData').
{
  const own = path.join(app.getPath('appData'), 'nova-island-kai');
  const original = path.join(app.getPath('appData'), 'dynamic-nova');
  if (!fs.existsSync(own) && fs.existsSync(original)) {
    const SKIP = /^(Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|GrShaderCache|ShaderCache|blob_storage|Crashpad|Singleton.*|lockfile|LOCK|.*\.log)$/i;
    for (const name of fs.readdirSync(original)) {
      if (SKIP.test(name)) continue;
      try { fs.cpSync(path.join(original, name), path.join(own, name), { recursive: true, filter: (src) => !SKIP.test(path.basename(src)) }); } catch {}
    }
  }
  app.setPath('userData', own);
}
const log = require('./log');
log.init();

const settings = require('./settings');
const otherNova = require('./other-nova');
const apps = require('./apps');
const shelf = require('./shelf');
const system = require('./system');
const mini = require('./mini');
const prayer = require('./prayer');
const downloads = require('./downloads');
const features = require('./features');
const companionStates = require('./phoenix-states');
const privacy = require('./privacy');
const calendar = require('./calendar');
const network = require('./network');
const prefsWindow = require('./prefs-window');
const updater = require('./updater');
const news = require('./news');
const plugins = require('./plugins');
const { createBrowserBridge } = require('./browser-media');
const { resolve: resolveMediaSource } = require('./media-sources');
const { createSpotify } = require('./spotify');
const { stripBackdrop } = require('./backdrop');
const browserCompanion = require('./browser-companion-setup');
const { createNoticeBridge, appNotice } = require('./kai-notices');
const kaiNotices = createNoticeBridge(
  path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'KaiFlowIsland'),
  (notice) => { if (win && !win.isDestroyed() && !screenLocked) send('kai-notice', notice); },
  (err) => log.info(`[kai-notices] ${err.code || err.message}`)
);
// other apps' notices (tools/island-notify.cjs, run by Claude Code hooks)
const appNotices = createNoticeBridge(
  path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'NovaIslandNotices'),
  (notice) => { if (win && !win.isDestroyed() && !screenLocked) send('app-notice', notice); },
  (err) => log.info(`[app-notices] ${err.code || err.message}`),
  { prefix: 'nova-island-notices-', normalize: appNotice }
);

// Keep our own windows (the mini player) out of Windows' media sessions, so the island and
// the per-app commands keep targeting the browser tab rather than the mini player.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

const WIN_W = 640;
const WIN_H = 320;
const PANEL_W = 548; // expanded island, in renderer.js and style.css
const PANEL_H = 232;
// the cursor has to rest on the island this long before it opens, so passing over it (on the way to
// the browser's tabs or address bar) doesn't flash the panel open and shut
const HOVER_INTENT_MS = 250;
const CURSOR_POLL_NEAR_MS = 33;
const CURSOR_POLL_FAR_MS = 100; // can't reach the island and rest on it in between
const FAR_PX = 400;
const SWITCHER_HIDE_DELAY_MS = 240;

let win = null;
let tray = null;
let media = null;
let spotify = null;
let lastMedia = null;
let wantsAudioMeter = false;
let audioMeterOn = false;
function syncAudioMeter() {
  const on = !!(wantsAudioMeter && lastMedia?.playing && !screenLocked && win?.isVisible());
  if (on === audioMeterOn) return;
  audioMeterOn = on;
  mediaWrite(on ? 'meter on' : 'meter off');
}
ipcMain.on('audio-meter', (event, on) => {
  if (!win || event.sender !== win.webContents) return;
  wantsAudioMeter = on === true;
  syncAudioMeter();
});
const browserMedia = createBrowserBridge(path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'NovaIslandBrowser'),
  () => { if (lastMedia) publishMedia(lastMedia); }, err => log.info(`[browser-media] ${err.code || 'bridge unavailable'}`));
function publishMedia(data) {
  lastMedia = data;
  syncAudioMeter();
  const source = resolveMediaSource(data, browserMedia.snapshot());
  const enriched = {...data, source:source?.id === 'media' ? apps.mediaSource(data.app) || source : source};
  spotify?.observe(screenLocked ? null : enriched);
  send('media', enriched);
}
let quitting = false;
let userHidden = false;
let fullscreenHidden = false;
let switcherHidden = false;
let switcherHideTimer = null;
let windowReady = false;
let kaiPlugin = null;
let lastWindowState = { fs: false, suspended: false };
let prefs = Object.assign(
  { ax: null, ay: null, docked: false, vertical: false, side: 'right' },
  settings.load('settings.json', {})
);

// The island's position is an "anchor": the top-center of the collapsed pill, in screen
// coordinates. The window (always fully on screen) follows it, and the renderer places the
// island inside the window so it expands toward the free space near screen edges.
const PILL_HALF_W = 120;   // half of the widest collapsed pill (keep in sync with style.css)
const PILL_H = 34;
const FLOAT_TOP = 8;       // gap above a floating island inside the window
const SNAP_PX = 28;        // distance from the top edge that docks the island
const CENTER_SNAP_PX = 40; // horizontal magnet to the screen center while docked
// In vertical mode the anchor is the middle of the pill on the left or right screen edge.
const V_PILL_HALF_H = 124;

let anchor = null;
let lastLayout = '';
let placementTimer = null;
let activeScale = 1;

if (!app.requestSingleInstanceLock()) app.quit();

// Pages never open windows or navigate inside the app; web links go to the default browser.
function lockNavigation(contents, isOwnPage) {
  const external = (url) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
  };
  contents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => {
    if (isOwnPage(url)) return;
    e.preventDefault();
    external(url);
  });
}

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function defaultAnchor() {
  const { bounds } = screen.getPrimaryDisplay();
  return { x: bounds.x + bounds.width / 2, y: bounds.y + FLOAT_TOP };
}

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

function uiScaleFor(display) {
  return Math.min(features.get().islandScale / 100,
    (display.bounds.width || WIN_W) / WIN_W,
    (display.workArea.height || display.bounds.height || WIN_H) / WIN_H);
}

function sendAnchor(message, scale) {
  const css = { ...message, scale };
  for (const key of ['x', 'y', 'sw', 'sh', 'rowTop', 'rowBottom', 'panelLeft', 'panelRight']) {
    if (Number.isFinite(css[key])) css[key] /= scale;
  }
  const key = JSON.stringify(css);
  if (key === lastLayout) return;
  activeScale = scale;
  lastLayout = key;
  win.webContents.setZoomFactor(scale);
  send('anchor', css);
}

// Clamp the anchor to the display, position the window around it and tell the renderer
// where the pill sits inside the window.
// --- the address bar slot ---
// While a Chromium browser is in front the island takes the right third of its address bar
// (the user's split: two thirds for the address, one third for the island); it shrinks to a
// thin line while the user types there. The user's own position is untouched and comes back
// as soon as the browser isn't in front.
// Only from the island's default place: never while vertical or after the user put it somewhere.
let omni = null;
let omniKey = '';
const omniAllowed = () => features.get().addrIsland && !prefs.vertical && !prefs.placed;
function onOmni(o, browser) {
  const next = o ? { ...o, browser } : null;
  const key = next ? JSON.stringify(next) : '';
  if (key === omniKey) return;
  if (hoverOrigin) setActive(false);
  omniKey = key;
  omni = next;
  layout();
  updateGhost();
}

function layoutAddressBar() {
  // the helper reports physical pixels; Electron places windows in DIPs
  const r = screen.screenToDipRect(null, { x: omni.x, y: omni.y, width: omni.w, height: omni.h });
  const display = screen.getDisplayMatching(r);
  const b = display.bounds;
  const scale = uiScaleFor(display);
  const width = Math.round(WIN_W * scale);
  const height = Math.round(WIN_H * scale);
  const panelW = PANEL_W * scale;
  const panelH = PANEL_H * scale;
  const third = r.width / 3;
  const inset = omni.estimated ? 3 : 0;
  const sh = Math.round(Math.min(30, r.height - inset * 2));
  const sw = Math.round(Math.min(third - 12, 380 * scale));
  const cx = r.x + r.width - (omni.estimated ? sw / 2 + 6 : third / 2);
  const top = Math.round(r.y + r.height / 2 - sh / 2);
  const rowTop = r.y;
  const rowBottom = r.y + r.height;
  let panelLeft = b.x + 4;
  let panelRight = b.x + b.width - 4;
  if (omni.browser) {
    const { x, y, w, h } = omni.browser;
    const frame = screen.screenToDipRect(null, { x, y, width: w, height: h });
    if (frame.width >= panelW + 16 * scale) {
      panelLeft = Math.max(panelLeft, frame.x + 8 * scale);
      panelRight = Math.min(panelRight, frame.x + frame.width - 8 * scale);
    }
  }
  const panelCenter = panelRight - panelLeft >= panelW
    ? clamp(cx, panelLeft + panelW / 2, panelRight - panelW / 2)
    : cx;
  // Fit both the collapsed slot and the expanded panel into the transparent host window.
  const pillLeft = cx - sw / 2 - 4;
  const pillRight = cx + sw / 2 + 4;
  const wx = Math.round(clamp(clamp(panelCenter - width / 2, pillRight - width, pillLeft),
    b.x, b.x + b.width - width));
  const belowFits = rowBottom + (8 + PANEL_H + 6) * scale <= b.y + b.height;
  const preferredY = belowFits ? top - FLOAT_TOP * scale : rowTop - panelH - (8 + FLOAT_TOP) * scale;
  const wy = Math.round(clamp(preferredY, b.y, b.y + b.height - height));
  const cur = win.getBounds();
  if (cur.x !== wx || cur.y !== wy || cur.width !== width || cur.height !== height) {
    win.setBounds({ x: wx, y: wy, width, height });
  }
  const msg = {
    x: Math.round(cx - wx), y: top - wy, docked: false, vertical: false, side: prefs.side,
    addr: omni.focus ? 'line' : 'slim', sw, sh,
    rowTop: rowTop - wy, rowBottom: rowBottom - wy,
    panelLeft: Math.round(panelLeft - wx), panelRight: Math.round(panelRight - wx),
  };
  sendAnchor(msg, scale);
}

function layout() {
  if (!win || !anchor) return;
  // not while the user drags the island somewhere else
  if (omni && !drag && omniAllowed()) {
    layoutAddressBar();
    return;
  }
  const display = screen.getDisplayNearestPoint({ x: Math.round(anchor.x), y: Math.round(anchor.y) });
  const b = display.bounds;
  const wa = display.workArea;
  const scale = uiScaleFor(display);
  const width = Math.round(WIN_W * scale);
  const height = Math.round(WIN_H * scale);
  let wx;
  let wy;
  if (prefs.vertical) {
    anchor.x = prefs.side === 'left' ? b.x : b.x + b.width;
    anchor.y = clamp(anchor.y, wa.y + V_PILL_HALF_H * scale, wa.y + wa.height - V_PILL_HALF_H * scale);
    wx = prefs.side === 'left' ? b.x : b.x + b.width - width;
    wy = Math.round(clamp(anchor.y - height / 2, wa.y, wa.y + wa.height - height));
  } else {
    anchor.x = clamp(anchor.x, b.x + PILL_HALF_W * scale, b.x + b.width - PILL_HALF_W * scale);
    anchor.y = prefs.docked ? b.y : clamp(anchor.y, b.y, wa.y + wa.height - (PILL_H + 6) * scale);
    wx = Math.round(clamp(anchor.x - width / 2, b.x, b.x + b.width - width));
    wy = Math.round(prefs.docked ? b.y : clamp(anchor.y - FLOAT_TOP * scale, b.y, wa.y + wa.height - height));
  }
  const cur = win.getBounds();
  if (cur.x !== wx || cur.y !== wy || cur.width !== width || cur.height !== height) {
    win.setBounds({ x: wx, y: wy, width, height });
  }
  const msg = {
    x: Math.round(anchor.x - wx),
    y: Math.round(anchor.y - wy),
    docked: !prefs.vertical && prefs.docked,
    vertical: prefs.vertical,
    side: prefs.side,
  };
  sendAnchor(msg, scale);
}

function refreshPlacement() {
  clearTimeout(placementTimer);
  // Windows can report an intermediate display size while the GPU wakes or a monitor reconnects.
  placementTimer = setTimeout(() => {
    placementTimer = null;
    if (!win || win.isDestroyed() || quitting) return;
    if (!drag && !prefs.placed && !prefs.vertical) anchor = defaultAnchor();
    lastLayout = '';
    layout();
    updateGhost();
    if (!lastWindowState.suspended && !lastWindowState.launcher) updateVisibility();
  }, 300);
}

function placeWindow() {
  if (!win) return;
  anchor = Number.isFinite(prefs.ax) && Number.isFinite(prefs.ay) ? { x: prefs.ax, y: prefs.ay } : defaultAnchor();
  // settings from before "placed" existed: judge by where the island is
  if (typeof prefs.placed !== 'boolean') prefs.placed = !atDefaultPlace();
  if (!prefs.placed && !prefs.vertical) anchor = defaultAnchor();
  layout();
}

// the island's own spot: horizontal, at the top, centered on its display
function atDefaultPlace() {
  if (prefs.vertical || !anchor) return false;
  const b = screen.getDisplayNearestPoint({ x: Math.round(anchor.x), y: Math.round(anchor.y) }).bounds;
  return Math.abs(anchor.x - (b.x + b.width / 2)) < 2 && anchor.y - b.y <= FLOAT_TOP + 2;
}

function savePosition() {
  prefs.ax = Math.round(anchor.x);
  prefs.ay = Math.round(anchor.y);
  settings.save('settings.json', prefs);
}

function resetPosition() {
  prefs.docked = false;
  prefs.vertical = false;
  prefs.placed = false;
  anchor = defaultAnchor();
  layout();
  updateGhost();
  savePosition();
  notifyGeneral();
}

// Switch between the horizontal island and a vertical one docked to the nearest side.
function setVertical(on) {
  if (!anchor || on === prefs.vertical) return;
  const b = screen.getDisplayNearestPoint({ x: Math.round(anchor.x), y: Math.round(anchor.y) }).bounds;
  if (on) {
    prefs.side = anchor.x < b.x + b.width / 2 ? 'left' : 'right';
    anchor = { x: anchor.x, y: anchor.y + V_PILL_HALF_H * activeScale };
  } else {
    prefs.docked = false;
    const x = prefs.side === 'left' ? b.x + 260 * activeScale : b.x + b.width - 260 * activeScale;
    anchor = { x, y: anchor.y - V_PILL_HALF_H * activeScale };
  }
  prefs.vertical = on;
  layout();
  updateGhost();
  savePosition();
  notifyGeneral();
}

// --- dragging ---
// The renderer reports drag start/end; while dragging the window follows the cursor.
let drag = null;
let dragFrom = null;
ipcMain.on('drag-start', () => {
  if (!win || drag || !anchor) return;
  const p = screen.getCursorScreenPoint();
  dragFrom = { ...anchor };
  // grab the (shrinking) pill near where it was pressed so it stays under the cursor
  const ox = clamp(p.x - anchor.x, (-PILL_HALF_W + 16) * activeScale, (PILL_HALF_W - 16) * activeScale);
  const oy = prefs.vertical
    ? clamp(p.y - anchor.y, (-V_PILL_HALF_H + 20) * activeScale, (V_PILL_HALF_H - 20) * activeScale)
    : clamp(p.y - anchor.y, 4 * activeScale, (PILL_H - 6) * activeScale);
  drag = { ox, oy, timer: setInterval(followCursor, 8) };
});

function followCursor() {
  if (!drag || !win || win.isDestroyed()) return;
  const p = screen.getCursorScreenPoint();
  const b = screen.getDisplayNearestPoint(p).bounds;
  if (prefs.vertical) {
    // slides along the edge; crossing the middle of the screen moves it to the other side
    prefs.side = p.x < b.x + b.width / 2 ? 'left' : 'right';
    anchor = { x: p.x, y: p.y - drag.oy };
    layout();
    return;
  }
  const next = { x: p.x - drag.ox, y: p.y - drag.oy };
  const docked = next.y - b.y < SNAP_PX;
  if (docked) {
    next.y = b.y;
    const center = b.x + b.width / 2;
    if (Math.abs(next.x - center) < CENTER_SNAP_PX) next.x = center;
  }
  prefs.docked = docked;
  anchor = next;
  layout();
}

ipcMain.on('drag-end', () => {
  if (!drag) return;
  clearInterval(drag.timer);
  drag = null;
  // a real move decides whether the island stays where the user put it (no address-bar jump)
  if (dragFrom && Math.hypot(anchor.x - dragFrom.x, anchor.y - dragFrom.y) > 20) prefs.placed = !atDefaultPlace();
  dragFrom = null;
  layout();
  updateGhost();
  savePosition();
  scheduleCapture(240); // let the drop finish before refreshing the glass
  // don't pop the island open right after a move; re-arm when the cursor leaves
  suppressUntilLeave = true;
  send('hover', false);
});

function updateVisibility() {
  if (!win || !windowReady) return;
  const shouldShow = !userHidden && !switcherHidden && !(fullscreenHidden && features.get().hideFullscreen);
  if (shouldShow) {
    if (!win.isVisible()) {
      win.showInactive();
      // the cursor loop may be in its 600 ms hidden sleep: back to hover at once, and let the
      // window paint before a screen capture competes with it
      setImmediate(cursorLoop);
      scheduleCapture(400);
    }
    // GX and the Windows switcher can leave a visible island below the active browser.
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
  }
  if (!shouldShow && win.isVisible()) win.hide();
  syncAudioMeter();
  send('visibility', shouldShow);
}

function createWindow() {
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true);
  updateProtection();
  placeWindow();
  win.webContents.on('preload-error', (_e, p, err) => console.error('[preload-error]', p, err));
  win.webContents.on('console-message', (e, level, message, line, source) => {
    // Electron 35+ passes one event object with string levels; older versions passed arguments
    const lv = typeof e.level === 'string' ? e.level : level;
    const msg = e.message ?? message;
    const src = e.sourceId ?? source;
    const ln = e.lineNumber ?? line;
    if (lv === 'warning' || lv === 'error' || lv >= 2) console.error('[renderer]', msg, src ? `(${path.basename(src)}:${ln})` : '');
  });
  // absolute: when started through the resources/app stub the app root isn't this folder
  lockNavigation(win.webContents, (url) => url.startsWith('file:'));
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('did-finish-load', () => {
    lastLayout = '';
    layout();
  });
  win.once('ready-to-show', () => {
    windowReady = true;
    updateVisibility();
  });
}

function onWindowState(data) {
  const foregroundChanged = data.foreground !== lastWindowState.foreground;
  const captureEnded = lastWindowState.capture && !data.capture;
  lastWindowState = data;
  if (!win || win.isDestroyed()) return;
  const switching = data.suspended === true;
  const hideForSwitcher = switching && kaiPlugin?.taskSwitcher === true;
  if (hideForSwitcher) {
    if (!switcherHidden && switcherHideTimer === null) {
      switcherHideTimer = setTimeout(() => {
        switcherHideTimer = null;
        if (!win || win.isDestroyed()) return;
        switcherHidden = true;
        setActive(false);
        updateVisibility();
      }, SWITCHER_HIDE_DELAY_MS);
    }
  } else if (switcherHideTimer !== null) {
    clearTimeout(switcherHideTimer);
    switcherHideTimer = null;
  }
  const fullscreen = data.launcher || switching ? fullscreenHidden : data.fs;
  const keepSwitcherHidden = hideForSwitcher && switcherHidden;
  const visibilityChanged = fullscreenHidden !== fullscreen || switcherHidden !== keepSwitcherHidden;
  fullscreenHidden = fullscreen;
  switcherHidden = keepSwitcherHidden;
  if (switching || data.launcher) {
    // Shell overlays report no browser. Keep the settled anchor until the next app is ready.
    // Keep the current shape for the snip, and let the snipping overlay receive input.
    if (data.launcher && !data.capture && active) setActive(false);
    setMouseCaptured(false);
  } else {
    const handle = win.getNativeWindowHandle();
    const ownWindow = (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString();
    // Keep the browser anchor when our search field temporarily takes keyboard focus.
    if (data.foreground !== ownWindow) {
      onOmni(data.omni?.estimated && !kaiPlugin?.operaDocking ? null : data.omni, data.browser);
      onBrowser(data.browser);
    }
  }
  if (visibilityChanged || (foregroundChanged && !switching && !data.launcher)) updateVisibility();
  if (foregroundChanged && !switching && !data.launcher) scheduleCapture(400); // glassFreeze: retint for the new app
  if (captureEnded) scheduleCapture(150);
}

// --- system bridge: helper/nova-helper.exe (SMTC media, volume, brightness, fullscreen,
// window in front, keyboard, clipboard sequence, idle time). Compiled C#, no PowerShell. ---
function scriptPath(name) {
  return path.join(__dirname, name).replace('app.asar', 'app.asar.unpacked');
}
const HELPER = () => scriptPath(path.join('helper', 'nova-helper.exe'));

// Health of the bridge, shown in Settings (antivirus may block the helper).
const bridge = { state: 'starting', detail: '', lastLine: 0, engine: 'helper' };
function bridgeStatus() {
  const fresh = Date.now() - bridge.lastLine < 10000;
  return { state: fresh ? 'ok' : bridge.state === 'starting' ? 'starting' : 'failed', detail: bridge.detail, engine: bridge.engine };
}

function startMedia() {
  media = spawn(HELPER(), [], { windowsHide: true });
  media.once('spawn', () => {
    mediaWrite(`privacy ${features.get().privacyDots ? 1 : 0}`);
    audioMeterOn = false;
    syncAudioMeter();
    // Windows' own notifications, mirrored onto the island (the helper polls the notification list)
    mediaWrite(features.get().appNotices !== false ? 'appnotify on' : 'appnotify off');
  });
  let buffer = '';
  media.on('error', (err) => {
    console.error('[media] failed to start:', err.message);
    bridge.state = 'failed';
    bridge.detail = err.message;
  });
  media.stderr.setEncoding('utf8');
  media.stderr.on('data', (d) => {
    console.error('[media]', d.trim());
    bridge.detail = d.trim().split('\n')[0].slice(0, 200);
  });
  media.stdout.setEncoding('utf8');
  media.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).replace(/^﻿/, '').trim();
      buffer = buffer.slice(i + 1);
      if (!line.startsWith('{')) continue;
      try {
        const data = JSON.parse(line);
        bridge.lastLine = Date.now();
        bridge.state = 'ok';
        if (data.error) console.error('[media]', data.error);
        if ('appnote' in data) {
          const n = data.appnote;
          // some Store apps send unresolved resource names ("ms-resource:TimerDoneText"): drop those
          const text = (s) => (/^ms-resource:/i.test(String(s || '')) ? '' : String(s || ''));
          if (n && features.get().appNotices !== false && win && !win.isDestroyed() && !screenLocked) {
            send('app-notice', { app: String(n.app || '').slice(0, 40), aumid: n.aumid ? String(n.aumid) : '', title: text(n.title).slice(0, 160),
              body: text(n.body).slice(0, 360), icon: /^data:image\/png;base64,/.test(n.icon || '') ? n.icon : '', rgb: Array.isArray(n.rgb) ? n.rgb.slice(0, 3) : null });
          }
          continue;
        }
        if ('appnotifyAccess' in data) {
          log.info(`[app-notify] notification access: ${data.appnotifyAccess}`);
          continue;
        }
        if ('strips' in data) {
          stripsWaiting.get(data.strips)?.(data);
          stripsWaiting.delete(data.strips);
          continue;
        }
        if ('audioBands' in data) {
          if (audioMeterOn && Array.isArray(data.audioBands) && data.audioBands.length === 5 && data.audioBands.every(Number.isFinite)) {
            send('audio-bands', data.audioBands);
          }
          continue;
        }
        // answers to commands (focusapp / runningapps) are not media status
        if ('focusapp' in data || 'running' in data) {
          apps.onHelper(data);
          continue;
        }
        if (data.windowState) {
          onWindowState(data);
          continue;
        }
        if (typeof data.clip === 'number') onClipboardSeq(data.clip, !!data.clipPriv);
        if (data.privacy) privacy.onHelper(data.privacy);
        if (typeof data.bat === 'number') onBattery(data.bat, data.ac !== false);
        if (typeof data.rec === 'boolean' && data.rec !== recording) {
          recording = data.rec;
          log.info(`screen recorder ${recording ? 'running: glass paused' : 'gone: glass back'}`);
          send('recording', recording);
          updateProtection();
        }
        publishMedia(data);
      } catch {}
    }
  });
  media.on('exit', (code) => {
    media = null;
    if (!quitting) onWindowState({ fs: false, suspended: false });
    if (Date.now() - bridge.lastLine > 10000) {
      bridge.state = 'failed';
      bridge.detail ||= `helper exited (code ${code})`;
    }
    if (!quitting) setTimeout(startMedia, 3000);
  });
}

// --- copied images (Win+Shift+S and friends) ---
// The bridge reports Windows' clipboard sequence number; the image is only read when it
// changes, so a big screenshot sitting on the clipboard costs nothing.
const { clipboard } = require('electron');
let clipSeq = null;
let lastShot = null; // nativeImage of the last copied image, until it is saved or replaced
async function onClipboardSeq(seq, isPrivate) {
  if (clipSeq === null) { clipSeq = seq; return; } // whatever was there at startup is old news
  if (seq === clipSeq) return;
  clipSeq = seq;
  system.clipboardChanged(isPrivate); // text: history and smart actions
  if (isPrivate || !features.get().screenshotToast) return;
  // Electron 44: images come from clipboard.read() items as blobs
  let img = null;
  try {
    for (const item of await clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      img = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
      break;
    }
  } catch (err) {
    console.error('[screenshot] read', err.message);
  }
  if (!img || img.isEmpty()) return;
  lastShot = img;
  const { width, height } = img.getSize();
  const f = features.get();
  const auto = f.shotAutoShelf && f.tabShelf;
  send('screenshot', { thumb: img.resize({ height: 72, quality: 'good' }).toDataURL(), width, height, auto });
  if (auto) shotToShelf(Date.now() + f.shotShelfMinutes * 60 * 1000);
}

// The Snipping Tool saves every capture to Pictures\Screenshots by itself: that file goes on the
// shelf (no second copy). Any other copied image is saved to Pictures\Nova Island first.
const SNIP_WAIT_MS = 2500;
async function windowsScreenshot(since) {
  const dir = path.join(app.getPath('pictures'), 'Screenshots');
  for (let waited = 0; waited <= SNIP_WAIT_MS; waited += 250) {
    try {
      const fresh = fs.readdirSync(dir)
        .filter((n) => /\.(png|jpe?g)$/i.test(n))
        .map((n) => path.join(dir, n))
        .map((p) => [p, fs.statSync(p)])
        .filter(([, s]) => s.size > 0 && s.mtimeMs >= since - 1500)
        .sort((a, b) => b[1].mtimeMs - a[1].mtimeMs)[0];
      if (fresh) return fresh[0];
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}
async function shotToShelf(until = 0) {
  if (!lastShot) return;
  const shot = lastShot;
  const copiedAt = Date.now();
  try {
    let file = until ? await windowsScreenshot(copiedAt) : null;
    if (!file) {
      const dir = path.join(app.getPath('pictures'), 'Nova Island');
      const pad = (n) => String(n).padStart(2, '0');
      const d = new Date();
      file = path.join(dir, `Screenshot ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, shot.toPNG());
    }
    shelf.add([file], until);
    send('shelf', await shelf.list());
    if (!until) send('shot-saved', { name: path.basename(file) });
  } catch (err) {
    console.error('[screenshot]', err.message);
  }
}
ipcMain.on('shot-to-shelf', () => shotToShelf());

const MEDIA_CMD = /^(toggle|next|prev|mute|seek \d+(\.\d+)?|vol [01](\.\d+)?|bright \d{1,3})$/;
ipcMain.on('media-cmd', (_e, cmd) => {
  if (media && typeof cmd === 'string' && MEDIA_CMD.test(cmd)) media.stdin.write(cmd + '\n');
});

function mediaWrite(cmd) {
  if (media) media.stdin.write(cmd + '\n');
}

// --- mini player (pop a YouTube video out of the browser) ---
const BROWSER_PROCS = ['chrome', 'msedge', 'brave', 'vivaldi', 'opera'];
const APP_ID = /^[\w.!-]+$/;

function browserProc(appId) {
  const id = String(appId || '').toLowerCase();
  return BROWSER_PROCS.find((p) => id.includes(p)) || null;
}

function findTabUrl(proc, title) {
  return new Promise((resolve) => {
    const ps = spawn(HELPER(), ['yturl', proc, String(title || '').slice(0, 200)], { windowsHide: true });
    let out = '';
    const timer = setTimeout(() => ps.kill(), 10000);
    ps.on('error', () => resolve(''));
    ps.stdout.setEncoding('utf8');
    ps.stdout.on('data', (d) => (out += d));
    ps.on('close', () => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out.replace(/^﻿/, '').trim());
        resolve(r.url || '');
      } catch {
        resolve('');
      }
    });
  });
}

function youtubeId(url) {
  const m = String(url).match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/live\/|\/embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}

ipcMain.handle('mini-open', async (_e, req) => {
  const appId = String(req?.app || '');
  const proc = browserProc(appId);
  if (!proc || !APP_ID.test(appId)) return { ok: false, error: 'not-browser' };
  const pos = Math.max(0, Number(req.pos) || 0);
  const wasPlaying = !!req.playing;

  // pause first so the tab stops exactly where the mini player will pick up
  mediaWrite(`pauseapp ${appId}`);
  const url = await findTabUrl(proc, req.title);
  const id = youtubeId(url);
  if (!id) {
    if (wasPlaying) mediaWrite(`playapp ${appId}`);
    return { ok: false, error: 'no-url' };
  }

  await mini.open({
    id,
    t: pos,
    appId,
    title: String(req.title || ''),
    onClose: (time, resume) => {
      // back in the tab at the second the mini player reached
      mediaWrite(`seekapp ${appId} ${Math.max(0, time).toFixed(2)}`);
      if (resume) setTimeout(() => mediaWrite(`playapp ${appId}`), 250);
    },
  });
  return { ok: true };
});

// --- glass backdrop ---
// CSS backdrop-filter cannot see other windows, so sample the surrounding screen at
// low resolution and let the renderer blur the resulting ambient colours.
// The backdrop is re-captured often while the island is open or changing shape, rarely while
// it sits collapsed, and not at all while hidden; an unchanged picture is not re-sent.
const CAPTURE_ACTIVE_MS = 1000;
const CAPTURE_IDLE_MS = 8000;

let capturing = false;
let stripsId = 0;
const stripsWaiting = new Map();
let captureTimer = null;
let lastCaptureKey = '';
let busyUntil = 0; // shape changed recently
let screenLocked = false;
let panelOpen = false;
const canCapture = () => !screenLocked && !lastWindowState.capture && win && !win.isDestroyed() && win.isVisible() && glassLive();
function scheduleCapture(ms) {
  clearTimeout(captureTimer);
  captureTimer = setTimeout(async () => {
    captureTimer = null;
    await captureBackdrop();
    if (captureTimer !== null || !canCapture()) return;
    if (active || panelOpen) scheduleCapture(CAPTURE_ACTIVE_MS);
    else if (!perf().glassFreeze) scheduleCapture(Date.now() < busyUntil ? CAPTURE_ACTIVE_MS : CAPTURE_IDLE_MS);
  }, ms);
}
async function captureBackdrop() {
  // ponytail: the helper samples a few pixels around the window (~8 ms, in its own process);
  // desktopCapturer grabbed the whole screen and blocked this thread for hundreds of ms
  if (capturing || drag || !canCapture() || !media) return;
  capturing = true;
  try {
    const r = screen.dipToScreenRect(win, win.getBounds());
    const id = ++stripsId;
    const strips = await new Promise((resolve) => {
      const timer = setTimeout(() => { stripsWaiting.delete(id); resolve(null); }, 1000);
      stripsWaiting.set(id, (data) => { clearTimeout(timer); resolve(data); });
      mediaWrite(`strips ${id} ${Math.round(r.x)} ${Math.round(r.y)} ${Math.round(r.width)} ${Math.round(r.height)}`);
    });
    const frame = strips && stripBackdrop(strips);
    if (!frame) return;
    // cheap fingerprint: sample the small bitmap instead of hashing all of it
    const bmp = frame.bgra;
    let key = `${bmp.length}`;
    for (let i = 0; i < bmp.length; i += 997) key += bmp[i].toString(36);
    if (key === lastCaptureKey) return;
    lastCaptureKey = key;
    // the raw pixels, not a PNG: no encoding here and no decoding in the island
    send('backdrop', frame);
  } catch (err) {
    console.error('[backdrop]', err.message);
  } finally {
    capturing = false;
  }
}

// --- the glass and screen recorders ---
// Glass samples the surrounding screen, so screenshots can always include the island.
// Screen recording still pauses capture work and keeps the theme's solid fallback.
let recording = false;
function activeTheme(theme) {
  return !kaiPlugin && theme.startsWith('kai-') ? 'original' : theme;
}
const glassWanted = () => !perf().noBlur && !features.SOLID_THEMES.includes(activeTheme(features.get().theme));
const glassLive = () => glassWanted() && !recording;
let protectedNow = null;
function updateProtection() {
  if (!win || win.isDestroyed()) return;
  if (protectedNow === null) win.setContentProtection(false);
  const live = glassLive();
  if (live === protectedNow) return;
  protectedNow = live;
  if (live) {
    lastCaptureKey = '';
    scheduleCapture(150);
  }
}

// --- performance options and the battery saver ---
// The user's own switches (Remove blur, Remove animations, Freeze glass) slow the cursor poll,
// the CPU/RAM poll and the screen capture. The battery saver turns all three on while on battery
// below its level, without saving them: the user's own choices come back once it ends. It ends
// on the charger, or 10 % above the level, so it doesn't flip on and off around it.
let battery = { pct: -1, ac: true };
let saverOn = false;
function perf() {
  const f = features.get();
  return { noBlur: f.noBlur || saverOn, noAnimations: f.noAnimations || saverOn, glassFreeze: f.glassFreeze || saverOn };
}
const perfSlow = () => Object.values(perf()).some(Boolean);
function islandFeatures() {
  return { ...settingsFeatures(), ...perf(), saver: saverOn };
}

function settingsFeatures() {
  const f = features.get();
  return { ...f, theme: activeTheme(f.theme), kaiPlugin: !!kaiPlugin, kaiNotifications: kaiPlugin?.notifications === true };
}

function syncKaiPlugin(activePlugins) {
  const next = activePlugins.find((p) => p.id === plugins.KAI_PLUGIN_ID)?.values ?? null;
  if (JSON.stringify(next) === JSON.stringify(kaiPlugin)) return;
  kaiPlugin = next;
  kaiNotices.setEnabled(next?.notifications === true);
  if (omni?.estimated && !next?.operaDocking) onOmni(null);
  onWindowState(lastWindowState);
  updateProtection();
  send('features', islandFeatures());
  prefsWindow.send('features', settingsFeatures());
}
let perfKey = '';
function applyPerf() {
  const key = JSON.stringify(perf());
  if (key === perfKey) return;
  perfKey = key;
  system.setStatsEvery(perfSlow() ? 5000 : 2000);
  updateProtection();
  send('features', islandFeatures());
  lastCaptureKey = '';
  scheduleCapture(300);
}
function evalSaver() {
  const f = features.get();
  let on = saverOn;
  if (!f.batterySaver || battery.pct < 0 || battery.ac) on = false;
  else if (battery.pct <= f.batterySaverAt) on = true;
  else if (battery.pct >= f.batterySaverAt + 10) on = false;
  if (on === saverOn) return;
  saverOn = on;
  log.info(`battery saver ${on ? 'on' : 'off'} (${battery.pct}%)`);
  send('saver', { on, pct: battery.pct });
  applyPerf();
  notifyGeneral();
}
function onBattery(pct, ac) {
  if (pct === battery.pct && ac === battery.ac) return;
  const had = battery.pct;
  battery = { pct, ac };
  evalSaver();
  if ((had < 0) !== (pct < 0)) notifyGeneral();
}

// --- "Stay in place" in the browser (Address bar off) ---
// While a browser is in front under the island, the island stays where it is and lets the mouse
// through to the tabs below (it looks the same); Ctrl+Alt+I still opens it.
let browserRect = null; // the browser window in front, in DIPs
let ghost = false;
let ghostOpen = false; // opened with the shortcut over the browser, until it is closed again
function onBrowser(b) {
  browserRect = b ? screen.screenToDipRect(null, { x: b.x, y: b.y, width: b.w, height: b.h }) : null;
  updateGhost();
}
function updateGhost() {
  let over = !!(omni && omniAllowed() && omni.focus);
  if (!over && !features.get().addrIsland && browserRect && win && !win.isDestroyed() && islandRect.width) {
    const wb = win.getBounds();
    const x = wb.x + islandRect.x;
    const y = wb.y + islandRect.y;
    const br = browserRect;
    over = x < br.x + br.width && x + islandRect.width > br.x && y < br.y + br.height && y + islandRect.height > br.y;
  }
  if (!over) ghostOpen = false;
  const on = over && !ghostOpen;
  if (on === ghost) return;
  ghost = on;
  if (on) setActive(false);
}
// Action cards can take input even in the browser's pass-through mode.
let clickable = false;
ipcMain.on('pinned', (_e, on) => {
  if (!on && ghostOpen) {
    ghostOpen = false;
    updateGhost();
  }
});

// Forwarded mouse events are unreliable on transparent windows. Poll the cursor and
// use the same committed geometry for hover and native mouse capture.
let islandRect = { x: 0, y: 0, width: 0, height: 0 };
let active = false;
let mouseCaptured = false;
let hoverOrigin = null;
let suppressUntilLeave = false;

ipcMain.on('island-rect', (_e, r) => {
  if (Math.abs((r.scale || 1) - activeScale) > .001) return;
  clickable = r.clickable === true;
  const opened = r.mode === 'expanded';
  const panelChanged = opened !== panelOpen;
  panelOpen = opened;
  r = { x: r.x * activeScale, y: r.y * activeScale, width: r.width * activeScale, height: r.height * activeScale };
  const resized = r.width !== islandRect.width || r.height !== islandRect.height;
  islandRect = r;
  updateGhost();
  if (!clickable && ghost) setActive(false);
  if (resized || panelChanged) {
    busyUntil = Date.now() + 2000;
    scheduleCapture(240);
  }
  pollCursor();
});

function setActive(on) {
  if (on === active) return;
  active = on;
  hoverOrigin = on && !panelOpen && !clickable && !ghost ? { ...islandRect } : null;
  if (!on) setMouseCaptured(false);
  if (!on && win.isFocusable()) win.setFocusable(false);
  send('hover', on);
}

function setMouseCaptured(on) {
  if (on === mouseCaptured) return;
  mouseCaptured = on;
  win.setIgnoreMouseEvents(!on);
  // once clicks pass through, the page never hears the cursor leave and a :hover sticks;
  // a move to nowhere clears it
  if (!on) win.webContents.sendInputEvent({ type: 'mouseMove', x: -1, y: -1 });
}

// Nova's eyes follow the cursor while it is near the island (sent only on real movement).
const NEAR_PX = 260;
let nearSent = null;
let nearAt = 0;
let nearTimer = null;
// <=10 sends/s; a throttled value is sent trailing so the eyes settle on the last position
function pushNear(v) {
  clearTimeout(nearTimer);
  nearTimer = null;
  const wait = nearAt + 100 - Date.now();
  if (wait > 0) { nearTimer = setTimeout(() => pushNear(v), wait); return; }
  nearAt = Date.now();
  send('near', v);
}
function sendNear(x, y) {
  const f = features.get();
  const artwork = companionStates.usesArtwork(f.companionStyle || 'phoenix');
  const follows = artwork ? f.phoenixIdle || (f.companionStyle !== 'zaher-standing' && (f.phoenixBlink || f.phoenixLookLeft || f.phoenixLookRight))
    : f.companionStyle === 'classic' && f.novaEyes && !perfSlow();
  if (!follows || !islandRect.width) {
    if (nearSent) {
      nearSent = null;
      pushNear(null);
    }
    return;
  }
  const dx = Math.round((x - (islandRect.x + islandRect.width / 2)) / activeScale / 8) * 8; // 8 px steps
  const dy = Math.round((y - (islandRect.y + islandRect.height / 2)) / activeScale / 8) * 8;
  const near = Math.hypot(dx, dy) < NEAR_PX;
  if (!near) {
    if (nearSent) pushNear(null);
    nearSent = null;
    return;
  }
  if (nearSent && nearSent.dx === dx && nearSent.dy === dy) return;
  nearSent = { dx, dy };
  pushNear(nearSent);
}

let inside = false;
let enteredAt = 0;
let cursorFar = false;
// fast only near the island; hidden and locked windows sleep
let cursorTimer = null;
function cursorLoop() {
  clearTimeout(cursorTimer);
  pollCursor();
  const hidden = !win || win.isDestroyed() || !win.isVisible() || screenLocked;
  cursorTimer = setTimeout(cursorLoop, hidden ? 600 : cursorFar ? CURSOR_POLL_FAR_MS : CURSOR_POLL_NEAR_MS);
}
function pollCursor() {
  if (!win || win.isDestroyed() || !win.isVisible() || screenLocked || !islandRect.width || drag || lastWindowState.launcher || lastWindowState.suspended) return;
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const x = p.x - b.x;
  const y = p.y - b.y;
  const fx = Math.max(islandRect.x - x, 0, x - islandRect.x - islandRect.width);
  const fy = Math.max(islandRect.y - y, 0, y - islandRect.y - islandRect.height);
  cursorFar = Math.hypot(fx, fy) > FAR_PX * activeScale;
  sendNear(x, y);
  const pad = (active ? 8 : 2) * activeScale;
  const hit =
    x >= islandRect.x - pad &&
    x <= islandRect.x + islandRect.width + pad &&
    y >= islandRect.y - pad &&
    y <= islandRect.y + islandRect.height + pad;
  // Keep a path from the old pill to the panel when it jumps below the browser bar
  // or inward from a side dock. That path never captures clicks.
  const crossing = panelOpen && hoverOrigin &&
    x >= hoverOrigin.x - pad && x <= hoverOrigin.x + hoverOrigin.width + pad &&
    y >= Math.min(hoverOrigin.y, islandRect.y + islandRect.height) - pad &&
    y <= Math.max(hoverOrigin.y + hoverOrigin.height, islandRect.y) + pad;
  const now = hit || !!crossing;
  if (now && !inside) enteredAt = Date.now();
  inside = now;
  if (!now) {
    suppressUntilLeave = false;
    setActive(false);
  } else if (!active && (!suppressUntilLeave || clickable) && (!ghost || clickable) &&
    (clickable || Date.now() - enteredAt >= HOVER_INTENT_MS)) {
    setActive(true);
  }
  const onPaint = x >= islandRect.x && x <= islandRect.x + islandRect.width &&
    y >= islandRect.y && y <= islandRect.y + islandRect.height;
  setMouseCaptured(active && onPaint);
}

// Open on an app's notification: bring that app to the front (the helper finds or starts it)
ipcMain.on('app-notify-open', (_e, aumid) => {
  // app ids are letters, digits and . _ ! - { } \ and spaces; never a newline (the helper reads lines)
  if (typeof aumid === 'string' && /^[\w.!{}\\ -]{1,260}$/.test(aumid)) mediaWrite(`appnotify open ${aumid}`);
});

// Text inputs (app search) need keyboard focus; the window is otherwise non-focusable.
ipcMain.on('focus-input', (_e, on) => {
  if (!win) return;
  win.setFocusable(!!on);
  if (on) win.focus();
});

// --- apps ---
ipcMain.handle('apps-list', () => apps.list());
ipcMain.handle('apps-all', () => apps.all());
ipcMain.on('apps-add', (_e, id) => apps.add(id));
ipcMain.on('apps-remove', (_e, id) => apps.remove(id));
ipcMain.on('apps-launch', (_e, id, fresh) => apps.launch(id, !!fresh));
ipcMain.handle('apps-running', () => apps.running());
ipcMain.on('apps-reorder', (_e, ids) => apps.reorder(ids));

// --- shelf ---
const shelfChanged = async () => send('shelf', await shelf.list());
ipcMain.handle('shelf-list', () => shelf.list());
ipcMain.on('shelf-add', (_e, paths) => {
  if (Array.isArray(paths)) shelf.add(paths);
  shelfChanged();
});
ipcMain.on('shelf-remove', (_e, p) => { shelf.remove(p); shelfChanged(); });
ipcMain.on('shelf-clear', () => { shelf.clear(); shelfChanged(); });
ipcMain.on('shelf-open', (_e, p) => shelf.open(p));
ipcMain.on('shelf-reveal', (_e, p) => shelf.reveal(p));
ipcMain.on('shelf-drag', (e, p) => shelf.startDrag(e.sender, p));

// --- system ---
ipcMain.handle('system-snapshot', () => system.snapshot());
ipcMain.on('clip-copy', (_e, i) => system.copyClip(i));
ipcMain.on('clip-clear', () => system.clearClips());
ipcMain.on('clip-pin', (_e, i, on) => { if (Number.isInteger(i)) system.pinClip(i, !!on); });
ipcMain.handle('clip-full', (_e, i) => (Number.isInteger(i) ? system.clipFull(i) : null));
// the reminder card's copy button: written quietly, so it stays out of the clipboard history
ipcMain.on('copy-text', (_e, text) => { if (typeof text === 'string' && text) system.writeQuiet(text.slice(0, 10000)); });
ipcMain.handle('prayer-snapshot', () => prayer.snapshot());

// --- IDM Nova downloads ---
ipcMain.handle('dl-snapshot', () => downloads.snapshot());
ipcMain.on('dl-control', (_e, id, action) => downloads.control(typeof id === 'string' ? id : '', String(action)));

// --- start with Windows / setup ---
// Start with Windows = a shortcut in the user's Startup folder (works for both the dev
// launch "electron.exe <folder>" and a packaged build).
function startupLink() {
  return path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Nova Island.lnk');
}

function shortcutOptions() {
  return {
    target: process.execPath,
    args: app.isPackaged ? '' : `"${__dirname}"`,
    cwd: __dirname,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    iconIndex: 0,
    description: 'Nova Island',
  };
}

// The Microsoft Store version starts with Windows through its package (a startup task, on by
// default), which the user turns off in Windows Settings > Apps > Startup; Nova can't change it.
const STORE = !!process.windowsStore;

// Installed builds use the system login item; a dev run ("electron.exe <folder>") keeps the
// shortcut in the Startup folder, since the login item would only start bare Electron.
function startsWithWindows() {
  if (STORE) return true;
  return app.isPackaged ? app.getLoginItemSettings().openAtLogin : fs.existsSync(startupLink());
}

function setStartWithWindows(on) {
  if (STORE) return true;
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: on });
    return on;
  }
  const link = startupLink();
  if (!on) {
    try { fs.unlinkSync(link); } catch {}
    return false;
  }
  return shell.writeShortcutLink(link, 'create', shortcutOptions());
}

// "Setup Nova Island.cmd" launches the app with --setup: create the desktop icon and the
// startup entry, and write what happened to setup-log.txt next to the app.
function runSetup() {
  const lines = [`Nova Island setup - ${new Date().toLocaleString()}`];
  const desktop = path.join(app.getPath('desktop'), 'Nova Island.lnk');
  try {
    const ok = shell.writeShortcutLink(desktop, 'create', shortcutOptions());
    lines.push(`${ok && fs.existsSync(desktop) ? 'OK  ' : 'FAIL'} desktop shortcut: ${desktop}`);
  } catch (err) {
    lines.push(`FAIL desktop shortcut: ${err.message}`);
  }
  try {
    const ok = setStartWithWindows(true);
    lines.push(`${ok && fs.existsSync(startupLink()) ? 'OK  ' : 'FAIL'} start with Windows: ${startupLink()}`);
  } catch (err) {
    lines.push(`FAIL start with Windows: ${err.message}`);
  }
  lines.push(`app: ${process.execPath} ${__dirname}`);
  const logDir = __dirname;
  try {
    fs.writeFileSync(path.join(logDir, 'setup-log.txt'), lines.join('\r\n') + '\r\n');
  } catch {}
  console.log(lines.join('\n'));
}

app.on('second-instance', (_e, argv) => {
  if (argv.includes('--setup')) runSetup();
});

// --- menus ---
function appMenu() {
  return Menu.buildFromTemplate([
    { label: 'Nova Island', enabled: false },
    { type: 'separator' },
    {
      label: 'Show island',
      type: 'checkbox',
      checked: !userHidden,
      click: (item) => { userHidden = !item.checked; updateVisibility(); notifyGeneral(); },
    },
    {
      label: 'Vertical (dock left / right)',
      type: 'checkbox',
      checked: prefs.vertical,
      click: (item) => setVertical(item.checked),
    },
    { label: 'Reset position', click: resetPosition },
    ...(STORE ? [] : [{
      label: 'Start with Windows',
      type: 'checkbox',
      checked: startsWithWindows(),
      click: (item) => { setStartWithWindows(item.checked); notifyGeneral(); },
    }]),
    { label: 'Expand / collapse   Ctrl+Alt+I', click: () => send('toggle') },
    { label: 'Settings…', click: () => prefsWindow.open() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

ipcMain.on('context-menu', () => appMenu().popup({ window: win }));

// --- Settings window ---
// General options live in main (position, startup); feature switches live in features.js.
function generalState() {
  return {
    shown: !userHidden, vertical: !!prefs.vertical, startWithWindows: startsWithWindows(), version: app.getVersion(),
    store: STORE,
    battery: battery.pct, saver: saverOn,
  };
}
function notifyGeneral() {
  prefsWindow.send('general', generalState());
}
ipcMain.on('open-settings', (_e, page) => prefsWindow.open(page === 'island' ? 'island' : undefined));
const mediaSettingsSender = e => (win && e.sender === win.webContents) || prefsWindow.owns(e.sender);
ipcMain.handle('spotify-status', e => mediaSettingsSender(e) ? spotify?.snapshot() || {connected:false} : null);
ipcMain.handle('spotify-connect', (e, clientId) => mediaSettingsSender(e) ? spotify?.connect(clientId) : {ok:false});
ipcMain.handle('spotify-disconnect', e => { if (mediaSettingsSender(e)) spotify?.disconnect(); });
ipcMain.handle('spotify-like', (e, id, liked) => win && e.sender === win.webContents ? spotify?.setLiked(id, liked) : {ok:false});
ipcMain.handle('browser-companion-status', e => mediaSettingsSender(e) ? {folder:path.join(app.getPath('userData'),'browser-companion'),
  connected:browserMedia.snapshot().some(r => Date.now()-r.received < 35000)} : null);
ipcMain.on('browser-companion-folder', e => { if (mediaSettingsSender(e)) shell.openPath(path.join(app.getPath('userData'),'browser-companion')); });
ipcMain.on('spotify-dashboard', e => { if (mediaSettingsSender(e)) shell.openExternal('https://developer.spotify.com/dashboard'); });
// news: the island reports what it showed or closed, and opens a link main read itself
ipcMain.on('news-shown', (_e, id) => news.shown(String(id)));
ipcMain.on('news-dismiss', (_e, id) => news.dismiss(String(id)));
ipcMain.on('news-open', (_e, id) => {
  news.markRead([String(id)]);
  openNovaLink(news.linkOf(String(id)));
});
ipcMain.on('news-read', (_e, ids) => news.markRead(Array.isArray(ids) ? ids.map(String) : []));
function openNovaLink(link) {
  const m = /^nova:\/\/(plugins|settings)\/([\w-]+)$/.exec(link || '');
  if (m) prefsWindow.open(m[1] === 'plugins' ? `plugins:${m[2]}` : m[2]);
  else if (/^https:\/\//.test(link || '')) shell.openExternal(link);
}
// the island page reports once all its scripts ran (an early error would stop it before this)
ipcMain.on('island-ready', () => log.info('island ready'));
ipcMain.on('update-install', () => updater.install());
// Settings > General: check now, and "Update now" (the island counts down, as its own card does)
ipcMain.handle('update-check', () => updater.checkNow());
ipcMain.handle('update-state', () => updater.state());
ipcMain.on('update-now', () => send('update-now'));
ipcMain.handle('features-get', () => settingsFeatures());
ipcMain.on('kai-notice-preview', (_e, kind) => {
  if (!kaiPlugin?.notifications) return;
  const samples = {
    task_reminder: { title: 'Review study notes · in 10 min', body: 'A reminder from your garden' },
    focus_done: { title: '25 minutes tended ✿', body: 'A round well kept' },
    test: { title: 'Kai’s Flow', body: 'Your custom island notification is ready.' },
  };
  if (Object.hasOwn(samples, kind)) send('kai-notice', { ...samples[kind], kind, preview: true });
});
ipcMain.handle('island-features', () => islandFeatures());
ipcMain.on('features-set', (_e, patch) => features.set(patch));
ipcMain.on('features-reset', () => features.reset());
ipcMain.on('reminder-preview', () => send('reminder-now'));
ipcMain.on('phoenix-preview', (e, id) => {
  if (prefsWindow.owns(e.sender) && companionStates.some(pose => pose.id === id)) send('phoenix-preview',id);
});
ipcMain.handle('general-get', () => generalState());
// Settings > Support: the page names a link, main holds the addresses
const SUPPORT_LINKS = {
  kofi: 'https://ko-fi.com/binamer',
  instapay: 'https://ipn.eg/S/binamerbm/instapay/38txJO',
  github: 'https://github.com/NOVA-TECH-KIT/nova-island',
  facebook: 'https://www.facebook.com/nova4kit/',
  // Settings > More by Nova
  qrnova: 'https://github.com/NOVA-TECH-KIT/qr-nova/releases/latest',
  'qrnova-src': 'https://github.com/NOVA-TECH-KIT/qr-nova',
  // Settings > General, Store version: Windows' own startup apps page
  startupapps: 'ms-settings:startupapps',
};
ipcMain.on('open-support', (_e, key) => {
  if (Object.hasOwn(SUPPORT_LINKS, key)) shell.openExternal(SUPPORT_LINKS[key]);
});
ipcMain.handle('bridge-status', () => bridgeStatus());
ipcMain.on('open-log', () => {
  if (log.logPath() && fs.existsSync(log.logPath())) shell.openPath(log.logPath());
});
ipcMain.handle('copy-report', async () => {
  const f = features.get();
  const on = Object.keys(f).filter((k) => f[k] === true).length;
  const report = log.report({
    bridge: bridgeStatus(),
    location: system.locationInfo().mode,
    features: `${on} on`,
    vertical: !!prefs.vertical,
    calendar: calendar.hasUrl() ? 'linked' : 'none',
  });
  await clipboard.writeText(report);
  return true;
});
ipcMain.handle('loc-get', () => system.locationInfo());
ipcMain.handle('net-get', () => network.snapshot());
// smart clipboard: act on what main itself recognised, never on data from the page
const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|x\.com|twitter\.com|facebook\.com|fb\.watch|vimeo\.com|reddit\.com|soundcloud\.com|dailymotion\.com)$/i;
ipcMain.on('clip-action', async (_e, action) => {
  const s = system.lastSmart();
  if (!s) return;
  if (s.type === 'url' && action === 'open' && /^https?:\/\//i.test(s.url)) shell.openExternal(s.url);
  else if (s.type === 'url' && action === 'download') {
    try {
      const r = await fetch('http://127.0.0.1:17890/add', {
        method: 'POST',
        headers: downloads.novaHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ url: s.url, media: VIDEO_HOSTS.test(new URL(s.url).hostname) }),
        signal: AbortSignal.timeout(4000),
      });
      if (r.status === 403) downloads.forgetToken();
      if (!r.ok) throw new Error(`IDM Nova answered ${r.status}`);
    } catch {
      shell.openExternal(s.url);
    }
  } else if (s.type === 'math' && action === 'copy') system.writeQuiet(s.result);
});
// download folders watched for browser downloads (Settings > Connections)
const folderDownloads = require('./browser-downloads');
ipcMain.handle('dl-folders', () => folderDownloads.folderList());
ipcMain.handle('dl-folder-add', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { title: 'Add a download folder', properties: ['openDirectory'] });
  return r.canceled || !r.filePaths[0] ? folderDownloads.folderList() : folderDownloads.addFolder(r.filePaths[0]);
});
ipcMain.handle('dl-folder-remove', (_e, p) => folderDownloads.removeFolder(p));
// plugins (Settings > Plugins, and the island's own controls)
ipcMain.handle('plugins-active', () => plugins.active());
ipcMain.handle('plugins-list', () => {
  plugins.refresh();
  return plugins.list();
});
ipcMain.handle('plugin-install', (_e, id) => plugins.install(String(id)));
ipcMain.handle('plugin-install-file', async (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(w, { title: 'Install a plugin', properties: ['openFile'], filters: [{ name: 'Nova Island plugin', extensions: ['nvp'] }] });
  return r.canceled || !r.filePaths[0] ? null : plugins.installFile(r.filePaths[0]);
});
ipcMain.on('plugin-remove', (_e, id) => plugins.remove(String(id)));
ipcMain.on('plugin-enable', (_e, id, on) => plugins.setEnabled(String(id), !!on));
ipcMain.on('plugin-setting', (_e, id, key, value) => plugins.setSetting(String(id), String(key), value));
ipcMain.handle('cal-get', () => ({ ...calendar.snapshot(), hasUrl: calendar.hasUrl() }));
ipcMain.handle('cal-set', (_e, url) => calendar.setUrl(url));
// only meeting links the calendar itself produced (Meet / Teams / Zoom / Webex, https)
ipcMain.on('open-meeting', (_e, link) => {
  if (calendar.isJoinLink(link)) shell.openExternal(link);
});
ipcMain.handle('loc-search', async (_e, q) => {
  try {
    return await system.searchCity(q);
  } catch {
    return null;
  }
});
ipcMain.on('loc-set', (_e, loc) => system.setLocation(loc));
system.onLocationChange((info) => {
  prayer.refresh();
  prefsWindow.send('location', info);
});
ipcMain.on('general-set', (_e, key, value) => {
  const on = !!value;
  if (key === 'shown') {
    userHidden = !on;
    updateVisibility();
  } else if (key === 'vertical') setVertical(on);
  else if (key === 'startWithWindows') setStartWithWindows(on);
  else if (key === 'resetPosition') resetPosition();
  notifyGeneral();
});
let prayerCalc = `${features.get().asrHanafi}|${features.get().hijriAdjust}`;
let autoUpdate = features.get().autoUpdate;
let newsOn = features.get().news;
features.onChange((f) => {
  appNotices.setEnabled(f.appNotices !== false);
  mediaWrite(f.appNotices !== false ? 'appnotify on' : 'appnotify off');
  evalSaver();
  applyPerf();
  layout();
  updateGhost();
  const calc = `${f.asrHanafi}|${f.hijriAdjust}`;
  if (calc !== prayerCalc) {
    prayerCalc = calc;
    prayer.refresh();
  }
  send('features', islandFeatures());
  prefsWindow.send('features', settingsFeatures());
  downloads.setEnabled(f.downloads);
  downloads.setFolders(f.folderDownloads);
  if (privacy.setEnabled(f.privacyDots)) mediaWrite(`privacy ${f.privacyDots ? 1 : 0}`);
  network.setEnabled(f.netToasts);
  // Glass and solid themes both remain visible in screenshots.
  updateProtection();
  if (f.news !== newsOn) {
    newsOn = f.news;
    news.setEnabled(newsOn);
  }
  if (f.autoUpdate !== autoUpdate) {
    autoUpdate = f.autoUpdate;
    updater.setEnabled(autoUpdate);
  }
  if (!f.clipboardHistory) system.clearClips(true);
  updateVisibility();
});

function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
  if (!img.isEmpty()) return img.resize({ width: 16, height: 16, quality: 'best' });
  // fallback: white pill
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.min(Math.max(x + 0.5, 4), 12);
      const inPill = Math.hypot(x + 0.5 - cx, y + 0.5 - 8) <= 3.2;
      const o = (y * size + x) * 4;
      buf[o] = buf[o + 1] = buf[o + 2] = 255;
      buf[o + 3] = inPill ? 255 : 0;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function buildTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Nova Island');
  tray.on('click', () => tray.popUpContextMenu(appMenu()));
  tray.on('right-click', () => tray.popUpContextMenu(appMenu()));
}

// The installed app replaces a dev setup's Startup-folder shortcut with the system login item.
// Builds from before the rename ("Dynamic Nova") left their own login item and shortcuts.
function migrateStartup() {
  if (STORE) return;
  const startup = path.dirname(startupLink());
  const oldLinks = [path.join(startup, 'Dynamic Nova.lnk'), path.join(app.getPath('desktop'), 'Dynamic Nova.lnk')];
  let wasOn = fs.existsSync(oldLinks[0]);
  for (const f of oldLinks) {
    try { fs.unlinkSync(f); } catch {}
  }
  if (!app.isPackaged) {
    if (wasOn) setStartWithWindows(true);
    return;
  }
  const link = startupLink();
  if (fs.existsSync(link)) {
    wasOn = true;
    try { fs.unlinkSync(link); } catch {}
  }
  // The old login item runs the removed "Dynamic Nova.exe", which Electron can't see once that
  // file is gone, so the first run after the rename removes it blind. An existing data folder
  // means the old build was installed with start-with-Windows on, so the new item takes over.
  const renamed = path.join(app.getPath('userData'), 'renamed');
  if (!fs.existsSync(renamed)) {
    if (fs.existsSync(path.join(app.getPath('userData'), 'settings.json'))) wasOn = true;
    app.setLoginItemSettings({ name: 'electron.app.Dynamic Nova', openAtLogin: false });
    try { fs.writeFileSync(renamed, ''); } catch {}
  }
  if (wasOn) app.setLoginItemSettings({ openAtLogin: true });
}

app.whenReady().then(() => {
  spotify = createSpotify({store:settings, encrypt:value => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows could not securely store your Spotify connection.');
    return safeStorage.encryptString(value);
  }, decrypt:bytes => safeStorage.decryptString(bytes), openExternal:url => shell.openExternal(url),
  onChange:value => { send('spotify',value); prefsWindow.send('spotify',value); }});
  browserMedia.start();
  if (app.isPackaged) browserCompanion.prepare(app.getPath('userData'),scriptPath(path.join('helper','browser-media-host.exe')))
    .catch(err => log.info(`[browser-companion] ${err.code || 'setup unavailable'}`));
  migrateStartup();
  if (process.argv.includes('--setup')) runSetup();
  createWindow();
  appNotices.setEnabled(features.get().appNotices !== false);
  if (app.isPackaged) setTimeout(() => otherNova.check(win).catch((err) => log.info(`[other-nova] ${err.message}`)), 4000);
  buildTray();
  startMedia();
  system.start(send);
  applyPerf(); // saved performance options slow the background work from the start
  prayer.start(send, system.getLocation);
  downloads.start(send, features.get().downloads, features.get().folderDownloads);
  privacy.start(send, features.get().privacyDots);
  network.start(send, features.get().netToasts);
  // Settings hears a ready update too, for its "Update now"
  updater.start((ch, data) => { send(ch, data); prefsWindow.send(ch, data); }, autoUpdate);
  news.start(send, features.get().news);
  plugins.start((ch, data) => {
    if (ch === 'plugins') syncKaiPlugin(data);
    send(ch, data);
    prefsWindow.send(ch, data);
  });
  // waking from sleep or getting the internet back: weather, prayer times and a failed update
  // check catch up at once instead of waiting for their next timer (5 s for Wi-Fi to reconnect)
  let wakeTimer = null;
  const wake = () => {
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => {
      system.refreshNow();
      prayer.retry();
      updater.retrySoon();
      news.retrySoon();
    }, 5000);
  };
  powerMonitor.on('resume', () => {
    refreshPlacement();
    wake();
  });
  // locked: nobody sees the island, so no screen capture (and a slow cursor check) until unlocked
  powerMonitor.on('lock-screen', () => { screenLocked = true; syncAudioMeter(); });
  powerMonitor.on('unlock-screen', () => {
    screenLocked = false;
    syncAudioMeter();
    refreshPlacement();
    lastCaptureKey = '';
    scheduleCapture(300);
  });
  network.onBack(wake);
  calendar.start((ch, data) => {
    send(ch, data);
    prefsWindow.send(ch, data);
  });
  apps.setHelper(mediaWrite);
  apps.init(async () => send('apps', await apps.list()));
  shelf.start(async () => send('shelf', await shelf.list()));
  cursorLoop();
  scheduleCapture(300);
  globalShortcut.register('CommandOrControl+Alt+I', () => {
    if (ghost) {
      ghostOpen = true;
      updateGhost();
    }
    send('toggle');
  });
  screen.on('display-metrics-changed', refreshPlacement);
  screen.on('display-added', refreshPlacement);
  screen.on('display-removed', refreshPlacement);
});

app.on('before-quit', () => {
  quitting = true;
  clearTimeout(switcherHideTimer);
  clearTimeout(placementTimer);
  kaiNotices.setEnabled(false);
  appNotices.setEnabled(false);
  browserMedia.stop();
  spotify?.stop();
  globalShortcut.unregisterAll();
  if (media) media.kill();
});

app.on('window-all-closed', () => app.quit());
