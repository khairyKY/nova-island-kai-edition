#!/usr/bin/env node
// Claude Code hook -> Nova Island notice. Claude Code pipes the hook event as JSON on stdin;
// this sends one notice through the island's app-notice pipe (the endpoint file the island writes
// while app notices are on; Kai's Flow has its own channel). Silent and quick when the island isn't running.
//   Notification hook: "Claude needs you" with Claude's own message
//   Stop hook:         "Claude finished" with the project folder
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

function notice(event) {
  const project = path.basename(event.cwd || '') || 'Claude Code';
  if (event.hook_event_name === 'Stop') {
    return { app: 'claude', label: 'Finished', title: 'Claude finished', body: project };
  }
  const message = String(event.message || 'Claude is waiting for your input').trim();
  return { app: 'claude', label: 'Needs you', title: 'Claude needs you', body: `${message} · ${project}` };
}

function send(n) {
  const file = path.join(process.env.LOCALAPPDATA || '', 'NovaIslandNotices', 'endpoint');
  let endpoint;
  try { endpoint = fs.readFileSync(file, 'utf8').trim(); } catch { return; }
  if (!/^[0-9a-f]{96}$/.test(endpoint)) return;
  const socket = net.connect(`\\\\.\\pipe\\nova-island-notices-${endpoint.slice(0, 48)}`, () => {
    socket.end(JSON.stringify({ token: endpoint.slice(48), ...n, title: n.title.slice(0, 160), body: n.body.slice(0, 360) }));
  });
  socket.setTimeout(1000, () => socket.destroy());
  socket.on('error', () => {});
}

if (require.main === module) {
  if (process.argv[2] === '--test') {
    const n = notice({ hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash', cwd: 'D:\\Coding\\nova-island' });
    console.assert(n.app === 'claude' && n.label === 'Needs you' && n.body === 'Claude needs your permission to use Bash · nova-island', n);
    const d = notice({ hook_event_name: 'Stop', cwd: 'D:\\Coding\\pady' });
    console.assert(d.app === 'claude' && d.label === 'Finished' && d.body === 'pady', d);
    console.log('island-notify ok');
  } else {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { input += c; });
    process.stdin.on('end', () => {
      let event = {};
      try { event = JSON.parse(input || '{}'); } catch {}
      send(notice(event));
    });
  }
}

module.exports = { notice };
