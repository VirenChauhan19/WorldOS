import { useEffect, useState } from 'react';
import { ArrowRight, Camera, Check, MoveUpRight } from 'lucide-react';
import { navigate } from '../navigation';
import { listTemplates } from '../inspect/api';
import type { TemplateSummary } from '../inspect/types';
import Dialog from '../ui/Dialog';

export default function Home({active=true}:{active?:boolean}){
  const [help,setHelp]=useState(false),[spaces,setSpaces]=useState<TemplateSummary[]>([]);
  useEffect(()=>{if(!active)return;let live=true;void listTemplates().then(v=>{if(live)setSpaces(v.templates.slice(0,3));}).catch(()=>{});return()=>{live=false;};},[active]);
  return <div className="consumer home-simple"><section className="simple-hero"><div>
    <span className="eyebrow">YOUR SPACE. JUST RIGHT.</span>
    <h1>Is everything in the right place?</h1>
    <p>Take a photo of your setup. WorldOS helps you spot anything that’s moved or missing.</p>
    <button className="primary" onClick={()=>navigate('inspect')}><Camera size={21}/>Check my space <ArrowRight size={19}/></button>
    <button className="text-button" onClick={()=>setHelp(true)}>See how it works</button>
    <p className="quiet">One saved setup. A fresh photo when things change.</p>
  </div><div className="home-illustration" role="img" aria-label="Illustration of an organized desk, not an inspection result">
    <div className="illustration-top"><span/><span/><span/></div><div className="illustrated-desk"><div className="illustrated-notebook"><i/><i/><i/></div><div className="illustrated-phone"><span/></div><div className="illustrated-mug"/><div className="illustrated-pen"/></div><span className="illustration-caption">Make room for a little order.</span>
  </div></section>
    {!!spaces.length&&<section className="recent-spaces"><h2>Your recent spaces</h2>{spaces.map(space=><button className="space-row" key={space.id} onClick={()=>navigate('inspect',{template:space.id,open:crypto.randomUUID()})}><span>{space.name}</span><ArrowRight size={20}/></button>)}</section>}
    <Dialog open={help} onClose={()=>setHelp(false)} title="A photo, a check, a little help"><div className="consumer how-it-works"><ol><li><Camera/><div><strong>Save the correct setup</strong><p>Arrange your things and take a photo. Check the items WorldOS should remember.</p></div></li><li><MoveUpRight/><div><strong>See what changed</strong><p>Take another photo from the same spot. We’ll help you find moved or missing things.</p></div></li><li><Check/><div><strong>Put things back, then check again</strong><p>Follow the suggested move when it’s safe. A fresh photo checks the result. Uncertain items always need your review.</p></div></li></ol><button className="primary" onClick={()=>{setHelp(false);navigate('inspect');}}>Check my space <ArrowRight size={18}/></button></div></Dialog>
  </div>;
}
