/* ═══════════════════════════════════════════════════
   BARMS PRO — utils.js
   Shared helpers: formatters, toast, confirm2,
   popup notifications, sounds, i18n DICT + t()
   LOAD FIRST — everything else depends on this

   Task 17 — XSS Prevention:
   Use esc() to sanitize ANY user-supplied string
   before inserting into innerHTML. Never insert
   raw user data (names, notes, descriptions) into
   the DOM without escaping first.
═══════════════════════════════════════════════════ */

// ── Task 17: HTML escape helper ───────────────────────────────
// Wrap ALL user-supplied data in esc() before using in innerHTML
// e.g. `<td>${esc(user.fullName)}</td>` not `<td>${user.fullName}</td>`
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── FORMATTERS ────────────────────────────────────
function fmtDate(d){return d.toISOString().split('T')[0]}
function fmtRWF(n){return'RWF '+(+n).toLocaleString()}
function today(){return fmtDate(new Date())}

// Print with a body class so only the intended part prints (receipt, report…)
function printWithClass(cls){
  document.body.classList.add(cls);
  const done=()=>{document.body.classList.remove(cls);window.removeEventListener('afterprint',done);};
  window.addEventListener('afterprint',done);
  window.print();
  setTimeout(done,1000); // browsers without afterprint
}

// crypto.randomUUID only exists on https/localhost; phones opening http://192.168.x.x need a fallback
function newUuid(){
  if(window.crypto&&crypto.randomUUID)return crypto.randomUUID();
  const b=crypto.getRandomValues(new Uint8Array(16));
  b[6]=(b[6]&0x0f)|0x40;b[8]=(b[8]&0x3f)|0x80;
  const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

// Total stock value banner. rows: [{qty, unitCost}]
function renderStockValueBox(elId, rows){
  const el=document.getElementById(elId);
  if(!el)return;
  const total=rows.reduce((a,r)=>a+Math.max(0,+r.qty||0)*(+r.unitCost||0),0);
  const inStock=rows.filter(r=>(+r.qty||0)>0);
  const noCost=inStock.filter(r=>!(+r.unitCost>0)).length;
  el.innerHTML=`
    <div class="svb-card svb-main"><div class="svb-label">Total Stock Value</div><div class="svb-value">${fmtRWF(Math.round(total))}</div></div>
    <div class="svb-card"><div class="svb-label">Items In Stock</div><div class="svb-value">${inStock.length} / ${rows.length}</div></div>
    ${noCost?`<div class="svb-card svb-warn"><div class="svb-label">In Stock Without Cost</div><div class="svb-value">${noCost}</div></div>`:''}`;
  el.classList.add('show');
}
function nowTime(){return new Date().toTimeString().slice(0,5)}

// ── TOAST ─────────────────────────────────────────
function toast(msg,type='success'){
  const el=document.createElement('div');
  el.className=`toast toast-${type}`;el.textContent=msg;
  document.body.appendChild(el);
  setTimeout(()=>el.classList.add('show'),10);
  setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.remove(),400)},3200);
}

