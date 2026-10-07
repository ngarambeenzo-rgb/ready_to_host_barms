/* ═══════════════════════════════════════════════════
   BARMS PRO — data-limit.js
   17-day local data limit system:
   - Auto-purges data older than 17 days
   - Shows offline data notice in reports
   - Tracks storage usage
   - Shows countdown when approaching limit
═══════════════════════════════════════════════════ */

const DATA_LIMIT_DAYS   = 17;
const DATA_WARN_DAYS    = 14; // show warning at 14 days

// ── PURGE OLD LOCAL DATA ──────────────────────────
async function purgeOldLocalData() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DATA_LIMIT_DAYS);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  let purged = 0;

  try {
    // The sync queue holds only what has NOT reached the server yet (synced items are
    // removed as soon as the server confirms them). Old items are therefore never deleted:
    // they are reported, so the Owner/support can get them synced. (They used to be purged
    // after DATA_LIMIT_DAYS, which could lose sales.)
    const queue = await dbGetAll('sync_queue').catch(() => []);
    const old = queue.filter(item => item.timestamp && new Date(item.timestamp).toISOString().split('T')[0] < cutoffStr);
    if (old.length && typeof healthReport === 'function') {
      healthReport('sync', `${old.length} item(s) saved offline more than ${DATA_LIMIT_DAYS} days ago have still not synced`, { severity: 'error', source: 'offline queue' });
    }

    if (purged > 0) {
      console.log(`[DataLimit] Purged ${purged} old records (older than ${DATA_LIMIT_DAYS} days)`);
      await dbPut('cache_meta', {
        key: 'last_purge',
        timestamp: Date.now(),
        purgedCount: purged,
        cutoffDate: cutoffStr,
      });
    }
  } catch(e) {
    console.warn('[DataLimit] Purge error:', e.message);
  }

  return purged;
}

// ── CHECK DATA AGE & SHOW WARNING ─────────────────
async function checkDataAge() {
  try {
    const lastSync = await dbGet('cache_meta', 'last_ims_sync');
    if (!lastSync || !lastSync.timestamp) return;

    const daysSince = Math.floor((Date.now() - lastSync.timestamp) / 86400000);

    if (daysSince >= DATA_LIMIT_DAYS) {
      // Data limit reached — trigger lock
      showDataLimitBanner('expired');
    } else if (daysSince >= DATA_WARN_DAYS) {
      // Warning zone
      const daysLeft = DATA_LIMIT_DAYS - daysSince;
      showDataLimitBanner('warning', daysLeft);
    } else {
      hideDataLimitBanner();
    }
  } catch(e) {}
}

// ── SHOW DATA LIMIT BANNER ────────────────────────
function showDataLimitBanner(type, daysLeft = 0) {
  const existing = document.getElementById('dataLimitBanner');
  if (existing) existing.remove();

  if (type === 'expired') return; // handled by license lock

  const banner = document.createElement('div');
  banner.id = 'dataLimitBanner';
  banner.style.cssText = `
    position:fixed;top:0;left:0;right:0;z-index:9997;
    background:#FF8C42;color:#fff;
    padding:9px 16px;
    display:flex;align-items:center;gap:12px;
    font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;
    box-shadow:0 4px 16px rgba(255,140,66,0.5);
  `;
  banner.innerHTML = `
    <span style="flex:1">
      No sync for ${DATA_LIMIT_DAYS - daysLeft} days —
      connect to internet within <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>
      or app will lock and local data will be lost
    </span>
    <button onclick="this.parentElement.remove()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit">✕</button>
  `;
  document.body.appendChild(banner);
}

function hideDataLimitBanner() {
  const el = document.getElementById('dataLimitBanner');
  if (el) el.remove();
}

