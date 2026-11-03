import { useEffect, useState } from 'react';
import { imageLocation } from './objectEvidence';
import type { SceneObject } from '../types';

export default function ObjectInspection({object,held,detail,onCorrect,onRemove,onExplain}:{
  object:SceneObject; held:boolean; detail?:string;
  onCorrect:(label:string)=>void; onRemove:()=>void; onExplain:()=>void;
}) {
  const [editing,setEditing]=useState(false),[label,setLabel]=useState(object.label);
  useEffect(()=>{setEditing(false);setLabel(object.label);},[object.id,object.label]);
  return <section className="object-inspection" aria-label="Selected object details">
    <span className="live-kicker">{held?'IN THIS CAPTURED VIEW':'IN YOUR CAMERA'}</span>
    <p><strong>{imageLocation(object)}</strong> of the image. {detail||(object.source==='ai_corrected'?'You supplied this label for the captured photo.':'This is a suggested object label. Check it against the photo.')}</p>
    <div className="object-inspection-actions"><button onClick={onExplain}>Explain this object</button>{held&&<><button onClick={()=>setEditing(!editing)} aria-expanded={editing}>Correct label</button><button onClick={onRemove}>Remove label</button></>}</div>
    {editing&&<form onSubmit={event=>{event.preventDefault();if(label.trim()){onCorrect(label.trim());setEditing(false);}}}>
      <label htmlFor="held-object-label">Object label</label>
      <div><input id="held-object-label" value={label} maxLength={60} onChange={event=>setLabel(event.target.value)} autoFocus/><button disabled={!label.trim()} type="submit">Apply label</button></div>
      <small>Changes this captured view and the notes saved with it.</small>
    </form>}
  </section>;
}
