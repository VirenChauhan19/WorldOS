import type { Box, SceneObject } from '../types';
import { clamp } from '../geometry';

export default function ObjectEditor({object,onChange,onDelete,busy}:{object:SceneObject;onChange:(o:SceneObject)=>void;onDelete?:()=>void;busy:boolean}) {
  function coordinate(key:keyof Box,value:number) {
    if(!Number.isFinite(value)) return;
    const box={...object.box}; const n=value/100;
    if(key==='x') box.x=clamp(n,0,1-box.width);
    if(key==='y') box.y=clamp(n,0,1-box.height);
    if(key==='width') box.width=clamp(n,.015,1-box.x);
    if(key==='height') box.height=clamp(n,.015,1-box.y);
    onChange({...object,box,source:'ai_corrected',confidence:null});
  }
  return <fieldset disabled={busy} className="inspection-object-editor"><label>Object label<input aria-label="Inspection object label" value={object.label} maxLength={80} onChange={e=>onChange({...object,label:e.target.value,source:'ai_corrected',confidence:null})}/></label><div className="alignment-fields">{(['x','y','width','height'] as const).map(key=><label key={key}>{key} (%)<input aria-label={`Inspection object ${key}`} type="number" min="0" max="100" step=".1" value={Number((object.box[key]*100).toFixed(2))} onChange={e=>coordinate(key,Number(e.target.value))}/></label>)}</div>{onDelete && <button className="text-button danger" onClick={onDelete}>Remove annotation</button>}</fieldset>;
}
