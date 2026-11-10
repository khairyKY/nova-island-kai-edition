// Preserve the supplied artwork; prepare smaller transparent copies for the island.
// The copies are cropped to the figure (shared box per canvas size, so poses don't jump when
// they swap), so a sprite box shows the character instead of its transparent margin.
const {app,nativeImage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const states=require('../phoenix-states');
app.setPath('userData',path.join(app.getPath('temp'),'nova-phoenix-prep'));
app.disableHardwareAcceleration();

// smallest box holding every non-transparent pixel of all the images (same size canvases)
function sharedBox(images){
  const {width,height}=images[0].getSize();
  let l=width,t=height,r=-1,b=-1;
  for(const image of images){
    const px=image.toBitmap();
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      if(px[(y*width+x)*4+3]<8)continue;
      if(x<l)l=x;if(x>r)r=x;if(y<t)t=y;if(y>b)b=y;
    }
  }
  const pad=4;
  l=Math.max(0,l-pad);t=Math.max(0,t-pad);r=Math.min(width-1,r+pad);b=Math.min(height-1,b+pad);
  return {x:l,y:t,width:r-l+1,height:b-t+1};
}

app.whenReady().then(()=>{
  const zaher = process.argv.includes('--zaher');
  const directory=path.join(__dirname,zaher ? '../assets/zaher-v1' : '../assets/phoenix-v1');
  const ids = states.map(state => state.id);
  if (zaher) ids.push('idle-standing');
  fs.mkdirSync(path.join(directory,'ui'),{recursive:true});
  const images=new Map(ids.map(id=>{
    const image=nativeImage.createFromPath(path.join(directory,id+'.png'));
    if(image.isEmpty())throw new Error('Missing companion artwork: '+id);
    return [id,image.resize({width:384,quality:'best'})];
  }));
  const groups=new Map();
  for(const [id,image] of images){
    const {width,height}=image.getSize();
    const key=`${width}x${height}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(id);
  }
  for(const group of groups.values()){
    const box=sharedBox(group.map(id=>images.get(id)));
    for(const id of group)fs.writeFileSync(path.join(directory,'ui',id+'.png'),images.get(id).crop(box).toPNG());
  }
  console.log(`Prepared ${ids.length} ${zaher ? 'Zaher' : 'phoenix'} poses. Original artwork preserved.`);
  app.exit(0);
}).catch(error=>{console.error(error.message);app.exit(1);});
