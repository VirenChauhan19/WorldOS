import { Camera, Folder, House, LayoutGrid, Settings } from 'lucide-react';
import { navigate } from '../navigation';
import type { Page } from '../navigation';

const destinations=[{page:'home',label:'Home',Icon:House},{page:'live',label:'Camera',Icon:Camera},{page:'room',label:'Room',Icon:LayoutGrid},{page:'history',label:'My Spaces',Icon:Folder},{page:'settings',label:'Settings',Icon:Settings}] as const;
const names:Partial<Record<Page,string>>={home:'Workspace',live:'Camera',room:'Room planner',history:'My Spaces',settings:'Settings',mission:'Setup',inspect:'Setup'};

export default function DeviceChrome({page}:{page:Page}){
  return <header className="device-masthead">
    <button className="device-wordmark" aria-label="WorldOS home" onClick={()=>navigate('home')}>world<span>os</span><i aria-hidden="true"/></button>
    <span className="device-page-name">{names[page]??'Tools'}</span>
    <nav className="consumer-navigation" aria-label="App navigation">{destinations.map(({page:target,label,Icon})=><button key={target} aria-current={page===target||target==='history'&&['mission','inspect'].includes(page)?'page':undefined} onClick={()=>navigate(target)}><Icon size={19} strokeWidth={1.65}/><span>{label}</span></button>)}</nav>
  </header>;
}
