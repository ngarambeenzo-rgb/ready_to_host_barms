/* ═══════════════════════════════════════════════════
   BARMS PRO — license.js
   License system:
   - Enter activation key once → get license from IMS
   - License stored invisibly in IndexedDB
   - Auto-renews every 24hrs silently
   - Locks app if expired
   - Shows warning when expiring soon
═══════════════════════════════════════════════════ */

const LICENSE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const EXPIRY_WARNING_DAYS    = 5;
const GRACE_PERIOD_DAYS      = 17;

// ── DEVICE UUID ───────────────────────────────────
function createDeviceUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return 'device-' + Date.now().toString(16) + '-' + Math.random().toString(16).slice(2);
}

async function getDeviceUuid() {
  try {
    const stored = await dbGet('auth', 'device_uuid');
    if (stored && stored.uuid) return stored.uuid;

    const uuid = createDeviceUuid();
    await dbPut('auth', { key: 'device_uuid', uuid });
    return uuid;
  } catch(e) {
    return createDeviceUuid();
  }
}

// ── IMS URL ───────────────────────────────────────
function normalizeImsUrl(imsUrl) {
  const serverUrl = new URL(imsUrl.trim() || '/ims', window.location.href);
  const localHosts = ['localhost', '127.0.0.1'];
  if (localHosts.includes(window.location.hostname) && localHosts.includes(serverUrl.hostname)) {
    serverUrl.protocol = window.location.protocol;
    serverUrl.hostname = window.location.hostname;
    serverUrl.port = window.location.port;
  }
  return serverUrl.href.replace(/\/+$/, '');
}

async function getImsUrl() {
  try {
    // Try IndexedDB first
    const stored = await dbGet('settings', 'ims_url');
    if (stored && stored.value) return normalizeImsUrl(stored.value);
    // Try config file
    try {
      const res = await fetch('./ims_config.json?t=' + Date.now());
      if (res.ok) {
        const cfg = await res.json();
        if (cfg.ims_url) {
          const imsUrl = normalizeImsUrl(cfg.ims_url);
          await dbPut('settings', { key: 'ims_url', value: imsUrl });
          return imsUrl;
        }
      }
    } catch(e) {}
    return normalizeImsUrl('/ims');
  } catch(e) {
    return normalizeImsUrl('/ims');
  }
}

function getImsActivationUrl(imsUrl, action) {
  const baseUrl = normalizeImsUrl(imsUrl);
  return `${baseUrl}/api/licenses.php?action=${encodeURIComponent(action)}`;
}

// ── GET CLIENT ID ─────────────────────────────────
async function getClientId() {
  try {
    const stored = await dbGet('auth', 'ims_client_id');
    return stored ? stored.clientId : null;
  } catch(e) { return null; }
}

// ── GET LICENSE ───────────────────────────────────
async function getLicense() {
  try {
    const rec = await dbGet('auth', 'ims_license');
    return rec ? rec.token : null;
  } catch(e) { return null; }
}

// ── SAVE LICENSE ──────────────────────────────────
async function saveLicense(token, clientId, barName) {
  try {
    await dbPut('auth', { key: 'ims_license', token, savedAt: Date.now() });
    if (clientId) await dbPut('auth', { key: 'ims_client_id', clientId });
    if (barName)  await dbPut('settings', { key: 'licensed_bar_name', value: barName });
    await dbPut('cache_meta', { key: 'last_ims_sync', timestamp: Date.now() });
  } catch(e) {}
}

// ── DECODE LICENSE PAYLOAD ────────────────────────
function decodeLicensePayload(token) {
  try {
    // Try JWT format (3 parts)
    const parts = token.split('.');
    if (parts.length === 3) {
      let b64 = parts[1].replace(/-/g,'+').replace(/_/g,'/');
      while (b64.length % 4) b64 += '=';
      return JSON.parse(atob(b64));
    }
    // Try base64 JSON format (fallback)
    return JSON.parse(atob(token));
  } catch(e) { return null; }
}

