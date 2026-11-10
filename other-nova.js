// The original Nova Island on the same PC: both islands would sit at the top of the screen and
// answer Ctrl + Alt + I. Asked once. "Turn it off" closes it and takes it out of startup (it stays
// installed); after that it is closed quietly whenever this edition starts and finds it running.
// This edition's own exe is "Nova Island Kai Edition.exe", so the exact image name never hits us.
const { dialog } = require('electron');
const { execFile } = require('child_process');
const settings = require('./settings');

const EXE = 'Nova Island.exe';
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

const run = (cmd, args) => new Promise((done) =>
  execFile(cmd, args, { windowsHide: true }, (err, out) => done(err ? '' : String(out))));

async function isRunning() {
  const out = await run('tasklist', ['/FI', `IMAGENAME eq ${EXE}`, '/FO', 'CSV', '/NH']);
  return out.toLowerCase().includes(`"${EXE.toLowerCase()}"`);
}

// startup entries (value names) that launch the original's exe
function parseRunKey(out) {
  return out.split(/\r?\n/)
    .map((line) => line.match(/^\s{4}(.+?)\s{4}REG_(?:EXPAND_)?SZ\s{4}(.*)$/))
    .filter((m) => m && /\\Nova Island\.exe"?(\s|$)/i.test(m[2]))
    .map((m) => m[1]);
}

async function turnOff(entries) {
  await run('taskkill', ['/F', '/IM', EXE]);
  for (const name of entries) await run('reg', ['delete', RUN_KEY, '/v', name, '/f']);
}

// owner: the island's always-on-top window, so the question opens above full-screen apps
async function check(owner) {
  const { choice } = settings.load('other-nova.json', {}) || {};
  if (choice === 'keep') return;
  const [running, entries] = await Promise.all([isRunning(), run('reg', ['query', RUN_KEY]).then(parseRunKey)]);
  if (!running && !entries.length) return;
  if (choice === 'off') return turnOff(entries);
  const { response } = await dialog.showMessageBox(owner, {
    type: 'question',
    title: 'Nova Island Kai Edition',
    message: 'The original Nova Island is also on this PC',
    detail: 'Both islands would sit at the top of your screen and answer Ctrl + Alt + I.\n\n' +
      'Turn off the original? It is closed and removed from startup, not uninstalled. You can ' +
      'still open it from the Start menu or uninstall it from Settings > Apps.',
    buttons: ['Turn it off', 'Keep both'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  const off = response === 0;
  settings.save('other-nova.json', { choice: off ? 'off' : 'keep' });
  if (off) await turnOff(entries);
}

module.exports = { check, parseRunKey };

if (require.main === module) {
  const sample = [
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    '    electron.app.Nova Island    REG_SZ    "C:\\Users\\x\\AppData\\Local\\Programs\\Nova Island\\Nova Island.exe"',
    '    Kai Edition    REG_SZ    "D:\\Apps\\Nova Island Kai Edition\\Nova Island Kai Edition.exe"',
    '    Discord    REG_SZ    "C:\\Discord\\Update.exe" --processStart Discord.exe',
    '    Bare    REG_EXPAND_SZ    D:\\Installations\\Nova Island\\Nova Island.exe --hidden',
  ].join('\r\n');
  const names = parseRunKey(sample);
  console.assert(names.length === 2 && names[0] === 'electron.app.Nova Island' && names[1] === 'Bare', names);
  console.log('other-nova ok', names);
}
