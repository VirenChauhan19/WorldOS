import type { SceneImage } from '../types';
import type { Alignment, WorkspaceTemplate } from './types';

interface Props { template:WorkspaceTemplate; current:SceneImage; value:Alignment; onChange:(a:Alignment)=>void; busy:boolean }
export default function AlignmentView({template,current,value,onChange,busy}:Props) {
  const rw=template.image_width,rh=template.image_height,scale=value.scale*rw/current.width;
  return <div className="inspection-alignment">
    <div className="inspection-overlay" style={{aspectRatio:`${rw}/${rh}`}}><svg viewBox={`0 0 ${rw} ${rh}`} aria-label="Transparent reference alignment overlay">
      <g transform={`translate(${rw*(.5+value.tx)} ${rh*(.5+value.ty)}) rotate(${value.rotation}) scale(${scale})`}><image href={current.image_url} x={-current.width/2} y={-current.height/2} width={current.width} height={current.height}/></g>
      <image href={template.reference_image_url} width={rw} height={rh} opacity=".38"/>
      <rect x={template.workspace.x*rw} y={template.workspace.y*rh} width={template.workspace.width*rw} height={template.workspace.height*rh} fill="none" stroke="#d5edab" strokeWidth="2" strokeDasharray="8 5"/>
    </svg><span className="image-tag">REFERENCE OVERLAY · 38%</span></div>
    <fieldset disabled={busy}><legend>Align stationary surface features</legend><div className="alignment-fields">{(['tx','ty','scale','rotation'] as const).map(key=><label key={key}>{key==='tx'?'Horizontal shift (%)':key==='ty'?'Vertical shift (%)':key==='scale'?'Scale (%)':'Rotation (degrees)'}<input aria-label={`Alignment ${key}`} type="number" step={key==='rotation'?.1:1} min={key==='rotation'?-30:key==='scale'?50:-50} max={key==='rotation'?30:key==='scale'?200:50} value={Number((value[key]*(key==='rotation'?1:100)).toFixed(2))} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)) onChange({...value,[key]:n/(key==='rotation'?1:100),confirmed:false});}}/></label>)}</div>
    <p>Compare desk edges, shelf corners, and fixed surface markings. Moving objects cannot establish camera alignment. Retake photos when perspective or depth prevents a match.</p>
    <label className="inspection-check"><input type="checkbox" aria-label="Reference overlay alignment confirmed" checked={value.confirmed} onChange={e=>onChange({...value,confirmed:e.target.checked})}/>I checked stationary features, framing, and the entire workspace in the overlay.</label></fieldset>
  </div>;
}
