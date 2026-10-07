// ============================================================
//  BarMS Pro — api.js
//  Core fetch wrapper for all backend API calls
// ============================================================

function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.getAttribute('content') : '';
}

const USER_ACTIVITY_WINDOW_MS = 60 * 1000;
window.__barmsLastUserActivity = Date.now();
['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(eventName => {
  window.addEventListener(eventName, () => {
    window.__barmsLastUserActivity = Date.now();
  }, { passive: true });
});

function getUserActivityHeaders() {
  return Date.now() - window.__barmsLastUserActivity <= USER_ACTIVITY_WINDOW_MS
    ? { 'X-User-Activity': '1' }
    : {};
}

// GET requests — reads (list, history, etc.)
// A reply that is not JSON means the server crashed: say so, instead of "Network error"
async function apiReadJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch (e) { return { ok: false, error: `The server had a problem (error ${res.status}). Try again; if it keeps happening, check the server error log.`, server: true }; }
}
// Reads give up after 25 s, so a hung server never leaves the screen spinning for ever.
// network: true = the server could not be reached (callers may fall back to offline data).
const API_GET_TIMEOUT_MS = 25000;
// A read changes nothing, so it is retried once (1.5 s later) when the connection
// dropped or the server was briefly busy (502/503/504).
async function apiGet(resource, action, params = {}) {
  const first = await apiGetOnce(resource, action, params);
  if (first.ok || !(first.network || [502, 503, 504].includes(first.status)) || first.timeout || navigator.onLine === false) return first;
  await new Promise(r => setTimeout(r, 1500));
  return apiGetOnce(resource, action, params);
}
async function apiGetOnce(resource, action, params = {}) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl && setTimeout(() => ctrl.abort(), API_GET_TIMEOUT_MS);
  try {
    const query = new URLSearchParams({ action, ...params }).toString();
    const res = await fetch(`api/${resource}.php?${query}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: getUserActivityHeaders(),
      signal: ctrl ? ctrl.signal : undefined,
    });
    const data = await apiReadJson(res);
    if (data && typeof data === 'object' && !data.ok && res.status >= 500) data.status = res.status;
    return data;
  } catch (e) {
    console.warn('[API] GET error:', resource, action, e.message);
    if (e.name === 'AbortError') return { ok: false, error: 'The server took too long to answer. Check the connection and try again.', network: true, timeout: true };
    return { ok: false, error: 'Network error', network: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// POST requests — writes (save, record, login, etc.)
function setCsrfToken(t) {
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta && t) meta.setAttribute('content', t);
}
async function refreshCsrfToken() {
  try {
    const r = await fetch('api/auth.php?action=csrf', { credentials: 'same-origin' });
    const j = await r.json();
    if (j.ok) setCsrfToken(j.csrf);
    return !!j.ok;
  } catch (e) { return false; }
}

// Writes (save, pay, record…). Each call gets one idempotency key and keeps it for
// its retries, so the server runs it once even when the answer was lost on the way.
//   connection lost / server busy (502-504) → retried after 1 s, 3 s, 6 s with the same key
//   still being saved (409 inProgress)       → asked again after a pause
//   no answer at all                         → "cannot confirm": the user checks before redoing it
function newRequestKey() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'k' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
const API_RETRY_DELAYS_MS = [1000, 3000, 6000];
async function api(resource, action, payload = {}, _retried = false, _key = null) {
  const key = _key || newRequestKey();
  let reached = false;   // did any attempt get an answer from the server?
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`api/${resource}.php?action=${encodeURIComponent(action)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
          'X-Idempotency-Key': key,
          ...getUserActivityHeaders(),
        },
        body: JSON.stringify(payload),
      });
      reached = true;
      if ([502, 503, 504].includes(res.status) && attempt < API_RETRY_DELAYS_MS.length) { await apiSleep(API_RETRY_DELAYS_MS[attempt]); continue; }
      const data = await apiReadJson(res);
      if (res.status === 409 && data && data.inProgress && attempt < API_RETRY_DELAYS_MS.length) { await apiSleep(API_RETRY_DELAYS_MS[attempt]); continue; }
      if (data && data.csrf) setCsrfToken(data.csrf);          // login / logout hand out a new token
      if (!_retried && res.status === 403 && /csrf/i.test((data && data.error) || '')) {
        // the token was refused before anything ran: a new key is fine
        if (await refreshCsrfToken()) return api(resource, action, payload, true);
      }
      return data;
    } catch (e) {
      console.warn('[API] POST error:', resource, action, `attempt ${attempt + 1}`, e.message);
      if (attempt < API_RETRY_DELAYS_MS.length && navigator.onLine !== false) { await apiSleep(API_RETRY_DELAYS_MS[attempt]); continue; }
      return reached || attempt > 0
        ? { ok: false, network: true, unconfirmed: true, error: 'The connection was lost, so BarMS cannot confirm this was saved. Check the list before trying again.' }
        : { ok: false, error: 'Network error', network: true };
    }
  }
}
function apiSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
