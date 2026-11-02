import { useEffect, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Box, Camera, Check, Crosshair, ScanLine } from 'lucide-react';
import { navigate } from '../navigation';
import { listTemplates } from '../inspect/api';
import type { TemplateSummary } from '../inspect/types';
import Dialog from '../ui/Dialog';
import RecordedScene from '../showcase/RecordedScene';
import '../showcase/showcase.css';

export default function ProductHome({active=true}:{active?:boolean}) {
  const [help,setHelp]=useState(false),[spaces,setSpaces]=useState<TemplateSummary[]>([]);
  useEffect(()=>{if(!active)return;let live=true;void listTemplates().then(value=>{if(live)setSpaces(value.templates.slice(0,3));}).catch(()=>{});return()=>{live=false;};},[active]);
  function explore(){const scene=document.getElementById('recorded-scan');const reduced=document.documentElement.dataset.motion==='reduced'||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;scene?.scrollIntoView({behavior:reduced?'instant':'smooth',block:'center'});scene?.focus({preventScroll:true});}
  return <div className="product-home">
    <section className="product-hero" aria-labelledby="home-title">
      <div className="product-hero-copy"><span className="product-label hero-eyebrow"><i/> SPATIAL INTELLIGENCE, IN YOUR HANDS</span>
        <h1 id="home-title">Your world.<br/><span>Understood.</span><span className="hero-asterisk" aria-hidden="true">✳</span></h1>
        <p>There’s more to your space than meets the eye.<br className="desktop-break"/> Point your camera. Ask a question.<br className="desktop-break"/> See what could come next.</p>
        <div className="product-hero-actions"><button className="product-primary" onClick={()=>navigate('live')}><ScanLine size={19}/>Check my space<ArrowUpRight size={19}/></button><button className="product-text" onClick={explore}>Explore a real scan<ArrowDown size={15}/></button></div>
        <div className="product-powered"><span className="meta-loop" aria-hidden="true">∞</span><div><span>BUILT WITH META AI</span><strong>Muse Spark <i>+</i> SAM 3.1</strong></div></div>
      </div>
      <div className="product-hero-visual"><div className="hero-coordinate" aria-hidden="true">THE PHYSICAL WORLD, WITH CONTEXT <span>↘</span></div><RecordedScene/><div className="hero-visual-note"><span><Crosshair size={13}/> Select an object. See what AI sees.</span><button onClick={()=>setHelp(true)}>How it works<ArrowUpRight size={13}/></button></div></div>
    </section>
    <section className="product-manifesto" aria-label="From seeing to doing"><span className="product-label">A NEW WAY TO WORK WITH THE WORLD</span><div><h2>AI has learned to answer.<br/>Now give it <em>somewhere to look.</em></h2><p>A camera becomes a starting point. Objects become context. Questions become practical next steps.</p></div><span className="manifesto-mark" aria-hidden="true">↗</span></section>
    <section className="product-paths" aria-label="Choose what to do with your space">
      <button className="product-path path-see" onClick={()=>navigate('live')}><div className="path-heading"><span className="product-label">01 / UNDERSTAND</span><ArrowUpRight size={20}/></div><div className="path-art perception-art" aria-hidden="true"><span/><span/><i/><div><Crosshair size={21}/></div><b>OBJECT IN CONTEXT</b></div><h3>Point. Ask. Discover.</h3><p>Recognize what is around you, then ask a question grounded in that view.</p><span className="path-action">Open live vision<ArrowRight size={15}/></span></button>
      <button className="product-path path-room" onClick={()=>navigate('room')}><div className="path-heading"><span className="product-label">02 / IMAGINE</span><ArrowUpRight size={20}/></div><div className="path-art room-art" aria-hidden="true"><div className="mini-room"><i className="mini-bed"/><i className="mini-desk"/><i className="mini-wardrobe"/><span className="mini-dimension"/></div><b>SPACE FOR YOUR NEXT IDEA</b></div><h3>Try the room you imagine.</h3><p>Arrange furniture together in 3D. Preview it in AR on supported devices.</p><span className="path-action">Furnish a room<ArrowRight size={15}/></span></button>
      <button className="product-path path-remember" onClick={()=>navigate('inspect')}><div className="path-heading"><span className="product-label">03 / REMEMBER</span><ArrowUpRight size={20}/></div><div className="path-art memory-art" aria-hidden="true"><div><span/><i/><b/></div><div><span/><i/><b/></div><Check size={20}/></div><h3>A place worth coming back to.</h3><p>Save a setup, compare a new photo, and find your way back to how it was.</p><span className="path-action">Save a reference<ArrowRight size={15}/></span></button>
    </section>
    {!!spaces.length&&<section className="product-recent"><div><span className="product-label">YOUR WORLD, REMEMBERED</span><h2>Pick up where you left off.</h2></div>{spaces.map(space=><button key={space.id} onClick={()=>navigate('inspect',{template:space.id,open:crypto.randomUUID()})}><ScanLine size={20}/><strong>{space.name}</strong><ArrowUpRight size={17}/></button>)}</section>}
    <section className="product-invitation"><div><span className="product-label">START WITH WHAT’S IN FRONT OF YOU</span><h2>A little less guessing.<br/>A lot more <em>possibility.</em></h2></div><button className="product-primary" onClick={()=>navigate('live')}>Open your camera<ArrowUpRight size={20}/></button></section>
    <footer className="product-footer"><span>WORLDOS <i>/</i> AN INTELLIGENCE LAYER FOR YOUR WORLD</span><button onClick={()=>navigate('studio')}>Spatial Studio<ArrowUpRight size={13}/></button></footer>
    <Dialog open={help} onClose={()=>setHelp(false)} title="See. Understand. Act."><div className="consumer how-it-works"><ol><li><Camera/><div><strong>Start with your camera</strong><p>Hold a clear view for a moment. WorldOS finds and outlines visible objects automatically.</p></div></li><li><Crosshair/><div><strong>Give your space a question</strong><p>Muse Spark reasons over the captured photo and detected objects. Tap an item mentioned in its answer to find it.</p></div></li><li><Box/><div><strong>Turn an idea into a next step</strong><p>Compare real measurements, arrange furniture, or save a reference setup.</p></div></li></ol><p className="quiet">Recognition describes a captured image. Physical fit requires entered measurements or supported tracked AR.</p><button className="primary" onClick={()=>{setHelp(false);navigate('live');}}>Check my space<ArrowRight size={17}/></button></div></Dialog>
  </div>;
}
