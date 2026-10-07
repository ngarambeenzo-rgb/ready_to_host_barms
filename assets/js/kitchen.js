/* ═══════════════════════════════════════════════════
   BARMS PRO — kitchen.js
   Kitchen: revenue, expenses, P&L, PDF export
   Depends on: utils.js, api.js, auth.js
═══════════════════════════════════════════════════ */

function showKitTab(tab,el){
  ['revenue','expenses','profit'].forEach(tb=>{
    const e=document.getElementById('kitTab-'+tb);
    if(e)e.style.display=tb===tab?'block':'none';
  });
  document.querySelectorAll('#page-kitchen .tab').forEach(tb=>tb.classList.remove('active'));
  if(el)el.classList.add('active');
  if(tab==='revenue')  loadKitRevenue();
  if(tab==='expenses') loadKitExpenses();
  if(tab==='profit')   {loadKitPnl();document.getElementById('kitPnlDate').value=today();}
}

async function loadKitchenKpis(){
  const [revRes,expRes]=await Promise.all([apiGet('kitchen','revenue_list'),apiGet('kitchen','expense_list')]);
  const rev=revRes.data||[],exp=expRes.data||[];
  const td=today(),mo=td.slice(0,7);
  const todayRev=rev.filter(r=>r.date===td).reduce((a,r)=>a+r.amount,0);
  const todayExp=exp.filter(e=>e.date===td).reduce((a,e)=>a+e.amount,0);
  const monthRev=rev.filter(r=>r.date.startsWith(mo)).reduce((a,r)=>a+r.amount,0);
  document.getElementById('kitKpiRow').innerHTML=[
    kpiCard("Today's Revenue",fmtRWF(todayRev),'Kitchen only','cyan',''),
    kpiCard("Today's Expenses",fmtRWF(todayExp),'Kitchen costs','red',''),
    kpiCard("Today's Profit",fmtRWF(todayRev-todayExp),(todayRev-todayExp)>=0?'Profitable':'Loss',(todayRev-todayExp)>=0?'green':'red',''),
    kpiCard('Month Revenue',fmtRWF(monthRev),new Date().toLocaleDateString('en-RW',{month:'long'}),'gold',''),
  ].join('');
}

async function saveKitRevenue(){
  const amount=+document.getElementById('kitRevAmount').value||0;
  if(amount<=0){toast(t('enterAmount'),'error');return;}
  const res=await api('kitchen','revenue_save',{
    amount,note:document.getElementById('kitRevNote').value||'Daily revenue',
    date:document.getElementById('kitRevDate').value||today()
  });
  if(!res.ok){toast(res.error,'error');return;}
  document.getElementById('kitRevAmount').value=0;
  document.getElementById('kitRevNote').value='';
  toast(t('kitRevenueRecorded'));
  loadKitRevenue();loadKitchenKpis();
}

async function loadKitRevenue(){
  const res=await apiGet('kitchen','revenue_list');
  const rev=res.data||[];
  const mo=today().slice(0,7);
  const monthTotal=rev.filter(r=>r.date.startsWith(mo)).reduce((a,r)=>a+r.amount,0);
  document.getElementById('kitRevMonthTotal').textContent=fmtRWF(monthTotal);
  document.getElementById('kitRevenueBody').innerHTML=rev.map(r=>`
    <tr><td class="muted">${r.date}</td>
    <td class="mono" style="font-weight:700;color:var(--cyan)">${fmtRWF(r.amount)}</td>
    <td class="muted">${r.note}</td><td class="muted">${r.by}</td>
    <td>${session.role==='Owner'
      ?`<button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteKitRev(${r.id})">${t('delete2')}</button>`
      :session.role==='Manager'
        ?`<button class="btn btn-ghost btn-sm" style="color:var(--orange)" onclick="requestKitRevDelete(${r.id},'${(r.note||'').replace(/'/g,"\\'")}',${r.amount})">${t('requestDelete')}</button>`
        :''
    }</td></tr>`).join('')||`<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">${t('noKitRev')}</td></tr>`;
}

async function deleteKitRev(id){
  confirm2('Delete this kitchen revenue entry?',async()=>{
    const res=await api('kitchen','revenue_delete',{id});
    if(!res.ok){toast(res.error,'error');return;}
    toast(t('deleted'),'warning');
    loadKitRevenue();loadKitchenKpis();
  });
}

function requestKitRevDelete(revId,note,amount){
  document.getElementById('modalContent').innerHTML=`
    <h3>Request Kitchen Revenue Deletion</h3>
    <p style="font-size:13px;color:var(--muted);margin:10px 0 16px">Requesting to delete: <strong>${note}</strong> — ${fmtRWF(amount)}</p>
    <div class="form-group">
      <label class="form-label">Reason *</label>
      <textarea class="form-input" id="voidReasonInput" rows="3" placeholder="Explain why this entry should be deleted…" style="resize:vertical"></textarea>
    </div>
    <button class="btn btn-primary" onclick="submitVoidRequest('kitrev',${revId},'${note}',${amount})">Submit Request to Owner</button>`;
  document.getElementById('modalOverlay').classList.add('show');
}

