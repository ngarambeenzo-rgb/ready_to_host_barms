/* ═══════════════════════════════════════════════════
   BARMS PRO — ui.js
   Shared interaction layer: toasts, modal enter/exit, sidebar
   indicator + collapse, boot hand-off, payment confirmation,
   button states, number tweening, sound preference.
   Loaded after utils.js / navigation.js so it can wrap them.
   Never changes business logic — only presentation.
═══════════════════════════════════════════════════ */

const UI_REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const EMOJI_RE = /(?:[\u{1F1E6}-\u{1F1FF}]{2}|[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}\u{2718}-\u{27BF}\u{2B00}-\u{2BFF}\u{231A}-\u{23FF}])[\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]*\s?/gu;
function stripEmoji(s) { return String(s == null ? '' : s).replace(EMOJI_RE, '').trim(); }

// ── TOASTS ─────────────────────────────────────────
// Same signature as before: toast(msg, 'success'|'error'|'warning'|'info')
const TOAST_ICON = { success: 'checkcircle', error: 'alertcircle', warning: 'alert', info: 'info' };
function toast(msg, type = 'success') {
  let region = document.getElementById('toastRegion');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toastRegion';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  if (!TOAST_ICON[type]) type = 'info';
  const el = document.createElement('div');
  el.className = `tst ${type}`;
  el.innerHTML = `${ic(TOAST_ICON[type])}<span class="tst-msg"></span><button class="tst-x" aria-label="Dismiss">${ic('x')}</button>`;
  el.querySelector('.tst-msg').textContent = stripEmoji(msg);
  const kill = () => { if (el._gone) return; el._gone = 1; el.classList.add('out'); setTimeout(() => el.remove(), 170); };
  el.querySelector('.tst-x').onclick = kill;
  region.appendChild(el);
  while (region.children.length > 4) region.firstElementChild.remove();
  setTimeout(kill, type === 'error' ? 5200 : 3200);
}

// Server alerts (low stock, kitchen ready…) — same queue, cleaner card
function _nextPopup() {
  if (!_popupQueue.length || document.getElementById('appShell')?.style.display === 'none') { _popupQueue = []; _popupShowing = false; return; }
  _popupShowing = true;
  const { text, type } = _popupQueue.shift();
  const map = { warning: 'warning', fraud: 'error', error: 'error', success: 'success' };
  toast(text, map[type] || 'info');
  setTimeout(_nextPopup, 3600);
}

// ── MODAL: animated close ──────────────────────────
function closeModal() {
  const o = document.getElementById('modalOverlay');
  if (!o || !o.classList.contains('show')) return;
  if (UI_REDUCED) { o.classList.remove('show'); return; }
  o.classList.add('closing');
  setTimeout(() => { o.classList.remove('show', 'closing'); }, 160);
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const o = document.getElementById('modalOverlay');
    if (o && o.classList.contains('show')) closeModal();
  }
  // "/" or Ctrl+K opens search (not while typing)
  const typing = /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || '')) || e.target.isContentEditable;
  if (!typing && ((e.key === '/' ) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'))) {
    if (document.getElementById('appShell')?.style.display !== 'none' && typeof showSearch === 'function') { e.preventDefault(); showSearch(); }
  }
});

// ── SIDEBAR: gliding active indicator ──────────────
function uiMoveNavIndicator() {
  const nav = document.querySelector('.sidebar-nav');
  const ind = document.getElementById('navIndicator');
  if (!nav || !ind) return;
  const act = nav.querySelector('.nav-item.active');
  if (!act || act.offsetParent === null) { ind.classList.remove('on'); return; }
  ind.style.transform = `translateY(${act.offsetTop}px)`;
  ind.style.height = act.offsetHeight + 'px';
  ind.classList.add('on');
}
function uiToggleSidebarMin() {
  document.body.classList.toggle('sb-min');
  try { localStorage.setItem('barms_sb_min', document.body.classList.contains('sb-min') ? '1' : '0'); } catch (e) {}
  setTimeout(uiMoveNavIndicator, 210);
}
try { if (localStorage.getItem('barms_sb_min') === '1') document.body.classList.add('sb-min'); } catch (e) {}

