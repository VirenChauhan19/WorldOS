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
import type { WorldARController, WorldARPlacementPose, WorldARPlacementSurface, WorldARSceneObject, WorldARState } from '../live/xr';
import type { XRPoint } from '../live/xr-types';
import { exportJSON } from '../exportFile';
import { navigate, useRoute } from '../navigation';
import { AR_CATALOG, AR_CATEGORIES } from './catalog';
import { addObject, createScene, createStarterScene, defaultMount, duplicateObject, loadScene, MAX_SCENE_OBJECTS, mountObject, parseScene, removeObject, resizeScene, saveScene, SCENE_STORAGE_KEY, SURFACE_KINDS, surfacePlacement, updateObject } from './scene';
import type { DesignObject, DesignScene, MountSurface, ObjectUpdate } from './scene';
import { consumeRoomHandoff } from './roomHandoff';
import ObjectThumbnail from './ObjectThumbnail';
import { LightingControls, RoomFinishControls } from './InteriorControls';
import DesignPlan from './DesignPlan';
import { placeSceneObject } from './placement';
import { resizeMountedWorldPosition } from './worldEditing';
import { nativeARCapabilities, startNativeInteriorAR } from './native';
import type { NativeARCapabilities, NativeARController } from './native';
import './designer.css';
import './interior.css';

const FINISHES=[{name:'Sage',color:'#7d9580'},{name:'Oak',color:'#bf9b73'},{name:'Linen',color:'#ded5c2'},{name:'Clay',color:'#b68a78'},{name:'Charcoal',color:'#535f64'},{name:'Cloud',color:'#e4e5df'}];
const round=(n:number)=>Math.round(n*100)/100;
type DesignSnapshot={epoch:number;scene:DesignScene;positions:Map<string,XRPoint>;rotations:Map<string,number>;surfaces:Map<string,WorldARPlacementSurface>;origin:XRPoint|null};
const MOUNTS: {value:MountSurface;label:string}[]=[{value:'free',label:'Free placement'},{value:'back-wall',label:'Back wall'},{value:'left-wall',label:'Left wall'},{value:'right-wall',label:'Right wall'},{value:'front-wall',label:'Front wall'},{value:'ceiling',label:'Ceiling'}];
function placementSurface(object?:DesignObject):WorldARPlacementSurface{const mount=object?.placement.mount??(object?defaultMount(object.item):'free');return mount==='ceiling'?'ceiling':mount.endsWith('-wall')?'vertical':'horizontal';}

function SizeField({label,value,onChange,min=0,max=30,disabled=false}:{label:string;value:number;onChange:(n:number)=>void;min?:number;max?:number;disabled?:boolean}) {
  const [text,setText]=useState(String(round(value)));
  useEffect(()=>setText(String(round(value))),[value]);
  function apply(){const number=Number(text);if(text.trim()&&Number.isFinite(number)&&number>=min&&number<=max)onChange(number);else setText(String(round(value)));}
  return <label className="design-number"><span>{label}</span><div><input type="number" aria-label={label} inputMode="decimal" min={min} max={max} step=".01" value={text} disabled={disabled} onChange={e=>setText(e.target.value)} onBlur={apply} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><span>m</span></div></label>;
}

