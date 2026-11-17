// Havuç Takas service worker: statik dosyaları önbelleğe alır, çevrimdışıyken uyarı sayfası gösterir.
const SURUM = 'havuc-v7';
const ONBELLEK = ['/cevrimdisi', '/static/css/style.css?v=5', '/static/js/app.js?v=5', '/static/img/havuc.svg', '/static/img/icon-192.png'];

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

// Telefona / tarayıcıya gelen anlık bildirim
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Havuç Takas', {
    body: d.body || '', icon: '/static/img/icon-192.png', badge: '/static/img/icon-192.png',
    data: { url: d.url || '/bildirimler' }, tag: d.url || undefined, renotify: !!d.url,
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hedef = new URL(e.notification.data && e.notification.data.url || '/', location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    const w = ws.find((x) => x.url === hedef) || ws.find((x) => new URL(x.url).origin === location.origin);
    if (w) return w.navigate(hedef).then((c) => (c || w).focus()).catch(() => self.clients.openWindow(hedef));
    return self.clients.openWindow(hedef);
  }));
});
