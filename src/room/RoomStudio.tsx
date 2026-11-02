import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';
import { Armchair, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BedDouble, Box, Camera, Check, ChevronDown, Grid2X2, Layers3, LoaderCircle, Maximize, Move, Plus, RotateCcw, Ruler, ScanLine, Table2, X } from 'lucide-react';
import { navigate } from '../navigation';
import { useLiveCamera } from '../live/useLiveCamera';
import { isWorldARSupported, startWorldAR } from '../live/xr';
import type { WorldARController, WorldARState } from '../live/xr';
import { assessRoomLayout, FURNITURE_PRESETS, orientedSize, planRoom } from './layout';
import type { FurnitureItem, FurniturePlacement, ReservedZone, RoomSize } from './layout';
import RoomPreview from './RoomPreview';
import { buildPreviewArrangement, supportsQuickLook } from './quickLook';
import { QuickLookLink, useQuickLookAsset } from './QuickLookLink';
import { useDeviceWorkspace } from '../device/context';
import { loadRoomDraft, roomDraftKey } from '../device/roomDraft';
import { loadRoomReference, readPhoto, saveRoomReference } from '../device/store';
import PhotoActions from '../PhotoActions';
import { validFloorCorners } from './photoPlane';
import type { RoomReference } from './photoPlane';
import RoomPhoto from './RoomPhoto';
import RoomOptions from './RoomOptions';
import RoomExample from './RoomExample';
import type { RoomSuggestion } from './recommendations';
import './room-planning.css';
import './room.css';
import './consumer-room.css';

const finite = (value: number) => Number.isFinite(value) && value > 0 && value <= 30;
const fmt = (value: number) => Number.isFinite(value) ? Number(value.toFixed(2)).toString() : '—';
const initialItems = () => FURNITURE_PRESETS.filter(item => item.kind !== 'chair').map(item => ({ ...item }));
const materialColors = [{name:'Sage',value:'#7d8e73'}, {name:'Sand',value:'#c6ad8f'}, {name:'Clay',value:'#b77b65'}, {name:'Slate',value:'#687b85'}];
type Source = 'unmeasured' | 'entered' | 'ar';
type View = '3d' | 'plan' | 'camera' | 'photo';
type RoomFields = {width:string;depth:string;height:string};

function DimensionField({ label, value, onChange, optional=false }: {label:string;value:number|string;onChange:(value:string)=>void;optional?:boolean}) {
  return <label className="room-field"><span>{label}{optional?' (optional)':''}</span><div><input aria-label={label} type="number" inputMode="decimal" min="0.05" max="30" step="0.05" placeholder="—" value={typeof value==='number'&&!Number.isFinite(value)?'':value} onChange={event=>onChange(event.target.value)}/><span>m</span></div></label>;
}

function FurnitureIcon({kind}:{kind:FurnitureItem['kind']}) {
  return kind==='bed'?<BedDouble size={21}/>:kind==='wardrobe'?<Box size={21}/>:<Table2 size={21}/>;
}

