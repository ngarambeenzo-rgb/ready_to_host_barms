/* ═══════════════════════════════════════════════════
   BARMS PRO — navigation.js
   Page routing, sidebar toggle, language switcher,
   topbar search & summary
   Depends on: utils.js, api.js, auth.js
═══════════════════════════════════════════════════ */

let currentLang=localStorage.getItem('barms_lang')||'en';

// ── PAGE TITLES ───────────────────────────────────
const PAGE_TITLES={
  en:{'dashboard':'Dashboard','order-creation':'Order Creation','order-management':'Order Management',
      'payment-invoice':'Payment & Invoice','bar-sales':'Bar Sales','tables':'Tables',
      'bar-items':'Items','bar-ingredients':'Ingredients','bar-movements':'Stock Movements','kitchen-queue':'Kitchen Queue',
      'stock':'Stock Purchase','products':'Products','expenses':'Expenses','advanced-reports':'Advanced Reports','suppliers':'Suppliers','stock-count':'Stock Count','cashbook':'Cash Book','assets':'Assets & Worth','system-health':'System Health','sales':'Sales','quicksale':'Quick Sale',
      'kitchen-dashboard':'Kitchen Dashboard','kitchen-menu':'Menu','kitchen-recipes':'Recipes','kitchen-ingredients':'Ingredients','reports':'Reports',
      'charts':'Charts','employees':'Employees','custdebts':'Customer Debts',
      'voidreqs':'Requests','audit':'Audit Log','settings':'Settings','support':'Help & support'},
  fr:{'dashboard':'Tableau de Bord','order-creation':'Création Commande','order-management':'Gestion Commande',
      'payment-invoice':'Paiement & Facture','bar-sales':'Ventes Bar',
      'bar-items':'Articles','bar-ingredients':'Ingrédients','bar-movements':'Mouvements de Stock',
      'kitchen-dashboard':'Tableau Cuisine','kitchen-menu':'Menu','kitchen-recipes':'Recettes','kitchen-ingredients':'Ingrédients','kitchen-queue':'File Cuisine','expenses':'Dépenses','advanced-reports':'Rapports Avancés','suppliers':'Fournisseurs','stock-count':'Inventaire Physique','cashbook':'Livre de Caisse','assets':'Biens & Valeur','system-health':'Santé du système','reports':'Rapports','charts':'Graphiques','employees':'Employés',
      'custdebts':'Dettes Clients','voidreqs':'Demandes',
      'audit':"Journal d'Audit",'settings':'Paramètres','support':'Aide et assistance'}
};

// ── SHOW PAGE ─────────────────────────────────────
async function showPage(id){
  if(!(await canAccessPage(id))){toast('Access denied','error');return;}
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pg=document.getElementById('page-'+id);
  if(pg)pg.classList.add('active');
  const nav=document.getElementById('nav-'+id);
  if(nav)nav.classList.add('active');
  document.getElementById('pageTitle').textContent=(PAGE_TITLES[currentLang]||PAGE_TITLES.en)[id]||id;
  document.getElementById('pageDate').textContent=new Date().toLocaleDateString(
    currentLang==='fr'?'fr-FR':'en-RW',{weekday:'long',year:'numeric',month:'long',day:'numeric'}
  );
  // Load page data
  if(id==='dashboard') loadDashboard();
  if(id==='order-creation') loadOrderCreation();
  if(id==='order-management'){/* always loaded via loadAllOrders() or loadOrderManagement(id) */}
  if(id==='payment-invoice'){/* always loaded via loadPaymentInvoice(order) */}
  if(id==='bar-sales') loadBarSales('today');
  if(id==='tables') loadTables();
  if(id==='bar-items') loadBarItems();
  if(id==='bar-ingredients') loadBarIngredients();
  if(id==='bar-movements') loadBarMovements('today');
  if(id==='kitchen-queue') loadKitchenQueue(); else stopKitchenQueuePolling();

  if(id==='kitchen-dashboard') loadKitchenDashboard();
  if(id==='kitchen-menu') loadKitchenMenu();
  if(id==='kitchen-recipes') loadKitchenRecipes();
  if(id==='kitchen-ingredients') loadKitchenIngredients();
  if(id==='expenses'){const ed=document.getElementById('expDate');if(ed&&!ed.value)ed.value=today();loadExpenses();}
  if(id==='reports') loadReport();
  if(id==='advanced-reports') loadAdvancedReports();
  if(id==='suppliers') loadSuppliers();
  if(id==='stock-count') loadStockCount();
  if(id==='cashbook') loadCashbook();
  if(id==='assets') loadAssetsPage();
  if(id==='system-health') loadSystemHealth();
  if(id==='charts') loadCharts();
  if(id==='employees'){loadEmployees();showEmpTab('list',null);}
  if(id==='custdebts') loadCustDebts();
  if(id==='voidreqs') loadVoidRequests();
  if(id==='support') loadSupport();
  if(id==='audit') loadAuditLog();
  if(id==='settings'){loadSettings();loadUsers();loadMgrPermissions();loadDiscountSettings();setTimeout(loadSettingsPageData,400);}
}

