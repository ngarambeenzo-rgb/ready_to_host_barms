<?php
// Serve the Service Worker JavaScript with correct MIME type.
// InfinityFree's WAF intercepts sw.js requests and returns an HTML
// bot-challenge page — PHP requests bypass this restriction.
header('Content-Type: application/javascript');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Service-Worker-Allowed: /');
?>
// ============================================================
//  BarMS Pro — sw.js (Service Worker)
//  Handles offline caching + automatic update installation
// ============================================================

const CACHE_VERSION  = 'barms-v1.0.4';
// Folder this worker was installed from: '/' on the hosting domain, '/barms/' on localhost.
// Every path below is relative to it, so the app works in either place.
const BASE = self.location.pathname.replace(/[^/]*$/, '');
const at = path => BASE + path.replace(/^\//, '');
const STATIC_CACHE   = CACHE_VERSION + '-static';
const API_CACHE      = CACHE_VERSION + '-api';

const STATIC_FILES = [
  '/',
  '/index.php',
  '/assets/css/main.css',
  '/assets/js/db-local.js',
  '/assets/js/license.js',
  '/assets/js/sync.js',
  '/assets/js/data-limit.js',
  '/assets/js/utils.js',
  '/assets/js/api.js',
  '/assets/js/auth.js',
  '/assets/js/navigation.js',
  '/assets/js/dashboard.js',
  '/assets/js/sales.js',
  '/assets/js/stock.js',
  '/assets/js/products.js',
  '/assets/js/expenses.js',
  '/assets/js/reports.js',
  '/assets/js/charts.js',
  '/assets/js/employees.js',
  '/assets/js/misc.js',
  '/assets/js/settings.js',
  '/assets/js/offline-ui.js',
  '/assets/js/pwa.js',
  '/pages/dashboard.html',
  '/pages/sales.html',
  '/pages/stock.html',
  '/pages/products.html',
  '/pages/expenses.html',
  '/pages/reports.html',
  '/pages/charts.html',
  '/pages/settings.html',
];

const MANIFEST_JSON = {
  name: "BarMS Pro — Bar Management System",
  short_name: "BarMS Pro",
  description: "Rwanda Bar Management System — Sales, Stock, Reports & More",
  start_url: "./",
  scope: "./",
  display: "standalone",
  background_color: "#1E3A8A",
  theme_color: "#1E3A8A",
  orientation: "any",
  lang: "en",
  categories: ["business", "finance"],
  icons: [
    { src: "assets/icons/icon-72.png",  sizes: "72x72",   type: "image/png" },
    { src: "assets/icons/icon-96.png",  sizes: "96x96",   type: "image/png" },
    { src: "assets/icons/icon-128.png", sizes: "128x128", type: "image/png" },
    { src: "assets/icons/icon-144.png", sizes: "144x144", type: "image/png" },
    { src: "assets/icons/icon-152.png", sizes: "152x152", type: "image/png" },
    { src: "assets/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: "assets/icons/icon-384.png", sizes: "384x384", type: "image/png" },
    { src: "assets/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
  ],
  shortcuts: [
    {
      name: "Quick Sale",
      short_name: "Quick Sale",
      description: "Go directly to Quick Sale",
      url: "./?page=quicksale",
      icons: [{ src: "assets/icons/icon-96.png", sizes: "96x96" }]
    }
  ]
};

// ── INSTALL ───────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_FILES.map(f => at(f) + '?v=' + CACHE_VERSION)))
      .catch(e => console.warn('[SW] Cache install error:', e))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating version:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== STATIC_CACHE && name !== API_CACHE)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ── FETCH ──────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Serve PWA manifest directly from memory — bypasses InfinityFree WAF
  if (url.pathname.endsWith('manifest.json') || url.pathname.endsWith('manifest.php')) {
    event.respondWith(
      new Response(JSON.stringify(MANIFEST_JSON), {
        status: 200,
        headers: {
          'Content-Type': 'application/manifest+json',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    );
    return;
  }

  // Always fetch from network for API calls
  // Always fetch from network for API calls and versioned JS files
  if (url.pathname.startsWith(at('api/')) ||
      url.pathname.includes('updater') ||
      url.pathname.includes('ims_config') ||
      url.pathname.includes('backdate.js')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ok:false,error:'offline'}), {
          headers: {'Content-Type': 'application/json'}
        });
      })
    );
    return;
  }

  // For everything else: network first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok && event.request.method === 'GET') {
          const responseClone = response.clone();
          caches.open(STATIC_CACHE).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match(at('index.php'));
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// ── MESSAGES FROM APP ──────────────────────────────
self.addEventListener('message', event => {
  const { type, version, updateUrl } = event.data || {};

  if (type === 'SKIP_WAITING') {
    console.log('[SW] Skip waiting — activating new version');
    self.skipWaiting();
  }

  if (type === 'INSTALL_UPDATE' && updateUrl) {
    caches.keys().then(names => {
      Promise.all(names.map(n => caches.delete(n))).then(() => {
        self.clients.matchAll().then(clients => {
          clients.forEach(client => client.postMessage({ type: 'UPDATE_READY', version }));
        });
      });
    });
  }

  if (type === 'GET_VERSION') {
    event.source.postMessage({ type: 'VERSION', version: CACHE_VERSION });
  }
});

// ── BACKGROUND SYNC ───────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-sales') {
    self.clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage({ type: 'BG_SYNC' }));
    });
  }
});

console.log('[SW] Service Worker loaded:', CACHE_VERSION);
