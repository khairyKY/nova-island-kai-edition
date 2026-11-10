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

function createNoticeBridge(directory, onNotice, onError) {
  const endpoint = path.join(directory, 'endpoint');
  let server = null;

  function setEnabled(on) {
    if (!!server === on) return;
    if (!on) {
      const previous = server;
      server = null;
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
        onNotice({ kind: noticeKind(notice), title: notice.title.slice(0, 160), body: notice.body.slice(0, 360) });
      });
    });
    server = listener;
    listener.on('error', (err) => {
      if (server === listener) setEnabled(false);
      onError(err);
    });
    listener.listen('\\\\.\\pipe\\kais-flow-island-' + pipeId, () => {
      if (server !== listener) return;
      try {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(endpoint, pipeId + token);
      } catch (err) {
        setEnabled(false);
        onError(err);
      }
    });
  }
  return { setEnabled };
}

module.exports = { createNoticeBridge, noticeKind };
