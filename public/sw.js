/* Only public build assets are cached. API responses and user photos are excluded. */
const BUILD=self.__WORLDOS_BUILD__||{version:'fallback',assets:['/offline.html','/icons/icon-192.png','/icons/icon-512.png']};
const CACHE='worldos-app-'+BUILD.version;
const ASSETS=new Set(BUILD.assets);
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(BUILD.assets)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  // Keep the preceding build for lazy chunks in already-open pages.
  event.waitUntil(caches.keys().then(keys=>{
    const older=keys.filter(key=>key.startsWith('worldos-app-')&&key!==CACHE);
    return Promise.all(keys.filter(key=>key.startsWith('worldos-offline-')||older.slice(0,-1).includes(key)).map(key=>caches.delete(key)));
  }).then(()=>self.clients.claim()));
});
self.addEventListener('message',event=>{
  if(event.data?.type==='ACTIVATE_UPDATE')event.waitUntil(self.skipWaiting());
  if(event.data?.type==='OFFLINE_STATUS')event.waitUntil((async()=>{
    try{const cache=await caches.open(CACHE);const present=await Promise.all(BUILD.assets.map(path=>cache.match(path)));event.ports?.[0]?.postMessage({ready:ASSETS.has('/')&&present.every(Boolean),version:BUILD.version});}
    catch{event.ports?.[0]?.postMessage({ready:false});}
  })());
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.search)return;
  const navigation=event.request.mode==='navigate'&&['/','/index.html'].includes(url.pathname);
  if(!navigation&&!ASSETS.has(url.pathname)&&!url.pathname.startsWith('/assets/'))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(navigation){
      const shell=await cache.match('/');if(shell)return shell;
      try{return await fetch(event.request);}catch{return await cache.match('/offline.html')||new Response('Reconnect once to prepare WorldOS for offline use.',{status:503});}
    }
    const saved=await cache.match(url.pathname)||await caches.match(event.request);
    return saved||fetch(event.request);
  })());
});
