// Kai's Flow reads this per-user endpoint only when it already has a Windows toast to show.
// The random pipe name lives on disk; the notice itself stays in memory.
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const NOTICE_KINDS = ['task_reminder', 'focus_done', 'test', 'morning_digest', 'evening_nudge', 'overdue'];
function noticeKind(notice) {
  if (NOTICE_KINDS.includes(notice.kind)) return notice.kind;
  if (/^\d+ minutes tended ✿$/.test(notice.title)) return 'focus_done';
  if (notice.body.startsWith('Test notification')) return 'test';
  if (/^Good morning(?: —|$)/.test(notice.title)) return 'morning_digest';
  if (notice.title === 'The garden’s ready to close') return 'evening_nudge';
  if (notice.title === 'Overdue') return 'overdue';
  // The installed desktop sender predates typed payloads; its remaining local alerts are reminders.
  return 'task_reminder';
}

const kaiNotice = (n) => ({ kind: noticeKind(n), title: n.title.slice(0, 160), body: n.body.slice(0, 360) });

// Other apps' notices (Claude Code hooks): own pipe and endpoint, never styled as Kai's Flow.
const APP_ID = /^[a-z][a-z0-9-]{0,23}$/;
const appNotice = (n) => (typeof n.app === 'string' && APP_ID.test(n.app)
  ? { app: n.app, label: typeof n.label === 'string' ? n.label.slice(0, 24) : '', title: n.title.slice(0, 160), body: n.body.slice(0, 360) }
  : null);

function createNoticeBridge(directory, onNotice, onError, { prefix = 'kais-flow-island-', normalize = kaiNotice } = {}) {
  const endpoint = path.join(directory, 'endpoint');
  let server = null;
  let current = '';
  // Another island (the original Nova Island, starting at login) writes the same file. If it
  // replaced ours, put ours back: otherwise notices go to a pipe that no longer exists.
  function reclaim() {
    if (!server || !current) return;
    let onDisk = '';
    try { onDisk = fs.readFileSync(endpoint, 'utf8'); } catch {}
    if (onDisk === current) return;
    try { fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(endpoint, current); } catch (err) { onError(err); }
  }

  function setEnabled(on) {
    if (!!server === on) return;
    if (!on) {
      const previous = server;
      server = null;
      current = '';
      fs.unwatchFile(endpoint, reclaim);
      try { fs.rmSync(endpoint, { force: true }); } catch (err) { onError(err); }
      previous.close();
      return;
    }

    const pipeId = randomBytes(24).toString('hex');
    const token = randomBytes(24).toString('hex');
    const listener = net.createServer((socket) => {
      const chunks = [];
      let bytes = 0;
      socket.setTimeout(1000, () => socket.destroy());
      socket.on('error', () => {});
      socket.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 8192) socket.destroy();
        else chunks.push(chunk);
      });
      socket.on('end', () => {
        if (server !== listener || bytes > 8192) return;
        let notice;
        try { notice = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return; }
        if (notice?.token !== token || typeof notice.title !== 'string' || !notice.title.trim() || typeof notice.body !== 'string') return;
        const clean = normalize(notice);
        if (clean) onNotice(clean);
      });
    });
    server = listener;
    listener.on('error', (err) => {
      if (server === listener) setEnabled(false);
      onError(err);
    });
    listener.listen('\\\\.\\pipe\\' + prefix + pipeId, () => {
      if (server !== listener) return;
      try {
        fs.mkdirSync(directory, { recursive: true });
        current = pipeId + token;
        fs.writeFileSync(endpoint, current);
        fs.watchFile(endpoint, { interval: 5000 }, reclaim);
      } catch (err) {
        setEnabled(false);
        onError(err);
      }
    });
  }
  return { setEnabled };
}

module.exports = { createNoticeBridge, noticeKind, appNotice };
