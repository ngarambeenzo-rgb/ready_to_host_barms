/* ═══════════════════════════════════════════════════
   BARMS PRO — db-local.js
   IndexedDB abstraction layer for offline support
   Tasks 53-59: All offline data storage
   LOAD FIRST — before all other scripts
═══════════════════════════════════════════════════ */

const DB_NAME = 'barms_offline';
const DB_VERSION = 1;
let _db = null;

// ── Open / initialize IndexedDB (Task 53) ─────────
function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return; }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    // Create object stores on first open (Task 54-58)
    req.onupgradeneeded = e => {
      const db = e.target.result;

      // Task 54: Products store — full product list for offline
      if (!db.objectStoreNames.contains('products')) {
        db.createObjectStore('products', { keyPath: 'id' });
      }

      // Task 55: Sync queue — pending sales/expenses not yet on server
      if (!db.objectStoreNames.contains('sync_queue')) {
        const sq = db.createObjectStore('sync_queue', { keyPath: 'clientUuid' });
        sq.createIndex('status', 'status', { unique: false });
      }

      // Task 56: Auth store — JWT token and session data
      if (!db.objectStoreNames.contains('auth')) {
        db.createObjectStore('auth', { keyPath: 'key' });
      }

      // Task 57: Settings store — bar name, currency, language
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // Task 58: Cache meta — last sync timestamps per data type
      if (!db.objectStoreNames.contains('cache_meta')) {
        db.createObjectStore('cache_meta', { keyPath: 'key' });
      }
    };

    req.onsuccess = e => {
      _db = e.target.result;
      resolve(_db);
    };

    req.onerror = e => {
      console.error('[DB] IndexedDB open failed:', e.target.error);
      reject(e.target.error);
    };
  });
}

// ── Get all records from a store ──────────────────
async function dbGetAll(storeName) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('[DB] getAll failed:', storeName, e);
    return [];
  }
}

// ── Get one record by key ─────────────────────────
async function dbGet(storeName, key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('[DB] get failed:', storeName, key, e);
    return null;
  }
}

// ── Put (insert or update) a record ──────────────
async function dbPut(storeName, obj) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(obj);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('[DB] put failed:', storeName, e);
    return null;
  }
}

// ── Delete one record by key ──────────────────────
async function dbDelete(storeName, key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('[DB] delete failed:', storeName, key, e);
    return false;
  }
}

// ── Clear all records from a store ───────────────
async function dbClear(storeName) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('[DB] clear failed:', storeName, e);
    return false;
  }
}

// ── Count records in a store ──────────────────────
async function dbCount(storeName) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error('[DB] count failed:', storeName, e);
    return 0;
  }
}

// ── Save last sync timestamp for a data type ──────
async function dbSetSyncTime(key) {
  await dbPut('cache_meta', { key, lastSync: new Date().toISOString() });
}

// ── Get last sync time for display ───────────────
async function dbGetSyncTime(key) {
  const rec = await dbGet('cache_meta', key);
  return rec ? rec.lastSync : null;
}

// ── Initialize DB on page load ────────────────────
openDB().then(() => {
  console.log('[DB] IndexedDB ready');
}).catch(e => {
  console.warn('[DB] IndexedDB not available — offline features disabled:', e);
});
