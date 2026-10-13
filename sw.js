// Service worker : met l'interface en cache pour un démarrage rapide et l'installation en application.
const CACHE = 'traducteur-cours-v12';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'translate.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Réseau d'abord (en contournant le cache HTTP pour toujours avoir la dernière version), cache en secours.
// Les API externes ne sont pas interceptées.
// Fichier partagé depuis une autre application (WhatsApp, galerie…) : on le garde de côté, puis on ouvre
// l'application, qui le récupère (voir loadSharedFile dans app.js).
const SHARED = 'traducteur-cours-partage';
async function receiveShare(request) {
  const form = await request.formData();
  const file = form.get('media');
  if (file && file.size) {
    const cache = await caches.open(SHARED);
    await cache.put('fichier-partage', new Response(file, {
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'fichier') },
    }));
  }
  return Response.redirect('./?shared=1', 303);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.searchParams.has('share-target')) {
    e.respondWith(receiveShare(e.request));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
