// Which parts of the island are on. Edited in the Settings window, applied live by the island.
const settings = require('./settings');
const PHOENIX_STATES = require('./phoenix-states');

const DEFAULTS = {
  // expanded tabs
  tabMedia: true,
  tabApps: true,
  tabShelf: true,
  tabPrayer: true,
  tabTimer: true,
  tabSystem: true,
  appsRunningFirst: true, // Apps tab: the open apps come first
  // idle pill slides
  slideClock: true,
  slideStats: true,
  slidePrayer: true,
  // live activities
  mediaPill: true,
  mediaTitle: true,
  songChange: 'pill', // a new song: 'pill' turns the pill's title to dust and back, 'card' does it in the Now Playing card
  // notifications
  kbdToast: true,
  capsToast: true,
  hudVolume: true,
  hudBrightness: true,
  battery: true,
  prayerAlerts: true,
  asrHanafi: false, // Asr by the Hanafi shadow rule
  hijriAdjust: 0, // days added to the Hijri date (local moon sighting)
  // IDM Nova
  downloads: true,
  dlToasts: true,
  folderDownloads: true, // browser downloads, seen in the download folders
  // window
  hideFullscreen: true,
  autoUpdate: true, // from this edition's own GitHub releases (package.json publish), never the original's
  addrIsland: true, // take the right third of the browser's address bar; off: stay in place, clicks pass through
  islandScale: 100,
  kaiTaskReminders: true,
  kaiFocusDone: true,
  kaiTestNotices: true,
  kaiNoticeStyle: 'card',
  kaiNoticeSeconds: 8,
  softDust: true, // opening and closing: the content turns to dust and reforms (views/soft-dust.js)
  dustStyle: 'soft', // 'soft' drifts into the new layout; 'thanos' disintegrates and blows back in
  dustSpeed: 'normal', // slow / normal / fast
  padyDrops: true, // Pady's notices as a drop under the island (off: none at all)
  appNotices: true, // other apps' notices on the island (Claude Code, through its hooks)
  // performance (the battery saver turns all three on while the battery is low)
  noBlur: false, // solid island, no screen capture at all
  noAnimations: false,
  glassFreeze: true, // refresh the glass on opening and moving, not while it sits closed
  graphics: 'veryHigh', // how it's drawn, memory against smoothness (nova.js, applied on a restart)
  saverShortcut: false, // Ctrl+Alt+B (Pady's 4-finger hold) switches Battery saver now: opt-in, it changes the PC's settings
  saverNow: false, // switched by hand (Settings, the tray, Ctrl+Alt+B, Pady): the island's saver + Windows' Battery saver
  batterySaver: false,
  batterySaverAt: 20, // percent
  news: true, // plugins, updates and news from the Nova team (news.json on GitHub)
  theme: 'kai-fern-day', // falls back to Original when the Kai plugin is off
  // System tab
  clipboardHistory: true,
  // copied image / screenshot -> toast; on the Shelf by itself for a while, or "Add to Shelf"
  screenshotToast: true,
  shotAutoShelf: true,
  shotShelfMinutes: 20,
  // mic / camera in use
  privacyDots: true,
  // companion
  companionStyle: 'phoenix',
  ...Object.fromEntries(PHOENIX_STATES.map(({key}) => [key,true])),
  netToasts: true,
  welcomeBack: true,
  morningBrief: true,
  wellbeing: true,
  smartClipboard: true,
  novaEyes: true,
  novaPrayer: true, // Nova in her prayer cap at the adhan
  novaFocus: true, // Nova with her headband at focus start / end
  water: true, // the Drop reminds you to drink
  waterEvery: 60, // minutes at the computer between glasses
  waterGoal: 8, // glasses a day (~2 L)
  celebrate: true,
  // upcoming meetings (iCal link in calendar.json)
  meetings: true,
  // reminders: dhikr, du'a, Qur'an
  reminders: true,
  remindAyah: true,
  remindDhikr: true,
  remindDua: true,
  remindEvery: 5, // minutes
  remindFor: 30, // seconds on screen
  // quiet hours for reminders (minutes after midnight; may wrap past midnight)
  quietHours: false,
  quietFrom: 23 * 60,
  quietTo: 7 * 60,
  // focus sessions (Pomodoro)
  focusMin: 25,
  breakMin: 5,
  longBreakMin: 15,
};

// number settings and their allowed range
const RANGES = {
  remindEvery: [1, 240], remindFor: [5, 300], quietFrom: [0, 1439], quietTo: [0, 1439],
  focusMin: [5, 120], breakMin: [1, 60], longBreakMin: [5, 60], hijriAdjust: [-2, 2], waterEvery: [15, 240], waterGoal: [4, 16], shotShelfMinutes: [5, 1440],
  batterySaverAt: [10, 100],
  islandScale: [80, 200],
  kaiNoticeSeconds: [3, 30],
};

// settings that are one of a fixed list
const CHOICES = {
  companionStyle: ['phoenix', 'zaher-seated', 'zaher-standing', 'classic', 'none'],
  kaiNoticeStyle: ['card', 'compact'],
  dustStyle: ['soft', 'thanos'],
  dustSpeed: ['slow', 'normal', 'fast'],
  songChange: ['pill', 'card'],
  graphics: ['low', 'medium', 'high', 'veryHigh'],
  theme: ['kai-day', 'kai-night', 'kai-fern-day', 'kai-fern-night', 'original', 'bakka', 'outline', 'midnight', 'forest', 'snow', 'cat', 'galaxy', 'aurora', 'ocean', 'nody', 'lava', 'retro'],
};
// themes without glass: no screen capture behind them
const SOLID_THEMES = ['kai-day', 'kai-fern-day', 'bakka', 'midnight', 'forest', 'cat', 'galaxy', 'aurora', 'ocean', 'nody', 'lava', 'retro'];

const saved = settings.load('features.json', {});
// the second companion was renamed from Sherman to Zaher
if (typeof saved?.companionStyle === 'string') saved.companionStyle = saved.companionStyle.replace(/^sherman-/, 'zaher-');
const newerSettings = Object.fromEntries(Object.entries(saved || {}).filter(([key]) => !Object.hasOwn(DEFAULTS, key)));
let values = { ...DEFAULTS, ...pick(saved) };
const listeners = [];

// keep only known keys with values of the right type (numbers clamped to their range)
function pick(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (!Object.hasOwn(DEFAULTS, k)) continue;
    if (CHOICES[k]) {
      if (CHOICES[k].includes(v)) out[k] = v;
    } else if (RANGES[k]) {
      if (Number.isFinite(v)) out[k] = Math.min(Math.max(Math.round(v), RANGES[k][0]), RANGES[k][1]);
    } else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

function get() {
  return { ...values };
}

function set(patch) {
  const clean = pick(patch);
  if (!Object.keys(clean).length) return values;
  values = { ...values, ...clean };
  settings.save('features.json', { ...newerSettings, ...values });
  listeners.forEach((fn) => fn(get()));
  return get();
}

function reset() {
  values = { ...DEFAULTS };
  settings.save('features.json', { ...newerSettings, ...values });
  listeners.forEach((fn) => fn(get()));
}

const onChange = (fn) => listeners.push(fn);

module.exports = { get, set, reset, onChange, DEFAULTS, SOLID_THEMES };
