// Spotify enriches the selected Windows session. Audio and transport stay local and responsive.
const http = require('node:http');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { norm } = require('./media-sources');
const REDIRECT = 'http://127.0.0.1:8989/login';
const CALLBACK = new URL(REDIRECT);
const SCOPES = 'user-read-currently-playing user-library-read user-library-modify';

function createSpotify({store, encrypt, decrypt, openExternal, onChange = () => {}, request = globalThis.fetch}) {
  const saved = store.load('spotify.json', {});
  let clientId = /^[a-f0-9]{32}$/i.test(saved.clientId || '') ? saved.clientId : '';
  let tokens = null, generation = 0, refreshPromise = null, authServer = null, authTimer = null;
  let current = null, key = '', seq = 0, timer = null, checking = null, cooldown = 0, stopped = false;
  let track = null, pending = false, error = '', lookupError = '', connecting = false, libraryVersion = 0;
  const cache = new Map();
  const writes = new Set();
  try { if (saved.secret) tokens = JSON.parse(decrypt(Buffer.from(saved.secret, 'base64'))); } catch { }
  function snapshot() { return {clientId, configured:!!clientId, connected:!!tokens?.refresh_token,
    connecting, track:track ? {...track} : null, pending, resolving:!!checking, error, lookupError, redirect:REDIRECT}; }
  function emit() { onChange(snapshot()); }
  function persist() {
    store.save('spotify.json', {clientId, secret:tokens ? encrypt(JSON.stringify(tokens)).toString('base64') : ''});
  }
  async function fetchTimed(url, options) {
    const {signal, timeoutMs = 12000, ...rest} = options;
    const timeout = AbortSignal.timeout(timeoutMs);
    try { return await request(url, {...rest, signal:signal ? AbortSignal.any([signal, timeout]) : timeout}); }
    catch { throw new Error('Spotify is unavailable. Try again when you’re online.'); }
  }
  async function exchange(params, epoch) {
    const res = await fetchTimed('https://accounts.spotify.com/api/token', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams(params).toString()});
    if (!res.ok) throw new Error(res.status === 400 || res.status === 401 ? 'Connect Spotify again to continue.' : 'Spotify sign-in is unavailable. Try again.');
    const data = await res.json();
    if (epoch !== generation || stopped) throw new Error('Spotify connection was cancelled.');
    if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in)) throw new Error('Spotify returned an incomplete connection.');
    const next = {...tokens, ...data, expires:Date.now() + data.expires_in * 1000};
    // Windows encrypts the saved session. Never fall back to a plaintext refresh token.
    const secret = encrypt(JSON.stringify(next)).toString('base64');
    tokens = next; store.save('spotify.json', {clientId, secret});
    return next.access_token;
  }
  async function access() {
    if (!tokens?.refresh_token) throw new Error('Connect Spotify in Settings to save songs.');
    if (tokens.expires > Date.now() + 30000) return tokens.access_token;
    if (!refreshPromise) {
      const promise = exchange({grant_type:'refresh_token', refresh_token:tokens.refresh_token, client_id:clientId}, generation).finally(()=>{if(refreshPromise===promise)refreshPromise=null;});
      refreshPromise=promise;
    }
    return refreshPromise;
  }
  async function api(route, method = 'GET', retry = true, signal) {
    if (Date.now() < cooldown) throw new Error('Spotify is busy. Please try again shortly.');
    const epoch = generation, token = await access();
    if (epoch !== generation || signal?.aborted) throw new Error('Spotify connection was cancelled.');
    const res = await fetchTimed('https://api.spotify.com/v1/' + route, {method, headers:{Authorization:'Bearer ' + token}, signal, timeoutMs:signal ? 4500 : 12000});
    if (epoch !== generation) throw new Error('Spotify connection was cancelled.');
    if (res.status === 401 && retry) { tokens.expires=0; return api(route, method, false, signal); }
    if (res.status === 429) {
      cooldown=Date.now() + Math.min(3600,Math.max(1,Number(res.headers.get('Retry-After'))||60))*1000;
      throw new Error('Spotify is busy. Please try again shortly.');
    }
    if (!res.ok) throw new Error(res.status === 403 ? 'Spotify denied this action. Check your app access and reconnect in Settings.' : res.status === 401 ? 'Connect Spotify again in Settings.' : 'Couldn’t reach Spotify. Try again.');
    if (res.status === 204) return null;
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch { throw new Error('Spotify returned an incomplete response. Try again.'); }
  }
  function cancelAuth() { clearTimeout(authTimer); authServer?.close(); authServer=null; connecting=false; }
  function configure(value) {
    if (!/^[a-f0-9]{32}$/i.test(String(value || ''))) return {ok:false,error:'Enter the 32-character Spotify Client ID.'};
    if (clientId !== value) { disconnect(); clientId=value; persist(); emit(); }
    return {ok:true};
  }
  function disconnect() {
    generation++; seq++; cancelAuth(); clearTimeout(timer); tokens=null; refreshPromise=null;
    checking?.controller.abort();checking=null;cache.clear();
    track=null; pending=false; error='';lookupError=''; persist(); emit();
  }
  async function connect(value) {
    if (value !== undefined) { const result=configure(value); if(!result.ok)return result; }
    if (!clientId) return {ok:false,error:'Add your Spotify Client ID in Settings first.'};
    cancelAuth(); generation++; const epoch=generation;
    const state=randomBytes(24).toString('hex'), verifier=randomBytes(48).toString('base64url');
    connecting=true; error=''; emit();
    let callbackUsed=false;
    const server=http.createServer(async(req,res)=>{
      const url=new URL(req.url,REDIRECT);
      if(req.headers.host!==CALLBACK.host||url.pathname!==CALLBACK.pathname){res.writeHead(404);res.end();return;}
      const provided=url.searchParams.get('state')||'';
      const bytes=Buffer.from(provided);
      if(bytes.length!==Buffer.byteLength(state) || !timingSafeEqual(bytes,Buffer.from(state))){res.writeHead(400);res.end('Invalid sign-in state.');return;}
      res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Cache-Control','no-store');
      if(epoch!==generation){res.writeHead(400);res.end('This sign-in has expired.');return;}
      if(callbackUsed){res.writeHead(400);res.end('This sign-in has already been used.');return;}
      callbackUsed=true;
      if(url.searchParams.get('error') || !url.searchParams.get('code')){
        error='Spotify sign-in was cancelled.';res.end(error);cancelAuth();emit();return;
      }
      // Accept only one valid callback, including while the token request is in flight.
      server.close();authServer=null;
      try {
        await exchange({grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:REDIRECT,client_id:clientId,code_verifier:verifier},epoch);
        res.end('Spotify is connected. You can close this tab and return to Nova Island.');error='';
      }catch(err){res.end('Could not connect Spotify. Return to Nova Settings and try again.');if(epoch===generation)error=err.message;}
      finally{if(epoch===generation){cancelAuth();emit();observe(current,true);}}
    });
    authServer=server;
    try {
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(CALLBACK.port),CALLBACK.hostname,resolve);});
      const url=new URL('https://accounts.spotify.com/authorize');
      url.search=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:REDIRECT,state,code_challenge_method:'S256',
        code_challenge:createHash('sha256').update(verifier).digest('base64url'),scope:SCOPES}).toString();
      authTimer=setTimeout(()=>{if(epoch===generation){cancelAuth();error='Sign-in timed out. Try connecting again.';emit();}},180000);
      await openExternal(url.toString());return {ok:true};
    }catch{cancelAuth();error='Couldn’t open Spotify sign-in. Close any other sign-in and try again.';emit();return {ok:false,error};}
  }
  function observe(media, force = false) {
    if (stopped) return;
    current=media;
    const next=media?.has && media.source?.id==='spotify' ? `${norm(media.title)}|${norm(media.artist)}|${norm(media.album)}|${Math.round(media.dur || 0)}|${media.app}` : '';
    if(next===key && !force)return;
    checking?.controller.abort();checking=null;
    key=next;seq++; clearTimeout(timer);pending=false;error='';lookupError='';
    const known=cache.get(key);
    track=known && Date.now()-known.at<30*60*1000 ? {...known.track} : null;
    pending=!!track && writes.has(track.id);
    emit();
    if(key && tokens?.refresh_token) schedule(seq,0);
  }
  function schedule(version, ms, attempt = 0) {
    clearTimeout(timer);
    timer=setTimeout(()=>check(version,attempt),Math.max(ms,cooldown-Date.now()));
  }
  function remember(songKey, value) {
    cache.delete(songKey);cache.set(songKey,{track:{...value},at:Date.now()});
    if(cache.size>64)cache.delete(cache.keys().next().value);
  }
  function matches(item, media) {
    if(item?.type!=='track' || !/^[a-zA-Z0-9]{22}$/.test(item.id) || norm(item.name)!==norm(media.title))return false;
    if(media.dur>0 && item.duration_ms>0 && Math.abs(item.duration_ms/1000-media.dur)>3)return false;
    const credits=value=>norm(String(value||'').replace(/\b(?:feat(?:uring)?|ft)\.?\s/gi,' '));
    const artist=credits(media.artist);
    return !artist || item.artists?.some(a=>credits(a.name)===artist) || credits(item.artists?.map(a=>a.name).join(', '))===artist;
  }
  async function check(version, attempt = 0) {
    if(stopped || !key || version!==seq || !tokens?.refresh_token)return;
    if(checking || writes.has(track?.id)){schedule(version,300,attempt);return;}
    const job={controller:new AbortController()};
    checking=job;emit();
    const library = libraryVersion;
    try {
      let id=track?.id;
      if(!id){
        const playback=await api('me/player/currently-playing','GET',true,job.controller.signal);
        if(version!==seq)return;
        if(!matches(playback?.item,current)){
          // Windows already supplies playback. Cloud lag, ads and other devices stay quiet.
          schedule(version,attempt<3 ? [300,800,1800][attempt] : 10000,attempt<3 ? attempt+1 : 0);
          return;
        }
        id=playback.item.id;
      }
      const liked=await api('me/library/contains?uris='+encodeURIComponent('spotify:track:'+id),'GET',true,job.controller.signal);
      if(version!==seq)return;
      if(library!==libraryVersion){schedule(version,30000);return;}
      if(!Array.isArray(liked)||typeof liked[0]!=='boolean')throw new Error('Spotify could not read this song’s saved state.');
      track={id,liked:liked[0]};remember(key,track);lookupError='';
      // No periodic recheck: track change and setLiked are the only triggers.
    }catch(err){if(version===seq&&!job.controller.signal.aborted){lookupError=err.message;schedule(version,30000);}}
    finally{if(checking===job)checking=null;if(version===seq)emit();}
  }
  async function setLiked(id, liked) {
    if(typeof liked!=='boolean'||!track||id!==track.id||writes.has(id))return {ok:false,error:'Song saving is unavailable for this track.'};
    const epoch=generation, songKey=key, previous=track.liked;
    checking?.controller.abort();checking=null;clearTimeout(timer);
    writes.add(id);libraryVersion++;track.liked=liked;pending=true;error='';emit();
    try {
      await api('me/library?uris='+encodeURIComponent('spotify:track:'+id),liked?'PUT':'DELETE');
      if(epoch===generation){
        for(const entry of cache.values())if(entry.track.id===id)entry.track.liked=liked;
        remember(songKey,{id,liked});
        if(track?.id===id){track.liked=liked;error='';lookupError='';}
      }
      return {ok:true};
    }catch(err){if(epoch===generation&&track?.id===id){track.liked=previous;error=err.message;}return {ok:false,error:err.message};}
    finally{writes.delete(id);if(epoch===generation&&track?.id===id){pending=false;emit();schedule(seq,30000);}}
  }
  function stop(){stopped=true;generation++;seq++;cancelAuth();clearTimeout(timer);checking?.controller.abort();checking=null;}
  return {snapshot,configure,connect,disconnect,observe,setLiked,stop};
}
module.exports={createSpotify,REDIRECT};
