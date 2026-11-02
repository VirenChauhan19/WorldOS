import { useEffect, useState } from 'react';
import { ArrowRight, Check, Leaf, LoaderCircle, ScanLine, Sparkles, Sun, Undo2 } from 'lucide-react';
import type { FurnitureItem, FurniturePlacement } from './layout';
import type { DesignStyle, RoomDesign, RoomSurvey } from './design';

const priorities=[{id:'balanced',label:'Balanced',Icon:Sparkles},{id:'open',label:'More open space',Icon:Leaf},{id:'focus',label:'Focus & daylight',Icon:Sun}] as const;
export default function RoomCopilot({survey,busy,error,hasPhoto,ready,goal,onGoal,style,onStyle,onDesign,onRetry,onCancel,design,items,placements,onSelect,onUndo,canUndo,onSignIn,retryDesign=false}:{
  survey?:RoomSurvey;busy:'survey'|'design'|null;error:string;hasPhoto:boolean;ready:boolean;
  goal:string;onGoal:(value:string)=>void;style:DesignStyle;onStyle:(value:DesignStyle)=>void;
  onDesign:(goal?:string)=>void;onRetry:()=>void;onCancel:()=>void;design:RoomDesign|null;
  items:readonly FurnitureItem[];placements:readonly FurniturePlacement[];onSelect:(id:string)=>void;onUndo:()=>void;canUndo:boolean;onSignIn?:()=>void;retryDesign?:boolean;
}){
  const [elapsed,setElapsed]=useState(0);
  useEffect(()=>{setElapsed(0);if(!busy)return;const start=Date.now(),timer=window.setInterval(()=>setElapsed(Math.floor((Date.now()-start)/1000)),1000);return()=>window.clearInterval(timer);},[busy]);
  return <section className="room-copilot" aria-label="AI room designer" id="room-designer">
    <div className="room-copilot-heading"><span className="room-copilot-mark"><Sparkles size={23}/></span><div><span className="room-eyebrow">FROM A PHOTO TO A POSSIBILITY</span><h2>Your room has potential.</h2></div><span className="room-ai-badge">AI DESIGNER</span></div>
    {busy&&<div className="room-ai-progress" role="status" aria-live="polite"><LoaderCircle className="spin" size={22}/><div><strong>{busy==='survey'?'Reading your room…':'Finding a place for your ideas…'}</strong><p>{busy==='survey'?'Estimating scale, tracing the floor, and looking for doors and existing furniture.':'Considering your request, visible features, and space between pieces.'}</p>{elapsed>=15&&<small aria-live="off">{elapsed}s elapsed · Detailed room design can take a minute or two.</small>}</div><button onClick={onCancel}>Cancel</button></div>}
    {error&&<div className="room-ai-error" role="alert"><p>{error}</p>{onSignIn?<button onClick={onSignIn}>Sign in for AI design<ArrowRight size={15}/></button>:hasPhoto&&<button onClick={onRetry} disabled={!!busy}>{retryDesign?'Try design again':'Try room analysis again'}</button>}</div>}
    {!busy&&hasPhoto&&!survey&&!error&&<button className="room-primary" onClick={onRetry}><ScanLine size={17}/>Analyze this room photo</button>}
    <form className="room-wish-form" onSubmit={e=>{e.preventDefault();onDesign();}}>
      <label htmlFor="room-wishlist">What would make this room yours?</label>
      <textarea id="room-wishlist" rows={3} maxLength={1200} value={goal} onChange={e=>onGoal(e.target.value)} disabled={busy==='design'} placeholder="A cozy sofa, a reading corner, and a desk near the window…"/>
      <div className="room-design-priorities" aria-label="Design priority">{priorities.map(({id,label,Icon})=><button key={id} type="button" aria-pressed={style===id} disabled={busy==='design'} onClick={()=>onStyle(id)}><Icon size={14}/>{label}</button>)}</div>
      <div className="room-design-submit"><p>{!hasPhoto?'Start with a room photo. No tape measure needed.':!ready?'A readable room photo unlocks your design.':'Describe the pieces, mood, or changes you want.'}</p><button className="room-primary" disabled={!ready||!goal.trim()||!!busy} type="submit"><Sparkles size={17}/>{design?'Update my room':'Design my room'}<ArrowRight size={16}/></button></div>
    </form>
    {ready&&design&&!busy&&<div className="room-design-starters"><span>KEEP EXPLORING</span>{['Add a compact bookshelf without moving my other pieces','Make the centre feel more open'].map(idea=><button key={idea} onClick={()=>{onGoal(idea);onDesign(idea);}}>{idea}<ArrowRight size={14}/></button>)}</div>}
    {ready&&!design&&!busy&&<div className="room-design-starters"><span>TRY AN IDEA</span>{(survey?.ideas.length?survey.ideas:['Add a cozy reading corner with a chair and side table','Add a desk and storage for a calm home office']).map(idea=><button key={idea} onClick={()=>{onGoal(idea);onDesign(idea);}}>{idea}<ArrowRight size={14}/></button>)}</div>}
    {survey&&<div className="room-reading">
      <div className="room-reading-summary"><ScanLine size={18}/><p>{survey.summary}</p></div>
      {survey.room&&<><div className="room-estimate-grid"><div><span>ESTIMATED WIDTH</span><strong>≈ {survey.room.width} <small>m</small></strong><p>{survey.room.width_min}–{survey.room.width_max} m plausible range</p></div><div><span>ESTIMATED DEPTH</span><strong>≈ {survey.room.depth} <small>m</small></strong><p>{survey.room.depth_min}–{survey.room.depth_max} m plausible range</p></div><div><span>PHOTO CONFIDENCE</span><strong className="room-confidence">{survey.confidence}</strong><p>Visual estimate · not a measurement</p></div></div>
        <div className="room-feature-chips">{survey.features.map((f,i)=><span key={i} title={f.observation}>{f.kind==='window'||f.kind==='light'?<Sun size={13}/>:<Check size={13}/>} {f.label}</span>)}{survey.zones.length>0&&<span>{survey.zones.length} areas kept clear</span>}</div></>}
      <details className="room-estimate-evidence"><summary>How the photo estimate works</summary><ul>{survey.evidence.map((s,i)=><li key={i}>{s}</li>)}</ul><p>{survey.uncertainty}</p><p>Sizes and hidden areas can differ from this estimate. Check dimensions before buying furniture.</p></details>
    </div>}
    {design&&<div className="room-design-story" aria-live="polite"><div className="room-design-story-heading"><div><span className="room-eyebrow">A PLACE, AND A REASON</span><h3>{design.title}</h3></div>{canUndo&&<button onClick={onUndo} disabled={!!busy}><Undo2 size={14}/>Undo design</button>}</div><p>{design.summary}</p><div className="room-placement-reasons">{design.items.map((original,index)=>{
      const item=items.find(i=>i.id===original.id);if(!item)return null;
      const preferred=design.placements.find(p=>p.itemId===item.id),actual=placements.find(p=>p.itemId===item.id);
      const changed=actual&&preferred&&(Math.hypot(actual.x-preferred.x,actual.z-preferred.z)>.12||actual.rotation!==preferred.rotation||item.width!==original.width||item.depth!==original.depth||item.height!==original.height);
      return <button key={item.id} onClick={()=>onSelect(item.id)} disabled={!actual}><span className="room-reason-number">{index+1}</span><span><strong>{item.label}</strong><span>{!actual?'No clear placement found. Try a smaller alternative or remove another piece.':changed?`Design intent: ${preferred?.reason}`:preferred?.reason}</span><small>{!actual?'Not placed':changed?'Position adjusted in the current plan':'Placed in the estimated room'} · {item.width} × {item.depth} m</small></span>{actual&&<ArrowRight size={16}/>}</button>;
    })}</div>{design.tradeoffs.length>0&&<ul className="room-design-tradeoffs">{design.tradeoffs.map((s,i)=><li key={i}>{s}</li>)}</ul>}</div>}
  </section>;
}
