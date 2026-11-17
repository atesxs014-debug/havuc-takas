// Havuç Takas service worker: statik dosyaları önbelleğe alır, çevrimdışıyken uyarı sayfası gösterir.
const SURUM = 'havuc-v4';
const ONBELLEK = ['/cevrimdisi', '/static/css/style.css?v=3', '/static/js/app.js?v=3', '/static/img/havuc.svg', '/static/img/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SURUM).then((c) => c.addAll(ONBELLEK)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SURUM).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Sayfalar: önce ağ, olmazsa çevrimdışı sayfası (kişisel sayfalar önbelleğe alınmaz)
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/cevrimdisi')));
    return;
  }
  // Statik dosyalar ve fotoğraflar: önce önbellek
  if (url.pathname.startsWith('/static/') || url.pathname.startsWith('/uploads/') || url.pathname === '/iller.js') {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SURUM).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
