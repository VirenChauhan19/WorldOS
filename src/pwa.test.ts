// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

function worker(){
  const listeners:Record<string,(event:any)=>void>={};
  const match=vi.fn().mockResolvedValue(new Response('Offline, no inference'));
  const cache={addAll:vi.fn().mockResolvedValue(undefined),match};
  const caches={open:vi.fn().mockResolvedValue(cache),keys:vi.fn().mockResolvedValue([]),delete:vi.fn()};
  const fetch=vi.fn().mockResolvedValue(new Response('online'));
  const self={addEventListener:(name:string,fn:(event:any)=>void)=>{listeners[name]=fn;},location:{origin:'https://worldos.example'},clients:{claim:vi.fn()},skipWaiting:vi.fn()};
  runInNewContext(readFileSync('public/sw.js','utf8'),{self,caches,fetch,URL,Response});return {listeners,cache,caches,fetch,self};
}
it('ships a standalone manifest and safe maskable/home screen icons',()=>{
  const manifest=JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
  expect(manifest).toMatchObject({display:'standalone',start_url:'/',scope:'/'});
  for(const icon of manifest.icons){const bytes=readFileSync(`public${icon.src}`);const size=Number(icon.sizes.split('x')[0]);expect(bytes.readUInt32BE(16)).toBe(size);expect(bytes.readUInt32BE(20)).toBe(size);}
  expect(manifest.icons.some((icon:{purpose:string})=>icon.purpose==='maskable')).toBe(true);
});
it('pre-caches only the generic offline page and public icons',async()=>{
  const w=worker();let finished!:Promise<unknown>;w.listeners.install({waitUntil:(promise:Promise<unknown>)=>{finished=promise;}});await finished;
  expect(w.cache.addAll.mock.calls[0][0].every((path:string)=>path==='/offline.html'||path.startsWith('/icons/'))).toBe(true);
});
it.each([
  ['https://worldos.example/api/inspect/templates','GET','navigate'],['https://api.example/api/ai/analyze','POST','cors'],['https://worldos.example/api/analyze','POST','cors'],['https://worldos.example/assets/app.js','GET','cors'],
])('never intercepts sensitive or non-navigation request %s',(url,method,mode)=>{const w=worker(),respondWith=vi.fn();w.listeners.fetch({request:{url,method,mode},respondWith});expect(respondWith).not.toHaveBeenCalled();expect(w.caches.open).not.toHaveBeenCalled();});
it('navigates network-only and shows an honest offline fallback on failure',async()=>{
  const w=worker();w.fetch.mockRejectedValue(new Error('offline'));let result!:Promise<Response>;
  const request={url:'https://worldos.example/',method:'GET',mode:'navigate'};w.listeners.fetch({request,respondWith:(value:Promise<Response>)=>{result=value;}});
  expect(await (await result).text()).toContain('no inference');expect(w.fetch).toHaveBeenCalledWith(request,{cache:'no-store'});
  expect(w.cache.addAll).not.toHaveBeenCalled();
});
