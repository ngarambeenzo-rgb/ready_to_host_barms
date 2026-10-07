/* ═══════════════════════════════════════════════════
   BARMS PRO — offline-ui.js
   Tasks 71-76: Offline/online UI indicators
   Depends on: db-local.js, utils.js
═══════════════════════════════════════════════════ */

// ── Connectivity state ────────────────────────────
function isOnline() {
  return navigator.onLine;
}

// ── Show/hide offline banner (Task 72) ───────────
function showOfflineBanner() {
  const banner = document.getElementById('offlineBanner');
  if (banner) banner.style.display = 'flex';
}

function hideOfflineBanner() {
  const banner = document.getElementById('offlineBanner');
  if (banner) banner.style.display = 'none';
}

// ── Update sync badge in topbar (Task 73) ─────────
async function updateSyncBadge() {
  const badge = document.getElementById('syncBadge');
  if (!badge) return;

  try {
    const allItems = await dbGetAll('sync_queue');
    const pending = allItems.filter(i => i.status === 'pending').length;
    const failed  = allItems.filter(i => i.status === 'failed').length;

    if (failed > 0) {
      badge.textContent = `${failed} failed`;
      badge.style.background = 'var(--red)';
      badge.style.display = 'inline-block';
    } else if (pending > 0) {
      badge.textContent = `${pending} pending`;
      badge.style.background = 'var(--orange)';
      badge.style.display = 'inline-block';
    } else {
      badge.textContent = '✓ Synced';
      badge.style.background = 'var(--green)';
      // Hide after 3 seconds if all synced
      setTimeout(() => { if (badge.textContent === '✓ Synced') badge.style.display = 'none'; }, 3000);
    }
  } catch (e) {
    badge.style.display = 'none';
  }
}

// ── Show cached data badge on a page (Task 75) ────
async function showCachedDataBadge(dataKey, containerId) {
  const lastSync = await dbGetSyncTime(dataKey);
  if (!lastSync) return;

  const container = document.getElementById(containerId);
  if (!container) return;

  const existing = container.querySelector('.cached-badge');
  if (existing) existing.remove();

  const badge = document.createElement('span');
  badge.className = 'cached-badge';
  badge.style.cssText = 'font-size:11px;color:var(--muted);margin-left:8px;font-style:italic';

  const d = new Date(lastSync);
  const diff = Math.round((Date.now() - d.getTime()) / 60000);
  badge.textContent = diff < 2 ? '(just updated)' : `(cached ${diff}m ago)`;
  container.appendChild(badge);
}

// ── Disable non-queueable actions when offline (Task 74) ──
function requireOnline(actionName) {
  if (!isOnline()) {
    if (typeof toast === 'function') {
      toast(`"${actionName}" requires an internet connection`, 'error');
    }
    return false;
  }
  return true;
}

// ── Listen to connectivity changes ────────────────
window.addEventListener('online', () => {
  console.log('[Offline UI] Back online');
  hideOfflineBanner();
  updateSyncBadge();
  // Trigger sync if available
  if (typeof syncPendingItems === 'function') {
    setTimeout(syncPendingItems, 1000);
  }
});

window.addEventListener('offline', () => {
  console.log('[Offline UI] Gone offline');
  showOfflineBanner();
  updateSyncBadge();
});

// ── Initialize on load ────────────────────────────
window.addEventListener('load', () => {
  if (!isOnline()) showOfflineBanner();
  updateSyncBadge();
});
