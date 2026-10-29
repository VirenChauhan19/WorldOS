import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, Camera, Check, MoveUpRight, ScanLine } from 'lucide-react';
import { navigate } from '../navigation';
import { listTemplates } from '../inspect/api';
import type { TemplateSummary } from '../inspect/types';
import Dialog from '../ui/Dialog';
import SpatialPreview from '../simple/SpatialPreview';

export default function Home({active=true}:{active?:boolean}) {
  const [help,setHelp]=useState(false),[spaces,setSpaces]=useState<TemplateSummary[]>([]);
  useEffect(()=>{
    if(!active)return;
    let live=true;
    void listTemplates().then(v=>{if(live)setSpaces(v.templates.slice(0,3));}).catch(()=>{});
    return()=>{live=false;};
  },[active]);
  return <div className="consumer home-simple">
    <section className="spatial-hero" aria-labelledby="home-title">
      <div className="hero-copy">
        <span className="eyebrow"><span className="status-dot"/> A NEW PERSPECTIVE ON YOUR SPACE</span>
        <h1 id="home-title">See what fits.<br/>{' '}Before you <span className="place-word">move it.<svg viewBox="0 0 240 16" aria-hidden="true"><path d="M3 11 Q105 0 236 7"/></svg></span></h1>
        <p>Open your camera. Understand what is in view. Compare real dimensions with the space you have.</p>
        <div className="hero-actions">
          <button className="primary" onClick={()=>navigate('live')}><ScanLine size={20}/>Check my space <ArrowRight size={18}/></button>
          <button className="text-button" onClick={()=>navigate('room')}>Furnish a room <ArrowUpRight size={16}/></button>
          <button className="text-button" onClick={()=>setHelp(true)}>How it works <ArrowUpRight size={16}/></button>
        </div>
        <div className="hero-footnote"><span className="tiny-cross" aria-hidden="true">+</span><span>Live camera. Measured space. A clearer decision.</span></div>
      </div>
      <SpatialPreview/>
    </section>
    <section className="workflow-overview" aria-label="How WorldOS works">
      <div className="workflow-intro"><span className="eyebrow">FROM SEEING TO DOING</span><h2>A place for everything. A way to get it there.</h2></div>
      <ol>
        <li><span className="workflow-index">01</span><div><h3>Look around</h3><p>Open the camera and recognize the things in view.</p></div></li>
        <li><span className="workflow-index">02</span><div><h3>Measure the space</h3><p>Mark a clear area in spatial AR, or enter its measurements.</p></div></li>
        <li><span className="workflow-index">03</span><div><h3>See what fits</h3><p>Compare item dimensions, rotation, and extra room.</p></div></li>
      </ol>
    </section>
    {!!spaces.length&&<section className="recent-spaces"><div className="section-heading"><h2>Pick up where you left off</h2><button className="text-button" onClick={()=>navigate('history')}>All spaces <ArrowUpRight size={16}/></button></div>{spaces.map(space=><button className="space-row" key={space.id} onClick={()=>navigate('inspect',{template:space.id,open:crypto.randomUUID()})}><ScanLine size={22}/><span>{space.name}<small>Open your saved setup</small></span><ArrowRight size={20}/></button>)}</section>}
    <footer className="home-footer"><span>WORLDOS <span className="footer-divider">/</span> BUILT AROUND YOUR WORLD</span><button className="text-button" onClick={()=>navigate('studio')}>Make room with Spatial Studio <ArrowUpRight size={16}/></button></footer>
    <Dialog open={help} onClose={()=>setHelp(false)} title="Look. Measure. Make room."><div className="consumer how-it-works"><ol><li><Camera/><div><strong>Open the live view</strong><p>Use your camera with automatic item recognition. Hold still to refresh the outlines. You do not need to label anything.</p></div></li><li><MoveUpRight/><div><strong>Measure a clear rectangle</strong><p>On a supported AR device, mark three ground corners. Otherwise, enter measurements you have taken.</p></div></li><li><Check/><div><strong>Compare the footprint</strong><p>Try an item you would like to add, or browse the examples that fit. Edit its dimensions to match the real item.</p></div></li></ol><p className="quiet">Fit checks compare dimensions. They do not detect every obstacle or check a vehicle's approach and turning path.</p><button className="primary" onClick={()=>{setHelp(false);navigate('live');}}>Check my space <ArrowRight size={18}/></button></div></Dialog>
  </div>;
}
