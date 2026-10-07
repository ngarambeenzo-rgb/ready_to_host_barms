/* ═══════════════════════════════════════════════════
   BARMS PRO — misc.js
   Void requests, customer debts, audit log
   Depends on: utils.js, api.js, auth.js, navigation.js
   LOAD LAST — calls auditAction used by other modules
═══════════════════════════════════════════════════ */

// ── VOID REQUESTS ─────────────────────────────────
async function loadVoidRequests(){
  const res=await apiGet('misc','void_requests_list');
  const reqs=res.data||[];
  const typeLabels={order:'Order',sale:'Sale',kitrev:'Kitchen revenue',expense:'Expense',refund:'Refund'};
  const canAct=r=>r.status==='Pending'&&can(r.type==='refund'?'canGiveRefunds':'canApproveVoids')&&(session.role==='Owner'||(r.requestedBy||r.requested_by)!==session.fullName);
  const actions=r=>canAct(r)
    ?`<button class="btn btn-green btn-sm" onclick="approveVoidRequest(${r.id})">${ic('check')}Approve</button>
       <button class="btn btn-ghost btn-sm" style="margin-left:4px" onclick="rejectVoidRequest(${r.id})">Reject</button>`
    :r.status==='Pending'?`<span class="status warn">Waiting</span>`:'';
  const statusCell=r=>`<span class="badge ${r.status==='Approved'?'badge-green':r.status==='Rejected'?'badge-red':'badge-orange'}">${esc(r.status)}</span>${r.reviewedBy?`<div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(r.reviewedBy)}</div>`:''}`;
  const tail=r=>`
      <td class="muted">${esc(r.requestedBy||r.requested_by||'—')}</td>
      <td style="font-size:12px;color:var(--muted);max-width:220px;white-space:normal">${esc(r.reason||'—')}</td>
      <td class="muted" style="font-size:11px;white-space:nowrap">${esc(r.createdAt||r.created_at||'—')}</td>
      <td>${statusCell(r)}</td>
      <td style="white-space:nowrap">${actions(r)}</td>`;
  const empty=(cols,text)=>`<tr><td colspan="${cols}">${uiEmpty('inbox',text,'')}</td></tr>`;
  const methodOf=r=>{try{return (JSON.parse(r.details||'{}').method)||'—'}catch(e){return '—'}};

  const refunds=reqs.filter(r=>r.type==='refund');
  const voids=reqs.filter(r=>r.type!=='expense'&&r.type!=='refund');
  const exps=reqs.filter(r=>r.type==='expense');
  const pend=l=>l.filter(r=>r.status==='Pending').length;
  [['reqCountRefunds',refunds],['reqCountSales',voids],['reqCountExp',exps]].forEach(([id,l])=>{const e=document.getElementById(id);if(e)e.textContent=pend(l)?pend(l):'';});

  document.getElementById('voidRefundBody').innerHTML=refunds.map(r=>{
    const label=String(r.label||'').replace(/^Refund\s+/,'');
    const [ord,...rest]=label.split(':');
    return `<tr>
      <td><div style="font-weight:600">${esc(ord)}</div><div style="font-size:12px;color:var(--muted);white-space:normal">${esc(rest.join(':').trim())}</div></td>
      <td class="mono" style="font-weight:600">${fmtRWF(r.amount)}</td>
      <td class="muted">${esc(methodOf(r))}</td>${tail(r)}
    </tr>`;}).join('')||empty(8,'No refund requests');

  document.getElementById('voidSalesBody').innerHTML=voids.map(r=>`
    <tr>
      <td><span class="badge badge-orange">${esc(typeLabels[r.type]||r.type)}</span></td>
      <td style="font-weight:600">${esc(r.label)}</td>
      <td class="mono">${fmtRWF(r.amount)}</td>${tail(r)}
    </tr>`).join('')||empty(8,'No void requests');

  document.getElementById('voidExpBody').innerHTML=exps.map(r=>`
    <tr>
      <td style="font-weight:600">${esc(r.label)}</td>
      <td class="mono">${fmtRWF(r.amount)}</td>${tail(r)}
    </tr>`).join('')||empty(7,'No expense void requests');

  // open the first tab this person may use
  const first=[...document.querySelectorAll('#reqTabs .tab')].find(t=>getComputedStyle(t).display!=='none');
  const cur=document.querySelector('#reqTabs .tab.active');
  if(first&&(!cur||getComputedStyle(cur).display==='none'))showVoidTab(first.dataset.reqtab,first);
}

