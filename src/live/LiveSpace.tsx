import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Box, Camera, Check, ChevronDown, Crosshair, Eye, LoaderCircle, Maximize, MessageCircle, Pause, RotateCcw, Ruler, ScanLine, ShieldCheck, VideoOff, X } from 'lucide-react';
import { navigate, useRoute } from '../navigation';
import { assessFit, ITEM_PRESETS, suggestFits } from './fit';
import type { ItemDimensions, SpaceDimensions } from './fit';
import { isWorldARSupported, startWorldAR } from './xr';
import type { WorldARController, WorldARMeasurement, WorldARState } from './xr';
import { useLiveCamera } from './useLiveCamera';
import SceneUnderstanding from './SceneUnderstanding';
import AskScene from './AskScene';
import SceneMemoryPanel from './SceneMemoryPanel';
import { useDeviceWorkspace, openPrivateWorkspace } from '../device/context';
import { readPhoto, saveDeviceSpace } from '../device/store';
import type { AIAnalysis, SceneImage } from '../types';
import sample from '../../docs/v18-live-recognition.json';
import './interactive.css';
import './live.css';
import './continuous.css';
import './memory.css';
import './consumer-live.css';

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
  const device=useDeviceWorkspace();
  const route=useRoute(),demoOpened=useRef(false);
  const [held,setHeld]=useState<{frame:SceneImage;analysis:AIAnalysis;sample?:boolean}|null>(null);
  const [showLabels,setShowLabels]=useState(true),[saveMessage,setSaveMessage]=useState(''),[saving,setSaving]=useState(false),[savedView,setSavedView]=useState('');
  const saveLock=useRef(false);
  const videoRef=useRef<HTMLVideoElement>(null),canvasRef=useRef<HTMLCanvasElement>(null),overlayRef=useRef<HTMLDivElement>(null),viewerRef=useRef<HTMLElement>(null);
  const controller=useRef<WorldARController|null>(null),xrAbort=useRef<AbortController|null>(null),epoch=useRef(0),activeRef=useRef(active);
  activeRef.current=active;
  const [autoAnalyze,setAutoAnalyze]=useState(true),[xrSupported,setXrSupported]=useState<boolean|null>(null),[xrRunning,setXrRunning]=useState(false),[xrStarting,setXrStarting]=useState(false);
  const [xrState,setXrState]=useState<WorldARState|null>(null),[measurement,setMeasurement]=useState<WorldARMeasurement|null>(null),[xrError,setXrError]=useState('');
  const [recognitionMode,setRecognitionMode]=useState<'live'|'detailed'>('live'),[focused,setFocused]=useState(false);
  const [panel,setPanel]=useState<'scene'|'memory'|'ask'|'fit'>('scene');
  const [findingId,setFindingId]=useState<string|null>(null);
  const [sceneDetails,setSceneDetails]=useState(false);
  const camera=useLiveCamera({active:active&&!xrRunning&&!xrStarting,autoAnalyze,videoRef,mode:recognitionMode,pauseRecognition:panel==='ask'||!!held,findingId});
  const [unit,setUnit]=useState<Unit>('cm'),[selected,setSelected]=useState(ITEM_PRESETS[0].id),[label,setLabel]=useState(ITEM_PRESETS[0].label);
  const [itemFields,setItemFields]=useState<Fields>(()=>fields(ITEM_PRESETS[0],'cm')),[spaceFields,setSpaceFields]=useState<Fields>({width:'',length:'',height:''}),[margin,setMargin]=useState('5');
  const [source,setSource]=useState<'ar'|'manual'|null>(null),[actualSize,setActualSize]=useState(false),[measuring,setMeasuring]=useState(false),[aspect,setAspect]=useState(4/3);
  const [selectedObject,setSelectedObject]=useState<string|null>(null);
  const [cameraWidth,setCameraWidth]=useState<number>();
  const item:ItemDimensions={id:selected,label,...dimensions(itemFields,unit)};
  const clearance=number(margin,unit);
  const trackingLost=xrRunning&&xrState?.phase==='tracking-lost';
  const space:SpaceDimensions|null=source==='ar'?(active&&xrRunning&&xrState?.phase==='ready'&&measurement?{width:measurement.width,length:measurement.length}:null):source==='manual'?dimensions(spaceFields,unit):null;
  const assessment=assessFit(space,item,clearance);
  const candidates=useMemo(()=>suggestFits(space,ITEM_PRESETS,clearance),[space?.width,space?.length,space?.height,clearance]);
  const memory=camera.memory??{places:[],items:[],location:null,full:false};
  const remembered=recognitionMode==='live'&&!camera.trackedObjects?.length&&!!memory.location;
  const currentObjects=recognitionMode==='live'?(camera.trackedObjects?.length?camera.trackedObjects:memory.location?.objects??[]):camera.analysis?.objects??[];
  const rememberedTarget=recognitionMode==='live'&&memory.location?.target?.id===findingId&&!currentObjects.some(object=>object.id===findingId)?memory.location.target:null;
  const recognized=held?.analysis.objects??(rememberedTarget?[...currentObjects,rememberedTarget]:currentObjects);
  const matchedPlace=memory.places.find(place=>place.id===memory.location?.placeId);
  const finding=memory.items.find(item=>item.object.id===findingId);
  const findingPlace=memory.places.find(place=>place.id===finding?.placeId);
  const overlayDetails=held?.analysis.details??(remembered?matchedPlace?.details:camera.analysis?.details);
  const fastLive=recognitionMode==='live';
  const displayedAnalysis=held?.analysis??camera.analysis??camera.lastScan?.analysis??null;
  const localReady=fastLive&&camera.localStatus==='ready';
  const testResponse=camera.analysis?.provider!=='on_device'&&camera.analysis?.live_request===false&&!camera.analysis.concept_discovery?.live_request;
  const cameraLive=camera.status==='live'||!!held;
  useEffect(()=>{if(cameraLive)setPanel('scene');},[cameraLive]);
  const car=/car|vehicle/i.test(`${selected} ${label}`);
  useEffect(()=>setSelectedObject(id=>displayedAnalysis?.objects.some(object=>object.id===id)?id:null),[displayedAnalysis]);
  useEffect(()=>{
    const viewer=viewerRef.current;if(!viewer)return;
    const measure=()=>{if(viewer.clientWidth&&viewer.clientHeight)setCameraWidth(Math.min(viewer.clientWidth,Math.max(1,viewer.clientHeight-(device?136:62))*aspect));};
    measure();
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);
    observer?.observe(viewer);window.addEventListener('resize',measure);
    return()=>{observer?.disconnect();window.removeEventListener('resize',measure);};
  },[aspect,cameraLive,device]);

  useEffect(()=>{let mounted=true;void isWorldARSupported().then(value=>{if(mounted)setXrSupported(value);}).catch(()=>{if(mounted)setXrSupported(false);});return()=>{mounted=false;};},[]);
  useEffect(()=>{
    if(!active){setHeld(null);epoch.current++;xrAbort.current?.abort();void controller.current?.end();controller.current=null;setXrRunning(false);setXrStarting(false);setMeasurement(null);setSource(old=>old==='ar'?null:old);}
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
    setHeld(null);
    if(!canvasRef.current||!overlayRef.current||xrStarting||xrRunning)return;
    const request=++epoch.current;xrAbort.current?.abort();xrAbort.current=new AbortController();camera.stop();setXrError('');setXrStarting(true);setMeasurement(null);setSource('ar');
    try{
      const value=await startWorldAR({canvas:canvasRef.current,overlay:overlayRef.current,signal:xrAbort.current.signal,onState:state=>{if(request!==epoch.current)return;setXrState(state);if(state.phase==='ended'){epoch.current++;controller.current=null;setXrRunning(false);setXrStarting(false);setMeasurement(null);setSource(old=>old==='ar'?null:old);}},onMeasurement:value=>{if(request===epoch.current){setMeasurement(value);if(value)setMeasuring(false);}}});
      if(request!==epoch.current||!activeRef.current){await value.end();return;}
      controller.current=value;setXrRunning(true);setXrStarting(false);setMeasuring(true);
    }catch(error){if(request!==epoch.current)return;setXrStarting(false);setXrRunning(false);setSource(null);setXrError(error instanceof Error?error.message:'Spatial AR could not start. You can still use your camera and enter measurements.');}
  }
  async function endAR(){epoch.current++;xrAbort.current?.abort();const old=controller.current;controller.current=null;setXrRunning(false);setXrStarting(false);setMeasurement(null);if(source==='ar')setSource(null);await old?.end();}
  function leave(){camera.stop();void endAR();navigate('home');}
  function chooseItem(value:ItemDimensions){setSelected(value.id);setLabel(value.label);const nextUnit=/car|vehicle/i.test(value.id)?'m':unit;changeUnit(nextUnit);setItemFields(fields(value,nextUnit));setMargin(display(/car|vehicle/i.test(value.id)?.3:.05,nextUnit));setActualSize(false);}
  function changeUnit(next:Unit){if(next===unit)return;const convert=(value:Fields):Fields=>Object.fromEntries(Object.entries(value).map(([key,val])=>[key,val.trim()&&Number.isFinite(Number(val))?display(Number(val)*factor(unit),next):val])) as Fields;setItemFields(convert);setSpaceFields(convert);if(margin.trim()&&Number.isFinite(Number(margin)))setMargin(display(Number(margin)*factor(unit),next));setUnit(next);}
  function useManual(){void endAR();setSource('manual');setMeasuring(true);}
  function captureView() {
    if(held)return held;
    const video=videoRef.current;
    if(!video?.videoWidth||!video.videoHeight){setSaveMessage('The camera is still opening. Try again when the preview appears.');return null;}
    const canvas=document.createElement('canvas'),scale=Math.min(1,1280/video.videoWidth);
    canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
    const context=canvas.getContext('2d');if(!context){setSaveMessage('This browser could not capture the view.');return null;}
    context.drawImage(video,0,0,canvas.width,canvas.height);
    const frame={image_url:canvas.toDataURL('image/jpeg',.9),width:canvas.width,height:canvas.height,name:'Camera capture'};
    const analysis:AIAnalysis={...(displayedAnalysis??{concepts:[],summary:'Camera capture',message:'',warnings:[],provider:'on_device',model:'EfficientDet Lite0',live_request:false}),objects:recognized.map(object=>({...object,box:{...object.box}}))};
    return {frame,analysis};
  }
  function holdView(){if(held){setHeld(null);setSaveMessage('');setSavedView('');setPanel('scene');return;}const view=captureView();if(view){setHeld(view);setSaveMessage('');}}
  function exploreObject(id:string){setSelectedObject(id);setShowLabels(true);setPanel('scene');if(!held&&videoRef.current?.videoWidth){const view=captureView();if(view)setHeld(view);}}
  function trySample(){
    camera.stop();setAspect(1600/1067);setPanel('scene');setShowLabels(true);setSavedView('');setSaveMessage('');
    setHeld({sample:true,frame:{image_url:'/desk-preview.webp',width:1600,height:1067,name:'Recorded desk example'},analysis:{objects:sample.objects.map(o=>({id:o.id,label:o.label,box:o.box,confidence:o.confidence,locked:false})),summary:sample.summary,concepts:[],message:'Recorded example, not a live camera scan.',warnings:[],provider:'recorded_sample',model:'Recorded SAM 3.1',live_request:false}});
  }
  useEffect(()=>{
    if(!active){demoOpened.current=false;return;}
    if(route.params.get('demo')==='1'&&!demoOpened.current){demoOpened.current=true;trySample();}
  },[active,route.key]);
  async function saveView(){
    if(saveLock.current)return;
    const view=captureView();if(!view)return;
    saveLock.current=true;setSaving(true);setSaveMessage('');setHeld(view);
    try{
      let photo=view.frame.image_url;
      if(view.sample){const response=await fetch('/desk-preview.webp');if(!response.ok)throw new Error('The example photo could not be saved. Try again.');photo=await readPhoto(new File([await response.blob()],'sample.webp',{type:'image/webp'}));}
      const id=crypto.randomUUID(),selected=view.analysis.objects.find(o=>o.id===selectedObject);
      await saveDeviceSpace({id,name:view.sample?'Example desk':selected?`${selected.label} · saved view`:'My camera view',photo,after:'',notes:`${view.sample?'Recorded example':'Camera snapshot'}. Suggested labels: ${[...new Set(view.analysis.objects.map(o=>o.label))].join(', ')||'none'}. Labels may need correction.`,steps:[],updatedAt:new Date().toISOString()});
      setSavedView(id);setSaveMessage('Saved on this device in My Spaces.');
    }catch(reason){setSaveMessage(reason instanceof Error?reason.message:'This view could not be saved.');}
    finally{saveLock.current=false;setSaving(false);}
  }
  function fitSelected(){const object=recognized.find(o=>o.id===selectedObject);const preset=object&&ITEM_PRESETS.find(p=>p.label.toLowerCase().includes(object.label.toLowerCase()));if(preset)chooseItem(preset);else if(object){setSelected('custom');setLabel(object.label);setItemFields({width:'',length:'',height:''});setActualSize(false);}setPanel('fit');useManual();}
  const resultTitle=assessment.verdict==='unknown'?'Measure first. Then know.':assessment.verdict==='fits'?(actualSize?'Footprint fits':'Example footprint fits'):assessment.verdict==='too-tight'?'Fits without your margin':'Needs more room';
  const statusText=held?(held.sample?'Recorded example':'View held'):xrStarting?'Starting spatial AR':xrRunning?(trackingLost?'Tracking paused':'Spatial AR'):cameraLive?(fastLive?(camera.analyzing?'AI updating':recognized.length?`${recognized.length} labels tracking`:autoAnalyze?'Looking around':'Preview only'):camera.analyzing?'Recognizing this view':camera.recognitionStatus==='retrying'?'Retrying recognition':!autoAnalyze?'Preview only':camera.analysis?`${recognized.length} items located`:camera.steady?'Camera steady':'Move, then hold still'):'Camera is off';

  return <div ref={overlayRef} className={`live-app ${device?'consumer-live':''} ${xrRunning?'is-xr':''} ${cameraLive?'camera-active':''} ${focused&&cameraLive?'is-focused':''} ${fastLive?'is-continuous':''} ${xrState?.points===3?'xr-measured':''}`}>
    <header className="live-header"><button className="live-back" onClick={leave} aria-label="Back to home"><ArrowLeft size={18}/></button><div className="live-wordmark"><ScanLine size={22}/><strong>world<span>os</span></strong><span className="live-header-divider"/><span>LIVE SPACE</span></div><span className="live-session-status"><i className={cameraLive||xrRunning?'on':''}/>{statusText}</span><button className="live-close" onClick={leave} aria-label="Close live space"><X size={19}/></button></header>
    <div className="live-layout">
      <section ref={viewerRef} className="live-viewer" aria-label="Live camera and spatial view">
        <canvas ref={canvasRef} className="xr-canvas" aria-label="World-anchored AR outlines"/>
        <div className="live-video-wrap" style={{aspectRatio:aspect,maxWidth:cameraWidth}}>
          {held&&<img className="live-held-image" src={held.frame.image_url} alt={held.sample?'Recorded desk example':'Held camera view'}/>}
          <video hidden={!!held} ref={videoRef} autoPlay playsInline muted aria-label="Live camera preview" onLoadedMetadata={e=>{const video=e.currentTarget;if(video.videoWidth&&video.videoHeight)setAspect(video.videoWidth/video.videoHeight);}}/>
          {cameraLive&&showLabels&&(held||camera.analysis||memory.location)&&(fastLive||camera.steady)&&<div className="camera-annotations" aria-label={fastLive?'Items tracked in the camera view':'Items in the last steady camera view'}>{[...recognized].sort((a,b)=>b.box.width*b.box.height-a.box.width*a.box.height).map((object,index)=>{
            const wasRemembered=remembered||rememberedTarget?.id===object.id;
            const detail=rememberedTarget?.id===object.id?finding?.detail:overlayDetails?.[object.id];
            return <button type="button" aria-label={`Highlight ${object.label} in camera`} aria-pressed={selectedObject===object.id} onClick={()=>{exploreObject(object.id);if(wasRemembered){setFindingId(object.id);setPanel('memory');}}} className={`camera-object ${wasRemembered?'is-remembered':''} ${findingId===object.id?'is-finding':''} ${selectedObject===object.id?'is-selected':''}`} key={object.id} style={{left:`${object.box.x*100}%`,top:`${object.box.y*100}%`,width:`${object.box.width*100}%`,height:`${object.box.height*100}%`}}><span style={{...(object.box.y<.12?{top:4,bottom:'auto'}:{}),...(object.box.x+object.box.width>.8?{left:'auto',right:0}:{})}}>{!device&&`${index+1} · `}{object.label}{wasRemembered&&<small>Remembered spot</small>}{fastLive&&selectedObject===object.id&&detail&&<small>{detail}</small>}</span></button>;
          })}</div>}
        </div>
        {!cameraLive&&!xrRunning&&<div className="camera-welcome"><div className="camera-aperture"><Camera size={40} strokeWidth={1.5}/></div><h1>{device?'Identify objects':<>Your space.<br/>A new perspective.</>}</h1><p>{device?<>Point the camera at your space.<br className="live-desktop-break"/> Select a label to inspect or save the view.</>:<>Look around. Let your space come to life.<br/>Live labels. Details where you need them.</>}</p>
          <div className="camera-start-actions"><button className="live-primary" disabled={camera.status==='starting'||xrStarting} onClick={()=>void camera.start()}>{camera.status==='starting'||xrStarting?<LoaderCircle size={19} className="spin"/>:<Camera size={19}/>} {xrStarting?'Starting AR…':camera.status==='starting'?'Opening camera…':autoAnalyze?'Open camera & recognize':'Open camera'} <ArrowRight size={17}/></button><button className="live-link" onClick={trySample}>Try an interactive example</button>{xrSupported&&<button className="live-link" disabled={xrStarting} onClick={()=>void startAR()}>Measure a space in AR</button>}</div>
          <p className="camera-permission-note">{device?'You choose when the camera opens. Recognition and saved views stay on this device.':autoAnalyze?fastLive?'Common objects are recognized on your device. Your AI service adds details in the background.':'Objects are recognized automatically. Steady frames go to your configured AI service.':'Camera preview stays on your device.'}</p>
        </div>}
        {cameraLive&&<>
          <div className="live-viewer-label"><span><i/> {held?.sample?'RECORDED EXAMPLE':held?'HELD VIEW':'LIVE CAMERA'}</span><span>{held?.sample?'Try tapping a label':device?(localReady?'Private · on this device':camera.localStatus==='loading'?'Preparing recognition…':!autoAnalyze?'Preview only':'Your camera view'):testResponse?'Test response':localReady?`On device${camera.localLatencyMs!=null?`: ${Math.round(camera.localLatencyMs)} ms`:''}`:!autoAnalyze?'Preview only':fastLive?`${recognized.length} live labels`:camera.analysis?`${recognized.length} items in last steady view`:'Automatic recognition'}</span></div>
          {!device&&!held&&fastLive&&autoAnalyze&&!localReady&&<div className="live-performance" aria-label="Recognition timing"><span><i className={camera.analyzing?'is-updating':''}/>{panel==='ask'?'View held for your question':localReady?'On-device recognition':camera.localStatus==='loading'?'Preparing fast labels':camera.error?'AI paused':camera.analyzing?'AI updating':'Connecting to AI'}</span>{localReady&&<span>{camera.localLatencyMs!=null?`Labels ${Math.round(camera.localLatencyMs)} ms`:'Ready for camera frames'}</span>}<span>{camera.analyzing?'AI details updating':camera.error?'AI details paused':camera.latencyMs!=null?`AI details ${(camera.latencyMs/1000).toFixed(1)}s`:'AI details connecting'}</span>{camera.resultAgeMs!=null&&<span>Captured {Math.floor(camera.resultAgeMs/1000)}s ago</span>}</div>}
          {finding&&<div className="memory-find-hint" role="status"><img src={finding.frame.image_url} alt="Last seen view"/><div><strong>{finding.object.label} · {findingPlace?.name}</strong><small>{camera.trackedObjects?.some(object=>object.id===findingId)?'Seen in this view':memory.location?.placeId===finding.placeId?'View recognized. Check the remembered spot.':'Look back toward this view to recover its last known spot.'}</small></div><button aria-label="Stop finding item" onClick={()=>setFindingId(null)}><X size={15}/></button></div>}
          <div className="camera-reticle" aria-hidden="true"><i/><i/><i/><i/></div>
          {assessment.verdict!=='unknown'&&space&&<div className={`camera-fit-summary fit-${assessment.verdict}`}><span>{assessment.verdict==='fits'?<Check size={19}/>:<Maximize size={19}/>}</span><div><strong>{resultTitle}</strong><small>{label} · {meters(space.width)} × {meters(space.length)} space</small><small>Entered dimensions · {car?'parked footprint only':'obstacles not assessed'}</small></div></div>}
          <div className="live-camera-hint" role="status">{device&&!held&&camera.localStatus==='unavailable'?<><Eye size={16}/>Camera ready. Hold or save a view, or try the example.</>:device&&!held&&camera.localStatus==='loading'?<><LoaderCircle size={16} className="spin"/>Getting recognition ready. You can already hold or save a view.</>:device&&!held&&autoAnalyze&&!recognized.length?<><ScanLine size={16}/>Point at a few objects in good light. Labels appear as you look around.</>:held?<><Crosshair size={16}/>{held.sample?'Select an object or save this view.':'View paused. Select an object to inspect it.'}</>:fastLive&&autoAnalyze&&(!camera.error||localReady)?<><ScanLine size={16}/>{remembered?`${matchedPlace?.name} recognized · remembered spots`:recognized.length?'Labels follow your view · tap for details':camera.analyzing?'Looking for objects in your view…':'Refreshing labels · move slowly'}</>:camera.analyzing?<><LoaderCircle size={15} className="spin"/>Finding the things in view…</>:!autoAnalyze?<><Eye size={16}/>Camera preview · recognition off</>:camera.recognitionStatus==='retrying'?<><LoaderCircle size={15} className="spin"/>Trying again in {camera.retryInSeconds}s</>:camera.error?<><VideoOff size={16}/>Recognition needs attention</>:!camera.steady?<><ScanLine size={16}/>Hold still to refresh the outlines</>:camera.analysis?<><Check size={16}/>{recognized.length?`${recognized.length} items located · tap an outline`:'No items located · try a closer view'}</>:<><ScanLine size={16}/>Hold a clear view of your space</>}</div>
        </>}
        {xrRunning&&<div className="xr-guidance"><span className="live-kicker">{xrState?.points===3?'SPACE MEASURED':xrState?.detectedSurface?'SURFACE MEASURED AUTOMATICALLY':`CORNER ${(xrState?.points??0)+1} OF 3`}</span><h2>{xrState?.points===3?'Your footprint, in your world.':xrState?.detectedSurface?`${meters(xrState.detectedSurface.width)} × ${meters(xrState.detectedSurface.length)}`:xrState?.points===0?'Scan slowly across the surface.':xrState?.points===1?'Mark the width of the space.':'Mark the far edge.'}</h2><p>{xrState?.message}</p>{xrState?.detectedSurface&&<><button className="live-primary" onClick={()=>controller.current?.useDetectedSurface()}><Check size={18}/>Use detected surface</button><p>Detected area may cover only part of the room. Check the outline.</p></>}{xrState?.points!==3&&<button className={xrState?.detectedSurface?'live-link':'live-primary'} disabled={!xrState?.canSelect} onClick={()=>controller.current?.selectPoint()}><Crosshair size={18}/>{xrState?.detectedSurface?'Mark corners instead':'Mark this corner'}</button>}{trackingLost&&<p role="status">The fit estimate is paused until tracking returns.</p>}</div>}
        <div className={`live-viewer-tools ${device&&cameraLive?'live-action-dock':''}`}>
          {device&&cameraLive&&!xrRunning?<>
            <div className="live-camera-actions" role="group" aria-label="Camera actions"><button aria-pressed={!!held} onClick={holdView}><Pause size={17}/><span>{held?(held.sample?'Close example':'Resume live'):'Hold view'}</span></button><button aria-pressed={showLabels} onClick={()=>setShowLabels(!showLabels)}><Eye size={17}/><span>{showLabels?'Hide labels':'Show labels'}</span></button><button className="live-save-action" disabled={saving||!!savedView} onClick={()=>void saveView()}><Camera size={17}/><span>{saving?'Saving…':savedView?'View saved':'Save view'}</span></button></div>
            <div className="live-camera-utilities"><span><ShieldCheck size={14}/>{held?.sample?'Example photo':held?'Captured view':'Your view stays on this device.'}</span><button aria-label={focused?'Show controls':'Expand camera view'} aria-pressed={focused} onClick={()=>setFocused(!focused)}><Maximize size={16}/></button><button aria-label="Stop camera" onClick={()=>{camera.stop();setHeld(null);setSavedView('');setSaveMessage('');}}><X size={16}/></button></div>
          </>:<>
          <span><ShieldCheck size={15}/>{xrRunning?'Device-tracked dimensions':held?.sample?'Recorded example':held?'View held':cameraLive?'Camera preview':'Camera is off'}</span>
          {cameraLive&&<button aria-label={focused?'Show controls':'Expand camera view'} aria-pressed={focused} onClick={()=>setFocused(!focused)}><Maximize size={17}/>{focused?'Controls':'Expand'}</button>}
          {cameraLive&&<button aria-label="Stop camera" onClick={()=>{camera.stop();setHeld(null);setSavedView('');setSaveMessage('');}}><Pause size={17}/>Stop</button>}
          {xrRunning&&<><button onClick={()=>{controller.current?.reset();setMeasurement(null);setMeasuring(true);}}><RotateCcw size={16}/>Remeasure</button><button onClick={()=>void endAR()}><X size={16}/>End AR</button></>}
          </>}
        </div>
      </section>

      <aside className="live-panel" aria-label="Space and fit controls">
        {device&&!cameraLive&&!xrRunning&&<section className="live-ready-card" aria-label="A few things to try"><span className="live-kicker">A GOOD PLACE TO START</span><h2>Camera tools</h2><ol><li><span>1</span><div><strong>Object recognition</strong><p>Open the camera and point at everyday things.</p></div></li><li><span>2</span><div><strong>Inspect a selection</strong><p>Hold a view, explore a label, or compare real measurements.</p></div></li><li><span>3</span><div><strong>Saved views</strong><p>Save a snapshot in My Spaces and add your own notes later.</p></div></li></ol><button className="live-ready-room" onClick={()=>navigate('room')}><Box size={19}/><span><strong>Room planner</strong><small>Find furniture that fits your measured space.</small></span><ArrowRight size={18}/></button><button className="live-link" onClick={()=>setPanel('fit')}><Ruler size={16}/>Compare item measurements</button></section>}

        {cameraLive&&!xrRunning&&<section className="live-interaction" aria-label="Explore this view">
          <div className="live-interaction-heading"><span className="live-kicker">{held?'Captured view':'Detected objects'}</span><span>{recognized.length} labels</span></div>
          <div className="live-object-rail" role="group" aria-label="Quick object selection">{recognized.map(object=><button key={object.id} aria-pressed={selectedObject===object.id} onClick={()=>exploreObject(object.id)}>{object.label}</button>)}</div>
          {selectedObject&&recognized.some(o=>o.id===selectedObject)&&<div className="live-object-focus"><Crosshair size={21}/><div><strong>{recognized.find(o=>o.id===selectedObject)?.label}</strong><small>{held?'Selected in captured view':'Selected in camera'}</small></div><button aria-label="Clear selected object" onClick={()=>setSelectedObject(null)}><X size={16}/></button></div>}
          <div className="live-explore-actions">{!device&&<><button aria-pressed={!!held} onClick={holdView}><Pause size={16}/>{held?(held.sample?'Close example':'Resume live'):'Hold view'}</button><button aria-pressed={showLabels} onClick={()=>setShowLabels(!showLabels)}><Eye size={16}/>{showLabels?'Hide labels':'Show labels'}</button></>}<button onClick={fitSelected}><Ruler size={16}/>Check fit</button>{device&&<button onClick={()=>{camera.stop();navigate('room');}}><Box size={16}/>Plan this room</button>}</div>
          {saveMessage&&<p role="status">{saveMessage}</p>}{savedView&&<button className="live-link" onClick={()=>{camera.stop();navigate('mission',{device:savedView});}}>Open saved view<ArrowRight size={16}/></button>}
          {device&&['unavailable','error'].includes(camera.localStatus)&&!held&&<p role="status">Live labels are unavailable in this browser. You can still hold and save photos, enter measurements, or try the interactive example.</p>}
        </section>}

        {!xrRunning&&!device&&<div className="live-mode-picker" role="group" aria-label="Recognition mode"><button aria-pressed={fastLive} onClick={()=>setRecognitionMode('live')}>Live <small>Fast device labels</small></button><button aria-pressed={!fastLive} onClick={()=>setRecognitionMode('detailed')}>Detailed <small>Steady SAM scan</small></button></div>}
        {!xrRunning&&fastLive&&!device&&<button className="memory-entry" onClick={()=>setPanel('memory')}><Eye size={17}/><span>{memory.places.length?`${memory.places.length} views remembered`:'Remember as you look around'}<small>Find items and get help with an area</small></span><ArrowRight size={15}/></button>}
        {cameraLive&&!xrRunning&&<nav className="live-panel-tabs" aria-label="Work with your space">{([{id:'scene',label:'See',Icon:ScanLine},{id:'memory',label:'Memory',Icon:Eye},{id:'ask',label:'Ask',Icon:MessageCircle},{id:'fit',label:'Fit',Icon:Ruler}] as const).map(({id,label,Icon})=><button key={id} aria-pressed={panel===id} onClick={()=>setPanel(id)}><Icon size={15}/>{device?({scene:'Objects',memory:'Places',ask:'Actions',fit:'Measure'} as const)[id]:label}{id==='scene'&&displayedAnalysis&&<span>{displayedAnalysis.objects.length}</span>}</button>)}</nav>}
        {(camera.error||xrError)&&<div className="live-error" role="alert"><p>{xrError||(localReady?`On-device labels are running. ${camera.error.replace(/^Recognition is/, 'AI details are').replace(/^Recognition/, 'AI details')}`:camera.error)}</p><button disabled={camera.analyzing||xrStarting} onClick={()=>{if(xrError){void startAR();}else if(cameraLive){camera.retry();}else{void camera.start();}}}>{xrError?'Retry spatial AR':cameraLive?'Retry recognition now':'Retry camera'}</button></div>}
        {!xrRunning&&<div hidden={panel!=='memory'}><SceneMemoryPanel memory={memory} findingId={findingId} onFind={id=>{setFindingId(id);setSelectedObject(id);}} onRename={camera.renamePlace} onClear={camera.forgetMemory} onLeave={camera.stop} active={active}/></div>}
        {cameraLive&&!xrRunning&&<div className="live-scene-panel" hidden={panel!=='scene'}>{device?<><div className="live-scene-next"><span className="live-kicker">{held?.sample?'TRY THE EXAMPLE':'YOUR NEXT SMALL STEP'}</span><h2>{selectedObject?'Selected object':held?'Captured view':recognized.length?'Detected objects':'Camera preview'}</h2><p>{held?.sample?'Recorded desk scan. Select an object, check its dimensions, or save a copy.':selectedObject?'Save this view with your own notes, or use real measurements to check whether an item fits.':recognized.length?'Tap an outline or an item above to pause this view and take a closer look.':'You can save a snapshot even when an item has no label. For more labels, move closer and find a well-lit view.'}</p></div><details className="live-analysis-details" open={sceneDetails} onToggle={event=>setSceneDetails(event.currentTarget.open)}><summary>View details & recognition notes</summary>{sceneDetails&&<SceneUnderstanding continuous={fastLive} analysis={displayedAnalysis} snapshot={fastLive?(!recognized.length||(selectedObject&&!recognized.some(object=>object.id===selectedObject))?camera.analysisFrame??camera.lastScan?.frame:null):!camera.analysis?camera.lastScan?.frame:null} status={camera.analyzing?'analyzing':localReady&&displayedAnalysis?.provider==='on_device'?'ready':camera.recognitionStatus} retryInSeconds={camera.retryInSeconds} selectedId={selectedObject} onSelect={exploreObject} onRefresh={()=>{setHeld(null);camera.retry();}}/>}</details></>:<SceneUnderstanding continuous={fastLive} analysis={displayedAnalysis} snapshot={fastLive?(!recognized.length||(selectedObject&&!recognized.some(object=>object.id===selectedObject))?camera.analysisFrame??camera.lastScan?.frame:null):!camera.analysis?camera.lastScan?.frame:null} status={camera.analyzing?'analyzing':localReady&&displayedAnalysis?.provider==='on_device'?'ready':camera.recognitionStatus} retryInSeconds={camera.retryInSeconds} selectedId={selectedObject} onSelect={exploreObject} onRefresh={()=>{setHeld(null);camera.retry();}}/>}{!device&&displayedAnalysis&&<button className="scene-ask-entry" onClick={()=>setPanel('ask')}><MessageCircle size={18}/><span><strong>What could come next?</strong><small>Ask a question about this view.</small></span><ArrowRight size={17}/></button>}</div>}
        {cameraLive&&!xrRunning&&<div hidden={panel!=='ask'}>{device||held?.sample?<div className="scene-understanding"><h2>Actions</h2><p>Tap an object to hold it in view, save a photo, or use real measurements to check fit.</p><div className="live-explore-actions">{device&&<button onClick={()=>void saveView()} disabled={saving||!!savedView}>Save this view</button>}<button onClick={fitSelected}>Check an item fit</button><button onClick={()=>{camera.stop();navigate('room');}}>Arrange a room in 3D</button><button onClick={openPrivateWorkspace}>Open private workspace</button></div></div>:<><p className="live-small">Recognition pauses on this captured view while you ask. Return to See to resume live updates.</p><AskScene frame={held?.frame??camera.analysisFrame??camera.lastScan?.frame??null} analysis={displayedAnalysis} active={active&&cameraLive&&panel==='ask'} onSelect={id=>{setSelectedObject(id);setPanel('scene');}} onAction={action=>{if(action==='measure'){setPanel('fit');useManual();}else if(action==='room'||action==='inspect'){camera.stop();navigate(action);}}}/></>}</div>}
        <div className="live-fit-panel" hidden={!xrRunning&&(panel==='memory'||cameraLive&&panel!=='fit'||device&&panel!=='fit')}>
        <button className="room-entry-link" onClick={()=>{camera.stop();void endAR();navigate('room');}}><Box size={19}/><span><strong>Room planner</strong><small>Arrange furniture using your room measurements.</small></span><ArrowRight size={17}/></button>
        <div className="live-panel-title"><div><span className="live-kicker">FROM POSSIBILITY TO PLACEMENT</span><h2>{device?'Check dimensions':'Make room for…'}</h2></div><Box size={24} strokeWidth={1.3}/></div>
        <p className="live-panel-intro">The camera recognizes what is there. Try something you would like to add.</p>
        <div className="item-picker" role="group" aria-label="Try an item to add">{ITEM_PRESETS.map(value=><button key={value.id} aria-pressed={selected===value.id} onClick={()=>chooseItem(value)}>{value.label}</button>)}<button aria-pressed={selected==='custom'} onClick={()=>{setSelected('custom');setLabel('My item');setActualSize(false);}}>Custom</button></div>
        <div className="item-size-header"><label>{selected==='custom'?<input aria-label="Item name" value={label} maxLength={60} onChange={e=>setLabel(e.target.value)}/>:<strong>{label}</strong>}<span>{actualSize?'Your dimensions':'Editable example dimensions'}</span></label><select aria-label="Measurement unit" value={unit} onChange={e=>changeUnit(e.target.value as Unit)}><option value="cm">cm</option><option value="m">m</option></select></div>
        <DimensionInputs value={itemFields} onChange={value=>{setItemFields(value);setActualSize(false);}} unit={unit} prefix="Item"/>
        <label className="live-check"><input type="checkbox" checked={actualSize} onChange={e=>setActualSize(e.target.checked)}/>These are my item’s actual dimensions{car?', including mirrors.':'.'}</label>
        <div className="clearance-control"><label htmlFor="fit-margin">Extra room on each side <span>{car?'Allow for access around the parked vehicle.':'Include clearance around the item.'}</span></label><div><input id="fit-margin" aria-label="Clearance per side" type="number" min="0" step="any" value={margin} onChange={e=>setMargin(e.target.value)}/><span>{unit}</span></div></div>

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
        </div>

        {!xrRunning&&(device?<details className="live-camera-settings"><summary>Camera options & privacy</summary><section className="recognition-settings"><label><span><ScanLine size={16}/>Automatic item recognition</span><input type="checkbox" role="switch" aria-label="Automatic item recognition" checked={autoAnalyze} onChange={e=>setAutoAnalyze(e.target.checked)}/></label><p>{device?'Common objects are recognized on this device. Camera frames are not uploaded.':fastLive?'Common objects get fast labels on your device. A frame also goes to your AI service every few seconds for more detail. API usage continues until you stop.':'When on, occasional steady camera frames go to your configured AI service.'} Recognition does not measure free space.</p>{camera.analysis&&<p className="recognition-evidence">{testResponse?'Test response · ':''}{camera.analysis.provider==='on_device'?'On-device detection':camera.analysis.concepts.length?camera.analysis.model:camera.analysis.concept_discovery?.model??'Scene analysis'} · {recognized.length} item suggestions</p>}</section></details>:<section className="recognition-settings"><label><span><ScanLine size={16}/>Automatic item recognition</span><input type="checkbox" role="switch" aria-label="Automatic item recognition" checked={autoAnalyze} onChange={e=>setAutoAnalyze(e.target.checked)}/></label><p>{device?'Common objects are recognized on this device. Camera frames are not uploaded.':fastLive?'Common objects get fast labels on your device. A frame also goes to your AI service every few seconds for more detail. API usage continues until you stop.':'When on, occasional steady camera frames go to your configured AI service.'} Recognition does not measure free space.</p>{camera.analysis&&<p className="recognition-evidence">{testResponse?'Test response · ':''}{camera.analysis.provider==='on_device'?'On-device detection':camera.analysis.concepts.length?camera.analysis.model:camera.analysis.concept_discovery?.model??'Scene analysis'} · {recognized.length} item suggestions</p>}</section>)}
        {!xrRunning&&<button className="saved-photo-link" onClick={()=>{camera.stop();navigate('inspect');}}>Compare with a saved setup <ArrowRight size={15}/></button>}
      </aside>
    </div>
  </div>;
}
