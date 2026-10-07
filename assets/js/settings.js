/* ═══════════════════════════════════════════════════
   BARMS PRO — settings.js
   Settings, users, manager permissions, backup
   Depends on: utils.js, api.js, auth.js
═══════════════════════════════════════════════════ */

async function saveSettings(){
  const res=await api('misc','settings_save',{
    barName:document.getElementById('setBarName').value,
    location:document.getElementById('setLocation').value,
    currency:document.getElementById('setCurrency').value,
  });
  if(!res.ok){toast(res.error,'error');return;}
  toast(t('settingsSaved'));
}

async function loadSettings(){
  const res=await apiGet('misc','settings_get');
  const s=res.data||{};

  // Task 64: Cache settings for offline display
  if (res.ok && res.data) {
    try {
      await dbPut('settings', { key: 'bar_settings', ...res.data });
      await dbSetSyncTime('settings');
    } catch(e) {}
  } else {
    // Load from cache if offline
    try {
      const cached = await dbGet('settings', 'bar_settings');
      if (cached) Object.assign(s, cached);
    } catch(e) {}
  }

  document.getElementById('setBarName').value=s.barName||'BarMS Pro';
  document.getElementById('setLocation').value=s.location||'Kigali, Rwanda';
  document.getElementById('setCurrency').value=s.currency||'RWF';
  applySettingsPanelAccess();
  // stock count schedule
  const days=+s.stockCountDays||7;
  const pre=document.getElementById('setCountPreset');
  if(pre){
    pre.value=[1,7,14,30].includes(days)?String(days):'';
    document.getElementById('setCountDays').value=days;
    document.getElementById('setCountDaysWrap').style.display=pre.value?'none':'';
  }
}

async function saveStockCountInterval(){
  const days=+document.getElementById('setCountDays').value;
  if(!(days>=1&&days<=90)){toast('Choose between 1 and 90 days','error');return;}
  const res=await api('misc','stock_count_interval_save',{days});
  if(!res.ok){toast(res.error||'Could not save','error');return;}
  toast(`Stock count due every ${days} day${days>1?'s':''} `);
}

// Show only the settings panels this user may use (everyone can change their own password)
function applySettingsPanelAccess(){
  const show={
    barConfigPanel:can('canEditSettings'),
    userMgmtPanel:can('canManageUsers'),
    mgrPermPanel:session.role==='Owner',
    stockCountPanel:session.role==='Owner',
    discountPanel:session.role==='Owner',
    backupPanel:session.role==='Owner',
  };
  Object.entries(show).forEach(([id,ok])=>{
    const el=document.getElementById(id);
    if(el)el.style.display=ok?'':'none';
  });
  // Managers may only create Bartender / Kitchen accounts
  const roleSel=document.getElementById('um_role');
  if(roleSel){
    [...roleSel.options].forEach(o=>{
      o.hidden=o.disabled=session.role!=='Owner'&&!['Bartender','Kitchen'].includes(o.value);
    });
  }
}

// ── USER MANAGEMENT ───────────────────────────────
function showAddUserModal(){
  document.getElementById('um_name').value='';
  document.getElementById('um_user').value='';
  document.getElementById('um_pass').value='';
  document.getElementById('um_role').value='Bartender';
  document.getElementById('um_error').style.display='none';
  document.getElementById('addUserModal').style.display='flex';
  setTimeout(()=>document.getElementById('um_name').focus(),100);
}
function hideAddUserModal(){document.getElementById('addUserModal').style.display='none';}

function submitAddUser(){
  const nameEl=document.getElementById('um_name');
  const userEl=document.getElementById('um_user');
  const passEl=document.getElementById('um_pass');
  const roleEl=document.getElementById('um_role');
  const errEl=document.getElementById('um_error');
  const btn=document.getElementById('um_submitBtn');
  const fullName=nameEl.value.trim();
  const username=userEl.value.trim().toLowerCase();
  const password=passEl.value;
  const role=roleEl.value;
  errEl.style.display='none';
  if(!fullName){errEl.textContent='Please enter full name';errEl.style.display='block';nameEl.focus();return;}
  if(!username){errEl.textContent='Please enter username';errEl.style.display='block';userEl.focus();return;}
  if(username.includes(' ')){errEl.textContent='Username cannot have spaces';errEl.style.display='block';userEl.focus();return;}
  if(!password||password.length<4){errEl.textContent='Password must be at least 4 characters';errEl.style.display='block';passEl.focus();return;}
  btn.disabled=true;btn.textContent='Adding...';
  const xhr=new XMLHttpRequest();
  xhr.open('POST','api/misc.php?action=users_add',true);
  xhr.setRequestHeader('Content-Type','application/json');
  xhr.setRequestHeader('X-CSRF-Token',getCsrfToken());
  xhr.withCredentials=true;
  xhr.onreadystatechange=function(){
    if(xhr.readyState!==4)return;
    btn.disabled=false;btn.textContent='✓ Add User';
    try{
      const res=JSON.parse(xhr.responseText);
      if(res.ok){hideAddUserModal();toast('User added!');loadUsers();}
      else{errEl.textContent=res.error||'Failed';errEl.style.display='block';}
    }catch(e){errEl.textContent='Error ('+xhr.status+')';errEl.style.display='block';}
  };
  xhr.send(JSON.stringify({fullName,username,password,role}));
}

