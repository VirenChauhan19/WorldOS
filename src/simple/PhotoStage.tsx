import { useId, useState } from 'react';
import Photo from '../ui/Photo';
import type { Box, Movement, SceneImage, SceneObject } from '../types';

export default function PhotoStage({image,objects=[],move,mark,onMark,highlight=[]}:{image:SceneImage;objects?:SceneObject[];move?:Movement;mark?:string;onMark?:(box:Box)=>void;highlight?:string[]}){
  const arrow=useId().replaceAll(':','');
  const [first,setFirst]=useState<{x:number;y:number}|null>(null),[cursor,setCursor]=useState({x:.35,y:.35}),[keyboard,setKeyboard]=useState(false),[error,setError]=useState('');
  function point(p:{x:number;y:number}){
    if(!mark)return;
    if(!first){setFirst(p);setError('');return;}
    const box={x:Math.min(first.x,p.x),y:Math.min(first.y,p.y),width:Math.abs(first.x-p.x),height:Math.abs(first.y-p.y)};
    if(box.width<.005||box.height<.005){setError('Choose the opposite corner so the outline surrounds the whole item.');return;}
    setFirst(null);setError('');onMark?.(box);
  }
  return <div className="photo-stage-wrap">
    {mark&&<p className="mark-help" role="status">{first?'Now tap the opposite corner.':`Tap one corner of the ${mark}, then the opposite corner.`} <span>With a keyboard, use arrow keys to move the crosshair and Enter to mark each corner.</span></p>}
    <div className={`simple-photo ${mark?'is-marking':''}`} style={{aspectRatio:`${image.width}/${image.height}`}}
      role={mark?'button':undefined} tabIndex={mark?0:undefined} aria-label={mark?`Mark ${mark} on the photo`:undefined}
      onPointerDown={mark?e=>{if(e.pointerType==='mouse')e.preventDefault();}:undefined}
      onClick={mark?e=>{if(!e.detail)return;const r=e.currentTarget.getBoundingClientRect();point({x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))});}:undefined}
      onKeyDown={mark?e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();setKeyboard(true);const d=e.shiftKey?.05:.01;setCursor(p=>({x:Math.min(1,Math.max(0,p.x+(e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0))),y:Math.min(1,Math.max(0,p.y+(e.key==='ArrowUp'?-d:e.key==='ArrowDown'?d:0)))}));}else if(e.key==='Enter'||e.key===' '){e.preventDefault();setKeyboard(true);point(cursor);}else if(e.key==='Escape'){setFirst(null);}}:undefined}>
      <Photo src={image.image_url} alt={mark?`Photograph for marking ${mark}`:'Your space'} width={image.width} height={image.height}/>
      <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
        <defs><marker id={arrow} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L6,3 L0,6 Z" fill="#0866ff"/></marker></defs>
        {objects.map(o=><g key={o.id} className={highlight.includes(o.id)?'photo-mark affected':'photo-mark'}><rect x={o.box.x*1000} y={o.box.y*1000} width={o.box.width*1000} height={o.box.height*1000} rx="5" vectorEffect="non-scaling-stroke"/><text x={o.box.x*1000+7} y={Math.max(22,o.box.y*1000-8)}>{o.label}</text></g>)}
        {move&&<g className="simple-move"><rect x={move.destination.x*1000} y={move.destination.y*1000} width={move.destination.width*1000} height={move.destination.height*1000} vectorEffect="non-scaling-stroke"/><line x1={(move.source.x+move.source.width/2)*1000} y1={(move.source.y+move.source.height/2)*1000} x2={(move.destination.x+move.destination.width/2)*1000} y2={(move.destination.y+move.destination.height/2)*1000} markerEnd={`url(#${arrow})`} vectorEffect="non-scaling-stroke"/></g>}
        {first&&<circle cx={first.x*1000} cy={first.y*1000} r="9" fill="#0866ff"/>}
        {keyboard&&mark&&<path d={`M${cursor.x*1000-16},${cursor.y*1000} h32 M${cursor.x*1000},${cursor.y*1000-16} v32`} stroke="#ffbf00" strokeWidth="3" vectorEffect="non-scaling-stroke"/>}
      </svg>
    </div>{error&&<p role="alert">{error}</p>}
  </div>;
}
