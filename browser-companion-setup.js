const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
async function prepare(directory, helperPath) {
  const extension = path.join(directory, 'browser-companion');
  fs.mkdirSync(extension, {recursive:true});
  for (const file of ['manifest.json','worker.js','media.js','README.md']) {
    const data = fs.readFileSync(path.join(__dirname,'browser-companion',file));
    const dest = path.join(extension,file);
    if (!fs.existsSync(dest) || !fs.readFileSync(dest).equals(data)) fs.writeFileSync(dest,data);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));
  const id = [...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)]
    .map(b=>String.fromCharCode(97+(b>>4))+String.fromCharCode(97+(b&15))).join('');
  const native = path.join(directory,'browser-media-host.json');
  const host = JSON.stringify({name:'com.kaisflow.novaisland.media',description:'Nova Island media source bridge',path:helperPath,
    type:'stdio',allowed_origins:[`chrome-extension://${id}/`]},null,2);
  // Marker = hash of the host manifest last registered; unchanged -> skip the write and the 3 reg.exe spawns.
  const marker = path.join(directory,'browser-media-host.registered'), hash = createHash('sha256').update(host).digest('hex');
  const read = file => { try { return fs.readFileSync(file,'utf8'); } catch { return ''; } };
  if (read(marker)===hash && read(native)===host) return {extension,id};
  fs.writeFileSync(native,host);
  if (process.platform==='win32') {
    await Promise.all(['Google\\Chrome','Microsoft\\Edge','Chromium'].map(browser=>run('reg.exe',[
      'add',`HKCU\\Software\\${browser}\\NativeMessagingHosts\\com.kaisflow.novaisland.media`,'/ve','/t','REG_SZ','/d',native,'/f',
    ],{windowsHide:true,timeout:5000})));
  }
  fs.writeFileSync(marker,hash);
  return {extension,id};
}
module.exports={prepare};