async function loadUsers(){
  if(!can('canManageUsers'))return;
  const res=await apiGet('misc','users_list');
  const users=res.data||[];
  document.getElementById('usersList').innerHTML=users.map(u=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
      <div><div style="font-size:13px;font-weight:600">${esc(u.fullName)}</div>
      <div style="font-size:11px;color:var(--muted)">${esc(u.username)} · ${esc(u.role)}</div></div>
      ${u.id!==session.userId&&(session.role==='Owner'||['Bartender','Kitchen'].includes(u.role))
        ?`<button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="removeUser(${u.id})">${t('remove')}</button>`:''
      }
    </div>`).join('');
}

async function removeUser(id){
  confirm2('Remove this user?',async()=>{
    const res=await api('misc','users_remove',{id});
    if(!res.ok){toast(res.error,'error');return;}
    toast(t('userRemoved'),'warning');loadUsers();
  });
}

// ── MANAGER PERMISSIONS ───────────────────────────
function PERM_LABELS(){
  return{
    canViewReports:   {group:'Reports',            label:'View Reports & Charts',            desc:'Sales, purchases, expenses and profit reports'},
    canViewAudit:     {group:'Reports',            label:'View Audit Log',                   desc:'See every action recorded in the system'},
    canEditStock:     {group:'Stock & Items',      label:'Receive & Adjust Stock',           desc:'Record stock purchases, receive ingredients, adjust quantities'},
    canManageItems:   {group:'Stock & Items',      label:'Manage Items, Menu & Prices',      desc:'Add, edit or delete bar items, ingredients, kitchen menu and recipes'},
    canRecordExpenses:{group:'Money',              label:'Record Expenses',                  desc:'Record bar and kitchen expenses'},
    canVoidExpenses:  {group:'Money',              label:'Void Expenses',                    desc:'Cancel a recorded expense directly'},
    canApproveVoids:  {group:'Money',              label:'Approve Void Requests',            desc:'Approve or reject void requests (never their own)'},
    canGiveDiscounts: {group:'Money',              label:'Apply Discounts',                  desc:'Tick the discounts the Owner set up (Settings → Discounts) at payment — never their own amount'},
    canGiveRefunds:   {group:'Money',              label:'Give Refunds',                     desc:'Refund paid orders directly and approve refund requests (never their own)'},
    canDeleteRecords: {group:'Money',              label:'Delete Debts & Kitchen Revenue',   desc:'Delete customer debts and kitchen revenue entries'},
    canViewEmployees: {group:'Staff',              label:'Employees',                        desc:'View and manage employees and their debts'},
    canPaySalaries:   {group:'Staff',              label:'Pay Salaries',                     desc:'Record salary payments'},
    canManageUsers:   {group:'Staff',              label:'Manage Staff Logins',              desc:'Add or remove Bartender and Kitchen accounts'},
    canEditSettings:  {group:'System',             label:'Edit Bar Settings',                desc:'Change bar name, location and currency'},
  };
}

async function loadMgrPermissions(){
  const panel=document.getElementById('mgrPermPanel');
  if(!panel)return;
  if(session.role!=='Owner'){panel.style.display='none';return;}
  panel.style.display='block';
  const res=await apiGet('misc','mgr_perms_get');
  const perms=res.data||getDefaultPerms();
  let lastGroup='';
  document.getElementById('mgrPermList').innerHTML=`
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">
      <button class="btn btn-green btn-sm" onclick="setAllPerms(true)">Allow everything</button>
      <button class="btn btn-ghost btn-sm" onclick="setAllPerms(false)">Remove everything</button>
    </div>`+Object.entries(PERM_LABELS()).map(([key,p])=>{
    const header=p.group!==lastGroup?`<div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:14px 0 2px">${p.group}</div>`:'';
    lastGroup=p.group;
    return header+`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text)">${p.label}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${p.desc} — ${perms[key]?'allowed':'not allowed'}</div>
      </div>
      <label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer">
        <input type="checkbox" ${perms[key]?'checked':''} onchange="togglePerm('${key}',this.checked)"
          style="opacity:0;width:0;height:0;position:absolute"/>
        <div style="position:absolute;inset:0;background:${perms[key]?'var(--green)':'var(--border-dk)'};border-radius:24px;transition:.3s">
          <div style="position:absolute;top:3px;left:${perms[key]?'23px':'3px'};width:18px;height:18px;background:#fff;border-radius:50%;transition:.3s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></div>
        </div>
      </label>
    </div>`;}).join('');
}

