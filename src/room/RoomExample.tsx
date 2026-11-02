import { useMemo, useState } from 'react';
import { ArrowRight, Move3D } from 'lucide-react';
import Dialog from '../ui/Dialog';
import RoomPreview from './RoomPreview';
import { FURNITURE_PRESETS, planRoom } from './layout';

const size={width:3.6,depth:3.2,height:2.5};
const pieces=FURNITURE_PRESETS.filter(p=>['bed','desk','wardrobe'].includes(p.kind));
export default function RoomExample({open,onClose,onStart}:{open:boolean;onClose:()=>void;onStart:()=>void}){
  const [selected,setSelected]=useState(pieces[0].id);
  const layout=useMemo(()=>planRoom(size,pieces,.3),[]);
  return <Dialog open={open} onClose={onClose} title="Room plan example"><div className="room-example"><span className="room-example-label">EXAMPLE ROOM · 3.6 × 3.2 M</span><p>Example layout with a bed, desk, and wardrobe. Drag to rotate the view. Select a piece to inspect it.</p><RoomPreview room={size} items={pieces} placements={layout.placements} selectedId={selected} onSelect={setSelected}/><div className="room-example-pieces">{pieces.map(p=><button key={p.id} aria-pressed={selected===p.id} onClick={()=>setSelected(p.id)}>{p.label}<small>{p.width} × {p.depth} m</small></button>)}</div><p className="room-example-note"><Move3D size={16}/>An example arrangement with editable furniture sizes. Your own plan uses your measurements.</p><button className="primary" onClick={()=>{onClose();onStart();}}>Plan my own space<ArrowRight size={18}/></button></div></Dialog>;
}
