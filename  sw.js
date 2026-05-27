/* ═══════════════════════════════════════════════════════════════
   Hotel SaaS Pro — Service Worker
   Stratégie :
     • Shell (index.html)          → Cache First  (offline garanti)
     • Firebase / CDN (React, etc) → Cache First  (performance)
     • Firestore API               → Network Only (données temps réel)
     • Tout le reste               → Network First avec fallback cache
   ═══════════════════════════════════════════════════════════════ */

const VERSION     = "hotel-pro-v1.0.0";
const CACHE_SHELL = `${VERSION}-shell`;
const CACHE_CDN   = `${VERSION}-cdn`;
const CACHE_MISC  = `${VERSION}-misc`;

/* Ressources pré-cachées au install */
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

/* URLs CDN à mettre en cache dès la 1ère utilisation */
const CDN_ORIGINS = [
  "cdnjs.cloudflare.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
];

/* URLs à ne JAMAIS intercepter (Firebase Firestore / Auth) */
const BYPASS_PATTERNS = [
  /firestore\.googleapis\.com/,
  /firebase\.googleapis\.com/,
  /identitytoolkit\.googleapis\.com/,
  /securetoken\.googleapis\.com/,
  /\.firebaseio\.com/,
  /firebase-heartbeat/,
];

/* ─── Install ────────────────────────────────────────────── */
self.addEventListener("install", event => {
  console.log("[SW] Install →", VERSION);
  event.waitUntil(
    caches.open(CACHE_SHELL)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn("[SW] Pre-cache error:", err))
  );
});

/* ─── Activate ───────────────────────────────────────────── */
self.addEventListener("activate", event => {
  console.log("[SW] Activate →", VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith("hotel-pro-") && !k.startsWith(VERSION))
          .map(k => {
            console.log("[SW] Deleting old cache:", k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

/* ─── Fetch ──────────────────────────────────────────────── */
self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);

  /* 1. Ignorer les requêtes non-GET */
  if (request.method !== "GET") return;

  /* 2. Ignorer Firebase / Firestore (laisser passer directement) */
  if (BYPASS_PATTERNS.some(p => p.test(request.url))) return;

  /* 3. Shell : index.html → Cache First, fallback réseau */
  if (url.pathname === "/" || url.pathname === "/index.html") {
    event.respondWith(cacheFirst(request, CACHE_SHELL));
    return;
  }

  /* 4. Manifest & icônes → Cache First */
  if (
    url.pathname === "/manifest.json" ||
    url.pathname.match(/^\/icon-\d+\.png$/) ||
    url.pathname.match(/^\/splash-\d+x\d+\.png$/)
  ) {
    event.respondWith(cacheFirst(request, CACHE_SHELL));
    return;
  }

  /* 5. CDN (React, Firebase SDK, Fonts) → Cache First */
  if (CDN_ORIGINS.some(o => url.hostname.includes(o))) {
    event.respondWith(cacheFirst(request, CACHE_CDN));
    return;
  }

  /* 6. Tout le reste → Network First avec fallback cache */
  event.respondWith(networkFirst(request, CACHE_MISC));
});

/* ─── Stratégies ─────────────────────────────────────────── */

/**
 * Cache First : retourne le cache si dispo, sinon réseau + mise en cache
 */
async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn("[SW] cacheFirst network fail:", request.url);
    return new Response("Hors ligne — ressource non disponible", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

/**
 * Network First : essaie le réseau, sinon retourne le cache
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    /* Fallback ultime : renvoyer le shell pour les navigations */
    if (request.mode === "navigate") {
      const shell = await caches.match("/index.html");
      if (shell) return shell;
    }

    return new Response("Hors ligne — ressource non disponible", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

/* ─── Message : force update depuis l'app ───────────────── */
self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data === "GET_VERSION") {
    event.ports[0].postMessage({ version: VERSION });
  }
});
