import { Check, Lightbulb, Paintbrush } from 'lucide-react';
import type { InteriorLight } from '../room/layout';

const WALL_FINISHES=[{name:'Chalk',color:'#ece9e2'},{name:'Warm white',color:'#f2eadb'},{name:'Sage green',color:'#a6b29b'},{name:'Terracotta',color:'#bd8872'},{name:'Deep blue',color:'#627785'}];
const FLOOR_FINISHES=[{name:'Natural oak',color:'#cdbc9e'},{name:'Walnut',color:'#8c6c51'},{name:'Pale ash',color:'#ded4bf'},{name:'Warm stone',color:'#b7b4aa'}];

export function LightingControls({light,onChange}:{light:InteriorLight;onChange:(light:InteriorLight)=>void}) {
  return <section className="design-light-tools" aria-label="Light appearance">
    <div className="design-light-title"><span><Lightbulb size={18}/>Light appearance</span><button type="button" role="switch" aria-label="Fixture light" aria-checked={light.enabled} onClick={()=>onChange({...light,enabled:!light.enabled})}>{light.enabled?'On':'Off'}</button></div>
    <div className="design-light-warmth" role="group" aria-label="Light color temperature">{([{value:2700,name:'Warm'},{value:4000,name:'Neutral'},{value:6500,name:'Cool'}] as const).map(({value,name})=><button type="button" key={value} aria-label={`${name} light`} aria-pressed={light.temperature===value} onClick={()=>onChange({...light,temperature:value})}>{name}<small>{value} K</small></button>)}</div>
    <label className="design-light-brightness"><span>Fixture brightness<strong>{light.brightness}%</strong></span><input type="range" aria-label="Light brightness" min="0" max="100" step="5" value={light.brightness} onChange={event=>onChange({...light,brightness:Number(event.target.value)})}/></label>
    <p>Preview the fixture's glow. Actual room lighting depends on the product and installation.</p>
  </section>;
}

export function RoomFinishControls({finishes,onChange}:{finishes?:{wallColor:string;floorColor:string};onChange:(value:{wallColor:string;floorColor:string})=>void}) {
  const colors=finishes??{wallColor:'#ece9e2',floorColor:'#cdbc9e'};
  return <section className="design-room-finishes" aria-label="Room finishes">
    <header><Paintbrush size={22}/><div><span className="design-kicker">THE ROOM AROUND YOUR PIECES</span><h2>Set the palette.</h2></div></header>
    <p>Try wall and floor colors together in your 3D studio.</p>
    {([{label:'Wall color',key:'wallColor',palette:WALL_FINISHES},{label:'Floor color',key:'floorColor',palette:FLOOR_FINISHES}] as const).map(({label,key,palette})=><div className="design-palette" key={key}><span>{label}</span><div role="group" aria-label={label}>{palette.map(({name,color})=><button type="button" key={name} aria-label={`${name} ${key==='wallColor'?'walls':'floor'}`} aria-pressed={colors[key]===color} title={name} style={{background:color}} onClick={()=>onChange({...colors,[key]:color})}>{colors[key]===color&&<Check size={15}/>}</button>)}<label><input type="color" aria-label={`Custom ${label.toLowerCase()}`} value={colors[key]} onChange={event=>onChange({...colors,[key]:event.target.value})}/>Custom</label></div></div>)}
  </section>;
}