// ── ACTIVATE WITH KEY ─────────────────────────────
async function activateWithKey(key, retryOnDeviceConflict = true) {
  try {
    const deviceUuid= await getDeviceUuid();
    const imsUrl = await getImsUrl();
    const res = await fetch(getImsActivationUrl(imsUrl, 'activate_with_key'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activationKey: key.toUpperCase().trim(),
        deviceUuid,
        deviceName: navigator.userAgent.substring(0, 80),
        deviceType: /Mobile|Android|iPhone|iPad/.test(navigator.userAgent) ? 'Mobile' : 'Desktop',
      }),
    });

    const responseText = await res.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('[License] IMS returned a non-JSON response:', res.status, responseText);
      return { ok: false, error: `IMS returned an invalid response (HTTP ${res.status}). Check the IMS PHP error log.` };
    }
    if (data.ok && data.token) {
      await saveLicense(data.token, data.clientId, data.barName);
      return { ok: true, barName: data.barName, plan: data.plan, daysLeft: data.daysLeft };
    }
    if (data.error === 'device_uuid_conflict' && retryOnDeviceConflict) {
      const uuid = createDeviceUuid();
      await dbPut('auth', { key: 'device_uuid', uuid });
      return activateWithKey(key, false);
    }
    return { ok: false, error: data.message || data.error || 'Activation failed' };
  } catch(e) {
    console.error('[License] Activation request failed:', e);
    return { ok: false, error: `IMS request failed: ${e.message || 'unknown browser error'}` };
  }
}

// ── AUTO RENEW LICENSE ────────────────────────────
async function renewLicense() {
  if (!navigator.onLine) return false;
  try {
    const imsUrl    = await getImsUrl();
    const clientId  = await getClientId();
    const deviceUuid= await getDeviceUuid();
    if (!clientId) return false;

    const res = await fetch(getImsActivationUrl(imsUrl, 'renew'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, deviceUuid }),
    });

    const data = await res.json();
    if (data.ok && data.token) {
      await saveLicense(data.token, clientId, data.barName);
      console.log('[License] Renewed successfully ');
      return true;
    }

    // Handle immediate lock scenarios — clear token so lock screen shows
    if (data.lockNow ||
        data.error === 'client_suspended' ||
        data.error === 'device_blocked' ||
        data.error === 'subscription_expired' ||
        data.error === 'no_active_subscription') {
      await dbPut('auth', { key: 'ims_license', token: null, savedAt: 0 });
      console.warn('[License] Locking immediately:', data.error);
      return false;
    }

    console.warn('[License] Renewal failed:', data.error);
    return false;
  } catch(e) {
    console.warn('[License] Cannot reach IMS:', e.message);
    return false;
  }
}

// ── CHECK LICENSE ─────────────────────────────────
async function checkLicense() {
  const token = await getLicense();

  if (!token) {
    showActivationScreen();
    return false;
  }

  const payload = decodeLicensePayload(token);
  if (!payload) {
    showActivationScreen();
    return false;
  }

  const now = Math.floor(Date.now() / 1000);

  // Check subscription end (hard expiry)
  if (payload.subscriptionEnd && now > payload.subscriptionEnd) {
    showLockScreen('subscription_ended', payload);
    return false;
  }

  // Check token expiry with grace period
  if (payload.expiresAt && now > payload.expiresAt) {
    const lastSync = await dbGet('cache_meta', 'last_ims_sync');
    const daysSince = lastSync
      ? Math.floor((Date.now() - lastSync.timestamp) / 86400000)
      : GRACE_PERIOD_DAYS + 1;

    if (daysSince > GRACE_PERIOD_DAYS) {
      showLockScreen('grace_expired', payload);
      return false;
    }
    // In grace period — show warning but allow
    const daysLeft = GRACE_PERIOD_DAYS - daysSince;
    showExpiryWarning(`No internet for ${daysSince} days — connect soon or app locks in ${daysLeft} days`, true);
    hideLockScreen();
    return true;
  }

  // Check expiring soon
  const daysUntilSubEnd = Math.floor((payload.subscriptionEnd - now) / 86400);
  if (daysUntilSubEnd <= EXPIRY_WARNING_DAYS) {
    showExpiryWarning(`Subscription expires in ${daysUntilSubEnd} day${daysUntilSubEnd !== 1 ? 's' : ''} — Contact IMS to renew`, false);
  } else {
    hideExpiryWarning();
  }

  hideLockScreen();
  // Show login only before authentication; renewal checks must not cover the app.
  const loginWrap = document.getElementById('loginWrap');
  const appShell = document.getElementById('appShell');
  if (loginWrap && loginWrap.style.display === 'none' && appShell?.style.display !== 'flex') {
    loginWrap.style.display = 'flex';
  }
  console.log('[License] Valid — sub ends in', daysUntilSubEnd, 'days');
  return true;
}

