let timer;
function changed() { clearTimeout(timer); timer=setTimeout(()=>chrome.runtime.sendMessage({type:'media-changed'}).catch(()=>{}),120); }
for (const type of ['play','pause','loadedmetadata','emptied']) document.addEventListener(type,changed,true);
