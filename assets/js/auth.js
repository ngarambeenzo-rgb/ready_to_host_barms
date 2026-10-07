/* ═══════════════════════════════════════════════════
   BARMS PRO — auth.js
   Login, Logout, Session, Role Access
   Depends on: utils.js, api.js
═══════════════════════════════════════════════════ */

// ── SESSION ───────────────────────────────────────
let session={userId:0,username:'',role:'',fullName:''};
const SESSION_IDLE_TIMEOUT_MS=10*60*1000;
let _idleSessionTimer=null;

function startIdleSessionMonitor(){
  if(_idleSessionTimer)clearInterval(_idleSessionTimer);
  _idleSessionTimer=setInterval(()=>{
    if(!session.userId)return;
    const lastActivity=window.__barmsLastUserActivity||Date.now();
    if(Date.now()-lastActivity>=SESSION_IDLE_TIMEOUT_MS){
      toast('Signed out after 10 minutes of inactivity','warning');
      doLogout();
    }
  },5000);
}

// ── ROLE DEFINITIONS ──────────────────────────────
const ROLE_PAGES={
  Owner:    ['dashboard','order-creation','order-management','payment-invoice','bar-sales','tables',
             'bar-items','bar-ingredients','bar-movements',
             'kitchen-dashboard','kitchen-menu','kitchen-recipes','kitchen-ingredients','kitchen-queue','expenses','advanced-reports','reports','charts','employees',
             'custdebts','voidreqs','audit','settings','suppliers','stock-count','cashbook','assets','system-health','support'],
  Manager:  ['dashboard','order-creation','order-management','payment-invoice','bar-sales','tables',
             'bar-items','bar-ingredients','bar-movements',
             'kitchen-dashboard','kitchen-menu','kitchen-recipes','kitchen-ingredients','kitchen-queue','expenses','advanced-reports','reports','charts','employees',
             'custdebts','voidreqs','audit','settings','suppliers','stock-count'],
  Bartender:['dashboard','order-creation','order-management','payment-invoice','bar-sales'],
  Kitchen:  ['kitchen-queue','kitchen-dashboard','kitchen-menu','kitchen-ingredients','stock-count'],
};
const ROLE_NAV={
  Owner:    ['nav-dashboard','nav-order-creation','nav-order-management','nav-payment-invoice','nav-bar-sales',
             'nav-bar-items','nav-bar-ingredients','nav-bar-movements',
             'nav-kitchen-dashboard','nav-kitchen-menu','nav-kitchen-recipes','nav-kitchen-ingredients','nav-kitchen-queue','nav-expenses','nav-advanced-reports',
             'nav-reports','nav-charts','nav-employees','nav-custdebts','nav-voidreqs','nav-audit','nav-settings','nav-suppliers','nav-stock-count','nav-cashbook','nav-assets','nav-system-health','nav-support'],
  Manager:  ['nav-dashboard','nav-order-creation','nav-order-management','nav-payment-invoice','nav-bar-sales',
             'nav-bar-items','nav-bar-ingredients','nav-bar-movements',
             'nav-kitchen-dashboard','nav-kitchen-menu','nav-kitchen-recipes','nav-kitchen-ingredients','nav-kitchen-queue','nav-expenses','nav-advanced-reports',
             'nav-reports','nav-charts','nav-employees','nav-custdebts','nav-voidreqs','nav-audit','nav-settings','nav-suppliers','nav-stock-count'],
  Bartender:['nav-dashboard','nav-order-creation','nav-order-management','nav-payment-invoice','nav-bar-sales'],
  Kitchen:  ['nav-kitchen-queue','nav-kitchen-dashboard','nav-kitchen-menu','nav-kitchen-ingredients','nav-stock-count'],
};

// ── MANAGER PERMS CACHE ───────────────────────────
let _mgrPerms=null;
async function getMgrPerms(){
  if(!_mgrPerms){
    const res=await apiGet('misc','mgr_perms_get');
    _mgrPerms=res.ok?res.data:getDefaultPerms();
  }
  return _mgrPerms;
}
function getDefaultPerms(){
  return{canViewReports:true,canEditStock:true,canManageItems:true,canViewEmployees:true,canPaySalaries:false,
    canViewAudit:false,canRecordExpenses:true,canVoidExpenses:false,canApproveVoids:false,canGiveRefunds:false,canGiveDiscounts:false,canDeleteRecords:false,
    canManageUsers:false,canEditSettings:false};
}
// Sync check for buttons: Owner can do everything, Manager only what the Owner granted
function can(perm){
  if(session.role==='Owner')return true;
  if(session.role!=='Manager')return false;
  return !!(_mgrPerms||getDefaultPerms())[perm];
}

