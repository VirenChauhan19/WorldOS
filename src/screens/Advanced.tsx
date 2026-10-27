import { useState } from 'react';
import { navigate } from '../navigation';
import ConnectionStatus from '../ConnectionStatus';
import { backendURL } from '../backend';
export default function Advanced(){
  const [busy,setBusy]=useState<string|null>(null);
  return <div className="consumer advanced-simple"><h1>Advanced</h1><p>Extra tools for detailed review, experiments, and troubleshooting. You don’t need these for a normal check.</p>
    <div className="simple-list"><button className="space-row" onClick={()=>navigate('studio')}><span>Spatial Studio<small>Plan a new arrangement, run demonstrations, and review movement constraints.</small></span></button><button className="space-row" onClick={()=>navigate('advanced-inspect')}><span>Detailed inspection workspace<small>Edit annotations, adjust alignment, export reports, and record physical test trials.</small></span></button><button className="space-row" onClick={()=>navigate('history-detail')}><span>Full inspection history<small>Open existing records and evidence.</small></span></button></div>
    <details><summary>Connection and AI diagnostics</summary><p>Server: {backendURL()||window.location.origin}</p><button className="secondary" onClick={()=>window.dispatchEvent(new Event('worldos:open-connection'))}>Change backend address</button><div className="advanced-surface"><ConnectionStatus busy={busy} onBusy={setBusy}/></div></details>
  </div>;
}
