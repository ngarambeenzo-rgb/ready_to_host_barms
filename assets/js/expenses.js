/* ═══════════════════════════════════════════════════
   BARMS PRO — expenses.js
   Expenses: record, list, void
   Depends on: utils.js, api.js, auth.js
═══════════════════════════════════════════════════ */

let _expensesById={};

async function saveExpense(){
  const desc=document.getElementById('expDesc').value.trim();
  const amount=+document.getElementById('expAmount').value||0;
  if(!desc||amount<=0){toast(t('fillRequired'),'error');return;}

  const clientUuid = newUuid();
  const timestamp  = new Date().toISOString();
  const data={
    desc, amount,
    category: document.getElementById('expCategory').value,
    paymentMethod: document.getElementById('expMethod')?.value || 'Cash',
    date: document.getElementById('expDate').value||today(),
    clientUuid,
  };

  // Write to sync_queue first
  try {
    await dbPut('sync_queue', {
      clientUuid,
      type: 'expense',
      payload: data,
      timestamp,
      status: 'pending',
      retryCount: 0,
    });
  } catch(e) {}

  const res=await api('expenses','save',data);

  if(res.ok){
    try { await dbDelete('sync_queue', clientUuid); } catch(e) {}
    document.getElementById('expDesc').value='';
    document.getElementById('expAmount').value=0;
    toast(t('expenseRecorded'));
    loadExpenses();
    await updateSyncBadge();
  } else if(res.error === 'offline') {
    toast(`Expense saved offline — will sync when connected`, 'warning');
    document.getElementById('expDesc').value='';
    document.getElementById('expAmount').value=0;
    await updateSyncBadge();
    await registerBackgroundSync();
  } else {
    try { await dbDelete('sync_queue', clientUuid); } catch(e) {}
    toast(res.error||'Error','error');
  }
}

async function loadExpenses(){
  const res=await apiGet('expenses','list');
  if(!res.ok)return;
  const expenses=res.data||[];
  _expensesById={};
  expenses.forEach(e=>{_expensesById[e.id]=e;});
  const mo=today().slice(0,7);
  const monthTotal=expenses.filter(e=>!e.voided&&e.date.startsWith(mo)).reduce((a,e)=>a+e.amount,0);
  document.getElementById('expMonthTotal').textContent=fmtRWF(monthTotal);
  document.getElementById('expensesBody').innerHTML=expenses.map(e=>`
    <tr class="${e.voided?'void-row':''}">
      <td class="muted">${esc(e.date)}</td>
      <td>${e.voided?'<s>'+esc(e.desc)+'</s>':esc(e.desc)}</td>
      <td><span class="badge badge-orange">${esc(e.category)}</span></td>
      <td class="mono" style="font-weight:700;color:${e.voided?'var(--faint)':'var(--red)'}">${fmtRWF(e.amount)}</td>
      <td class="muted">${esc(e.method || 'Not recorded')}</td>
      <td class="muted">${esc(e.by)}</td>
      <td>${e.voided
        ?`<span class="badge badge-red">${t('voided')}</span>`
        :can('canVoidExpenses')
          ?`<button class="btn btn-ghost btn-sm" onclick="voidExpense(${e.id})">${t('void2')}</button>`
          :session.role==='Manager'
            ?`<button class="btn btn-ghost btn-sm" style="color:var(--orange)" onclick="requestVoidExpense(${e.id})">${t('requestVoid')}</button>`
            :''
      }</td>
    </tr>`).join('');
}

async function voidExpense(id){
  confirm2('Void this expense?',async()=>{
    const res=await api('expenses','void',{id});
    if(!res.ok){toast(res.error,'error');return;}
    toast('Expense voided','warning');
    loadExpenses();
  });
}

function submitExpenseVoidRequest(expId){
  const e=_expensesById[expId];
  if(!e)return;
  submitVoidRequest('expense',e.id,e.desc,e.amount);
}

async function requestVoidExpense(expId){
  const e=_expensesById[expId];
  if(!e)return;
  document.getElementById('modalContent').innerHTML=`
    <h3>Request Expense Void</h3>
    <p style="font-size:13px;color:var(--muted);margin:10px 0 16px">Expense: <strong>${esc(e.desc)}</strong> — ${fmtRWF(e.amount)}</p>
    <div class="form-group">
      <label class="form-label">Reason *</label>
      <textarea class="form-input" id="voidReasonInput" rows="3" placeholder="Explain why this expense should be voided…" style="resize:vertical"></textarea>
    </div>
    <button class="btn btn-primary" onclick="submitExpenseVoidRequest(${e.id})">Submit to Owner</button>`;
  document.getElementById('modalOverlay').classList.add('show');
}
