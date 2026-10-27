import { ArrowRight, ScanLine, History, MoveUpRight, ShieldCheck } from 'lucide-react';
import { navigate } from '../navigation';

export default function Home() {
  return <div className="overview-page">
    <div className="home-hero"><div><span className="section-kicker">YOUR WORKSPACE, IN FOCUS</span>
      <h1 id="page-title-home" tabIndex={-1}>A place for everything.<br/><em>A clearer way forward.</em></h1>
      <p>Capture how your space should look. Understand what changed. Restore it, one considered move at a time.</p>
      <div className="hero-actions"><button className="primary" onClick={()=>navigate('inspect',{template:'new'})}>Create a reference <ArrowRight size={18}/></button><button className="secondary" onClick={()=>navigate('inspect')}>Open Inspect</button></div>
    </div><div className="home-process" aria-label="Inspection workflow"><span className="process-label">A SIMPLE RHYTHM</span>{[['01','Capture','A reference you have reviewed.'],['02','Understand','Inspect a new photo and review the evidence.'],['03','Restore','Follow validated corrections, then verify.']].map(([number,title,text])=><div key={number}><span>{number}</span><section><h2>{title}</h2><p>{text}</p></section></div>)}</div></div>
    <div className="home-cards">
      <button className="destination-card" onClick={()=>navigate('inspect')}><ScanLine size={23}/><span><strong>Inspect your workspace</strong><small>References, inspections, and corrections.</small></span><ArrowRight size={18}/></button>
      <button className="destination-card" onClick={()=>navigate('history')}><History size={23}/><span><strong>Pick up where you left off</strong><small>Revisit saved inspections and their evidence.</small></span><ArrowRight size={18}/></button>
      <button className="destination-card" onClick={()=>navigate('studio')}><MoveUpRight size={23}/><span><strong>Explore Spatial Studio</strong><small>Plan a new arrangement from a photograph.</small></span><ArrowRight size={18}/></button>
    </div><p className="home-footnote"><ShieldCheck size={16}/> You stay in control. Uploading a photo never starts AI inference. Review results before acting.</p>
  </div>;
}
