import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Copy, Download, Move, Plus, Redo2, RotateCw, Search, Trash2, Undo2, Upload, X } from 'lucide-react';
import WorldIcon from '../ui/WorldIcon';
import Dialog from '../ui/Dialog';
import RoomPreview from '../room/RoomPreview';
import { QuickLookLink, useQuickLookAsset } from '../room/QuickLookLink';
import { supportsQuickLook } from '../room/quickLook';
import { orientedSize } from '../room/layout';
import type { FurnitureRotation } from '../room/layout';
import { isWorldARSupported, startWorldAR } from '../live/xr';
import type { WorldARController, WorldARPlacementPose, WorldARSceneObject, WorldARState } from '../live/xr';
import type { XRPoint } from '../live/xr-types';
import { exportJSON } from '../exportFile';
import { navigate } from '../navigation';
import { AR_CATALOG, AR_CATEGORIES } from './catalog';
import { addObject, createScene, createStarterScene, duplicateObject, loadScene, MAX_SCENE_OBJECTS, parseScene, removeObject, resizeScene, saveScene, updateObject } from './scene';
import type { DesignScene, ObjectUpdate } from './scene';
import ObjectThumbnail from './ObjectThumbnail';
import DesignPlan from './DesignPlan';
import { placeSceneObject } from './placement';
import './designer.css';

const FINISHES=[{name:'Sage',color:'#7d9580'},{name:'Oak',color:'#bf9b73'},{name:'Linen',color:'#ded5c2'},{name:'Clay',color:'#b68a78'},{name:'Charcoal',color:'#535f64'},{name:'Cloud',color:'#e4e5df'}];
const round=(n:number)=>Math.round(n*100)/100;
type DesignSnapshot={epoch:number;scene:DesignScene;positions:Map<string,XRPoint>;origin:XRPoint|null};

function SizeField({label,value,onChange,min=0,max=30}:{label:string;value:number;onChange:(n:number)=>void;min?:number;max?:number}) {
  const [text,setText]=useState(String(round(value)));
  useEffect(()=>setText(String(round(value))),[value]);
  function apply(){const number=Number(text);if(text.trim()&&Number.isFinite(number)&&number>=min&&number<=max)onChange(number);else setText(String(round(value)));}
  return <label className="design-number"><span>{label}</span><div><input type="number" aria-label={label} inputMode="decimal" min={min} max={max} step=".01" value={text} onChange={e=>setText(e.target.value)} onBlur={apply} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><span>m</span></div></label>;
}