// ── SHOW ACTIVATION SCREEN ────────────────────────
function showActivationScreen() {
  hideApp();
  removeExisting('imsLockScreen');

  const screen = document.createElement('div');
  screen.id = 'imsLockScreen';
  screen.style.cssText = 'position:fixed;inset:0;z-index:99999;background:linear-gradient(135deg,#0A0F1E 0%,#0D1321 50%,#111827 100%);display:flex;align-items:center;justify-content:center;font-family:\'DM Sans\',sans-serif';

  screen.innerHTML = `
    <div style="text-align:center;max-width:440px;width:90%;padding:32px 24px">
      <!-- Logo -->
      <div style="width:80px;height:80px;border-radius:20px;background:linear-gradient(135deg,#1E3A8A,#2563EB);display:flex;align-items:center;justify-content:center;font-size:36px;margin:0 auto 20px;box-shadow:0 8px 32px rgba(30,58,138,0.4)"><svg viewBox="0 0 44 44" width="48" height="48"><rect x="11" y="20" width="5" height="13" rx="1.5" fill="#fff" opacity=".55"/><rect x="19.5" y="14" width="5" height="19" rx="1.5" fill="#fff" opacity=".8"/><rect x="28" y="9" width="5" height="24" rx="1.5" fill="#fff"/></svg></div>
      <h1 style="font-size:24px;font-weight:800;color:#E8EDF5;margin-bottom:4px">BarMS Pro</h1>
      <p style="font-size:13px;color:#7B8CAA;margin-bottom:28px">Bar Management System — Rwanda </p>

      <!-- Activation card -->
      <div style="background:#111827;border:1px solid #1F2D45;border-radius:16px;padding:24px;text-align:left">
        <div style="font-size:16px;font-weight:700;color:#E8EDF5;margin-bottom:6px">Enter Activation Key</div>
        <p style="font-size:12px;color:#7B8CAA;margin-bottom:16px">Enter the activation key provided by IMS Company to unlock this app.</p>

        <input type="text" id="activationKeyInput"
          placeholder="e.g. BARMS-AB12-CD34-EF56"
          style="width:100%;padding:12px 14px;background:#1A2236;border:1.5px solid #1F2D45;border-radius:10px;color:#E8EDF5;font-size:14px;font-family:inherit;outline:none;box-sizing:border-box;text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px"
          oninput="this.value=this.value.toUpperCase()"
          onkeydown="if(event.key==='Enter')submitActivationKey()"
        />

        <div id="activationError" style="display:none;background:#FF4D6D22;border:1px solid #FF4D6D44;border-radius:8px;padding:10px 12px;color:#FF4D6D;font-size:12px;margin-bottom:12px"></div>

        <button id="activateBtn" onclick="submitActivationKey()" style="width:100%;padding:13px;border-radius:10px;border:none;background:linear-gradient(135deg,#1E3A8A,#2563EB);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 4px 20px rgba(30,58,138,0.4)">
          Activate BarMS Pro →
        </button>

        <div style="margin-top:14px;padding-top:14px;border-top:1px solid #1F2D45;font-size:11px;color:#4A5568;text-align:center">
          Don't have a key? Contact IMS Company to subscribe.
        </div>
      </div>

      <!-- IMS URL setting -->
      <div style="margin-top:16px;background:#111827;border:1px solid #1F2D45;border-radius:12px;padding:14px;text-align:left">
        <div style="font-size:11px;font-weight:700;color:#7B8CAA;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">IMS Server URL</div>
        <input type="text" id="imsUrlSetup" placeholder="http://localhost/ims"
          style="width:100%;padding:9px 12px;background:#1A2236;border:1px solid #1F2D45;border-radius:8px;color:#E8EDF5;font-size:12px;font-family:inherit;outline:none;box-sizing:border-box"
        />
        <div style="font-size:10px;color:#4A5568;margin-top:4px">Change only if IMS is on a different server</div>
      </div>

      <div style="margin-top:16px;font-size:11px;color:#4A5568">BarMS Pro v1.0 — Powered by IMS Company</div>
    </div>
  `;

  document.body.appendChild(screen);

  // Load saved IMS URL
  getImsUrl().then(url => {
    const el = document.getElementById('imsUrlSetup');
    if (el) el.value = url;
  });
}

