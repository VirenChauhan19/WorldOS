import { useSyncExternalStore } from 'react';

export const PAGES = ['home','inspect','history','studio','settings'] as const;
export type Page = typeof PAGES[number];
const event = 'worldos:navigation';
function subscribe(listener:()=>void) {
  window.addEventListener('popstate',listener);window.addEventListener('hashchange',listener);window.addEventListener(event,listener);
  return ()=>{window.removeEventListener('popstate',listener);window.removeEventListener('hashchange',listener);window.removeEventListener(event,listener);};
}
export function useRoute() {
  const hash=useSyncExternalStore(subscribe,()=>window.location.hash,()=> '');
  const [path,query]=hash.replace(/^#\/?/,'').split('?');
  const page=PAGES.includes(path as Page)?path as Page:'home';
  return {page,params:new URLSearchParams(query),key:hash};
}
export function routeURL(page:Page,params:Record<string,string>={}) {
  const query=new URLSearchParams(params).toString();
  return `#/${page}${query?'?'+query:''}`;
}
export function navigate(page:Page,params:Record<string,string>={}) {
  const url=routeURL(page,params);
  if(window.location.hash===url)return;
  window.history.pushState(null,'',url);window.dispatchEvent(new Event(event));
}
