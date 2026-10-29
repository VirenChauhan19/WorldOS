import { useEffect, useId, useState } from 'react';
import type { CSSProperties } from 'react';
import { Eye, EyeOff, LockKeyhole, ScanLine } from 'lucide-react';
import Photo from '../ui/Photo';
import type { Box, Movement, SceneImage, SceneObject } from '../types';
import './photo-stage.css';

function boxStyle(box: Box): CSSProperties {
  return { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` };
}

// Labels use screen pixels, while their anchors follow the photo coordinates.
// Pin labels on the right half to the box's right edge to keep them in frame.
function labelStyle(box: Box, insideBottom = false): CSSProperties {
  const right = box.x + box.width / 2 > .5;
  return {
    ...(right ? { right: `${(1 - box.x - box.width) * 100}%` } : { left: `${box.x * 100}%` }),
    top: !insideBottom && box.y < .09 ? `${box.y * 100}%` : `max(30px, ${(insideBottom ? box.y + box.height : box.y) * 100}%)`,
    maxWidth: `min(190px, ${(right ? box.x + box.width : 1 - box.x) * 100}%)`,
    transform: !insideBottom && box.y < .09 ? 'translateY(6px)' : 'translateY(calc(-100% - 6px))',
  };
}

export default function PhotoStage({ image, imageAlt = 'Your space', toolbarLabel, objects = [], move, mark, onMark, highlight = [] }: {
  image: SceneImage;
  imageAlt?: string;
  toolbarLabel?: string;
  objects?: SceneObject[];
  move?: Movement;
  mark?: string;
  onMark?: (box: Box) => void;
  highlight?: string[];
}) {
  const id = useId().replaceAll(':', '');
  const [first, setFirst] = useState<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState({ x: .35, y: .35 });
  const [keyboard, setKeyboard] = useState(false);
  const [error, setError] = useState('');
  const [outlines, setOutlines] = useState(true);
  const visible = outlines || !!mark;
  const hasOverlays = objects.length > 0 || !!move;
  const width = image.width, height = image.height;

  useEffect(() => {
    setFirst(null);
    setCursor({ x: .35, y: .35 });
    setKeyboard(false);
    setError('');
    setOutlines(true);
  }, [image.image_url, mark]);

  function point(p: { x: number; y: number }) {
    if (!mark) return;
    if (!first) { setFirst(p); setError(''); return; }
    const box = { x: Math.min(first.x, p.x), y: Math.min(first.y, p.y), width: Math.abs(first.x - p.x), height: Math.abs(first.y - p.y) };
    if (box.width < .005 || box.height < .005) {
      setError('Choose the opposite corner so the outline surrounds the whole item.');
      return;
    }
    setFirst(null); setError(''); onMark?.(box);
  }

  return <div className="photo-stage-wrap">
    <div className="photo-stage-toolbar">
      <span><ScanLine size={15} aria-hidden="true"/>{toolbarLabel ?? (mark ? 'Outline an item' : move ? `Move ${move.number} · ${move.label}` : hasOverlays ? 'Photo overlay' : 'Original photo')}</span>
      {hasOverlays && !mark && <button type="button" className="photo-overlay-toggle" aria-pressed={outlines} onClick={() => setOutlines(value => !value)}>
        {outlines ? <Eye size={15} aria-hidden="true"/> : <EyeOff size={15} aria-hidden="true"/>}
        {outlines ? 'Hide outlines' : 'Show outlines'}
      </button>}
    </div>
    {mark && <p className="mark-help" role="status">{first ? 'Now tap the opposite corner.' : `Tap one corner of the ${mark}, then the opposite corner.`}<span>With a keyboard, use arrow keys to move the crosshair and Enter to mark each corner.</span></p>}
    <div className={`simple-photo spatial-photo ${mark ? 'is-marking' : ''}`} style={{ aspectRatio: `${width}/${height}` }}
      role={mark ? 'button' : 'group'} tabIndex={mark ? 0 : undefined}
      aria-label={mark ? `Mark ${mark} on the photo` : 'Photograph with spatial guidance'} aria-describedby={`${id}-description`}
      onPointerDown={mark ? e => { if (e.pointerType === 'mouse') e.preventDefault(); } : undefined}
      onClick={mark ? e => {
        if (!e.detail) return;
        const r = e.currentTarget.getBoundingClientRect();
        point({ x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) });
      } : undefined}
      onKeyDown={mark ? e => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
          e.preventDefault(); setKeyboard(true);
          const d = e.shiftKey ? .05 : .01;
          setCursor(p => ({ x: Math.min(1, Math.max(0, p.x + (e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0))), y: Math.min(1, Math.max(0, p.y + (e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0))) }));
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); setKeyboard(true); point(cursor);
        } else if (e.key === 'Escape') { setFirst(null); setError(''); }
      } : undefined}>
      <Photo src={image.image_url} alt={mark ? `Photograph for marking ${mark}` : imageAlt} width={width} height={height}/>
      {visible && <div className={`spatial-annotations ${move ? 'has-movement' : ''}`} aria-hidden="true">
        {objects.map(object => {
          const moving = move?.object_id === object.id;
          const affected = highlight.includes(object.id);
          const box = moving ? move.source : object.box;
          const tone = moving ? 'is-moving' : affected ? 'needs-review' : move ? 'is-context' : '';
          return <div key={object.id}>
            <div className={`spatial-outline ${tone}`} style={boxStyle(box)}/>
            {(!move || moving || affected) && <span className={`spatial-label ${tone}`} style={labelStyle(box, !moving && box.y > .7)} title={`${object.label}${affected && !moving ? ' — review needed' : ''}`}>
              {moving ? <span className="spatial-label-index">{move.number}</span> : affected ? <span className="spatial-review-indicator">!</span> : object.locked ? <LockKeyhole size={11}/> : <i/>}
              <span>{object.label}</span>
            </span>}
          </div>;
        })}
        {move && <>
          {!objects.some(object => object.id === move.object_id) && <>
            <div className="spatial-outline is-moving" style={boxStyle(move.source)}/>
            <span className="spatial-label is-moving" style={labelStyle(move.source)}><span className="spatial-label-index">{move.number}</span><span>{move.label}</span></span>
          </>}
          <div className="spatial-outline is-destination" style={boxStyle(move.destination)}/>
          <span className="spatial-label is-destination" style={labelStyle(move.destination, true)}><span className="spatial-destination-dot"/><span>Place here</span></span>
        </>}
      </div>}
      <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="spatial-guidance">
        <defs><marker id={`${id}-arrow`} markerWidth="8" markerHeight="8" refX="5.8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L6,3 L0,6" fill="none" stroke="#d5f580" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></marker></defs>
        {move && visible && <g className="spatial-movement">
          <line className="spatial-movement-shadow" x1={(move.source.x + move.source.width / 2) * width} y1={(move.source.y + move.source.height / 2) * height} x2={(move.destination.x + move.destination.width / 2) * width} y2={(move.destination.y + move.destination.height / 2) * height} vectorEffect="non-scaling-stroke"/>
          <line x1={(move.source.x + move.source.width / 2) * width} y1={(move.source.y + move.source.height / 2) * height} x2={(move.destination.x + move.destination.width / 2) * width} y2={(move.destination.y + move.destination.height / 2) * height} markerEnd={`url(#${id}-arrow)`} vectorEffect="non-scaling-stroke"/>
        </g>}
        {first && <circle cx={first.x * width} cy={first.y * height} r={Math.min(width, height) * .009} fill="#d5f580" stroke="#172019" strokeWidth="2" vectorEffect="non-scaling-stroke"/>}
        {keyboard && mark && <path d={`M${cursor.x * width - width * .016},${cursor.y * height} h${width * .032} M${cursor.x * width},${cursor.y * height - width * .016} v${width * .032}`} stroke="#d5f580" strokeWidth="2" vectorEffect="non-scaling-stroke" className="spatial-crosshair"/>}
      </svg>
    </div>
    <p id={`${id}-description`} className="photo-stage-description">
      {objects.length > 0 ? `Items outlined: ${objects.map(object => `${object.label}${highlight.includes(object.id) ? ' (review needed)' : ''}${object.locked ? ' (protected)' : ''}`).join(', ')}.` : 'Original photograph.'}
      {move && ` Move ${move.number}: ${move.label}. The solid outline is its current position; the dashed outline is its destination. The arrow shows the destination, not a safe travel path.`}
    </p>
    {hasOverlays && <div className="photo-stage-legend" aria-hidden="true">
      <span><i className={move ? 'legend-source' : 'legend-outline'}/>{move ? 'Current position' : `${objects.length} ${objects.length === 1 ? 'item' : 'items'} outlined`}</span>
      {move ? <span><i className="legend-destination"/>Destination</span> : highlight.some(id => objects.some(object => object.id === id)) && <span><i className="legend-review"/>Needs review</span>}
      <span className="photo-stage-medium">Photo guidance</span>
    </div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
