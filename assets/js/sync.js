/* ═══════════════════════════════════════════════════
   BARMS PRO — sync.js
   Upgraded: Now syncs with IMS too
   - Uploads sales/expenses to BarMS server
   - Also contacts IMS to renew license
   - Updates last sync time for grace period tracking
   - Auto-purges data older than 17 days
═══════════════════════════════════════════════════ */

const SYNC_INTERVAL_MS  = 15 * 60 * 1000; // 15 minutes auto sync
const DATA_RETENTION_DAYS = 17;            // max local data age

const SYNC_PROBE_MS       = 30 * 1000;      // retry this often while the internet is down

// true while items are waiting because the server could not be reached
let syncWaitingForNet = false;
let _syncRunning = false;

// ── MAIN SYNC FUNCTION ────────────────────────────
// Several triggers (internet back, sign-in, timers) can fire together; run one pass at a time.
async function syncPendingItems() {
  if (_syncRunning) return;
  _syncRunning = true;
  try { await _syncPendingItems(); } finally { _syncRunning = false; }
}

async function _syncPendingItems() {
  if (!navigator.onLine) { syncWaitingForNet = true; return; }
  syncWaitingForNet = false;
  // signed in on the server (an offline sign-in has no server session)
  const signedIn = typeof session !== 'undefined' && !!session.userId && !session.offline;

  let allItems = [];
  try {
    allItems = await dbGetAll('sync_queue');
  } catch(e) {
    console.warn('[Sync] Could not read sync queue:', e);
    return;
  }

  // oldest first: records reach the server in the order they happened
  const pending = allItems.filter(i => i.status === 'pending' && (i.retryCount || 0) < 5)
    .sort((a, b) => syncItemTime(a) - syncItemTime(b));
  const waitUsers = new Set();   // people whose records must wait (no valid offline token)

  // Show syncing state
  const badge = document.getElementById('syncBadge');
  if (badge && pending.length > 0) {
    badge.textContent = 'Syncing...';
    badge.style.background = 'var(--blue)';
    badge.style.display = 'inline-block';
  }

  let syncedCount = 0;

  // ── Step 1: Sync sales and expenses to BarMS server ──
  for (const item of pending) {
    if (waitUsers.has(item.username || '')) continue;
    try {
      const result = await syncItem(item, signedIn);

      if (result === null) {
        // needs its own person signed in online: try again later, not counted. Marked, so the
        // 30 s check does not keep trying it (sign-in, the 15 min pass and 'online' still do)
        if (!item.waiting) await dbPut('sync_queue', { ...item, waiting: true });
        continue;
      } else if (result.ok) {
        await dbDelete('sync_queue', item.clientUuid);
        if (typeof offlineAfterSync === 'function') await offlineAfterSync(item, result);
        syncedCount++;
      } else if (result.network || result.server || result.error === 'offline') {
        syncWaitingForNet = !!result.network;
        // The server crashed on this record (500, not "busy" or "database down"): count the try,
        // so a record that always breaks the server is set aside after 5 (System Health lists it)
        // instead of holding up everything behind it for ever. Records keep their order: stop here.
        if (result.httpStatus === 500 && result.error !== 'DB connection failed') {
          await dbPut('sync_queue', { ...item, retryCount: (item.retryCount || 0) + 1 });
        }
        break; // connection lost or server busy: try again later, not counted as a failed try
      } else if (result.error === 'offline_token_invalid' || /not authenticated|session expired/i.test(result.error || '')) {
        waitUsers.add(item.username || ''); // this person must sign in online once; others go on
        if (!item.waiting) await dbPut('sync_queue', { ...item, waiting: true });
      } else if (result.offlineRejected) {
        // the server refused it for a business reason: kept here and listed for the Owner
        await dbPut('sync_queue', { ...item, status: 'failed', rejected: true, error: result.message || result.error });
      } else if (result.error === 'conflict') {
        await dbPut('sync_queue', { ...item, status: 'conflict', conflictMessage: result.message });
        notifyConflict(item, result.message);
      } else {
        await dbPut('sync_queue', { ...item, retryCount: (item.retryCount || 0) + 1 });
      }
    } catch(e) {
      console.error('[Sync] Error syncing item:', item.clientUuid, e);
      await dbPut('sync_queue', { ...item, retryCount: (item.retryCount || 0) + 1 });
    }
  }

  // Mark stuck items as failed
  const stuckItems = allItems.filter(i => i.status === 'pending' && (i.retryCount || 0) >= 5);
  for (const item of stuckItems) {
    await dbPut('sync_queue', { ...item, status: 'failed' });
  }
  // escalate: kept on this device (never deleted) — the Owner can retry them on System Health
  if (stuckItems.length && typeof healthReport === 'function') {
    healthReport('sync', `${stuckItems.length} offline item(s) failed to sync 5 times and are waiting for a retry`, { severity: 'error', source: 'offline queue' });
  }

  // Refresh products from server after sync
  if (syncedCount > 0) {
    try {
      const res = await apiGet('products', 'list');
      if (res.ok) {
        for (const p of res.data || []) await dbPut('products', p);
        await dbSetSyncTime('products');
      }
    } catch(e) {}
  }

  // ── Step 2 + 3, only when something was sent (license.js renews on its own; a pass that sent
  // nothing must not call IMS every 30 s) ──
  if (syncedCount > 0) {
    await syncWithIMS(syncedCount);
    await purgeOldLocalData();
  }

  // Update sync badge
  await updateSyncBadge();
  console.log(`[Sync] Done. BarMS synced: ${syncedCount} items`);
}

