import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Box, Camera, Check, ChevronDown, Crosshair, Eye, LoaderCircle, Maximize, Pause, RotateCcw, Ruler, ScanLine, ShieldCheck, VideoOff, X } from 'lucide-react';
import { navigate } from '../navigation';
import { assessFit, ITEM_PRESETS, suggestFits } from './fit';
import type { ItemDimensions, SpaceDimensions } from './fit';
import { isWorldARSupported, startWorldAR } from './xr';
import type { WorldARController, WorldARMeasurement, WorldARState } from './xr';
import { useLiveCamera } from './useLiveCamera';
import './live.css';

type Fields={width:string;length:string;height:string};
type Unit='cm'|'m';
const factor=(unit:Unit)=>unit==='cm'?.01:1;
const display=(value:number,unit:Unit)=>String(Number((value/factor(unit)).toFixed(2)));
const fields=(value:SpaceDimensions,unit:Unit):Fields=>({width:display(value.width,unit),length:display(value.length,unit),height:value.height===undefined?'':display(value.height,unit)});
const number=(value:string,unit:Unit)=>value.trim()===''?NaN:Number(value)*factor(unit);
const meters=(value:number)=>`${Number(value.toFixed(2))} m`;
const dimensions=(value:Fields,unit:Unit):SpaceDimensions=>({width:number(value.width,unit),length:number(value.length,unit),...(value.height.trim()?{height:number(value.height,unit)}:{})});

function DimensionInputs({value,onChange,unit,prefix,height=true}:{value:Fields;onChange:(v:Fields)=>void;unit:Unit;prefix:string;height?:boolean}) {
  return <div className="live-dimensions">{(['width','length',...(height?['height']:[])] as (keyof Fields)[]).map(key=><label key={key}><span>{key==='length'?'Length':key==='height'?'Height (optional)':'Width'}</span><div><input aria-label={`${prefix} ${key}`} type="number" inputMode="decimal" min="0" step="any" value={value[key]} placeholder="—" onChange={e=>onChange({...value,[key]:e.target.value})}/><span>{unit}</span></div></label>)}</div>;
}

function FootprintPlan({space,item,rotation,clearance}:{space:SpaceDimensions;item:ItemDimensions;rotation:0|90;clearance:number}) {
  if(![space.width,space.length,item.width,item.length,clearance].every(Number.isFinite)||Math.min(space.width,space.length,item.width,item.length)<=0)return null;
  const iw=rotation?item.length:item.width,il=rotation?item.width:item.length;
  const scale=Math.min(280/Math.max(space.width,iw+2*clearance),170/Math.max(space.length,il+2*clearance));
  const sw=space.width*scale,sl=space.length*scale,w=iw*scale,l=il*scale;
  return <div className="fit-plan"><svg viewBox="0 0 320 210" role="img" aria-label={`Top-down dimension comparison. Space ${meters(space.width)} by ${meters(space.length)}. ${item.label} ${meters(iw)} by ${meters(il)}.`}>
    <rect x={(320-sw)/2} y={(210-sl)/2} width={sw} height={sl} className="fit-plan-space"/>
    <rect x={(320-w)/2-clearance*scale} y={(210-l)/2-clearance*scale} width={w+clearance*2*scale} height={l+clearance*2*scale} className="fit-plan-margin"/>
    <rect x={(320-w)/2} y={(210-l)/2} width={w} height={l} className="fit-plan-item"/>
    <path d="M154 105h12m-6-6v12" stroke="currentColor"/>
  </svg><span>TOP-DOWN PLAN <span>Item + clearance · {rotation===90?'rotated 90°':'original orientation'}</span></span></div>;
}

