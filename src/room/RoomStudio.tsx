import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BedDouble, Box, Camera, Check, ChevronDown, Grid2X2, Layers3, LoaderCircle, Maximize, Move, Plus, RotateCcw, Ruler, ScanLine, Table2, X } from 'lucide-react';
import { navigate } from '../navigation';
import { useLiveCamera } from '../live/useLiveCamera';
import { isWorldARSupported, startWorldAR } from '../live/xr';
import type { WorldARController, WorldARState } from '../live/xr';
import { assessRoomLayout, FURNITURE_PRESETS, orientedSize, planRoom } from './layout';
import type { FurnitureItem, FurniturePlacement, RoomSize } from './layout';
import RoomPreview from './RoomPreview';
import { buildPreviewArrangement, supportsQuickLook } from './quickLook';
import { QuickLookLink, useQuickLookAsset } from './QuickLookLink';
import './room.css';

const finite = (value: number) => Number.isFinite(value) && value > 0 && value <= 30;
const fmt = (value: number) => Number.isFinite(value) ? Number(value.toFixed(2)).toString() : '—';
const initialItems = () => FURNITURE_PRESETS.filter(item => item.kind !== 'chair').map(item => ({ ...item }));
const materialColors = [{name:'Sage',value:'#7d8e73'}, {name:'Sand',value:'#c6ad8f'}, {name:'Clay',value:'#b77b65'}, {name:'Slate',value:'#687b85'}];
type Source = 'unmeasured' | 'entered' | 'ar';
type View = '3d' | 'plan' | 'camera';
type RoomFields = {width:string;depth:string;height:string};

function DimensionField({ label, value, onChange, optional=false }: {label:string;value:number|string;onChange:(value:string)=>void;optional?:boolean}) {
  return <label className="room-field"><span>{label}{optional?' (optional)':''}</span><div><input aria-label={label} type="number" inputMode="decimal" min="0.05" max="30" step="0.05" placeholder="—" value={typeof value==='number'&&!Number.isFinite(value)?'':value} onChange={event=>onChange(event.target.value)}/><span>m</span></div></label>;
}

function FurnitureIcon({kind}:{kind:FurnitureItem['kind']}) {
  return kind==='bed'?<BedDouble size={21}/>:kind==='wardrobe'?<Box size={21}/>:<Table2 size={21}/>;
}