// ── CAN ACCESS PAGE ───────────────────────────────
async function canAccessPage(pageId){
  const allowed=ROLE_PAGES[session.role]||[];
  if(session.role==='Manager'){
    const perms=await getMgrPerms();
    const extras={
      reports:perms.canViewReports,charts:perms.canViewReports,'advanced-reports':perms.canViewReports,suppliers:perms.canEditStock,
      stock:perms.canEditStock,products:perms.canManageItems,
      employees:perms.canViewEmployees,audit:perms.canViewAudit,
      expenses:perms.canRecordExpenses,
    };
    if(pageId in extras)return extras[pageId];
  }
  return allowed.includes(pageId);
}

// ── APPLY ROLE ACCESS (show/hide nav items) ───────
async function applyRoleAccess(){
  const allNav=['nav-dashboard','nav-order-creation','nav-order-management','nav-payment-invoice','nav-bar-sales',
                'nav-bar-items','nav-bar-ingredients','nav-bar-movements','nav-kitchen-dashboard','nav-kitchen-menu','nav-kitchen-recipes','nav-kitchen-ingredients','nav-kitchen-queue','nav-expenses','nav-advanced-reports','nav-reports','nav-charts',
                'nav-employees','nav-custdebts','nav-voidreqs','nav-audit','nav-settings','nav-suppliers','nav-stock-count','nav-cashbook','nav-assets','nav-system-health','nav-support'];
  const allowed=ROLE_NAV[session.role]||[];
  allNav.forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.style.display=allowed.includes(id)?'':'none';
  });
  if(session.role==='Bartender'){
    document.body.classList.add('bartender-mode');
    document.querySelectorAll('.sb-section').forEach((el,i)=>{if(i>0)el.style.display='none';});
  }else{
    document.body.classList.remove('bartender-mode');
  }
  if(session.role==='Kitchen'){
    document.body.classList.add('kitchen-mode');
  }else{
    document.body.classList.remove('kitchen-mode');
  }
  if(session.role==='Manager'){
    const perms=await getMgrPerms();
    if(!perms.canViewReports){['nav-reports','nav-charts','nav-advanced-reports'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});}
    if(!perms.canEditStock){['nav-stock','nav-suppliers'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});}
    if(!perms.canManageItems){const el=document.getElementById('nav-products');if(el)el.style.display='none';}
    if(!perms.canViewEmployees){const el=document.getElementById('nav-employees');if(el)el.style.display='none';}
    if(!perms.canViewAudit){const el=document.getElementById('nav-audit');if(el)el.style.display='none';}
    if(!perms.canRecordExpenses){const el=document.getElementById('nav-expenses');if(el)el.style.display='none';}
  }
}

// Empty the login boxes and lock them against browser autofill until tapped again
function clearLoginFields(keepUsername=false){
  const u=document.getElementById('loginUser');
  const p=document.getElementById('loginPass');
  if(u&&!keepUsername){u.value='';u.setAttribute('readonly','');}
  if(p){p.value='';p.setAttribute('readonly','');}
}