// ── SIDEBAR TOGGLE (mobile) ───────────────────────
function toggleSidebar(){
  document.querySelector('.sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('show');
}
function closeSidebar(){
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}

// ── LANGUAGE ──────────────────────────────────────
function toggleLanguage(){
  currentLang=currentLang==='en'?'fr':'en';
  localStorage.setItem('barms_lang',currentLang);
  applyLanguage();
}
function toggleLangLogin(){
  currentLang=currentLang==='en'?'fr':'en';
  localStorage.setItem('barms_lang',currentLang);
  applyLanguage();
}

function translateStaticHTML(d,isEN){
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const key=el.getAttribute('data-i18n');
    const txt=d[key];
    if(txt!==undefined)el.textContent=txt;
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el=>{
    const key=el.getAttribute('data-i18n-ph');
    const txt=d[key];
    if(txt!==undefined)el.placeholder=txt;
  });
  document.querySelectorAll('.tab[data-i18n]').forEach(el=>{
    const key=el.getAttribute('data-i18n');
    if(d[key])el.textContent=d[key];
  });
  document.querySelectorAll('.btn[data-i18n]').forEach(el=>{
    const key=el.getAttribute('data-i18n');
    if(d[key])el.textContent=d[key];
  });
  // Sidebar nav labels
  const navMap={
    'nav-dashboard':isEN?'Dashboard':'Tableau de Bord',
    'nav-order-creation':isEN?'Order Creation':'Création Commande',
    'nav-order-management':isEN?'Order Management':'Gestion Commande',
    'nav-payment-invoice':isEN?'Payment & Invoice':'Paiement & Facture',
    'nav-stock-count':isEN?'Stock Count':'Inventaire Physique',
    'nav-suppliers':isEN?'Suppliers':'Fournisseurs',
    'nav-expenses':isEN?'Expenses':'Dépenses',
    'nav-cashbook':isEN?'Cash Book':'Livre de Caisse',
    'nav-assets':isEN?'Assets & Worth':'Biens & Valeur',
    'nav-system-health':isEN?'System Health':'Santé du système',
    'nav-advanced-reports':isEN?'Advanced Reports':'Rapports Avancés',
    'nav-bar-sales':isEN?'Bar Sales':'Ventes Bar',
    'nav-bar-items':isEN?'Items':'Articles',
    'nav-bar-ingredients':isEN?'Ingredients':'Ingrédients',
    'nav-bar-movements':isEN?'Stock Movements':'Mouvements de Stock',
    'nav-kitchen-queue':isEN?'Kitchen Queue':'File Cuisine',

    'nav-kitchen-dashboard':isEN?'Kitchen Dashboard':'Tableau Cuisine',
    'nav-kitchen-menu':isEN?'Menu':'Menu',
    'nav-kitchen-recipes':isEN?'Recipes':'Recettes',
    'nav-kitchen-ingredients':isEN?'Ingredients':'Ingrédients',
    'nav-reports':isEN?'Reports':'Rapports',
    'nav-charts':isEN?'Charts':'Graphiques',
    'nav-employees':isEN?'Employees':'Employés',
    'nav-custdebts':isEN?'Customer Debts':'Dettes Clients',
    'nav-voidreqs':isEN?'Requests':'Demandes',
    'nav-audit':isEN?'Audit Log':"Journal d'Audit",
    'nav-settings':isEN?'Settings':'Paramètres',
  };
  Object.entries(navMap).forEach(([id,label])=>{
    const el=document.getElementById(id);
    if(el){
      const lab=el.querySelector('.nav-label');
      if(lab)lab.textContent=label;
      el.title=label;
    }
  });
  document.querySelectorAll('.sb-label').forEach((el,i)=>{
    const names=isEN?['Main','Bar inventory','Kitchen','Money & reports','People & admin']:['Principal','Stock bar','Cuisine','Argent & rapports','Personnel & admin'];
    if(names[i])el.textContent=names[i];
  });
  const logop=document.querySelector('.sb-logo p');
  if(logop)logop.textContent=isEN?'RWANDA BAR MANAGEMENT':'GESTION DE BAR RWANDA';
  const logout=document.querySelector('.nav-item-logout');
  const ll=logout&&logout.querySelector('.logout-label');if(ll)ll.textContent=isEN?'Gusohoka / Logout':'Déconnexion';
}

