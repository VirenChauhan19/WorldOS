import { useRef } from 'react';
import { footprintPolygon, validFloorCorners } from './photoPlane';
import type { RoomReference } from './photoPlane';
import { orientedSize } from './layout';
import type { FurnitureItem, FurniturePlacement, ReservedZone, RoomSize } from './layout';

const corners=['Back left','Back right','Front right','Front left'];
export default function RoomPhoto({reference,onChange,room,items,placements,zones,selectedId,onSelect,onReserve}:{reference:RoomReference;onChange:(value:RoomReference)=>void;room:RoomSize|null;items:readonly FurnitureItem[];placements:readonly FurniturePlacement[];zones:readonly ReservedZone[];selectedId:string;onSelect:(id:string)=>void;onReserve:(label:string)=>void}){
  const svg=useRef<SVGSVGElement>(null),valid=validFloorCorners(reference.corners);
  return <section className="room-photo-plan" aria-label="Plan in your captured room">
    <div className="room-section-heading"><h2>Your space, with a plan</h2><span>Captured view</span></div>
    <p>{reference.corners.length<4?`Tap the ${corners[reference.corners.length].toLowerCase()} corner of the rectangular floor area you measured. (${reference.corners.length+1}/4)` : valid?'Match this outline to the area you measured: width goes from corner 1 to 2, length from 2 to 3. Furniture footprints use those dimensions.':'The corners must outline one clear rectangle in perspective. Undo a corner and try again.'}</p>
    <div className="room-photo-canvas" style={{aspectRatio:reference.width/reference.height}}><img src={reference.image_url} alt="Your captured room with a floor outline and proposed furniture footprints"/>
      <svg ref={svg} viewBox="0 0 1000 1000" preserveAspectRatio="none" role="group" aria-label="Outline the measured floor area" onPointerDown={event=>{if(reference.corners.length>=4)return;const r=svg.current?.getBoundingClientRect();if(!r||!r.width||!r.height)return;onChange({...reference,corners:[...reference.corners,{x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))}]});}}>
        <polygon points={reference.corners.map(p=>`${p.x*1000},${p.y*1000}`).join(' ')} fill="#d5f58024" stroke="#e2ff9d" strokeWidth="3"/>
        {valid&&room&&zones.map(zone=>{const points=footprintPolygon(reference.corners,room,zone);return points&&<polygon key={zone.id} points={points} fill="#d2886655" stroke="#ffd0a9" strokeWidth="3"><title>{zone.label}: reserved</title></polygon>;})}
        {valid&&room&&placements.map(placement=>{const item=items.find(i=>i.id===placement.itemId);if(!item)return null;const points=footprintPolygon(reference.corners,room,{...placement,...orientedSize(item,placement.rotation)});return points&&<polygon key={item.id} tabIndex={0} role="button" aria-label={`Select ${item.label} footprint`} aria-pressed={item.id===selectedId} onClick={()=>onSelect(item.id)} onKeyDown={e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();onSelect(item.id);}}} points={points} fill={item.id===selectedId?'#d5f58099':'#70c6d577'} stroke={item.id===selectedId?'#eaffba':'#a9eefa'} strokeWidth="4"><title>{item.label}</title></polygon>;})}
        {reference.corners.map((p,i)=><g key={i} pointerEvents="none"><circle cx={p.x*1000} cy={p.y*1000} r="17" fill="#23351c" stroke="#d5f580" strokeWidth="3"/><text x={p.x*1000} y={p.y*1000+6} textAnchor="middle" fontSize="20" fill="white">{i+1}</text></g>)}
      </svg>
    </div>
    {valid&&room&&placements.length>0&&<div className="room-photo-legend" role="group" aria-label="Furniture in your photo plan">{placements.map(p=>{const item=items.find(i=>i.id===p.itemId);return item&&<button key={item.id} aria-pressed={item.id===selectedId} onClick={()=>onSelect(item.id)}>Select {item.label} in photo <small>{item.width} × {item.depth} m</small></button>;})}</div>}
    <div className="room-photo-actions"><button className="room-secondary" disabled={!reference.corners.length} onClick={()=>onChange({...reference,corners:reference.corners.slice(0,-1)})}>Undo corner</button><button className="room-secondary" onClick={()=>onChange({...reference,corners:[{x:.2,y:.2},{x:.8,y:.2},{x:.8,y:.8},{x:.2,y:.8}]})}>Set corners with controls</button></div>
    {reference.corners.length===4&&<details><summary>Adjust outline precisely</summary><p>Move each corner onto your measured floor area. The starting outline is a guide you must adjust.</p>{reference.corners.map((p,i)=><div className="room-corner-fields" key={i}><strong>{corners[i]}</strong>{(['x','y'] as const).map(axis=><label key={axis}>{axis==='x'?'Across':'Down'} (%)<input aria-label={`${corners[i]} ${axis} percent`} type="number" min="0" max="100" step="1" value={Number((p[axis]*100).toFixed(1))} onChange={e=>onChange({...reference,corners:reference.corners.map((q,j)=>i===j?{...q,[axis]:Number(e.target.value)/100}:q)})}/></label>)}</div>)}</details>}
    {!!reference.labels.length&&<div className="room-seen-items"><p>Visible object suggestions — mark their actual floor area if they stay.</p>{reference.labels.map(label=><button className="room-secondary" key={label} onClick={()=>onReserve(label)}>Reserve space for {label}</button>)}</div>}
    <p className="room-fine-print">This is a floor-footprint preview on your captured photo. It does not infer height, distance, hidden obstacles, or a 3D room from the image.</p>
  </section>;
}