// Wrap showPage so every navigation updates the indicator and scrolls to top
if (typeof showPage === 'function') {
  const _uiShowPage = showPage;
  showPage = async function (id) {
    const r = await _uiShowPage.apply(this, arguments);
    requestAnimationFrame(uiMoveNavIndicator);
    const c = document.getElementById('mainContent');
    if (c) c.scrollTop = 0;
    return r;
  };
}
window.addEventListener('resize', () => requestAnimationFrame(uiMoveNavIndicator));

// ── BOOT HAND-OFF ──────────────────────────────────
(function uiBoot() {
  const boot = document.getElementById('boot');
  if (!boot) return;
  const seen = (() => { try { return sessionStorage.getItem('barms_booted') === '1'; } catch (e) { return false; } })();
  const minMs = UI_REDUCED ? 0 : (seen ? 180 : 720);
  const t0 = window.__bootT0 || performance.now();
  const finish = () => {
    const status = boot.querySelector('.boot-status');
    if (status) status.textContent = currentLang === 'fr' ? 'Prêt' : 'Ready';
    setTimeout(() => {
      boot.classList.add('done');
      setTimeout(() => boot.remove(), 260);
      uiMoveNavIndicator();
    }, seen ? 0 : 120);
    try { sessionStorage.setItem('barms_booted', '1'); } catch (e) {}
  };
  const go = () => setTimeout(finish, Math.max(0, minMs - (performance.now() - t0)));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  setTimeout(() => { if (document.getElementById('boot')) finish(); }, 2500); // never block the app
})();

// ── BUTTON STATES ──────────────────────────────────
// uiBusy(btn, true) → spinner; uiBusy(btn, false, 'done') → brief green confirmation
function uiBusy(btn, on, result) {
  if (!btn) return;
  if (on) { btn.classList.add('is-loading'); btn.setAttribute('aria-busy', 'true'); return; }
  btn.classList.remove('is-loading'); btn.removeAttribute('aria-busy');
  if (result === 'done') { btn.classList.add('is-done'); setTimeout(() => btn.classList.remove('is-done'), 900); }
}

// ── NUMBERS: short tween so totals visibly update ──
function uiTween(el, to, fmt, ms = 220) {
  if (!el) return;
  fmt = fmt || (v => fmtRWF(Math.round(v)));
  const from = +el.dataset.val || 0;
  el.dataset.val = to;
  if (UI_REDUCED || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function uiFlash(el) { if (!el || UI_REDUCED) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

// ── SOUND PREFERENCE ───────────────────────────────
function uiSoundOn() { try { return localStorage.getItem('barms_sound') !== '0'; } catch (e) { return true; } }
function uiSetSound(on) {
  try { localStorage.setItem('barms_sound', on ? '1' : '0'); } catch (e) {}
  const b = document.getElementById('soundBtn');
  if (b) { b.innerHTML = ic(on ? 'sound' : 'mute') + `<span>${on ? 'Sound on' : 'Sound off'}</span><span class="tb-mi-hint">${on ? 'click to mute' : 'click to turn on'}</span>`; }
}
if (typeof playSound === 'function') {
  const _uiPlay = playSound;
  playSound = function (type) { if (uiSoundOn()) return _uiPlay(type); };
}
// Short two-note chime for a completed payment (quiet)
function uiChime() {
  if (!uiSoundOn()) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[880, 0], [1318.5, .09]].forEach(([f, t]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0, ctx.currentTime + t);
      g.gain.linearRampToValueAtTime(.12, ctx.currentTime + t + .01);
      g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + t + .28);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + .3);
    });
  } catch (e) {}
}