function showVoidTab(tab,el){
  ['refunds','sales','expenses'].forEach(tb=>{
    const e=document.getElementById('voidTab-'+tb);
    if(e)e.style.display=tb===tab?'block':'none';
  });
  document.querySelectorAll('#page-voidreqs .tab').forEach(tb=>tb.classList.remove('active'));
  if(el)el.classList.add('active');
}
async function approveVoidRequest(reqId){
  confirm2('Approve this request?',async()=>{
    const res=await api('misc','void_request_approve',{id:reqId});
    if(!res.ok){toast(res.error,'error');return;}
    toast('Request approved','success');
    loadVoidRequests();updateVoidBadge();
  });
}

async function rejectVoidRequest(reqId){
  confirm2('Reject this request?',async()=>{
    const res=await api('misc','void_request_reject',{id:reqId});
    if(!res.ok){toast(res.error,'error');return;}
    toast('Request rejected','warning');
    loadVoidRequests();updateVoidBadge();
  });
}

async function submitVoidRequest(type,refId,label,amount){
  const reason=document.getElementById('voidReasonInput')?.value?.trim()||'';
  if(!reason){toast('Please enter a reason','error');return;}
  const res=await api('misc','void_request_submit',{type,refId,label,amount,reason});
  if(!res.ok){toast(res.error,'error');return;}
  closeModal();
  toast('Request sent — it waits in Requests until the Owner approves it','success');
  updateVoidBadge();
}

async function updateVoidBadge(){
  if(!(session.role==='Owner'||(session.role==='Manager'&&(can('canApproveVoids')||can('canGiveRefunds')))))return;
  const res=await apiGet('misc','void_requests_list');
  const pending=(res.data||[]).filter(r=>r.status==='Pending'&&can(r.type==='refund'?'canGiveRefunds':'canApproveVoids')).length;
  const badge=document.querySelector('#nav-voidreqs .nav-badge');
  if(badge){badge.textContent=pending;badge.style.display=pending>0?'inline-block':'none';}
}

