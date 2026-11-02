/* ═══════════════════════════════════════════════════
   BARMS PRO — offline.js
   Offline mode foundation (only on the two devices the Owner
   chose in Settings → Offline devices):
   - main device: any staff except Kitchen; owner device: Owner only
   - offline sign-in: checked against a PBKDF2 hash saved at the
     last ONLINE sign-in of that person on this device
   - each person's offline token (from auth.php action=token) sends
     the records they made offline, even when nobody is signed in
   - clock correction from the server's Date header
   - last copy of server answers, used when there is no internet
   Load after api.js and tenant.js, before auth.js and sync.js.
═══════════════════════════════════════════════════ */

const OFFLINE_PBKDF2_ITER = 150000;
const OFFLINE_USER_PREFIX = 'offline_user:';
// reads not kept offline: large Owner reports, always fetched fresh online
const OFFLINE_NO_CACHE = ['reports', 'health'];
// the same for everyone on the device (what selling needs): one copy, so any staff member who
// signs in offline has them, even if they never opened those screens themselves
const OFFLINE_SHARED = ['bar-inventory|items_list', 'kitchen2|menu_list', 'sessions|list_tables', 'sessions|bar_info',
                        'discounts|offline_rules', 'orders|list', 'orders|get',
                        'bar-inventory|ingredients_list', 'kitchen2|ingredients_list', 'stockcount|sheet', 'suppliers|list'];

let _offlineRole;            // 'main' | 'owner' | null (undefined = not loaded yet)
let _clockOffsetMs = 0;
try { _clockOffsetMs = +localStorage.getItem('barms_clock_offset') || 0; } catch (e) {}

// ── DEVICE ROLE ───────────────────────────────────
async function offlineRole() {
  if (_offlineRole !== undefined) return _offlineRole;
  try { _offlineRole = (await dbGet('settings', 'offline_role'))?.value || null; } catch (e) { _offlineRole = null; }
  return _offlineRole;
}

async function offlineSetRole(role) {
  _offlineRole = role || null;
  try { await dbPut('settings', { key: 'offline_role', value: _offlineRole }); } catch (e) {}
  if (!_offlineRole) await offlineForgetUsers();
}

function offlineRoleAllows(role, userRole) {
  if (role === 'main')  return userRole !== 'Kitchen';
  if (role === 'owner') return userRole === 'Owner';
  return false;
}

// ── CLOCK ─────────────────────────────────────────
// The device clock may be wrong; offline records are stamped with the corrected time.
function offlineClockFrom(res) {
  try {
    const d = Date.parse(res.headers.get('Date') || '');
    if (!d) return;
    const off = d - Date.now();
    // the header has 1 s resolution: ignore tiny differences
    _clockOffsetMs = Math.abs(off) < 2000 ? 0 : off;
    localStorage.setItem('barms_clock_offset', String(_clockOffsetMs));
  } catch (e) {}
}

function offlineNow() { return Date.now() + _clockOffsetMs; }

// who made a queued record and when (added to every sync_queue item)
function offlineStamp() {
  const s = typeof session !== 'undefined' ? session : {};
  return { userId: s.userId || 0, username: s.username || '', at: offlineNow() };
}

// ── PASSWORD CHECK (PBKDF2-SHA256, WebCrypto) ─────
function _offB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function _offUnB64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

async function _offHash(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
}

function offlineSupported() { return !!(window.crypto && crypto.subtle && window.indexedDB); }

// After an ONLINE sign-in: remember this person for offline use on this device, or forget them
async function offlineAfterLogin(user, password, tokenRes) {
  // no real answer (connection dropped, server error): change nothing on this device
  if (!tokenRes || !('offlineRole' in tokenRes)) return;
  try {
    await offlineSetRole(tokenRes.offlineRole);
    const key = OFFLINE_USER_PREFIX + user.username;
    if (!tokenRes.ok || !offlineRoleAllows(_offlineRole, user.role)) {
      await dbDelete('auth', key).catch(() => {});
      return;
    }
    // the token first: the server has just replaced this person's old one
    const rec = { key, userId: user.id, username: user.username, fullName: user.fullName, role: user.role, token: tokenRes.token, savedAt: Date.now() };
    await dbPut('auth', rec);
    if (!offlineSupported()) return;   // records still sync; signing in offline is not possible here
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await _offHash(password, salt, OFFLINE_PBKDF2_ITER);
    await dbPut('auth', { ...rec, salt: _offB64(salt), hash: _offB64(hash), iter: OFFLINE_PBKDF2_ITER });
  } catch (e) { console.warn('[Offline] Could not save offline sign-in:', e.message); }
}