function FloorPlan({room,items,placements,selectedId,onSelect,onMove,conflictIds}:{room:RoomSize;items:readonly FurnitureItem[];placements:readonly FurniturePlacement[];selectedId:string;onSelect:(id:string)=>void;onMove:(id:string,x:number,z:number)=>void;conflictIds:Set<string>}) {
  const svgRef=useRef<SVGSVGElement>(null);
  const drag=useRef<{id:string;dx:number;dz:number;pointer:number}|null>(null);
  const width=room.width,depth=room.depth,pad=Math.max(width,depth)*.12;
  const point=(event:ReactPointerEvent<SVGElement>)=>{
    const svg=svgRef.current,ctm=svg?.getScreenCTM();
    if(!svg||!ctm)return null;
    const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;
    return p.matrixTransform(ctm.inverse());
  };
  return <div className="room-floor-plan"><svg ref={svgRef} viewBox={`${-pad} ${-pad} ${width+2*pad} ${depth+2*pad}`} role="group" aria-label="Editable room floor plan" onPointerMove={event=>{const p=point(event);if(p&&drag.current)onMove(drag.current.id,p.x-drag.current.dx,p.y-drag.current.dz);}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
    <defs><pattern id="room-plan-grid" width=".25" height=".25" patternUnits="userSpaceOnUse"><path d="M .25 0 L 0 0 0 .25" fill="none" stroke="#dadcd1" strokeWidth=".009"/></pattern></defs>
    <rect width={width} height={depth} fill="#f8f8f0" stroke="#6a765f" strokeWidth=".035"/><rect width={width} height={depth} fill="url(#room-plan-grid)"/>
    <text x={width/2} y={-pad*.4} textAnchor="middle" fontSize={pad*.31} fill="#546047">{fmt(width)} m</text><text x={-pad*.45} y={depth/2} textAnchor="middle" fontSize={pad*.31} fill="#546047" transform={`rotate(-90 ${-pad*.45} ${depth/2})`}>{fmt(depth)} m</text>
    {placements.map(placement=>{const item=items.find(value=>value.id===placement.itemId);if(!item)return null;const size=orientedSize(item,placement.rotation);return <g key={item.id} role="button" tabIndex={0} aria-label={`Move ${item.label}`} aria-pressed={selectedId===item.id} onFocus={()=>onSelect(item.id)} onPointerDown={event=>{event.preventDefault();onSelect(item.id);const p=point(event);if(p){event.currentTarget.setPointerCapture(event.pointerId);drag.current={id:item.id,dx:p.x-placement.x,dz:p.y-placement.z,pointer:event.pointerId};}}} onKeyDown={event=>{const keys:Record<string,[number,number]>={ArrowLeft:[-.1,0],ArrowRight:[.1,0],ArrowUp:[0,-.1],ArrowDown:[0,.1]};if(keys[event.key]){event.preventDefault();const [dx,dz]=keys[event.key];onMove(item.id,placement.x+dx,placement.z+dz);}}} className={conflictIds.has(item.id)?'plan-item conflict':'plan-item'}>
      <rect x={placement.x} y={placement.z} width={size.width} height={size.depth} rx=".035" fill={item.color} fillOpacity=".62" stroke={conflictIds.has(item.id)?'#af4c36':selectedId===item.id?'#304c29':'#738169'} strokeWidth={selectedId===item.id ? .045 : .02}/>
      <text x={placement.x+size.width/2} y={placement.z+size.depth/2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(.14,size.width*.14)} fill="#263422">{item.label}</text>
      <text x={placement.x+size.width/2} y={placement.z+size.depth/2+.19} textAnchor="middle" fontSize={Math.min(.1,size.width*.11)} fill="#35432d">{fmt(size.width)} × {fmt(size.depth)} m</text>
    </g>;})}
  </svg><p><Move size={14}/>Drag to arrange. Arrow keys move the selected piece 10 cm.</p></div>;
}

export default function RoomStudio({active=true}:{active?:boolean}) {
  const [roomFields,setRoomFields]=useState<RoomFields>({width:'',depth:'',height:''});
  const [source,setSource]=useState<Source>('unmeasured'),[view,setView]=useState<View>('3d');
  const [quickLookSupported]=useState(supportsQuickLook);
  const [quickLookOpened,setQuickLookOpened]=useState(false);
  const [items,setItems]=useState<FurnitureItem[]>(initialItems);
  const [selectedId,setSelectedId]=useState(()=>initialItems()[0]?.id??'');
  const [gap,setGap]=useState('0.3');
  const [manual,setManual]=useState<FurniturePlacement[]|null>(null);
  const [measurementOpen,setMeasurementOpen]=useState(false),[catalogOpen,setCatalogOpen]=useState(false);
  const [xrSupported,setXrSupported]=useState<boolean|null>(null),[xrRunning,setXrRunning]=useState(false),[xrStarting,setXrStarting]=useState(false),[xrState,setXrState]=useState<WorldARState|null>(null),[xrError,setXrError]=useState('');
  const [arHasMeasurement,setArHasMeasurement]=useState(false);
  const [arMethod,setArMethod]=useState<'corners'|'surface'>('corners');
  const [cameraAspect,setCameraAspect]=useState(4/3);
  const videoRef=useRef<HTMLVideoElement>(null),canvasRef=useRef<HTMLCanvasElement>(null),overlayRef=useRef<HTMLDivElement>(null);
  const controller=useRef<WorldARController|null>(null),abort=useRef<AbortController|null>(null),epoch=useRef(0),activeRef=useRef(active),nextId=useRef(1);
  activeRef.current=active;
  const camera=useLiveCamera({active:active&&view==='camera'&&!xrRunning&&!xrStarting,autoAnalyze:true,videoRef});
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
  const layout=useMemo(()=>manual?assessRoomLayout(planningRoom,items,manual,clearance):source==='unmeasured'&&previewArrangement?assessRoomLayout(previewArrangement.room,items,previewArrangement.placements,clearance):planRoom(room,items,clearance),[room,planningRoom,items,manual,clearance,source,previewArrangement]);
  const selected=items.find(item=>item.id===selectedId);
  const selectedPlacement=layout.placements.find(placement=>placement.itemId===selectedId);
  const conflictIds=new Set(layout.issues.flatMap(issue=>issue.itemIds));
  const validItems=items.filter(item=>[item.width,item.depth,item.height].every(finite));
  const visiblePlacements=layout.placements.filter(placement=>validItems.some(item=>item.id===placement.itemId));
  const trackingPaused=xrRunning&&xrState?.phase!=='ready';
  const resultTitle=trackingPaused?(arHasMeasurement?'Tracking paused':'Scanning your floor…'):!items.length?'Choose your furniture':layout.status==='unknown'?(source==='unmeasured'?'Check furniture sizes':'Add valid measurements'):layout.status==='conflict'?'This arrangement needs a change':source==='unmeasured'?`${items.length} pieces, one arrangement`:layout.status==='fits'?`All ${items.length} fit the measured space`:`${layout.placements.length} of ${items.length} placed`;
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
  useEffect(()=>{if(!active)endAR();},[active,endAR]);
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
    if(!xrRunning||arHasMeasurement||xrState?.scan?.phase!=='stable'||!detected||!items.length)return;
    if(planRoom({width:detected.width,depth:detected.length},items,clearance).status==='fits'){
      setArMethod('surface');controller.current?.useDetectedSurface();
    }
  },[xrRunning,arHasMeasurement,xrState,detected,items,clearance]);

  async function startAR(){
    if(!canvasRef.current||!overlayRef.current||xrStarting||xrRunning)return;
    const request=++epoch.current;abort.current?.abort();abort.current=new AbortController();camera.stop();setXrError('');setXrStarting(true);setArHasMeasurement(false);setArMethod('corners');
    try{
      const value=await startWorldAR({canvas:canvasRef.current,overlay:overlayRef.current,measurementMode:'scan',signal:abort.current.signal,onState:state=>{
        if(request!==epoch.current)return;setXrState(state);
        if(state.phase==='ended'){epoch.current++;abort.current?.abort();controller.current=null;setXrRunning(false);setXrStarting(false);setArHasMeasurement(false);}
      },onMeasurement:measurement=>{
        if(request!==epoch.current)return;setArHasMeasurement(!!measurement);
        if(measurement){setRoomFields({width:String(measurement.width),depth:String(measurement.length),height:''});setSource('ar');setArMethod('surface');setManual(null);}
        else{setRoomFields({width:'',depth:'',height:''});setSource('unmeasured');setManual(null);}
      }});
      if(request!==epoch.current||!activeRef.current){await value.end();return;}
      controller.current=value;setXrRunning(true);setXrStarting(false);
    }catch(error){if(request!==epoch.current)return;setXrStarting(false);setXrRunning(false);setXrError(error instanceof Error?error.message:'AR could not start. You can still explore your furniture in 3D.');}
  }
  function editRoom(key:keyof RoomFields,value:string){setSource('entered');setRoomFields(old=>({...old,[key]:value}));setManual(null);}
  function openCamera(){flushSync(()=>setView('camera'));void camera.start();}
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
    const item={...preset,id:`${preset.kind}-${nextId.current++}`};
    setItems(old=>[...old,item]);setSelectedId(item.id);setManual(null);setCatalogOpen(false);
  }
  function removeItem(id:string){setItems(old=>old.filter(item=>item.id!==id));if(selectedId===id)setSelectedId(items.find(item=>item.id!==id)?.id??'');setManual(null);}
  function leave(){camera.stop();endAR();navigate('live');}
  const sceneRoom=planningRoom??{width:0,depth:0};

  return <div ref={overlayRef} className={`room-studio ${xrRunning?'room-in-ar':''}`}>
    <header className="room-header"><button className="room-icon-button" onClick={leave} aria-label="Back to live space"><ArrowLeft size={19}/></button><button className="room-brand" onClick={()=>{camera.stop();endAR();navigate('home');}}><ScanLine size={23}/><strong>world<span>os</span></strong></button><span className="room-header-rule"/><span className="room-header-label">ROOM STUDIO</span><span className="room-header-note">A little imagination. Real dimensions.</span>{xrRunning&&<button className="room-secondary" onClick={endAR}><X size={16}/>End AR</button>}</header>
    <main className="room-workspace">
      <section className="room-visual-column" aria-label="Room visualization">
        <div className="room-heading"><div><span className="room-eyebrow">FROM EMPTY TO YOURS</span><h1>Your room. Reimagined.</h1><p>Pick your pieces. See them together, in your space.</p></div><span className="room-project-badge"><span/> {items.length} pieces</span></div>
        <div className="room-launch">
          {quickLookSupported?<><QuickLookLink url={quickLook.url} onOpen={openQuickLook} unavailableReason={arUnavailable}/><p>Point at the floor in Apple’s AR viewer.<br/><strong>No room dimensions needed for the preview.</strong></p></>:xrSupported?<><button className="room-primary" disabled={xrStarting} onClick={()=>void startAR()}>{xrStarting?<LoaderCircle size={18} className="spin"/>:<ScanLine size={18}/>} {xrStarting?'Starting scan…':'Scan & furnish in AR'}<ArrowRight size={17}/></button><p>Sweep slowly across the floor.<br/>Furniture appears when a stable area is ready.</p></>:<><button className="room-primary" onClick={openCamera}><Camera size={18}/>Recognize my room<ArrowRight size={17}/></button><p>Your furniture is arranged below.<br/>Open this page in iPhone Safari for a camera AR preview.</p></>}
        </div>
        {quickLookOpened&&<div className="room-ar-return" role="status"><Check size={17}/><p>Want a different arrangement? Move or resize your pieces below, then open AR again. <span>Room fit is still unconfirmed: Apple’s viewer does not send room measurements back.</span></p><button className="room-icon-button" aria-label="Dismiss AR tip" onClick={()=>setQuickLookOpened(false)}><X size={15}/></button></div>}
        <div className="room-stage">
          <div className="room-stage-toolbar"><div className="room-view-tabs" role="group" aria-label="Room view"><button aria-pressed={view==='3d'} onClick={()=>{camera.stop();setView('3d');}}><Layers3 size={15}/>3D room</button><button aria-pressed={view==='plan'} onClick={()=>{camera.stop();setView('plan');}}><Grid2X2 size={15}/>Floor plan</button><button aria-pressed={view==='camera'} onClick={openCamera}><Camera size={15}/>Camera</button></div><span className="room-scale-label">{sourceLabel} · {planningRoom?`${fmt(planningRoom.width)} × ${fmt(planningRoom.depth)} m`:'NOT MEASURED'}</span></div>
          <canvas className="room-xr-canvas" ref={canvasRef} aria-label="Furniture placed in the measured physical room"/>
          {!xrRunning&&view==='3d'&&planningRoom&&<RoomPreview room={planningRoom} showWalls={!!room} items={validItems} placements={visiblePlacements} selectedId={selectedId} onSelect={setSelectedId}/>}
          {!xrRunning&&view==='plan'&&planningRoom&&<FloorPlan room={planningRoom} items={validItems} placements={visiblePlacements} selectedId={selectedId} onSelect={setSelectedId} onMove={moveItem} conflictIds={conflictIds}/>}
          {!xrRunning&&view!=='camera'&&!planningRoom&&<div className="room-preview-empty"><Layers3 size={32}/><strong>{!items.length?'Choose your furniture':source==='entered'?'Complete your room measurements':'Check furniture sizes'}</strong><p>{!items.length?'Add a piece to see your arrangement.':source==='entered'?'Add both width and length, or start a fresh arrangement without room measurements.':'Use valid furniture dimensions to prepare the preview.'}</p></div>}
          <div className="room-camera" hidden={view!=='camera'||xrRunning}>
            <div className="room-camera-image" style={{aspectRatio:cameraAspect,width:`min(100%, calc(var(--room-camera-height) * ${cameraAspect}))`}}><video ref={videoRef} autoPlay muted playsInline aria-label="Room camera preview" onLoadedMetadata={event=>{const video=event.currentTarget;if(video.videoWidth&&video.videoHeight)setCameraAspect(video.videoWidth/video.videoHeight);}}/>{camera.analysis&&camera.steady&&<div className="room-camera-objects">{camera.analysis.objects.map(object=><div key={object.id} style={{left:`${object.box.x*100}%`,top:`${object.box.y*100}%`,width:`${object.box.width*100}%`,height:`${object.box.height*100}%`}}><span>{object.label}</span></div>)}</div>}</div>
            {camera.status!=='live'?<div className="room-camera-start"><ScanLine size={42}/><h2>Start with the room in front of you.</h2><p>Hold still to recognize visible objects automatically. Camera recognition does not measure their real-world size.</p><button className="room-primary" disabled={camera.status==='starting'} onClick={()=>void camera.start()}><Camera size={18}/>{camera.status==='starting'?'Opening camera…':'Open camera & recognize'}</button><small>Steady frames go to your configured AI service.</small></div>:<><span className="room-camera-status">{camera.analyzing?'Recognizing your room…':camera.steady?'Live camera · hold a clear floor view':'Move slowly, then hold still'}</span><div className="room-camera-action">{quickLookSupported?<QuickLookLink url={quickLook.url} onOpen={openQuickLook} unavailableReason={arUnavailable}/>:xrSupported?<button className="room-primary" disabled={xrStarting} onClick={()=>void startAR()}><Maximize size={17}/>Place the furniture in AR</button>:<button className="room-primary" onClick={()=>{camera.stop();setView('3d');}}><Layers3 size={17}/>See my furniture in 3D</button>}<button className="room-secondary" onClick={camera.stop}>Stop camera</button></div></>}
          </div>
          {!xrRunning&&<div className="room-stage-footnote"><span>{source==='unmeasured'?'Suggested arrangement · your room has not been measured':!room?'Room measurement incomplete':'Furniture shown to measured scale · illustrative materials'}</span><span>1 unit = 1 metre</span></div>}
        </div>
        <div className={`room-layout-result status-${source==='unmeasured'?'preview':layout.status}`} role="status"><div className="room-result-symbol">{source!=='unmeasured'&&layout.status==='fits'&&!trackingPaused?<Check size={22}/>:<Layers3 size={22}/>}</div><div><span className="room-eyebrow">{source==='unmeasured'?'READY FOR YOUR SPACE':source==='ar'?'SCANNED FOOTPRINT FIT CHECK':'ROOM FIT CHECK'}</span><h2>{resultTitle}</h2><p>{trackingPaused?(arHasMeasurement?'Move slowly to recover tracking; live fit feedback is paused.':'Aim at the floor and move slowly to map more of it.'):!items.length?'Add pieces from the furniture collection to start arranging.':source==='unmeasured'&&layout.status==='fits'?`This arrangement needs a ${fmt(sceneRoom.width)} × ${fmt(sceneRoom.depth)} m footprint. Preview it in your room before checking the fit.`:layout.reason}</p></div>{room&&<div className="room-area-stat"><strong>{fmt(layout.freeArea)}<small>m²</small></strong><span>unoccupied floor*</span></div>}</div>
        <p className="room-result-note">{source==='unmeasured'?'Room fit is unconfirmed. Furniture uses editable example sizes.':'*Floor area, not a walking route.'} Check doors, windows, drawers, outlets and access. {room?.height?'Room height is included.':'Ceiling height is not checked.'}</p>
        {layout.unplacedIds.length>0&&<div className="room-unplaced"><strong>Still to place</strong><span>{layout.unplacedIds.map(id=>items.find(item=>item.id===id)?.label).filter(Boolean).join(', ')}</span><p>Try a smaller piece, a larger room, or another arrangement. Unplaced pieces are not shown in the preview.</p></div>}
      </section>

      <aside className="room-sidebar" aria-label="Room furnishing controls">
        <section className="room-measure-section"><div className="room-section-heading"><h2><ScanLine size={17}/>Your space</h2><span>{source==='unmeasured'?'Ready to preview':source==='ar'?'AR estimate':'Entered'}</span></div>
          {room?<p>{fmt(room.width)} × {fmt(room.depth)} m{room.height?` · ${fmt(room.height)} m high`:''}{source==='ar'?' · observed floor area, not a full room scan':''}</p>:<p>{quickLookSupported?'Apple’s AR viewer finds a surface and places the furniture at its configured size.':'Start with the furniture. The arrangement is prepared automatically.'}</p>}
          {quickLookSupported&&<p className="room-capability-note">Safari can preview furniture in AR. Automatic room dimensions and a measured fit verdict require a native room scan.</p>}
          <button className="room-dimension-toggle" aria-expanded={measurementOpen} onClick={()=>setMeasurementOpen(value=>!value)}>{room?'Edit room dimensions':'I already know my room size'}<ChevronDown size={15}/></button>
          {measurementOpen&&<div className="room-measure-fields"><DimensionField label="Room width" value={roomFields.width} onChange={value=>editRoom('width',value)}/><DimensionField label="Room length" value={roomFields.depth} onChange={value=>editRoom('depth',value)}/><DimensionField label="Ceiling height" optional value={roomFields.height} onChange={value=>editRoom('height',value)}/></div>}
        </section>
        <section className="room-furniture-section"><div className="room-section-heading"><h2>Your furniture <span>{items.length}/12</span></h2><button className="room-icon-button" aria-label="Add furniture" aria-expanded={catalogOpen} disabled={items.length>=12} onClick={()=>setCatalogOpen(value=>!value)}><Plus size={18}/></button></div>
          <p>{source==='unmeasured'?'One arrangement. All your pieces together.':'All pieces are checked together.'}</p>
          {catalogOpen&&<div className="room-catalog" aria-label="Furniture collection">{FURNITURE_PRESETS.map(item=><button key={item.id} onClick={()=>addItem(item)}><FurnitureIcon kind={item.kind}/><span>{item.label}<small>{fmt(item.width)} × {fmt(item.depth)} m</small></span><Plus size={16}/></button>)}</div>}
          <div className="room-furniture-list">{items.map(item=><div className={`room-furniture-row ${selectedId===item.id?'is-selected':''}`} key={item.id}><button aria-label={`Edit ${item.label}`} aria-pressed={selectedId===item.id} onClick={()=>setSelectedId(item.id)}><span className="room-furniture-icon" style={{background:item.color+'24',color:item.color}}><FurnitureIcon kind={item.kind}/></span><span><strong>{item.label}</strong><small>{fmt(item.width)} × {fmt(item.depth)} × {fmt(item.height)} m</small></span><span className={layout.unplacedIds.includes(item.id)||conflictIds.has(item.id)?'room-piece-state attention':'room-piece-state'}>{layout.unplacedIds.includes(item.id)?'Unplaced':conflictIds.has(item.id)?'Check':'Placed'}</span></button><button className="room-remove" aria-label={`Remove ${item.label}`} onClick={()=>removeItem(item.id)}><X size={14}/></button></div>)}</div>
          <button className="room-add-button" disabled={items.length>=12} onClick={()=>setCatalogOpen(value=>!value)}><Plus size={16}/>Add a piece</button>
        </section>
        {selected&&<section className="room-item-inspector"><div className="room-section-heading"><h2>{selected.label}</h2><span>Customize</span></div><p>{selected.kind==='bed'?'Outside bed-frame dimensions, including the headboard.':'Use the outside dimensions of your furniture.'}</p><div className="room-item-fields"><DimensionField label="Furniture width" value={selected.width} onChange={value=>editItem(selected.id,{width:value.trim()?Number(value):NaN})}/><DimensionField label="Furniture depth" value={selected.depth} onChange={value=>editItem(selected.id,{depth:value.trim()?Number(value):NaN})}/><DimensionField label="Furniture height" value={selected.height} onChange={value=>editItem(selected.id,{height:value.trim()?Number(value):NaN})}/></div>
          <div className="room-materials"><span>Material mood</span>{materialColors.map(color=><button key={color.value} aria-label={`${color.name} finish`} aria-pressed={selected.color===color.value} style={{background:color.value}} onClick={()=>editItem(selected.id,{color:color.value})}>{selected.color===color.value&&<Check size={13}/>}</button>)}</div>
          <div className="room-placement-controls"><button disabled={!selectedPlacement} onClick={rotateItem}><RotateCcw size={16}/>Rotate 90°</button><button onClick={()=>setView('plan')}><Move size={16}/>Move in plan</button></div>
          {selectedPlacement&&<div className="room-nudge" aria-label={`Move ${selected.label} in 10 cm steps`}><span>Move 10 cm</span>{[{name:'left',x:-.1,z:0,Icon:ArrowLeft},{name:'back',x:0,z:-.1,Icon:ArrowUp},{name:'forward',x:0,z:.1,Icon:ArrowDown},{name:'right',x:.1,z:0,Icon:ArrowRight}].map(({name,x,z,Icon})=><button key={name} aria-label={`Move furniture ${name}`} onClick={()=>moveItem(selected.id,selectedPlacement.x+x,selectedPlacement.z+z)}><Icon size={15}/></button>)}</div>}
        </section>}
        <section className="room-arrangement"><label className="room-gap"><span>Space between pieces<small>A gap between footprints, not guaranteed access.</small></span><div><input aria-label="Space between furniture" type="number" min="0" max="3" step="0.05" value={gap} onChange={event=>{setGap(event.target.value);setManual(null);}}/><span>m</span></div></label><button className="room-primary" onClick={()=>setManual(null)} disabled={!planningRoom||!items.length}><Layers3 size={17}/>Arrange furniture</button><p className="room-fine-print">Changing sizes rearranges the room. Drag pieces in Floor plan to make it yours.</p></section>
        {(xrError||camera.error||quickLook.error)&&<div role="alert" className="room-error"><p>{xrError||camera.error||quickLook.error}</p><button onClick={retryError}>Try again</button></div>}
        <button className="room-text-button room-reset" onClick={()=>{endAR();camera.stop();setItems(initialItems());setSelectedId(initialItems()[0]?.id??'');setRoomFields({width:'',depth:'',height:''});setSource('unmeasured');setManual(null);setGap('0.3');setMeasurementOpen(false);setView('3d');}}><RotateCcw size={14}/>Start a fresh arrangement</button>
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
      <div className="room-ar-bottom">{arHasMeasurement&&<><strong>{trackingPaused?'Fit paused until tracking returns':resultTitle}</strong><span>{room?`${fmt(room.width)} × ${fmt(room.depth)} m · `:''}{layout.placements.length} placed · approximate AR dimensions</span><small>Preview models. Check real furniture, doors and access.</small></>}<div><button className="room-secondary" onClick={()=>{controller.current?.reset();setArHasMeasurement(false);}}><Ruler size={16}/>Remeasure</button><button className="room-primary" onClick={()=>{endAR();setView('3d');}}><Layers3 size={17}/>Edit in 3D</button></div></div>
    </div>}
  </div>;
}
