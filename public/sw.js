/* Offline fallback only. Never store app HTML, API responses, photos, or sessions. */
const CACHE = 'worldos-offline-v0.8.0-2';
const PUBLIC_ASSETS = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'];
self.addEventListener('install', event => {
  // This worker owns only the offline fallback and icons. App code and private
  // data always use the network, so activation needs no page reload or prompt.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PUBLIC_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('worldos-offline-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request, {cache:'no-store'}).catch(async () => (await (await caches.open(CACHE)).match('/offline.html')) || new Response('WorldOS is offline. Reconnect to inspect your workspace.', {status:503,headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}})));
});
