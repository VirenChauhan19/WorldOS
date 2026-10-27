import { useState } from 'react';
import PhotoStage from './PhotoStage';
import type { Box, SceneImage, SceneObject } from '../types';
import type { InspectionRecord, InspectionReview, ReferenceObject } from '../inspect/types';

export function SetupItems({image,objects,onChange,disabled}:{image:SceneImage;objects:ReferenceObject[];onChange:(items:ReferenceObject[])=>void;disabled:boolean}){
  const [label,setLabel]=useState(''),[mark,setMark]=useState<{id:string;label:string}|null>(null);
  function marked(box:Box){if(!mark)return;const old=objects.find(o=>o.id===mark.id);onChange([...objects.filter(o=>o.id!==mark.id),{...old,id:mark.id,label:mark.label,box,locked:old?.locked??false,required:old?.required??true,tolerance:old?.tolerance??.025,source:old?.source==='sam_3_1'?'ai_corrected':'manual',confidence:null}]);setMark(null);setLabel('');}
  return <div className="item-review"><PhotoStage key={mark?.id??'view'} image={image} objects={objects} mark={disabled?undefined:mark?.label} onMark={marked}/>
    {mark?<button className="text-button" disabled={disabled} onClick={()=>setMark(null)}>Cancel outline</button>:<form className="add-item" onSubmit={e=>{e.preventDefault();if(label.trim()&&!disabled)setMark({id:crypto.randomUUID(),label:label.trim()});}}><label>What would you like to keep track of?<input value={label} maxLength={80} placeholder="For example, phone" disabled={disabled} onChange={e=>setLabel(e.target.value)}/></label><button className="secondary" disabled={disabled||!label.trim()||objects.length>=12}>Mark this item</button></form>}
    {!!objects.length&&<ul className="review-items">{objects.map(o=><li key={o.id}><strong>{o.label}</strong><span><button className="text-button" disabled={disabled} onClick={()=>setMark({id:o.id,label:o.label})} aria-label={`Adjust ${o.label}`}>Adjust</button><button className="text-button" disabled={disabled} onClick={()=>onChange(objects.filter(v=>v.id!==o.id))} aria-label={`Remove ${o.label}`}>Remove</button></span></li>)}</ul>}
    <p className="quiet">Outline each whole item. Leave space between outlines. These marks are yours, not automatic detections.</p>
  </div>;
}

export default function ItemReview({image,references,record,value,onChange,disabled}:{image:SceneImage;references:ReferenceObject[];record:InspectionRecord|null;value:InspectionReview;onChange:(value:InspectionReview)=>void;disabled:boolean}){
  const [mark,setMark]=useState<{id:string;label:string}|null>(null),[extra,setExtra]=useState('');
  const detections=record?.analysis.objects??[];
  const pool=[...detections.filter(o=>!value.ignored_detection_ids.includes(o.id)&&!value.manual_objects.some(m=>m.id===o.id)),...value.manual_objects];
  const facts=record?.reviewed_result??record?.automatic_result;
  function choose(identity:string,detection:string|null){onChange({...value,assignments:{...value.assignments,[identity]:detection},confirmed_missing_ids:[...value.confirmed_missing_ids.filter(id=>id!==identity),...(detection===null?[identity]:[])],inventory_confirmed:false});}
  function marked(box:Box){if(!mark)return;const observed:SceneObject={id:`manual-${mark.id}`,label:mark.label,box,locked:false,source:'manual',confidence:null};const isReference=references.some(o=>o.id===mark.id);onChange({...value,manual_objects:[...value.manual_objects.filter(o=>o.id!==observed.id),observed],assignments:isReference?{...value.assignments,[mark.id]:observed.id}:value.assignments,confirmed_missing_ids:value.confirmed_missing_ids.filter(id=>id!==mark.id),inventory_confirmed:false});setMark(null);setExtra('');}
  return <div className="item-review"><h2>Check each item</h2><p>Tell us what you can actually see. If you’re unsure, leave it unresolved. We won’t call it fixed.</p>
    <PhotoStage key={mark?.id??'review'} image={image} objects={pool} mark={disabled?undefined:mark?.label} onMark={marked}/>
    {mark&&<button className="text-button" disabled={disabled} onClick={()=>setMark(null)}>Cancel outline</button>}
    <ul className="review-items">{references.map(o=>{const assigned=Object.hasOwn(value.assignments,o.id);const suggested=facts?.objects.find(row=>row.object_id===o.id)?.detection_id;return <li key={o.id}><div><strong>{o.label}</strong><small>{assigned?(value.assignments[o.id]===null?'You marked it missing.':'You marked its position.'):'Not checked yet'}</small></div><div className="review-options">
      {suggested&&!assigned&&<button className="secondary" disabled={disabled} onClick={()=>choose(o.id,suggested)}>Yes, that’s {o.label}</button>}
      <button className="secondary" disabled={disabled} onClick={()=>setMark({id:o.id,label:o.label})}>Mark {o.label}</button>
      <button className="text-button" disabled={disabled} onClick={()=>choose(o.id,null)}>It’s not here</button>
      {assigned&&<button className="text-button" disabled={disabled} onClick={()=>{const choices={...value.assignments};delete choices[o.id];onChange({...value,assignments:choices,confirmed_missing_ids:value.confirmed_missing_ids.filter(id=>id!==o.id),manual_objects:value.manual_objects.filter(v=>v.id!==`manual-${o.id}`),inventory_confirmed:false});}}>I’m not sure</button>}
    </div></li>;})}</ul>
    {detections.filter(o=>!Object.values(value.assignments).includes(o.id)).map(o=><label className="simple-check" key={o.id}><input type="checkbox" disabled={disabled} checked={value.ignored_detection_ids.includes(o.id)} onChange={e=>onChange({...value,ignored_detection_ids:e.target.checked?[...value.ignored_detection_ids,o.id]:value.ignored_detection_ids.filter(id=>id!==o.id),inventory_confirmed:false})}/>Ignore “{o.label}” — I checked that this outline is a duplicate or not a real item.</label>)}
    {value.manual_objects.filter(o=>!Object.values(value.assignments).includes(o.id)).map(o=><div className="space-with-action" key={o.id}><span>Extra item: {o.label}</span><button className="text-button" disabled={disabled} onClick={()=>onChange({...value,manual_objects:value.manual_objects.filter(item=>item.id!==o.id),inventory_confirmed:false})}>Remove extra {o.label}</button></div>)}
    <details><summary>Add something extra</summary><form className="add-item" onSubmit={e=>{e.preventDefault();if(extra.trim())setMark({id:crypto.randomUUID(),label:extra.trim()});}}><label>Extra item<input value={extra} maxLength={80} disabled={disabled} onChange={e=>setExtra(e.target.value)}/></label><button className="secondary" disabled={disabled||!extra.trim()||value.manual_objects.length>=12}>Mark extra item</button></form></details>
    <label className="simple-check"><input type="checkbox" checked={value.inventory_confirmed} disabled={disabled} onChange={e=>onChange({...value,inventory_confirmed:e.target.checked})}/>I’ve checked the whole photo, including anything extra.</label>
    <p className="quiet">This is a check assisted by you. It does not count as independent automatic verification.</p>
  </div>;
}