export default function SceneDesigner({active=true}:{active?:boolean}) {
  const [initial]=useState(()=>{const stored=loadScene();return {scene:stored??createScene(),saved:!!stored};});
  const [scene,setScene]=useState<DesignScene>(initial.scene);
  const current=useRef(scene),dirty=useRef(!initial.saved);current.current=scene;
  const [selectedId,setSelectedId]=useState(''),[view,setView]=useState<'3d'|'plan'>('3d');
  const [category,setCategory]=useState('all'),[query,setQuery]=useState(''),[notice,setNotice]=useState(''),[error,setError]=useState(''),[saved,setSaved]=useState(initial.saved),[libraryOpen,setLibraryOpen]=useState(false);
  const [xrSupported,setXRSupported]=useState<boolean|null>(null),[quickSupported]=useState(supportsQuickLook),[previewScope,setPreviewScope]=useState<'all'|'selected'>('all');
  const [running,setRunning]=useState(false),[starting,setStarting]=useState(false),[xrState,setXRState]=useState<WorldARState|null>(null),[arCatalog,setARCatalog]=useState(false),[pendingId,setPendingId]=useState('');
  const [replace,setReplace]=useState<'empty'|'living-room'|'workspace'|null>(null),[historyRevision,setHistoryRevision]=useState(0);
  const undo=useRef<DesignSnapshot[]>([]),redo=useRef<DesignSnapshot[]>([]),dragStart=useRef<DesignScene|null>(null);
  const overlay=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),controller=useRef<WorldARController|null>(null),abort=useRef<AbortController|null>(null),epoch=useRef(0);
  const positions=useRef(new Map<string,XRPoint>()),origin=useRef<XRPoint|null>(null),pending=useRef('');pending.current=pendingId;
  const fileInput=useRef<HTMLInputElement>(null);
  const selected=scene.objects.find(o=>o.item.id===selectedId);
  const quickObjects=previewScope==='selected'?(selected?[{...selected,placement:{...selected.placement,x:0,z:0,elevation:0}}]:[]):scene.objects;
  const quick=useQuickLookAsset(quickObjects.map(o=>o.item),quickObjects.map(o=>o.placement),active&&quickSupported&&quickObjects.length>0);
  const catalog=AR_CATALOG.filter(entry=>(category==='all'||entry.category===category)&&entry.item.label.toLowerCase().includes(query.trim().toLowerCase()));

  function snapshot(value=current.current):DesignSnapshot{return {epoch:epoch.current,scene:value,positions:new Map([...positions.current].map(([id,p])=>[id,{...p}])),origin:origin.current?{...origin.current}:null};}
  function remember(previous:DesignScene){undo.current=[...undo.current.slice(-29),snapshot(previous)];redo.current=[];setHistoryRevision(n=>n+1);}
  function persist(){if(!dirty.current)return;saveScene(current.current);dirty.current=false;}
  function change(next:DesignScene,record=true){if(record)remember(current.current);current.current=next;dirty.current=true;setScene(next);setSaved(false);setError('');}
  function perform(work:()=>void){try{work();setError('');}catch(e){setError(e instanceof Error?e.message:'Could not update this design.');}}
  function edit(id:string,patch:ObjectUpdate,record=true){perform(()=>{
    const before=current.current.objects.find(o=>o.item.id===id),next=updateObject(current.current,id,patch),after=next.objects.find(o=>o.item.id===id)!;
    const position=positions.current.get(id);
    change(next,record);
    if(position&&before){
      const oldSize=orientedSize(before.item,before.placement.rotation),newSize=orientedSize(after.item,after.placement.rotation);
      positions.current.set(id,{x:position.x+after.placement.x-before.placement.x+(newSize.width-oldSize.width)/2,y:position.y+(after.placement.elevation??0)-(before.placement.elevation??0),z:position.z+after.placement.z-before.placement.z+(newSize.depth-oldSize.depth)/2});
    }
  });}
  function select(id:string){setSelectedId(id);setPendingId('');}
  function add(id:string){perform(()=>{const next=addObject(current.current,id),object=next.objects.at(-1)!;change(next);setLibraryOpen(false);setSelectedId(object.item.id);if(running){setPendingId(object.item.id);setARCatalog(false);setNotice(`Aim at a surface to place ${object.item.label}.`);}else setNotice(`${object.item.label} added. Drag it in Floor plan or edit its position below.`);});}
  function remove(id:string){change(removeObject(current.current,id));positions.current.delete(id);if(selectedId===id)setSelectedId('');if(pendingId===id)setPendingId('');setNotice('Object removed. Undo is available.');}
  function duplicate(){if(!selected)return;perform(()=>{const next=duplicateObject(current.current,selected.item.id),id=next.objects.at(-1)!.item.id;change(next);setSelectedId(id);if(running)setPendingId(id);});}
  function rotate(){if(selected)edit(selected.item.id,{placement:{rotation:((selected.placement.rotation+90)%360) as FurnitureRotation}});}
  function travel(direction:'undo'|'redo'){const from=direction==='undo'?undo:redo,to=direction==='undo'?redo:undo,previous=from.current.pop();if(!previous)return;to.current.push(snapshot());current.current=previous.scene;dirty.current=true;positions.current=running&&previous.epoch===epoch.current?new Map(previous.positions):new Map();origin.current=running&&previous.epoch===epoch.current&&previous.origin?{...previous.origin}:null;setScene(previous.scene);setSaved(false);setPendingId('');setHistoryRevision(n=>n+1);}
  function nudge(x:number,z:number){if(selected)edit(selected.item.id,{placement:{x:selected.placement.x+x,z:selected.placement.z+z}});}
  function syncWorld(){const objects:WorldARSceneObject[]=current.current.objects.flatMap(({item,placement})=>{const position=positions.current.get(item.id);return position?[{id:item.id,item,position,rotation:placement.rotation}]:[];});controller.current?.setScene?.(objects,selectedId);}
  function place(pose:WorldARPlacementPose){const id=pending.current,object=current.current.objects.find(o=>o.item.id===id);if(!object)return;
    perform(()=>{
      const next=placeSceneObject(current.current,id,pose.position,origin.current);
      change(next.scene);origin.current=next.origin;positions.current.set(id,{...pose.position});
      setPendingId('');setSelectedId(id);setNotice(`${object.item.label} placed. Select another piece or add more.`);syncWorld();
    });
  }
  function placeDesign(){const pose=controller.current?.getPlacementPose?.();if(!pose)return;remember(current.current);const value=current.current;origin.current={x:pose.position.x-value.room.width/2,y:pose.position.y,z:pose.position.z-value.room.depth/2};
    for(const {item,placement} of value.objects){const size=orientedSize(item,placement.rotation);positions.current.set(item.id,{x:origin.current.x+placement.x+size.width/2,y:pose.position.y+(placement.elevation??0),z:origin.current.z+placement.z+size.depth/2});}
    setPendingId('');setNotice('Your design is placed. Select any object to move or edit it.');syncWorld();
  }
  function stopAR(){epoch.current++;abort.current?.abort();abort.current=null;const old=controller.current;controller.current=null;void old?.end();positions.current.clear();origin.current=null;setRunning(false);setStarting(false);setPendingId('');setARCatalog(false);}
  async function startAR(){const element=canvas.current,root=overlay.current;if(!element||!root)return;const request=++epoch.current;abort.current=new AbortController();setError('');setXRState(null);setLibraryOpen(false);flushSync(()=>{setRunning(true);setStarting(true);});
    try{const value=await startWorldAR({canvas:element,overlay:root,signal:abort.current.signal,interactionMode:'place',onMeasurement:()=>{},onState:state=>{if(epoch.current!==request)return;setXRState(state);if(state.phase==='ended'){positions.current.clear();origin.current=null;setRunning(false);setStarting(false);controller.current=null;}},onObjectSelect:id=>{if(epoch.current!==request)return;setSelectedId(id??'');setPendingId('');},onPlace:pose=>{if(epoch.current===request)place(pose);},onSceneReset:()=>{if(epoch.current!==request)return;positions.current.clear();origin.current=null;setPendingId('');for(const entry of [...undo.current,...redo.current]){entry.positions=new Map();entry.origin=null;}setNotice('Tracking origin changed. Place your objects again.');}});
      if(epoch.current!==request){void value.end();return;}controller.current=value;setStarting(false);setARCatalog(!current.current.objects.length);syncWorld();
    }catch(e){if(epoch.current===request){setRunning(false);setStarting(false);setError(e instanceof Error?e.message:'AR could not start.');}}
  }
  useEffect(()=>{let live=true;void isWorldARSupported().then(value=>{if(live)setXRSupported(value);});return()=>{live=false;};},[]);
  useEffect(()=>{if(!active){stopAR();try{persist();}catch{/* The active view reports save errors. */}}},[active]);
  useEffect(()=>{const leave=()=>{try{persist();}catch{/* A visible save error is reported by the normal save effect. */}stopAR();};const close=()=>{if(document.hidden)leave();};document.addEventListener('visibilitychange',close);window.addEventListener('pagehide',leave);return()=>{try{persist();}catch{/* The active view reports save errors. */}epoch.current++;abort.current?.abort();void controller.current?.end();document.removeEventListener('visibilitychange',close);window.removeEventListener('pagehide',leave);};},[]);
  useEffect(()=>{if(!active)return;const timer=window.setTimeout(()=>{try{persist();setSaved(true);}catch(e){setError((e as Error).message);}},300);return()=>window.clearTimeout(timer);},[scene,active]);
  useEffect(()=>{if(!running)return;syncWorld();const object=scene.objects.find(o=>o.item.id===pendingId);controller.current?.setPlacementPreview?.(object?.item??null,object?.placement.rotation??0);},[scene,selectedId,pendingId,running,starting]);
  async function restore(file:File){try{if(file.size>128000)throw new Error('Choose a design backup smaller than 128 KB.');const next=parseScene(JSON.parse(await file.text()));if(!next)throw new Error('This file is not a valid WorldOS design.');change(next);setSelectedId('');setNotice('Design restored.');}catch(e){setError(e instanceof Error?e.message:'Could not restore this design.');}}

  const library=<section className="design-library" aria-label="Object collection"><header><div><span className="design-kicker">THE COLLECTION</span><h2>Make room for an idea.</h2></div><span>{AR_CATALOG.length} pieces</span></header>
    <label className="design-search"><Search size={17}/><input type="search" aria-label="Search objects" placeholder="Find a sofa, lamp, plant…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <div className="design-categories" role="group" aria-label="Object categories"><button aria-pressed={category==='all'} onClick={()=>setCategory('all')}>All pieces</button>{AR_CATEGORIES.map(c=><button key={c.id} aria-pressed={category===c.id} onClick={()=>setCategory(c.id)}>{c.label}</button>)}</div>
    <div className="design-catalog-grid">{catalog.map(entry=><button key={entry.id} aria-label={`Add ${entry.item.label}`} disabled={scene.objects.length>=MAX_SCENE_OBJECTS} onClick={()=>add(entry.id)}><ObjectThumbnail item={entry.item}/><span>{entry.item.label}<Plus size={15}/></span><small>{entry.item.width} × {entry.item.depth} m</small></button>)}</div>
    {!catalog.length&&<p className="design-muted">No pieces match. Try another name or category.</p>}<p className="design-catalog-note">Editable concept models. Set dimensions to match your furniture.</p>
  </section>;

  const inspector=selected?<section className="design-inspector" aria-label="Selected object"><div className="design-inspector-title"><ObjectThumbnail item={selected.item}/><div><span className="design-kicker">YOUR SELECTED PIECE</span><h2>{selected.item.label}</h2></div><button aria-label="Deselect object" onClick={()=>select('')}><X size={18}/></button></div>
    <label className="design-name-field">Object name<input aria-label="Object name" maxLength={120} value={selected.item.label} onChange={e=>{if(e.target.value.trim())edit(selected.item.id,{item:{label:e.target.value}});}}/></label>
    <div className="design-size-fields">{(['width','depth','height'] as const).map(key=><SizeField key={key} label={`Object ${key}`} value={selected.item[key]} min={.01} onChange={n=>edit(selected.item.id,{item:{[key]:n}})}/>)}</div>
    <div className="design-finishes" role="group" aria-label="Object finish">{FINISHES.map(f=><button key={f.name} aria-label={`${f.name} finish`} aria-pressed={selected.item.color===f.color} style={{background:f.color}} onClick={()=>edit(selected.item.id,{item:{color:f.color}})}>{selected.item.color===f.color&&<Check size={14}/>}</button>)}<label className="design-custom-color"><input type="color" aria-label="Custom object color" value={selected.item.color} onChange={e=>edit(selected.item.id,{item:{color:e.target.value}})}/><span>Custom</span></label></div>
    <div className="design-edit-actions"><button onClick={rotate}><RotateCw size={16}/>Rotate 90°</button><button onClick={duplicate}><Copy size={16}/>Duplicate</button><button aria-label={`Remove ${selected.item.label}`} onClick={()=>remove(selected.item.id)}><Trash2 size={16}/>Remove</button></div>
    <div className="design-position"><div><span className="design-kicker">POSITION · {selected.placement.rotation}°</span><span>Move 10 cm</span></div><div className="design-nudge" role="group" aria-label="Move selected object"><button aria-label="Move object left" onClick={()=>nudge(-.1,0)}><ArrowLeft size={18}/></button><button aria-label="Move object forward" onClick={()=>nudge(0,-.1)}><ArrowUp size={18}/></button><button aria-label="Move object backward" onClick={()=>nudge(0,.1)}><ArrowDown size={18}/></button><button aria-label="Move object right" onClick={()=>nudge(.1,0)}><ArrowRight size={18}/></button></div></div>
    <div className="design-size-fields"><SizeField label="Position from left" value={selected.placement.x} onChange={n=>edit(selected.item.id,{placement:{x:n}})}/><SizeField label="Position from back" value={selected.placement.z} onChange={n=>edit(selected.item.id,{placement:{z:n}})}/><SizeField label="Height off floor" value={selected.placement.elevation??0} max={10} onChange={n=>edit(selected.item.id,{placement:{elevation:n}})}/></div>
    {running&&<button className="design-primary" onClick={()=>setPendingId(selected.item.id)}><Move size={17}/>{positions.current.has(selected.item.id)?'Move to a new spot':'Place this object'}</button>}
  </section>:<section className="design-selection-empty"><WorldIcon name="objects" size={25}/><h2>A room made by you.</h2><p>Select a piece to change its size, finish, rotation, and position.</p></section>;

  return <div ref={overlay} className={`scene-designer${running?' is-ar':''}`}>
    <canvas ref={canvas} className="design-xr-canvas" aria-label="Objects placed in your physical space" hidden={!running}/>
    <div className="design-standard">
      <header className="design-heading"><div><span className="design-kicker">YOUR POCKET INTERIOR STUDIO</span><h1>Good spaces start with you.</h1><p>Choose your pieces. Try a layout. See it in your space.</p></div><div className="design-heading-actions"><button className="design-primary design-open-library" onClick={()=>setLibraryOpen(true)}><Plus size={18}/>Add pieces</button><button className="design-secondary" onClick={()=>navigate('room',{workspace:''})}>Photo room planner<ArrowRight size={16}/></button>{xrSupported&&<button className="design-primary" disabled={starting} onClick={()=>void startAR()}><WorldIcon name="scan" size={19}/>Start interactive AR</button>}</div></header>
      <div className="design-layout"><div className="design-main">
        <section className="design-canvas-card"><div className="design-toolbar"><label><input aria-label="Design name" maxLength={80} value={scene.name} onChange={e=>{if(e.target.value.trim())change({...scene,name:e.target.value});}}/><span>{saved?<><Check size={12}/>Saved on this device</>:'Saving your design…'}</span></label><div className="design-history"><button aria-label="Undo design change" disabled={!undo.current.length} onClick={()=>travel('undo')}><Undo2 size={18}/></button><button aria-label="Redo design change" disabled={!redo.current.length} onClick={()=>travel('redo')}><Redo2 size={18}/></button></div></div>
          <div className="design-view-tabs" role="group" aria-label="Design view"><button aria-pressed={view==='3d'} onClick={()=>setView('3d')}><WorldIcon name="room" size={17}/>3D studio</button><button aria-pressed={view==='plan'} onClick={()=>setView('plan')}><WorldIcon name="floorplan" size={17}/>Floor plan<small>Drag to arrange</small></button><span>{scene.room.width} × {scene.room.depth} m plan</span></div>
          {view==='3d'?<RoomPreview room={scene.room} items={scene.objects.map(o=>o.item)} placements={scene.objects.map(o=>o.placement)} selectedId={selectedId} onSelect={select}/>:<DesignPlan scene={scene} selectedId={selectedId} onSelect={select} onBegin={()=>{dragStart.current=current.current;}} onMove={(id,x,z,record=true)=>edit(id,{placement:{x:round(x),z:round(z)}},record)} onEnd={()=>{if(dragStart.current&&dragStart.current!==current.current)remember(dragStart.current);dragStart.current=null;}}/>}
          {!scene.objects.length&&<div className="design-empty-invitation"><span><WorldIcon name="objects" size={25}/></span><h2>Your blank canvas.</h2><p>Add a piece from the collection, or explore a starting idea.</p><div><button onClick={()=>change(createStarterScene('living-room'))}>Try a living room<ArrowRight size={15}/></button><button onClick={()=>change(createStarterScene('workspace'))}>Try a workspace<ArrowRight size={15}/></button></div></div>}
          <div className="design-scene-rail" role="group" aria-label="Objects in your design">{scene.objects.map(({item})=><button key={item.id} aria-pressed={selectedId===item.id} onClick={()=>select(item.id)}><ObjectThumbnail item={item}/><span>{item.label}</span></button>)}{scene.objects.length>0&&<span>{scene.objects.length}/{MAX_SCENE_OBJECTS} pieces</span>}</div>
        </section>
        {(error||notice)&&<div className={`design-feedback${error?' is-error':''}`} role={error?'alert':'status'}>{error||notice}<button aria-label="Dismiss design message" onClick={()=>{setError('');setNotice('');}}><X size={16}/></button></div>}
        {inspector}
        <section className="design-room-settings"><details><summary>Plan size & design files<span>{scene.room.width} × {scene.room.depth} m</span></summary><p>Use your measurements for the plan. The starting 5 × 4 m space is an editable example.</p><div className="design-size-fields"><SizeField label="Plan width" min={.5} value={scene.room.width} onChange={n=>perform(()=>change(resizeScene(scene,{...scene.room,width:n})))}/><SizeField label="Plan length" min={.5} value={scene.room.depth} onChange={n=>perform(()=>change(resizeScene(scene,{...scene.room,depth:n})))}/><SizeField label="Plan ceiling" min={.5} value={scene.room.height??2.7} onChange={n=>perform(()=>change(resizeScene(scene,{...scene.room,height:n})))}/></div><div className="design-file-actions"><button onClick={()=>void exportJSON(scene,'worldos-design.json').catch(e=>setError(e.message))}><Download size={16}/>Export design</button><button onClick={()=>fileInput.current?.click()}><Upload size={16}/>Restore design</button><button onClick={()=>setReplace('empty')}><Plus size={16}/>New design</button></div><input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="Restore design backup" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void restore(file);}}/></details></section>
        <section className="design-ar-card"><WorldIcon name="scan" size={29}/><div><h2>From your screen to your space.</h2>{xrSupported?<><p>Place pieces one by one, or place your complete design. Keep adding and editing while AR is open.</p><button className="design-primary" onClick={()=>void startAR()}>Start interactive AR<ArrowRight size={17}/></button></>:quickSupported?<><p>Choose the whole layout or one piece, then open Apple’s AR viewer. Return here to add pieces or edit dimensions.</p><label className="design-scope">Preview<select aria-label="AR preview selection" value={previewScope} onChange={e=>setPreviewScope(e.target.value as 'all'|'selected')}><option value="all">Whole design · {scene.objects.length} pieces</option><option value="selected" disabled={!selected}>Selected piece{selected?` · ${selected.item.label}`:''}</option></select></label><QuickLookLink url={quick.url} onOpen={()=>setNotice('AR changes in Apple’s viewer stay in that session. Edit and save your layout here.')} unavailableReason={!quickObjects.length?'Add an object to preview':quick.error||undefined}/><small>Apple’s viewer moves the exported layout as a group. Select a single piece to preview it independently.</small></>:<><p>Your interactive 3D studio works here. Open this app on a supported AR phone to place the pieces in your physical space.</p><span className="design-ar-availability">{xrSupported===null?'Checking AR support…':'AR placement requires a compatible phone and browser.'}</span></>}</div></section>
        <p className="design-fine-print">Concept models with editable dimensions. Check real furniture, doors, and access before making changes.</p>
      </div><aside className="design-sidebar">{!libraryOpen&&library}</aside></div>
    </div>
    {running&&<div className="design-ar-overlay"><header data-xr-ui><div><span className="design-kicker">LIVE AR STUDIO</span><strong>{scene.name}</strong></div><div className="design-ar-header-actions"><button aria-label="Undo AR change" disabled={!undo.current.length} onClick={()=>travel('undo')}><Undo2 size={18}/></button><button aria-label="Redo AR change" disabled={!redo.current.length} onClick={()=>travel('redo')}><Redo2 size={18}/></button><button aria-label="Exit interactive AR" onClick={stopAR}><X size={21}/></button></div></header><div className="design-ar-tip" role="status">{starting?'Opening your AR camera…':xrState?.phase==='tracking-lost'?'Tracking paused. Look back at the surface.':!xrState?.canSelect?(xrState?.message||'Move your phone slowly to find a floor or tabletop.'):pendingId?`Aim the reticle to place ${scene.objects.find(o=>o.item.id===pendingId)?.item.label??'your object'}.`:'Choose a piece, or place your whole design at the reticle.'}</div>
      <div className="design-ar-bottom" data-xr-ui><div className="design-ar-scene" role="group" aria-label="AR scene objects">{scene.objects.map(({item})=><button key={item.id} aria-pressed={selectedId===item.id} onClick={()=>select(item.id)}><ObjectThumbnail item={item}/><span>{item.label}<small>{positions.current.has(item.id)?'Placed':'Ready to place'}</small></span></button>)}</div>
        {arCatalog?<div className="design-ar-library"><button className="design-ar-library-close" onClick={()=>setARCatalog(false)}>Back to scene<X size={17}/></button>{library}</div>:<>{selected&&inspector}<div className="design-ar-actions"><button className="design-secondary" onClick={()=>setARCatalog(true)}><Plus size={18}/>Add object</button>{pendingId?<button className="design-primary" disabled={!xrState?.canSelect||starting} onClick={()=>{const pose=controller.current?.getPlacementPose?.();if(pose)place(pose);}}>Place here<Check size={18}/></button>:<button className="design-primary" disabled={!scene.objects.length||!xrState?.canSelect||starting} onClick={placeDesign}>Place full design<WorldIcon name="room" size={18}/></button>}</div></>}
        {error&&<p className="design-ar-error" role="alert">{error}</p>}<p className="design-ar-session-note">AR positions last for this session. Your objects and editable plan are saved on this device.</p>
      </div></div>}
    <Dialog open={libraryOpen&&!running} onClose={()=>setLibraryOpen(false)} title="Add pieces to your design">{library}</Dialog>
    <Dialog open={!!replace} onClose={()=>setReplace(null)} title="Start a new design?"><p>Export this design first to keep a separate copy. Undo can also restore it during this visit.</p><button className="design-primary" onClick={()=>{change(createScene());setSelectedId('');setReplace(null);}}>Start a blank design</button></Dialog>
    <span hidden data-history-revision={historyRevision}/>
  </div>;
}