// ── LOGIN ─────────────────────────────────────────
async function doLogin(){
  const u=document.getElementById('loginUser').value.trim().toLowerCase();
  const p=document.getElementById('loginPass').value;
  const errEl=document.getElementById('loginErr');
  errEl.style.display='none';
  if(!u||!p){errEl.style.display='block';return;}
  const res=await api('auth','login',{username:u,password:p});
  if(!res.ok){clearLoginFields(true);errEl.style.display='block';document.getElementById('loginPass')?.focus();return;}
  // Clear the password before the login box is hidden so the browser has nothing to offer to save
  clearLoginFields();
  const user=res.user;
  session={userId:user.id,username:user.username,role:user.role,fullName:user.fullName};
  window.__barmsLastUserActivity=Date.now();
  startIdleSessionMonitor();

  // Task 70: Store session in IndexedDB for offline display
  try {
    await dbPut('auth', { key: 'session', ...user });
  } catch(e) {}

  // Task 66: Get JWT token and save to IndexedDB
  try {
    const tokenRes = await api('auth','token',{});  // session already set, no need to re-send credentials
    if (tokenRes.ok) {
      await dbPut('auth', { key: 'jwt_token', token: tokenRes.token, expiresAt: tokenRes.expiresAt });
    }
  } catch(e) { console.warn('[Auth] Could not get JWT token:', e); }

  document.getElementById('loginWrap').style.display='none';
  document.getElementById('appShell').style.display='flex';
  document.getElementById('sidebarName').textContent=user.fullName;
  document.getElementById('sidebarRole').textContent=user.role;
  document.getElementById('avatarTxt').textContent=user.fullName.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  applyRoleAccess();
  if (typeof refreshShiftButton === 'function') refreshShiftButton();
  const bdBtn = document.getElementById('backdateBtn'); if (bdBtn) bdBtn.style.display = '';
  applyLanguage();
  showPage(session.role==='Kitchen'?'kitchen-queue':'dashboard');
  setTimeout(()=>{
    if(res.pendingVoids>0&&session.role!=='Bartender'&&session.role!=='Kitchen'){
      showPopupNotif(currentLang==='fr'?`Vous avez ${res.pendingVoids} demande${res.pendingVoids>1?'s':''} d'annulation en attente`:`You have ${res.pendingVoids} pending void request${res.pendingVoids>1?'s':''} awaiting your review`,'warning','');
    }
    if(session.role!=='Kitchen')runFraudCheck();
    if(typeof remindStockCount==='function')setTimeout(remindStockCount,2500);
  },1200);
}

// ── LOGOUT ────────────────────────────────────────
async function doLogout(){
  if(_idleSessionTimer){clearInterval(_idleSessionTimer);_idleSessionTimer=null;}
  const shiftBtn=document.getElementById('shiftBtn');if(shiftBtn)shiftBtn.style.display='none';
  await api('auth','logout',{});

  // Task 68: Clear JWT and session from IndexedDB
  try {
    await dbDelete('auth', 'jwt_token');
    await dbDelete('auth', 'session');
  } catch(e) {}

  session={userId:0,username:'',role:'',fullName:''};
  _mgrPerms=null;
  document.body.classList.remove('bartender-mode');
  document.querySelectorAll('.sb-section').forEach(el=>el.style.display='');
  ['nav-dashboard','nav-sales','nav-quicksale','nav-stock','nav-products',
   'nav-expenses','nav-kitchen-dashboard','nav-kitchen-menu','nav-kitchen-recipes','nav-kitchen-ingredients','nav-reports','nav-charts','nav-employees',
   'nav-custdebts','nav-voidreqs','nav-audit','nav-settings'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.style.display='';
  });
  clearLoginFields();
  document.getElementById('appShell').style.display='none';
  document.getElementById('loginWrap').style.display='flex';
}

// ── CHANGE PASSWORD ───────────────────────────────
async function changePassword(){
  const curr=document.getElementById('pwdCurrent').value;
  const newPwd=document.getElementById('pwdNew').value;
  if(!curr||!newPwd){toast('Fill both fields','error');return;}
  const res=await api('auth','change_password',{current:curr,new:newPwd});
  if(!res.ok){toast(res.error||t('wrongPassword'),'error');return;}
  document.getElementById('pwdCurrent').value='';
  document.getElementById('pwdNew').value='';
  toast(t('passwordChanged'));
}

// ── USER ACCESS INFO MODAL ────────────────────────
async function showUserAccessInfo(){
  if(session.role==='Owner'){showPage('settings');return;}
  const perms=await getMgrPerms();
  const accessList=session.role==='Manager'
    ?Object.entries(PERM_LABELS()).map(([key,p])=>({label:p.label,ok:perms[key]}))
    :[{label:'Record Sales',ok:true},{label:'Quick Sale',ok:true}];
  document.getElementById('modalContent').innerHTML=`
    <h3>${session.role==='Manager'?'':''} ${esc(session.fullName)} — ${esc(session.role)}</h3>
    <div style="margin-top:16px">
      ${accessList.map(a=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
        <span>${a.ok?'':''}</span><span>${a.label}</span>
      </div>`).join('')}
    </div>`;
  document.getElementById('modalOverlay').classList.add('show');
}
