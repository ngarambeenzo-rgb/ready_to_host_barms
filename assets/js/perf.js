/* ═══════════════════════════════════════════════════
   BARMS PRO — perf.js
   Performance optimizations:
   - JS memory cache (30s TTL) for API responses
   - Instant page switching (no re-fetch if fresh)
   - Debounced resize handler
   - Preload next likely page data
   LOAD AFTER api.js, BEFORE navigation.js
═══════════════════════════════════════════════════ */

// ── IN-MEMORY API CACHE ───────────────────────────
const _apiCache = new Map();
const CACHE_TTL = {
  'products:list':    30000,  // 30s
  'misc:dashboard':   20000,  // 20s
  'misc:settings_get':60000,  // 60s
  'sales:list':       10000,  // 10s
  'expenses:list':    15000,  // 15s
  'stock:list':       20000,  // 20s
  'employees:list':   30000,  // 30s
  'kitchen:revenue_list': 20000,
  'kitchen:expense_list': 20000,
  'misc:mgr_perms_get':   60000,
};

// Wrap apiGet to use cache
const _originalApiGet = apiGet;
window.apiGet = async function(endpoint, action, params = {}) {
  const key = endpoint + ':' + action;
  const ttl = CACHE_TTL[key];

  // Only cache GET requests with no params (or known safe params)
  const hasParams = Object.keys(params).length > 0;
  if (ttl && !hasParams) {
    const cached = _apiCache.get(key);
    if (cached && (Date.now() - cached.ts) < ttl) {
      return cached.data; // instant return from cache
    }
  }

  const result = await _originalApiGet(endpoint, action, params);

  // Store in cache if successful
  if (result && result.ok && ttl && !hasParams) {
    _apiCache.set(key, { data: result, ts: Date.now() });
  }

  return result;
};

// ── INVALIDATE CACHE on mutations ────────────────
const _originalApi = api;
window.api = async function(endpoint, action, data, method) {
  const result = await _originalApi(endpoint, action, data, method);

  if (result && result.ok) {
    // Clear related caches after any write
    const toInvalidate = {
      'sales':     ['sales:list', 'misc:dashboard', 'products:list'],
      'products':  ['products:list'],
      'stock':     ['stock:list', 'products:list'],
      'expenses':  ['expenses:list', 'misc:dashboard'],
      'kitchen':   ['kitchen:revenue_list', 'kitchen:expense_list', 'misc:dashboard'],
      'employees': ['employees:list'],
      'misc':      ['misc:dashboard', 'misc:settings_get', 'misc:mgr_perms_get'],
      'sessions':  ['misc:dashboard', 'products:list'],
    };
    const keys = toInvalidate[endpoint] || [];
    keys.forEach(k => _apiCache.delete(k));
  }

  return result;
};

// ── CLEAR ALL CACHE ───────────────────────────────
function clearApiCache() {
  _apiCache.clear();
}

// Page navigation handled by navigation.js

console.log('[Perf] Cache layer active');