// ── CONFIRM DIALOG ────────────────────────────────
let _confirm2Callback=null;
function confirm2(msg,cb){
  _confirm2Callback=cb;
  const m=document.getElementById('modalContent');
  m.innerHTML=`<h3 style="margin-bottom:16px;white-space:pre-line">${msg}</h3>
    <div style="display:flex;gap:10px">
      <button class="btn btn-primary" onclick="_runConfirm2()">Confirm</button>
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('show');
}
async function _runConfirm2(){
  closeModal();
  if(_confirm2Callback)await _confirm2Callback();
  _confirm2Callback=null;
}
function closeModal(){document.getElementById('modalOverlay').classList.remove('show')}

// ── POPUP NOTIFICATIONS ───────────────────────────
let _popupQueue=[];let _popupShowing=false;

function showPopupNotif(text,type='info',icon=''){
  if(typeof session!=='undefined'&&session.role==='Bartender')return;
  _popupQueue.push({text,type,icon});
  if(!_popupShowing)_nextPopup();
}
function _nextPopup(){
  if(!_popupQueue.length){_popupShowing=false;return;}
  _popupShowing=true;
  const {text,type,icon}=_popupQueue.shift();
  const el=document.createElement('div');
  el.className=`popup-notif popup-${type}`;
  el.innerHTML=`<span style="font-size:18px">${icon}</span><span style="flex:1;font-size:13px">${text}</span><button onclick="this.parentElement.remove();_nextPopup()" style="background:none;border:none;cursor:pointer;color:inherit;font-size:16px;padding:0 4px">×</button>`;
  document.body.appendChild(el);
  setTimeout(()=>el.classList.add('show'),10);
  setTimeout(()=>{el.classList.remove('show');setTimeout(()=>{el.remove();_nextPopup();},400)},5000);
}

// ── SOUNDS ────────────────────────────────────────
function playSound(type){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator();const gain=ctx.createGain();
    osc.connect(gain);gain.connect(ctx.destination);
    if(type==='fraud'){
      osc.frequency.setValueAtTime(880,ctx.currentTime);
      osc.frequency.setValueAtTime(440,ctx.currentTime+.15);
      gain.gain.setValueAtTime(.4,ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.7);
      osc.start(ctx.currentTime);osc.stop(ctx.currentTime+.7);
    }else if(type==='warning'){
      osc.frequency.setValueAtTime(660,ctx.currentTime);
      osc.frequency.setValueAtTime(440,ctx.currentTime+.2);
      gain.gain.setValueAtTime(.25,ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.5);
      osc.start(ctx.currentTime);osc.stop(ctx.currentTime+.5);
    }else{
      osc.frequency.setValueAtTime(440,ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(660,ctx.currentTime+.2);
      gain.gain.setValueAtTime(.2,ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.4);
      osc.start(ctx.currentTime);osc.stop(ctx.currentTime+.4);
    }
  }catch(e){}
}

// ── PDF PRINT ENGINE ──────────────────────────────
function printPDF(title,barName,bodyHTML){
  const container=document.createElement('div');
  container.style.cssText='position:fixed;left:-9999px;top:0;width:794px;background:#fff;padding:32px;font-family:Arial,sans-serif;font-size:13px;color:#000;z-index:99999';
  container.innerHTML=`
    <div style="text-align:center;margin-bottom:24px;border-bottom:2px solid #333;padding-bottom:16px">
      <h1 style="margin:0;font-size:22px">${barName}</h1>
      <h2 style="margin:8px 0 0;font-size:16px;font-weight:normal">${title}</h2>
      <p style="margin:4px 0 0;font-size:11px;color:#666">Generated: ${new Date().toLocaleString()}</p>
    </div>
    ${bodyHTML}`;
  document.body.appendChild(container);
  function loadScript(src,cb){const s=document.createElement('script');s.src=src;s.onload=cb;document.head.appendChild(s);}
  function doRender(){
    html2canvas(container,{scale:2,useCORS:true,backgroundColor:'#ffffff'}).then(canvas=>{
      const{jsPDF}=window.jspdf;
      const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
      const pw=pdf.internal.pageSize.getWidth();
      const ph=pdf.internal.pageSize.getHeight();
      // Calculate image dimensions in mm
      const imgW=pw;
      const imgH=(canvas.height*imgW)/canvas.width;
      // Scale factor: canvas pixels per mm
      const pxPerMm=canvas.width/pw;
      let yPosMm=0;
      let pageNum=0;
      while(yPosMm<imgH){
        if(pageNum>0)pdf.addPage();
        // y offset in pixels from top of canvas
        const yOffPx=yPosMm*pxPerMm;
        // Place image such that the current page slice is visible
        pdf.addImage(canvas.toDataURL('image/jpeg',0.95),'JPEG',0,-yPosMm,imgW,imgH);
        yPosMm+=ph;
        pageNum++;
      }
      pdf.save(`${title.replace(/[^a-z0-9]/gi,'_')}.pdf`);
      document.body.removeChild(container);
    });
  }
  if(window.html2canvas&&window.jspdf){doRender();}
  else{loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',()=>{
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',doRender);
  });}
}

// ── i18n DICTIONARY ───────────────────────────────
const DICT={
  en:{
    endOfDay:'End of Day',search:'Search',quickSale:'+ Quick Sale',
    cashFlowTitle:"Today's Cash Flow",cashFlowSub:'Money In vs Money Out — real-time snapshot',
    monthlySalesTitle:'Monthly Sales — Last 6 Months',lowStockAlerts:'Low Stock Alerts',
    todaySalesActivity:"Today's Sales Activity",
    'TODAY REVENUE':'TODAY REVENUE','ITEMS SOLD':'ITEMS SOLD','EXPENSES':'EXPENSES',
    'NET PROFIT':'NET PROFIT','MONTH REVENUE':'MONTH REVENUE','KITCHEN INCOME':'KITCHEN INCOME',
    'LOW STOCK':'LOW STOCK','NOTIFICATIONS':'NOTIFICATIONS','MY SALES TODAY':'MY SALES TODAY',
    'In profit':'In profit','In loss':'In loss','Profitable':'Profitable','Loss':'Loss',
    'Positive':'Positive','Negative':'Negative','Unread':'Unread','transactions':'transactions',
    totalRevenue:'Total Revenue',debtDate:'Debt Date',paidDate:'Paid Date',
    netPaid:'Net Paid',deductions:'Deductions',hireDate:'Hire Date',
    sellPrice:'Sell Price (RWF) *',costPrice:'Cost Price (RWF)',
    positionLabel:'Position',phoneLabel:'Phone',fullName:'Full Name *',
    monthlySalary:'Monthly Salary (RWF)',
    product:'Product',stock:'Stock',alert:'Alert',status:'Status',time:'Time',
    qty:'Quantity',unitPrice:'Unit Price',total:'Total',soldBy:'Sold By',
    date:'Date',action:'Action',category:'Category',unit:'Unit',level:'Level',
    name:'Name',actions:'Actions',amount:'Amount',note:'Note',
    description:'Description',recordedBy:'Recorded By',employee:'Employee',
    phone:'Phone',position:'Position',role:'Role',
    user:'User',details:'Details',type:'Type',reason:'Reason',
    requestedBy:'Requested By',expense:'Expense',sale:'Sale',
    customer:'Customer',items:'Items',
    currentStock:'Current Stock',totalIn:'Total IN',totalOut:'Total OUT',
    lastMovement:'Last Movement',lastDate:'Last Date',
    recordSaleTitle:'KUGURISHA — Record Sale',productLabel:'Product / Igicuruzwa',
    priceStock:'Price & Stock',quantityLabel:'Quantity / Ingano',
    totalLabel:'Total / Amafaranga Yose',sellBtn:'✓ KUGURISHA — SELL',
    salesHistoryTitle:'Sales History / Ibyagurishijwe',
    today:'Today',thisWeek:'This Week',thisMonth:'This Month',
    quickSaleTitle:'Quick Sale — Add Items',addItemBtn:'+ Add Item to Order',
    noItemsYet:'No items added yet',orderSummary:'Order Summary',
    subtotal:'Subtotal',confirmSaleBtn:'✓ Emeza Kugurisha — Confirm Sale',
    clearOrder:'Clear Order',
    stockMovementTitle:'STOCK MOVEMENT — Kwinjiza / Gukuraho',
    movementType:'Movement Type',stockIn:'IN — Add Stock',stockOut:'OUT — Remove Stock',
    currentStockLabel:'Current Stock',costPerUnit:'Cost/Unit RWF (IN only)',
    noteReason:'Note / Reason',stockNotePh:'e.g. Restocked from supplier...',
    recordMovementBtn:'RECORD MOVEMENT',
    stockOverviewTitle:'Stock Overview — Summary & Recent Movements',
    searchProductPh:'Search product…',
    addProductTitle:'ADD PRODUCT — Click any row in the table to edit',
    productName:'Product Name *',productNamePh:'e.g. Primus Beer',
    categoryPh:'Beer, Food, Spirits…',unitPh:'Bottle, Plate, Glass…',
    initialStock:'Initial Stock',lowStockAlert:'Low Stock Alert',
    saveProductBtn:'SAVE PRODUCT',clearBtn:'✕ Clear',
    allProducts:'All Products',searchProductsPh:'Search products…',
    recordExpenseTitle:'RECORD EXPENSE',amountRWF:'Amount (RWF) *',
    expDescPh:'e.g. Electricity bill, cleaning supplies…',
    recordExpenseBtn:'RECORD EXPENSE',expenseHistory:'Expense History',
    totalThisMonth:'Total this month:',
    catGeneral:'General',catUtilities:'Utilities',catCleaning:'Cleaning',
    catTransport:'Transport',catFoodKitchen:'Food/Kitchen',catMaintenance:'Maintenance',
    catMarketing:'Marketing',catSecurity:'Security',catOther:'Other',
    kitRevenueTab:'Daily Revenue',kitExpensesTab:'Kitchen Expenses',kitPLTab:'P&L Report',
    kitRevenueFormTitle:'Record Daily Kitchen Revenue',
    kitRevenueNote:'Enter the total revenue collected by the kitchen for the day.',
    kitTotalRevenue:'Total Daily Revenue (RWF) *',noteOptional:'Note (optional)',
    kitRevNotePh:'e.g. Busy lunch service…',kitRecordRevenueBtn:'RECORD REVENUE',
    kitRevenueHistory:'Kitchen Revenue History',
    kitExpenseFormTitle:'Record Kitchen Expense',
    kitExpenseNote:'Kitchen-specific costs only — cooking gas, ingredients, kitchen supplies.',
    kitExpDescPh:'e.g. Cooking gas refill, tomatoes bulk purchase…',
    kitRecordExpenseBtn:'RECORD EXPENSE',kitExpenseHistory:'Kitchen Expense History',
    catIngredients:'Ingredients',catCookingGas:'Cooking Gas',
    catKitchenSupplies:'Kitchen Supplies',catEquipment:'Equipment',
    period:'Period',customDate:'Custom Date',pickDate:'Pick Date',
    exportPDFBtn:'Export PDF',
    daily:'Daily',weekly:'Weekly',monthly:'Monthly',pickDay:'Pick a day:',
    monthlyRevenueBar:'Monthly sales',
    revenueByCatPie:'Bar and kitchen',
    revenueVsProfit:'Sales and expenses',
    empListTab:'Employees',empDebtsTab:'Debts / Advances',empSalaryTab:'Pay Salary',
    addEmpTitle:'Add Employee',positionPh:'Bartender, Waiter…',
    saveEmpBtn:'Save Employee',
    allEmployees:'All Employees',recordDebtTitle:'Record Debt / Advance',
    debtNotePh:'Advance, loan…',recordDebtBtn:'Record Debt',
    debtHistory:'Debt History',paySalaryTitle:'Pay Salary',
    payNotePh:'April salary, bonus…',paySalaryBtn:'Pay Salary',
    salaryHistory:'Salary Payment History',
    barConfigTitle:'Bar Configuration',barName:'Bar Name',location:'Location',
    currency:'Currency',
    saveSettingsBtn:'Save Settings',
    mgrPermTitle:'Manager Permissions',ownerOnly:'— Owner only',
    mgrPermNote:'Control what managers can access and do in the system.',
    changePassTitle:'Change My Password',currentPass:'Current Password',
    newPass:'New Password',changePassBtn:'Change Password',
    backupTitle:'Data Backup & Restore',
    backupNote:'Makes a full backup of every record of this business, checks it, and downloads it (.sql.gz). To restore it, import the file with phpMyAdmin.',
    backupBtn:'Back up now — download',restoreBtn:'Restore from Backup',
    recordDebtCustTitle:'Record Customer Debt',
    customerName:'Customer Name *',customerNamePh:'e.g. Jean Paul…',
    phoneOptional:'Phone (optional)',amountOwed:'Amount Owed (RWF) *',
    descriptionItems:'Description / Items Taken',
    descItemsPh:'e.g. 3 Primus + 1 Nyama Choma…',
    recordDebtBtn2:'RECORD DEBT',unpaidDebts:'Unpaid Debts',paidDebts:'Paid Debts',
    saleVoidTab:'Sale Void Requests',expVoidTab:'Expense Void Requests',
    saleVoidRequests:'Sale Void Requests',expVoidRequests:'Expense Void Requests',
    filterByAction:'Filter by Action',allActions:'All Actions',
    sales:'Sales',voids:'Voids',priceChanges:'Price Changes',
    logins:'Logins',expenses:'Expenses',products:'Products',
    filterByUser:'Filter by User',allUsers:'All Users',
    clearFilters:'Clear Filters',auditLogTitle:'Audit Log — Every Action Tracked',
    notifTitle:'Notifications',markAllRead:'Mark all read',noNotifications:'No notifications',
    approve:'✓ Approve',reject:'✕ Reject',paid:'Paid',pending:'Pending',
    empty:'EMPTY',low:'LOW',ok:'OK',voided:'Voided',void2:'Void',
    requestVoid:'Request Void',markPaid:'✓ Paid',delete2:'Delete',
    requestDelete:'Request Delete',changePrice:'Change Price',
    edit2:'Edit',remove:'Remove',
    noSales:'No sales found',noProducts:'No products found',
    noEmployees:'No employees yet',noDebts:'No debts recorded',
    noSalary:'No salary payments yet',noStock:'No movements yet',
    noKitRev:'No revenue recorded yet',noKitExp:'No expenses recorded yet',
    noAudit:'No audit records yet',
    approved:'Approved',rejected:'Rejected',
    fillRequired:'Fill all required fields',expenseRecorded:'Expense recorded!',
    enterAmount:'Enter a valid amount',kitRevenueRecorded:'Kitchen revenue recorded!',
    kitExpRecorded:'Kitchen expense recorded!',
    deleted:'Deleted',productSaved:'Product saved!',productUpdated:'Product updated!',
    productNameRequired:'Product name is required',
    employeeSaved:'Employee saved!',employeeUpdated:'Employee updated!',
    nameRequired:'Name is required',debtRecorded:'Debt recorded!',
    markedPaid:'Debt marked as paid!',settingsSaved:'Settings saved!',
    passwordChanged:'Password changed!',wrongPassword:'Current password incorrect',
    backupDone:'Backup downloaded!',
    userAdded:'User added!',userRemoved:'User removed',userExists:'Username already exists',
    fillUserFields:'Fill all user fields',
    voidSent:'Void request sent to Owner for approval',
    voidApproved:'Void approved and executed',voidRejected:'Void request rejected',
    permUpdated:'Permission updated',
    pickDate2:'Pick Date',selectProductFirst:'Please select a product first',
    enterQty:'Enter a valid quantity',
  },
  fr:{
    endOfDay:'Fin de Journée',search:'Rechercher',quickSale:'+ Vente Rapide',
    cashFlowTitle:'Flux de Trésorerie du Jour',cashFlowSub:"Entrées vs Sorties d'argent — en temps réel",
    monthlySalesTitle:'Ventes Mensuelles — 6 Derniers Mois',lowStockAlerts:'Alertes Stock Bas',
    todaySalesActivity:"Activité des Ventes du Jour",
    'TODAY REVENUE':'REVENU DU JOUR','ITEMS SOLD':'ARTICLES VENDUS','EXPENSES':'DÉPENSES',
    'NET PROFIT':'BÉNÉFICE NET','MONTH REVENUE':'REVENU DU MOIS','KITCHEN INCOME':'REVENU CUISINE',
    'LOW STOCK':'STOCK BAS','NOTIFICATIONS':'NOTIFICATIONS','MY SALES TODAY':'MES VENTES DU JOUR',
    'In profit':'Bénéficiaire','In loss':'En perte','Profitable':'Rentable','Loss':'Perte',
    'Positive':'Positif','Negative':'Négatif','Unread':'Non lu','transactions':'transactions',
    totalRevenue:'Revenu Total',debtDate:'Date de Dette',paidDate:'Date de Paiement',
    netPaid:'Net Payé',deductions:'Déductions',hireDate:"Date d'Embauche",
    sellPrice:'Prix de Vente (RWF) *',costPrice:'Prix de Revient (RWF)',
    positionLabel:'Poste',phoneLabel:'Téléphone',fullName:'Nom Complet *',
    monthlySalary:'Salaire Mensuel (RWF)',
    product:'Produit',stock:'Stock',alert:'Alerte',status:'Statut',time:'Heure',
    qty:'Quantité',unitPrice:'Prix Unitaire',total:'Total',soldBy:'Vendu Par',
    date:'Date',action:'Action',category:'Catégorie',unit:'Unité',level:'Niveau',
    name:'Nom',actions:'Actions',amount:'Montant',note:'Note',
    description:'Description',recordedBy:'Enregistré Par',employee:'Employé',
    phone:'Téléphone',position:'Poste',role:'Rôle',
    user:'Utilisateur',details:'Détails',type:'Type',reason:'Raison',
    requestedBy:'Demandé Par',expense:'Dépense',sale:'Vente',
    customer:'Client',items:'Articles',
    currentStock:'Stock Actuel',totalIn:'Total Entrée',totalOut:'Total Sortie',
    lastMovement:'Dernier Mouvement',lastDate:'Dernière Date',
    recordSaleTitle:'KUGURISHA — Enregistrer une Vente',productLabel:'Produit / Igicuruzwa',
    priceStock:'Prix & Stock',quantityLabel:'Quantité / Ingano',
    totalLabel:'Total / Amafaranga Yose',sellBtn:'✓ KUGURISHA — VENDRE',
    salesHistoryTitle:'Historique des Ventes / Ibyagurishijwe',
    today:"Aujourd'hui",thisWeek:'Cette Semaine',thisMonth:'Ce Mois',
    quickSaleTitle:'Vente Rapide — Ajouter des Articles',addItemBtn:'+ Ajouter à la Commande',
    noItemsYet:'Aucun article ajouté',orderSummary:'Résumé de la Commande',
    subtotal:'Sous-total',confirmSaleBtn:'✓ Emeza Kugurisha — Confirmer la Vente',
    clearOrder:'Effacer la Commande',
    stockMovementTitle:'MOUVEMENT DE STOCK — Kwinjiza / Gukuraho',
    movementType:'Type de Mouvement',stockIn:'ENTRÉE — Ajouter Stock',stockOut:'SORTIE — Retirer Stock',
    currentStockLabel:'Stock Actuel',costPerUnit:'Coût/Unité RWF (Entrée uniquement)',
    noteReason:'Note / Raison',stockNotePh:'ex. Réapprovisionnement fournisseur...',
    recordMovementBtn:'ENREGISTRER MOUVEMENT',
    stockOverviewTitle:"Vue d'ensemble des Stocks — Résumé & Mouvements Récents",
    searchProductPh:'Rechercher produit…',
    addProductTitle:'AJOUTER PRODUIT — Cliquez sur une ligne pour modifier',
    productName:'Nom du Produit *',productNamePh:'ex. Primus Beer',
    categoryPh:'Bière, Nourriture, Spiritueux…',unitPh:'Bouteille, Assiette, Verre…',
    initialStock:'Stock Initial',lowStockAlert:'Alerte Stock Bas',
    saveProductBtn:'ENREGISTRER PRODUIT',clearBtn:'✕ Effacer',
    allProducts:'Tous les Produits',searchProductsPh:'Rechercher produits…',
    recordExpenseTitle:'ENREGISTRER UNE DÉPENSE',amountRWF:'Montant (RWF) *',
    expDescPh:'ex. Facture électricité, produits nettoyage…',
    recordExpenseBtn:'ENREGISTRER DÉPENSE',expenseHistory:'Historique des Dépenses',
    totalThisMonth:'Total ce mois:',
    catGeneral:'Général',catUtilities:'Services',catCleaning:'Nettoyage',
    catTransport:'Transport',catFoodKitchen:'Nourriture/Cuisine',catMaintenance:'Maintenance',
    catMarketing:'Marketing',catSecurity:'Sécurité',catOther:'Autre',
    kitRevenueTab:'Revenu Journalier',kitExpensesTab:'Dépenses Cuisine',kitPLTab:'Rapport P&L',
    kitRevenueFormTitle:'Enregistrer Revenu Journalier Cuisine',
    kitRevenueNote:'Entrez le revenu total collecté par la cuisine pour la journée.',
    kitTotalRevenue:'Revenu Journalier Total (RWF) *',noteOptional:'Note (facultatif)',
    kitRevNotePh:'ex. Service de déjeuner chargé…',kitRecordRevenueBtn:'ENREGISTRER REVENU',
    kitRevenueHistory:'Historique des Revenus Cuisine',
    kitExpenseFormTitle:'Enregistrer Dépense Cuisine',
    kitExpenseNote:'Coûts spécifiques à la cuisine uniquement — gaz, ingrédients, fournitures.',
    kitExpDescPh:'ex. Recharge gaz de cuisson, achat tomates en gros…',
    kitRecordExpenseBtn:'ENREGISTRER DÉPENSE',kitExpenseHistory:'Historique des Dépenses Cuisine',
    catIngredients:'Ingrédients',catCookingGas:'Gaz de Cuisson',
    catKitchenSupplies:'Fournitures Cuisine',catEquipment:'Équipement',
    period:'Période',customDate:'Date Personnalisée',pickDate:'Choisir Date',
    exportPDFBtn:'Exporter PDF',
    daily:'Journalier',weekly:'Hebdomadaire',monthly:'Mensuel',pickDay:'Choisir un jour:',
    monthlyRevenueBar:'Ventes mensuelles',
    revenueByCatPie:'Bar et cuisine',
    revenueVsProfit:'Ventes et dépenses',
    empListTab:'Employés',empDebtsTab:'Dettes / Avances',empSalaryTab:'Payer Salaire',
    addEmpTitle:'Ajouter un Employé',positionPh:'Barman, Serveur…',
    saveEmpBtn:'Enregistrer Employé',
    allEmployees:'Tous les Employés',recordDebtTitle:'Enregistrer Dette / Avance',
    debtNotePh:'Avance, prêt…',recordDebtBtn:'Enregistrer Dette',
    debtHistory:'Historique des Dettes',paySalaryTitle:'Payer le Salaire',
    payNotePh:'Salaire avril, prime…',paySalaryBtn:'Payer Salaire',
    salaryHistory:'Historique des Paiements de Salaire',
    barConfigTitle:'Configuration du Bar',barName:'Nom du Bar',location:'Localisation',
    currency:'Devise',
    saveSettingsBtn:'Enregistrer Paramètres',
    mgrPermTitle:'Permissions Gérant',ownerOnly:'— Propriétaire uniquement',
    mgrPermNote:'Contrôlez ce que les gérants peuvent accéder et faire dans le système.',
    changePassTitle:'Changer Mon Mot de Passe',currentPass:'Mot de Passe Actuel',
    newPass:'Nouveau Mot de Passe',changePassBtn:'Changer Mot de Passe',
    backupTitle:'Sauvegarde & Restauration des Données',
    backupNote:"Crée une sauvegarde complète de toutes les données de l'entreprise, la vérifie et la télécharge (.sql.gz). Pour la restaurer, importez le fichier avec phpMyAdmin.",
    backupBtn:'Sauvegarder maintenant — télécharger',restoreBtn:'Restaurer la Sauvegarde',
    recordDebtCustTitle:'Enregistrer Dette Client',
    customerName:'Nom du Client *',customerNamePh:'ex. Jean Paul…',
    phoneOptional:'Téléphone (facultatif)',amountOwed:'Montant Dû (RWF) *',
    descriptionItems:'Description / Articles Pris',
    descItemsPh:'ex. 3 Primus + 1 Nyama Choma…',
    recordDebtBtn2:'ENREGISTRER DETTE',unpaidDebts:'Dettes Non Payées',paidDebts:'Dettes Payées',
    saleVoidTab:'Annulations de Ventes',expVoidTab:'Annulations de Dépenses',
    saleVoidRequests:"Demandes d'Annulation de Ventes",expVoidRequests:"Demandes d'Annulation de Dépenses",
    filterByAction:'Filtrer par Action',allActions:'Toutes les Actions',
    sales:'Ventes',voids:'Annulations',priceChanges:'Changements de Prix',
    logins:'Connexions',expenses:'Dépenses',products:'Produits',
    filterByUser:'Filtrer par Utilisateur',allUsers:'Tous les Utilisateurs',
    clearFilters:'Effacer Filtres',auditLogTitle:"Journal d'Audit — Toutes les Actions Tracées",
    notifTitle:'Notifications',markAllRead:'Tout marquer comme lu',noNotifications:'Aucune notification',
    approve:'✓ Approuver',reject:'✕ Rejeter',paid:'Payé',pending:'En Attente',
    empty:'VIDE',low:'BAS',ok:'OK',voided:'Annulé',void2:'Annuler',
    requestVoid:'Demander Annulation',markPaid:'✓ Payé',delete2:'Supprimer',
    requestDelete:'Demander Suppression',changePrice:'Changer Prix',
    edit2:'Modifier',remove:'Retirer',
    noSales:'Aucune vente trouvée',noProducts:'Aucun produit trouvé',
    noEmployees:"Aucun employé pour l'instant",noDebts:'Aucune dette enregistrée',
    noSalary:'Aucun paiement de salaire',noStock:'Aucun mouvement',
    noKitRev:'Aucun revenu enregistré',noKitExp:'Aucune dépense enregistrée',
    noAudit:"Aucun enregistrement d'audit",
    approved:'Approuvé',rejected:'Rejeté',
    fillRequired:'Remplissez tous les champs requis',expenseRecorded:'Dépense enregistrée!',
    enterAmount:'Entrez un montant valide',kitRevenueRecorded:'Revenu cuisine enregistré!',
    kitExpRecorded:'Dépense cuisine enregistrée!',
    deleted:'Supprimé',productSaved:'Produit enregistré!',productUpdated:'Produit mis à jour!',
    productNameRequired:'Le nom du produit est requis',
    employeeSaved:'Employé enregistré!',employeeUpdated:'Employé mis à jour!',
    nameRequired:'Le nom est requis',debtRecorded:'Dette enregistrée!',
    markedPaid:'Dette marquée comme payée!',settingsSaved:'Paramètres enregistrés!',
    passwordChanged:'Mot de passe changé!',wrongPassword:'Mot de passe actuel incorrect',
    backupDone:'Sauvegarde téléchargée!',
    userAdded:'Utilisateur ajouté!',userRemoved:'Utilisateur supprimé',
    userExists:"Ce nom d'utilisateur existe déjà",fillUserFields:'Remplissez tous les champs utilisateur',
    voidSent:"Demande d'annulation envoyée au Propriétaire",
    voidApproved:'Annulation approuvée et exécutée',voidRejected:"Demande d'annulation rejetée",
    permUpdated:'Permission mise à jour',
    pickDate2:'Choisir Date',selectProductFirst:'Veuillez sélectionner un produit',
    enterQty:'Entrez une quantité valide',
  }
};

function t(key){return(DICT[currentLang]||DICT.en)[key]||key;}