// ── SUBMIT ACTIVATION KEY ─────────────────────────
async function submitActivationKey() {
  const key    = (document.getElementById('activationKeyInput')?.value || '').trim();
  const imsUrl = (document.getElementById('imsUrlSetup')?.value || '').trim();
  const errEl  = document.getElementById('activationError');
  const btn    = document.getElementById('activateBtn');

  if (!key) {
    if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Please enter your activation key'; }
    return;
  }

  // Save IMS URL if changed
  if (imsUrl) await dbPut('settings', { key: 'ims_url', value: imsUrl });

  // Show loading
  if (btn) { btn.textContent = 'Activating...'; btn.disabled = true; }
  if (errEl) errEl.style.display = 'none';

  const result = await activateWithKey(key);

  if (result.ok) {
    if (btn) btn.textContent = 'Activated!';
    // Brief success message then unlock
    setTimeout(async () => {
      hideLockScreen();
      // Show login screen
      const loginWrap = document.getElementById('loginWrap');
      if (loginWrap) loginWrap.style.display = 'flex';
      // Show toast
      if (typeof toast === 'function') {
        toast(`Activated! Welcome to ${result.barName} — ${result.plan} (${result.daysLeft} days)`, 'success');
      }
    }, 800);
  } else {
    if (btn) { btn.textContent = 'Activate BarMS Pro →'; btn.disabled = false; }
    if (errEl) { errEl.style.display = 'block'; errEl.textContent = '' + result.error; }
  }
}

// ── SHOW LOCK SCREEN (expired/suspended) ──────────
function showLockScreen(reason, payload) {
  hideApp();
  removeExisting('imsLockScreen');

  const msgs = {
    subscription_ended: { icon:'', title:'Subscription Ended',    msg:'Your subscription has ended. Contact IMS Company to renew.', color:'#FF4D6D' },
    grace_expired:      { icon:'', title:'System Locked',          msg:'No internet for too long. Connect to internet to unlock.', color:'#FF4D6D' },
    suspended:          { icon:'', title:'Account Suspended',      msg:'Your subscription has been suspended. Contact IMS Company.', color:'#FF8C42' },
    device_blocked:     { icon:'', title:'Device Blocked',         msg:'This device has been blocked by IMS Company. Contact support.', color:'#FF4D6D' },
    no_subscription:    { icon:'', title:'No Active Subscription', msg:'No active subscription found. Contact IMS Company to subscribe.', color:'#FF8C42' },
  };
  const m = msgs[reason] || msgs.subscription_ended;

  const screen = document.createElement('div');
  screen.id = 'imsLockScreen';
  screen.style.cssText = 'position:fixed;inset:0;z-index:99999;background:linear-gradient(135deg,#0A0F1E,#0D1321,#111827);display:flex;align-items:center;justify-content:center;font-family:\'DM Sans\',sans-serif';

  const subEnd = payload?.subscriptionEnd
    ? new Date(payload.subscriptionEnd * 1000).toLocaleDateString('en-RW', { day:'2-digit', month:'long', year:'numeric' })
    : '—';

  screen.innerHTML = `
    <div style="text-align:center;max-width:420px;width:90%;padding:32px 24px">
      <div style="width:80px;height:80px;border-radius:50%;background:${m.color}22;border:2px solid ${m.color}44;display:flex;align-items:center;justify-content:center;font-size:36px;margin:0 auto 20px;box-shadow:0 0 40px ${m.color}33;animation:lockPulse 2s infinite">${m.icon}</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:16px"><span style="font-size:20px"></span><span style="font-size:17px;font-weight:800;color:#E8EDF5">BarMS Pro</span></div>
      <h2 style="font-size:22px;font-weight:800;color:${m.color};margin-bottom:8px">${m.title}</h2>
      <p style="font-size:13px;color:#7B8CAA;margin-bottom:20px">${m.msg}</p>

      <div style="background:#111827;border:1px solid #1F2D45;border-radius:12px;padding:16px;margin-bottom:20px;text-align:left">
        <div style="font-size:10px;font-weight:700;color:#7B8CAA;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Subscription Details</div>
        ${payload?.barName ? `<div style="font-size:13px;color:#E8EDF5;margin-bottom:4px">${payload.barName}</div>` : ''}
        ${payload?.plan ? `<div style="font-size:12px;color:#7B8CAA;margin-bottom:4px">Plan: ${payload.plan}</div>` : ''}
        <div style="font-size:12px;color:#7B8CAA">Expired: ${subEnd}</div>
      </div>

      <button onclick="retryAfterLock()" style="width:100%;padding:13px;border-radius:10px;border:none;background:${m.color};color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">
        Try Again
      </button>
      <button onclick="showActivationScreen()" style="width:100%;padding:11px;border-radius:10px;border:1px solid #1F2D45;background:none;color:#7B8CAA;font-size:13px;cursor:pointer;font-family:inherit">
        Enter New Activation Key
      </button>
      <div style="margin-top:16px;font-size:11px;color:#4A5568">BarMS Pro — Powered by IMS Company</div>
    </div>
    <style>@keyframes lockPulse{0%,100%{box-shadow:0 0 40px ${m.color}33}50%{box-shadow:0 0 60px ${m.color}66}}</style>
  `;

  document.body.appendChild(screen);
}

