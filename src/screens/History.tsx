import { useEffect, useRef, useState } from 'react';
import { ArrowRight, History as HistoryIcon, RefreshCw } from 'lucide-react';
import { listTemplates, templateHistory } from '../inspect/api';
import type { TemplateSummary } from '../inspect/types';
import { navigate } from '../navigation';
import OperationStatus from '../ui/OperationStatus';

export default function History({active=true}:{active?:boolean}) {
  const [templates,setTemplates]=useState<TemplateSummary[]>([]),[selected,setSelected]=useState('');
  const [items,setItems]=useState<{id:string;revision:number;created_at:string}[]>([]);
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const chosen=useRef('');
  useEffect(()=>{
    if(!active)return;let mounted=true;setError('');setLoading(true);
    void listTemplates().then(async result=>{
      const id=result.templates.some(item=>item.id===chosen.current)?chosen.current:result.templates[0]?.id??'';
      const history=id?await templateHistory(id):{inspections:[]};
      if(mounted){chosen.current=id;setTemplates(result.templates);setSelected(id);setItems(history.inspections);}
    }).catch(reason=>{if(mounted)setError(reason instanceof Error?reason.message:'History is unavailable. Retry when connected.');}).finally(()=>{if(mounted)setLoading(false);});
    return()=>{mounted=false;};
  },[active,revision]);
  return <div className="overview-page history-page"><header className="screen-heading"><div><span className="section-kicker">YOUR WORKSPACE JOURNAL</span><h1 id="page-title-history" tabIndex={-1}>Inspection history</h1><p>Saved observations, reviewed findings, and the evidence behind them.</p></div><button className="secondary" disabled={loading} onClick={()=>setRevision(value=>value+1)}><RefreshCw size={17}/>Refresh history</button></header>
    {!!templates.length&&<label className="history-filter">Workspace<select aria-label="History workspace" value={selected} disabled={loading} onChange={event=>{chosen.current=event.target.value;setSelected(event.target.value);setRevision(value=>value+1);}}>{templates.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    {loading&&<OperationStatus message="Reading saved inspections…"/>}
    {error&&<div className="error-banner" role="alert">{error}<button onClick={()=>setRevision(value=>value+1)}>Retry history</button></div>}
    {!loading&&!error&&!items.length&&<div className="empty-card"><HistoryIcon size={30}/><h2>No saved inspections yet</h2><p>Create a reviewed reference, then inspect a new photograph. Completed inspection records will appear here.</p><button className="primary" onClick={()=>navigate('inspect')}>Open Inspect <ArrowRight size={16}/></button></div>}
    {!loading&&!error&&!!items.length&&<ul className="history-list">{items.map(item=><li key={item.id}><button className="destination-card" onClick={()=>navigate('inspect',{inspection:item.id,open:crypto.randomUUID()})}><HistoryIcon size={20}/><span><strong>{new Date(item.created_at).toLocaleString()}</strong><small>Saved inspection · revision {item.revision}</small></span><ArrowRight size={18}/></button></li>)}</ul>}
  </div>;
}