// ── CUSTOMER DEBTS ────────────────────────────────
async function saveCustDebt(){
  const customerName=document.getElementById('cdName').value.trim();
  const phone=document.getElementById('cdPhone').value.trim();
  const amount=+document.getElementById('cdAmount').value||0;
  const note=document.getElementById('cdDesc').value.trim();
  const date=document.getElementById('cdDate').value||today();
  if(!customerName||amount<=0){toast(t('fillRequired'),'error');return;}
  const res=await api('misc','cust_debt_save',{customerName,phone,amount,note,date});
  if(!res.ok){toast(res.error,'error');return;}
  ['cdName','cdPhone','cdDesc'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('cdAmount').value=0;
  document.getElementById('cdDate').value='';
  toast(t('debtRecorded'));
  loadCustDebts();
}

function markDebtPaidCust(id){
  document.getElementById('modalContent').innerHTML=`
    <h3>Debt paid</h3>
    <div class="form-group"><label class="form-label">How did the customer pay? *</label>
      <select class="form-input" id="debtPayMethod">
        <option value="Cash">Cash (into the drawer)</option><option value="MoMo">MoMo</option>
        <option value="Bank">Bank</option><option value="Card">Card</option>
      </select></div>
    <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="confirmDebtPaidCust(${+id})">Confirm payment</button>`;
  document.getElementById('modalOverlay').classList.add('show');
}
async function confirmDebtPaidCust(id){
  const res=await api('misc','cust_debt_paid',{id,method:document.getElementById('debtPayMethod').value});
  if(!res.ok){toast(res.error,'error');return;}
  closeModal();
  toast(t('markedPaid'));
  loadCustDebts();
}

async function deleteCustDebt(id){
  confirm2('Delete this customer debt record?',async()=>{
    const res=await api('misc','cust_debt_delete',{id});
    if(!res.ok){toast(res.error,'error');return;}
    toast(t('deleted'),'warning');
    loadCustDebts();
  });
}

async function loadCustDebts(){
  const res=await apiGet('misc','cust_debts_list');
  const debts=res.data||[];
  const pending=debts.filter(d=>d.status==='Pending');
  const paid=debts.filter(d=>d.status==='Paid');
  const totalOwed=pending.reduce((a,d)=>a+d.amount,0);
  const totalEl=document.getElementById('cdUnpaidTotal');
  if(totalEl)totalEl.textContent=fmtRWF(totalOwed);
  const paidEl=document.getElementById('cdPaidTotal');
  if(paidEl)paidEl.textContent=`${paid.length} paid (last 90 days)`;

  document.getElementById('cdUnpaidBody').innerHTML=pending.map(d=>`
    <tr>
      <td style="font-weight:600">${esc(d.customerName)}</td>
      <td class="muted">${d.phone||'—'}</td>
      <td class="mono" style="color:var(--orange)">${fmtRWF(d.amount)}</td>
      <td class="muted">${d.date}</td>
      <td class="muted">${d.note||'—'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-green btn-sm" onclick="markDebtPaidCust(${d.id})">${t('markPaid')}</button>
        ${can('canDeleteRecords')?`<button class="btn btn-ghost btn-sm" style="color:var(--red);margin-left:4px" onclick="deleteCustDebt(${d.id})">${t('delete2')}</button>`:''}
      </td>
    </tr>`).join('')||`<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">No unpaid debts </td></tr>`;

  const cdPaidBody=document.getElementById('cdPaidBody');
  if(cdPaidBody)cdPaidBody.innerHTML=paid.map(d=>`
    <tr>
      <td style="font-weight:600">${esc(d.customerName)}</td>
      <td class="mono" style="color:var(--green)">${fmtRWF(d.amount)}</td>
      <td class="muted">${d.date}</td>
      <td class="muted">—</td>
    </tr>`).join('')||`<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px">No paid debts yet</td></tr>`;
}

// ── AUDIT LOG ─────────────────────────────────────
async function auditAction(type,details){
  await api('misc','audit_add',{type,details});
}

async function loadAuditLog(){
  const typeFilter=document.getElementById('auditFilter')?.value||'';
  const userFilter=document.getElementById('auditUserFilter')?.value||'';
  const dateFilter=document.getElementById('auditDate')?.value||'';
  const params={};
  if(typeFilter)params.type=typeFilter;
  if(userFilter||dateFilter)params.filter=userFilter||dateFilter;
  const res=await apiGet('misc','audit_list',params);
  const log=res.data||[];
  document.getElementById('auditCount').textContent=`${log.length} records`;
  const typeColors={SALE:'badge-green',VOID:'badge-red',STOCK:'badge-cyan',PRICE:'badge-gold',LOGIN:'badge-blue',EXPENSE:'badge-orange',PRODUCT:'badge-purple',SETTINGS:'badge-blue',FRAUD:'badge-red',SALARY:'badge-green',USER:'badge-purple'};
  document.getElementById('auditBody').innerHTML=log.map(l=>`
    <tr>
      <td class="mono" style="font-size:11px;white-space:nowrap">${l.time ? new Date(l.time).toLocaleString('en-RW',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'}</td>
      <td style="font-weight:600">${l.by}</td>
      <td><span class="badge badge-purple" style="font-size:10px">${l.role||'—'}</span></td>
      <td><span class="badge ${typeColors[l.type]||'badge-blue'}" style="font-size:10px">${l.type}</span></td>
      <td style="font-size:12px;color:var(--muted);max-width:300px">${esc(l.details)}</td>
      <td></td>
    </tr>`).join('')||`<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px">${t('noAudit')}</td></tr>`;
}

function clearAuditFilter(){
  document.getElementById('auditFilter').value='';
  document.getElementById('auditUserFilter').value='';
  document.getElementById('auditDate').value='';
  loadAuditLog();
}
