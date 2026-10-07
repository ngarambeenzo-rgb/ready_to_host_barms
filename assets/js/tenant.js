/* ═══════════════════════════════════════════════════
   BARMS PRO — tenant.js
   Which IMS client this BarMS is working for.
   • Every request to api/ carries X-Barms-Client + X-Barms-Device
     (the server accepts them only for a device IMS approved).
   • When a different activation key is entered, the offline
     copies on this device are wiped (sales waiting to sync too),
     so nothing of the previous client can reach the new one.
   • A brand-new client sees "Create the Owner account" instead
     of the sign-in form.
   Loaded right after license.js.
═══════════════════════════════════════════════════ */

let _tenantIds = null;
async function tenantIds(force) {
  if (_tenantIds && !force) return _tenantIds;
  try { _tenantIds = { clientId: await getClientId(), deviceUuid: await getDeviceUuid() }; }
  catch (e) { _tenantIds = { clientId: null, deviceUuid: null }; }
  return _tenantIds;
}

// add the client headers to every same-origin api/ call
(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const ours = /^(\.\/)?api\//.test(url) || url.startsWith(location.origin + location.pathname.replace(/[^/]*$/, '') + 'api/');
    if (!ours) return _fetch(input, init);
    const ids = await tenantIds();
    init = Object.assign({}, init || {});
    const h = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
    if (ids.clientId) h.set('X-Barms-Client', String(ids.clientId));
    if (ids.deviceUuid) h.set('X-Barms-Device', String(ids.deviceUuid));
    init.headers = h;
    const res = await _fetch(input, init);
    if (res.status === 401) {
      res.clone().json().then(j => { if (j && j.tenantChanged) tenantSignedOut(j); }).catch(() => {});
    }
    return res;
  };
})();

function tenantSignedOut(j) {
  if (j.csrf && typeof setCsrfToken === 'function') setCsrfToken(j.csrf);
  try { if (typeof session !== 'undefined') session = { userId: 0, username: '', role: '', fullName: '' }; } catch (e) {}
  const app = document.getElementById('appShell'), login = document.getElementById('loginWrap');
  if (app && app.style.display !== 'none') { app.style.display = 'none'; if (login) login.style.display = ''; tenantCheckSetup(); }
}

// wipe this device's offline copies of the previous client
async function tenantWipeLocal() {
  for (const store of ['products', 'sync_queue', 'cache_meta']) {
    try {
      const db = await openDB();
      await new Promise(res => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).clear(); tx.oncomplete = res; tx.onerror = res; });
    } catch (e) {}
  }
  try { Object.keys(localStorage).filter(k => /^barms_(?!theme|lang|sound|sb_min)/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (e) {}
}

// when a key is activated: if it belongs to another client, start clean
if (typeof saveLicense === 'function') {
  const _saveLicense = saveLicense;
  saveLicense = async function (token, clientId, barName) {
    const before = await getClientId().catch(() => null);
    const r = await _saveLicense.apply(this, arguments);
    if (clientId && before && +before !== +clientId) {
      await tenantWipeLocal();
      try { await fetch('api/auth.php?action=logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': getCsrfToken() } }); } catch (e) {}
      _tenantIds = null;
      setTimeout(() => location.reload(), 300);   // reload as the new client
    }
    _tenantIds = null;
    return r;
  };
}

// ── NEW CLIENT: create the Owner account ───────────
async function tenantCheckSetup() {
  try {
    const r = await (await fetch('api/auth.php?action=setup_status', { credentials: 'same-origin' })).json();
    if (r.ok && r.needsOwner) tenantShowSetup(r.barName);
  } catch (e) {}
}
function tenantShowSetup(barName) {
  const card = document.querySelector('#loginWrap .login-card');
  if (!card || document.getElementById('setupForm')) return;
  const form = card.querySelector('.form-group')?.parentElement;
  card.querySelectorAll(':scope > .form-group, #loginErr, #loginBtn').forEach(el => el.style.display = 'none');
  const box = document.createElement('div');
  box.id = 'setupForm';
  box.innerHTML = `
    <div class="setup-intro"><b>Welcome${barName ? ', ' + esc(barName) : ''}!</b>
      <span>This BarMS is new and has no data yet. Create the Owner account — you will use it to sign in and to add your staff.</span></div>
    <div class="form-group"><label class="form-label">Your full name</label><input class="form-input" id="suName" autocomplete="off" placeholder="e.g. Jean Mugisha"/></div>
    <div class="form-group"><label class="form-label">Username</label><input class="form-input" id="suUser" autocomplete="off" autocapitalize="none" placeholder="lowercase, no spaces"/></div>
    <div class="form-group"><label class="form-label">Password</label><input class="form-input" type="password" id="suPass" autocomplete="new-password" placeholder="at least 6 characters"/></div>
    <div class="form-group"><label class="form-label">Repeat password</label><input class="form-input" type="password" id="suPass2" autocomplete="new-password"/></div>
    <div id="suErr" class="form-error" style="display:none;margin:-4px 0 12px"></div>
    <button class="btn btn-primary btn-lg btn-block" id="suBtn" onclick="tenantCreateOwner()">Create Owner account</button>`;
  const anchor = card.querySelector('.login-ims');
  card.insertBefore(box, anchor || null);
}
async function tenantCreateOwner() {
  const v = id => document.getElementById(id).value;
  const err = document.getElementById('suErr'), btn = document.getElementById('suBtn');
  const fail = m => { err.textContent = m; err.style.display = 'flex'; };
  const name = v('suName').trim(), user = v('suUser').trim().toLowerCase(), pass = v('suPass');
  if (pass !== v('suPass2')) return fail('The two passwords are different');
  uiBusy(btn, true);
  const res = await api('auth', 'setup_owner', { fullName: name, username: user, password: pass });
  uiBusy(btn, false);
  if (!res.ok) return fail(res.error || 'Could not create the account');
  // put the normal sign-in form back and sign straight in with the new account
  document.getElementById('setupForm').remove();
  document.querySelectorAll('#loginWrap .login-card > .form-group, #loginBtn').forEach(el => el.style.display = '');
  const u = document.getElementById('loginUser'), p = document.getElementById('loginPass');
  u.removeAttribute('readonly'); p.removeAttribute('readonly');
  u.value = user; p.value = pass;
  toast('Owner account created', 'success');
  doLogin();
}

// check whenever the sign-in screen appears
document.addEventListener('DOMContentLoaded', () => {
  const lw = document.getElementById('loginWrap');
  if (!lw) return;
  let shown = false;
  new MutationObserver(() => {
    const vis = lw.style.display !== 'none';
    if (vis && !shown) tenantCheckSetup();
    shown = vis;
  }).observe(lw, { attributes: true, attributeFilter: ['style'] });
  if (lw.style.display !== 'none') tenantCheckSetup();
});
