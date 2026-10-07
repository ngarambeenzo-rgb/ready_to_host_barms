/* ═══════════════════════════════════════════════════
   BARMS PRO — perms.js
   One place that turns the Owner's manager permissions into
   what a manager sees:
     • sidebar items and pages appear only when allowed
     • buttons tagged data-perm="canX" disappear when not allowed
       (works for content drawn later too — it is pure CSS)
     • permissions are re-read every 45 s, so a change by the
       Owner reaches managers without signing out
   The server checks the same permissions on every action
   (requirePerm in config/db.php); this file only keeps the
   screen honest.
   Loaded after auth.js and ui.js.
═══════════════════════════════════════════════════ */

const PERM_KEYS = ['canViewReports', 'canEditStock', 'canManageItems', 'canViewEmployees', 'canPaySalaries', 'canViewAudit',
  'canRecordExpenses', 'canVoidExpenses', 'canApproveVoids', 'canGiveRefunds', 'canGiveDiscounts', 'canDeleteRecords',
  'canManageUsers', 'canEditSettings'];

// For a manager, a page is shown when ANY of its permissions is granted.
// Pages not listed here follow the role lists in auth.js.
const MGR_PAGE_PERMS = {
  'reports': ['canViewReports'], 'charts': ['canViewReports'], 'advanced-reports': ['canViewReports'],
  'employees': ['canViewEmployees'], 'audit': ['canViewAudit'], 'expenses': ['canRecordExpenses'],
  'suppliers': ['canEditStock'], 'stock-count': ['canEditStock'], 'bar-movements': ['canEditStock', 'canViewReports'],
  'bar-items': ['canManageItems', 'canEditStock'], 'bar-ingredients': ['canManageItems', 'canEditStock'],
  'kitchen-ingredients': ['canManageItems', 'canEditStock'], 'kitchen-menu': ['canManageItems'], 'kitchen-recipes': ['canManageItems'],
  'voidreqs': ['canApproveVoids', 'canGiveRefunds'],
  'stock': ['canEditStock'], 'products': ['canManageItems'],
};

function mgrPageAllowed(pageId, perms) {
  const need = MGR_PAGE_PERMS[pageId];
  if (!need) return (ROLE_PAGES.Manager || []).includes(pageId);
  return (ROLE_PAGES.Manager || []).concat(['stock', 'products']).includes(pageId) && need.some(p => perms[p]);
}

// page access (used by showPage)
canAccessPage = async function (pageId) {
  const allowed = ROLE_PAGES[session.role] || [];
  if (session.role === 'Manager') return mgrPageAllowed(pageId, await getMgrPerms());
  return allowed.includes(pageId);
};

// body classes no-canX hide every [data-perm~="canX"] element
function permApplyBodyClasses() {
  PERM_KEYS.forEach(p => document.body.classList.toggle('no-' + p, !can(p)));
}

async function permApplyNav() {
  if (session.role !== 'Manager') { permApplyBodyClasses(); return; }
  const perms = await getMgrPerms();
  document.querySelectorAll('.nav-item[id^="nav-"]').forEach(el => {
    const id = el.id.replace('nav-', '');
    if (!(ROLE_NAV.Manager || []).includes(el.id)) return;   // already hidden by role
    el.style.display = mgrPageAllowed(id, perms) ? '' : 'none';
  });
  permApplyBodyClasses();
  if (typeof uiSyncShell === 'function') uiSyncShell();
}

// run after the normal role setup
if (typeof applyRoleAccess === 'function') {
  const _permRole = applyRoleAccess;
  applyRoleAccess = async function () { const r = await _permRole.apply(this, arguments); await permApplyNav(); return r; };
}

// keep managers in step with the Owner's changes
let _permSig = '';
setInterval(async () => {
  if (typeof session === 'undefined' || session.role !== 'Manager') return;
  if (document.getElementById('appShell')?.style.display === 'none') return;
  _mgrPerms = null;
  const perms = await getMgrPerms();
  const sig = PERM_KEYS.map(k => perms[k] ? 1 : 0).join('');
  if (_permSig && sig !== _permSig) {
    await permApplyNav();
    const act = document.querySelector('.page.active');
    const id = act && act.id.replace('page-', '');
    if (id && !mgrPageAllowed(id, perms)) { showPage('dashboard'); }
    toast(currentLang === 'fr' ? 'Le propriétaire a modifié vos accès' : 'The Owner changed your access', 'info');
  }
  _permSig = sig;
}, 45000);

// the Owner's own save: reset caches so the change shows at once on this device too
document.addEventListener('DOMContentLoaded', () => {   // settings.js loads after this file
  if (typeof saveMgrPerms !== 'function') return;
  const _permSave = saveMgrPerms;
  saveMgrPerms = async function () { const r = await _permSave.apply(this, arguments); _mgrPerms = null; return r; };
});