// ── PAYMENT CONFIRMATION ───────────────────────────
// uiPaymentSuccess({amount, method, sub}) — ~1.1s, click to skip, resolves when gone
function uiPaymentSuccess(o = {}) {
  return new Promise(res => {
    document.getElementById('paySuccess')?.remove();
    const el = document.createElement('div');
    el.id = 'paySuccess';
    el.setAttribute('role', 'alert');
    el.innerHTML = `<div class="ps-card">
      <div class="ps-check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <div class="ps-title">${currentLang === 'fr' ? 'Paiement reçu' : 'Payment received'}</div>
      ${o.amount != null ? `<div class="ps-amount">${fmtRWF(o.amount)}</div>` : ''}
      <div class="ps-sub"></div></div>`;
    el.querySelector('.ps-sub').textContent = o.sub || o.method || '';
    document.body.appendChild(el);
    uiChime();
    let done = false;
    const close = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => { el.remove(); res(); }, 200); };
    el.onclick = close;
    setTimeout(close, UI_REDUCED ? 700 : 1150);
  });
}

// ── EMPTY STATE helper ─────────────────────────────
function uiEmpty(icon, title, text, action) {
  return `<div class="empty">${ic(icon || 'inbox')}<div class="empty-title">${title}</div>${text ? `<div class="empty-text">${text}</div>` : ''}${action || ''}</div>`;
}

// ── ROLE ACCESS: tidy the shell after nav items are shown/hidden ──
function uiSyncShell() {
  document.querySelectorAll('.sb-section').forEach(sec => {
    if (sec.style.display === 'none') return;
    const any = [...sec.querySelectorAll('.nav-item')].some(n => n.style.display !== 'none');
    sec.classList.toggle('sb-empty', !any);
  });
  const oc = document.getElementById('nav-order-creation'), nb = document.getElementById('newOrderBtn');
  if (nb) nb.style.display = oc && oc.style.display !== 'none' ? '' : 'none';
  uiSetSound(uiSoundOn());
  requestAnimationFrame(uiMoveNavIndicator);
}
if (typeof applyRoleAccess === 'function') {
  const _uiRole = applyRoleAccess;
  applyRoleAccess = async function () { const r = await _uiRole.apply(this, arguments); uiSyncShell(); return r; };
}

// ── THE BARS MARK: one loading language everywhere ─
// Same three rising bars as the start-up screen.
function uiLoader(text) {
  return `<div class="ui-loader"><span class="ul-mark"><i></i><i></i><i></i></span><span class="ul-text">${text || 'Loading…'}</span></div>`;
}

// Short start-up style hand-off (after sign-in, sign-out). Never longer than ~0.7s.
function uiBootFlash(status, ms) {
  if (UI_REDUCED) return Promise.resolve();
  document.getElementById('bootFlash')?.remove();
  const el = document.createElement('div');
  el.id = 'bootFlash';
  el.innerHTML = `<div class="boot-inner"><div class="boot-mark">
      <svg class="brand-mark" viewBox="0 0 44 44"><rect class="lv" x="11" y="20" width="5" height="13" rx="1.5" fill="#fff" opacity=".55"/><rect class="lv" x="19.5" y="14" width="5" height="19" rx="1.5" fill="#fff" opacity=".8"/><rect class="lv" x="28" y="9" width="5" height="24" rx="1.5" fill="#fff"/></svg>
      <div class="boot-word">BarMS <span>Pro</span></div></div>
    <div class="boot-line"><i></i></div><div class="boot-status"></div>
    <div class="boot-ims"><span>by</span><span class="ims-logo on-dark"></span></div></div>`;
  el.querySelector('.boot-status').textContent = status || '';
  document.body.appendChild(el);
  return new Promise(res => setTimeout(() => {
    el.classList.add('done');
    setTimeout(() => { el.remove(); requestAnimationFrame(uiMoveNavIndicator); }, 230);
    res();
  }, ms || 640));
}

// Sign-in → short hand-off while the dashboard loads
if (typeof doLogin === 'function') {
  const _uiLogin = doLogin;
  doLogin = async function () {
    const btn = document.getElementById('loginBtn');
    uiBusy(btn, true);
    try { await _uiLogin.apply(this, arguments); } finally { uiBusy(btn, false); }
    if (document.getElementById('appShell')?.style.display === 'flex') {
      const first = String((typeof session !== 'undefined' && session && session.fullName) || '').split(' ')[0];
      uiBootFlash(first ? (currentLang === 'fr' ? `Bienvenue, ${first}` : `Welcome, ${first}`) : 'Ready');
    }
  };
}

