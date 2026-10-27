import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { Download, LockKeyhole, Settings2, WifiOff } from 'lucide-react';
import { apiFetch, backendURL, configureBackend, nativeNeedsBackend, setAccessToken, setCookieSession, usesCookies, validateBackendURL } from './backend';
import { AccessContext } from './access';
import type { WorkspaceAccess } from './access';

interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{outcome:string}> }

export default function MobileShell({children}:{children:ReactNode}) {
  const [state,setState]=useState<'loading'|'login'|'ready'|'unavailable'>('loading');
  const [online,setOnline]=useState(navigator.onLine);
  const [settings,setSettings]=useState(false);
  const [url,setUrl]=useState(()=>{try{return backendURL();}catch{return '';}});
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [pending,setPending]=useState(false);
  const [authRequired,setAuthRequired]=useState(false);
  const [ephemeralStorage,setEphemeralStorage]=useState(false);
  const [access,setAccess]=useState<WorkspaceAccess>('owner');
  const [judgeEnabled,setJudgeEnabled]=useState(false);
  const [judgeExpiry,setJudgeExpiry]=useState<string|null>(null);
  const [install,setInstall]=useState<InstallPrompt|null>(null);
  const [installHelp,setInstallHelp]=useState(false);
  const [generation,setGeneration]=useState(0);
  const [update,setUpdate]=useState<ServiceWorker|null>(null);
  const [restored,setRestored]=useState(false);
  const connectionAttempt=useRef(0);

  async function connect() {
    const attempt=++connectionAttempt.current;
    setPending(true);setError('');
    const controller=new AbortController();const timeout=window.setTimeout(()=>controller.abort(),10000);
    try {
      if(nativeNeedsBackend()){setSettings(true);setState('unavailable');return;}
      const response=await apiFetch('auth/status',{signal:controller.signal});
      if(!response.ok)throw new Error('Backend access is unavailable. Check HTTPS and server access settings.');
      const data=await response.json();
      if(attempt!==connectionAttempt.current)return;
      if(typeof data.required!=='boolean'||typeof data.authenticated!=='boolean')throw new Error('That address did not return a WorldOS connection response.');
      if(data.authenticated&&data.session_mode==='cookie'){
        if(typeof data.csrf_token!=='string')throw new Error('The backend returned an invalid session.');
        setCookieSession(data.csrf_token);
      }
      setJudgeEnabled(data.judge_enabled===true);
      setEphemeralStorage(data.storage_mode==='ephemeral');
      setAccess(data.access==='judge'?'judge':'owner');setJudgeExpiry(data.judge_expires_at??null);
      setAuthRequired(data.required);setState(data.authenticated?'ready':'login');
    }catch(e){if(attempt===connectionAttempt.current){setState('unavailable');setError(e instanceof Error?e.message:'Cannot reach the backend.');}}
    finally{window.clearTimeout(timeout);if(attempt===connectionAttempt.current)setPending(false);}
  }
  useEffect(()=>{
    void connect();
    const offline=()=>setOnline(false),online=()=>setOnline(true);
    const expired=()=>{setState('login');setAuthRequired(true);setError('Your session expired. Sign in again.');setGeneration(n=>n+1);};
    const prompt=(event:Event)=>{event.preventDefault();setInstall(event as InstallPrompt);};
    const swUpdate=(event:Event)=>setUpdate((event as CustomEvent<ServiceWorker>).detail);
    const installed=()=>{setInstall(null);setInstallHelp(false);};
    window.addEventListener('offline',offline);window.addEventListener('online',online);window.addEventListener('worldos:session-expired',expired);
    window.addEventListener('beforeinstallprompt',prompt);window.addEventListener('appinstalled',installed);window.addEventListener('worldos:update',swUpdate);
    return()=>{connectionAttempt.current++;window.removeEventListener('offline',offline);window.removeEventListener('online',online);window.removeEventListener('worldos:session-expired',expired);window.removeEventListener('beforeinstallprompt',prompt);window.removeEventListener('appinstalled',installed);window.removeEventListener('worldos:update',swUpdate);};
  },[]);
  useEffect(()=>{
    if(!Capacitor.isNativePlatform())return;
    const handle=NativeApp.addListener('appRestoredResult',result=>{if(result.pluginId==='Camera')setRestored(true);});
    return()=>{void handle.then(listener=>listener.remove());};
  },[]);
  async function login(event:React.FormEvent) {
    event.preventDefault();setPending(true);setError('');
    try{
      const response=await apiFetch('auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,access,mode:usesCookies()?'cookie':'bearer'}),signal:AbortSignal.timeout(15000)});
      const data=await response.json();
      if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Sign-in failed.');
      if(data.session_mode==='cookie'&&data.authenticated===true&&typeof data.csrf_token==='string')setCookieSession(data.csrf_token);
      else if(typeof data.access_token==='string')setAccessToken(data.access_token);
      else throw new Error('The backend returned an invalid session.');
      setAccess(data.access==='judge'?'judge':'owner');setJudgeExpiry(data.judge_expires_at??null);
      setPassword('');setState('ready');
    }catch(e){setPassword('');setError(e instanceof Error?e.message:'Sign-in failed.');}finally{setPending(false);}
  }
  async function signOut(){
    setPending(true);setError('');
    try{const response=await apiFetch('auth/logout',{method:'POST',signal:AbortSignal.timeout(5000)});if(!response.ok&&response.status!==401)throw new Error('Sign-out failed.');}
    catch{if(usesCookies()){setError('Could not sign out of the backend. Reconnect and retry; this browser session is still active.');return;}}
    finally{setPending(false);}
    setAccessToken('');setState('login');setGeneration(n=>n+1);
  }
  async function changeBackend(event:React.FormEvent){
    event.preventDefault();setError('');setPending(true);
    try{
      validateBackendURL(url);
      if(authRequired&&state==='ready'&&usesCookies()){
        const response=await apiFetch('auth/logout',{method:'POST',signal:AbortSignal.timeout(5000)});
        if(!response.ok&&response.status!==401)throw new Error('Sign out before changing servers.');
      }
      configureBackend(url);setSettings(false);setState('loading');setGeneration(n=>n+1);await connect();
    }catch(e){setError(e instanceof Error?e.message:'Cannot change the backend.');}finally{setPending(false);}
  }
  return <>
    <div className="mobile-utility"><span><LockKeyhole size={14}/>{authRequired?(access==='judge'?'Judge demo':'Private workspace'):'Local workspace'}</span><div>
      {!Capacitor.isNativePlatform()&&<button onClick={()=>{if(install){void install.prompt().then(()=>install.userChoice).then(()=>setInstall(null));}else setInstallHelp(!installHelp);}}><Download size={15}/>Install</button>}
      <button aria-expanded={settings} onClick={()=>setSettings(!settings)}><Settings2 size={15}/>Connection</button>
      {authRequired&&state==='ready'&&<button disabled={pending} onClick={()=>void signOut()}>Sign out</button>}
    </div></div>
    {ephemeralStorage&&<div className="mobile-banner" role="status">Temporary storage: saved work, uploaded photos, and login sessions may be lost when this server restarts, redeploys, or sleeps. Export important work and download backups to your device.</div>}
    {!online&&<div className="mobile-banner" role="status"><WifiOff size={18}/><span>Offline. AI, uploads, and saved inspections require a connection. Nothing will be queued or reported as completed.</span></div>}
    {update&&<div className="mobile-banner"><span>An app update is ready. Export any unsaved work before reloading.</span><button onClick={()=>{navigator.serviceWorker.addEventListener('controllerchange',()=>window.location.reload(),{once:true});update.postMessage({type:'ACTIVATE_UPDATE'});}}>Reload app</button></div>}
    {restored&&<div className="mobile-banner" role="status">The system restarted WorldOS while the camera was open. Sign in, reopen the saved workspace, and retake the photograph. No scan was automatically started.<button onClick={()=>setRestored(false)}>Dismiss</button></div>}
    {installHelp&&<aside className="mobile-banner"><p>On iPhone: open the HTTPS app in Safari, tap Share, then Add to Home Screen and Open as Web App. On Android: use your browser’s Install app or Add to Home screen menu. Installation needs a secure connection; AI still needs the backend.</p></aside>}
    {settings&&<form className="connection-settings" onSubmit={event=>void changeBackend(event)}>
      <label>WorldOS backend address<input aria-label="WorldOS backend address" type="url" value={url} placeholder="https://worldos.your-domain.com" onChange={e=>setUrl(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false}/></label>
      <p>Use your trusted WorldOS server. Leave blank for this website’s backend. Changing servers signs you out and clears unsaved work.</p><button className="primary" disabled={pending}>Connect</button>
    </form>}
    {error&&<div className="mobile-banner" role="alert">{error}</div>}
    {state==='ready'&&access==='judge'&&<div className="mobile-banner" role="status">Judge demo workspace. Other judges share these demo photos and inspections; owner data and backups are private. Sessions last up to two hours.{judgeExpiry&&` Access ends ${new Date(judgeExpiry).toLocaleString()}.`}</div>}
    {state==='ready'?<AccessContext.Provider value={access}><div key={generation}>{children}</div></AccessContext.Provider>:<main className="access-screen">
      <div className="access-card"><span className="section-kicker">WORLDOS · V0.8</span><h1>{state==='login'?'Your workspace. Securely.':state==='loading'?'Connecting to WorldOS':'Connect your workspace'}</h1>
      <p>Inspect physical spaces, review what changed, and follow validated corrections. Your backend stores photos and sends them to configured AI providers only when you request inference. API keys never enter this app.</p>
      {state==='login'&&judgeEnabled&&<label>Access<select aria-label="Workspace access" value={access} disabled={pending} onChange={e=>{setAccess(e.target.value as WorkspaceAccess);setPassword('');setError('');}}><option value="owner">Owner workspace</option><option value="judge">Judge demo workspace</option></select></label>}
      {state==='login'&&access==='judge'&&<p>Use the separate demo passphrase from the owner. Demo sessions last up to two hours and end when the access window closes.</p>}
      {state==='login'?<form onSubmit={event=>void login(event)}><label>Workspace passphrase<input aria-label="Workspace passphrase" type="password" autoComplete="current-password" value={password} maxLength={1024} onChange={e=>setPassword(e.target.value)}/></label><button className="primary" disabled={pending||!online||!password}>{pending?'Signing in…':'Sign in'}</button><p>{usesCookies()?'This browser stays signed in for up to eight hours, including reloads. Sign out when finished on a shared device.':'Sessions last up to eight hours. Native and separate-backend sessions require sign-in again after reloading.'}</p></form>:<button className="primary" disabled={pending||!online} onClick={()=>void connect()}>{pending?'Connecting…':'Retry connection'}</button>}
      </div></main>}
  </>;
}
