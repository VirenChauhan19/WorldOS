import { useId, useRef, useState } from 'react';
import Photo from './ui/Photo';
import type { PointerEvent } from 'react';
import { boxFromPoints, center, clamp, resizeBox, translateBox } from './geometry';
import type { Box, Plan, SceneImage, SceneObject, Tool } from './types';

interface Props {
  image: SceneImage; objects: SceneObject[]; target: Box | null; workspace: Box;
  tool: Tool; selected: string | null; onSelect: (id: string) => void;
  onObjects: (objects: SceneObject[]) => void; onTarget: (box: Box) => void;
  onWorkspace: (box: Box) => void; onAdd: (box: Box) => void;
  plan?: Plan | null; mode?: 'annotate' | 'plan' | 'final'; showBoxes: boolean;
  placementStatuses?: Record<string, string>; activeMovement?: number;
  disabled?: boolean;
}
type Gesture = { start: { x: number; y: number }; pointerId:number; id?: string; original?: Box; resize?: boolean; kind: Tool };
const rect = (b: Box) => ({ x: b.x * 1000, y: b.y * 1000, width: b.width * 1000, height: b.height * 1000 });
export default function Canvas({ image, objects, target, workspace, tool, selected, onSelect, onObjects, onTarget, onWorkspace, onAdd, plan, mode = 'annotate', showBoxes, placementStatuses = {}, activeMovement,disabled=false }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<Box | null>(null);
  const [dragBox,setDragBox]=useState<{id:string;box:Box}|null>(null);
  const markerId=useId(),patternId=useId();
  const [zoom,setZoom]=useState(1);
  const [pan,setPan]=useState(false);
  const editable = mode !== 'plan';
  function point(event: PointerEvent<SVGSVGElement>) {
    const bounds = svg.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) / bounds.width), y: clamp((event.clientY - bounds.top) / bounds.height) };
  }
  function down(event: PointerEvent<SVGSVGElement>) {
    if (disabled || !editable || pan || event.button !== 0 || event.isPrimary===false) return;
    const element = event.target as SVGElement;
    const id = element.closest('[data-object]')?.getAttribute('data-object');
    const p = point(event);
    if (tool === 'select' && id) {
      onSelect(id);
      // A first touch selects without moving the object under the user's finger.
      if(event.pointerType==='touch'&&selected!==id)return;
      const obj = objects.find(o => o.id === id)!;
      gesture.current = { start: p, pointerId:event.pointerId, id, original: { ...obj.box }, resize: element.hasAttribute('data-resize'), kind: tool };
    } else if (tool !== 'select') {
      gesture.current = { start: p, pointerId:event.pointerId, kind: tool }; setDraft({ ...p, width: 0, height: 0 });
    }
    if (gesture.current) { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const g = gesture.current; if (!g || event.pointerId!==g.pointerId) return;
    const p = point(event);
    if (g.id && g.original) {
      const box = g.resize ? resizeBox(g.original, p.x - g.start.x, p.y - g.start.y) : translateBox(g.original, p.x - g.start.x, p.y - g.start.y);
      // Preview locally; commit once on release so dragging does not rerender the whole workspace.
      setDragBox({id:g.id,box});
    } else setDraft(boxFromPoints(g.start, p));
  }
  function up(event: PointerEvent<SVGSVGElement>) {
    const g = gesture.current; if (!g || event.pointerId!==g.pointerId) return;
    if(disabled){gesture.current=null;setDraft(null);setDragBox(null);return;}
    if(g.id&&g.original){
      const p=point(event);
      const box=g.resize?resizeBox(g.original,p.x-g.start.x,p.y-g.start.y):translateBox(g.original,p.x-g.start.x,p.y-g.start.y);
      if(JSON.stringify(box)!==JSON.stringify(g.original))onObjects(objects.map(obj=>obj.id===g.id?{...obj,box}:obj));
    } else if (!g.id) {
      const box = boxFromPoints(g.start, point(event));
      if (box.width > 0.015 && box.height > 0.015) {
        if (g.kind === 'object') onAdd(box);
        if (g.kind === 'target') onTarget(box);
        if (g.kind === 'workspace') onWorkspace(box);
      }
    }
    gesture.current = null; setDraft(null);setDragBox(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div className="canvas-frame"><div className="canvas-access">
    <label>Object<select aria-label="Canvas object selection" value={selected??''} onChange={e=>{if(e.target.value)onSelect(e.target.value);}}><option value="">Select an object</option>{objects.map((obj,index)=><option key={obj.id} value={obj.id}>{index+1}. {obj.label}</option>)}</select></label>
    <button aria-label="Zoom photo out" disabled={zoom===1} onClick={()=>setZoom(Math.max(1,zoom-.5))}>−</button><span aria-live="polite">{Math.round(zoom*100)}%</span><button aria-label="Zoom photo in" disabled={zoom===3} onClick={()=>{setZoom(Math.min(3,zoom+.5));setPan(true);}}>+</button>
    {editable&&<button aria-pressed={pan} onClick={()=>{gesture.current=null;setDraft(null);setDragBox(null);setPan(!pan);}}>{pan?'Pan photo':'Edit boxes'}</button>}
  </div><div className="canvas-scroll"><div className="canvas-zoom" style={{width:`${zoom*100}%`}}><div className={`scene-canvas tool-${tool} ${pan||!editable?'canvas-pan':''}`} style={{ aspectRatio: `${image.width} / ${image.height}` }}>
    <Photo src={image.image_url} width={image.width} height={image.height} alt={mode === 'final' ? 'Uploaded final scene with reviewed or detected positions' : 'Workspace to annotate and reorganize'}/>
    <svg ref={svg} viewBox="0 0 1000 1000" preserveAspectRatio="none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { gesture.current = null; setDraft(null);setDragBox(null); }} onLostPointerCapture={()=>{gesture.current=null;setDraft(null);setDragBox(null);}} aria-label="Spatial annotation canvas">
      <defs><marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="#d9f99d" strokeWidth="1.5"/></marker><pattern id={patternId} width="22" height="30" patternUnits="userSpaceOnUse"><path d="M 0 30 L 22 0" stroke="#d9f99d" strokeOpacity=".1" strokeWidth="1"/></pattern></defs>
      {(workspace.width < 0.999 || workspace.height < 0.999) && <rect {...rect(workspace)} fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
      {target && <g pointerEvents="none"><rect {...rect(target)} fill={`url(#${patternId})`} stroke="#d9f99d" strokeWidth="1.5" strokeDasharray="7 5" vectorEffect="non-scaling-stroke"/><rect x={target.x * 1000} y={target.y * 1000} width="142" height="29" fill="#d9f99d"/><text x={target.x * 1000 + 10} y={target.y * 1000 + 20} fill="#203211" fontSize="16" fontWeight="600">TARGET SPACE</text></g>}
      {showBoxes && objects.map((obj, index) => {
        const isLocked = plan ? plan.locked_ids.includes(obj.id) : obj.locked;
        const status = placementStatuses[obj.id];
        const color = status === 'completed' ? '#bbef9b' : status === 'incomplete' ? '#ffa38e' : status === 'uncertain' || status === 'missing' ? '#f8ca87' : isLocked ? '#f8ca87' : '#a6c8ff';
        const b = rect(dragBox?.id===obj.id?dragBox.box:obj.box);
        return <g key={obj.id} data-object={obj.id} className="object-box" role="button" tabIndex={0} aria-label={`Select ${obj.label} annotation`} onClick={()=>{if(!editable)onSelect(obj.id);}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect(obj.id);}}} style={{ cursor: editable && tool === 'select' ? 'move' : undefined }}>
          <rect {...b} fill={selected === obj.id ? `${color}25` : `${color}0c`} stroke={color} strokeWidth={selected === obj.id ? 2 : 1} vectorEffect="non-scaling-stroke"/>
          <rect x={b.x} y={Math.max(0, b.y - 31)} width={Math.min(190, Math.max(95, obj.label.length * 10 + 43))} height="30" rx="3" fill={color}/>
          <text x={b.x + 9} y={Math.max(0, b.y - 31) + 21} fontSize="18" fill="#172018" fontWeight="600">{isLocked ? '⌑' : `0${index + 1}`} {obj.label.slice(0, 15)}</text>
          {editable && selected === obj.id && tool === 'select' && <g><rect className="resize-hit" data-resize="true" x={b.x+b.width-55} y={b.y+b.height-55} width="110" height="110"/><rect data-resize="true" x={b.x + b.width - 12} y={b.y + b.height - 12} width="24" height="24" fill={color} stroke="#192020" strokeWidth="1" style={{cursor: 'nwse-resize'}}/></g>}
        </g>;
      })}
      {mode === 'final' && showBoxes && plan?.final_objects.map(obj => <g key={`expected-${obj.id}`} pointerEvents="none"><rect {...rect(obj.box)} fill="none" stroke="#d9f99d" strokeOpacity=".65" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke"/><text x={obj.box.x*1000+4} y={(obj.box.y+obj.box.height)*1000-5} fill="#d9f99d" fontSize="13">PLANNED {obj.label}</text></g>)}
      {mode === 'plan' && plan?.movements.map(step => {
        const a = center(step.source), b = center(step.destination);
        const path = `M ${a.x * 1000} ${a.y * 1000} Q ${a.x * 1000} ${b.y * 1000} ${b.x * 1000} ${b.y * 1000}`;
        return <g className="correction-arrow" key={step.number} pointerEvents="none" opacity={activeMovement == null || activeMovement === step.number ? 1 : .25} aria-label={`Movement ${step.number}: ${step.label}`}><rect {...rect(step.destination)} fill="#d9f99d20" stroke="#d9f99d" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/><path d={path} stroke="#d9f99d" strokeWidth="2.5" vectorEffect="non-scaling-stroke" fill="none" markerEnd={`url(#${markerId})`}/><circle cx={b.x * 1000} cy={b.y * 1000} r="18" fill="#d9f99d"/><text x={b.x * 1000} y={b.y * 1000 + 7} textAnchor="middle" fill="#172018" fontSize="21" fontWeight="700">{step.number}</text></g>;
      })}
      {draft && <rect {...rect(draft)} fill="#d9f99d20" stroke="#d9f99d" strokeWidth="2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
    </svg>
  </div></div></div></div>;
}
