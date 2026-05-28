/* =========================================================
   Hotel SaaS Pro — Service Worker
   Stratégie : Cache First (CDN) + Network First (HTML/API)
   Firebase Firestore : TOUJOURS bypass (réseau uniquement)
   ========================================================= */
const CACHE_NAME = 'hotel-saas-v1';
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 jours

/* Ressources CDN à mettre en cache immédiatement */
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-app-compat.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-firestore-compat.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800;900&display=swap'
];

/* Domaines Firebase — jamais mis en cache */
const FIREBASE_HOSTS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com'
];

const isFirebase = url =>
  FIREBASE_HOSTS.some(h => url.hostname.includes(h)) ||
  url.hostname.includes('.firebaseapp.com') ||
  url.hostname.includes('.firebasestorage.app');

const isCDN = url =>
  url.hostname.includes('cdnjs.cloudflare.com') ||
  url.hostname.includes('fonts.googleapis.com') ||
  url.hostname.includes('fonts.gstatic.com');

/* ── INSTALL : précharge CDN ─────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(CDN_ASSETS.map(url => cache.add(url).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE : nettoie anciens caches ───────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH ───────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* 1. Firebase → toujours réseau, pas de fallback cache */
  if (isFirebase(url)) return;

  /* 2. CDN → Cache First (stale-while-revalidate implicite) */
  if (isCDN(url)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return res;
        }).catch(() => cached || new Response('', { status: 503 }));
      })
    );
    return;
  }

  /* 3. HTML de l'app (index.html, /) → Network First */
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      }).catch(() =>
        caches.match(event.request).then(cached =>
          cached || caches.match('/') || new Response('<h1>Hors ligne</h1>', {
            headers: { 'Content-Type': 'text/html' }
          })
        )
      )
    );
    return;
  }

  /* 4. Autres assets (icons, manifest…) → Cache First */
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      }).catch(() => new Response('', { status: 503 }))
    )
  );
});

/* ── MESSAGE : force refresh cache ──────────────────── */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => event.ports[0]?.postMessage('CACHE_CLEARED'));
  }
});

