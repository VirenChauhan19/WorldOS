import { useState } from 'react';
import { Settings2, Smartphone, Sparkles } from 'lucide-react';
import ConnectionStatus from '../ConnectionStatus';
import { backendURL } from '../backend';

export default function Settings({reduced,onReduced}:{reduced:boolean;onReduced:(value:boolean)=>void}) {
  const [busy,setBusy]=useState<string|null>(null);
  return <div className="overview-page settings-page"><header className="screen-heading"><div><span className="section-kicker">MAKE YOURSELF AT HOME</span><h1 id="page-title-settings" tabIndex={-1}>Settings</h1><p>Your connection, display preferences, and AI readiness.</p></div></header>
    <section className="settings-card"><Settings2 size={21}/><div><h2>Backend connection</h2><p>{backendURL()||window.location.origin}</p><button className="secondary" onClick={()=>window.dispatchEvent(new Event('worldos:open-connection'))}>Change backend address</button></div></section>
    <section className="settings-card"><Sparkles size={21}/><div><h2>Comfortable motion</h2><p>Device accessibility settings are always respected. You can also reduce motion just for WorldOS.</p><label className="setting-toggle"><span>Reduce motion</span><input type="checkbox" role="switch" aria-label="Reduce motion" checked={reduced} onChange={event=>onReduced(event.target.checked)}/></label></div></section>
    <section className="settings-card"><Smartphone size={21}/><div><h2>WorldOS on your home screen</h2><p>Open WorldOS in your phone browser. Use its Share or browser menu to add the app to your home screen. Camera and AI workflows still need a connection.</p><button className="secondary" onClick={()=>window.dispatchEvent(new Event('worldos:install'))}>Installation options</button></div></section>
    <section className="settings-card connection-settings-card"><ConnectionStatus busy={busy} onBusy={setBusy}/></section>
  </div>;
}
