import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
export default function StorageStatus(){
  const [message,setMessage]=useState('');
  const [offline,setOffline]=useState('Checking offline availability…'),[usage,setUsage]=useState('');
  function check(){
    if(Capacitor.isNativePlatform()){setOffline('The app interface is installed on this device. Cloud AI needs a connection.');return;}
    const worker=navigator.serviceWorker?.controller;
    if(!worker){setOffline('Offline preparation is not complete. Open WorldOS online and keep it open until it is ready.');return;}
    const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();setOffline('Offline readiness could not be checked. Reconnect and try again.');},5000);
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();setOffline(event.data?.ready?'Ready offline: saved device photos, checklists and rooms can reopen without a connection.':'Some offline files are missing. Reconnect and reopen WorldOS to finish preparing.');};
    worker.postMessage({type:'OFFLINE_STATUS'},[channel.port2]);
  }
  useEffect(()=>{check();navigator.serviceWorker?.addEventListener('controllerchange',check);void navigator.storage?.estimate?.().then(value=>{if(value.usage!==undefined)setUsage(`Device storage used: ${(value.usage/1024/1024).toFixed(1)} MB.`);}).catch(()=>{});return()=>navigator.serviceWorker?.removeEventListener('controllerchange',check);},[]);
  async function protect(){try{if(!navigator.storage?.persist){setMessage('This browser manages storage automatically. Keep exported backups of important work.');return;}const granted=await navigator.storage.persist();setMessage(granted?'Persistent device storage is enabled. Clearing site data still removes local work.':'This browser could not grant persistent storage. Your work is saved; keep an exported backup.');}catch{setMessage('Storage protection is unavailable. Export a backup of important work.');}}
  return <div><button className="secondary" onClick={()=>void protect()}>Protect device saves</button>{message&&<p role="status">{message}</p>}<p role="status">{offline}</p><button className="text-button" onClick={check}>Check offline readiness</button>{usage&&<p className="quiet">{usage}</p>}<p className="quiet">Cloud AI needs an internet connection. Export backups of important work.</p></div>;
}