// ── TOP PROGRESS LINE ──────────────────────────────
// Thin line under the top bar while data the user asked for is loading.
// Background polling (kitchen, sync, badges) does not trigger it.
let _uiLastAction = 0, _uiInflight = 0, _uiProgTimer = null;
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { _uiLastAction = performance.now(); }, true));
function _uiProg(on) {
  let bar = document.getElementById('topProgress');
  if (!bar) {
    const top = document.querySelector('.topbar');
    if (!top) return;
    bar = document.createElement('div');
    bar.id = 'topProgress';
    bar.innerHTML = '<i></i>';
    top.appendChild(bar);
  }
  clearTimeout(_uiProgTimer);
  if (on) { bar.classList.remove('done'); bar.classList.add('run'); }
  else {
    bar.classList.add('done');
    _uiProgTimer = setTimeout(() => bar.classList.remove('run', 'done'), 320);
  }
}
function _uiTrack(fn) {
  return async function () {
    const userAsked = performance.now() - _uiLastAction < 1200;
    if (userAsked) { _uiInflight++; if (_uiInflight === 1) _uiProg(true); }
    try { return await fn.apply(this, arguments); }
    finally { if (userAsked) { _uiInflight = Math.max(0, _uiInflight - 1); if (!_uiInflight) _uiProg(false); } }
  };
}
if (typeof apiGet === 'function') apiGet = _uiTrack(apiGet);
if (typeof api === 'function') api = _uiTrack(api);

// Sign-out → same hand-off back to the login screen
if (typeof doLogout === 'function') {
  const _uiLogout = doLogout;
  doLogout = async function () {
    _popupQueue = []; document.getElementById('toastRegion')?.remove();
    const flash = uiBootFlash(currentLang === 'fr' ? 'Déconnexion' : 'Signed out', 560);
    await _uiLogout.apply(this, arguments);
    return flash;
  };
}

// ── PRODUCT PHOTO EDITOR ───────────────────────────
// kind: 'bar' | 'kitchen'. Uses api/product_images.php (canManageItems).
function uiEditPhoto(kind, id, name, current, onDone) {
  const mc = document.getElementById('modalContent');
  mc.innerHTML = `
    <h3>Product photo</h3>
    <div class="ph-wrap">
      <div class="ph-preview" id="phPreview">${uiProductThumb({ name, image: current, kind })}</div>
      <div class="ph-side">
        <div class="ph-name"></div>
        <div class="form-hint">Use a clear photo of the real bottle, can or dish on a plain background. JPG, PNG or WebP, up to 3 MB.</div>
        <label class="btn btn-primary btn-sm ph-pick"><i>${ic('upload')}</i><span>${current ? 'Replace photo' : 'Upload photo'}</span>
          <input type="file" id="phFile" accept="image/jpeg,image/png,image/webp" hidden></label>
        ${current ? `<button class="btn btn-ghost btn-sm" id="phRemove">${ic('trash')}Remove</button>` : ''}
      </div>
    </div>`;
  mc.querySelector('.ph-name').textContent = name;
  document.getElementById('modalOverlay').classList.add('show');

  const finish = img => { closeModal(); if (typeof onDone === 'function') onDone(img); };
  document.getElementById('phFile').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { toast('Image is larger than 3 MB', 'error'); return; }
    const pick = mc.querySelector('.ph-pick');
    uiBusy(pick, true);
    const fd = new FormData();
    fd.append('kind', kind); fd.append('id', id); fd.append('file', file);
    try {
      const r = await fetch('api/product_images.php?action=upload', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': getCsrfToken(), ...getUserActivityHeaders() }, body: fd });
      const res = await r.json();
      uiBusy(pick, false);
      if (!res.ok) { toast(res.error || 'Upload failed', 'error'); return; }
      toast('Photo saved', 'success');
      finish(res.image);
    } catch (err) { uiBusy(pick, false); toast('Upload failed — check the connection', 'error'); }
  };
  const rm = document.getElementById('phRemove');
  if (rm) rm.onclick = async () => {
    if (!confirm('Remove this photo?')) return;
    const res = await fetch('api/product_images.php?action=remove', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken(), ...getUserActivityHeaders() }, body: JSON.stringify({ kind, id }) }).then(r => r.json()).catch(() => ({ ok: false }));
    if (!res.ok) { toast(res.error || 'Could not remove the photo', 'error'); return; }
    toast('Photo removed', 'info');
    finish(null);
  };
}
// Clickable thumbnail for lists (only staff who may manage items can change it)
function uiThumbButton(kind, item) {
  const p = { name: item.name, image: item.image, kind, productType: item.product_type, itemType: item.type };
  if (typeof can === 'function' && !can('canManageItems')) return uiProductThumb(p, 'sm');
  const args = [kind, +item.id, String(item.name), item.image || null].map(v => esc(JSON.stringify(v))).join(',');
  return `<button class="ph-thumb-btn" title="Change photo" aria-label="Change photo" onclick="uiEditPhoto(${args},()=>${kind === 'bar' ? 'loadBarItems()' : 'loadKitchenMenu()'})">${uiProductThumb(p, 'sm')}</button>`;
}

