import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, SplitSquareHorizontal } from 'lucide-react';
import { footprintPolygon, validFloorCorners } from './photoPlane';
import type { RoomReference } from './photoPlane';
import { orientedSize } from './layout';
import type { FurnitureItem, FurniturePlacement, ReservedZone, RoomSize } from './layout';
import { buildPhotoScene, drawPhotoScene } from './photoFurniture';
import PhotoFurniture from './ProjectedFurniture';

const corners=['Back left','Back right','Front right','Front left'];
export default function RoomPhoto({reference,onChange,room,items,placements,zones,selectedId,onSelect,onReserve,automatic=false}:{reference:RoomReference;onChange:(value:RoomReference)=>void;room:RoomSize|null;items:readonly FurnitureItem[];placements:readonly FurniturePlacement[];zones:readonly ReservedZone[];selectedId:string;onSelect:(id:string)=>void;onReserve:(label:string)=>void;automatic?:boolean}){
  const [showPlan,setShowPlan]=useState(true),[compare,setCompare]=useState(false),[split,setSplit]=useState(50),[guides,setGuides]=useState(false),[exportError,setExportError]=useState('');
  const svg=useRef<SVGSVGElement>(null),photo=useRef<HTMLImageElement>(null),valid=validFloorCorners(reference.corners);
  const scene=useMemo(()=>room?buildPhotoScene(reference,room,items,placements):{faces:[],shadows:[],pins:[]},[reference,room,items,placements]);
  useEffect(()=>{setShowPlan(true);setCompare(false);},[reference.image_url,items]);
  function exportConcept(){
    setExportError('');
    try{
      if(!photo.current?.complete||!photo.current.naturalWidth)throw new Error('Wait for the photo to load, then save again.');
      const canvas=document.createElement('canvas');canvas.width=reference.width;canvas.height=reference.height;
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('This browser could not export the concept.');
      ctx.drawImage(photo.current,0,0,canvas.width,canvas.height);drawPhotoScene(ctx,scene,canvas.width,canvas.height);
      const unit=canvas.width/100;ctx.fillStyle='rgba(25,38,24,.9)';ctx.fillRect(0,canvas.height-unit*7,canvas.width,unit*7);
      ctx.fillStyle='#f2f7e9';ctx.font=`500 ${unit*1.7}px sans-serif`;ctx.fillText('WorldOS · Room concept · AI-estimated scale',unit*2,canvas.height-unit*4);
      ctx.fillStyle='#c5d2b9';ctx.font=`${unit*1.1}px sans-serif`;ctx.fillText('Illustrative furniture. Check actual dimensions before purchasing.',unit*2,canvas.height-unit*1.8);
      canvas.toBlob(blob=>{if(!blob){setExportError('The image could not be saved. Try again.');return;}const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='worldos-room-concept.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');
    }catch(error){setExportError(error instanceof Error?error.message:'The image could not be saved. Try again.');}
  }
  return <section className="room-photo-plan" aria-label="Plan in your captured room">
    <div className="room-photo-viewbar"><div className="room-photo-compare" role="group" aria-label="Compare room photo"><button aria-pressed={!showPlan} onClick={()=>{setShowPlan(false);setCompare(false);}}>Original photo</button><button aria-pressed={showPlan&&!compare} onClick={()=>{setShowPlan(true);setCompare(false);}}>With furniture plan</button><button aria-pressed={compare} disabled={!scene.faces.length} onClick={()=>{setShowPlan(true);setCompare(value=>!value);}}><SplitSquareHorizontal size={14}/>Compare</button></div><button className="room-photo-export" onClick={exportConcept} disabled={!scene.faces.length}><Download size={15}/>Save concept</button></div>
    <div className="room-photo-canvas" style={{aspectRatio:reference.width/reference.height}}><img ref={photo} src={reference.image_url} alt="Your captured room with a floor outline and proposed furniture footprints"/>
      <span className="room-photo-badge">{showPlan&&scene.faces.length?'YOUR ROOM · FURNITURE CONCEPT':'YOUR ORIGINAL ROOM'}</span>
      {showPlan&&<div className="room-photo-overlay" style={compare?{clipPath:`inset(0 ${100-split}% 0 0)`}:undefined}>
        <PhotoFurniture scene={scene} width={reference.width} height={reference.height}/>
        <svg ref={svg} style={{touchAction:automatic?'pan-y':'none',cursor:automatic?'default':'crosshair'}} viewBox="0 0 1000 1000" preserveAspectRatio="none" role="group" aria-label="Outline the measured floor area" onPointerDown={event=>{if(automatic||reference.corners.length>=4)return;const r=svg.current?.getBoundingClientRect();if(!r?.width||!r.height)return;onChange({...reference,corners:[...reference.corners,{x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))}]});}}>
          {(guides||!automatic)&&<polygon points={reference.corners.map(p=>`${p.x*1000},${p.y*1000}`).join(' ')} fill="#d5f58012" stroke="#e2ff9d" strokeWidth="2"/>}
          {guides&&valid&&room&&zones.map(zone=>{const points=footprintPolygon(reference.corners,room,zone);return points&&<polygon key={zone.id} points={points} fill="#d2886633" stroke="#ffd0a9" strokeWidth="2"><title>{zone.label}: reserved</title></polygon>;})}
          {valid&&room&&placements.map(placement=>{const item=items.find(i=>i.id===placement.itemId);if(!item)return null;const points=footprintPolygon(reference.corners,room,{...placement,...orientedSize(item,placement.rotation)});return points&&<polygon key={item.id} tabIndex={0} role="button" aria-label={`Select ${item.label} footprint`} aria-pressed={item.id===selectedId} onClick={()=>onSelect(item.id)} onKeyDown={e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();onSelect(item.id);}}} points={points} fill="transparent" stroke={item.id===selectedId?'#eaffba':guides?'#a9eefa':'transparent'} strokeDasharray="6 5" strokeWidth="2"><title>{item.label}</title></polygon>;})}
          {(guides||!automatic)&&reference.corners.map((p,i)=><g key={i} pointerEvents="none"><circle cx={p.x*1000} cy={p.y*1000} r="14" fill="#23351c" stroke="#d5f580" strokeWidth="2"/><text x={p.x*1000} y={p.y*1000+5} textAnchor="middle" fontSize="17" fill="white">{i+1}</text></g>)}
        </svg>
        {scene.pins.map(pin=><button key={pin.id} className={`room-photo-pin ${selectedId===pin.id?'selected':''}`} style={{left:`${pin.point.x*100}%`,top:`${pin.point.y*100}%`}} aria-label={`Inspect ${pin.label} in room photo`} aria-pressed={selectedId===pin.id} onClick={()=>onSelect(pin.id)}><span>{pin.number}</span>{selectedId===pin.id&&<strong>{pin.label}</strong>}</button>)}
      </div>}
      {compare&&<div className="room-photo-divider" style={{left:`${split}%`}}><span><SplitSquareHorizontal size={18}/></span></div>}
    </div>
    {compare&&<label className="room-compare-slider"><span>Furnished</span><input aria-label="Compare original and furnished room" type="range" min="0" max="100" value={split} onChange={e=>setSplit(Number(e.target.value))}/><span>Original</span></label>}
    <div className="room-photo-caption"><p>{automatic?'Furniture concepts follow the estimated floor perspective. Scale and camera angle are approximate.':reference.corners.length<4?`Tap the ${corners[reference.corners.length].toLowerCase()} floor corner. (${reference.corners.length+1}/4)`:'Furniture concepts use the dimensions and floor outline you provided.'}</p><button aria-pressed={guides} onClick={()=>setGuides(v=>!v)}>{guides?'Hide guides':'Show floor & clearances'}</button></div>
    {exportError&&<p role="alert">{exportError}</p>}
    {valid&&room&&placements.length>0&&<div className="room-photo-legend" role="group" aria-label="Furniture in your photo plan">{placements.map(p=>{const item=items.find(i=>i.id===p.itemId);return item&&<button key={item.id} aria-pressed={item.id===selectedId} onClick={()=>onSelect(item.id)}>Select {item.label} in photo <small>{item.width} × {item.depth} m</small></button>;})}</div>}
    <details className="room-photo-adjust"><summary>Adjust floor outline (optional)</summary><div className="room-photo-actions"><button className="room-secondary" disabled={!reference.corners.length} onClick={()=>onChange({...reference,corners:reference.corners.slice(0,-1)})}>Undo corner</button><button className="room-secondary" onClick={()=>onChange({...reference,corners:[{x:.2,y:.2},{x:.8,y:.2},{x:.8,y:.8},{x:.2,y:.8}]})}>Set corners with controls</button></div>
      {reference.corners.length===4&&<div><p>Fine-tune the estimated floor outline if needed.</p>{reference.corners.map((p,i)=><div className="room-corner-fields" key={i}><strong>{corners[i]}</strong>{(['x','y'] as const).map(axis=><label key={axis}>{axis==='x'?'Across':'Down'} (%)<input aria-label={`${corners[i]} ${axis} percent`} type="number" min="0" max="100" step="1" value={Number((p[axis]*100).toFixed(1))} onChange={e=>onChange({...reference,corners:reference.corners.map((q,j)=>i===j?{...q,[axis]:Number(e.target.value)/100}:q)})}/></label>)}</div>)}</div>}
    </details>
    {!automatic&&!!reference.labels.length&&<div className="room-seen-items"><p>Mark floor areas used by furniture that stays.</p>{reference.labels.map(label=><button className="room-secondary" key={label} onClick={()=>onReserve(label)}>Reserve space for {label}</button>)}</div>}
  </section>;
}
