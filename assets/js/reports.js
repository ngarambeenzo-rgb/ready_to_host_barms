/* ═══════════════════════════════════════════════════
   BARMS PRO — reports.js (Premium Executive Edition)
   All logic preserved. UI/PDF completely redesigned.
═══════════════════════════════════════════════════ */

let _reportType='daily';

// One place for report money figures so the screen and PDF always agree.
// The API's totalRev/totalCogs include kitchen sales and costs, so bar and kitchen are split here.
function reportFigures(d){
  const kitRev=+d.kitRev||0, kitExp=+d.kitExp||0, kitCogs=+d.kitchenCogs||0;
  const barRev=d.barRev!=null?+d.barRev:(+d.totalRev||0);
  const barCogs=d.barCogs!=null?+d.barCogs:(+d.totalCogs||0);
  const barNet=barRev-barCogs-(+d.totalExp||0);
  const kitNet=kitRev-kitCogs-kitExp;
  const sv=d.stockValue||{};
  return{
    barRev, kitRev, salesRevenue:+d.totalRev||0,
    revenueAll:barRev+kitRev,
    cogs:barCogs+kitCogs,
    expenses:(+d.totalExp||0)+kitExp,
    barNet, kitNet, totalNet:barNet+kitNet,
    refundsTotal:+d.totalRefunds||0, refunds:d.refunds||[],
    stock:{barItems:+sv.barItems||0,barIngredients:+sv.barIngredients||0,kitchenIngredients:+sv.kitchenIngredients||0,total:+sv.total||0,withoutCost:+sv.itemsWithoutCost||0},
  };
}

// best sellers, staff and number of sales over EVERY sale of the period (the server adds them up;
// an older server without salesSummary: from the list itself)
function reportSalesSummary(d,sales){
  if(d.salesSummary)return{byProduct:d.salesSummary.byProduct||{},byStaff:d.salesSummary.byStaff||{},count:+d.salesSummary.count||0};
  const byProduct={},byStaff={};
  sales.forEach(s=>{
    if(!byProduct[s.productName])byProduct[s.productName]={qty:0,revenue:0};
    byProduct[s.productName].qty+=s.qty;byProduct[s.productName].revenue+=s.total;
    if(!byStaff[s.soldBy])byStaff[s.soldBy]={qty:0,revenue:0,transactions:0};
    byStaff[s.soldBy].qty+=s.qty;byStaff[s.soldBy].revenue+=s.total;byStaff[s.soldBy].transactions++;
  });
  return{byProduct,byStaff,count:sales.length};
}

function stockValueRows(F,isFr){
  return [
    [isFr?'Articles du bar':'Bar items',F.stock.barItems],
    [isFr?'Ingrédients du bar':'Bar ingredients',F.stock.barIngredients],
    [isFr?'Ingrédients cuisine':'Kitchen ingredients',F.stock.kitchenIngredients],
  ];
}
let _reportValidated=false;
let _reportValidatedBy='';
let _reportValidatedAt='';

function resetReportValidation(){
  _reportValidated=false;_reportValidatedBy='';_reportValidatedAt='';
  const badge=document.getElementById('reportValidationBadge');
  const btn=document.getElementById('validateReportBtn');
  if(badge){badge.style.display='none';badge.innerHTML='';}
  if(btn)btn.style.display='none';
}

function validateReport(){
  if(session.role!=='Owner'&&session.role!=='Manager'){toast('Only Owner or Manager can validate reports','error');return;}
  const now=new Date();
  _reportValidated=true;
  _reportValidatedBy=session.fullName+' ('+session.role+')';
  _reportValidatedAt=now.toLocaleDateString('en-RW',{day:'2-digit',month:'short',year:'numeric'})+' '+now.toLocaleTimeString('en-RW',{hour:'2-digit',minute:'2-digit'});
  const btn=document.getElementById('validateReportBtn');
  if(btn)btn.style.display='none';
  const badge=document.getElementById('reportValidationBadge');
  if(badge){
    badge.style.display='inline-flex';
    badge.innerHTML=`<span style="display:inline-flex;align-items:center;gap:6px;background:#e0faf2;color:#0ea875;border:1px solid #0ea875;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700">${_reportValidatedBy} • ${_reportValidatedAt}</span>`;
  }
  toast(currentLang==='fr'?'Rapport validé!':'Report validated!');
}

function switchReportTab(type,el){
  resetReportValidation();
  _reportType=type;
  document.querySelectorAll('#page-reports .tab').forEach(tb=>tb.classList.remove('active'));
  if(el)el.classList.add('active');
  const dw=document.getElementById('reportDateWrap');
  if(dw)dw.style.display='flex';
  const lbl=document.getElementById('reportDateLabel');
  if(lbl){
    if(type==='daily')   lbl.textContent=currentLang==='fr'?'Choisir un jour:':'Pick a day:';
    if(type==='weekly')  lbl.textContent=currentLang==='fr'?'Semaine du:':'Week of:';
    if(type==='monthly') lbl.textContent=currentLang==='fr'?'Choisir le mois:':'Pick month:';
  }
  loadReport();
}