// ── TOP BAR "MORE" MENU ────────────────────────────
function uiToggleTbMenu(e) {
  if (e) e.stopPropagation();
  const m = document.getElementById('tbMenu'), b = document.getElementById('tbMoreBtn');
  const open = !m.classList.contains('open');
  m.classList.toggle('open', open);
  if (b) b.setAttribute('aria-expanded', open);
}
function uiCloseTbMenu() {
  document.getElementById('tbMenu')?.classList.remove('open');
  document.getElementById('tbMoreBtn')?.setAttribute('aria-expanded', 'false');
}
document.addEventListener('click', e => { if (!e.target.closest('.tb-more')) uiCloseTbMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') uiCloseTbMenu(); });

// ── DARK MODE ──────────────────────────────────────
// Stored per device (barms_theme). The <head> script applies it before first paint.
function uiTheme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
function uiApplyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('barms_theme', t); } catch (e) {}
  const fr = typeof currentLang !== 'undefined' && currentLang === 'fr';
  document.querySelectorAll('.theme-toggle').forEach(b => {
    b.innerHTML = ic(t === 'dark' ? 'sun' : 'moon');
    b.title = t === 'dark' ? (fr ? 'Mode clair' : 'Light mode') : (fr ? 'Mode sombre' : 'Dark mode');
    b.setAttribute('aria-label', b.title);
  });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#0E1022' : '#1E3A8A');
}
// Theme switch, like night falling (or dawn breaking): the whole page changes at once,
// nothing sweeps in from an edge. The browser snapshots the page (View Transitions);
// the old look dims (to dark) or brightens (to light) while the new one slowly settles in.
let _uiThemeBusy = false;
function uiToggleTheme(e) {
  if (_uiThemeBusy) return;
  const next = uiTheme() === 'dark' ? 'light' : 'dark';
  if (UI_REDUCED || !document.startViewTransition) { uiApplyTheme(next); return; }
  _uiThemeBusy = true;
  const toDark = next === 'dark';
  const vt = document.startViewTransition(() => uiApplyTheme(next));
  vt.ready.then(() => {
    const t = { duration: 480, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' };
    // the day fades into dusk / the night lifts
    document.documentElement.animate(
      { opacity: [1, 1, 0], filter: toDark ? ['brightness(1) saturate(1)', 'brightness(.62) saturate(.8)', 'brightness(.45) saturate(.7)'] : ['brightness(1)', 'brightness(1.25)', 'brightness(1.5)'], offset: [0, .45, 1] },
      { ...t, pseudoElement: '::view-transition-old(root)' });
    // the new look settles in
    document.documentElement.animate(
      { opacity: [0, .35, 1], filter: toDark ? ['brightness(1.3)', 'brightness(1.12)', 'brightness(1)'] : ['brightness(.7)', 'brightness(.88)', 'brightness(1)'], offset: [0, .45, 1] },
      { ...t, pseudoElement: '::view-transition-new(root)' });
  }).catch(() => {});
  vt.finished.finally(() => { _uiThemeBusy = false; });
}
uiApplyTheme(uiTheme());