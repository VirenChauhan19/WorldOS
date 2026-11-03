import { useEffect, useState } from 'react';
export default function OfflineStatus(){
  const [online,setOnline]=useState(navigator.onLine);
  useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  return online?null:<div className="offline-status" role="status">You’re offline. Saved device photos, checklists and room layouts are available. Reconnect for AI guidance.</div>;
}
