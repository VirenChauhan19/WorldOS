import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { boxFromPoints, center, clamp, resizeBox, translateBox } from './geometry';
import type { Box, Plan, SceneImage, SceneObject, Tool } from './types';

interface Props {
  image: SceneImage; objects: SceneObject[]; target: Box | null; workspace: Box;
  tool: Tool; selected: string | null; onSelect: (id: string) => void;
  onObjects: (objects: SceneObject[]) => void; onTarget: (box: Box) => void;
  onWorkspace: (box: Box) => void; onAdd: (box: Box) => void;
  plan?: Plan | null; mode?: 'annotate' | 'plan' | 'final'; showBoxes: boolean;
  placementStatuses?: Record<string, string>;
}
type Gesture = { start: { x: number; y: number }; id?: string; original?: Box; resize?: boolean; kind: Tool };
const rect = (b: Box) => ({ x: b.x * 1000, y: b.y * 1000, width: b.width * 1000, height: b.height * 1000 });
export default function Canvas({ image, objects, target, workspace, tool, selected, onSelect, onObjects, onTarget, onWorkspace, onAdd, plan, mode = 'annotate', showBoxes, placementStatuses = {} }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<Box | null>(null);
  const editable = mode !== 'plan';
  function point(event: PointerEvent<SVGSVGElement>) {
    const bounds = svg.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) / bounds.width), y: clamp((event.clientY - bounds.top) / bounds.height) };
  }
  function down(event: PointerEvent<SVGSVGElement>) {
    if (!editable || event.button !== 0) return;
    const element = event.target as SVGElement;
    const id = element.closest('[data-object]')?.getAttribute('data-object');
    const p = point(event);
    if (tool === 'select' && id) {
      onSelect(id);
      const obj = objects.find(o => o.id === id)!;
      gesture.current = { start: p, id, original: { ...obj.box }, resize: element.hasAttribute('data-resize'), kind: tool };
    } else if (tool !== 'select') {
      gesture.current = { start: p, kind: tool }; setDraft({ ...p, width: 0, height: 0 });
    }
    if (gesture.current) { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const g = gesture.current; if (!g) return;
    const p = point(event);
    if (g.id && g.original) {
      const box = g.resize ? resizeBox(g.original, p.x - g.start.x, p.y - g.start.y) : translateBox(g.original, p.x - g.start.x, p.y - g.start.y);
      onObjects(objects.map(obj => obj.id === g.id ? { ...obj, box } : obj));
    } else setDraft(boxFromPoints(g.start, p));
  }
  function up(event: PointerEvent<SVGSVGElement>) {
    const g = gesture.current; if (!g) return;
    if (!g.id) {
      const box = boxFromPoints(g.start, point(event));
      if (box.width > 0.015 && box.height > 0.015) {
        if (g.kind === 'object') onAdd(box);
        if (g.kind === 'target') onTarget(box);
        if (g.kind === 'workspace') onWorkspace(box);
      }
    }
    gesture.current = null; setDraft(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div className={`scene-canvas tool-${tool}`} style={{ aspectRatio: `${image.width} / ${image.height}` }}>
    <img src={image.image_url} alt={mode === 'final' ? 'Uploaded final scene with reviewed or detected positions' : 'Workspace to annotate and reorganize'} draggable={false}/>
    <svg ref={svg} viewBox="0 0 1000 1000" preserveAspectRatio="none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { gesture.current = null; setDraft(null); }} aria-label="Spatial annotation canvas">
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="#d9f99d" strokeWidth="1.5"/></marker><pattern id="target-grid" width="22" height="30" patternUnits="userSpaceOnUse"><path d="M 0 30 L 22 0" stroke="#d9f99d" strokeOpacity=".1" strokeWidth="1"/></pattern></defs>
      {(workspace.width < 0.999 || workspace.height < 0.999) && <rect {...rect(workspace)} fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
      {target && <g pointerEvents="none"><rect {...rect(target)} fill="url(#target-grid)" stroke="#d9f99d" strokeWidth="1.5" strokeDasharray="7 5" vectorEffect="non-scaling-stroke"/><rect x={target.x * 1000} y={target.y * 1000} width="142" height="29" fill="#d9f99d"/><text x={target.x * 1000 + 10} y={target.y * 1000 + 20} fill="#203211" fontSize="16" fontWeight="600">TARGET SPACE</text></g>}
      {showBoxes && objects.map((obj, index) => {
        const isLocked = plan ? plan.locked_ids.includes(obj.id) : obj.locked;
        const status = placementStatuses[obj.id];
        const color = status === 'completed' ? '#bbef9b' : status === 'incomplete' ? '#ffa38e' : status === 'uncertain' || status === 'missing' ? '#f8ca87' : isLocked ? '#f8ca87' : '#a6c8ff';
        const b = rect(obj.box);
        return <g key={obj.id} data-object={obj.id} className="object-box" style={{ cursor: editable && tool === 'select' ? 'move' : undefined }}>
          <rect {...b} fill={selected === obj.id ? `${color}25` : `${color}0c`} stroke={color} strokeWidth={selected === obj.id ? 2 : 1} vectorEffect="non-scaling-stroke"/>
          <rect x={b.x} y={Math.max(0, b.y - 31)} width={Math.min(190, Math.max(95, obj.label.length * 10 + 43))} height="30" rx="3" fill={color}/>
          <text x={b.x + 9} y={Math.max(0, b.y - 31) + 21} fontSize="18" fill="#172018" fontWeight="600">{isLocked ? '⌑' : `0${index + 1}`} {obj.label.slice(0, 15)}</text>
          {editable && selected === obj.id && tool === 'select' && <rect data-resize="true" x={b.x + b.width - 8} y={b.y + b.height - 11} width="16" height="22" fill={color} stroke="#192020" strokeWidth="1" style={{cursor: 'nwse-resize'}}/>}
        </g>;
      })}
      {mode === 'final' && showBoxes && plan?.final_objects.map(obj => <g key={`expected-${obj.id}`} pointerEvents="none"><rect {...rect(obj.box)} fill="none" stroke="#d9f99d" strokeOpacity=".65" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke"/><text x={obj.box.x*1000+4} y={(obj.box.y+obj.box.height)*1000-5} fill="#d9f99d" fontSize="13">PLANNED {obj.label}</text></g>)}
      {mode === 'plan' && plan?.movements.map(step => {
        const a = center(step.source), b = center(step.destination);
        return <g key={step.number} pointerEvents="none"><rect {...rect(step.destination)} fill="#d9f99d20" stroke="#d9f99d" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/><path d={`M ${a.x * 1000} ${a.y * 1000} Q ${a.x * 1000} ${b.y * 1000} ${b.x * 1000} ${b.y * 1000}`} stroke="#d9f99d" strokeWidth="2.5" vectorEffect="non-scaling-stroke" fill="none" markerEnd="url(#arrow)"/><circle cx={b.x * 1000} cy={b.y * 1000} r="18" fill="#d9f99d"/><text x={b.x * 1000} y={b.y * 1000 + 7} textAnchor="middle" fill="#172018" fontSize="21" fontWeight="700">{step.number}</text></g>;
      })}
      {draft && <rect {...rect(draft)} fill="#d9f99d20" stroke="#d9f99d" strokeWidth="2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
    </svg>
  </div>;
}
