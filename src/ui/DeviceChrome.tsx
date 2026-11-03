import { ChevronRight } from 'lucide-react';
import WorldIcon from './WorldIcon';
import { navigate } from '../navigation';
import type { Page } from '../navigation';
import './device-chrome.css';

const destinations=[{page:'home',label:'Home',icon:'home'},{page:'live',label:'Camera',icon:'camera'},{page:'room',label:'Room',icon:'room'},{page:'ar',label:'AR studio',icon:'scan'},{page:'history',label:'My Spaces',icon:'spaces'},{page:'settings',label:'Settings',icon:'settings'}] as const;
const names:Partial<Record<Page,string>>={home:'Overview',prepare:'Get ready',live:'Camera',room:'Room planner',ar:'AR interior studio',history:'My Spaces',settings:'Settings',mission:'Setup',inspect:'Setup'};

export default function DeviceChrome({page}:{page:Page}){
  const name=names[page]??'Tools';
  return <>
    <aside className="device-sidebar" aria-label="Workspace">
      <button className="device-wordmark" aria-label="WorldOS home" onClick={()=>navigate('home')}>
        <span className="device-brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="m5 10 6 14 5-10 5 10 6-14M11 8l5 6 5-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
        <span className="device-brand-name">World<span>OS</span><small>SPACE FOR POSSIBILITY</small></span>
      </button>
      <span className="device-mobile-page-name">{name}</span>
      <div className="device-navigation-heading">YOUR WORKSPACE</div>
      <nav className="consumer-navigation" aria-label="App navigation">{destinations.map(({page:target,label,icon})=><button key={target} data-destination={icon} aria-current={page===target||target==='history'&&['mission','inspect'].includes(page)?'page':undefined} onClick={()=>navigate(target,target==='ar'?{workspace:''}:{})}><span className="device-tab-icon"><WorldIcon name={icon} size={23}/></span><span className="device-tab-label">{label}</span></button>)}</nav>
      <div className="device-sidebar-bottom">
        <div className="device-local-note"><span className="device-local-icon"><WorldIcon name="privacy" size={23}/></span><strong>Your space. Your device.</strong><p>Setups and room plans stay in this browser, ready when you are.</p></div>
        <div className="device-sidebar-edition"><span>Made for the real world</span><span>v1.3</span></div>
      </div>
    </aside>
    <header className="device-masthead">
      <div className="device-breadcrumb"><span>Workspace</span><ChevronRight size={14} aria-hidden="true"/><span className="device-page-name">{name}</span></div>
      <div className="device-workspace-mode"><WorldIcon name="device" size={17}/><span>On-device workspace</span></div>
    </header>
  </>;
}
