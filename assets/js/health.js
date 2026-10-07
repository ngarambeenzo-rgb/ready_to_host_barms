/* ═══════════════════════════════════════════════════
   BARMS PRO — health.js
   Reports browser problems to the incident log (api/health.php)
   so the Owner sees them on System Health with a reference,
   instead of them disappearing in someone's browser.
   • uncaught errors and failed promises
   • each distinct problem is reported once per page load (max 15)
   • reporting never reports its own failures (no loops)
   Loaded right after api.js.
═══════════════════════════════════════════════════ */

// The version of the files this page was built with: written into the page from version.txt
// by the server (index.php). A page served from an old cache carries its old number,
// which is exactly what the version check below compares with the server.
const BARMS_CLIENT_VERSION = (document.querySelector('meta[name="barms-version"]') || {}).content || 'unknown';
const _healthSent = new Set();
function healthReport(kind, message, extra = {}) {
  try {
    const msg = String(message || '').slice(0, 300);
    if (!msg) return;
    const sig = kind + '|' + msg;
    if (_healthSent.has(sig) || _healthSent.size >= 15) return;
    _healthSent.add(sig);
    const page = (document.querySelector('.page.active') || {}).id || '';
    fetch('api/health.php?action=client_error', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify({ kind, message: msg, page, version: BARMS_CLIENT_VERSION, ...extra }),
    }).catch(() => {});   // reporting must never cause another error
  } catch (e) { /* ignore */ }
}

window.addEventListener('error', e => {
  if (!e || !e.message) return;
  // a script from another site, or a browser extension: not BarMS
  if (e.filename && !e.filename.startsWith(location.origin)) return;
  healthReport('js', e.message, { source: (e.filename || '').replace(location.origin, '') + ':' + (e.lineno || 0), stack: (e.error && e.error.stack || '').slice(0, 1500) });
});
window.addEventListener('unhandledrejection', e => {
  const r = e && e.reason;
  const msg = r && (r.message || String(r));
  if (!msg || /AbortError/.test(msg)) return;
  healthReport('js', 'Unhandled: ' + msg, { stack: (r && r.stack || '').slice(0, 1500) });
});

// ── SAFE AUTOMATIC RECOVERY: old app files on this device ─────────
// The server says which version it runs. If this device runs older cached files:
//   1. note the attempt, 2. delete this site's caches, 3. update the service worker,
//   4. reload ONCE, 5. after the reload check again and report whether it worked.
// If it did not work it is reported, never retried in a loop.
const VER_FIX_KEY = 'barms_version_fix';
const VER_TITLE = 'This device was running an older version of BarMS than the server';
async function healthVersionCheck() {
  if (!navigator.onLine) return;
  let server;
  try { server = (await (await fetch('api/health.php?action=version', { credentials: 'same-origin', cache: 'no-store' })).json()).version; } catch (e) { return; }
  if (!server) return;
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(VER_FIX_KEY) || 'null'); } catch (e) {}
  if (server === BARMS_CLIENT_VERSION) {
    if (pending) {   // a recovery ran before this reload: it worked
      sessionStorage.removeItem(VER_FIX_KEY);
      healthReport('version', VER_TITLE, { recovery: 'worked', autoAction: `Cleared cached files and reloaded (${pending.from} → ${server})`, severity: 'info' });
    }
    return;
  }
  if (pending) {     // already tried once: report, do not loop
    sessionStorage.removeItem(VER_FIX_KEY);
    healthReport('version', VER_TITLE, { recovery: 'failed', autoAction: `Reload did not bring version ${server} (device still ${BARMS_CLIENT_VERSION})`, severity: 'error' });
    return;
  }
  sessionStorage.setItem(VER_FIX_KEY, JSON.stringify({ from: BARMS_CLIENT_VERSION, to: server, at: Date.now() }));
  healthReport('version', VER_TITLE, { severity: 'warning', autoAction: 'Clearing cached files and reloading' });
  try { if (window.caches) for (const k of await caches.keys()) await caches.delete(k); } catch (e) {}
  try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) {}
  // never interrupt someone typing a sale: wait until no form field has focus
  const reload = () => { const a = document.activeElement; if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return setTimeout(reload, 5000); location.reload(); };
  setTimeout(reload, 1500);
}

// ── SAFE AUTOMATIC RECOVERY: offline app not installed ─────────────
async function healthServiceWorkerCheck() {
  if (!('serviceWorker' in navigator) || !navigator.onLine || !window.isSecureContext) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg && (reg.active || reg.installing || reg.waiting)) return;
    await navigator.serviceWorker.register('sw.php', { scope: './' });
    const ok = !!(await navigator.serviceWorker.getRegistration());
    healthReport('device', 'The offline app (service worker) was missing on this device', { recovery: ok ? 'worked' : 'failed', autoAction: 'Registered the service worker again', severity: ok ? 'info' : 'error' });
  } catch (e) {
    healthReport('device', 'The offline app (service worker) was missing on this device', { recovery: 'failed', autoAction: 'Registering again failed: ' + e.message, severity: 'error' });
  }
}
setTimeout(() => { healthVersionCheck(); }, 4000);
setTimeout(() => { healthServiceWorkerCheck(); }, 20000);