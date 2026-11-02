import { useEffect, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Box, Camera, Check, Crosshair, ScanLine } from 'lucide-react';
import { navigate } from '../navigation';
import { listTemplates } from '../inspect/api';
import type { TemplateSummary } from '../inspect/types';
import Dialog from '../ui/Dialog';
import RecordedScene from '../showcase/RecordedScene';
import MissionLibrary from '../missions/MissionLibrary';
import '../missions/missions.css';
import '../showcase/showcase.css';

export default function ProductHome({active=true}:{active?:boolean}) {
  const [help,setHelp]=useState(false),[spaces,setSpaces]=useState<TemplateSummary[]>([]);
  useEffect(()=>{if(!active)return;let live=true;void listTemplates().then(value=>{if(live)setSpaces(value.templates.slice(0,3));}).catch(()=>{});return()=>{live=false;};},[active]);
  function explore(){const scene=document.getElementById('recorded-scan');const reduced=document.documentElement.dataset.motion==='reduced'||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;scene?.scrollIntoView({behavior:reduced?'instant':'smooth',block:'center'});scene?.focus({preventScroll:true});}
  return <div className="product-home">
    <section className="product-hero" aria-labelledby="home-title">
      <div className="product-hero-copy"><span className="product-label hero-eyebrow"><i/> A SPACE READY FOR WHAT COMES NEXT</span>
        <h1 id="home-title">Make room.<br/><span>Get going.</span><span className="hero-asterisk" aria-hidden="true">✳</span></h1>
        <p>Get your space ready to study, work, or create.<br className="desktop-break"/> Show us what’s there. Get a few clear steps.<br className="desktop-break"/> Keep the setup that works for you.</p>
        <div className="product-hero-actions"><button className="product-primary" onClick={()=>navigate('mission')}><ScanLine size={19}/>Get my space ready<ArrowUpRight size={19}/></button><button className="product-text" onClick={()=>navigate('live')}><Camera size={17}/>Open live camera<ArrowUpRight size={15}/></button><button className="product-text" onClick={explore}>See an example<ArrowDown size={15}/></button></div>
        <div className="mission-value-note">TAKE A PHOTO · FOLLOW THE STEPS · KEEP YOUR SETUP</div>
        <div className="product-powered"><span className="meta-loop" aria-hidden="true">∞</span><div><span>BUILT WITH META AI</span><strong>Muse Spark <i>+</i> SAM 3.1</strong></div></div>
      </div>
      <div className="product-hero-visual"><div className="hero-coordinate" aria-hidden="true">THE PHYSICAL WORLD, WITH CONTEXT <span>↘</span></div><RecordedScene/><div className="hero-visual-note"><span><Crosshair size={13}/> Select an object. See what AI sees.</span><button onClick={()=>setHelp(true)}>How it works<ArrowUpRight size={13}/></button></div></div>
    </section>
    <MissionLibrary active={active} compact/>
    <section className="product-manifesto" aria-label="From seeing to doing"><span className="product-label">YOU HAVE SOMETHING YOU WANT TO DO</span><div><h2>Start with your space.<br/>Leave with <em>a next step.</em></h2><p>Choose what stays. Follow one suggestion at a time. Check a new photo and save the setup you like, so tomorrow starts a little easier.</p></div><span className="manifesto-mark" aria-hidden="true">↗</span></section>
    <section className="product-paths" aria-label="Choose what to do with your space">
      <button className="product-path path-see" onClick={()=>navigate('live')}><div className="path-heading"><span className="product-label">LOOK CLOSER</span><ArrowUpRight size={20}/></div><div className="path-art perception-art" aria-hidden="true"><span/><span/><i/><div><Crosshair size={21}/></div><b>OBJECT IN CONTEXT</b></div><h3>Something caught your eye?</h3><p>Open the live camera, identify items, and ask a question about what is in view.</p><span className="path-action">Check my space<ArrowRight size={15}/></span></button>
      <button className="product-path path-room" onClick={()=>navigate('room')}><div className="path-heading"><span className="product-label">02 / IMAGINE</span><ArrowUpRight size={20}/></div><div className="path-art room-art" aria-hidden="true"><div className="mini-room"><i className="mini-bed"/><i className="mini-desk"/><i className="mini-wardrobe"/><span className="mini-dimension"/></div><b>SPACE FOR YOUR NEXT IDEA</b></div><h3>Try the room you imagine.</h3><p>Arrange furniture together in 3D. Preview it in AR on supported devices.</p><span className="path-action">Furnish a room<ArrowRight size={15}/></span></button>
      <button className="product-path path-remember" onClick={()=>navigate('inspect')}><div className="path-heading"><span className="product-label">03 / REMEMBER</span><ArrowUpRight size={20}/></div><div className="path-art memory-art" aria-hidden="true"><div><span/><i/><b/></div><div><span/><i/><b/></div><Check size={20}/></div><h3>A place worth coming back to.</h3><p>Save a setup, compare a new photo, and find your way back to how it was.</p><span className="path-action">Save a reference<ArrowRight size={15}/></span></button>
    </section>
    {!!spaces.length&&<section className="product-recent"><div><span className="product-label">YOUR WORLD, REMEMBERED</span><h2>Pick up where you left off.</h2></div>{spaces.map(space=><button key={space.id} onClick={()=>navigate('inspect',{template:space.id,open:crypto.randomUUID()})}><ScanLine size={20}/><strong>{space.name}</strong><ArrowUpRight size={17}/></button>)}</section>}
    <section className="product-invitation"><div><span className="product-label">ONE SMALL STEP IS A GOOD START</span><h2>Your next idea<br/>deserves <em>a little room.</em></h2></div><button className="product-primary" onClick={()=>navigate('mission')}>Start with my space<ArrowUpRight size={20}/></button></section>
    <footer className="product-footer"><span>WORLDOS <i>/</i> AN INTELLIGENCE LAYER FOR YOUR WORLD</span><button onClick={()=>navigate('studio')}>Spatial Studio<ArrowUpRight size={13}/></button></footer>
    <Dialog open={help} onClose={()=>setHelp(false)} title="A few steps toward a better space."><div className="consumer how-it-works"><ol><li><Camera/><div><strong>Show your starting point</strong><p>Choose what you want to do and take a clear photo. Tell us what should stay put.</p></div></li><li><Crosshair/><div><strong>Take one useful step</strong><p>Each suggestion explains what to do, highlights relevant items, and tells you what to look for.</p></div></li><li><Box/><div><strong>Keep what works</strong><p>Review an after photo, then save your preferred setup as a routine you can use again.</p></div></li></ol><p className="quiet">The interactive home example shows recorded object detection. Your task uses your own photo. Physical fit needs real measurements.</p><button className="primary" onClick={()=>{setHelp(false);navigate('mission');}}>Get my space ready<ArrowRight size={17}/></button></div></Dialog>
  </div>;
}