function FloorPlan({room,items,placements,selectedId,onSelect,onMove,conflictIds,zones,onMoveZone}:{room:RoomSize;items:readonly FurnitureItem[];placements:readonly FurniturePlacement[];selectedId:string;onSelect:(id:string)=>void;onMove:(id:string,x:number,z:number)=>void;conflictIds:Set<string>;zones:ReservedZone[];onMoveZone:(id:string,x:number,z:number)=>void}) {
  const svgRef=useRef<SVGSVGElement>(null);
  const drag=useRef<{id:string;dx:number;dz:number;pointer:number;zone?:boolean}|null>(null);
  const width=room.width,depth=room.depth,pad=Math.max(width,depth)*.12;
  const point=(event:ReactPointerEvent<SVGElement>)=>{
    const svg=svgRef.current,ctm=svg?.getScreenCTM();
    if(!svg||!ctm)return null;
    const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;
    return p.matrixTransform(ctm.inverse());
  };
  return <div className="room-floor-plan"><svg ref={svgRef} viewBox={`${-pad} ${-pad} ${width+2*pad} ${depth+2*pad}`} role="group" aria-label="Editable room floor plan" onPointerMove={event=>{const p=point(event);if(p&&drag.current)(drag.current.zone?onMoveZone:onMove)(drag.current.id,p.x-drag.current.dx,p.y-drag.current.dz);}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
    <defs><pattern id="room-plan-grid" width=".25" height=".25" patternUnits="userSpaceOnUse"><path d="M .25 0 L 0 0 0 .25" fill="none" stroke="#dadcd1" strokeWidth=".009"/></pattern></defs>
    <rect width={width} height={depth} fill="#f8f8f0" stroke="#6a765f" strokeWidth=".035"/><rect width={width} height={depth} fill="url(#room-plan-grid)"/>
    {zones.filter(z=>[z.x,z.z,z.width,z.depth].every(Number.isFinite)&&z.width>0&&z.depth>0).map(zone=><g key={zone.id} role="button" tabIndex={0} aria-label={`Move reserved ${zone.label}`} onPointerDown={event=>{event.preventDefault();const p=point(event);if(p){event.currentTarget.setPointerCapture(event.pointerId);drag.current={id:zone.id,dx:p.x-zone.x,dz:p.y-zone.z,pointer:event.pointerId,zone:true};}}} onKeyDown={event=>{const delta:Record<string,[number,number]>={ArrowLeft:[-.1,0],ArrowRight:[.1,0],ArrowUp:[0,-.1],ArrowDown:[0,.1]};if(delta[event.key]){event.preventDefault();const [dx,dz]=delta[event.key];onMoveZone(zone.id,zone.x+dx,zone.z+dz);}}}><rect x={zone.x} y={zone.z} width={zone.width} height={zone.depth} fill="#d8ab8766" stroke="#9b633d" strokeWidth=".025" strokeDasharray=".05 .04"/><text x={zone.x+zone.width/2} y={zone.z+zone.depth/2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(.14,zone.width*.12)} fill="#6d432b">{zone.label}</text></g>)}
    <text x={width/2} y={-pad*.4} textAnchor="middle" fontSize={pad*.31} fill="#546047">{fmt(width)} m</text><text x={-pad*.45} y={depth/2} textAnchor="middle" fontSize={pad*.31} fill="#546047" transform={`rotate(-90 ${-pad*.45} ${depth/2})`}>{fmt(depth)} m</text>
    {placements.map(placement=>{const item=items.find(value=>value.id===placement.itemId);if(!item)return null;const size=orientedSize(item,placement.rotation);return <g key={item.id} role="button" tabIndex={0} aria-label={`Move ${item.label}`} aria-pressed={selectedId===item.id} onFocus={()=>onSelect(item.id)} onPointerDown={event=>{event.preventDefault();onSelect(item.id);const p=point(event);if(p){event.currentTarget.setPointerCapture(event.pointerId);drag.current={id:item.id,dx:p.x-placement.x,dz:p.y-placement.z,pointer:event.pointerId};}}} onKeyDown={event=>{const keys:Record<string,[number,number]>={ArrowLeft:[-.1,0],ArrowRight:[.1,0],ArrowUp:[0,-.1],ArrowDown:[0,.1]};if(keys[event.key]){event.preventDefault();const [dx,dz]=keys[event.key];onMove(item.id,placement.x+dx,placement.z+dz);}}} className={conflictIds.has(item.id)?'plan-item conflict':'plan-item'}>
      <rect x={placement.x} y={placement.z} width={size.width} height={size.depth} rx=".035" fill={item.color} fillOpacity=".62" stroke={conflictIds.has(item.id)?'#af4c36':selectedId===item.id?'#304c29':'#738169'} strokeWidth={selectedId===item.id ? .045 : .02}/>
      <text x={placement.x+size.width/2} y={placement.z+size.depth/2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(.14,size.width*.14)} fill="#263422">{item.label}</text>
      <text x={placement.x+size.width/2} y={placement.z+size.depth/2+.19} textAnchor="middle" fontSize={Math.min(.1,size.width*.11)} fill="#35432d">{fmt(size.width)} × {fmt(size.depth)} m</text>
    </g>;})}
  </svg><p><Move size={14}/>Drag to arrange. Arrow keys move the selected piece 10 cm.</p></div>;
}

export default function RoomStudio({active=true}:{active?:boolean}) {
  const device=useDeviceWorkspace();
  const [draft]=useState(()=>device?loadRoomDraft():null),[saveError,setSaveError]=useState('');
  const [roomFields,setRoomFields]=useState<RoomFields>(draft?.roomFields??{width:'',depth:'',height:''});
  const [source,setSource]=useState<Source>(draft?.source??'unmeasured'),[view,setView]=useState<View>('3d');
  const [quickLookSupported]=useState(supportsQuickLook);
  const [quickLookOpened,setQuickLookOpened]=useState(false);
  const [exampleOpen,setExampleOpen]=useState(false);
  const [items,setItems]=useState<FurnitureItem[]>(()=>draft?.items??(device?[]:initialItems()));
  const [selectedId,setSelectedId]=useState(()=>(draft?.items??(device?[]:initialItems()))[0]?.id??'');
  const [gap,setGap]=useState(draft?.gap??'0.3');
  const [manual,setManual]=useState<FurniturePlacement[]|null>(draft?.manual??null);
  const [zones,setZones]=useState<ReservedZone[]>(draft?.zones??[]),[reviewed,setReviewed]=useState(draft?.reviewed??false);
  const [reference,setReference]=useState<RoomReference|null>(null),[referenceReady,setReferenceReady]=useState(!device),[captureError,setCaptureError]=useState('');
  const referenceChanged=useRef(false),referenceWrites=useRef<Promise<unknown>>(Promise.resolve());
  const photoRequest=useRef(0);
  useEffect(()=>()=>{photoRequest.current++;},[]);
  useEffect(()=>{if(!device)return;let live=true;void loadRoomReference().then(value=>{if(live&&!referenceChanged.current&&value)setReference(value);}).catch(()=>{if(live)setCaptureError('The saved room photo could not be opened. You can take a new photo.');}).finally(()=>{if(live)setReferenceReady(true);});return()=>{live=false;};},[device]);
  useEffect(()=>{if(!device||!referenceReady||!referenceChanged.current)return;let live=true;referenceWrites.current=referenceWrites.current.catch(()=>{}).then(()=>saveRoomReference(reference));void referenceWrites.current.catch(()=>{if(live)setCaptureError('The room photo could not be saved. Browser storage may be full or unavailable.');});return()=>{live=false;};},[device,referenceReady,reference]);
  useEffect(()=>{
    if(!device)return;
    try{localStorage.setItem(roomDraftKey,JSON.stringify({roomFields,source,items,gap,manual,zones,reviewed}));setSaveError('');}
    catch{setSaveError('Your room layout could not be saved on this device. Browser storage may be full or unavailable.');}
  },[device,roomFields,source,items,gap,manual,zones,reviewed]);
  const [measurementOpen,setMeasurementOpen]=useState(false),[catalogOpen,setCatalogOpen]=useState(false),[customizeOpen,setCustomizeOpen]=useState(!device);
  const [xrSupported,setXrSupported]=useState<boolean|null>(null),[xrRunning,setXrRunning]=useState(false),[xrStarting,setXrStarting]=useState(false),[xrState,setXrState]=useState<WorldARState|null>(null),[xrError,setXrError]=useState('');
  const [arHasMeasurement,setArHasMeasurement]=useState(false);
  const [arMethod,setArMethod]=useState<'corners'|'surface'>('corners');
  const [cameraAspect,setCameraAspect]=useState(4/3);
  const videoRef=useRef<HTMLVideoElement>(null),canvasRef=useRef<HTMLCanvasElement>(null),overlayRef=useRef<HTMLDivElement>(null);
  const controller=useRef<WorldARController|null>(null),abort=useRef<AbortController|null>(null),epoch=useRef(0),activeRef=useRef(active);
  activeRef.current=active;
  const camera=useLiveCamera({active:active&&view==='camera'&&!xrRunning&&!xrStarting,autoAnalyze:true,videoRef,...(device?{mode:'live' as const}:{})});
  const room=useMemo<RoomSize|null>(()=>{
    const width=Number(roomFields.width),depth=Number(roomFields.depth),height=roomFields.height.trim()?Number(roomFields.height):undefined;
    return finite(width)&&finite(depth)&&(height===undefined||finite(height))?{width,depth,height}:null;
  },[roomFields]);
  const clearance=gap.trim()?Number(gap):NaN;
  const previewArrangement=useMemo(()=>{
    if(!items.length)return null;
    try{return buildPreviewArrangement(items,clearance);}catch{return null;}
  },[items,clearance]);
  const planningRoom=useMemo(()=>{
    if(room)return room;
    if(source!=='unmeasured'||!previewArrangement)return null;
    if(!manual)return previewArrangement.room;
    // Without room measurements, the preview envelope follows the furniture.
    // It must never behave like an imaginary wall during moves or rotations.
    let width=0,depth=0;
    for(const placement of manual){
      const item=items.find(value=>value.id===placement.itemId);if(!item)continue;
      const size=orientedSize(item,placement.rotation);
      width=Math.max(width,placement.x+size.width);depth=Math.max(depth,placement.z+size.depth);
    }
    return width>0&&depth>0?{width,depth}:null;
  },[room,source,previewArrangement,manual,items]);
  const layout=useMemo(()=>manual?assessRoomLayout(planningRoom,items,manual,clearance,zones):source==='unmeasured'&&previewArrangement?assessRoomLayout(previewArrangement.room,items,previewArrangement.placements,clearance,zones):planRoom(room,items,clearance,zones),[room,planningRoom,items,manual,clearance,source,previewArrangement,zones]);
  const selected=items.find(item=>item.id===selectedId);
  const selectedPlacement=layout.placements.find(placement=>placement.itemId===selectedId);
  const conflictIds=new Set(layout.issues.flatMap(issue=>issue.itemIds));
  const validItems=items.filter(item=>[item.width,item.depth,item.height].every(finite));
  const visiblePlacements=layout.placements.filter(placement=>validItems.some(item=>item.id===placement.itemId));
  const trackingPaused=xrRunning&&xrState?.phase!=='ready';
  const resultTitle=trackingPaused?(arHasMeasurement?'Tracking paused':'Scanning your floor…'):layout.status==='unknown'&&source!=='unmeasured'?'Add valid measurements':!items.length?(device?(room?'Choose from the pieces that fit':'Measure an area to find furniture'):'Choose your furniture'):layout.status==='unknown'?'Check furniture sizes':layout.status==='conflict'?'This arrangement needs a change':source==='unmeasured'?`${items.length} pieces, one arrangement`:layout.status==='fits'?(device?`${items.length} ${items.length===1?'item fits':'items fit'} this area`:`All ${items.length} fit the measured space`):`${layout.placements.length} of ${items.length} placed`;
  const sourceLabel=source==='unmeasured'?'FURNITURE FOOTPRINT':source==='entered'?'YOUR DIMENSIONS':arMethod==='surface'?'DETECTED SURFACE AREA':xrRunning?'AR ESTIMATE':'SAVED AR ESTIMATE';
  const detected=xrState?.detectedSurface;
  const quickLook=useQuickLookAsset(items,layout.placements,active&&quickLookSupported&&layout.status!=='unknown'&&layout.placements.length===items.length&&items.length>0);
  const arUnavailable=!items.length?'Choose furniture first':layout.status==='unknown'?'Check furniture sizes':layout.placements.length!==items.length?'Arrange all pieces for AR':quickLook.error?'AR preview unavailable':undefined;

  const endAR=useCallback(()=>{
    epoch.current++;abort.current?.abort();const previous=controller.current;controller.current=null;
    setXrRunning(false);setXrStarting(false);setArHasMeasurement(false);
    void previous?.end();
  },[]);
  useEffect(()=>{let mounted=true;void isWorldARSupported().then(value=>{if(mounted)setXrSupported(value);}).catch(()=>{if(mounted)setXrSupported(false);});return()=>{mounted=false;};},[]);
  useEffect(()=>{if(!active){photoRequest.current++;endAR();}},[active,endAR]);
  useEffect(()=>{
    const visibility=()=>{if(document.hidden)endAR();};
    document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',endAR);window.addEventListener('worldos:session-expired',endAR);
    return()=>{epoch.current++;abort.current?.abort();void controller.current?.end();controller.current=null;document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',endAR);window.removeEventListener('worldos:session-expired',endAR);};
  },[endAR]);
  useEffect(()=>{
    if(controller.current)controller.current.setRoomLayout(arHasMeasurement&&layout.status!=='unknown'?{items:validItems,placements:visiblePlacements}:null);
  },[xrRunning,arHasMeasurement,layout,items]);
  useEffect(()=>{
    // Freeze only stable observed floor coverage large enough for the selected pieces.
    // This is a floor footprint estimate, never a complete room or obstacle survey.
    if(!xrRunning||arHasMeasurement||xrState?.scan?.phase!=='stable'||!detected)return;
    if(planRoom({width:detected.width,depth:detected.length},items,clearance,zones).status==='fits'){
      setArMethod('surface');controller.current?.useDetectedSurface();
    }
  },[xrRunning,arHasMeasurement,xrState,detected,items,clearance,zones]);

  async function startAR(){
    if(!canvasRef.current||!overlayRef.current||xrStarting||xrRunning)return;
    photoRequest.current++;
    const request=++epoch.current;abort.current?.abort();abort.current=new AbortController();camera.stop();setXrError('');setXrStarting(true);setArHasMeasurement(false);setArMethod('corners');
    try{
      const value=await startWorldAR({canvas:canvasRef.current,overlay:overlayRef.current,measurementMode:'scan',signal:abort.current.signal,onState:state=>{
        if(request!==epoch.current)return;setXrState(state);
        if(state.phase==='ended'){epoch.current++;abort.current?.abort();controller.current=null;setXrRunning(false);setXrStarting(false);setArHasMeasurement(false);}
      },onMeasurement:measurement=>{
        if(request!==epoch.current)return;setArHasMeasurement(!!measurement);
        if(measurement){setRoomFields({width:String(measurement.width),depth:String(measurement.length),height:''});setSource('ar');setArMethod('surface');setManual(null);setZones([]);setReviewed(false);referenceChanged.current=true;setReference(null);}
        else{setRoomFields({width:'',depth:'',height:''});setSource('unmeasured');setManual(null);setZones([]);setReviewed(false);}
      }});
      if(request!==epoch.current||!activeRef.current){await value.end();return;}
      controller.current=value;setXrRunning(true);setXrStarting(false);
    }catch(error){if(request!==epoch.current)return;setXrStarting(false);setXrRunning(false);setXrError(error instanceof Error?error.message:'AR could not start. You can still explore your furniture in 3D.');}
  }
  function editRoom(key:keyof RoomFields,value:string){setSource('entered');setRoomFields(old=>({...old,[key]:value}));setManual(null);setReviewed(false);}
  function reveal(id:string){requestAnimationFrame(()=>document.getElementById(id)?.scrollIntoView?.({block:'start',behavior:document.documentElement.dataset.motion==='reduced'||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));}
  function openMeasurements(){setMeasurementOpen(true);reveal('room-measured-area');}
  function selectFurniture(id:string){setSelectedId(id);setCustomizeOpen(true);}
  function resetRoom(){photoRequest.current++;camera.stop();endAR();setItems(device?[]:initialItems());setSelectedId(device?'':initialItems()[0]?.id??'');setManual(null);setRoomFields({width:'',depth:'',height:''});setSource('unmeasured');setGap('0.3');setView('3d');setZones([]);setReviewed(false);referenceChanged.current=true;setReference(null);setCaptureError('');setMeasurementOpen(false);setCustomizeOpen(!device);setQuickLookOpened(false);}
  function editZones(value:ReservedZone[]){setZones(value);setReviewed(false);}
  function moveZone(id:string,x:number,z:number){const zone=zones.find(v=>v.id===id);if(!room||!zone)return;editZones(zones.map(v=>v.id===id?{...v,x:Math.round(Math.max(0,Math.min(room.width-v.width,x))*100)/100,z:Math.round(Math.max(0,Math.min(room.depth-v.depth,z))*100)/100}:v));}
  function reserveObject(label:string){if(!room){setMeasurementOpen(true);setCaptureError('Enter the area width and length, then mark the floor used by this object.');return;}if(zones.length>=12){setCaptureError('Up to 12 reserved areas can be marked.');return;}editZones([...zones,{id:crypto.randomUUID(),label,kind:'obstacle',x:0,z:0,width:NaN,depth:NaN}]);setView('plan');setCaptureError('');}
  function updateReference(value:RoomReference){referenceChanged.current=true;setReference(value);setReviewed(false);}
  function captureRoom(){
    photoRequest.current++;
    const video=videoRef.current;if(!video?.videoWidth||!video.videoHeight){setCaptureError('Wait until the camera preview appears, then capture the area.');return;}
    const canvas=document.createElement('canvas'),scale=Math.min(1,1280/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
    const context=canvas.getContext('2d');if(!context){setCaptureError('This browser could not capture a photo. You can still use the floor plan.');return;}
    context.drawImage(video,0,0,canvas.width,canvas.height);
    updateReference({image_url:canvas.toDataURL('image/jpeg',.9),width:canvas.width,height:canvas.height,corners:[],labels:[...new Set((device?camera.trackedObjects??[]:camera.steady?camera.analysis?.objects??[]:[]).map(o=>o.label))]});
    setCaptureError('');camera.stop();setView('photo');setMeasurementOpen(true);reveal('room-plan-stage');
  }
  async function useRoomPhoto(file:File){const request=++photoRequest.current,image_url=await readPhoto(file),image=new Image();image.src=image_url;await image.decode();if(request!==photoRequest.current||!activeRef.current)return;updateReference({image_url,width:image.naturalWidth,height:image.naturalHeight,corners:[],labels:[]});camera.stop();setCaptureError('');setView('photo');setMeasurementOpen(true);reveal('room-plan-stage');}
  function addSuggestion(value:RoomSuggestion){if(!value.placement||!reviewed||!room||items.length>=12)return;const item={...value.item,id:crypto.randomUUID()},placement={...value.placement,itemId:item.id};if(assessRoomLayout(room,[...items,item],[...layout.placements,placement],clearance,zones).status!=='fits')return;setItems(old=>[...old,item]);setManual([...layout.placements,placement]);setSelectedId(item.id);reveal('room-plan-stage');if(view==='camera'){camera.stop();setView(reference?'photo':'plan');}}
  function openCamera(){flushSync(()=>setView('camera'));reveal('room-plan-stage');void camera.start();}
  function openQuickLook(){camera.stop();endAR();setQuickLookOpened(true);}
  function retryError(){
    if(xrError){setXrError('');void startAR();return;}
    if(camera.error){if(camera.status==='live')camera.retry();else openCamera();return;}
    if(quickLook.error)quickLook.retry();
  }
  function editItem(id:string,change:Partial<FurnitureItem>){setItems(old=>old.map(item=>item.id===id?{...item,...change}:item));if('width' in change||'depth' in change||'height' in change)setManual(null);}
  function moveItem(id:string,x:number,z:number){
    const placement=layout.placements.find(value=>value.itemId===id),item=items.find(value=>value.id===id);
    if(!planningRoom||!placement||!item)return;
    const size=orientedSize(item,placement.rotation);
    const next={...placement,x:Math.round(Math.max(0,source==='unmeasured'?x:Math.min(planningRoom.width-size.width,x))*100)/100,z:Math.round(Math.max(0,source==='unmeasured'?z:Math.min(planningRoom.depth-size.depth,z))*100)/100};
    setManual(layout.placements.map(value=>value.itemId===id?next:{...value}));
  }
  function rotateItem(){
    if(!selectedPlacement)return;
    setManual(layout.placements.map(value=>value.itemId===selectedId?{...value,rotation:value.rotation===0?90:0}:{...value}));
  }
  function addItem(preset:FurnitureItem){
    if(items.length>=12)return;
    const item={...preset,id:`${preset.kind}-${crypto.randomUUID()}`};
    setItems(old=>[...old,item]);setSelectedId(item.id);setManual(null);setCatalogOpen(false);
  }
  function removeItem(id:string){setItems(old=>old.filter(item=>item.id!==id));if(selectedId===id)setSelectedId(items.find(item=>item.id!==id)?.id??'');setManual(null);}
  function leave(){camera.stop();endAR();navigate('live');}
  const sceneRoom=planningRoom??{width:0,depth:0};
  const outlineReady=!reference||validFloorCorners(reference.corners);
  const nextAction=!room?{title:'Room dimensions',detail:'Enter the width and length of the area you want to furnish.',label:'Add measurements',action:openMeasurements}:!outlineReady?{title:'Floor outline',detail:'Mark the four corners of the measured area.',label:'Outline area',action:()=>{setView('photo');reveal('room-plan-stage');}}:!reviewed?{title:'Reserved areas',detail:'Mark existing furniture and access paths before choosing new pieces.',label:'Review available space',action:()=>reveal('room-fit-options')}:!items.length?{title:'Furniture options',detail:'Options are checked against your dimensions and reserved areas.',label:'View furniture options',action:()=>reveal('room-fit-options')}:{title:'Arrangement',detail:'Adjust position, dimensions, and materials in the plan.',label:'View arrangement',action:()=>{setView(reference?'photo':'3d');reveal('room-plan-stage');}};
  const recognitionText=device?(camera.localStatus==='unavailable'?'Live labels are unavailable in this browser. Capture the area to plan with measurements.':camera.localStatus==='loading'?'Preparing on-device labels…':camera.trackedObjects?.length?`${camera.trackedObjects.length} objects located · tap to capture`:camera.localStatus==='ready'?'Look around slowly, or capture the area to start planning.':'Camera preview · capture the area to start planning.'):camera.recognitionStatus==='retrying'?`Recognition reconnecting · retrying in ${camera.retryInSeconds}s`:camera.recognitionStatus==='error'?'Recognition paused · try again below':camera.analyzing?'Recognizing your room…':camera.analysis?camera.analysis.objects.length?`${camera.analysis.objects.length} objects located in this view`:'No objects located · try a brighter, closer view':camera.steady?'Looking for objects in this view':'Move slowly, then hold still';

  return <div ref={overlayRef} className={`room-studio ${device?'room-consumer':''} ${xrRunning?'room-in-ar':''}`}>
    {device&&!xrRunning&&saveError&&<p className="device-room-status" role="alert">{saveError}</p>}
    <header className="room-header"><button className="room-icon-button" onClick={leave} aria-label="Back to live space"><ArrowLeft size={19}/></button><button className="room-brand" onClick={()=>{camera.stop();endAR();navigate('home');}}><ScanLine size={23}/><strong>world<span>os</span></strong></button><span className="room-header-rule"/><span className="room-header-label">ROOM STUDIO</span><span className="room-header-note">A little imagination. Real dimensions.</span>{xrRunning&&<button className="room-secondary" onClick={endAR}><X size={16}/>End AR</button>}</header>
    <main className="room-workspace">
      <section className="room-visual-column" aria-label="Room visualization">
        <div className="room-heading"><div><span className="room-eyebrow">A PLACE FOR YOUR NEXT IDEA</span><h1>{device?'Room planner':'Your room. Reimagined.'}</h1><p>{device?'Plan furniture around the space you have.':'Pick your pieces. See them together, in your space.'}</p></div><span className="room-project-badge"><Check size={13}/> {device?'Saves automatically':`${items.length} pieces`}</span></div>
        {device&&<nav className="room-journey" aria-label="Room planning steps">{[{label:'Your space',done:!!room,action:openMeasurements},{label:'Keep clear',done:reviewed,action:()=>room?reveal('room-fit-options'):openMeasurements()},{label:'Find a fit',done:items.length>0,action:()=>room?reveal('room-fit-options'):openMeasurements()}].map((step,index)=><button key={step.label} onClick={step.action} aria-current={index===(!room?0:!reviewed?1:2)?'step':undefined}><span>{step.done?<Check size={14}/>:index+1}</span>{step.label}</button>)}</nav>}
        <details className="room-discovery" aria-label="Plan the space in front of you" open={!device||!room}><summary className="room-discovery-summary">{room?'Update photo or area':'Start with your space'}<ChevronDown size={18}/></summary><span className="room-eyebrow">LOOK. MEASURE. MAKE ROOM.</span><h2>Find what fits here.</h2><p>Capture the area, enter its measured width and length, and mark what must stay clear. Get furniture options that fit around it.</p><div className="room-photo-actions"><button className="room-primary" onClick={openCamera}><Camera size={18}/>Use camera</button><button className="room-secondary" onClick={openMeasurements}><Ruler size={17}/>Start with measurements</button></div><PhotoActions label="Choose room photo" cameraLabel="Take room photo" disabled={false} onPhoto={useRoomPhoto}/>{device&&<button className="room-example-entry" onClick={()=>setExampleOpen(true)}>Try an example room<ArrowRight size={15}/></button>}{captureError&&<p role="alert">{captureError}</p>}</details>
        <div className="room-launch" hidden={device&&!quickLookSupported&&!xrSupported}>
          {quickLookSupported?<><QuickLookLink url={quickLook.url} onOpen={openQuickLook} unavailableReason={arUnavailable}/><p>Point at the floor in Apple’s AR viewer.<br/><strong>No room dimensions needed for the preview.</strong></p></>:xrSupported?<><button className="room-primary" disabled={xrStarting} onClick={()=>void startAR()}>{xrStarting?<LoaderCircle size={18} className="spin"/>:<ScanLine size={18}/>} {xrStarting?'Starting scan…':'Scan & furnish in AR'}<ArrowRight size={17}/></button><p>Sweep slowly across the floor.<br/>Furniture appears when a stable area is ready.</p></>:<><button className="room-primary" onClick={openCamera}><Camera size={18}/>Recognize my room<ArrowRight size={17}/></button><p>{items.length?'Your furniture is arranged below.':'Start with the area you want to furnish.'}<br/>Measure the floor area to get suitable furniture options.</p></>}
        </div>
        {quickLookOpened&&<div className="room-ar-return" role="status"><Check size={17}/><p>Want a different arrangement? Move or resize your pieces below, then open AR again. <span>Room fit is still unconfirmed: Apple’s viewer does not send room measurements back.</span></p><button className="room-icon-button" aria-label="Dismiss AR tip" onClick={()=>setQuickLookOpened(false)}><X size={15}/></button></div>}
        {(xrError||camera.error||quickLook.error)&&<div role="alert" className="room-error"><p>{xrError||camera.error||quickLook.error}</p>{camera.recognitionStatus==='retrying'&&!xrError?<p>Trying recognition again in {camera.retryInSeconds}s. Your camera preview stays available.</p>:<button onClick={retryError}>Try again</button>}</div>}
        <div id="room-plan-stage" className="room-stage" hidden={device&&!planningRoom&&!reference&&view!=='camera'}>
          <div className="room-stage-toolbar"><div className="room-view-tabs" role="group" aria-label="Room view"><button aria-pressed={view==='3d'} onClick={()=>{camera.stop();setView('3d');}}><Layers3 size={15}/>3D room</button><button aria-pressed={view==='plan'} onClick={()=>{camera.stop();setView('plan');}}><Grid2X2 size={15}/>Floor plan</button><button aria-pressed={view==='camera'} onClick={openCamera}><Camera size={15}/>Camera</button>{reference&&<button aria-pressed={view==='photo'} onClick={()=>{camera.stop();setView('photo');}}>Photo plan</button>}</div><span className="room-scale-label">{sourceLabel} · {planningRoom?`${fmt(planningRoom.width)} × ${fmt(planningRoom.depth)} m`:'NOT MEASURED'}</span></div>
          <canvas className="room-xr-canvas" ref={canvasRef} aria-label="Furniture placed in the measured physical room"/>
          {!xrRunning&&view==='photo'&&reference&&<RoomPhoto reference={reference} onChange={updateReference} room={room} items={validItems} placements={visiblePlacements} zones={zones} selectedId={selectedId} onSelect={selectFurniture} onReserve={reserveObject}/>}
          {!xrRunning&&view==='3d'&&planningRoom&&<RoomPreview room={planningRoom} showWalls={!!room} items={validItems} placements={visiblePlacements} selectedId={selectedId} onSelect={selectFurniture} reserved={zones}/>}
          {!xrRunning&&view==='plan'&&planningRoom&&<FloorPlan room={planningRoom} items={validItems} placements={visiblePlacements} selectedId={selectedId} onSelect={selectFurniture} onMove={moveItem} conflictIds={conflictIds} zones={zones} onMoveZone={moveZone}/>}
          {!xrRunning&&view!=='camera'&&view!=='photo'&&!planningRoom&&<div className="room-preview-empty"><Layers3 size={32}/><strong>{!items.length?'Choose your furniture':source==='entered'?'Complete your room measurements':'Check furniture sizes'}</strong><p>{!items.length?'Add a piece to see your arrangement.':source==='entered'?'Add both width and length, or start a fresh arrangement without room measurements.':'Use valid furniture dimensions to prepare the preview.'}</p></div>}
          <div className="room-camera" hidden={view!=='camera'||xrRunning}>
            <div className="room-camera-image" style={{aspectRatio:cameraAspect,width:`min(100%, calc(var(--room-camera-height) * ${cameraAspect}))`}}><video ref={videoRef} autoPlay muted playsInline aria-label="Room camera preview" onLoadedMetadata={event=>{const video=event.currentTarget;if(video.videoWidth&&video.videoHeight)setCameraAspect(video.videoWidth/video.videoHeight);}}/>{(device||camera.steady)&&<div className="room-camera-objects">{[...(device?camera.trackedObjects??[]:camera.analysis?.objects??[])].sort((a,b)=>b.box.width*b.box.height-a.box.width*a.box.height).map(object=><button type="button" aria-label={`Capture room with ${object.label}`} key={object.id} onClick={captureRoom} style={{left:`${object.box.x*100}%`,top:`${object.box.y*100}%`,width:`${object.box.width*100}%`,height:`${object.box.height*100}%`}}><span>{object.label}</span></button>)}</div>}</div>
            {camera.status!=='live'?<div className="room-camera-start"><ScanLine size={42}/><h2>Start with the room in front of you.</h2><p>Hold still to recognize visible objects automatically. Camera recognition does not measure their real-world size.</p><button className="room-primary" disabled={camera.status==='starting'} onClick={()=>void camera.start()}><Camera size={18}/>{camera.status==='starting'?'Opening camera…':'Open camera & recognize'}</button><small>{device?'Recognition runs on your device. Photos stay here.':'Steady frames go to your configured AI service.'}</small></div>:<><span className="room-camera-status" role="status">{recognitionText}</span><div className="room-camera-action"><button className="room-primary" onClick={captureRoom}><Camera size={16}/>Capture this area</button>{quickLookSupported?<QuickLookLink url={quickLook.url} onOpen={openQuickLook} unavailableReason={arUnavailable}/>:xrSupported?<button className="room-primary" disabled={xrStarting} onClick={()=>void startAR()}><Maximize size={17}/>Place the furniture in AR</button>:<button className="room-primary" onClick={()=>{camera.stop();setView('3d');}}><Layers3 size={17}/>See my furniture in 3D</button>}<button className="room-secondary" onClick={camera.stop}>Stop camera</button></div></>}
          </div>
          {!xrRunning&&<div className="room-stage-footnote"><span>{source==='unmeasured'?'Suggested arrangement · your room has not been measured':!room?'Room measurement incomplete':'Furniture shown to measured scale · illustrative materials'}</span><span>1 unit = 1 metre</span></div>}
        </div>
        {device&&(room||reference||view==='camera')&&<section className="room-next-step" aria-label="Your next step"><span className="room-next-icon">{items.length?<Armchair size={23}/>:<Ruler size={23}/>}</span><div><h2>{nextAction.title}</h2><p>{nextAction.detail}</p></div><button onClick={nextAction.action}>{nextAction.label}<ArrowRight size={17}/></button></section>}
        <div hidden={device&&!room&&!items.length} className={`room-layout-result status-${source==='unmeasured'?'preview':layout.status}`} role="status"><div className="room-result-symbol">{items.length>0&&source!=='unmeasured'&&layout.status==='fits'&&!trackingPaused?<Check size={22}/>:<Layers3 size={22}/>}</div><div><span className="room-eyebrow">{source==='unmeasured'?'READY FOR YOUR SPACE':source==='ar'?'SCANNED FOOTPRINT FIT CHECK':'ROOM FIT CHECK'}</span><h2>{resultTitle}</h2><p>{trackingPaused?(arHasMeasurement?'Move slowly to recover tracking; live fit feedback is paused.':'Aim at the floor and move slowly to map more of it.'):!items.length?'Add pieces from the furniture collection to start arranging.':source==='unmeasured'&&layout.status==='fits'?`This arrangement needs a ${fmt(sceneRoom.width)} × ${fmt(sceneRoom.depth)} m footprint. Preview it in your room before checking the fit.`:layout.reason}</p></div>{room&&layout.status!=='unknown'&&<div className="room-area-stat"><strong>{fmt(layout.freeArea)}<small>m²</small></strong><span>unoccupied floor*</span></div>}</div>
        <p className="room-result-note" hidden={device&&!room&&!items.length}>{source==='unmeasured'?'Room fit is unconfirmed. Furniture uses editable example sizes.':'*Floor area, not a walking route.'} Check doors, windows, drawers, outlets and access. {room?.height?'Room height is included.':'Ceiling height is not checked.'}</p>
        {source!=='unmeasured'&&layout.issues.length>0&&<ul className="room-plan-issues" aria-label="Room plan issues">{layout.issues.map((issue,index)=><li key={`${issue.type}-${index}`}>{issue.message}</li>)}</ul>}
        {layout.unplacedIds.length>0&&<div className="room-unplaced"><strong>Still to place</strong><span>{layout.unplacedIds.map(id=>items.find(item=>item.id===id)?.label).filter(Boolean).join(', ')}</span><p>Try a smaller piece, a larger room, or another arrangement. Unplaced pieces are not shown in the preview.</p></div>}
      </section>

      <aside className="room-sidebar" aria-label="Room furnishing controls">
        <section id="room-measured-area" className="room-measure-section"><div className="room-section-heading"><h2><ScanLine size={17}/>Your space</h2><span>{source==='unmeasured'?'Ready to preview':source==='ar'?'AR estimate':'Entered'}</span></div>
          {room?<p>{fmt(room.width)} × {fmt(room.depth)} m{room.height?` · ${fmt(room.height)} m high`:''}{source==='ar'?' · observed floor area, not a full room scan':''}</p>:<p>{device?'Enter your room measurements to get furniture suggestions.':quickLookSupported?'Apple’s AR viewer finds a surface and places the furniture at its configured size.':'Start with the furniture. The arrangement is prepared automatically.'}</p>}
          {quickLookSupported&&<p className="room-capability-note">Safari can preview furniture in AR. Automatic room dimensions and a measured fit verdict require a native room scan.</p>}
          <button className="room-dimension-toggle" aria-expanded={measurementOpen} onClick={()=>setMeasurementOpen(value=>!value)}>{room?'Edit room dimensions':device?'Enter room dimensions':'I already know my room size'}<ChevronDown size={15}/></button>
          {measurementOpen&&<div className="room-measure-fields"><DimensionField label="Room width" value={roomFields.width} onChange={value=>editRoom('width',value)}/><DimensionField label="Room length" value={roomFields.depth} onChange={value=>editRoom('depth',value)}/><DimensionField label="Ceiling height" optional value={roomFields.height} onChange={value=>editRoom('height',value)}/></div>}
        </section>
        <div id="room-fit-options"><RoomOptions room={room} items={items} placements={layout.placements} gap={clearance} zones={zones} onZones={editZones} reviewed={reviewed} onReviewed={setReviewed} onMeasure={openMeasurements} onAdd={addSuggestion} layoutValid={layout.status==='fits'} photoReady={referenceReady&&(!reference||validFloorCorners(reference.corners))}/></div>
        <section className="room-furniture-section"><div className="room-section-heading"><h2>Your furniture <span>{items.length}/12</span></h2><button className="room-icon-button" aria-label="Add furniture" aria-expanded={catalogOpen} disabled={items.length>=12} onClick={()=>setCatalogOpen(value=>!value)}><Plus size={18}/></button></div>
          <p>{source==='unmeasured'?'One arrangement. All your pieces together.':'All pieces are checked together.'}</p>
          {catalogOpen&&<div className="room-catalog" aria-label="Furniture collection">{FURNITURE_PRESETS.map(item=><button key={item.id} onClick={()=>addItem(item)}><FurnitureIcon kind={item.kind}/><span>{item.label}<small>{fmt(item.width)} × {fmt(item.depth)} m</small></span><Plus size={16}/></button>)}</div>}
          <div className="room-furniture-list">{items.map(item=><div className={`room-furniture-row ${selectedId===item.id?'is-selected':''}`} key={item.id}><button aria-label={`Edit ${item.label}`} aria-pressed={selectedId===item.id} onClick={()=>selectFurniture(item.id)}><span className="room-furniture-icon" style={{background:item.color+'24',color:item.color}}><FurnitureIcon kind={item.kind}/></span><span><strong>{item.label}</strong><small>{fmt(item.width)} × {fmt(item.depth)} × {fmt(item.height)} m</small></span><span className={layout.unplacedIds.includes(item.id)||conflictIds.has(item.id)?'room-piece-state attention':'room-piece-state'}>{layout.unplacedIds.includes(item.id)?'Unplaced':conflictIds.has(item.id)?'Check':'Placed'}</span></button><button className="room-remove" aria-label={`Remove ${item.label}`} onClick={()=>removeItem(item.id)}><X size={14}/></button></div>)}</div>
          <button className="room-add-button" disabled={items.length>=12} onClick={()=>setCatalogOpen(value=>!value)}><Plus size={16}/>Add a piece</button>
        </section>
        <details className="room-fine-controls" open={customizeOpen} onToggle={event=>setCustomizeOpen(event.currentTarget.open)}><summary>Adjust size, finish & spacing <ChevronDown size={16}/></summary>
        {selected&&<section className="room-item-inspector"><div className="room-section-heading"><h2>{selected.label}</h2><span>Customize</span></div><p>{selected.kind==='bed'?'Outside bed-frame dimensions, including the headboard.':'Use the outside dimensions of your furniture.'}</p><div className="room-item-fields"><DimensionField label="Furniture width" value={selected.width} onChange={value=>editItem(selected.id,{width:value.trim()?Number(value):NaN})}/><DimensionField label="Furniture depth" value={selected.depth} onChange={value=>editItem(selected.id,{depth:value.trim()?Number(value):NaN})}/><DimensionField label="Furniture height" value={selected.height} onChange={value=>editItem(selected.id,{height:value.trim()?Number(value):NaN})}/></div>
          <div className="room-materials"><span>Finish</span>{materialColors.map(color=><button key={color.value} aria-label={`${color.name} finish`} aria-pressed={selected.color===color.value} style={{background:color.value}} onClick={()=>editItem(selected.id,{color:color.value})}>{selected.color===color.value&&<Check size={13}/>}</button>)}</div>
          <div className="room-placement-controls"><button disabled={!selectedPlacement} onClick={rotateItem}><RotateCcw size={16}/>Rotate 90°</button><button onClick={()=>setView('plan')}><Move size={16}/>Move in plan</button></div>
          {selectedPlacement&&<div className="room-nudge" aria-label={`Move ${selected.label} in 10 cm steps`}><span>Move 10 cm</span>{[{name:'left',x:-.1,z:0,Icon:ArrowLeft},{name:'back',x:0,z:-.1,Icon:ArrowUp},{name:'forward',x:0,z:.1,Icon:ArrowDown},{name:'right',x:.1,z:0,Icon:ArrowRight}].map(({name,x,z,Icon})=><button key={name} aria-label={`Move furniture ${name}`} onClick={()=>moveItem(selected.id,selectedPlacement.x+x,selectedPlacement.z+z)}><Icon size={15}/></button>)}</div>}
        </section>}
        <section className="room-arrangement"><label className="room-gap"><span>Space between pieces<small>A gap between footprints, not guaranteed access.</small></span><div><input aria-label="Space between furniture" type="number" min="0" max="3" step="0.05" value={gap} onChange={event=>{setGap(event.target.value);setManual(null);}}/><span>m</span></div></label><button className="room-primary" onClick={()=>setManual(null)} disabled={!planningRoom||!items.length}><Layers3 size={17}/>Arrange furniture</button><p className="room-fine-print">Changing sizes rearranges the room. Drag pieces in Floor plan to make it yours.</p></section>
        </details>
        <button className="room-text-button room-reset" onClick={resetRoom}><RotateCcw size={14}/>Start a fresh arrangement</button>
      </aside>
    </main>
    {xrRunning&&<div className="room-ar-controls"><div className="room-ar-instruction">
      <span className="room-eyebrow">{arHasMeasurement?'FURNITURE AT ROOM SCALE':detected?'MAPPING YOUR FLOOR':'AUTOMATIC FLOOR SCAN'}</span>
      <h2>{arHasMeasurement?(xrState?.phase==='ready'?`${layout.placements.length} pieces. Your space.`:'Tracking paused'):detected?`${fmt(detected.width)} × ${fmt(detected.length)} metres`:'Sweep slowly across the floor.'}</h2>
      <p>{arHasMeasurement?xrState?.message:xrState?.scan?.message??'Aim at the floor and move slowly from side to side. Furniture appears automatically when a stable area fits your pieces.'}</p>
      {!arHasMeasurement&&<>{detected&&<button className="room-primary" onClick={()=>{if(controller.current?.useDetectedSurface())setArMethod('surface');}}><Check size={18}/>{detected.label==='floor'?'Use detected floor area':'Use detected surface'}</button>}
        <small className="room-auto-scan-note">{detected?'Keep scanning to include more floor.':'No corners to mark. No room dimensions to enter.'} Only the observed floor area is measured; objects and doorways are not mapped.</small>
      </>}
      {!!xrState?.detectedSurfaces?.length&&!arHasMeasurement&&<div className="room-detected-surfaces"><span>Detected surface dimensions</span>{xrState.detectedSurfaces.map((surface,index)=><div key={`${surface.label}-${index}`}><strong>{surface.label}</strong><span>{fmt(surface.width)} × {fmt(surface.length)} m</span></div>)}<small>Surface area estimates. Full object dimensions are not inferred.</small></div>}
      {!!xrState?.detectedObjects?.length&&!arHasMeasurement&&<div className="room-detected-surfaces"><span>Observed object size estimates</span>{xrState.detectedObjects.map((object,index)=><div key={`${object.label}-${index}`}><strong>{object.label}</strong><span>{fmt(object.width)} × {fmt(object.length)} × {fmt(object.height)} m</span></div>)}<small>From your device’s scanned geometry. Hidden parts may be missing; these objects are not reserved in the furniture plan.</small></div>}
    </div>
      <div className="room-ar-bottom">{arHasMeasurement&&<><strong>{trackingPaused?'Fit paused until tracking returns':resultTitle}</strong><span>{room?`${fmt(room.width)} × ${fmt(room.depth)} m · `:''}{layout.placements.length} placed · approximate AR dimensions</span><small>Preview models. Check real furniture, doors and access.</small></>}<div><button className="room-secondary" onClick={()=>{controller.current?.reset();setArHasMeasurement(false);}}><Ruler size={16}/>Remeasure</button><button className="room-primary" onClick={()=>{endAR();setView(items.length?'3d':'plan');if(!items.length)reveal('room-fit-options');}}><Layers3 size={17}/>{items.length?'Edit in 3D':'See what fits'}</button></div></div>
    </div>}
    <RoomExample open={exampleOpen} onClose={()=>setExampleOpen(false)} onStart={openMeasurements}/>
  </div>;
}