// ── SHOW OFFLINE DATA NOTICE IN REPORTS ───────────
function showOfflineDataNotice(containerEl, daysShowing = DATA_LIMIT_DAYS) {
  if (!containerEl) return;
  if (navigator.onLine) return; // online — no notice needed

  const notice = document.createElement('div');
  notice.style.cssText = `
    background:#1A2236;border:1px solid #FF8C42;border-radius:10px;
    padding:12px 16px;margin-bottom:16px;
    display:flex;align-items:center;gap:10px;
    font-family:'DM Sans',sans-serif;font-size:13px;color:#FF8C42;
  `;
  notice.innerHTML = `
    <span style="font-size:18px"></span>
    <div>
      <strong>Offline Mode</strong> — Showing local data from the last ${daysShowing} days only.
      <br><span style="font-size:11px;opacity:.8">Connect to internet for complete history and full reports.</span>
    </div>
  `;
  containerEl.insertBefore(notice, containerEl.firstChild);
}

// ── GET STORAGE INFO ───────────────────────────────
async function getStorageInfo() {
  try {
    const lastSync = await dbGet('cache_meta', 'last_ims_sync');
    const lastPurge = await dbGet('cache_meta', 'last_purge');
    const queueItems = await dbGetAll('sync_queue').catch(() => []);

    const daysSince = lastSync
      ? Math.floor((Date.now() - lastSync.timestamp) / 86400000)
      : null;

    const daysLeft = daysSince !== null
      ? Math.max(0, DATA_LIMIT_DAYS - daysSince)
      : DATA_LIMIT_DAYS;

    let storageUsed = '—';
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const est = await navigator.storage.estimate();
      const usedMB = ((est.usage || 0) / 1024 / 1024).toFixed(1);
      storageUsed = usedMB + ' MB';
    }

    return {
      daysSinceSync: daysSince,
      daysLeft,
      pendingItems: queueItems.filter(i => i.status === 'pending').length,
      lastPurgeDate: lastPurge ? new Date(lastPurge.timestamp).toLocaleDateString('en-RW') : 'Never',
      storageUsed,
      dataLimitDays: DATA_LIMIT_DAYS,
    };
  } catch(e) {
    return { daysLeft: DATA_LIMIT_DAYS, storageUsed: '—', pendingItems: 0 };
  }
}

// ── SHOW STORAGE INFO IN SETTINGS ─────────────────
async function renderStorageInfo(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const info = await getStorageInfo();

  const progressPct = info.daysSinceSync !== null
    ? Math.min(100, Math.round((info.daysSinceSync / DATA_LIMIT_DAYS) * 100))
    : 0;

  const progressColor = progressPct >= 80 ? '#FF4D6D' : progressPct >= 60 ? '#FF8C42' : '#00D084';

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div style="background:var(--bg);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:800;color:${progressColor}">${info.daysLeft}</div>
        <div style="font-size:11px;color:var(--muted)">Days before lock</div>
      </div>
      <div style="background:var(--bg);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:22px;font-weight:800;color:var(--blue)">${info.pendingItems}</div>
        <div style="font-size:11px;color:var(--muted)">Pending sync items</div>
      </div>
      <div style="background:var(--bg);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:14px;font-weight:700;color:var(--text)">${info.storageUsed}</div>
        <div style="font-size:11px;color:var(--muted)">Local storage used</div>
      </div>
      <div style="background:var(--bg);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:14px;font-weight:700;color:var(--text)">${info.lastPurgeDate}</div>
        <div style="font-size:11px;color:var(--muted)">Last data purge</div>
      </div>
    </div>

    <!-- Progress bar -->
    <div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:4px">
        <span>Data age: ${info.daysSinceSync !== null ? info.daysSinceSync + ' days' : 'Fresh'}</span>
        <span>Limit: ${DATA_LIMIT_DAYS} days</span>
      </div>
      <div style="background:var(--border);border-radius:20px;height:6px;overflow:hidden">
        <div style="height:100%;width:${progressPct}%;background:${progressColor};border-radius:20px;transition:width .5s"></div>
      </div>
    </div>

    <div style="font-size:11px;color:var(--muted)">
      Local data is automatically deleted after ${DATA_LIMIT_DAYS} days.
      Full history is always available online from the server.
    </div>
  `;
}

// ── RUN ON APP LOAD ───────────────────────────────
window.addEventListener('load', async () => {
  await checkDataAge();
  // Purge old data every time app loads
  setTimeout(purgeOldLocalData, 5000);
});

// ── RUN EVERY HOUR ────────────────────────────────
setInterval(async () => {
  await checkDataAge();
  await purgeOldLocalData();
}, 60 * 60 * 1000);