export default function SceneDesigner({active=true}:{active?:boolean}) {
  const route=useRoute();
  const [initial]=useState(()=>{const stored=loadScene();return {scene:stored??createScene(),saved:!!stored};});
  const [scene,setScene]=useState<DesignScene>(initial.scene);
  const current=useRef(scene),dirty=useRef(false),hadStored=useRef(initial.saved);current.current=scene;
  const [selectedId,setSelectedId]=useState(''),[view,setView]=useState<'3d'|'plan'>('3d');
  const [category,setCategory]=useState('all'),[query,setQuery]=useState(''),[notice,setNotice]=useState(''),[error,setError]=useState(''),[saved,setSaved]=useState(initial.saved),[libraryOpen,setLibraryOpen]=useState(false);
  const [xrSupported,setXRSupported]=useState<boolean|null>(null),[quickSupported]=useState(supportsQuickLook),[previewScope,setPreviewScope]=useState<'all'|'selected'>('all');
  const [nativeSupport,setNativeSupport]=useState<NativeARCapabilities>({supported:false}),[nativeRunning,setNativeRunning]=useState(false);
  const [running,setRunning]=useState(false),[starting,setStarting]=useState(false),[xrState,setXRState]=useState<WorldARState|null>(null),[arCatalog,setARCatalog]=useState(false),[pendingId,setPendingId]=useState('');
  const [replace,setReplace]=useState<'empty'|'living-room'|'workspace'|null>(null),[historyRevision,setHistoryRevision]=useState(0);
  const [incoming,setIncoming]=useState<DesignScene|null>(null),[surfaceId,setSurfaceId]=useState('');
  const undo=useRef<DesignSnapshot[]>([]),redo=useRef<DesignSnapshot[]>([]),dragStart=useRef<DesignScene|null>(null);
  const overlay=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),controller=useRef<WorldARController|null>(null),abort=useRef<AbortController|null>(null),epoch=useRef(0);
  const positions=useRef(new Map<string,XRPoint>()),origin=useRef<XRPoint|null>(null),pending=useRef('');pending.current=pendingId;
  const worldRotations=useRef(new Map<string,number>());
  const worldSurfaces=useRef(new Map<string,WorldARPlacementSurface>());
  const [targetOverride,setTargetOverride]=useState<{id:string;surface:WorldARPlacementSurface}|null>(null),targetOverrideRef=useRef(targetOverride);targetOverrideRef.current=targetOverride;
  function currentSurface(object?:DesignObject):WorldARPlacementSurface{if(!object)return 'horizontal';return targetOverrideRef.current?.id===object.item.id?targetOverrideRef.current.surface:worldSurfaces.current.get(object.item.id)??placementSurface(object);}
  const fileInput=useRef<HTMLInputElement>(null);
  const selected=scene.objects.find(o=>o.item.id===selectedId);
  const mounting=selected?.placement.mount??'free',wallMounted=mounting.endsWith('-wall');
  const pendingSurface=currentSurface(scene.objects.find(o=>o.item.id===pendingId));
  const quickObjects=previewScope==='selected'?(selected?[{...selected,placement:{...selected.placement,x:0,z:0,elevation:0}}]:[]):scene.objects;
  const quick=useQuickLookAsset(quickObjects.map(o=>o.item),quickObjects.map(o=>o.placement),active&&quickSupported&&quickObjects.length>0);
  const catalog=AR_CATALOG.filter(entry=>(category==='all'||entry.category===category)&&entry.item.label.toLowerCase().includes(query.trim().toLowerCase()));
  const surfaces=selected?scene.objects.filter(object=>object.item.id!==selected.item.id&&SURFACE_KINDS.includes(object.item.kind)).map(object=>{try{surfacePlacement(scene,selected.item.id,object.item.id);return {object,reason:''};}catch(error){return {object,reason:(error as Error).message};}}):[];

  function snapshot(value=current.current):DesignSnapshot{return {epoch:epoch.current,scene:value,positions:new Map([...positions.current].map(([id,p])=>[id,{...p}])),rotations:new Map(worldRotations.current),surfaces:new Map(worldSurfaces.current),origin:origin.current?{...origin.current}:null};}
  function remember(previous:DesignScene){undo.current=[...undo.current.slice(-29),snapshot(previous)];redo.current=[];setHistoryRevision(n=>n+1);}
  function clearDeleted(){stopAR();const empty=createScene();current.current=empty;dirty.current=false;hadStored.current=false;undo.current=[];redo.current=[];dragStart.current=null;setScene(empty);setSaved(false);setSelectedId('');setSurfaceId('');setIncoming(null);setReplace(null);setError('');setNotice('Design deleted. Add a piece to begin again.');setHistoryRevision(n=>n+1);}
  function removedFromStorage(){try{return hadStored.current&&localStorage.getItem(SCENE_STORAGE_KEY)===null;}catch{return false;}}
  function persist(){if(!dirty.current)return false;if(removedFromStorage()){clearDeleted();return false;}saveScene(current.current);dirty.current=false;hadStored.current=true;return true;}
  function change(next:DesignScene,record=true){if(record)remember(current.current);current.current=next;dirty.current=true;setScene(next);setSaved(false);setError('');}
  function perform(work:()=>void){try{work();setError('');}catch(e){setError(e instanceof Error?e.message:'Could not update this design.');}}
  function edit(id:string,patch:ObjectUpdate,record=true){perform(()=>{
    const before=current.current.objects.find(o=>o.item.id===id);
    let next=updateObject(current.current,id,patch);const after=next.objects.find(o=>o.item.id===id)!;
    const position=positions.current.get(id);
    let nextPosition=position,nextOrigin=origin.current,nextRotation=worldRotations.current.get(id)??after.placement.rotation;
    if(position&&before){
      const oldSize=orientedSize(before.item,before.placement.rotation),newSize=orientedSize(after.item,after.placement.rotation);
      nextPosition={x:position.x+after.placement.x-before.placement.x+(newSize.width-oldSize.width)/2,y:position.y+(after.placement.elevation??0)-(before.placement.elevation??0),z:position.z+after.placement.z-before.placement.z+(newSize.depth-oldSize.depth)/2};
      const surface=worldSurfaces.current.get(id),resizing=patch.item&&(patch.item.width!==undefined||patch.item.height!==undefined||patch.item.depth!==undefined);
      if(resizing&&!patch.placement&&(surface==='vertical'||surface==='ceiling')){
        nextPosition=resizeMountedWorldPosition(before,after,position,nextRotation,surface);
        const aligned=placeSceneObject(next,id,nextPosition,origin.current);next=aligned.scene;nextOrigin=aligned.origin;
      }
      if(patch.placement?.mount&&patch.placement.mount!=='free')nextRotation=after.placement.rotation;
      else if(worldRotations.current.has(id))nextRotation+=after.placement.rotation-before.placement.rotation;
    }
    change(next,record);origin.current=nextOrigin;
    if(nextPosition){positions.current.set(id,nextPosition);worldRotations.current.set(id,nextRotation);}
    if(patch.placement?.mount!==undefined){worldSurfaces.current.delete(id);setTargetOverride(null);}
  });}
  function mountSelected(mount:MountSurface){if(!selected)return;perform(()=>{const next=mountObject(current.current,selected.item.id,mount);edit(selected.item.id,{placement:next.objects.find(object=>object.item.id===selected.item.id)!.placement});setNotice(mount==='free'?'Piece detached. Move it freely in your plan.':`${selected.item.label} attached to the ${MOUNTS.find(value=>value.value===mount)?.label.toLowerCase()}.`);});}
  function select(id:string){setSelectedId(id);setPendingId('');setSurfaceId('');setTargetOverride(null);}
  function placeOnSurface(){if(!selected||!surfaceId)return;perform(()=>{
    const value=current.current,placement=surfacePlacement(value,selected.item.id,surfaceId),target=value.objects.find(object=>object.item.id===surfaceId)!,targetPosition=positions.current.get(surfaceId);
    edit(selected.item.id,{placement});
    if(running){if(targetPosition){positions.current.set(selected.item.id,{x:targetPosition.x,y:targetPosition.y+target.item.height,z:targetPosition.z});setPendingId('');}else positions.current.delete(selected.item.id);syncWorld();}
    setNotice(running&&!targetPosition?`${selected.item.label} arranged on ${target.item.label} in the plan. Place the full design to see them together.`:`${selected.item.label} centered on ${target.item.label}. Move each piece independently to adjust it.`);
  });}
  function acceptRoom(next:DesignScene){if(removedFromStorage())clearDeleted();stopAR();change(next);hadStored.current=false;setSelectedId('');setSurfaceId('');setIncoming(null);setView('3d');setNotice('Your room layout is ready. Keep editing here or place the full design in AR.');}
  function refreshSaved(){
    if(dirty.current)return;
    const stored=loadScene();
    if(!stored){if(removedFromStorage())clearDeleted();return;}
    if(JSON.stringify(stored)===JSON.stringify(current.current))return;
    stopAR();current.current=stored;hadStored.current=true;undo.current=[];redo.current=[];dragStart.current=null;setScene(stored);setSaved(true);setSelectedId('');setSurfaceId('');setPreviewScope('all');setError('');setNotice('Opened your latest saved design.');setHistoryRevision(n=>n+1);
  }
  function add(id:string){perform(()=>{const next=addObject(current.current,id),object=next.objects.at(-1)!;change(next);setLibraryOpen(false);setSelectedId(object.item.id);if(running){setPendingId(object.item.id);setARCatalog(false);setNotice(`Aim at ${placementSurface(object)==='vertical'?'a wall':placementSurface(object)==='ceiling'?'the ceiling':'a floor or tabletop'} to place ${object.item.label}.`);}else setNotice(`${object.item.label} added${object.placement.mount&&object.placement.mount!=='free'?` on the ${MOUNTS.find(value=>value.value===object.placement.mount)?.label.toLowerCase()}`:''}. Adjust its placement below.`);});}
  function remove(id:string){change(removeObject(current.current,id));positions.current.delete(id);worldRotations.current.delete(id);worldSurfaces.current.delete(id);if(selectedId===id)setSelectedId('');if(pendingId===id)setPendingId('');setNotice('Object removed. Undo is available.');}
  function duplicate(){if(!selected)return;perform(()=>{const next=duplicateObject(current.current,selected.item.id),id=next.objects.at(-1)!.item.id;change(next);setSelectedId(id);if(running){setPendingId(id);setTargetOverride({id,surface:currentSurface(selected)});}});}
  function rotate(){if(selected)edit(selected.item.id,{placement:{rotation:((selected.placement.rotation+90)%360) as FurnitureRotation}});}
  function travel(direction:'undo'|'redo'){const from=direction==='undo'?undo:redo,to=direction==='undo'?redo:undo,previous=from.current.pop();if(!previous)return;to.current.push(snapshot());current.current=previous.scene;dirty.current=true;positions.current=running&&previous.epoch===epoch.current?new Map(previous.positions):new Map();worldRotations.current=running&&previous.epoch===epoch.current?new Map(previous.rotations):new Map();worldSurfaces.current=running&&previous.epoch===epoch.current?new Map(previous.surfaces):new Map();setTargetOverride(null);origin.current=running&&previous.epoch===epoch.current&&previous.origin?{...previous.origin}:null;setScene(previous.scene);setSaved(false);setPendingId('');setHistoryRevision(n=>n+1);}
  function nudge(x:number,z:number){if(selected)edit(selected.item.id,{placement:{x:selected.placement.x+x,z:selected.placement.z+z}});}
  function syncWorld(){const objects:WorldARSceneObject[]=current.current.objects.flatMap(({item,placement})=>{const position=positions.current.get(item.id);return position?[{id:item.id,item,position,rotation:worldRotations.current.get(item.id)??placement.rotation}]:[];});controller.current?.setScene?.(objects,selectedId);}
  function place(pose:WorldARPlacementPose){const id=pending.current,object=current.current.objects.find(o=>o.item.id===id);if(!object)return;
    perform(()=>{
      const desired=currentSurface(object);if(pose.surface&&pose.surface!==desired||!pose.surface&&desired!=='horizontal')throw new Error(`Wait for a tracked ${desired==='vertical'?'wall':desired==='ceiling'?'ceiling':'floor or tabletop'} before placing this piece.`);
      const rotation=(((Math.round(pose.rotation/90)*90)%360+360)%360) as FurnitureRotation;
      const prepared=updateObject(current.current,id,{placement:{mount:'free',rotation}});
      const next=placeSceneObject(prepared,id,pose.position,origin.current);
      change(next.scene);origin.current=next.origin;positions.current.set(id,{...pose.position});worldRotations.current.set(id,pose.rotation);worldSurfaces.current.set(id,desired);setTargetOverride(null);
      setPendingId('');setSelectedId(id);setNotice(`${object.item.label} placed. Select another piece or add more.`);syncWorld();
    });
  }
  function placeDesign(){const pose=controller.current?.getPlacementPose?.();if(!pose||pose.surface&&pose.surface!=='horizontal')return;remember(current.current);const value=current.current;origin.current={x:pose.position.x-value.room.width/2,y:pose.position.y,z:pose.position.z-value.room.depth/2};
    for(const {item,placement} of value.objects){const size=orientedSize(item,placement.rotation);worldRotations.current.set(item.id,placement.rotation);positions.current.set(item.id,{x:origin.current.x+placement.x+size.width/2,y:pose.position.y+(placement.elevation??0),z:origin.current.z+placement.z+size.depth/2});}
    worldSurfaces.current.clear();setTargetOverride(null);setPendingId('');setNotice('Your design is placed. Select any object to move or edit it.');syncWorld();
  }
  function stopAR(){epoch.current++;abort.current?.abort();abort.current=null;const old=controller.current;controller.current=null;void old?.end();positions.current.clear();worldRotations.current.clear();worldSurfaces.current.clear();setTargetOverride(null);origin.current=null;setRunning(false);setNativeRunning(false);setStarting(false);setPendingId('');setARCatalog(false);}
  async function startAR(){const element=canvas.current,root=overlay.current;if(!element||!root)return;const request=++epoch.current;abort.current=new AbortController();setError('');setXRState(null);setLibraryOpen(false);flushSync(()=>{setRunning(true);setNativeRunning(nativeSupport.supported);setStarting(true);});
    try{const value=await (nativeSupport.supported?startNativeInteriorAR:startWorldAR)({canvas:element,overlay:root,signal:abort.current.signal,interactionMode:'place',onMeasurement:()=>{},onState:state=>{if(epoch.current!==request)return;setXRState(state);if(state.phase==='ended'){positions.current.clear();worldRotations.current.clear();worldSurfaces.current.clear();setTargetOverride(null);origin.current=null;setRunning(false);setNativeRunning(false);setStarting(false);controller.current=null;setNotice(state.message);}},onObjectSelect:id=>{if(epoch.current!==request)return;setSelectedId(id??'');setPendingId('');},onPlace:pose=>{if(epoch.current===request)place(pose);},onSceneReset:()=>{if(epoch.current!==request)return;positions.current.clear();worldRotations.current.clear();worldSurfaces.current.clear();setTargetOverride(null);origin.current=null;setPendingId('');for(const entry of [...undo.current,...redo.current]){entry.positions=new Map();entry.rotations=new Map();entry.surfaces=new Map();entry.origin=null;}setNotice('Tracking origin changed. Place your objects again.');}});
      if(epoch.current!==request){void value.end();return;}controller.current=value;setStarting(false);setARCatalog(!current.current.objects.length);syncWorld();
    }catch(e){if(epoch.current===request){setRunning(false);setNativeRunning(false);setStarting(false);setError(e instanceof Error?e.message:typeof (e as {message?:unknown})?.message==='string'?(e as {message:string}).message:'AR could not start.');}}
  }
  useEffect(()=>{let live=true;void isWorldARSupported().then(value=>{if(live)setXRSupported(value);});void nativeARCapabilities().then(value=>{if(live)setNativeSupport(value);});return()=>{live=false;};},[]);
  useEffect(()=>{if(active){refreshSaved();return;}setIncoming(null);stopAR();try{persist();}catch{/* The active view reports save errors. */}},[active]);
  useEffect(()=>{if(!active)return;const token=route.params.get('handoff');if(!token)return;const next=consumeRoomHandoff(token);if(next){if(current.current.objects.length)setIncoming(next);else acceptRoom(next);}},[active,route.key]);
  useEffect(()=>{
    const deleted=()=>clearDeleted();
    const storage=(event:StorageEvent)=>{
      if((event.key!==SCENE_STORAGE_KEY&&event.key!==null)||event.newValue!==null)return;
      // An accepted room is a new design. A delayed deletion of its predecessor
      // must retire the old undo history without erasing the new arrangement.
      if(!hadStored.current){undo.current=[];redo.current=[];setHistoryRevision(n=>n+1);return;}
      const stored=loadScene();
      if(stored&&JSON.stringify(stored)===JSON.stringify(current.current))return;
      deleted();
    };
    window.addEventListener('worldos:design-deleted',deleted);window.addEventListener('storage',storage);
    return()=>{window.removeEventListener('worldos:design-deleted',deleted);window.removeEventListener('storage',storage);};
  },[]);
  useEffect(()=>{const leave=()=>{try{persist();}catch{/* A visible save error is reported by the normal save effect. */}stopAR();};const close=()=>{if(document.hidden)leave();};document.addEventListener('visibilitychange',close);window.addEventListener('pagehide',leave);return()=>{try{persist();}catch{/* The active view reports save errors. */}epoch.current++;abort.current?.abort();void controller.current?.end();document.removeEventListener('visibilitychange',close);window.removeEventListener('pagehide',leave);};},[]);
  useEffect(()=>{if(!active||!dirty.current)return;const timer=window.setTimeout(()=>{try{if(persist())setSaved(true);}catch(e){setError((e as Error).message);}},300);return()=>window.clearTimeout(timer);},[scene,active]);
  useEffect(()=>{if(!running)return;syncWorld();const object=scene.objects.find(o=>o.item.id===pendingId),surface=currentSurface(object);controller.current?.setPlacementSurface?.(surface);controller.current?.setPlacementPreview?.(object?.item??null,surface==='vertical'?0:object?.placement.rotation??0);},[scene,selectedId,pendingId,running,starting,targetOverride]);
  async function restore(file:File){try{if(file.size>128000)throw new Error('Choose a design backup smaller than 128 KB.');const next=parseScene(JSON.parse(await file.text()));if(!next)throw new Error('This file is not a valid WorldOS design.');change(next);setSelectedId('');setNotice('Design restored.');}catch(e){setError(e instanceof Error?e.message:'Could not restore this design.');}}

  const library=<section className="design-library" aria-label="Object collection"><header><div><span className="design-kicker">THE COLLECTION</span><h2>Make room for an idea.</h2></div><span>{AR_CATALOG.length} pieces</span></header>
    <label className="design-search"><Search size={17}/><input type="search" aria-label="Search objects" placeholder="Find furniture, lights, wall pieces…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <div className="design-categories" role="group" aria-label="Object categories"><button aria-pressed={category==='all'} onClick={()=>setCategory('all')}>All pieces</button>{AR_CATEGORIES.map(c=><button key={c.id} aria-pressed={category===c.id} onClick={()=>setCategory(c.id)}>{c.label}</button>)}</div>
    <div className="design-catalog-grid">{catalog.map(entry=><button key={entry.id} aria-label={`Add ${entry.item.label}`} disabled={scene.objects.length>=MAX_SCENE_OBJECTS} onClick={()=>add(entry.id)}><ObjectThumbnail item={entry.item}/><span>{entry.item.label}<Plus size={15}/></span><small>{entry.item.width} × {entry.item.depth} m</small></button>)}</div>
    {!catalog.length&&<p className="design-muted">No pieces match. Try another name or category.</p>}<p className="design-catalog-note">Furniture, lighting, and wall pieces. Edit dimensions and finishes to match your space.</p>
  </section>;

  const inspector=selected?<section className="design-inspector" aria-label="Selected object"><div className="design-inspector-title"><ObjectThumbnail item={selected.item}/><div><span className="design-kicker">YOUR SELECTED PIECE</span><h2>{selected.item.label}</h2></div><button aria-label="Deselect object" onClick={()=>select('')}><X size={18}/></button></div>
    <label className="design-name-field">Object name<input aria-label="Object name" maxLength={120} value={selected.item.label} onChange={e=>{if(e.target.value.trim())edit(selected.item.id,{item:{label:e.target.value}});}}/></label>
    <div className="design-size-fields">{(['width','depth','height'] as const).map(key=><SizeField key={key} label={`Object ${key}`} value={selected.item[key]} min={.01} onChange={n=>edit(selected.item.id,{item:{[key]:n}})}/>)}</div>
    <section className="design-mount-tools" aria-label="Object mounting"><label>Mounting surface<select aria-label="Mounting surface" value={mounting} onChange={event=>mountSelected(event.target.value as MountSurface)}>{MOUNTS.map(({value,label})=><option key={value} value={value}>{label}</option>)}</select></label><p>{mounting==='ceiling'?'The top stays at your plan ceiling. Change the object height to adjust how far it hangs.':wallMounted?'The back stays against this wall and faces into the room. Mounting height measures the bottom edge from the floor.':'Move this piece freely, or attach it to a wall or ceiling in your plan.'}</p></section>
    {selected.item.light&&<LightingControls light={selected.item.light} onChange={light=>edit(selected.item.id,{item:{light}})}/>}
    <div className="design-finishes" role="group" aria-label="Object finish">{FINISHES.map(f=><button key={f.name} aria-label={`${f.name} finish`} aria-pressed={selected.item.color===f.color} style={{background:f.color}} onClick={()=>edit(selected.item.id,{item:{color:f.color}})}>{selected.item.color===f.color&&<Check size={14}/>}</button>)}<label className="design-custom-color"><input type="color" aria-label="Custom object color" value={selected.item.color} onChange={e=>edit(selected.item.id,{item:{color:e.target.value}})}/><span>Custom</span></label></div>
    <div className="design-edit-actions"><button onClick={rotate} disabled={wallMounted} title={wallMounted?'Wall pieces face into the room':undefined}><RotateCw size={16}/>Rotate 90°</button><button onClick={duplicate}><Copy size={16}/>Duplicate</button><button aria-label={`Remove ${selected.item.label}`} onClick={()=>remove(selected.item.id)}><Trash2 size={16}/>Remove</button></div>
    <div className="design-position"><div><span className="design-kicker">POSITION · {selected.placement.rotation}°</span><span>Move 10 cm</span></div><div className="design-nudge" role="group" aria-label="Move selected object"><button aria-label="Move object left" onClick={()=>nudge(-.1,0)}><ArrowLeft size={18}/></button><button aria-label="Move object forward" onClick={()=>nudge(0,-.1)}><ArrowUp size={18}/></button><button aria-label="Move object backward" onClick={()=>nudge(0,.1)}><ArrowDown size={18}/></button><button aria-label="Move object right" onClick={()=>nudge(.1,0)}><ArrowRight size={18}/></button></div></div>
    <div className="design-size-fields"><SizeField label="Position from left" disabled={mounting==='left-wall'||mounting==='right-wall'} value={selected.placement.x} onChange={n=>edit(selected.item.id,{placement:{x:n}})}/><SizeField label="Position from back" disabled={mounting==='back-wall'||mounting==='front-wall'} value={selected.placement.z} onChange={n=>edit(selected.item.id,{placement:{z:n}})}/><SizeField label={wallMounted?"Mounting height":"Height off floor"} disabled={mounting==='ceiling'} value={selected.placement.elevation??0} max={10} onChange={n=>edit(selected.item.id,{placement:{elevation:n}})}/></div>
    <div className="design-surface-tools"><label>Place on top<select aria-label="Supporting surface" value={surfaces.some(surface=>surface.object.item.id===surfaceId)?surfaceId:''} onChange={event=>setSurfaceId(event.target.value)}><option value="">Choose a surface</option>{surfaces.map(({object,reason})=><option key={object.item.id} value={object.item.id} disabled={!!reason}>{object.item.label}{reason?' · Does not fit':''}</option>)}</select></label><div><button disabled={!surfaces.some(surface=>surface.object.item.id===surfaceId&&!surface.reason)} onClick={placeOnSurface}>Place on top</button><button onClick={()=>{edit(selected.item.id,{placement:{mount:'free',elevation:0}});setNotice(`${selected.item.label} moved to the floor.`);}}>Move to floor</button></div><p>Center a piece on a table, desk, shelf, or custom surface. Each piece moves independently.</p>{!surfaces.some(surface=>!surface.reason)&&<p>No surface fits this piece. Add a larger surface or adjust the dimensions.</p>}</div>
    {running&&<button className="design-primary" onClick={()=>setPendingId(selected.item.id)}><Move size={17}/>{positions.current.has(selected.item.id)?'Move to a new spot':'Place this object'}</button>}
  </section>:<section className="design-selection-empty"><WorldIcon name="objects" size={25}/><h2>A room made by you.</h2><p>Select a piece to change its size, finish, rotation, and position.</p></section>;

  return <div ref={overlay} className={`scene-designer${running?' is-ar':''}${nativeRunning?' is-native-ar':''}`}>
    <canvas ref={canvas} className="design-xr-canvas" aria-label="Objects placed in your physical space" hidden={!running}/>
    <div className="design-standard">
      <header className="design-heading"><div><span className="design-kicker">YOUR POCKET INTERIOR STUDIO</span><h1>Good spaces start with you.</h1><p>Furnish the floor. Style the walls. Light the room.</p></div><div className="design-heading-actions"><button className="design-primary design-open-library" onClick={()=>setLibraryOpen(true)}><Plus size={18}/>Add pieces</button><button className="design-secondary" onClick={()=>navigate('room',{workspace:''})}>Photo room planner<ArrowRight size={16}/></button>{(nativeSupport.supported||xrSupported)&&<button className="design-primary" disabled={starting} onClick={()=>void startAR()}><WorldIcon name="scan" size={19}/>Start interactive AR</button>}</div></header>
      <div className="design-layout"><div className="design-main">
        <section className="design-canvas-card"><div className="design-toolbar"><label><input aria-label="Design name" maxLength={80} value={scene.name} onChange={e=>{if(e.target.value.trim())change({...scene,name:e.target.value});}}/><span>{saved?<><Check size={12}/>Saved on this device</>:dirty.current?'Saving your design…':'Add pieces to save your design'}</span></label><div className="design-history"><button aria-label="Undo design change" disabled={!undo.current.length} onClick={()=>travel('undo')}><Undo2 size={18}/></button><button aria-label="Redo design change" disabled={!redo.current.length} onClick={()=>travel('redo')}><Redo2 size={18}/></button></div></div>
          <div className="design-view-tabs" role="group" aria-label="Design view"><button aria-pressed={view==='3d'} onClick={()=>setView('3d')}><WorldIcon name="room" size={17}/>3D studio</button><button aria-pressed={view==='plan'} onClick={()=>setView('plan')}><WorldIcon name="floorplan" size={17}/>Floor plan<small>Drag to arrange</small></button><span>{scene.room.width} × {scene.room.depth} m plan</span></div>
          {view==='3d'?<RoomPreview room={scene.room} finishes={scene.finishes} items={scene.objects.map(o=>o.item)} placements={scene.objects.map(o=>o.placement)} selectedId={selectedId} onSelect={select}/>:<DesignPlan scene={scene} selectedId={selectedId} onSelect={select} onBegin={()=>{dragStart.current=current.current;}} onMove={(id,x,z,record=true)=>edit(id,{placement:{x:round(x),z:round(z)}},record)} onEnd={()=>{if(dragStart.current&&dragStart.current!==current.current)remember(dragStart.current);dragStart.current=null;}}/>}
          {!scene.objects.length&&<div className="design-empty-invitation"><span><WorldIcon name="objects" size={25}/></span><h2>Your blank canvas.</h2><p>Add a piece from the collection, or explore a starting idea.</p><div><button onClick={()=>change(createStarterScene('living-room'))}>Try a living room<ArrowRight size={15}/></button><button onClick={()=>change(createStarterScene('workspace'))}>Try a workspace<ArrowRight size={15}/></button></div></div>}
          <div className="design-scene-rail" role="group" aria-label="Objects in your design">{scene.objects.map(({item})=><button key={item.id} aria-pressed={selectedId===item.id} onClick={()=>select(item.id)}><ObjectThumbnail item={item}/><span>{item.label}</span></button>)}{scene.objects.length>0&&<span>{scene.objects.length}/{MAX_SCENE_OBJECTS} pieces</span>}</div>
        </section>
        {(error||notice)&&<div className={`design-feedback${error?' is-error':''}`} role={error?'alert':'status'}>{error||notice}<button aria-label="Dismiss design message" onClick={()=>{setError('');setNotice('');}}><X size={16}/></button></div>}
        {inspector}
        <RoomFinishControls finishes={scene.finishes} onChange={finishes=>change({...scene,finishes})}/>
        <section className="design-room-settings"><details><summary>Plan size & design files<span>{scene.room.width} × {scene.room.depth} m</span></summary><p>Use your measurements for the plan. The starting 5 × 4 m space is an editable example.</p><div className="design-size-fields"><SizeField label="Plan width" min={.5} value={scene.room.width} onChange={n=>perform(()=>change(resizeScene(scene,{...scene.room,width:n})))}/><SizeField label="Plan length" min={.5} value={scene.room.depth} onChange={n=>perform(()=>change(resizeScene(scene,{...scene.room,depth:n})))}/><SizeField label="Plan ceiling" min={.5} value={scene.room.height??2.7} onChange={n=>perform(()=>change(resizeScene(scene,{...scene.room,height:n})))}/></div><div className="design-file-actions"><button onClick={()=>void exportJSON(scene,'worldos-design.json').catch(e=>setError(e.message))}><Download size={16}/>Export design</button><button onClick={()=>fileInput.current?.click()}><Upload size={16}/>Restore design</button><button onClick={()=>setReplace('empty')}><Plus size={16}/>New design</button></div><input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="Restore design backup" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void restore(file);}}/></details></section>
        <section className="design-ar-card"><WorldIcon name="scan" size={29}/><div><h2>From your screen to your space.</h2>{nativeSupport.supported||xrSupported?<><p>Place pieces one by one, or place your complete design. Keep adding and editing while AR is open.</p><button className="design-primary" onClick={()=>void startAR()}>Start interactive AR<ArrowRight size={17}/></button></>:quickSupported?<><p>Choose the whole layout or one piece, then open Apple’s AR viewer. Return here to add pieces or edit dimensions.</p><label className="design-scope">Preview<select aria-label="AR preview selection" value={previewScope} onChange={e=>setPreviewScope(e.target.value as 'all'|'selected')}><option value="all">Whole design · {scene.objects.length} pieces</option><option value="selected" disabled={!selected}>Selected piece{selected?` · ${selected.item.label}`:''}</option></select></label><QuickLookLink url={quick.url} onOpen={()=>setNotice('AR changes in Apple’s viewer stay in that session. Edit and save your layout here.')} unavailableReason={!quickObjects.length?'Add an object to preview':quick.error||undefined}/><small>Apple’s viewer moves the exported layout as a group. Select a single piece to preview it independently.</small></>:<><p>Your interactive 3D studio works here. Open this app on a supported AR phone to place the pieces in your physical space.</p><span className="design-ar-availability">{nativeSupport.reason|| (xrSupported===null?'Checking AR support…':'AR placement requires a compatible phone and browser.')}</span></>}</div></section>
        <p className="design-fine-print">Concept models with editable dimensions. Check real furniture, doors, and access before making changes.</p>
      </div><aside className="design-sidebar">{!libraryOpen&&library}</aside></div>
    </div>
    {nativeRunning&&<><div className="design-native-touch-layer" role="button" tabIndex={0} aria-label="Select an object in the AR view" onPointerUp={event=>{const rect=event.currentTarget.getBoundingClientRect();if(rect.width&&rect.height)void (controller.current as NativeARController|null)?.selectAt((event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height);}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();void (controller.current as NativeARController|null)?.selectAt(.5,.5);}}}/><div aria-hidden="true" className={`design-native-reticle${xrState?.canSelect?' is-ready':''}`}><i/></div></>}
    {running&&<div className="design-ar-overlay"><header data-xr-ui><div><span className="design-kicker">{nativeRunning?'IPHONE AR STUDIO':'LIVE AR STUDIO'}</span><strong>{scene.name}</strong></div><div className="design-ar-header-actions"><button aria-label="Undo AR change" disabled={!undo.current.length} onClick={()=>travel('undo')}><Undo2 size={18}/></button><button aria-label="Redo AR change" disabled={!redo.current.length} onClick={()=>travel('redo')}><Redo2 size={18}/></button><button aria-label="Exit interactive AR" onClick={stopAR}><X size={21}/></button></div></header><div className="design-ar-tip" role="status"><span className="design-surface-label">{pendingSurface==='vertical'?'Wall placement':pendingSurface==='ceiling'?'Ceiling placement':'Floor & surface placement'}</span>{starting?'Opening your AR camera…':xrState?.phase==='tracking-lost'?'Tracking paused. Look back at the surface.':!xrState?.canSelect?(xrState?.message||'Move your phone slowly to find a floor or tabletop.'):pendingId?`Aim the reticle to place ${scene.objects.find(o=>o.item.id===pendingId)?.item.label??'your object'}.`:'Choose a piece, or place your whole design at the reticle.'}</div>
      <div className="design-ar-bottom" data-xr-ui><div className="design-ar-scene" role="group" aria-label="AR scene objects">{scene.objects.map(({item})=><button key={item.id} aria-pressed={selectedId===item.id} onClick={()=>select(item.id)}><ObjectThumbnail item={item}/><span>{item.label}<small>{positions.current.has(item.id)?'Placed':'Ready to place'}</small></span></button>)}</div>
        {arCatalog?<div className="design-ar-library"><button className="design-ar-library-close" onClick={()=>setARCatalog(false)}>Back to scene<X size={17}/></button>{library}</div>:<>{selected&&!pendingId&&inspector}<div className="design-ar-placement-target">{pendingId&&<label>Place against<select aria-label="AR placement surface" value={pendingSurface} onChange={event=>setTargetOverride({id:pendingId,surface:event.target.value as WorldARPlacementSurface})}><option value="horizontal">Floor or tabletop</option><option value="vertical">Wall</option><option value="ceiling">Ceiling</option></select></label>}{pendingId&&selected&&<button className="design-placement-edit" onClick={()=>select(selected.item.id)}>Edit piece</button>}</div><div className="design-ar-actions"><button className="design-secondary" onClick={()=>setARCatalog(true)}><Plus size={18}/>Add object</button>{pendingId?<button className="design-primary" disabled={!xrState?.canSelect||starting} onClick={()=>{const pose=controller.current?.getPlacementPose?.();if(pose)place(pose);}}>Place here<Check size={18}/></button>:<button className="design-primary" disabled={!scene.objects.length||!xrState?.canSelect||starting} onClick={placeDesign}>Place full design<WorldIcon name="room" size={18}/></button>}</div></>}
        {error&&<p className="design-ar-error" role="alert">{error}</p>}<p className="design-ar-session-note">AR positions last for this session. Your objects and editable plan are saved on this device.</p>
      </div></div>}
    <Dialog open={libraryOpen&&!running} onClose={()=>setLibraryOpen(false)} title="Add pieces to your design">{library}</Dialog>
    <Dialog open={!!replace} onClose={()=>setReplace(null)} title="Start a new design?"><p>Export this design first to keep a separate copy. Undo can also restore it during this visit.</p><button className="design-primary" onClick={()=>{change(createScene());setSelectedId('');setReplace(null);}}>Start a blank design</button></Dialog>
    <Dialog open={!!incoming} onClose={()=>setIncoming(null)} title="Open your room layout?"><p>Replace “{scene.name}” with “{incoming?.name}” and its {incoming?.objects.length} pieces? Export your current design first to keep a separate copy. Undo can restore it during this visit.</p><div className="design-handoff-actions"><button className="design-secondary" onClick={()=>setIncoming(null)}>Keep current design</button><button className="design-primary" onClick={()=>{if(incoming)acceptRoom(incoming);}}>Use room layout</button></div></Dialog>
    <span hidden data-history-revision={historyRevision}/>
  </div>;
}
