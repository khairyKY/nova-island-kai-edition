// Only known media sites are inspected. Playing tabs are never activated or navigated.
const HOST = 'com.kaisflow.novaisland.media';
const instance = [...crypto.getRandomValues(new Uint8Array(12))].map(b=>b.toString(16).padStart(2,'0')).join('');
const browser = /OPR\//.test(navigator.userAgent) ? 'opera' : /Edg\//.test(navigator.userAgent) ? 'msedge' : /Brave\//.test(navigator.userAgent) ? 'brave' : 'chrome';
const sites = new Set(['youtube.com','www.youtube.com','music.youtube.com','open.spotify.com','music.apple.com','soundcloud.com','www.soundcloud.com','vimeo.com','www.vimeo.com','twitch.tv','www.twitch.tv']);
let port, timer, busy = false, dirty = false;
const recent = new Map();
function connect() {
  if (port) return;
  try {
    port = chrome.runtime.connectNative(HOST);
    port.onMessage.addListener(status => chrome.action.setBadgeText({text:status.connected ? '' : '…'}));
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError; port=null; chrome.action.setBadgeText({text:'…'}); });
  } catch { port = null; }
}
function schedule() { clearTimeout(timer); timer=setTimeout(report,180); }
async function report() {
  if (busy) { dirty=true; return; } busy=true;
  try {
    const tabs = await chrome.tabs.query({});
    const alive = new Set(tabs.map(t=>t.id));
    for (const id of recent.keys()) if (!alive.has(id) || Date.now()-recent.get(id)>180000) recent.delete(id);
    const candidates=tabs.filter(t=>{
      let host; try {host=new URL(t.url).hostname;} catch{return false;}
      if (!sites.has(host) || t.incognito) return false;
      if(t.audible)recent.set(t.id,Date.now());
      return t.audible || recent.has(t.id);
    }).slice(0,12);
    const metadata=await Promise.all(candidates.map(async t=>{
      let title='',artist='';
      try {
        const result=await chrome.scripting.executeScript({target:{tabId:t.id},world:'MAIN',func:()=>{
          const m=navigator.mediaSession?.metadata; return {title:m?.title||'',artist:m?.artist||''};
        }});
        title=String(result[0]?.result?.title||'').slice(0,300);artist=String(result[0]?.result?.artist||'').slice(0,200);
      } catch { }
      return {host:new URL(t.url).hostname,title,artist,pageTitle:String(t.title||'').slice(0,400)};
    }));
    connect();port?.postMessage({browser,instance,tabs:metadata});
  } catch { }
  finally { busy=false; if(dirty){dirty=false;schedule();} }
}
chrome.tabs.onUpdated.addListener((_id,change)=>{if('audible'in change||'title'in change||'url'in change||'status'in change)schedule();});
chrome.tabs.onRemoved.addListener(schedule);
chrome.runtime.onMessage.addListener((message,sender)=>{if(message?.type==='media-changed'&&sender.tab&&!sender.tab.incognito){recent.set(sender.tab.id,Date.now());schedule();}});
chrome.alarms.onAlarm.addListener(report);
chrome.alarms.create('media-heartbeat',{periodInMinutes:0.5});
setInterval(report,15000);
chrome.runtime.onStartup.addListener(report);
chrome.runtime.onInstalled.addListener(report);
report();
