// Microphone / camera in use, like the privacy dots on a Mac or iPhone. Windows records every
// app's access under CapabilityAccessManager\ConsentStore; an app is using the device right now
// when its LastUsedTimeStop is 0. The existing system helper reads it in-process.

const NAMES = {
  chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi',
  teams: 'Teams', 'ms-teams': 'Teams', zoom: 'Zoom', discord: 'Discord', slack: 'Slack', skype: 'Skype',
  obs64: 'OBS', obs: 'OBS', telegram: 'Telegram', whatsapp: 'WhatsApp', windowscamera: 'Camera',
  windowssoundrecorder: 'Sound Recorder', soundrec: 'Sound Recorder', electron: 'Electron',
  screensketch: 'Snipping Tool', 'loom-recorder-production': 'Loom', rundll32: 'Windows',
  immersivecontrolpanel: 'Settings', 'adobe audition cc': 'Adobe Audition',
};

let send = () => {};
let enabled = true;
let last = '';

// "C:#Program Files#Google#Chrome#Application#chrome.exe" or "Microsoft.WindowsCamera_8wekyb3d8bbwe"
function appName(key) {
  const leaf = key.split('\\').pop();
  const raw = leaf.includes('#')
    ? leaf.split('#').pop().replace(/\.exe$/i, '')
    : leaf.split('_')[0].split('.').pop();
  return NAMES[raw.toLowerCase()] || raw.charAt(0).toUpperCase() + raw.slice(1);
}

function onHelper({mic, cam}) {
  if (!enabled || !Array.isArray(mic) || !Array.isArray(cam)) return;
  const names = keys => [...new Set(keys.filter(key => typeof key === 'string').map(appName))].sort();
  const state = { mic: names(mic), cam: names(cam) };
  const key = JSON.stringify(state);
  if (key !== last) {
    last = key;
    send('privacy', state);
  }
}

function setEnabled(on) {
  if (on === enabled) return false;
  enabled = on;
  last = '';
  if (!on) send('privacy', { mic: [], cam: [] });
  return true;
}

function start(sender, on = true) {
  send = sender;
  enabled = on;
}

module.exports = { start, setEnabled, onHelper };
