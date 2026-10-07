/* ═══════════════════════════════════════════════════
   BARMS PRO — employees.js
   Employees, debts, salary payments
   Depends on: utils.js, api.js, auth.js
═══════════════════════════════════════════════════ */

let _editEmpId=0;
let _allEmps=[];

function showEmpTab(tab,el){
  ['list','debts','salary','perf'].forEach(tb=>{const e=document.getElementById('empTab-'+tb);if(e)e.style.display=tb===tab?'block':'none';});
  document.querySelectorAll('#page-employees .tab').forEach(tb=>tb.classList.remove('active'));
  if(el)el.classList.add('active');
  if(tab==='list')   loadEmployees();
  if(tab==='debts')  loadDebts();
  if(tab==='salary') {loadSalaryHistory();loadPayEmpSelect();}
  if(tab==='perf')   loadEmpPerfTab();
}

async function loadEmployees(){
  const res=await apiGet('employees','list');
  _allEmps=res.data||[];
  document.getElementById('empListBody').innerHTML=_allEmps.map(e=>`
    <tr><td style="font-weight:600">${esc(e.fullName)}</td><td class="muted">${esc(e.position)}</td>
    <td class="muted">${esc(e.phone)}</td>
    <td class="mono" style="color:var(--green)">${fmtRWF(e.salary)}</td>
    <td class="muted">${e.hireDate}</td>
    <td>${e.userId ? `<span class="badge badge-green">${esc(e.username)} · ${esc(e.user_role)}</span>` : '<span class="muted">Not linked</span>'}</td>
    <td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" onclick="editEmp(${e.id})">${t('edit2')}</button>
      ${e.userId ? `<button class="btn btn-ghost btn-sm" onclick="openEmpPerformance(${e.id})">${ic('barchart')}Performance</button>` : ''}</td></tr>
  `).join('')||`<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px">${t('noEmployees')}</td></tr>`;
  loadLinkableUsers();
  const opts=_allEmps.map(e=>`<option value="${e.id}">${esc(e.fullName)}</option>`).join('');
  ['debtEmp','payEmp'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=opts;});
}

async function saveEmployee(){
  const name=document.getElementById('empName').value.trim();
  if(!name){toast(t('nameRequired'),'error');return;}
  const data={
    id:_editEmpId||0,fullName:name,
    position:document.getElementById('empPosition').value,
    phone:document.getElementById('empPhone').value,
    salary:+document.getElementById('empSalary').value||0,
    userId:+document.getElementById('empUser')?.value||0,
  };
  const res=await api('employees','save',data);
  if(!res.ok){toast(res.error,'error');return;}
  toast(_editEmpId?t('employeeUpdated'):t('employeeSaved'));
  clearEmpForm();loadEmployees();
}

function editEmp(id){
  const e=_allEmps.find(x=>x.id===id);if(!e)return;
  _editEmpId=id;
  document.getElementById('empName').value=e.fullName;
  document.getElementById('empPosition').value=e.position;
  document.getElementById('empPhone').value=e.phone;
  document.getElementById('empSalary').value=e.salary;
  loadLinkableUsers(e.userId);
  document.getElementById('empFormTitle').textContent='Edit Employee';
}

