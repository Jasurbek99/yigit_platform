// Market app service worker: exists so Android offers "Install". No caching on purpose —
// the app is online-only and must always load the current build.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
