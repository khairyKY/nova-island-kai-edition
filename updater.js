// Updates from the GitHub releases (latest.yml): checked a minute after start and every 6 hours,
// downloaded in the background, then offered on the island ("Update ready · Restart"). An
// update that is never accepted is installed when the app quits. Only the installed app updates.
const { app } = require('electron');
const log = require('./log');
// This personal build has local code and a local plugin trust key. A stock installer replaces both.
const LOCAL_BUILD = require('./package.json').novaLocalBuild === true;

const FIRST_CHECK_MS = 60 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;

let updater = null;
let enabled = false;
let ready = null; // version downloaded and waiting for a restart
let timer = null;
let send = () => {};
let checkFailed = false; // the last check didn't get through: try again when the PC wakes or goes online

// One short line per kind of failure, at most once a day; none while offline. (electron-updater
// puts the whole HTTP response with its headers in the message, and reports a failed check twice.)
const OFFLINE = /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION|ERR_TIMED_OUT|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN/;
const logged = new Map(); // short message -> when
function logError(what, err) {
  checkFailed = true;
  const msg = String(err?.message || err);
  if (OFFLINE.test(msg)) return;
  const status = msg.match(/HttpError: (\d{3})/)?.[1];
  const short = status ? `HTTP ${status}${/latest\.yml/.test(msg) ? ' (latest.yml not found)' : ''}` : msg.split('\n')[0].slice(0, 160);
  const key = `${what}: ${short}`;
  if (Date.now() - (logged.get(key) || 0) < 24 * 60 * 60 * 1000) return;
  logged.set(key, Date.now());
  log.info(`update ${key}`);
}

function check() {
  if (!enabled || !updater) return;
  // a ready update is offered again on every check until it is installed
  if (ready) {
    send('update', { version: ready });
    return;
  }
  checkFailed = false;
  updater.checkForUpdates().catch((err) => logError('check failed', err));
}

// after sleep or a lost connection: a check that failed is tried again a minute later
function retrySoon() {
  if (enabled && updater && checkFailed) setTimeout(check, 60 * 1000);
}

function start(sendFn, on) {
  send = sendFn;
  if (LOCAL_BUILD) { log.info('stock updates disabled for personal Kai build'); return; }
  // the Microsoft Store version is updated by the Store
  if (!app.isPackaged || process.windowsStore) return;
  ({ autoUpdater: updater } = require('electron-updater'));
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;
  updater.on('update-available', (i) => log.info(`update ${i.version} available, downloading`));
  updater.on('update-downloaded', (i) => {
    ready = i.version;
    log.info(`update ${i.version} ready`);
    send('update', { version: ready });
  });
  // a failed check is also reported here: logError keeps it to one line
  updater.on('error', (err) => logError('check failed', err));
  setEnabled(on);
}

function setEnabled(on) {
  enabled = !LOCAL_BUILD && !!on;
  if (updater) updater.autoInstallOnAppQuit = enabled;
  clearTimeout(timer);
  clearInterval(timer);
  if (!enabled || !updater) return;
  timer = setTimeout(() => {
    check();
    timer = setInterval(check, EVERY_MS);
  }, FIRST_CHECK_MS);
}

// restart into the downloaded version (silent install, then the app starts again)
function install() {
  if (LOCAL_BUILD || !ready || !updater) return;
  log.info(`update ${ready} installing, will reopen`);
  updater.quitAndInstall(true, true);
}

module.exports = { start, setEnabled, install, retrySoon };