async function offlineForgetUsers() {
  try {
    const all = await dbGetAll('auth');
    for (const r of all) if (String(r.key).startsWith(OFFLINE_USER_PREFIX)) await dbDelete('auth', r.key);
  } catch (e) {}
}

async function offlineUser(username) {
  try { return await dbGet('auth', OFFLINE_USER_PREFIX + username); } catch (e) { return null; }
}

// Sign in without internet → { ok, user } or { ok:false, error }
async function offlineSignIn(username, password) {
  const role = await offlineRole();
  if (!role) return { ok: false, error: 'No internet. This device is not set up to work offline — use the main device.' };
  if (!offlineSupported()) return { ok: false, error: 'No internet, and this browser cannot sign in offline.' };
  const rec = await offlineUser(username);
  if (!rec) return { ok: false, error: 'No internet. You can sign in offline only after signing in once online on this device.' };
  if (!offlineRoleAllows(role, rec.role)) return { ok: false, error: 'No internet. This device works offline only for ' + (role === 'owner' ? 'the Owner.' : 'bar staff.') };
  if (!rec.hash) return { ok: false, error: 'No internet, and this browser cannot sign in offline.' };
  const hash = await _offHash(password, _offUnB64(rec.salt), rec.iter || OFFLINE_PBKDF2_ITER);
  if (_offB64(hash) !== rec.hash) return { ok: false, error: 'Invalid credentials. Try again.' };
  return { ok: true, user: { id: rec.userId, username: rec.username, fullName: rec.fullName, role: rec.role } };
}

// ── SEND ONE QUEUED RECORD WITH ITS OWNER'S TOKEN ─
// Works with nobody signed in. → api-style answer; { noToken:true } when the person
// has no offline token on this device (the record then needs a normal session).
async function offlineSend(item, resource, action, payload) {
  const rec = item.username ? await offlineUser(item.username) : null;
  if (!rec || !rec.token) return { ok: false, noToken: true };
  if (!item.idemKey && !item.noIdem) {   // one key for every try of this record, so it is never saved twice
    // (a whole offline order has none: the server finds it again by its uuid and carries on)
    item.idemKey = typeof newRequestKey === 'function' ? newRequestKey() : (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    await dbPut('sync_queue', item).catch(() => {});
  }
  const at = item.at || Date.parse(item.timestamp) || offlineNow();
  try {
    const res = await fetch(`api/${resource}.php?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      // cookies are needed by the hosting's bot protection; the server uses the token, never
      // the session of whoever is signed in now
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Barms-Offline-Token': rec.token,
        'X-Barms-Offline-At': String(Math.round(at)),
        ...(item.idemKey ? { 'X-Idempotency-Key': item.idemKey } : {}),
      },
      body: JSON.stringify(payload),
    });
    offlineClockFrom(res);
    const data = await apiReadJson(res);
    if (res.status === 409 && data && data.inProgress) return { ok: false, network: true };   // still running: try later
    // the service worker answers {error:'offline'} when there is no connection
    if (data && data.error === 'offline' && !data.offlineRejected) return { ok: false, error: 'offline', network: true };
    // not our JSON (e.g. the hosting's bot check page) or a server error: try later
    if (data && (res.status >= 500 || data.server)) { data.server = true; data.httpStatus = res.status; }
    return data;
  } catch (e) {
    return { ok: false, error: 'Network error', network: true };
  }
}

// ── LAST COPY OF SERVER ANSWERS ───────────────────
// per person: a Bartender signed in offline never sees what the Owner loaded on this device
// (except the shared selling data above)
function _offCacheKey(resource, action, params) {
  const shared = OFFLINE_SHARED.includes(resource + '|' + action);
  const uid = shared ? 'all' : (typeof session !== 'undefined' ? session.userId || 0 : 0);
  return uid + '|' + resource + '|' + action + '|' + new URLSearchParams(params || {}).toString();
}

async function offlineCachePut(resource, action, params, data) {
  if (OFFLINE_NO_CACHE.includes(resource) || typeof session === 'undefined' || !session.userId || !(await offlineRole())) return;
  try { await dbPut('read_cache', { key: _offCacheKey(resource, action, params), data, savedAt: Date.now() }); } catch (e) {}
  // every date filter makes a new copy: now and then drop copies older than 30 days
  if (Math.random() < 0.02) {
    try {
      const old = Date.now() - 30 * 86400000;
      for (const r of await dbGetAll('read_cache')) if (r.savedAt < old) await dbDelete('read_cache', r.key);
    } catch (e) {}
  }
}

async function offlineCacheGet(resource, action, params) {
  if (!(await offlineRole())) return null;
  try {
    const rec = await dbGet('read_cache', _offCacheKey(resource, action, params));
    return rec ? { ...rec.data, offline: true, cachedAt: rec.savedAt } : null;
  } catch (e) { return null; }
}
