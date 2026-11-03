import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export default function offlinePlugin(){
  return {name:'worldos-offline-assets',apply:'build',generateBundle(_,bundle){
    const assets=['/','/index.html','/offline.html','/manifest.webmanifest','/desk-preview.webp','/room-sample.webp','/sample-desk.svg',
      '/icons/icon-192.png','/icons/icon-512.png','/icons/apple-touch-icon.png','/icons/maskable-512.png','/icons/icon.svg',
      ...Object.keys(bundle).filter(name=>/\.(js|css|woff2?|png|webp|svg)$/.test(name)).map(name=>'/'+name)].sort();
    const worker=readFileSync('public/sw.js','utf8');
    const hash=createHash('sha256').update(worker+JSON.stringify(assets)).update(readFileSync('index.html'));
    for(const asset of assets)if(!['/','/index.html'].includes(asset)&&!bundle[asset.slice(1)])hash.update(readFileSync('public'+asset));
    const version=hash.digest('hex').slice(0,16);
    this.emitFile({type:'asset',fileName:'sw.js',source:`self.__WORLDOS_BUILD__=${JSON.stringify({version,assets})};\n${worker}`});
  }};
}