function applyLanguage(){
  const isEN=(currentLang==='en');
  const d=DICT[currentLang]||DICT.en;
  translateStaticHTML(d,isEN);
  const lb=document.getElementById('langBtn');
  if(lb)lb.textContent=isEN?'FR':'EN';
  const llb=document.getElementById('loginLangBtn');
  if(llb)llb.textContent=isEN?'Français':'English';
  const ls=document.getElementById('loginSubtitle');
  if(ls)ls.textContent=isEN?'Bar Management System — Rwanda ':'Système de Gestion de Bar — Rwanda ';
  const lu=document.getElementById('loginUser');
  if(lu)lu.placeholder=isEN?"Enter your username":"Entrez votre nom d'utilisateur";
  const lp=document.getElementById('loginPass');
  if(lp)lp.placeholder=isEN?"Enter your password":"Entrez votre mot de passe";
  const lbtn=document.getElementById('loginBtn');
  if(lbtn)lbtn.textContent=isEN?'Sign in':'Se connecter';
  const nob=document.querySelector('#newOrderBtn span');
  if(nob)nob.textContent=isEN?'New order':'Nouvelle commande';
  const pd=document.getElementById('pageDate');
  if(pd)pd.textContent=new Date().toLocaleDateString(isEN?'en-RW':'fr-FR',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  // Reload active page data with new language
  const activePage=document.querySelector('.page.active');
  if(activePage){
    const pid=activePage.id.replace('page-','');
    setTimeout(()=>{
      if(pid==='dashboard')  loadDashboard();
      if(pid==='sales')      {loadSaleProducts();loadSalesHistory(0,null);}
      if(pid==='quicksale')  loadQsProducts();
      if(pid==='bar-items') loadBarItems();
      if(pid==='bar-ingredients') loadBarIngredients();
      if(pid==='bar-movements') loadBarMovements('today');
      if(pid==='kitchen-dashboard') loadKitchenDashboard();
      if(pid==='kitchen-menu') loadKitchenMenu();
      if(pid==='kitchen-recipes') loadKitchenRecipes();
      if(pid==='kitchen-ingredients') loadKitchenIngredients();
      if(pid==='reports')    loadReport();
      if(pid==='charts')     loadCharts();
      if(pid==='employees')  loadEmployees();
      if(pid==='custdebts')  loadCustDebts();
      if(pid==='voidreqs')   loadVoidRequests();
      if(pid==='audit')      loadAuditLog();
      if(pid==='settings')   {loadSettings();loadUsers();}
    },50);
  }
}

// ── TOPBAR SEARCH ─────────────────────────────────
function showSearch(){
  document.getElementById('modalContent').innerHTML=`
    <h3>Search</h3>
    <input type="text" class="form-input" id="searchInput" placeholder="Search products and recent sales…" style="margin:4px 0 12px" oninput="runSearch(this.value)" autofocus/>
    <div id="searchResults"></div>`;
  document.getElementById('modalOverlay').classList.add('show');
  setTimeout(()=>document.getElementById('searchInput')?.focus(),100);
}

// Task 119: 300ms debounce on search
let _searchDebounceTimer = null;
function runSearch(q) {
  clearTimeout(_searchDebounceTimer);
  if (!q || q.length < 2) { document.getElementById('searchResults').innerHTML = ''; return; }
  _searchDebounceTimer = setTimeout(() => _doSearch(q), 300);
}
async function _doSearch(q){
  if(!q||q.length<2){document.getElementById('searchResults').innerHTML='';return;}
  // current lists only: drinks (Items), food (Menu), and today's drink sales
  const [bRes,mRes,sRes]=await Promise.all([apiGet('bar-inventory','items_list'),apiGet('kitchen2','menu_list'),apiGet('orders','bar_sales',{filter:'month'})]);
  const ql=q.toLowerCase(), has=v=>String(v||'').toLowerCase().includes(ql);
  const drinks=(bRes.data||[]).filter(p=>+p.active&&has(p.name));
  const dishes=(mRes.data||[]).filter(m=>has(m.name));
  const sales=(sRes.data||[]).filter(s=>has(s.product_name||s.productName)||has(s.sold_by||s.soldBy));
  const row=html=>`<div style="padding:8px;background:var(--bg);border-radius:8px;margin-bottom:4px;font-size:13px">${html}</div>`;
  const head=t=>`<div style="font-size:12px;font-weight:700;color:var(--muted);margin:8px 0 4px">${t}</div>`;
  document.getElementById('searchResults').innerHTML=`
    ${drinks.length?head('DRINKS')+drinks.slice(0,5).map(p=>row(`${esc(p.name)} — ${p.type==='direct'?`Stock: <strong>${+p.stock}</strong> — `:''}${fmtRWF(+p.price)}`)).join(''):''}
    ${dishes.length?head('FOOD')+dishes.slice(0,5).map(m=>row(`${esc(m.name)} <span style="color:var(--muted)">${esc(m.category||'')}</span> — ${fmtRWF(+m.price)}`)).join(''):''}
    ${sales.length?head('SALES THIS MONTH')+sales.slice(0,5).map(s=>row(`${esc(s.product_name||s.productName)} × ${+s.qty} — ${fmtRWF(+s.total)} <span style="color:var(--muted)">${esc(s.sale_date||s.date||'')} · ${esc(s.sold_by||s.soldBy||'')}</span>`)).join(''):''}
    ${!drinks.length&&!dishes.length&&!sales.length?'<p style="color:var(--muted);text-align:center;padding:20px">No results found</p>':''}`;
}

// ── END OF DAY SUMMARY ────────────────────────────
async function showSummary(){
  const res=await apiGet('misc','dashboard');
  if(!res.ok)return;
  const d=res.data;
  document.getElementById('modalContent').innerHTML=`
    <h3>Today's Summary</h3>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px">
      ${[['Revenue',d.todayRevenue,'green'],['Expenses',d.todayExpenses,'red'],['Profit',d.todayProfit,d.todayProfit>=0?'green':'red'],['Transactions',d.todayTx,'blue']].map(([l,v,c])=>`
        <div style="display:flex;justify-content:space-between;padding:10px;background:var(--bg);border-radius:8px">
          <span style="font-weight:600">${l}</span>
          <span style="font-weight:800;color:var(--${c});font-variant-numeric:tabular-nums">${typeof v==='number'&&l!=='Transactions'?fmtRWF(v):v}</span>
        </div>`).join('')}
    </div>`;
  document.getElementById('modalOverlay').classList.add('show');
}

// ── NOTIF PANEL ───────────────────────────────────
function translateNotifText(txt){
  txt=typeof stripEmoji==='function'?stripEmoji(txt):txt;
  if(currentLang!=='fr'||!txt)return txt||'';
  let tx=txt;
  tx=tx.replace(/Low stock:/gi,'Stock bas:');
  tx=tx.replace(/low on stock/gi,'en stock bas');
  tx=tx.replace(/only (\d+) (.+?) left/gi,'seulement $1 $2 restant(s)');
  tx=tx.replace(/pending void requests/gi,"demandes d'annulation en attente");
  tx=tx.replace(/pending void request/gi,"demande d'annulation en attente");
  tx=tx.replace(/awaiting your review/gi,'en attente de validation');
  tx=tx.replace(/You have/gi,'Vous avez');
  return tx;
}

async function updateNotifBadge(){
  const res=await apiGet('misc','notif_list');
  const unread=(res.data||[]).filter(n=>!n.read).length;
  const dot=document.getElementById('notifDot');
  if(dot)dot.style.display=unread>0?'block':'none';
}

async function toggleNotif(){
  const panel=document.getElementById('notifPanel');
  const showing=panel.style.display==='block';
  panel.style.display=showing?'none':'block';
  if(!showing){
    const res=await apiGet('misc','notif_list');
    const notifs=res.data||[];
    document.getElementById('notifList').innerHTML=notifs.map(n=>`
      <div class="notif-item${n.read?'':' unread'}">
        <div class="notif-text">${esc(translateNotifText(n.text||''))}</div>
        <div class="notif-time">${esc(n.time||'')}</div>
      </div>`).join('')||uiEmpty('bell',currentLang==='fr'?'Aucune notification':'No notifications',currentLang==='fr'?'Les alertes de stock et de cuisine apparaîtront ici.':'Stock and kitchen alerts will appear here.');
    updateNotifBadge();
  }
}

function closeNotifOutside(e){
  if(!e.target.closest('.notif-panel')&&!e.target.closest('#notifBtn'))
    document.getElementById('notifPanel').style.display='none';
}

async function markAllRead(){
  await api('misc','notif_mark_read',{});
  updateNotifBadge();
  document.getElementById('notifPanel').style.display='none';
}

async function addNotification(text,type='info'){
  await api('misc','notif_add',{text,type});
}

// Low-stock notices from the current lists (drinks + bar and kitchen ingredients).
// Each item is notified at most once a day on this device (it used to repeat every 5 minutes).
async function checkLowStock(){
  if(typeof session==='undefined'||!session.userId)return;
  const [bRes,giRes,kiRes]=await Promise.all([apiGet('bar-inventory','items_list'),apiGet('bar-inventory','ingredients_list'),apiGet('kitchen2','ingredients_list')]);
  const low=[
    ...(bRes.data||[]).filter(p=>+p.active&&p.type==='direct'&&+p.stock>0&&+p.stock<=+p.min_stock).map(p=>({key:'b'+p.id,name:p.name,left:+p.stock,unit:'pcs'})),
    ...(giRes.data||[]).filter(g=>+g.quantity>0&&+g.quantity<=+g.min_stock).map(g=>({key:'g'+g.id,name:g.name,left:+g.quantity,unit:g.unit||''})),
    ...(kiRes.data||[]).filter(k=>+k.quantity>0&&+k.quantity<=+k.min_stock).map(k=>({key:'k'+k.id,name:k.name,left:+k.quantity,unit:k.unit||''})),
  ];
  const day=new Date().toISOString().slice(0,10);
  let seen={};try{seen=JSON.parse(localStorage.getItem('barms_lowstock_seen')||'{}');}catch(e){}
  if(seen.day!==day)seen={day};
  let added=0;
  for(const p of low){
    if(seen[p.key])continue;
    seen[p.key]=1;added++;
    await addNotification(currentLang==='fr'?`Stock bas: ${p.name} — seulement ${p.left} ${p.unit} restant(s)`:`Low stock: ${p.name} — only ${p.left} ${p.unit} left`,'warning');
  }
  try{localStorage.setItem('barms_lowstock_seen',JSON.stringify(seen));}catch(e){}
  if(added)updateNotifBadge();
}
