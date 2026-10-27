import { useState } from 'react';
import Photo from './Photo';

export default function PhotoComparison({before,after,width,height}:{before:string;after:string;width:number;height:number}) {
  const [open,setOpen]=useState(false),[opacity,setOpacity]=useState(50);
  return <details className="photo-comparison" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>Compare reference and inspection photos</summary>
    {open&&<><div className="comparison-image" style={{aspectRatio:`${width}/${height}`}}>
      <Photo src={before} alt="Reference photograph" width={width} height={height}/>
      <Photo src={after} alt="Aligned inspection photograph" width={width} height={height} style={{opacity:opacity/100}}/>
    </div><label className="comparison-range">Reference <input type="range" min="0" max="100" value={opacity} aria-label="Inspection photo opacity" aria-valuetext={`${opacity}% inspection photo`} onChange={event=>setOpacity(Number(event.target.value))}/> Inspection</label>
    <p>Blend the two photographs to compare visible changes. This control does not alter inspection results.</p></>}
  </details>;
}