// full = true: the whole sales log (otherwise the newest 500; every total still covers all sales)
async function loadReport(full=false){
  const params={type:_reportType};
  const pickedDate=document.getElementById('reportDatePick')?.value||today();
  if(_reportType==='daily')   params.date=pickedDate;
  if(_reportType==='weekly')  params.date=pickedDate;
  if(_reportType==='monthly') params.month=pickedDate.slice(0,7);
  if(full) params.full=1;

  const res=await apiGet('misc','report',params);
  if(!res.ok)return;
  const d=res.data;
  const W=await rptWorth(d);
  const sales=(d.sales||[]).filter(s=>!s.voided);
  const expenses=(d.expenses||[]).filter(e=>!e.voided);
  const purchases=d.purchases||[];
  const totalPurchases=Number(d.totalPurchases)||0;
  const kitRevTotal=d.kitRev||0;

  // ── Computed Analytics ──────────────────────────
  const {byProduct,byStaff,count:salesCount}=reportSalesSummary(d,sales);

  const byCat={};
  expenses.forEach(e=>{if(!byCat[e.category])byCat[e.category]=0;byCat[e.category]+=e.amount;});

  const F=reportFigures(d);
  const barCogs=F.cogs;
  const barNet=F.barNet;
  const kitNet=F.kitNet;
  const totalNet=barNet+kitNet;
  const totalRevAll=F.revenueAll;
  const grossMargin=totalRevAll>0?((totalNet/totalRevAll)*100).toFixed(1):0;
  const avgOrderVal=salesCount>0?(F.salesRevenue/salesCount).toFixed(0):0;
  const topProducts=Object.entries(byProduct).sort((a,b)=>b[1].revenue-a[1].revenue).slice(0,5);
  const worstProducts=Object.entries(byProduct).sort((a,b)=>a[1].revenue-b[1].revenue).slice(0,3);
  const topStaff=Object.entries(byStaff).sort((a,b)=>b[1].revenue-a[1].revenue);

  const rc=document.getElementById('reportContent');
  if(!rc)return;

  resetReportValidation();
  const vBtn=document.getElementById('validateReportBtn');
  if(vBtn&&(session.role==='Owner'||session.role==='Manager'))vBtn.style.display='inline-flex';

  const isFr=currentLang==='fr';

  // ── Build max bar width helper ──
  const maxRev=topProducts.length?topProducts[0][1].revenue:1;

  rc.innerHTML=`
  <div class="rpt-wrap">

    <!-- KPI STRIP -->
    <div class="rpt-kpi-row">
      ${[
        {label:isFr?'Revenu total':'Total revenue',val:fmtRWF(totalRevAll),tone:'lead'},
        {label:isFr?'Bénéfice net':'Net profit',val:fmtRWF(totalNet),tone:totalNet>=0?'pos':'neg'},
        {label:isFr?'Marge brute':'Gross margin',val:grossMargin+'%'},
        {label:isFr?'Val. moy. commande':'Average order',val:fmtRWF(avgOrderVal)},
        {label:isFr?'Transactions':'Transactions',val:String(salesCount)},
        {label:isFr?'Dépenses':'Expenses',val:fmtRWF(F.expenses)},
        {label:isFr?'Valeur du stock':'Stock value now',val:fmtRWF(F.stock.total)},
      ].map(k=>`
        <div class="rpt-kpi ${k.tone||''}">
          <div class="rpt-kpi-label">${k.label}</div>
          <div class="rpt-kpi-val">${k.val}</div>
        </div>
      `).join('')}
    </div>

    <!-- ROW 1: Revenue Breakdown + Top Products -->
    <div class="rpt-grid-2">

      <!-- Revenue Summary -->
      <div class="rpt-card">
        <div class="rpt-card-header">
          <div class="rpt-card-title">${isFr?'Résumé des Revenus':'Revenue Breakdown'}</div>
        </div>
        <div class="rpt-summary-rows">
          ${[
            {label:isFr?'Revenu Bar':'Bar Revenue',val:fmtRWF(F.barRev),color:'#2563EB'},
            {label:isFr?'Revenu Cuisine':'Kitchen Revenue',val:fmtRWF(kitRevTotal),color:'#0891B2'},
            {label:isFr?'Coût des Marchandises':'Cost of Goods (COGS)',val:'− '+fmtRWF(barCogs),color:'#DC2626'},
            {label:isFr?'Dépenses Opérationnelles':'Operating Expenses',val:'− '+fmtRWF(F.expenses),color:'#DC2626'},
            {label:isFr?'Achats de Stock':'Inventory Purchases',val:fmtRWF(totalPurchases),color:'#D97706'},
            ...(F.refundsTotal?[{label:isFr?'Remboursements (déjà déduits)':'Refunds given (already deducted)',val:'− '+fmtRWF(F.refundsTotal),color:'#EA580C'}]:[]),
          ].map(r=>`
            <div class="rpt-sum-row">
              <span class="rpt-sum-label">${r.label}</span>
              <span class="rpt-sum-val" style="color:${r.color}">${r.val}</span>
            </div>
          `).join('')}
          <div class="rpt-sum-row rpt-sum-total">
            <span>${isFr?'Bénéfice Net Total':'Total Net Profit'}</span>
            <span style="color:${totalNet>=0?'#059669':'#DC2626'}">${fmtRWF(totalNet)}</span>
          </div>
        </div>
        <div class="rpt-margin-bar">
          <div class="rpt-margin-label">${isFr?'Marge Nette':'Net Margin'}: <strong>${grossMargin}%</strong></div>
          <div class="rpt-bar-track">
            <div class="rpt-bar-fill" style="width:${Math.min(Math.abs(grossMargin),100)}%;background:${totalNet>=0?'#059669':'#DC2626'}"></div>
          </div>
        </div>
      </div>

      <!-- Top Products -->
      <div class="rpt-card">
        <div class="rpt-card-header">
          <div class="rpt-card-title">${isFr?'Top Produits':'Top Selling Products'}</div>
          <span class="rpt-badge rpt-badge-green">${isFr?'Par Revenu':'By Revenue'}</span>
        </div>
        ${topProducts.length?topProducts.map(([name,data],i)=>`
          <div class="rpt-product-row">
            <div class="rpt-rank">${i+1}</div>
            <div class="rpt-product-info">
              <div class="rpt-product-name">${name}</div>
              <div class="rpt-product-bar-wrap">
                <div class="rpt-product-bar" style="width:${Math.round((data.revenue/maxRev)*100)}%"></div>
              </div>
            </div>
            <div class="rpt-product-stats">
              <div class="rpt-product-rev">${fmtRWF(data.revenue)}</div>
              <div class="rpt-product-qty">${data.qty} ${isFr?'unités':'units'}</div>
            </div>
          </div>
        `).join(''):`<div class="rpt-empty">${isFr?'Aucune vente':'No sales data'}</div>`}
      </div>

    </div>

    <!-- ROW 2: Staff Performance + Expenses -->
    <div class="rpt-grid-2">

      <!-- Staff Performance -->
      <div class="rpt-card">
        <div class="rpt-card-header">
          <div class="rpt-card-title">${isFr?'Performance du Personnel':'Staff Performance'}</div>
          <span class="rpt-badge rpt-badge-blue">${isFr?'Classement':'Rankings'}</span>
        </div>
        ${topStaff.length?`
          <table class="rpt-table">
            <thead><tr>
              <th>#</th>
              <th>${isFr?'Agent':'Staff'}</th>
              <th>${isFr?'Transactions':'Transactions'}</th>
              <th>${isFr?'Revenu':'Revenue'}</th>
            </tr></thead>
            <tbody>
              ${topStaff.map(([name,data],i)=>`
                <tr>
                  <td><span class="rpt-rank-badge rpt-rank-${i+1<=3?i+1:'n'}">${i+1}</span></td>
                  <td style="font-weight:600">${name}</td>
                  <td style="text-align:center">${data.transactions}</td>
                  <td style="text-align:right;font-weight:700;color:#059669">${fmtRWF(data.revenue)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `:`<div class="rpt-empty">${isFr?'Aucune donnée':'No staff data'}</div>`}
      </div>

      <!-- Expenses by Category -->
      <div class="rpt-card">
        <div class="rpt-card-header">
          <div class="rpt-card-title">${isFr?'Dépenses par Catégorie':'Expenses by Category'}</div>
          <span class="rpt-badge rpt-badge-red">${fmtRWF(d.totalExp)}</span>
        </div>
        ${Object.keys(byCat).length?`
          <table class="rpt-table">
            <thead><tr>
              <th>${isFr?'Catégorie':'Category'}</th>
              <th style="text-align:right">${isFr?'Montant':'Amount'}</th>
              <th style="text-align:right">%</th>
            </tr></thead>
            <tbody>
              ${Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>`
                <tr>
                  <td>${cat}</td>
                  <td style="text-align:right;color:#DC2626;font-weight:600">${fmtRWF(amt)}</td>
                  <td style="text-align:right;color:#94A3B8">${d.totalExp>0?((amt/d.totalExp)*100).toFixed(1):0}%</td>
                </tr>
              `).join('')}
              <tr class="rpt-total-row">
                <td>Total</td>
                <td style="text-align:right;color:#DC2626">${fmtRWF(d.totalExp)}</td>
                <td style="text-align:right">100%</td>
              </tr>
            </tbody>
          </table>
        `:`<div class="rpt-empty">${isFr?'Aucune dépense':'No expenses'}</div>`}
      </div>

    </div>

    <div class="rpt-card" style="margin-top:16px">
      <div class="rpt-card-header">
        <div class="rpt-card-title">${isFr?'Achats de Stock':'Inventory Purchases'}</div>
        <span class="rpt-badge rpt-badge-orange">${fmtRWF(totalPurchases)}</span>
      </div>
      <div class="rpt-table-scroll">
        <table class="rpt-table">
          <thead><tr><th>Date</th><th>${isFr?'Article':'Item'}</th><th>${isFr?'Type':'Inventory'}</th><th style="text-align:center">${isFr?'Qté':'Qty'}</th><th>Unit</th><th style="text-align:right">${isFr?'Coût/Unité':'Unit Cost'}</th><th style="text-align:right">${isFr?'Total':'Total Cost'}</th><th>${isFr?'Fournisseur':'Supplier'}</th><th>${isFr?'Référence':'Reference'}</th><th>${isFr?'Enregistré par':'Recorded By'}</th></tr></thead>
          <tbody>${purchases.map(p=>`<tr><td>${esc(p.purchase_date||p.date||'')}</td><td>${esc(p.item_name)}</td><td>${esc(p.inventory_type)}</td><td style="text-align:center">${p.quantity}</td><td>${esc(p.unit||'')}</td><td style="text-align:right">${fmtRWF(p.unit_cost)}</td><td style="text-align:right;font-weight:700;color:#D97706">${fmtRWF(p.total_cost)}</td><td>${esc(p.supplier||'—')}</td><td>${esc(p.reference||'—')}</td><td>${esc(p.recorded_by||'')}</td></tr>`).join('')||`<tr><td colspan="10" class="rpt-empty-cell">${isFr?'Aucun achat enregistré':'No recorded purchases for this period'}</td></tr>`}</tbody>
        </table>
      </div>
    </div>

    <div class="rpt-card" style="margin-top:16px">
      <div class="rpt-card-header">
        <div class="rpt-card-title">${isFr?'Valeur Actuelle du Stock':'Current Stock Value'}</div>
        <span class="rpt-badge" style="background:#ECFDF5;color:#059669">${fmtRWF(F.stock.total)}</span>
      </div>
      <div class="rpt-summary-rows">
        ${stockValueRows(F,isFr).map(([l,v])=>`<div class="rpt-sum-row"><span class="rpt-sum-label">${l}</span><span class="rpt-sum-val">${fmtRWF(v)}</span></div>`).join('')}
        <div class="rpt-sum-row rpt-sum-total"><span class="rpt-sum-label">${isFr?'Total':'Total stock value'}</span><span class="rpt-sum-val" style="color:#059669">${fmtRWF(F.stock.total)}</span></div>
        ${F.stock.withoutCost?`<div style="font-size:11px;color:#D97706;margin-top:6px">${F.stock.withoutCost} ${isFr?'article(s) en stock sans coût d\'achat — non comptés':'item(s) in stock have no purchase cost and are not counted'}</div>`:''}
        <div style="font-size:11px;color:#94A3B8;margin-top:4px">${isFr?'Stock actuel au coût moyen d\'achat (au moment de la génération)':'Stock on hand now, at average purchase cost'}</div>
      </div>
    </div>

    ${W?rptWorthCard(W,isFr):''}

    ${F.refunds.length?`<div class="rpt-card" style="margin-top:16px">
      <div class="rpt-card-header">
        <div class="rpt-card-title">${isFr?'Remboursements':'Refunds'}</div>
        <span class="rpt-badge" style="background:#FFF7ED;color:#EA580C">${fmtRWF(F.refundsTotal)}</span>
      </div>
      <div class="rpt-table-scroll"><table class="rpt-table">
        <thead><tr><th>Date</th><th>${isFr?'Commande':'Order'}</th><th>${isFr?'Articles':'Items'}</th><th style="text-align:right">${isFr?'Montant':'Amount'}</th><th>${isFr?'Méthode':'Method'}</th><th>${isFr?'Raison':'Reason'}</th><th>${isFr?'Par':'By'}</th></tr></thead>
        <tbody>${F.refunds.map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.orderNumber)}</td><td>${esc(r.items||'')}</td><td style="text-align:right;font-weight:700;color:#EA580C">${fmtRWF(r.amount)}</td><td>${esc(r.method)}</td><td>${esc(r.reason)}</td><td>${esc(r.by)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`:''}

    <!-- FULL SALES LOG -->
    <div class="rpt-card">
      <div class="rpt-card-header">
        <div class="rpt-card-title">${isFr?'Journal Complet des Ventes':'Full Sales Log'}</div>
        <span class="rpt-badge rpt-badge-blue">${d.salesLimited?`${sales.length} / ${d.salesLimited.total}`:sales.length} ${isFr?'entrées':'entries'}</span>
      </div>
      ${d.salesLimited?`<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0 10px;font-size:12px;color:var(--muted)">${isFr?`Les ${d.salesLimited.shown} ventes les plus récentes sur ${d.salesLimited.total}. Les totaux ci-dessus comptent toutes les ventes.`:`The newest ${d.salesLimited.shown} of ${d.salesLimited.total} sales. The totals above count every sale.`} <button class="btn btn-ghost btn-sm" onclick="loadReport(true)">${isFr?'Tout afficher':'Show all'} ${d.salesLimited.total}</button></div>`:''}
      <div class="rpt-table-scroll">
        <table class="rpt-table">
          <thead><tr>
            <th>${isFr?'Heure':'Time'}</th>
            <th>${isFr?'Produit':'Product'}</th>
            <th style="text-align:center">Qté</th>
            <th style="text-align:right">${isFr?'Prix Unit.':'Unit Price'}</th>
            <th style="text-align:right">Total</th>
            <th>${isFr?'Vendu par':'Sold By'}</th>
          </tr></thead>
          <tbody>
            ${sales.map(s=>`
              <tr>
                <td class="rpt-muted">${s.time||s.date||''}</td>
                <td style="font-weight:500">${s.productName}</td>
                <td style="text-align:center">${s.qty}</td>
                <td style="text-align:right;color:#64748B">${fmtRWF(s.unitPrice)}</td>
                <td style="text-align:right;font-weight:700;color:#059669">${fmtRWF(s.total)}</td>
                <td class="rpt-muted">${s.soldBy}</td>
              </tr>
            `).join('')||`<tr><td colspan="6" class="rpt-empty-cell">${isFr?'Aucune vente':'No sales'}</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

  </div>`;
}

async function exportReportPDF(){
  const pickedDate=document.getElementById('reportDatePick')?.value||today();
  const params={type:_reportType};
  if(_reportType==='daily')   params.date=pickedDate;
  if(_reportType==='weekly')  params.date=pickedDate;
  if(_reportType==='monthly') params.month=pickedDate.slice(0,7);
  params.full=1;   // the PDF holds the whole sales log

  const [res,setRes]=await Promise.all([apiGet('misc','report',params),apiGet('misc','settings_get')]);
  const d=res.data||{sales:[],expenses:[],totalRev:0,totalExp:0};
  const W=await rptWorth(d);
  const settings=setRes.data||{};
  const barName=settings.barName||'BarMS Pro';
  const location=settings.location||'Kigali, Rwanda';
  const sales=(d.sales||[]).filter(s=>!s.voided);
  const expenses=(d.expenses||[]).filter(e=>!e.voided);
  const purchases=d.purchases||[];
  const totalPurchases=Number(d.totalPurchases)||0;
  const kitRevTotal=d.kitRev||0;

  const {byProduct,byStaff,count:salesCount}=reportSalesSummary(d,sales);
  const byCat={};
  expenses.forEach(e=>{if(!byCat[e.category])byCat[e.category]=0;byCat[e.category]+=e.amount;});

  const isFr=currentLang==='fr';
  const F=reportFigures(d);
  const barCogs=F.cogs;
  const barNet=F.barNet;
  const kitNet=F.kitNet;
  const totalNet=barNet+kitNet;
  const totalRevAll=F.revenueAll;
  const grossMargin=totalRevAll>0?((totalNet/totalRevAll)*100).toFixed(1):0;
  const avgOrderVal=salesCount>0?(F.salesRevenue/salesCount).toFixed(0):0;
  const topProducts=Object.entries(byProduct).sort((a,b)=>b[1].revenue-a[1].revenue);
  const topStaff=Object.entries(byStaff).sort((a,b)=>b[1].revenue-a[1].revenue);
  const maxRev=topProducts.length?topProducts[0][1].revenue:1;

  const reportLabel=_reportType==='daily'?(isFr?`Rapport Journalier — ${pickedDate}`:`Daily Report — ${pickedDate}`):_reportType==='weekly'?(isFr?`Rapport Hebdomadaire — ${pickedDate}`:`Weekly Report — ${pickedDate}`):(isFr?`Rapport Mensuel — ${pickedDate.slice(0,7)}`:`Monthly Report — ${pickedDate.slice(0,7)}`);
  const now=new Date();
  const generatedStr=now.toLocaleDateString(isFr?'fr-FR':'en-RW',{weekday:'long',year:'numeric',month:'long',day:'numeric'})+' at '+now.toLocaleTimeString(isFr?'fr-FR':'en-RW',{hour:'2-digit',minute:'2-digit'});

  const pdfBody=`
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#0F172A;background:#fff;line-height:1.5}
  table{width:100%;border-collapse:collapse}
  th{background:#F1F5F9;color:#475569;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:10px 12px;text-align:left;border-bottom:2px solid #E2E8F0}
  td{padding:9px 12px;border-bottom:1px solid #F1F5F9;font-size:12px;color:#334155}
  tr:last-child td{border-bottom:none}
  .tr-total td{font-weight:800;background:#F8FAFC;border-top:2px solid #E2E8F0}
  .right{text-align:right}
  .center{text-align:center}
  .section{margin-bottom:28px;page-break-inside:avoid}
  .section-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#1E3A8A;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #1E3A8A;display:flex;align-items:center;gap:6px}

  /* COVER */
  .cover{background:linear-gradient(135deg,#1E3A8A 0%,#2563EB 60%,#3B82F6 100%);padding:36px 32px;border-radius:12px;margin-bottom:28px;color:#fff}
  .cover-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px}
  .cover-bar{font-size:24px;font-weight:800;letter-spacing:-.3px}
  .cover-loc{font-size:12px;color:rgba(255,255,255,.7);margin-top:4px}
  .cover-report{text-align:right}
  .cover-report-title{font-size:16px;font-weight:700}
  .cover-report-sub{font-size:11px;color:rgba(255,255,255,.7);margin-top:3px}
  .cover-divider{border:none;border-top:1px solid rgba(255,255,255,.25);margin:16px 0}

  /* KPI STRIP */
  .kpi-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:28px}
  .kpi-box{border-radius:8px;padding:14px 16px;border:1px solid #E2E8F0}
  .kpi-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#64748B;margin-bottom:6px}
  .kpi-val{font-size:18px;font-weight:800;font-family:'Courier New',monospace;letter-spacing:-.3px}

  /* TWO COL */
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px}
  .col-card{background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:16px}
  .col-card-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#1E3A8A;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #E2E8F0}

  /* SUMMARY */
  .sum-row{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #F1F5F9;font-size:13px}
  .sum-total{border-bottom:none;border-top:2px solid #1E3A8A;margin-top:4px;font-size:15px;font-weight:800;padding-top:10px}

  /* PRODUCT BAR */
  .prod-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #F1F5F9}
  .prod-row:last-child{border-bottom:none}
  .prod-rank{width:22px;height:22px;border-radius:50%;background:#1E3A8A;color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .prod-rank.r2{background:#64748B}
  .prod-rank.r3{background:#92400E}
  .prod-name{flex:1;font-size:12px;font-weight:600;color:#0F172A}
  .prod-bar-wrap{height:4px;background:#E2E8F0;border-radius:2px;margin-top:3px;overflow:hidden}
  .prod-bar-fill{height:100%;background:linear-gradient(90deg,#2563EB,#3B82F6);border-radius:2px}
  .prod-rev{font-size:12px;font-weight:700;color:#059669;text-align:right;white-space:nowrap}
  .prod-qty{font-size:10px;color:#64748B;text-align:right}

  /* STAFF RANK */
  .staff-medal{width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;color:#fff;flex-shrink:0}
  .m1{background:#F59E0B}.m2{background:#94A3B8}.m3{background:#92400E}.mn{background:#CBD5E1;color:#64748B}

  /* VALIDATION */
  .validated{background:#ECFDF5;border:2px solid #10B981;border-radius:8px;padding:14px 18px;margin-top:24px}
  .not-validated{background:#FFF1F2;border:2px dashed #F43F5E;border-radius:8px;padding:14px 18px;margin-top:24px}

  /* FOOTER */
  .pdf-footer{margin-top:24px;padding-top:12px;border-top:1px solid #E2E8F0;display:flex;justify-content:space-between;font-size:10px;color:#94A3B8}

  @media print{
    .section{page-break-inside:avoid}
    .two-col{page-break-inside:avoid}
  }
</style>

<!-- COVER SECTION -->
<div class="cover">
  <div class="cover-top">
    <div>
      <div class="cover-bar">${barName}</div>
      <div class="cover-loc">${location}</div>
    </div>
    <div class="cover-report">
      <div class="cover-report-title">${reportLabel}</div>
      <div class="cover-report-sub">${isFr?'Généré le':'Generated'}: ${generatedStr}</div>
      <div class="cover-report-sub">${isFr?'Par':'By'}: ${session.fullName} (${session.role})</div>
    </div>
  </div>
  <hr class="cover-divider">
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
    ${[
      {l:isFr?'Revenu Total':'Total Revenue',v:fmtRWF(totalRevAll)},
      {l:isFr?'Bénéfice Net':'Net Profit',v:fmtRWF(totalNet)},
      {l:isFr?'Marge Nette':'Net Margin',v:grossMargin+'%'},
      {l:isFr?'Transactions':'Transactions',v:String(salesCount)},
    ].map(k=>`<div style="background:rgba(255,255,255,.12);border-radius:8px;padding:12px"><div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px">${k.l}</div><div style="font-size:17px;font-weight:800;font-family:'Courier New',monospace">${k.v}</div></div>`).join('')}
  </div>
</div>

<!-- KPI ROW -->
<div class="kpi-row">
  <div class="kpi-box" style="border-top:3px solid #2563EB"><div class="kpi-lbl">${isFr?'Revenu Bar':'Bar Revenue'}</div><div class="kpi-val" style="color:#2563EB">${fmtRWF(F.barRev)}</div></div>
  <div class="kpi-box" style="border-top:3px solid #0891B2"><div class="kpi-lbl">${isFr?'Revenu Cuisine':'Kitchen Revenue'}</div><div class="kpi-val" style="color:#0891B2">${fmtRWF(kitRevTotal)}</div></div>
  <div class="kpi-box" style="border-top:3px solid ${barNet>=0?'#059669':'#DC2626'}"><div class="kpi-lbl">${isFr?'Bénéf. Net Bar':'Bar Net Profit'}</div><div class="kpi-val" style="color:${barNet>=0?'#059669':'#DC2626'}">${fmtRWF(barNet)}</div></div>
  <div class="kpi-box" style="border-top:3px solid ${kitNet>=0?'#059669':'#DC2626'}"><div class="kpi-lbl">${isFr?'Bénéf. Net Cuisine':'Kitchen Net Profit'}</div><div class="kpi-val" style="color:${kitNet>=0?'#059669':'#DC2626'}">${fmtRWF(kitNet)}</div></div>
  <div class="kpi-box" style="border-top:3px solid #D97706"><div class="kpi-lbl">${isFr?'Val. Moy. Cmd':'Avg Order Value'}</div><div class="kpi-val" style="color:#D97706">${fmtRWF(avgOrderVal)}</div></div>
  <div class="kpi-box" style="border-top:3px solid #DC2626"><div class="kpi-lbl">${isFr?'Dépenses':'Expenses'}</div><div class="kpi-val" style="color:#DC2626">${fmtRWF(F.expenses)}</div></div>
  <div class="kpi-box" style="border-top:3px solid #059669"><div class="kpi-lbl">${isFr?'Valeur du Stock':'Current Stock Value'}</div><div class="kpi-val" style="color:#059669">${fmtRWF(F.stock.total)}</div></div>
</div>

<!-- TWO COLUMN: Revenue Summary + Top Products -->
<div class="two-col">
  <div class="col-card">
    <div class="col-card-title">${isFr?'Résumé Financier':'Financial Summary'}</div>
    <div class="sum-row"><span>${isFr?'Revenu Bar':'Bar Revenue'}</span><span style="font-weight:600;color:#2563EB">${fmtRWF(F.barRev)}</span></div>
    <div class="sum-row"><span>${isFr?'Revenu Cuisine':'Kitchen Revenue'}</span><span style="color:#0891B2;font-weight:600">${fmtRWF(kitRevTotal)}</span></div>
    <div class="sum-row"><span>${isFr?'Coût des Marchandises':'COGS'}</span><span style="color:#DC2626;font-weight:600">− ${fmtRWF(barCogs)}</span></div>
    <div class="sum-row"><span>${isFr?'Dépenses':'Expenses'}</span><span style="color:#DC2626;font-weight:600">− ${fmtRWF(F.expenses)}</span></div>
    ${F.refundsTotal?`<div class="sum-row"><span>${isFr?'Remboursements (déjà déduits)':'Refunds given (already deducted)'}</span><span style="color:#EA580C;font-weight:600">− ${fmtRWF(F.refundsTotal)}</span></div>`:''}
    <div class="sum-row"><span>${isFr?'Achats de Stock':'Inventory Purchases'}</span><span style="color:#D97706;font-weight:600">${fmtRWF(totalPurchases)}</span></div>
    <div class="sum-total"><span>${isFr?'Bénéfice Net':'Net Profit'}</span><span style="color:${totalNet>=0?'#059669':'#DC2626'}">${fmtRWF(totalNet)}</span></div>
  </div>

  <div class="col-card">
    <div class="col-card-title">${isFr?'Top Produits':'Top Products'}</div>
    ${topProducts.slice(0,5).map(([name,data],i)=>`
      <div class="prod-row">
        <div class="prod-rank ${i===0?'':'r'+(i+1)<=3?'r'+(i+1):'rn'}">${i+1}</div>
        <div style="flex:1;min-width:0">
          <div class="prod-name">${name}</div>
          <div class="prod-bar-wrap"><div class="prod-bar-fill" style="width:${Math.round((data.revenue/maxRev)*100)}%"></div></div>
        </div>
        <div>
          <div class="prod-rev">${fmtRWF(data.revenue)}</div>
          <div class="prod-qty">${data.qty} units</div>
        </div>
      </div>
    `).join('')||`<div style="color:#94A3B8;font-size:12px;padding:12px 0">${isFr?'Aucune donnée':'No data'}</div>`}
  </div>
</div>

<!-- TWO COLUMN: Staff + Expenses -->
<div class="two-col">
  <div class="col-card">
    <div class="col-card-title">${isFr?'Performance Personnel':'Staff Performance'}</div>
    ${topStaff.length?`<table>
      <thead><tr><th>#</th><th>${isFr?'Agent':'Staff'}</th><th class="center">Trans.</th><th class="right">${isFr?'Revenu':'Revenue'}</th></tr></thead>
      <tbody>${topStaff.map(([name,data],i)=>`
        <tr>
          <td><div class="staff-medal ${i===0?'m1':i===1?'m2':i===2?'m3':'mn'}">${i+1}</div></td>
          <td style="font-weight:600">${name}</td>
          <td class="center">${data.transactions}</td>
          <td class="right" style="font-weight:700;color:#059669">${fmtRWF(data.revenue)}</td>
        </tr>
      `).join('')}</tbody>
    </table>`:`<div style="color:#94A3B8;font-size:12px;padding:12px 0">${isFr?'Aucune donnée':'No data'}</div>`}
  </div>

  <div class="col-card">
    <div class="col-card-title">${isFr?'Dépenses par Catégorie':'Expenses by Category'}</div>
    ${Object.keys(byCat).length?`<table>
      <thead><tr><th>${isFr?'Catégorie':'Category'}</th><th class="right">${isFr?'Montant':'Amount'}</th><th class="right">%</th></tr></thead>
      <tbody>
        ${Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>`
          <tr><td>${cat}</td><td class="right" style="color:#DC2626;font-weight:600">${fmtRWF(amt)}</td><td class="right" style="color:#94A3B8">${d.totalExp>0?((amt/d.totalExp)*100).toFixed(1):0}%</td></tr>
        `).join('')}
        <tr class="tr-total"><td>Total</td><td class="right" style="color:#DC2626">${fmtRWF(d.totalExp)}</td><td class="right">100%</td></tr>
      </tbody>
    </table>`:`<div style="color:#94A3B8;font-size:12px;padding:12px 0">${isFr?'Aucune dépense':'No expenses'}</div>`}
  </div>
</div>

<!-- FULL SALES LOG -->
<div class="section">
  <div class="section-title">${isFr?'Journal Complet des Ventes':'Full Sales Log'}</div>
  <table>
    <thead><tr><th>${isFr?'Heure':'Time'}</th><th>${isFr?'Produit':'Product'}</th><th class="center">Qté</th><th class="right">${isFr?'Prix Unit.':'Unit Price'}</th><th class="right">Total</th><th>${isFr?'Vendu par':'Sold By'}</th></tr></thead>
    <tbody>
      ${sales.map(s=>`<tr><td style="color:#64748B">${s.time||s.date||''}</td><td style="font-weight:500">${s.productName}</td><td class="center">${s.qty}</td><td class="right">${fmtRWF(s.unitPrice)}</td><td class="right" style="font-weight:700;color:#059669">${fmtRWF(s.total)}</td><td style="color:#64748B">${s.soldBy}</td></tr>`).join('')||`<tr><td colspan="6" style="text-align:center;color:#94A3B8;padding:16px">${isFr?'Aucune vente':'No sales'}</td></tr>`}
    </tbody>
  </table>
</div>

<!-- INVENTORY PURCHASE LOG -->
<div class="section">
  <div class="section-title">${isFr?'Achats de Stock':'Inventory Purchases'} — ${fmtRWF(totalPurchases)}</div>
  <table>
    <thead><tr><th>Date</th><th>${isFr?'Article':'Item'}</th><th>${isFr?'Type':'Inventory'}</th><th class="center">${isFr?'Qté':'Qty'}</th><th>Unit</th><th class="right">${isFr?'Coût/Unité':'Unit Cost'}</th><th class="right">${isFr?'Total':'Total Cost'}</th><th>${isFr?'Fournisseur':'Supplier'}</th><th>${isFr?'Référence':'Reference'}</th><th>${isFr?'Enregistré par':'Recorded By'}</th></tr></thead>
    <tbody>${purchases.map(p=>`<tr><td>${esc(p.purchase_date||p.date||'')}</td><td>${esc(p.item_name)}</td><td>${esc(p.inventory_type)}</td><td class="center">${p.quantity}</td><td>${esc(p.unit||'')}</td><td class="right">${fmtRWF(p.unit_cost)}</td><td class="right" style="font-weight:700;color:#D97706">${fmtRWF(p.total_cost)}</td><td>${esc(p.supplier||'—')}</td><td>${esc(p.reference||'—')}</td><td>${esc(p.recorded_by||'')}</td></tr>`).join('')||`<tr><td colspan="10" class="center" style="color:#94A3B8;padding:16px">${isFr?'Aucun achat enregistré':'No recorded purchases for this period'}</td></tr>`}</tbody>
  </table>
</div>

${F.refunds.length?`<div class="section">
  <div class="section-title">${isFr?'Remboursements':'Refunds'} — ${fmtRWF(F.refundsTotal)}</div>
  <table>
    <thead><tr><th>Date</th><th>${isFr?'Commande':'Order'}</th><th>${isFr?'Articles':'Items'}</th><th class="right">${isFr?'Montant':'Amount'}</th><th>${isFr?'Méthode':'Method'}</th><th>${isFr?'Raison':'Reason'}</th><th>${isFr?'Par':'By'}</th></tr></thead>
    <tbody>${F.refunds.map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.orderNumber)}</td><td>${esc(r.items||'')}</td><td style="text-align:right;font-weight:700;color:#EA580C">${fmtRWF(r.amount)}</td><td>${esc(r.method)}</td><td>${esc(r.reason)}</td><td>${esc(r.by)}</td></tr>`).join('')}</tbody>
  </table>
</div>`:''}

<!-- CURRENT STOCK VALUE -->
<div class="section">
  <div class="section-title">${isFr?'Valeur Actuelle du Stock':'Current Stock Value'} — ${fmtRWF(F.stock.total)}</div>
  <table>
    <tbody>${stockValueRows(F,isFr).map(([l,v])=>`<tr><td>${l}</td><td class="right">${fmtRWF(v)}</td></tr>`).join('')}
      <tr class="tr-total"><td>${isFr?'Total':'Total stock value'}</td><td class="right" style="color:#059669">${fmtRWF(F.stock.total)}</td></tr></tbody>
  </table>
  <div style="font-size:11px;color:#94A3B8;margin-top:6px">${isFr?'Stock actuel au coût moyen d\'achat':'Stock on hand at the time this report was generated, at average purchase cost'}${F.stock.withoutCost?` · ${F.stock.withoutCost} ${isFr?'article(s) sans coût':'item(s) without cost not counted'}`:''}</div>
</div>

${W?rptWorthPdf(W,isFr):''}

<!-- VALIDATION STATUS -->
${_reportValidated
  ?`<div class="validated"><div style="font-weight:800;color:#059669;font-size:14px">${isFr?'RAPPORT VALIDÉ':'VALIDATED REPORT'}</div><div style="font-size:12px;color:#065F46;margin-top:4px">${isFr?'Validé par':'Validated by'}: ${_reportValidatedBy} • ${_reportValidatedAt}</div></div>`
  :`<div class="not-validated"><div style="font-weight:800;color:#F43F5E;font-size:14px">${isFr?'NON VALIDÉ':'NOT VALIDATED'}</div><div style="font-size:12px;color:#9F1239;margin-top:4px">${isFr?'Ce rapport n\'a pas été validé par la direction':'This report has not been validated by management'}</div></div>`
}

<!-- FOOTER -->
<div class="pdf-footer">
  <span>${barName} — Bar Management System</span>
  <span>${isFr?'Imprimé le':'Printed'} ${now.toLocaleDateString(isFr?'fr-FR':'en-RW')}</span>
</div>`;

  printPDF(reportLabel,barName,pdfBody);
}

// ── BUSINESS WORTH (Owner) — assets, money and stock minus debts, on the report's last day ──
async function rptWorth(d){
  if(typeof session==='undefined'||session.role!=='Owner'||typeof arWorthLines!=='function')return null;
  const asOf=[d.to||today(),today()].sort()[0];   // never a day in the future
  const r=await apiGet('reports','worth',{preset:'custom',from:asOf,to:asOf});
  return r.ok?r.data.end:null;
}
function rptWorthCard(e,isFr){
  const lines=arWorthLines(e);
  return `<div class="rpt-card" style="margin-top:16px">
      <div class="rpt-card-header">
        <div class="rpt-card-title">${isFr?'Valeur de l\'entreprise':'Business worth'} <span style="font-weight:500;color:#94A3B8;font-size:12px">${esc(e.asOf)}</span></div>
        <span class="rpt-badge" style="background:#EEF2FF;color:#4338CA">${fmtRWF(Math.round(e.worth))}</span>
      </div>
      <div class="rpt-summary-rows">
        ${lines.map(r=>`<div class="rpt-sum-row"><span class="rpt-sum-label">${esc(r.group)} — ${esc(r.item)}</span><span class="rpt-sum-val" style="${r.value<0?'color:#DC2626':''}">${fmtRWF(Math.round(r.value))}</span></div>`).join('')}
        <div class="rpt-sum-row"><span class="rpt-sum-label">${isFr?'Elle possède':'It owns'}</span><span class="rpt-sum-val">${fmtRWF(Math.round(e.owns))}</span></div>
        <div class="rpt-sum-row"><span class="rpt-sum-label">${isFr?'Elle doit':'It owes'}</span><span class="rpt-sum-val">${fmtRWF(Math.round(e.owes))}</span></div>
        <div class="rpt-sum-row rpt-sum-total"><span class="rpt-sum-label">${isFr?'Valeur de l\'entreprise':'Business worth'}</span><span class="rpt-sum-val" style="color:#4338CA">${fmtRWF(Math.round(e.worth))}</span></div>
        <div style="font-size:11px;color:#94A3B8;margin-top:4px">${isFr?'Argent, stock, biens et créances clients, moins les dettes. Les biens sont enregistrés dans « Biens & Valeur ».':'Money, stock, assets and what customers owe, minus debts. Assets are recorded on the Assets & Worth page.'}${!e.hasStartingBalances?(isFr?' Aucun solde de départ enregistré.':' No starting balance recorded yet.'):''}</div>
      </div>
    </div>`;
}
function rptWorthPdf(e,isFr){
  const lines=arWorthLines(e);
  return `<div class="section">
  <div class="section-title">${isFr?'Valeur de l\'entreprise':'Business worth'} (${esc(e.asOf)}) — ${fmtRWF(Math.round(e.worth))}</div>
  <table>
    <tbody>${lines.map(r=>`<tr><td>${esc(r.group)}</td><td>${esc(r.item)}</td><td class="right">${fmtRWF(Math.round(r.value))}</td></tr>`).join('')}
      <tr><td></td><td>${isFr?'Elle possède':'It owns'}</td><td class="right">${fmtRWF(Math.round(e.owns))}</td></tr>
      <tr><td></td><td>${isFr?'Elle doit':'It owes'}</td><td class="right">${fmtRWF(Math.round(e.owes))}</td></tr>
      <tr class="tr-total"><td></td><td>${isFr?'Valeur de l\'entreprise':'Business worth'}</td><td class="right" style="color:#4338CA">${fmtRWF(Math.round(e.worth))}</td></tr></tbody>
  </table>
  <div style="font-size:11px;color:#94A3B8;margin-top:6px">${isFr?'Argent, stock, biens et créances clients, moins les dettes envers fournisseurs et prêts.':'Money in each account, stock at cost, assets and what customers owe, minus what is owed to suppliers and lenders.'}</div>
</div>`;
}