function clearEmpForm(){
  _editEmpId=0;
  ['empName','empPosition','empPhone'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('empSalary').value=0;
  loadLinkableUsers();
  document.getElementById('empFormTitle').textContent='Add Employee';
}

async function saveDebt(){
  const empId=+document.getElementById('debtEmp').value;
  const amount=+document.getElementById('debtAmount').value||0;
  const note=document.getElementById('debtNote').value||'Advance';
  if(amount<=0){toast(t('enterAmount'),'error');return;}
  const res=await api('employees','debt_save',{empId,amount,note});
  if(!res.ok){toast(res.error,'error');return;}
  toast(t('debtRecorded'));loadDebts();
}

async function loadDebts(){
  const res=await apiGet('employees','debt_list');
  const debts=res.data||[];
  document.getElementById('debtListBody').innerHTML=debts.map(d=>`
    <tr><td style="font-weight:600">${d.empName}</td>
    <td class="mono" style="color:var(--orange)">${fmtRWF(d.amount)}</td>
    <td class="muted">${d.note}</td><td class="muted">${d.date}</td>
    <td><span class="badge ${d.status==='Paid'?'badge-green':'badge-orange'}">${d.status==='Paid'?t('paid'):t('pending')}</span>
    ${d.status!=='Paid'?`<button class="btn btn-ghost btn-sm" onclick="markDebtPaid(${d.id})" style="margin-left:6px">${t('markPaid')}</button>`:''}</td></tr>
  `).join('')||`<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">${t('noDebts')}</td></tr>`;
}

async function markDebtPaid(id){
  const res=await api('employees','debt_paid',{id});
  if(!res.ok){toast(res.error,'error');return;}
  toast(t('markedPaid'));loadDebts();
}

function onPayEmpChange(){
  const id=+document.getElementById('payEmp').value;
  const emp=_allEmps.find(e=>e.id===id);
  if(emp)document.getElementById('payAmount').value=emp.salary;
}

function loadPayEmpSelect(){
  const opts=_allEmps.map(e=>`<option value="${e.id}">${esc(e.fullName)}</option>`).join('');
  document.getElementById('payEmp').innerHTML=opts;
  onPayEmpChange();
}

async function paySalary(){
  const empId=+document.getElementById('payEmp').value;
  const gross=+document.getElementById('payAmount').value||0;
  const note=document.getElementById('payNote').value||'Salary payment';
  if(gross<=0){toast(t('enterAmount'),'error');return;}
  const emp=_allEmps.find(e=>e.id===empId);
  const dRes=await apiGet('employees','debt_list');
  const unpaid=(dRes.data||[]).filter(d=>d.empId===empId&&d.status==='Pending');
  const debtTotal=unpaid.reduce((a,d)=>a+d.amount,0);
  const netPay=Math.max(0,gross-debtTotal);
  if(debtTotal>0){
    document.getElementById('modalContent').innerHTML=`
      <h3>Salary Payment Breakdown</h3>
      <p style="font-size:13px;color:var(--muted);margin:10px 0 20px">Employee: <strong>${emp?.fullName||''}</strong></p>
      <div style="background:var(--bg);border-radius:var(--r-sm);padding:16px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
          <span>Gross Salary</span><span style="font-weight:700;font-variant-numeric:tabular-nums">${fmtRWF(gross)}</span>
        </div>
        ${unpaid.map(d=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--red)">
          <span>− Debt: ${d.note}</span><span style="font-weight:700;font-variant-numeric:tabular-nums">− ${fmtRWF(d.amount)}</span>
        </div>`).join('')}
        <div style="display:flex;justify-content:space-between;padding:10px 0;font-size:15px;font-weight:800;color:${netPay>=0?'var(--green)':'var(--red)'}">
          <span>Net Pay</span><span style="font-variant-numeric:tabular-nums">${fmtRWF(netPay)}</span>
        </div>
      </div>
      <button class="btn btn-green" style="width:100%;justify-content:center" onclick="confirmPaySalary(${empId},${gross},'${note.replace(/'/g,"\\'")}')">✓ Confirm & Pay ${fmtRWF(netPay)}</button>`;
    document.getElementById('modalOverlay').classList.add('show');
  }else{
    confirmPaySalary(empId,gross,note);
  }
}

async function confirmPaySalary(empId,gross,note){
  closeModal();
  const res=await api('employees','salary_pay',{empId,amount:gross,note});
  if(!res.ok){toast(res.error,'error');return;}
  const emp=_allEmps.find(e=>e.id===empId);
  toast(`${fmtRWF(res.netPay)} paid to ${emp?.fullName||''}${res.debtTotal>0?' ('+fmtRWF(res.debtTotal)+' debt deducted)':''}`);
  loadSalaryHistory();loadDebts();
}

async function loadSalaryHistory(){
  const res=await apiGet('employees','salary_list');
  const pays=res.data||[];
  document.getElementById('salaryHistoryBody').innerHTML=pays.map(p=>`
    <tr><td style="font-weight:600">${p.empName}</td>
    <td class="mono" style="color:var(--green)">${fmtRWF(p.amount)}</td>
    <td>${p.deductedDebt>0?`<span style="font-size:11px;color:var(--red)">−${fmtRWF(p.deductedDebt)} debt</span>`:`<span style="font-size:11px;color:var(--muted)">No deductions</span>`}</td>
    <td class="muted">${p.note}</td><td class="muted">${p.date}</td></tr>
  `).join('')||`<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">${t('noSalary')}</td></tr>`;
}

// ── LINK TO A BARMS ACCOUNT ───────────────────────
// Only accounts not yet linked to another employee can be chosen
async function loadLinkableUsers(selected){
  const sel=document.getElementById('empUser');
  if(!sel)return;
  const res=await apiGet('employees','linkable_users');
  if(!res.ok)return;
  const current=selected!==undefined?selected:(_allEmps.find(x=>x.id===_editEmpId)?.userId||null);
  sel.innerHTML='<option value="">— No account —</option>'+res.data
    .filter(u=>!u.employee_id||(_editEmpId&&+u.employee_id===_editEmpId))
    .map(u=>`<option value="${+u.id}" ${+u.id===+current?'selected':''}>${esc(u.full_name)} (${esc(u.username)} · ${esc(u.role)})</option>`).join('');
}

