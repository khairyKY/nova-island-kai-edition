const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { siteOf } = require('./media-sources');

function createBrowserBridge(directory, onChange, onError = () => {}) {
  let server, endpoint, reports = new Map();
  const sockets = new Set();
  function snapshot() { return [...reports.values()]; }
  function start() {
    if (server) return;
    const pipe = randomBytes(24).toString('hex'), token = randomBytes(24).toString('hex');
    endpoint = path.join(directory, 'endpoint');
    try { fs.rmSync(endpoint,{force:true}); } catch (err) { onError(err); }
    const listener = net.createServer(socket => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket));
      socket.setTimeout(1500, () => socket.destroy());
      let chunks = [], bytes = 0;
      socket.on('error', () => {});
      socket.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) socket.destroy(); else chunks.push(chunk); });
      socket.on('end', () => {
        if (bytes > 65536) return;
        let value;
        try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return; }
        const data = value?.snapshot;
        if (value?.token !== token || !['opera','chrome','msedge','brave','firefox'].includes(data?.browser) ||
          typeof data.instance !== 'string' || !/^[a-f0-9]{24}$/.test(data.instance) || !Array.isArray(data.tabs)) return;
        const tabs = data.tabs.slice(0, 12).filter(t => siteOf(t?.host)).map(t => ({host:t.host,
          title:String(t.title || '').slice(0,300), artist:String(t.artist || '').slice(0,200), pageTitle:String(t.pageTitle || '').slice(0,400)}));
        reports.set(data.browser + ':' + data.instance, {browser:data.browser, received:Date.now(), tabs});
        for (const [key,r] of reports) if (Date.now() - r.received > 35000) reports.delete(key);
        if (reports.size > 12) reports.delete(reports.keys().next().value);
        onChange();
      });
    });
    server=listener;
    listener.on('error', err => { if (server === listener) { server = null; listener.close(); } onError(err); });
    listener.listen('\\\\.\\pipe\\nova-browser-media-' + pipe, () => {
      if(server!==listener)return;
      try {fs.mkdirSync(directory, {recursive:true}); fs.writeFileSync(endpoint, pipe + token);} catch(err){onError(err);}
    });
  }
  function stop() {
    for (const socket of sockets) socket.destroy();
    server?.close(); server = null; reports.clear();
    if (endpoint) { try { fs.rmSync(endpoint, {force:true}); } catch {} }
  }
  return {start, stop, snapshot};
}
module.exports = { createBrowserBridge };