async function saveKitExpense(){
  const desc=document.getElementById('kitExpDesc').value.trim();
  const amount=+document.getElementById('kitExpAmount').value||0;
  if(!desc||amount<=0){toast(t('fillRequired'),'error');return;}
  const res=await api('kitchen','expense_save',{
    desc,amount,
    category:document.getElementById('kitExpCategory').value,
    date:document.getElementById('kitExpDate').value||today()
  });
  if(!res.ok){toast(res.error,'error');return;}
  document.getElementById('kitExpDesc').value='';
  document.getElementById('kitExpAmount').value=0;
  toast(t('kitExpRecorded'));
  loadKitExpenses();loadKitchenKpis();
}

async function loadKitExpenses(){
  const res=await apiGet('kitchen','expense_list');
  const exp=res.data||[];
  const mo=today().slice(0,7);
  const monthTotal=exp.filter(e=>e.date.startsWith(mo)).reduce((a,e)=>a+e.amount,0);
  document.getElementById('kitExpMonthTotal').textContent=fmtRWF(monthTotal);
  document.getElementById('kitExpensesBody').innerHTML=exp.map(e=>`
    <tr><td class="muted">${e.date}</td><td>${e.desc}</td>
    <td><span class="badge badge-orange">${e.category}</span></td>
    <td class="mono" style="font-weight:700;color:var(--red)">${fmtRWF(e.amount)}</td>
    <td class="muted">${e.by}</td>
    <td><button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteKitExp(${e.id})">${t('delete2')}</button></td>
    </tr>`).join('')||`<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">${t('noKitExp')}</td></tr>`;
}

async function deleteKitExp(id){
  confirm2('Delete this kitchen expense?',async()=>{
    await api('kitchen','expense_delete',{id});
    toast(t('deleted'),'warning');
    loadKitExpenses();loadKitchenKpis();
  });
}

async function loadKitPnl(){
  const period=document.getElementById('kitPnlPeriod').value;
  const date=document.getElementById('kitPnlDate').value||today();
  const [revRes,expRes]=await Promise.all([apiGet('kitchen','revenue_list'),apiGet('kitchen','expense_list')]);
  let rev=revRes.data||[],exp=expRes.data||[];
  if(period==='day'){rev=rev.filter(r=>r.date===date);exp=exp.filter(e=>e.date===date);}
  else if(period==='month'){const mo=date.slice(0,7);rev=rev.filter(r=>r.date.startsWith(mo));exp=exp.filter(e=>e.date.startsWith(mo));}
  const totalRev=rev.reduce((a,r)=>a+r.amount,0);
  const totalExp=exp.reduce((a,e)=>a+e.amount,0);
  const profit=totalRev-totalExp;
  const pnlEl=document.getElementById('kitPnlContent');
  if(pnlEl)pnlEl.innerHTML=`
    <div style="display:flex;flex-direction:column;gap:12px">
      ${[['Revenue',totalRev,'var(--cyan)'],['Expenses',totalExp,'var(--red)'],['Profit/Loss',profit,profit>=0?'var(--green)':'var(--red)']].map(([label,val,col])=>`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:14px;background:var(--card);border-radius:var(--r-sm);border:1px solid var(--border)">
          <span style="font-weight:600;font-size:14px">${label}</span>
          <span style="font-weight:800;font-variant-numeric:tabular-nums;font-size:16px;color:${col}">${fmtRWF(val)}</span>
        </div>`).join('')}
    </div>`;
}

async function exportKitchenPDF(){
  const period=document.getElementById('kitPnlPeriod').value;
  const date=document.getElementById('kitPnlDate').value||today();
  const [revRes,expRes,setRes]=await Promise.all([apiGet('kitchen','revenue_list'),apiGet('kitchen','expense_list'),apiGet('misc','settings_get')]);
  let rev=revRes.data||[],exp=expRes.data||[];
  const label=period==='day'?date:date.slice(0,7);
  if(period==='day'){rev=rev.filter(r=>r.date===date);exp=exp.filter(e=>e.date===date);}
  else{const mo=date.slice(0,7);rev=rev.filter(r=>r.date.startsWith(mo));exp=exp.filter(e=>e.date.startsWith(mo));}
  const totalRev=rev.reduce((a,r)=>a+r.amount,0);
  const totalExp=exp.reduce((a,e)=>a+e.amount,0);
  const profit=totalRev-totalExp;
  const barName=(setRes.data||{}).barName||'BarMS Pro';
  printPDF(`Kitchen P&L — ${label}`,barName,`
    <h3>Revenue</h3>
    <table border="1" cellpadding="6" style="width:100%;border-collapse:collapse">
      <tr><th>Date</th><th>Amount</th><th>Note</th><th>By</th></tr>
      ${rev.map(r=>`<tr><td>${r.date}</td><td>${fmtRWF(r.amount)}</td><td>${r.note}</td><td>${r.by}</td></tr>`).join('')}
    </table>
    <h3 style="margin-top:16px">Expenses</h3>
    <table border="1" cellpadding="6" style="width:100%;border-collapse:collapse">
      <tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th></tr>
      ${exp.map(e=>`<tr><td>${e.date}</td><td>${e.desc}</td><td>${e.category}</td><td>${fmtRWF(e.amount)}</td></tr>`).join('')}
    </table>
    <h3 style="margin-top:16px">Summary</h3>
    <p>Revenue: <strong>${fmtRWF(totalRev)}</strong> | Expenses: <strong>${fmtRWF(totalExp)}</strong> | Profit: <strong style="color:${profit>=0?'green':'red'}">${fmtRWF(profit)}</strong></p>
  `);
}
