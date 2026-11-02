import { useState } from 'react';
import { ArrowUpRight, Check, Crosshair, Eye, FileText, Layers2 } from 'lucide-react';
import evidence from '../../docs/v18-live-recognition.json';

const objects=[...evidence.objects].sort((a,b)=>b.box.width*b.box.height-a.box.width*a.box.height);
const names:Record<string,string>={smartphone:'Phone','potted plant':'Plant',laptop:'Laptop',monitor:'Monitor',keyboard:'Keyboard',mouse:'Mouse',tablet:'Tablet',desk:'Desk',cable:'Cable'};
const label=(name:string)=>names[name]??name;

export default function RecordedScene(){
  const [layer,setLayer]=useState<'image'|'objects'|'understanding'>('objects');
  const [selectedId,setSelectedId]=useState(()=>objects.find(object=>object.label==='smartphone')?.id??objects[0].id);
  const selected=objects.find(object=>object.id===selectedId)!;
  const types=objects.filter((object,index,list)=>list.findIndex(item=>item.label===object.label)===index);
  return <figure className="recorded-scene" id="recorded-scan" tabIndex={-1} aria-label="Explore a recorded desk scan">
    <div className="recorded-topline"><span><i/> RECORDED DESK SCAN</span><span>{objects.length} OBJECTS</span></div>
    <div className="recorded-image">
      <img src="/desk-preview.webp" width="1600" height="1067" alt="A real desk with a laptop, monitor, phone, keyboard and other objects" fetchPriority="high"/>
      {layer!=='image'&&<div className="recorded-outlines" aria-label="Objects in the recorded scan">{objects.map(object=><button key={object.id} type="button" aria-label={`Explore ${label(object.label)}`} aria-pressed={selectedId===object.id} className={`recorded-outline ${selectedId===object.id?'selected':''}`} onClick={()=>{setSelectedId(object.id);setLayer('objects');}} style={{left:`${object.box.x*100}%`,top:`${object.box.y*100}%`,width:`${object.box.width*100}%`,height:`${object.box.height*100}%`}}>{selectedId===object.id&&<span style={object.box.y<.15?{top:8,bottom:'auto'}:undefined}><Crosshair size={11}/>{label(object.label)}<Check size={11}/></span>}</button>)}</div>}
      <span className="recorded-corner corner-tl" aria-hidden="true"/><span className="recorded-corner corner-br" aria-hidden="true"/>
      <div className="recorded-image-index" aria-hidden="true">DESK EXAMPLE</div>
    </div>
    <div className="recorded-layer-bar" role="group" aria-label="Explore scan layers"><button aria-pressed={layer==='image'} onClick={()=>setLayer('image')}><Eye size={14}/>Image</button><button aria-pressed={layer==='objects'} onClick={()=>setLayer('objects')}><Layers2 size={14}/>Objects <span>{objects.length}</span></button><button aria-pressed={layer==='understanding'} onClick={()=>setLayer('understanding')}><FileText size={14}/>Scene notes</button></div>
    <figcaption className="recorded-caption">
      {layer==='understanding'?<div className="recorded-understanding"><span className="product-label">SCENE NOTES</span><p>A laptop sits on the left of the desk, with a monitor above, a keyboard and mouse in the center, and a phone below the keyboard. A tablet and plant sit along the right edge.</p></div>:layer==='objects'?<><div className="recorded-selected" aria-live="polite"><div className="recorded-object-icon"><Crosshair size={23} strokeWidth={1.3}/></div><div><span className="product-label">SELECTED OBJECT</span><strong>{label(selected.label)}</strong></div></div><div className="recorded-object-chips" role="group" aria-label="Recorded object types">{types.map(object=><button key={object.id} aria-pressed={selected.label===object.label} onClick={()=>setSelectedId(object.id)}>{label(object.label)}</button>)}</div></>:<div className="recorded-original"><span className="product-label">ORIGINAL PHOTO</span><p>A desk with a laptop, monitor, keyboard, phone, and other everyday objects.</p></div>}
      <div className="recorded-source"><span>Recorded desk scan · {objects.length} objects</span><a href="https://unsplash.com/photos/ElFBCgOfoIM" target="_blank" rel="noreferrer" aria-label="Desk photograph credit">Photo credit<ArrowUpRight size={11}/></a></div>
    </figcaption>
  </figure>;
}
