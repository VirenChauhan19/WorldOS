import { Component, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Home as HomeIcon, ScanLine, FolderHeart, Settings2 } from 'lucide-react';
import Home from './screens/Home';
import { navigate, PAGES, useRoute } from './navigation';
import type { Page } from './navigation';

const Inspect=lazy(()=>import('./inspect/Inspect'));
const Wizard=lazy(()=>import('./simple/Wizard'));
const Studio=lazy(()=>import('./App'));
const Journal=lazy(()=>import('./screens/History'));
const Spaces=lazy(()=>import('./screens/Spaces'));
const Advanced=lazy(()=>import('./screens/Advanced'));
const Settings=lazy(()=>import('./screens/Settings'));
const titles={home:'Home',inspect:'Check your space',history:'My Spaces',studio:'Spatial Studio',settings:'Settings',advanced:'Advanced','advanced-inspect':'Advanced inspection','history-detail':'Inspection history'};
const mainPages=['home','history','settings'] as const;
const icons={home:HomeIcon,history:FolderHeart,settings:Settings2};

class ScreenBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<div className="empty-card" role="alert"><h2>This view could not load</h2><p>Check your connection and reopen the app when you have saved or exported any open work.</p><button className="secondary" onClick={()=>window.location.reload()}>Reload WorldOS</button></div>:this.props.children;}
}

export default function WorldOS() {
  const route=useRoute();
  const [visited,setVisited]=useState<Set<Page>>(()=>new Set([route.page]));
  const [reduced,setReduced]=useState(()=>{try{return localStorage.getItem('worldos.motion')==='reduced';}catch{return false;}});
  const previous=useRef<Page>(route.page),positions=useRef<Partial<Record<Page,number>>>({});
  useEffect(()=>{setVisited(old=>old.has(route.page)?old:new Set([...old,route.page]));document.title=`${titles[route.page]} · WorldOS`;},[route.page]);
  useEffect(()=>{document.documentElement.dataset.motion=reduced?'reduced':'system';try{localStorage.setItem('worldos.motion',reduced?'reduced':'system');}catch{/* Optional preference. */}},[reduced]);
  useEffect(()=>{const old=history.scrollRestoration;history.scrollRestoration='manual';return()=>{history.scrollRestoration=old;};},[]);
  useLayoutEffect(()=>{
    if(previous.current===route.page)return;
    positions.current[previous.current]=window.scrollY;previous.current=route.page;
    window.scrollTo({top:positions.current[route.page]??0,behavior:'instant'});
    document.getElementById(`screen-${route.page}`)?.focus({preventScroll:true});
  },[route.page]);
  return <div className="worldos-app">
    <a className="skip-link" href="#main-content" onClick={event=>{event.preventDefault();document.getElementById(`screen-${route.page}`)?.focus();}}>Skip to content</a>
    <header className="app-header"><button className="app-brand" onClick={()=>navigate('home')} aria-label="WorldOS home"><span className="brand-symbol"><ScanLine size={23}/></span>world<span>os</span></button><span className="app-header-note">A place for everything.</span></header>
    {route.page!=='inspect'&&<nav className="app-navigation" aria-label="Main navigation">{mainPages.map(page=>{const Icon=icons[page];return <button key={page} aria-current={route.page===page?'page':undefined} onClick={()=>navigate(page)}><Icon size={20} aria-hidden="true"/><span>{titles[page]}</span></button>;})}</nav>}
    {['advanced','advanced-inspect','studio','history-detail'].includes(route.page)&&<div className="advanced-heading"><span>Advanced workspace</span><button onClick={()=>navigate('advanced')}>All tools</button><button onClick={()=>navigate('home')}>Back to simple view</button></div>}
    <div id="main-content" className="app-content">{PAGES.map(page=><section key={page} id={`screen-${page}`} className={`route-screen ${page==='studio'?'desk-view':page==='advanced-inspect'?'advanced-view':''}`} hidden={route.page!==page} data-active={route.page===page} tabIndex={-1} aria-label={titles[page]}>
      {(visited.has(page)||route.page===page)&&<ScreenBoundary><Suspense fallback={<div className="screen-placeholder" role="status">Opening {titles[page]}…</div>}>
        {page==='home'?<Home active={route.page==='home'}/>:page==='inspect'?<Wizard active={route.page==='inspect'}/>:page==='advanced-inspect'?<Inspect active={route.page==='advanced-inspect'} initialTemplateId={route.params.get('template')??undefined} navigationIntent={route.params.get('open')??undefined} initialInspectionId={route.params.get('inspection')??undefined}/>:page==='studio'?<Studio active={route.page==='studio'}/>:page==='history'?<Spaces active={route.page==='history'}/>:page==='history-detail'?<Journal active={route.page==='history-detail'}/>:page==='advanced'?<Advanced/>:<Settings reduced={reduced} onReduced={setReduced}/>}
      </Suspense></ScreenBoundary>}
    </section>)}</div>
  </div>;
}
