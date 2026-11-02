import { Crosshair, LoaderCircle, RotateCcw, ScanLine } from 'lucide-react';
import type { AIAnalysis, SceneImage, SceneObject } from '../types';
import type { RecognitionStatus } from './useLiveCamera';

function location(object: SceneObject) {
  const x = object.box.x + object.box.width / 2;
  const y = object.box.y + object.box.height / 2;
  return `${y < .33 ? 'Upper' : y > .67 ? 'Lower' : 'Middle'} ${x < .33 ? 'left' : x > .67 ? 'right' : 'center'}`;
}

export default function SceneUnderstanding({ analysis, snapshot, status, retryInSeconds, selectedId, onSelect, onRefresh }: {
  analysis: AIAnalysis | null;
  snapshot?: SceneImage | null;
  status: RecognitionStatus;
  retryInSeconds: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  const objects = analysis?.objects ?? [];
  const selected = objects.find(object => object.id === selectedId);
  const working = status === 'analyzing';
  const title = status === 'off' ? 'Recognition is off' : working ? 'Understanding your view…' : status === 'retrying' ? 'Reconnecting to recognition…' : status === 'error' ? 'Recognition needs attention' : analysis ? objects.length ? `${objects.length} ${objects.length === 1 ? 'item' : 'items'} located` : 'No items located yet' : 'Ready to look around';
  const description = status === 'off' ? 'Turn on automatic recognition to identify the things in view.' : working ? 'Finding visible objects and locating their outlines. The captured view is being analyzed.' : status === 'retrying' ? `A temporary connection problem interrupted the scan. Trying again in ${retryInSeconds} ${retryInSeconds === 1 ? 'second' : 'seconds'}.` : status === 'error' ? 'Your camera still works. Check the message above, then retry recognition.' : !analysis ? 'Aim at your room or workspace and hold still. Items appear here automatically.' : !objects.length ? 'Try a brighter view or move closer to a few objects, then scan again.' : snapshot ? 'Your camera has moved. These items belong to the captured view below. Hold still to scan the next view.' : 'Select an item to highlight its outline in the camera.';
  const summary = analysis?.summary && analysis.summary !== 'User-supplied segmentation concepts.' ? analysis.summary : '';
  return <section className="scene-understanding" aria-label="Scene understanding" aria-busy={working}>
    <div className="scene-understanding-heading"><span className="live-kicker">{analysis?.live_request === false && !analysis.concept_discovery?.live_request ? 'TEST RESPONSE' : 'SCENE UNDERSTANDING'}</span><ScanLine size={17}/></div>
    <div role="status" aria-live="polite"><h2>{working && <LoaderCircle size={17} className="spin"/>}{title}</h2><p>{description}</p></div>
    {snapshot && <figure className="scene-captured"><figcaption>LAST CAPTURED VIEW · {objects.length} ITEMS</figcaption><div><img src={snapshot.image_url} alt="The captured camera frame used for these recognition results"/>{objects.map(object=><button key={object.id} type="button" className={`scene-captured-box ${selectedId===object.id?'is-selected':''}`} style={{left:`${object.box.x*100}%`,top:`${object.box.y*100}%`,width:`${object.box.width*100}%`,height:`${object.box.height*100}%`}} aria-label={`Highlight ${object.label} in captured view`} aria-pressed={selectedId===object.id} onClick={()=>onSelect(object.id)}/>)}</div></figure>}
    {summary && <p className="scene-summary">{summary}</p>}
    {!!objects.length && <div className="scene-items" role="group" aria-label="Recognized items">{objects.map((object, index) => <button key={object.id} aria-pressed={selectedId === object.id} onClick={() => onSelect(object.id)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{object.label}</strong><Crosshair size={14}/></button>)}</div>}
    {selected && <div className="scene-selection"><strong>{selected.label}</strong><span>{location(selected)} of the image{selected.confidence != null && ` · SAM score ${selected.confidence.toFixed(2)}`}</span><p>Object outlines describe this camera frame. They do not establish physical size or free space.</p></div>}
    {analysis?.truncated && <p className="scene-limit">Showing {objects.length} of {analysis.total_objects} detections. Move closer to focus on a smaller area.</p>}
    {!!analysis?.unmatched_concepts?.length && <details className="scene-unlocated"><summary>{analysis.unmatched_concepts.length} suggested {analysis.unmatched_concepts.length === 1 ? 'type' : 'types'} could not be located</summary><p>{analysis.unmatched_concepts.join(', ')}. These have no verified outline in this view.</p></details>}
    {analysis && <div className="scene-attribution"><span>{[analysis.concept_discovery?.model,analysis.concepts.length?analysis.model:undefined].filter(Boolean).join(' + ') || 'Scene analysis'}{analysis.inference_cache?.status === 'hit' ? ' · reused result' : ''}</span><span>Image-based suggestions</span></div>}
    {status !== 'off' && <button className="scene-refresh" disabled={working} onClick={onRefresh}><RotateCcw size={14}/>{working ? 'Recognition in progress' : 'Scan this view again'}</button>}
  </section>;
}
