import { Capacitor } from '@capacitor/core';

export function registerServiceWorker() {
  if (!import.meta.env.PROD || Capacitor.isNativePlatform() || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  const register=()=>{
    void navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(registration=>{
      // Older releases can leave an offline-only worker waiting. Activate it
      // without reloading the page or interrupting an open workspace.
      registration.waiting?.postMessage({type:'ACTIVATE_UPDATE'});
    }).catch(()=>{/* Installation is optional; online workflows remain available. */});
  };
  if(document.readyState==='complete')register();
  else window.addEventListener('load',register,{once:true});
}
