import { useState } from 'react';
import { ArrowUpRight, Check, Crosshair, Eye, Layers2, ScanLine } from 'lucide-react';
import evidence from '../../docs/v18-live-recognition.json';

const objects=[...evidence.objects].sort((a,b)=>b.box.width*b.box.height-a.box.width*a.box.height);
const names:Record<string,string>={smartphone:'Phone','potted plant':'Plant',laptop:'Laptop',monitor:'Monitor',keyboard:'Keyboard',mouse:'Mouse',tablet:'Tablet',desk:'Desk',cable:'Cable'};
const label=(name:string)=>names[name]??name;

export default function RecordedScene(){
  const [layer,setLayer]=useState<'image'|'objects'|'understanding'>('objects');
  const [selectedId,setSelectedId]=useState(()=>objects.find(object=>object.label==='smartphone')?.id??objects[0].id);
  const selected=objects.find(object=>object.id===selectedId)!;
  const types=objects.filter((object,index,list)=>list.findIndex(item=>item.label===object.label)===index);
  return <figure className="recorded-scene" id="recorded-scan" tabIndex={-1} aria-label="Explore a recorded AI scan">
    <div className="recorded-topline"><span><i/> WORLDOS VISION</span><span>RECORDED SCAN <span className="recorded-dot">·</span> 01</span></div>
    <div className="recorded-image">
      <img src="/desk-preview.webp" width="1600" height="1067" alt="A real desk with a laptop, monitor, phone, keyboard and other objects" fetchPriority="high"/>
      {layer!=='image'&&<div className="recorded-outlines" aria-label="Recorded SAM detections">{objects.map(object=><button key={object.id} type="button" aria-label={`Explore ${label(object.label)}`} aria-pressed={selectedId===object.id} className={`recorded-outline ${selectedId===object.id?'selected':''}`} onClick={()=>{setSelectedId(object.id);setLayer('objects');}} style={{left:`${object.box.x*100}%`,top:`${object.box.y*100}%`,width:`${object.box.width*100}%`,height:`${object.box.height*100}%`}}>{selectedId===object.id&&<span style={object.box.y<.15?{top:8,bottom:'auto'}:undefined}><Crosshair size={11}/>{label(object.label)}<Check size={11}/></span>}</button>)}</div>}
      <span className="recorded-corner corner-tl" aria-hidden="true"/><span className="recorded-corner corner-br" aria-hidden="true"/>
      <div className="recorded-image-index" aria-hidden="true">01 / YOUR EVERYDAY, RECONSIDERED</div>
    </div>
    <div className="recorded-layer-bar" role="group" aria-label="Explore scan layers"><button aria-pressed={layer==='image'} onClick={()=>setLayer('image')}><Eye size={14}/>Image</button><button aria-pressed={layer==='objects'} onClick={()=>setLayer('objects')}><Layers2 size={14}/>Objects <span>{objects.length}</span></button><button aria-pressed={layer==='understanding'} onClick={()=>setLayer('understanding')}><ScanLine size={14}/>Understanding</button></div>
    <figcaption className="recorded-caption">
      {layer==='understanding'?<div className="recorded-understanding"><span className="product-label">WHAT MUSE SPARK SAW</span><p>{evidence.summary}</p></div>:layer==='objects'?<><div className="recorded-selected" aria-live="polite"><div className="recorded-object-icon"><Crosshair size={23} strokeWidth={1.3}/></div><div><span className="product-label">LOCATED IN THE IMAGE</span><strong>{label(selected.label)}</strong></div><div className="recorded-score"><span>SAM SCORE</span><strong>{selected.confidence.toFixed(2)}</strong></div></div><div className="recorded-object-chips" role="group" aria-label="Recorded object types">{types.map(object=><button key={object.id} aria-pressed={selected.label===object.label} onClick={()=>setSelectedId(object.id)}>{label(object.label)}</button>)}</div></>:<div className="recorded-original"><span className="product-label">IT STARTS WITH WHAT YOU SEE</span><p>An everyday desk. A different way to understand it.</p></div>}
      <div className="recorded-source"><span>Real model output · {objects.length} of {evidence.total_objects} detections</span><a href="https://unsplash.com/photos/ElFBCgOfoIM" target="_blank" rel="noreferrer" aria-label="Desk photograph credit">Photo credit<ArrowUpRight size={11}/></a></div>
    </figcaption>
  </figure>;
}
