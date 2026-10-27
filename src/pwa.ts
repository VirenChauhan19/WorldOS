import { Capacitor } from '@capacitor/core';

export function registerServiceWorker() {
  if (!import.meta.env.PROD || Capacitor.isNativePlatform() || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  window.addEventListener('load',()=>{
    void navigator.serviceWorker.register('/sw.js',{scope:'/'}).then(registration=>{
      const ready=()=>{if(registration.waiting)window.dispatchEvent(new CustomEvent('worldos:update',{detail:registration.waiting}));};
      ready();
      registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',ready));
    }).catch(()=>{/* Installation is optional; online workflows remain available. */});
  });
}