// ── PERFORMANCE ───────────────────────────────────
let _perfEmpId=null,_perfPreset='this_month';
function openEmpPerformance(id){
  _perfEmpId=id;
  const tab=[...document.querySelectorAll('#page-employees .tab')].find(t=>t.textContent.includes('Performance'));
  showEmpTab('perf',tab);
}
function loadEmpPerfTab(){
  const linked=_allEmps.filter(e=>e.userId);
  const sel=document.getElementById('perfEmp');
  if(!_perfEmpId||!linked.some(e=>e.id===_perfEmpId))_perfEmpId=linked[0]?.id||null;
  sel.innerHTML=linked.map(e=>`<option value="${e.id}" ${e.id===_perfEmpId?'selected':''}>${esc(e.fullName)} (${esc(e.username)})</option>`).join('')||'<option value="">No employee is linked to an account</option>';
  document.getElementById('perfPresets').innerHTML=[['today','Today'],['this_week','This week'],['last_week','Last week'],['this_month','This month'],['last_month','Last month']]
    .map(([k,l])=>`<button class="ar-chip ${_perfPreset===k?'active':''}" onclick="_perfPreset='${k}';loadEmpPerfTab()">${l}</button>`).join('');
  loadEmpPerformance();
}
async function loadEmpPerformance(){
  const el=document.getElementById('perfContent');
  const id=+document.getElementById('perfEmp').value||0;
  if(!id){el.innerHTML='<div class="ar-empty">Link an employee to their BarMS account (Employees tab → Edit → BarMS account) to see their performance.</div>';return;}
  _perfEmpId=id;
  el.innerHTML=uiLoader('Loading performance');
  const res=await apiGet('employees','performance',{employeeId:id,preset:_perfPreset});
  if(!res.ok){el.innerHTML=`<div class="ar-empty">${esc(res.error||'Could not load')}</div>`;return;}
  const d=res.data,M=v=>fmtRWF(Math.round(+v||0));
  const kpi=(l,v,sub='',tone='')=>`<div class="ar-kpi static"><div class="ar-kpi-label">${l}</div><div class="ar-kpi-value ${tone}">${v}</div>${sub?`<div class="ar-kpi-sub">${sub}</div>`:''}</div>`;
  const voids=d.voidRequests.reduce((a,v)=>a+v.count,0);
  const max=Math.max(1,...d.byDay.map(x=>x.sales));
  el.innerHTML=`
    <div class="ar-note" style="margin-bottom:12px">${esc(res.employee.name)} · BarMS account <strong>${esc(d.user.username)}</strong> (${esc(d.user.role)}) · ${esc(res.period.label)} ${esc(res.period.from)} → ${esc(res.period.to)}</div>
    <div class="ar-kpis">
      ${kpi('Sales made',M(d.sales.total),`${d.sales.orders} order(s) · ${(+d.sales.items).toLocaleString()} item(s)`,'ar-good')}
      ${kpi('Average order',M(d.sales.avgOrder),`${d.sales.activeDays} day(s) with sales`)}
      ${kpi('Payments taken',M(d.paymentsTotal),d.payments.map(p=>`${esc(p.method)} ${M(p.amount)}`).join(' · ')||'None')}
      ${kpi('Discounts given',M(d.discounts.amount),`${d.discounts.count} bill(s)`,d.discounts.count?'ar-warn':'')}
      ${kpi('Refunds given',M(d.refunds.amount),`${d.refunds.count} refund(s)`,d.refunds.count?'ar-warn':'')}
      ${kpi('Void / refund requests',voids,d.voidRequests.map(v=>`${v.count} ${esc(v.type)} ${esc(v.status.toLowerCase())}`).join(' · ')||'None')}
      ${kpi('Shifts',d.shifts.count,d.shifts.closed?`Cash difference ${d.shifts.difference>0?'+':''}${M(d.shifts.difference)} · ${d.shifts.withDifference} shift(s) not matching`:'No closed shift',Math.abs(d.shifts.difference)>=1?'ar-warn':'')}
      ${kpi('Expenses recorded',M(d.expensesRecorded))}
      ${d.kitchen.accepted||d.kitchen.served?kpi('Kitchen orders',`${d.kitchen.accepted} accepted · ${d.kitchen.served} served`,d.kitchen.avgPrepMinutes!==null?`Average ${d.kitchen.avgPrepMinutes} min from accepting to ready`:''):''}
    </div>
    <div class="ar-kpis" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))">
      <div class="ar-section"><div class="ar-section-title">Top items sold</div>
        ${bxHBars({items:d.topItems.map(i=>({label:i.name,value:i.total,sub:(+i.qty).toLocaleString()+' sold'})),fmt:v=>M(v),emptyText:'No sales in this period'})}</div>
      <div class="ar-section"><div class="ar-section-title">Sales by day</div>
        ${bxColumns({categories:d.byDay.map(x=>new Date(x.date+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'})),series:[{name:'Sales',values:d.byDay.map(x=>x.sales)}],fmt:v=>fmtRWF(Math.round(v)),height:180,emptyText:'No sales in this period'})}
    </div>
    <div class="ar-note">Figures come from what was recorded under this BarMS account. Refunds, voids and cash differences are shown for review — they are not proof of wrongdoing.</div>`;
}