export default function LiveSpace({active=true}:{active?:boolean}) {
  const videoRef=useRef<HTMLVideoElement>(null),canvasRef=useRef<HTMLCanvasElement>(null),overlayRef=useRef<HTMLDivElement>(null);
  const controller=useRef<WorldARController|null>(null),xrAbort=useRef<AbortController|null>(null),epoch=useRef(0),activeRef=useRef(active);
  activeRef.current=active;
  const [autoAnalyze,setAutoAnalyze]=useState(true),[xrSupported,setXrSupported]=useState<boolean|null>(null),[xrRunning,setXrRunning]=useState(false),[xrStarting,setXrStarting]=useState(false);
  const [xrState,setXrState]=useState<WorldARState|null>(null),[measurement,setMeasurement]=useState<WorldARMeasurement|null>(null),[xrError,setXrError]=useState('');
  const camera=useLiveCamera({active:active&&!xrRunning&&!xrStarting,autoAnalyze,videoRef});
  const [unit,setUnit]=useState<Unit>('cm'),[selected,setSelected]=useState(ITEM_PRESETS[0].id),[label,setLabel]=useState(ITEM_PRESETS[0].label);
  const [itemFields,setItemFields]=useState<Fields>(()=>fields(ITEM_PRESETS[0],'cm')),[spaceFields,setSpaceFields]=useState<Fields>({width:'',length:'',height:''}),[margin,setMargin]=useState('5');
  const [source,setSource]=useState<'ar'|'manual'|null>(null),[actualSize,setActualSize]=useState(false),[measuring,setMeasuring]=useState(false),[aspect,setAspect]=useState(4/3);
  const item:ItemDimensions={id:selected,label,...dimensions(itemFields,unit)};
  const clearance=number(margin,unit);
  const trackingLost=xrRunning&&xrState?.phase==='tracking-lost';
  const space:SpaceDimensions|null=source==='ar'?(active&&xrRunning&&xrState?.phase==='ready'&&measurement?{width:measurement.width,length:measurement.length}:null):source==='manual'?dimensions(spaceFields,unit):null;
  const assessment=assessFit(space,item,clearance);
  const candidates=useMemo(()=>suggestFits(space,ITEM_PRESETS,clearance),[space?.width,space?.length,space?.height,clearance]);
  const recognized=camera.analysis?.objects??[];
  const cameraLive=camera.status==='live';
  const car=/car|vehicle/i.test(`${selected} ${label}`);

  useEffect(()=>{let mounted=true;void isWorldARSupported().then(value=>{if(mounted)setXrSupported(value);}).catch(()=>{if(mounted)setXrSupported(false);});return()=>{mounted=false;};},[]);
  useEffect(()=>{
    if(!active){epoch.current++;xrAbort.current?.abort();void controller.current?.end();controller.current=null;setXrRunning(false);setXrStarting(false);setMeasurement(null);setSource(old=>old==='ar'?null:old);}
  },[active]);
  useEffect(()=>{
    const end=()=>{epoch.current++;xrAbort.current?.abort();void controller.current?.end();controller.current=null;setXrRunning(false);setXrStarting(false);setMeasurement(null);setSource(old=>old==='ar'?null:old);};
    const visibility=()=>{if(document.hidden)end();};
    document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',end);window.addEventListener('worldos:session-expired',end);
    return()=>{epoch.current++;xrAbort.current?.abort();void controller.current?.end();controller.current=null;document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',end);window.removeEventListener('worldos:session-expired',end);};
  },[]);
  useEffect(()=>{
    if(controller.current)controller.current.setFootprint([item.width,item.length,clearance].every(Number.isFinite)&&item.width>0&&item.length>0&&item.width<=50&&item.length<=50&&clearance>=0&&clearance<=50?{width:item.width,length:item.length,clearance,rotated:assessment.rotation===90}:null);
  },[item.width,item.length,clearance,assessment.rotation,xrRunning]);

  async function startAR() {
    if(!canvasRef.current||!overlayRef.current||xrStarting||xrRunning)return;
    const request=++epoch.current;xrAbort.current?.abort();xrAbort.current=new AbortController();camera.stop();setXrError('');setXrStarting(true);setMeasurement(null);setSource('ar');
    try{
      const value=await startWorldAR({canvas:canvasRef.current,overlay:overlayRef.current,signal:xrAbort.current.signal,onState:state=>{if(request!==epoch.current)return;setXrState(state);if(state.phase==='ended'){controller.current=null;setXrRunning(false);setXrStarting(false);}},onMeasurement:value=>{if(request===epoch.current){setMeasurement(value);if(value)setMeasuring(false);}}});
      if(request!==epoch.current||!activeRef.current){await value.end();return;}
      controller.current=value;setXrRunning(true);setXrStarting(false);setMeasuring(true);
    }catch(error){if(request!==epoch.current)return;setXrStarting(false);setXrRunning(false);setSource(null);setXrError(error instanceof Error?error.message:'Spatial AR could not start. You can still use your camera and enter measurements.');}
  }
  async function endAR(){epoch.current++;xrAbort.current?.abort();const old=controller.current;controller.current=null;setXrRunning(false);setXrStarting(false);setMeasurement(null);if(source==='ar')setSource(null);await old?.end();}
  function leave(){camera.stop();void endAR();navigate('home');}
  function chooseItem(value:ItemDimensions){setSelected(value.id);setLabel(value.label);const nextUnit=/car|vehicle/i.test(value.id)?'m':unit;changeUnit(nextUnit);setItemFields(fields(value,nextUnit));setMargin(display(/car|vehicle/i.test(value.id)?.3:.05,nextUnit));setActualSize(false);}
  function changeUnit(next:Unit){if(next===unit)return;const convert=(value:Fields):Fields=>Object.fromEntries(Object.entries(value).map(([key,val])=>[key,val.trim()&&Number.isFinite(Number(val))?display(Number(val)*factor(unit),next):val])) as Fields;setItemFields(convert);setSpaceFields(convert);if(margin.trim()&&Number.isFinite(Number(margin)))setMargin(display(Number(margin)*factor(unit),next));setUnit(next);}
  function useManual(){void endAR();setSource('manual');setMeasuring(true);}
  const resultTitle=assessment.verdict==='unknown'?'Measure first. Then know.':assessment.verdict==='fits'?(actualSize?'Footprint fits':'Example footprint fits'):assessment.verdict==='too-tight'?'Fits without your margin':'Needs more room';
  const statusText=xrStarting?'Starting spatial AR':xrRunning?(trackingLost?'Tracking paused':'Spatial AR'):cameraLive?(camera.analyzing?'Recognizing this view':camera.steady?'Camera steady':'Move, then hold still'):'Camera is off';

  return <div ref={overlayRef} className={`live-app ${xrRunning?'is-xr':''} ${cameraLive?'camera-active':''} ${xrState?.points===3?'xr-measured':''}`}>
    <header className="live-header"><button className="live-back" onClick={leave} aria-label="Back to home"><ArrowLeft size={18}/></button><div className="live-wordmark"><ScanLine size={22}/><strong>world<span>os</span></strong><span className="live-header-divider"/><span>LIVE SPACE</span></div><span className="live-session-status"><i className={cameraLive||xrRunning?'on':''}/>{statusText}</span><button className="live-close" onClick={leave} aria-label="Close live space"><X size={19}/></button></header>
    <div className="live-layout">
      <section className="live-viewer" aria-label="Live camera and spatial view">
        <canvas ref={canvasRef} className="xr-canvas" aria-label="World-anchored AR outlines"/>
        <div className="live-video-wrap" style={{aspectRatio:aspect}}>
          <video ref={videoRef} autoPlay playsInline muted aria-label="Live camera preview" onLoadedMetadata={e=>{const video=e.currentTarget;if(video.videoWidth&&video.videoHeight)setAspect(video.videoWidth/video.videoHeight);}}/>
          {cameraLive&&camera.analysis&&camera.steady&&<div className="camera-annotations" aria-label="Items in the last steady camera view">{recognized.map(object=><div className="camera-object" key={object.id} style={{left:`${object.box.x*100}%`,top:`${object.box.y*100}%`,width:`${object.box.width*100}%`,height:`${object.box.height*100}%`}}><span style={object.box.y<.12?{top:4,bottom:'auto'}:undefined}>{object.label}</span></div>)}</div>}
        </div>
        {!cameraLive&&!xrRunning&&<div className="camera-welcome"><div className="camera-aperture"><ScanLine size={45} strokeWidth={1}/><i/><i/></div><span className="live-kicker">YOUR WORLD, WITH A LITTLE CONTEXT</span><h1>What could fit here?</h1><p>Look through your camera.<br/>Give your next idea a little room.</p>
          <div className="camera-start-actions"><button className="live-primary" disabled={camera.status==='starting'||xrStarting} onClick={()=>void camera.start()}>{camera.status==='starting'||xrStarting?<LoaderCircle size={19} className="spin"/>:<Camera size={19}/>} {xrStarting?'Starting AR…':camera.status==='starting'?'Opening camera…':autoAnalyze?'Open camera & recognize':'Open camera'} <ArrowRight size={17}/></button>{xrSupported&&<button className="live-link" disabled={xrStarting} onClick={()=>void startAR()}>Measure a space in AR</button>}</div>
          <p className="camera-permission-note">{autoAnalyze?'Objects are recognized automatically. Steady frames go to your configured AI service.':'Camera preview stays on your device.'}</p>
        </div>}
        {cameraLive&&<>
          <div className="live-viewer-label"><span><i/> LIVE CAMERA</span><span>{camera.analysis?.live_request===false?'Test response':camera.analysis?`${recognized.length} items in last steady view`:autoAnalyze?'Automatic recognition':'Preview only'}</span></div>
          <div className="camera-reticle" aria-hidden="true"><i/><i/><i/><i/></div>
          {assessment.verdict!=='unknown'&&space&&<div className={`camera-fit-summary fit-${assessment.verdict}`}><span>{assessment.verdict==='fits'?<Check size={19}/>:<Maximize size={19}/>}</span><div><strong>{resultTitle}</strong><small>{label} · {meters(space.width)} × {meters(space.length)} space</small><small>Entered dimensions · {car?'parked footprint only':'obstacles not assessed'}</small></div></div>}
          <div className="live-camera-hint" role="status">{camera.analyzing?<><LoaderCircle size={15} className="spin"/>Finding the things in view…</>:!autoAnalyze?<><Eye size={16}/>Camera preview · recognition off</>:camera.error?<><VideoOff size={16}/>Recognition paused</>:!camera.steady?<><ScanLine size={16}/>Hold still to refresh the outlines</>:camera.analysis?<><Check size={16}/>Last steady view · outlines clear when you move</>:<><ScanLine size={16}/>Hold a clear view of the surface</>}</div>
        </>}
        {xrRunning&&<div className="xr-guidance"><span className="live-kicker">{xrState?.points===3?'SPACE MEASURED':xrState?.detectedSurface?'SURFACE MEASURED AUTOMATICALLY':`CORNER ${(xrState?.points??0)+1} OF 3`}</span><h2>{xrState?.points===3?'Your footprint, in your world.':xrState?.detectedSurface?`${meters(xrState.detectedSurface.width)} × ${meters(xrState.detectedSurface.length)}`:xrState?.points===0?'Scan slowly across the surface.':xrState?.points===1?'Mark the width of the space.':'Mark the far edge.'}</h2><p>{xrState?.message}</p>{xrState?.detectedSurface&&<><button className="live-primary" onClick={()=>controller.current?.useDetectedSurface()}><Check size={18}/>Use detected surface</button><p>Detected area may cover only part of the room. Check the outline.</p></>}{xrState?.points!==3&&<button className={xrState?.detectedSurface?'live-link':'live-primary'} disabled={!xrState?.canSelect} onClick={()=>controller.current?.selectPoint()}><Crosshair size={18}/>{xrState?.detectedSurface?'Mark corners instead':'Mark this corner'}</button>}{trackingLost&&<p role="status">The fit estimate is paused until tracking returns.</p>}</div>}
        <div className="live-viewer-tools">
          <span><ShieldCheck size={15}/>{xrRunning?'Device-tracked dimensions':cameraLive?'Camera preview':'Camera ready when you are'}</span>
          {cameraLive&&<button aria-label="Stop camera" onClick={camera.stop}><Pause size={17}/>Stop</button>}
          {xrRunning&&<><button onClick={()=>{controller.current?.reset();setMeasurement(null);setMeasuring(true);}}><RotateCcw size={16}/>Remeasure</button><button onClick={()=>void endAR()}><X size={16}/>End AR</button></>}
        </div>
      </section>

      <aside className="live-panel" aria-label="Space and fit controls">
        <button className="room-entry-link" onClick={()=>{camera.stop();void endAR();navigate('room');}}><Box size={19}/><span><strong>Furnish a whole room</strong><small>Bed, desk, table, closet — together in 3D & AR</small></span><ArrowRight size={17}/></button>
        <div className="live-panel-title"><div><span className="live-kicker">A LITTLE SPATIAL INTELLIGENCE</span><h2>Make room for…</h2></div><Box size={24} strokeWidth={1.3}/></div>
        <p className="live-panel-intro">The camera recognizes what is there. Try something you would like to add.</p>
        <div className="item-picker" role="group" aria-label="Try an item to add">{ITEM_PRESETS.map(value=><button key={value.id} aria-pressed={selected===value.id} onClick={()=>chooseItem(value)}>{value.label}</button>)}<button aria-pressed={selected==='custom'} onClick={()=>{setSelected('custom');setLabel('My item');setActualSize(false);}}>Custom</button></div>
        <div className="item-size-header"><label>{selected==='custom'?<input aria-label="Item name" value={label} maxLength={60} onChange={e=>setLabel(e.target.value)}/>:<strong>{label}</strong>}<span>{actualSize?'Your dimensions':'Editable example dimensions'}</span></label><select aria-label="Measurement unit" value={unit} onChange={e=>changeUnit(e.target.value as Unit)}><option value="cm">cm</option><option value="m">m</option></select></div>
        <DimensionInputs value={itemFields} onChange={value=>{setItemFields(value);setActualSize(false);}} unit={unit} prefix="Item"/>
        <label className="live-check"><input type="checkbox" checked={actualSize} onChange={e=>setActualSize(e.target.checked)}/>These are my item’s actual dimensions{car?', including mirrors.':'.'}</label>
        <div className="clearance-control"><label htmlFor="fit-margin">Extra room on each side <span>{car?'Allow for access around the parked vehicle.':'Leave a little breathing room.'}</span></label><div><input id="fit-margin" aria-label="Clearance per side" type="number" min="0" step="any" value={margin} onChange={e=>setMargin(e.target.value)}/><span>{unit}</span></div></div>

        <section className="space-measurement"><div className="live-section-title"><span><Ruler size={17}/>The space you have</span><span className="measurement-source">{source==='ar'?'AR measurement':source==='manual'?'Entered dimensions':'Not measured yet'}</span></div>
          {measurement&&source==='ar'&&<div className="space-readout"><strong>{meters(measurement.width)} <span>×</span> {meters(measurement.length)}</strong><span>{trackingLost?'Tracking lost · estimate paused':'Device-tracked rectangle · horizontal surface'}</span></div>}
          {(source==='manual'||measuring&&!xrRunning)&&<DimensionInputs value={spaceFields} onChange={value=>{setSpaceFields(value);setSource('manual');}} unit={unit} prefix="Space"/>}
          {!xrRunning&&<div className="measurement-actions">{xrSupported&&<button className="live-secondary" disabled={xrStarting} onClick={()=>void startAR()}><Maximize size={16}/>Measure in AR</button>}<button className="live-link" onClick={useManual}><Ruler size={15}/>{source==='manual'?'Edit measurements':'Enter measurements'}</button></div>}
          {!source&&<p className="live-small">{xrSupported?'Mark three corners of a clear rectangular area.':'This browser does not offer tracked spatial AR. Measure width and length with a tape, then enter them here.'}</p>}
        </section>

        <section className={`fit-result fit-${assessment.verdict}`} aria-label="Fit assessment" aria-live="polite"><div><span className="fit-status-icon">{assessment.verdict==='fits'?<Check size={20}/>:assessment.verdict==='unknown'?<Ruler size={20}/>:<Maximize size={20}/>}</span><div><span className="live-kicker">{assessment.verdict==='unknown'?'WAITING FOR DIMENSIONS':'DIMENSION COMPARISON'}</span><h3>{trackingLost?'Tracking paused':resultTitle}</h3></div></div><p>{trackingLost?'Look back at the measured area to recover tracking.':assessment.verdict==='unknown'?'Add the space dimensions to compare this item and your chosen clearance.':assessment.reason}</p>
          {assessment.verdict!=='unknown'&&<><div className="fit-numbers"><span>Width remaining<strong>{meters(assessment.remainingWidth??0)}</strong></span><span>Length remaining<strong>{meters(assessment.remainingLength??0)}</strong></span></div><p className="fit-caveat">{car?'Parked footprint only. Check doors, mirrors, obstacles and the turning path yourself. Never use while driving.':`${assessment.heightChecked?'Height compared.':'Height not checked. '}Check obstacles, access and the surface before placing anything.`}</p></>}
        </section>
        {space&&assessment.verdict!=='unknown'&&<FootprintPlan space={space} item={item} rotation={assessment.rotation} clearance={clearance}/>}
        {!!candidates.length&&<details className="fit-suggestions" open><summary>What else fits this footprint? <ChevronDown size={16}/></summary><p className="live-small">Individual examples using the same clearance. Check actual product dimensions.</p>{candidates.map(({item:value})=><button key={value.id} onClick={()=>chooseItem(value)}><span>{value.label}<small>{meters(value.width)} × {meters(value.length)}</small></span><ArrowRight size={16}/></button>)}</details>}

        {!xrRunning&&<section className="recognition-settings"><label><span><ScanLine size={16}/>Automatic item recognition</span><input type="checkbox" role="switch" aria-label="Automatic item recognition" checked={autoAnalyze} onChange={e=>setAutoAnalyze(e.target.checked)}/></label><p>When on, occasional steady camera frames go to your configured AI service. Recognition identifies items; it does not measure free space.</p>{camera.analysis&&<p className="recognition-evidence">{camera.analysis.live_request===false?'Test response · ':''}{camera.analysis.model} · {recognized.length} item suggestions</p>}</section>}
        {(camera.error||xrError)&&<div className="live-error" role="alert"><p>{xrError||camera.error}</p><button onClick={()=>{setXrError('');if(cameraLive)camera.retry();else void camera.start();}}>Retry camera {cameraLive?'recognition':''}</button></div>}
        {!xrRunning&&<button className="saved-photo-link" onClick={()=>{camera.stop();navigate('inspect');}}>Compare with a saved setup <ArrowRight size={15}/></button>}
      </aside>
    </div>
  </div>;
}