// ── SHOW/HIDE EXPIRY WARNING BANNER ──────────────
function showExpiryWarning(message, isUrgent) {
  removeExisting('licenseWarningBanner');
  const banner = document.createElement('div');
  banner.id = 'licenseWarningBanner';
  const color = isUrgent ? '#FF4D6D' : '#FF8C42';
  banner.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:9998;background:${color};color:#fff;padding:9px 16px;display:flex;align-items:center;gap:12px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;box-shadow:0 4px 16px ${color}66`;
  banner.innerHTML = `<span style="flex:1">${message}</span><button onclick="document.getElementById('licenseWarningBanner').remove()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit">✕</button>`;
  document.body.appendChild(banner);
}

function hideExpiryWarning() {
  removeExisting('licenseWarningBanner');
}

// ── HELPERS ───────────────────────────────────────
function hideApp() {
  const appShell  = document.getElementById('appShell');
  const loginWrap = document.getElementById('loginWrap');
  if (appShell)  appShell.style.display  = 'none';
  if (loginWrap) loginWrap.style.display = 'none';
}

function hideLockScreen() {
  removeExisting('imsLockScreen');
}

function removeExisting(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

async function retryAfterLock() {
  if (navigator.onLine) {
    const renewed = await renewLicense();
    if (renewed) {
      const valid = await checkLicense();
      if (valid) {
        hideLockScreen();
        const loginWrap = document.getElementById('loginWrap');
        if (loginWrap) loginWrap.style.display = 'flex';
      }
    } else {
      await checkLicense();
    }
  } else {
    await checkLicense();
  }
}

// ── INIT LICENSE SYSTEM ────────────────────────────
async function initLicenseSystem() {
  console.log('[License] Starting license system...');

  // ALWAYS contact IMS first on startup if online
  // This ensures suspensions and blocks take effect immediately
  if (navigator.onLine) {
    console.log('[License] Online — checking with IMS server on startup...');
    const renewed = await renewLicense();
    // renewLicense handles suspension/block internally
    // It clears the token if suspended, then checkLicense shows lock screen
  }

  // Now check local license (will lock if IMS cleared it above)
  const valid = await checkLicense();

  // Check every 30 minutes when online
  setInterval(async () => {
    if (navigator.onLine) {
      await renewLicense();
      await checkLicense();
    }
  }, 30 * 60 * 1000); // 30 minutes

  // Full 24hr check (even offline)
  setInterval(async () => {
    console.log('[License] 24hr check...');
    await checkLicense();
  }, LICENSE_CHECK_INTERVAL);

  // Renew immediately when internet returns
  window.addEventListener('online', async () => {
    console.log('[License] Online — checking license...');
    await renewLicense();
    await checkLicense();
  });
}
