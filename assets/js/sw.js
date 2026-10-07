// ============================================================
//  BarMS Pro — sw.js (Service Worker)
//  Handles offline caching + automatic update installation
// ============================================================

const CACHE_VERSION  = 'barms-v1.0.1'; // Updated automatically
const STATIC_CACHE   = CACHE_VERSION + '-static';
const API_CACHE      = CACHE_VERSION + '-api';

// Files to cache for offline use
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

// ── INSTALL ───────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_FILES.map(f => f + '?v=' + CACHE_VERSION)))
      .catch(e => console.warn('[SW] Cache install error:', e))
      .then(() => self.skipWaiting()) // Activate immediately
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
    }).then(() => self.clients.claim()) // Take control immediately
  );
});

// ── FETCH ──────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always fetch from network for API calls
  if (url.pathname.startsWith('/api/') ||
      url.pathname.includes('updater') ||
      url.pathname.includes('ims_config')) {
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
        // Cache successful responses
        if (response.ok && event.request.method === 'GET') {
          const responseClone = response.clone();
          caches.open(STATIC_CACHE).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Network failed — try cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Return offline page for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('/index.php');
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
    console.log('[SW] Installing update from:', updateUrl);
    // Note: actual file installation done by barms_updater.php
    // SW just clears cache so new files load fresh
    caches.keys().then(names => {
      Promise.all(names.map(n => caches.delete(n))).then(() => {
        console.log('[SW] Cache cleared for update');
        // Notify all clients
        self.clients.matchAll().then(clients => {
          clients.forEach(client => client.postMessage({
            type: 'UPDATE_READY',
            version,
          }));
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
    console.log('[SW] Background sync triggered');
    // Notify app to sync
    self.clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage({ type: 'BG_SYNC' }));
    });
  }
});

console.log('[SW] Service Worker loaded:', CACHE_VERSION);