// ── SYNC WITH IMS ─────────────────────────────────
async function syncWithIMS(recordsSynced = 0) {
  try {
    const clientId   = await getClientId();
    const deviceUuid = await getDeviceUuid();
    const imsUrl     = await getImsUrl();

    if (!clientId || !deviceUuid || !imsUrl) {
      console.log('[IMS Sync] Missing clientId or deviceUuid — skipping');
      return false;
    }

    console.log('[IMS Sync] Contacting IMS...');

    const res = await fetch(`${imsUrl}/api/licenses.php?action=renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        deviceUuid,
        recordsSynced,
        appVersion: BARMS_VERSION,
        syncedAt: new Date().toISOString(),
      }),
    });

    const data = await res.json();

    if (data.ok && data.token) {
      // Save fresh license
      await saveLicense(data.token, clientId, data.barName);
      console.log('[IMS Sync] License renewed — sub ends:', new Date(data.subscriptionEnd * 1000).toLocaleDateString());

      // Update sync countdown
      await dbPut('cache_meta', { key: 'last_ims_sync', timestamp: Date.now() });

      // Recheck license silently (hides any warnings)
      await checkLicense();
      return true;
    }

    // Handle suspension/expiry immediately
    if (data.lockNow || data.error === 'client_suspended' || data.error === 'subscription_expired') {
      console.warn('[IMS Sync] Account issue:', data.error);
      await dbPut('auth', { key: 'ims_license', token: null, savedAt: 0 });
      await checkLicense(); // Will show lock screen
      return false;
    }

    console.warn('[IMS Sync] Could not renew:', data.error);
    return false;

  } catch(e) {
    console.warn('[IMS Sync] Could not reach IMS server:', e.message);
    return false;
  }
}

// ── AUTO PURGE OLD LOCAL DATA ─────────────────────
async function purgeOldLocalData() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DATA_RETENTION_DAYS);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    let purgedCount = 0;

    // Purge old sales from IndexedDB
    try {
      const sales = await dbGetAll('sales');
      if (sales && sales.length) {
        for (const sale of sales) {
          const saleDate = sale.sale_date || sale.saleDate || '';
          if (saleDate && saleDate < cutoffStr) {
            await dbDelete('sales', sale.id || sale.clientUuid);
            purgedCount++;
          }
        }
      }
    } catch(e) {}

    // Purge old expenses
    try {
      const expenses = await dbGetAll('expenses');
      if (expenses && expenses.length) {
        for (const exp of expenses) {
          const expDate = exp.expense_date || exp.expenseDate || '';
          if (expDate && expDate < cutoffStr) {
            await dbDelete('expenses', exp.id || exp.clientUuid);
            purgedCount++;
          }
        }
      }
    } catch(e) {}

    if (purgedCount > 0) {
      console.log(`[Sync] Purged ${purgedCount} records older than ${DATA_RETENTION_DAYS} days`);
    }

    // Update last purge time
    await dbPut('cache_meta', { key: 'last_purge', timestamp: Date.now() });

  } catch(e) {
    console.warn('[Sync] Purge error:', e.message);
  }
}

// ── SYNC COUNTDOWN CHECK ──────────────────────────
// Shows warning banner when approaching the license lock (GRACE_PERIOD_DAYS in license.js)
async function checkSyncCountdown() {
  const lastSync = await dbGet('cache_meta', 'last_ims_sync');
  if (!lastSync || !lastSync.timestamp) return;

  const daysSince = Math.floor((Date.now() - lastSync.timestamp) / 86400000);
  const daysLeft  = GRACE_PERIOD_DAYS - daysSince;

  if (daysSince >= GRACE_PERIOD_DAYS - 3 && daysLeft >= 0) {
    // Show warning banner
    if (typeof showExpiryWarning === 'function') {
      const when = daysLeft > 0 ? `within ${daysLeft} day${daysLeft !== 1 ? 's' : ''}` : 'today';
      showExpiryWarning(
        `No sync for ${daysSince} days — connect to internet ${when} or app will lock`,
        true
      );
    }
  } else if (daysSince > GRACE_PERIOD_DAYS) {
    // Should lock — trigger license check
    if (typeof checkLicense === 'function') {
      await checkLicense();
    }
  }
}

// When a queued record was made (device time, clock-corrected for newer records)
function syncItemTime(item) {
  return item.at || Date.parse(item.timestamp) || 0;
}

// Send one queued record. With its maker's offline token it goes up even when nobody is
// signed in. Without one, only that same person signed in online may send it (records
// from before offline mode have no name: whoever is signed in sends them, as before).
// → api answer, or null when it has to wait.
async function syncItem(item, signedIn) {
  let target;
  if (item.type === 'sale') {
    target = ['sales', 'record', { productId: item.payload.productId, qty: item.payload.qty, clientUuid: item.clientUuid, clientCreatedAt: item.timestamp }];
  } else if (item.type === 'expense') {
    const p = item.payload;
    target = ['expenses', 'save', { desc: p.desc, category: p.category, amount: p.amount, date: p.date, paymentMethod: p.paymentMethod || 'Cash', clientUuid: item.clientUuid }];
  } else if (item.type === 'op') {
    target = [item.resource, item.action, item.payload];
  } else {
    return null;
  }
  if (typeof offlineSend === 'function') {
    const viaToken = await offlineSend(item, ...target);
    if (!viaToken.noToken) return viaToken;
  }
  if (!signedIn || (item.username && item.username !== session.username)) return null;
  return (typeof apiRaw === 'function' ? apiRaw : api)(...target);   // the real server, never the offline order screens
}

// ── NOTIFY CONFLICT ────────────────────────────────
function notifyConflict(item, message) {
  if (typeof showPopupNotif === 'function') {
    showPopupNotif(`Sync conflict: ${message}. Review required.`, 'error', '');
  }
}

// ── AUTO SYNC EVERY 5 MINUTES ─────────────────────
setInterval(async () => {
  if (navigator.onLine) {
    await syncPendingItems();
  } else {
    // Even offline — check countdown
    await checkSyncCountdown();
  }
}, SYNC_INTERVAL_MS);

// ── SYNC ON INTERNET RETURN ───────────────────────
window.addEventListener('online', () => {
  console.log('[Sync] Internet returned — syncing...');
  syncPendingItems();
});

// The 'online' event is not reliable (Wi-Fi connected without internet), so check often:
// items never tried yet, or waiting because the server could not be reached, go up as
// soon as the internet answers. Items that failed for another reason wait for the 15 min pass.
setInterval(async () => {
  if (!navigator.onLine || _syncRunning) return;
  if (!syncWaitingForNet) {
    const items = await dbGetAll('sync_queue').catch(() => []);
    if (!items.some(i => i.status === 'pending' && !(i.retryCount > 0) && !i.waiting)) return;
  }
  await syncPendingItems();
}, SYNC_PROBE_MS);

// ── SYNC ON APP LOAD ──────────────────────────────
window.addEventListener('load', async () => {
  if (navigator.onLine) {
    // Small delay to let app initialize first
    setTimeout(async () => {
      const count = await dbCount('sync_queue').catch(() => 0);
      if (count > 0) { // only sync on load if there are pending items
        await syncPendingItems();
      }
    }, 8000); // delay 8s to let app fully load first
  } else {
    await checkSyncCountdown();
  }
});

// ── REGISTER BACKGROUND SYNC ──────────────────────
async function registerBackgroundSync() {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.sync.register('sync-sales');
    console.log('[Sync] Background sync registered');
  } catch(e) {
    console.warn('[Sync] Background sync not supported:', e);
  }
}

// ── MANUAL RETRY ──────────────────────────────────
async function retryFailedSyncs() {
  const allItems = await dbGetAll('sync_queue');
  const failed   = allItems.filter(i => i.status === 'failed');
  for (const item of failed) {
    await dbPut('sync_queue', { ...item, status: 'pending', retryCount: 0 });
  }
  if (failed.length > 0) {
    toast(`Retrying ${failed.length} failed items...`, 'info');
    await syncPendingItems();
  }
}

// ── REPLACE checkForUpdates in sync.js with this ──

// from version.txt, written into the page by index.php (one place to change it)
const BARMS_VERSION = (document.querySelector('meta[name="barms-version"]') || {}).content || '1.0.0';
const PRODUCT_ID    = 1;

async function checkForUpdates() {
  if (!navigator.onLine) return;

  try {
    // Step 1: Call server-side updater (PHP handles download + install)
    const res  = await fetch('./barms_updater.php?v=' + Date.now(), {
      credentials: 'same-origin',
    });
    if (!res.ok) return;

    const data = await res.json();

    if (!data.ok && !data.hasUpdate) {
      console.log('[Update] Check failed:', data.error);
      return;
    }

    if (!data.hasUpdate) {
      console.log('[Update] Up to date (v' + BARMS_VERSION + ')');
      // Clear any pending update banner
      const old = document.getElementById('updateNotifBanner');
      if (old) old.remove();
      return;
    }

    if (data.updated) {
      // Server already installed the update!
      console.log('[Update] Installed v' + data.toVersion + ' — ' + data.filesInstalled + ' files updated');
      showUpdateReadyBanner(data);
    } else if (data.hasUpdate) {
      // Update available but no file yet (version bump only)
      console.log('[Update] Update v' + data.latest + ' available — no file uploaded yet');
      showUpdateAvailableBanner(data);
    }

  } catch(e) {
    console.warn('[Update] Error checking for updates:', e.message);
  }
}

// Show banner when update is installed and reload needed
function showUpdateReadyBanner(data) {
  const existing = document.getElementById('updateNotifBanner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'updateNotifBanner';
  banner.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:9996;
    background:linear-gradient(135deg,#059669,#10B981);
    color:#fff;border-radius:14px;padding:16px 20px;
    box-shadow:0 8px 32px rgba(5,150,105,0.4);
    font-family:'DM Sans',sans-serif;max-width:320px;
    border:1px solid rgba(255,255,255,0.2);
    animation:slideInBanner .3s ease;
  `;

  banner.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:12px">
      <span style="font-size:24px"></span>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:700;margin-bottom:4px">
          BarMS Pro Updated!
        </div>
        <div style="font-size:12px;opacity:.9;margin-bottom:4px">
          v${data.fromVersion} → v${data.toVersion} installed
          (${data.filesInstalled} files updated)
        </div>
        ${data.notes ? `<div style="font-size:11px;opacity:.8;margin-bottom:10px">${data.notes}</div>` : ''}
        <button onclick="window.location.reload(true)" style="
          background:rgba(255,255,255,0.25);border:1px solid rgba(255,255,255,0.4);
          color:#fff;border-radius:8px;padding:6px 16px;
          font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;
          width:100%;
        ">Reload to Apply Update</button>
      </div>
      <button onclick="this.closest('#updateNotifBanner').remove()" style="background:none;border:none;color:rgba(255,255,255,0.6);font-size:18px;cursor:pointer">×</button>
    </div>
    <style>@keyframes slideInBanner{from{transform:translateY(100px);opacity:0}to{transform:translateY(0);opacity:1}}</style>
  `;

  document.body.appendChild(banner);
}

// Show banner when update is available but not yet installed
function showUpdateAvailableBanner(data) {
  const existing = document.getElementById('updateNotifBanner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'updateNotifBanner';
  banner.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:9996;
    background:linear-gradient(135deg,#1E3A8A,#2563EB);
    color:#fff;border-radius:14px;padding:16px 20px;
    box-shadow:0 8px 32px rgba(30,58,138,0.4);
    font-family:'DM Sans',sans-serif;max-width:320px;
    border:1px solid rgba(255,255,255,0.15);
    animation:slideInBanner .3s ease;
  `;

  banner.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:12px">
      <span style="font-size:24px"></span>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:700;margin-bottom:4px">Update Available</div>
        <div style="font-size:12px;opacity:.85;margin-bottom:8px">
          BarMS Pro v${data.latest} is ready
        </div>
        ${data.notes ? `<div style="font-size:11px;opacity:.7;margin-bottom:10px">${data.notes}</div>` : ''}
        <button onclick="this.closest('#updateNotifBanner').remove()" style="
          background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.2);
          color:#fff;border-radius:8px;padding:6px 16px;
          font-size:12px;cursor:pointer;font-family:inherit;
        ">Dismiss</button>
      </div>
    </div>
  `;

  document.body.appendChild(banner);
}

// ── CHECK FOR UPDATES EVERY 30 MINUTES ────────────
setInterval(checkForUpdates, 30 * 60 * 1000);

// Check for updates 10 seconds after app loads
window.addEventListener('load', () => {
  setTimeout(checkForUpdates, 60000); // 60s delay — non-critical
});

// Listen for service worker message about updates
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data && event.data.type === 'UPDATE_READY') {
      showUpdateReadyBanner({ toVersion: event.data.version, fromVersion: BARMS_VERSION, filesInstalled: 0, notes: '' });
    }
    if (event.data && event.data.type === 'BG_SYNC') {
      syncPendingItems();
    }
  });
}