async function saveMgrPerms(changes){
  const res=await api('misc','mgr_perms_save',changes);
  if(!res.ok){toast(res.error||'Could not save permissions','error');}
  else toast(t('permUpdated'));
  loadMgrPermissions();
}

function togglePerm(key,val){
  saveMgrPerms({[key]:val});
}

function setAllPerms(val){
  const changes={};
  Object.keys(PERM_LABELS()).forEach(k=>{changes[k]=val;});
  confirm2(val?'Give managers access to everything listed?':'Remove all manager permissions?',()=>saveMgrPerms(changes));
}

// ── BACKUP / RESTORE ──────────────────────────────
// The full, verified database backup (the same one System Health makes every day):
// every table of this business, checked by reading it back, then downloaded.
// (The old JSON export only held the retired item list and old sales — not orders, payments or stock.)
async function backupData(){
  if(session.role!=='Owner'){toast('Only the Owner can make a backup','error');return;}
  const st=document.getElementById('backupStatus');
  if(st)st.textContent='Making the backup…';
  const res=await api('health','backup',{});
  if(!res.ok){if(st)st.textContent='';toast(res.error||'The backup failed','error');return;}
  const a=document.createElement('a');
  a.href='api/health.php?action=backup_download&file='+encodeURIComponent(res.data.file);
  a.download=res.data.file;
  document.body.appendChild(a);a.click();a.remove();
  toast(t('backupDone'));
  if(st)st.textContent=`Last backup: ${new Date().toLocaleString()} — ${(+res.data.rows).toLocaleString()} records, verified`;
}

function restoreData(input){
  toast('Restore from file is disabled in database mode. Use cPanel → phpMyAdmin to restore data.','error');
  input.value='';
}

// ── IMS LICENSE SETTINGS ──────────────────────────
async function loadSettingsPageData() {
  // Show IMS and storage panels only to Owner role
  // session is a global variable set in auth.js on login
  const role = (typeof session !== "undefined") ? session.role : null;
  const ownerDiv = document.getElementById('ownerOnlySettings');
  if (ownerDiv) {
    ownerDiv.style.display = (role === 'Owner') ? 'block' : 'none';
  }
  if (role === 'Owner') {
    await loadImsSettings();
    if (typeof renderStorageInfo === 'function') {
      await renderStorageInfo('storageInfoPanel');
    }
  }
}

async function loadImsSettings() {
  const imsUrl = await dbGet('settings', 'ims_url');
  const clientId = await dbGet('auth', 'ims_client_id');
  const deviceUuid = await getDeviceUuid();
  const license = await dbGet('auth', 'ims_license');

  const el = document.getElementById('imsSettingsPanel');
  if (!el) return;

  let licenseInfo = '<span style="color:var(--muted)">No license found</span>';
  if (license && license.token) {
    const payload = decodeLicensePayload(license.token);
    if (payload) {
      const daysLeft = Math.ceil((payload.subscriptionEnd - Date.now()/1000) / 86400);
      const subEnd = new Date(payload.subscriptionEnd * 1000).toLocaleDateString();
      licenseInfo = `
        <div style="background:var(--green-lt);border-radius:8px;padding:10px;font-size:12px">
          <div style="color:var(--green);font-weight:700">License Active</div>
          <div style="margin-top:4px">Bar: <strong>${esc(payload.barName)}</strong></div>
          <div>Plan: <strong>${esc(payload.plan)}</strong></div>
          <div>Devices: <strong>${payload.maxDevices}</strong></div>
          <div>Subscription ends: <strong>${subEnd}</strong> (${daysLeft} days)</div>
        </div>`;
    }
  }

  el.innerHTML = `
    <div class="form-group">
      <label class="form-label">License Status</label>
      ${licenseInfo}
    </div>
    <div class="form-group">
      <label class="form-label">Your Device ID</label>
      <div style="background:var(--bg);border:1.5px solid var(--border);border-radius:var(--r-sm);padding:10px 14px;font-family:monospace;font-size:12px;color:var(--blue);word-break:break-all">${esc(deviceUuid)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px">Share this ID with IMS Company if asked</div>
    </div>
    <div style="display:flex;gap:10px;margin-top:4px">
      <button class="btn btn-ghost" onclick="manualLicenseSync()">Sync License Now</button>
    </div>
  `;
}

