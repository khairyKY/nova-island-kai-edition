// The Settings window: a normal, focusable window (the island itself never takes focus).
const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');

let win = null;

// page: open the window on that page (a news link, "Get plugin")
function open(page) {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (page) send('show-page', page);
    return;
  }
  win = new BrowserWindow({
    width: 760,
    height: 560,
    minWidth: 640,
    minHeight: 480,
    frame: false,
    show: false,
    backgroundColor: '#0f0f15',
    title: 'Nova Island Settings',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'prefs', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'prefs', 'index.html'));
  win.once('ready-to-show', () => {
    win.show();
    if (page) send('show-page', page);
  });
  win.on('closed', () => { win = null; });
}

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

ipcMain.on('prefs-window', (e, action) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || w !== win) return;
  if (action === 'close') w.close();
  else if (action === 'minimize') w.minimize();
});

module.exports = { open, send, owns: contents => !!win && !win.isDestroyed() && win.webContents === contents };
