// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

function worker(){
  const listeners:Record<string,(event:any)=>void>={};
  const match=vi.fn().mockResolvedValue(new Response('Cached app interface'));
  const cache={addAll:vi.fn().mockResolvedValue(undefined),match};
  const caches={match:vi.fn(),open:vi.fn().mockResolvedValue(cache),keys:vi.fn().mockResolvedValue([]),delete:vi.fn()};
  const fetch=vi.fn().mockResolvedValue(new Response('online'));
  const self={__WORLDOS_BUILD__:{version:'test',assets:['/','/index.html','/assets/app.js','/assets/room.js','/offline.html']},addEventListener:(name:string,fn:(event:any)=>void)=>{listeners[name]=fn;},location:{origin:'https://worldos.example'},clients:{claim:vi.fn()},skipWaiting:vi.fn()};
  runInNewContext(readFileSync('public/sw.js','utf8'),{self,caches,fetch,URL,Response});return {listeners,cache,caches,fetch,self};
}
it('ships a standalone manifest and safe maskable/home screen icons',()=>{
  const manifest=JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
  expect(manifest).toMatchObject({display:'standalone',start_url:'/',scope:'/'});
  for(const icon of manifest.icons){const bytes=readFileSync(`public${icon.src}`);const size=Number(icon.sizes.split('x')[0]);expect(bytes.readUInt32BE(16)).toBe(size);expect(bytes.readUInt32BE(20)).toBe(size);}
  expect(manifest.icons.some((icon:{purpose:string})=>icon.purpose==='maskable')).toBe(true);
});
it('pre-caches the versioned app shell and lazy screens for offline startup',async()=>{
  const w=worker();let finished!:Promise<unknown>;w.listeners.install({waitUntil:(promise:Promise<unknown>)=>{finished=promise;}});await finished;
  expect(w.cache.addAll).toHaveBeenCalledWith(['/','/index.html','/assets/app.js','/assets/room.js','/offline.html']);
  expect(w.self.skipWaiting).toHaveBeenCalledTimes(1);
});
it('reports offline readiness only when every required asset remains cached',async()=>{
  const w=worker(),reply=vi.fn();let done!:Promise<unknown>;
  const event={data:{type:'OFFLINE_STATUS'},ports:[{postMessage:reply}],waitUntil:(promise:Promise<unknown>)=>{done=promise;}};
  w.listeners.message(event);await done;expect(reply).toHaveBeenLastCalledWith({ready:true,version:'test'});
  w.cache.match.mockResolvedValueOnce(undefined as unknown as Response);
  w.listeners.message(event);await done;expect(reply).toHaveBeenLastCalledWith({ready:false,version:'test'});
});
it('keeps the current worker when offline assets fail to install',async()=>{
  const w=worker();w.cache.addAll.mockRejectedValue(new Error('offline'));let finished!:Promise<unknown>;
  w.listeners.install({waitUntil:(promise:Promise<unknown>)=>{finished=promise;}});
  await expect(finished).rejects.toThrow('offline');expect(w.self.skipWaiting).not.toHaveBeenCalled();
});
it('activates quietly and removes only obsolete WorldOS offline caches',async()=>{
  const w=worker();w.caches.keys.mockResolvedValue(['worldos-offline-v1.3.0','worldos-app-old','worldos-app-previous','worldos-app-test','another-app']);
  let finished!:Promise<unknown>;w.listeners.activate({waitUntil:(promise:Promise<unknown>)=>{finished=promise;}});await finished;
  expect(w.caches.delete.mock.calls).toEqual([['worldos-offline-v1.3.0'],['worldos-app-old']]);
  expect(w.self.clients.claim).toHaveBeenCalledTimes(1);
});
it.each([
  ['https://worldos.example/api/inspect/templates','GET','navigate'],['https://api.example/api/ai/analyze','POST','cors'],['https://worldos.example/api/analyze','POST','cors'],['https://worldos.example/photos/private.jpg','GET','cors'],['https://worldos.example/?token=secret','GET','navigate'],
])('never intercepts sensitive or non-navigation request %s',(url,method,mode)=>{const w=worker(),respondWith=vi.fn();w.listeners.fetch({request:{url,method,mode},respondWith});expect(respondWith).not.toHaveBeenCalled();expect(w.caches.open).not.toHaveBeenCalled();});
it('opens the complete app shell while offline without starting an API request',async()=>{
  const w=worker();w.fetch.mockRejectedValue(new Error('offline'));let result!:Promise<Response>;
  w.listeners.fetch({request:{url:'https://worldos.example/',method:'GET',mode:'navigate'},respondWith:(value:Promise<Response>)=>{result=value;}});
  expect(await (await result).text()).toBe('Cached app interface');expect(w.fetch).not.toHaveBeenCalled();
});
it('loads a lazy screen from cache offline',async()=>{
  const w=worker();let result!:Promise<Response>;
  w.listeners.fetch({request:{url:'https://worldos.example/assets/room.js',method:'GET',mode:'cors'},respondWith:(value:Promise<Response>)=>{result=value;}});
  expect(await (await result).text()).toBe('Cached app interface');expect(w.fetch).not.toHaveBeenCalled();
});
it('shows a reconnect page only when the app shell has not been cached',async()=>{
  const w=worker();w.cache.match.mockImplementation(async(path:string)=>path==='/offline.html'?new Response('Reconnect once'):undefined);w.fetch.mockRejectedValue(new Error('offline'));let result!:Promise<Response>;
  w.listeners.fetch({request:{url:'https://worldos.example/',method:'GET',mode:'navigate'},respondWith:(value:Promise<Response>)=>{result=value;}});
  expect(await (await result).text()).toBe('Reconnect once');
});