async function saveImsSettings() {
  const url = document.getElementById('imsUrlInput')?.value?.trim();
  const clientId = document.getElementById('imsClientIdInput')?.value?.trim();

  if (url) await dbPut('settings', { key: 'ims_url', value: url });
  if (clientId) await dbPut('auth', { key: 'ims_client_id', clientId: parseInt(clientId) });

  toast('IMS settings saved ');
  await manualLicenseSync();
}

async function manualLicenseSync() {
  if (!navigator.onLine) { toast('No internet connection', 'error'); return; }
  toast('Syncing license with IMS...', 'info');
  const success = await syncLicenseWithIMS();
  if (success) {
    toast('License synced successfully ');
    await checkLicense();
    loadImsSettings();
  } else {
    toast('Could not reach IMS server. Check URL and Client ID.', 'error');
  }
}

// ── DISCOUNTS (Owner) ─────────────────────────────
async function loadDiscountSettings(){
  if(session.role!=='Owner')return;
  const [rules,bar,kit,pol]=await Promise.all([
    apiGet('discounts','list'),apiGet('bar-inventory','items_list'),apiGet('kitchen2','menu_list'),apiGet('discounts','policy')]);
  const sel=document.getElementById('dsItem');
  if(sel){
    const bars=(bar.data||[]).filter(i=>+i.active).map(i=>`<option value="bar:${i.id}">${esc(i.name)} — ${fmtRWF(i.price)}</option>`).join('');
    const kits=(kit.data||[]).filter(i=>i.status==='active').map(i=>`<option value="kitchen:${i.id}">${esc(i.name)} — ${fmtRWF(i.price)}</option>`).join('');
    sel.innerHTML=`<option value="">Choose an item…</option>${bars?`<optgroup label="Drinks">${bars}</optgroup>`:''}${kits?`<optgroup label="Kitchen">${kits}</optgroup>`:''}`;
  }
  const bt=document.getElementById('dsBartenders');if(bt)bt.checked=!!(pol.ok&&pol.bartenderCanDiscount);
  const list=document.getElementById('discountList');
  const rows=rules.data||[];
  list.innerHTML=rows.length?rows.map(r=>`<div class="disc-row${r.active?'':' off'}">
      <div class="disc-row-main"><div class="disc-row-name">${esc(r.name)}</div>
        <div class="disc-row-sub">${esc(r.item_name||'Item removed')} · ${r.kind==='percent'?(+r.value)+'% off':fmtRWF(r.value)+' off each'}${r.item_price?` · sells at ${fmtRWF(r.kind==='percent'?r.item_price*(1-r.value/100):r.item_price-r.value)}`:''}</div></div>
      <label class="disc-toggle" title="${r.active?'On':'Off'}"><input type="checkbox" ${r.active?'checked':''} onchange="toggleDiscountRule(${r.id},this.checked)"><span>${r.active?'On':'Off'}</span></label>
      <button class="icon-act danger" onclick="deleteDiscountRule(${r.id})" title="Delete" aria-label="Delete">${ic('trash')}</button>
    </div>`).join(''):uiEmpty('percent','No discounts yet','Add one above — for example 10% off one drink during happy hour.');
}
async function saveDiscountRule(){
  const name=document.getElementById('dsName').value.trim();
  const [type,id]=(document.getElementById('dsItem').value||':').split(':');
  const value=+document.getElementById('dsValue').value||0;
  const kind=document.getElementById('dsKind').value;
  if(!name||!id){toast('Give the discount a name and choose the item','error');return;}
  if(value<=0){toast('Enter how much the discount is','error');return;}
  const res=await api('discounts','save',{name,sourceType:type,sourceId:+id,kind,value,active:1});
  if(!res.ok){toast(res.error||'Could not save','error');return;}
  toast('Discount added','success');
  document.getElementById('dsName').value='';document.getElementById('dsValue').value='';
  loadDiscountSettings();
}
async function toggleDiscountRule(id,on){
  const res=await api('discounts','toggle',{id,active:on?1:0});
  if(!res.ok){toast(res.error||'Could not change','error');}
  loadDiscountSettings();
}
async function deleteDiscountRule(id){
  if(!confirm('Delete this discount?'))return;
  const res=await api('discounts','delete',{id});
  if(!res.ok){toast(res.error||'Could not delete','error');return;}
  toast('Discount deleted','info');loadDiscountSettings();
}
async function saveDiscountPolicy(on){
  const res=await api('discounts','policy',{bartenderCanDiscount:on?1:0});
  if(!res.ok){toast(res.error||'Could not save','error');return;}
  toast(on?'Bartenders can now apply your discounts':'Bartenders can no longer apply discounts','success');
}