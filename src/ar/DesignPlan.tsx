import { useId, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DesignScene } from './scene';
import { orientedSize } from '../room/layout';

export default function DesignPlan({scene,selectedId,onSelect,onBegin,onMove,onEnd}:{scene:DesignScene;selectedId:string;onSelect:(id:string)=>void;onBegin:()=>void;onMove:(id:string,x:number,z:number,record?:boolean)=>void;onEnd:()=>void}) {
  const grid=useId(),svg=useRef<SVGSVGElement>(null),drag=useRef<{id:string;dx:number;dz:number}|null>(null);
  function point(event:ReactPointerEvent<SVGElement>){const element=svg.current,ctm=element?.getScreenCTM();if(!element||!ctm)return null;const p=element.createSVGPoint();p.x=event.clientX;p.y=event.clientY;return p.matrixTransform(ctm.inverse());}
  function end(){if(drag.current){drag.current=null;onEnd();}}
  return <div className="design-plan"><svg ref={svg} viewBox={`-.35 -.35 ${scene.room.width+.7} ${scene.room.depth+.7}`} role="group" aria-label="Arrange objects in floor plan" onPointerMove={event=>{const p=point(event);if(p&&drag.current)onMove(drag.current.id,p.x-drag.current.dx,p.y-drag.current.dz,false);}} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    <defs><pattern id={grid} width=".25" height=".25" patternUnits="userSpaceOnUse"><path d="M .25 0H0V.25" fill="none" stroke="#becbbf" strokeWidth=".008"/></pattern></defs>
    <rect width={scene.room.width} height={scene.room.depth} fill="#fbfcf8" stroke="#7d927e" strokeWidth=".035"/>
    <rect width={scene.room.width} height={scene.room.depth} fill={`url(#${grid})`}/>
    <text x={scene.room.width/2} y="-.13" textAnchor="middle" fontSize=".13" fill="#69816b">{scene.room.width} m</text>
    {scene.objects.map(({item,placement})=>{const size=orientedSize(item,placement.rotation);return <g key={item.id} tabIndex={0} role="button" aria-label={`Move ${item.label} in floor plan`} aria-pressed={selectedId===item.id} onFocus={()=>onSelect(item.id)} onPointerDown={event=>{event.preventDefault();const p=point(event);if(!p)return;onSelect(item.id);onBegin();event.currentTarget.setPointerCapture(event.pointerId);drag.current={id:item.id,dx:p.x-placement.x,dz:p.y-placement.z};}} onKeyDown={event=>{const moves:Record<string,[number,number]>={ArrowLeft:[-.1,0],ArrowRight:[.1,0],ArrowUp:[0,-.1],ArrowDown:[0,.1]};if(moves[event.key]){event.preventDefault();const [x,z]=moves[event.key];onMove(item.id,placement.x+x,placement.z+z);}}}>
      <rect x={placement.x} y={placement.z} width={size.width} height={size.depth} rx=".04" fill={item.color} fillOpacity=".7" stroke={selectedId===item.id?'#264e3c':'#879c85'} strokeWidth={selectedId===item.id ? .045 : .02}/>
      <text x={placement.x+size.width/2} y={placement.z+size.depth/2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.max(.07,Math.min(.14,size.width*.14))} fill="#24432f">{item.label}</text>
    </g>;})}
  </svg><p>Drag pieces to arrange. Arrow keys move a selected piece 10 cm.</p></div>;
}
