import { Component, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import WorldIcon from './ui/WorldIcon';
import Home from './screens/Home';
import { navigate, PAGES, useRoute } from './navigation';
import type { Page } from './navigation';
import { openPrivateWorkspace, useDeviceWorkspace } from './device/context';
import DeviceSpaces from './device/DeviceSpaces';
import DeviceSetup from './device/DeviceSetup';
import DeviceChrome from './ui/DeviceChrome';
import PrepareSpace from './device/PrepareSpace';
import OfflineStatus from './ui/OfflineStatus';

const Inspect=lazy(()=>import('./inspect/Inspect'));
const Wizard=lazy(()=>import('./simple/Wizard'));
const LiveSpace=lazy(()=>import('./live/LiveSpace'));
const Mission=lazy(()=>import('./missions/Mission'));
const RoomStudio=lazy(()=>import('./room/RoomWorkspace'));
const Studio=lazy(()=>import('./App'));
const Journal=lazy(()=>import('./screens/History'));
const Spaces=lazy(()=>import('./screens/Spaces'));
const Advanced=lazy(()=>import('./screens/Advanced'));
const Settings=lazy(()=>import('./screens/Settings'));
const titles={home:'Home',prepare:'Get my space ready',mission:'My task',live:'Live space',room:'Room studio',inspect:'Photo comparison',history:'My Spaces',studio:'Spatial Studio',settings:'Settings',advanced:'Advanced','advanced-inspect':'Advanced inspection','history-detail':'Inspection history'};
const mainPages=['home','history','settings'] as const;
const icons={home:'home',history:'spaces',settings:'settings'} as const;

class ScreenBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<div className="empty-card" role="alert"><h2>This view could not load</h2><p>Check your connection and reopen the app when you have saved or exported any open work.</p><button className="secondary" onClick={()=>window.location.reload()}>Reload WorldOS</button></div>:this.props.children;}
}

export default function WorldOS() {
  const device=useDeviceWorkspace();
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
  return <div className={`worldos-app ${device?'device-app':''} ${route.page==='live'||route.page==='room'?'live-workspace':''}`}>
    {device&&<OfflineStatus/>}
    <a className="skip-link" href="#main-content" onClick={event=>{event.preventDefault();document.getElementById(`screen-${route.page}`)?.focus();}}>Skip to content</a>
    {device?<DeviceChrome page={route.page}/>:route.page!=='live'&&route.page!=='room'&&route.page!=='mission'&&<header className="app-header"><button className="app-brand" onClick={()=>navigate('home')} aria-label="WorldOS home"><span className="brand-symbol"><WorldIcon name="scan" size={23}/></span>world<span>os</span><small>A SPACE READY FOR YOU</small></button>
      {route.page!=='inspect'&&<nav className="app-navigation" aria-label="Main navigation">{mainPages.map(page=>{const icon=icons[page];return <button key={page} aria-current={route.page===page?'page':undefined} onClick={()=>navigate(page)}><WorldIcon name={icon} size={20}/><span>{titles[page]}</span></button>;})}</nav>}
      {route.page==='inspect'&&<span className="app-header-note"><span className="status-dot"/> YOUR SPACE, IN FOCUS</span>}
    </header>}
    {['advanced','advanced-inspect','studio','history-detail'].includes(route.page)&&<div className="advanced-heading"><span>Advanced workspace</span><button onClick={()=>navigate('advanced')}>All tools</button><button onClick={()=>navigate('home')}>Back to simple view</button></div>}
    <div id="main-content" className="app-content">{PAGES.map(page=><section key={page} id={`screen-${page}`} className={`route-screen ${page==='studio'?'desk-view':page==='advanced-inspect'?'advanced-view':''}`} hidden={route.page!==page} data-active={route.page===page} tabIndex={-1} aria-label={titles[page]}>
      {(visited.has(page)||route.page===page)&&<ScreenBoundary><Suspense fallback={<div className="screen-placeholder" role="status">Opening {titles[page]}…</div>}>
        {page==='prepare'?<PrepareSpace active={route.page===page}/>:device&&['mission','inspect'].includes(page)?<DeviceSetup active={route.page===page}/>:device&&page==='history'?<DeviceSpaces active={route.page===page}/>:device&&['studio','advanced-inspect','history-detail','advanced'].includes(page)?<div className="consumer"><h1>More ways to use your space</h1><div className="simple-list"><button className="space-row" onClick={()=>navigate('live')}>Explore objects with the live camera</button><button className="space-row" onClick={()=>navigate('room')}>Arrange furniture in 3D and try AR</button><button className="space-row" onClick={()=>navigate('mission')}>Save photos, notes, and a checklist on this device</button></div><section className="device-cloud"><h2>Cloud AI & detailed tools</h2><p>The private workspace includes tailored AI steps, automatic photo comparisons, the geometry editor, and inspection history. Open it when you want to use these server features.</p><button className="primary" onClick={openPrivateWorkspace}>Open private workspace</button></section></div>:page==='home'?<Home active={route.page==='home'}/>:page==='mission'?<Mission active={route.page==='mission'}/>:page==='live'?<LiveSpace active={route.page==='live'}/>:page==='room'?<RoomStudio active={route.page==='room'}/>:page==='inspect'?<Wizard active={route.page==='inspect'}/>:page==='advanced-inspect'?<Inspect active={route.page==='advanced-inspect'} initialTemplateId={route.params.get('template')??undefined} navigationIntent={route.params.get('open')??undefined} initialInspectionId={route.params.get('inspection')??undefined}/>:page==='studio'?<Studio active={route.page==='studio'}/>:page==='history'?<Spaces active={route.page==='history'}/>:page==='history-detail'?<Journal active={route.page==='history-detail'}/>:page==='advanced'?<Advanced/>:<Settings reduced={reduced} onReduced={setReduced}/>}
      </Suspense></ScreenBoundary>}
    </section>)}</div>
  </div>;
}
