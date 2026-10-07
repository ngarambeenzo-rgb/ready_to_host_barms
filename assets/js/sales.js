/* ═══════════════════════════════════════════════════
   BARMS PRO — sales.js
   Sales: record sale, history, void, quick sale
   Depends on: utils.js, api.js, auth.js
═══════════════════════════════════════════════════ */

// ── SALES ─────────────────────────────────────────
let _saleProduct=null;
let _allProducts=[];

async function loadSaleProducts(){
  let data = [];
  const res = await apiGet('products','list');

  if (res.ok) {
    data = res.data || [];
    // Cache for offline use
    try {
      for (const p of data) await dbPut('products', p);
      await dbSetSyncTime('products');
    } catch(e) {}
  } else if (res.error === 'offline' || res.network) {
    // Task 62: Load from IndexedDB when offline
    try { data = await dbGetAll('products'); } catch(e) {}
  }

  _allProducts = data.filter(p=>p.active&&p.stock>0);
  const sel=document.getElementById('saleProduct');
  sel.innerHTML=_allProducts.map(p=>`<option value="${p.id}">${esc(p.name)} — ${fmtRWF(p.sellPrice)}</option>`).join('');
  onSaleProductChange();
}

function onSaleProductChange(){
  const id=+document.getElementById('saleProduct').value;
  _saleProduct=_allProducts.find(p=>p.id===id)||null;
  if(_saleProduct){
    const pi=document.getElementById('salePriceInfo');
    const si=document.getElementById('saleStockInfo');
    if(pi)pi.textContent=fmtRWF(_saleProduct.sellPrice);
    if(si)si.textContent=`Stock: ${_saleProduct.stock} ${_saleProduct.unit||''}`;
  }
  updateSaleTotal();
}

function updateSaleTotal(){
  if(!_saleProduct)return;
  const qty=+document.getElementById('saleQty').value||1;
  document.getElementById('saleTotalDisplay').textContent=fmtRWF(_saleProduct.sellPrice*qty);
}

async function recordSale(){
  if(!_saleProduct){toast(t('selectProductFirst'),'error');return;}
  const qty=+document.getElementById('saleQty').value;
  if(qty<1||qty>_saleProduct.stock){toast(`Only ${_saleProduct.stock} in stock`,'error');return;}
  const total=_saleProduct.sellPrice*qty;
  const _qty=qty;const _product=_saleProduct;const _total=total;
  confirm2(`Confirm Sale?\n\nProduct: ${_product.name}\nQty: ${_qty}\nTotal: ${fmtRWF(_total)}`,async()=>{

    // Task 85: Generate clientUuid before any network call
    const clientUuid = newUuid();
    const timestamp  = new Date().toISOString();

    // Task 86: Write to sync_queue FIRST before server attempt
    try {
      await dbPut('sync_queue', {
        clientUuid,
        type: 'sale',
        payload: { productId: _product.id, qty: _qty, total: _total },
        timestamp,
        status: 'pending',
        retryCount: 0,
      });

      // Task 87: Decrement local stock immediately in IndexedDB
      const cached = await dbGet('products', _product.id);
      if (cached) await dbPut('products', { ...cached, stock: cached.stock - _qty });
    } catch(e) { console.warn('[Sale] Could not write to sync queue:', e); }

    // Attempt server POST
    const res = await api('sales','record',{ productId:_product.id, qty:_qty, clientUuid, clientCreatedAt: timestamp });

    if(res.ok){
      // Task 89: Remove from sync_queue on server success
      try { await dbDelete('sync_queue', clientUuid); } catch(e) {}
      toast(`Sale recorded! ${fmtRWF(res.total)} received.`);
      document.getElementById('saleQty').value=1;
      await loadSaleProducts();
      loadSalesHistory(0,null);
      runFraudCheck();
      await updateSyncBadge();
    } else if(res.error === 'offline') {
      // Task 88: Offline — show pending toast
      toast(`Saved offline — will sync when connected`, 'warning');
      document.getElementById('saleQty').value=1;
      await loadSaleProducts(); // reload from IndexedDB with updated stock
      await updateSyncBadge();
      await registerBackgroundSync();
    } else if(res.error === 'conflict') {
      // Stock conflict detected
      try { await dbDelete('sync_queue', clientUuid); } catch(e) {}
      // Restore local stock
      try {
        const cached = await dbGet('products', _product.id);
        if (cached) await dbPut('products', { ...cached, stock: cached.stock + _qty });
      } catch(e) {}
      toast(`${res.message}`, 'error');
    } else {
      // Other error — remove from queue, restore stock
      try { await dbDelete('sync_queue', clientUuid); } catch(e) {}
      try {
        const cached = await dbGet('products', _product.id);
        if (cached) await dbPut('products', { ...cached, stock: cached.stock + _qty });
      } catch(e) {}
      toast(res.error||'Error','error');
    }
  });
}

function activateSalesDatePicker(tabEl){
  document.querySelectorAll('#page-sales .tab').forEach(tb=>tb.classList.remove('active'));
  if(tabEl)tabEl.classList.add('active');
  const wrap=document.getElementById('salesDateWrap');
  if(wrap)wrap.style.display='flex';
  const pick=document.getElementById('salesDatePick');
  if(pick&&!pick.value)pick.value=today();
  loadSalesHistoryByDate();
}

async function loadSalesHistoryByDate(){
  const date=document.getElementById('salesDatePick').value||today();
  const res=await apiGet('sales','list',{filter:'date',date});
  if(!res.ok)return;
  renderSalesTable(res.data||[]);
}

async function loadSalesHistory(filter,tabEl){
  if(tabEl){document.querySelectorAll('#page-sales .tab').forEach(tb=>tb.classList.remove('active'));tabEl.classList.add('active');}
  const wrap=document.getElementById('salesDateWrap');
  if(wrap)wrap.style.display='none';
  const filterMap={0:'today',1:'week',2:'month'};
  const res=await apiGet('sales','list',{filter:filterMap[filter]||'today'});
  if(!res.ok)return;
  renderSalesTable(res.data||[]);
}

function renderSalesTable(sales){
  document.getElementById('salesHistoryBody').innerHTML=sales.map(s=>`
    <tr class="${s.voided?'void-row':''}">
      <td class="muted">${s.date}</td><td>${esc(s.productName)}</td>
      <td class="mono">${s.qty}</td>
      <td class="mono">${fmtRWF(s.unitPrice)}</td>
      <td class="mono" style="font-weight:700;color:${s.voided?'var(--faint)':'var(--green)'}">
        ${fmtRWF(s.total)}</td>
      <td class="muted">${esc(s.soldBy)}</td>
      <td>${s.voided
        ?`<span class="badge badge-red">${t('voided')}</span>`
        :session.role==='Owner'
          ?`<button class="btn btn-ghost btn-sm" onclick="voidSale(${s.id})">${t('void2')}</button>`
          :session.role==='Manager'
            ?`<button class="btn btn-ghost btn-sm" style="color:var(--orange)" onclick="requestVoidSale(${s.id},'${s.productName.replace(/'/g,"\\'")}',${s.total})">${t('requestVoid')}</button>`
            :''
      }</td>
    </tr>`).join('')||
    `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px">${t('noSales')}</td></tr>`;
}

async function voidSale(id){
  confirm2('Are you sure you want to void this sale? Stock will be restored.',async()=>{
    const res=await api('sales','void',{id});
    if(!res.ok){toast(res.error||'Error','error');return;}
    toast('Sale voided. Stock restored.','warning');
    loadSalesHistory(0,null);
  });
}

// ── QUICK SALE ────────────────────────────────────
let qsCart=[];
let _qsProducts=[];

async function loadQsProducts(){
  let data = [];
  const res = await apiGet('products','list');

  if (res.ok) {
    data = res.data || [];
    // Cache for offline use
    try {
      for (const p of data) await dbPut('products', p);
    } catch(e) {}
  } else if (res.error === 'offline' || res.network) {
    // Task 63: Load from IndexedDB when offline
    try { data = await dbGetAll('products'); } catch(e) {}
  }

  _qsProducts = data.filter(p=>p.active&&p.stock>0);
  document.getElementById('qsProduct').innerHTML=
    _qsProducts.map(p=>`<option value="${p.id}">${esc(p.name)} — ${fmtRWF(p.sellPrice)}</option>`).join('');
}

function addQsItem(){
  const id=+document.getElementById('qsProduct').value;
  const qty=+document.getElementById('qsQty').value||1;
  const p=_qsProducts.find(x=>x.id===id);
  if(!p)return;
  const existing=qsCart.find(x=>x.id===id);
  if(existing)existing.qty+=qty;
  else qsCart.push({id,name:p.name,unitPrice:p.sellPrice,qty,maxStock:p.stock});
  renderQsCart();
}

function removeQsItem(id){qsCart=qsCart.filter(x=>x.id!==id);renderQsCart();}
function clearQsItems(){qsCart=[];renderQsCart();}
function updateQsQty(id,v){const item=qsCart.find(x=>x.id===id);if(item)item.qty=+v||1;renderQsCart();}

function renderQsCart(){
  const el=document.getElementById('qsItems');
  if(!qsCart.length){
    el.innerHTML='<p style="text-align:center;color:var(--muted);font-size:13px;padding:20px 0">No items added yet</p>';
    document.getElementById('qsSubtotal').textContent='RWF 0';
    document.getElementById('qsTotal').textContent='RWF 0';
    document.getElementById('qsSummary').innerHTML='';
    return;
  }
  el.innerHTML=qsCart.map(item=>`
    <div class="qs-item">
      <div class="qs-name">${item.name}</div>
      <input type="number" class="form-input qs-qty" value="${item.qty}" min="1" max="${item.maxStock}"
        onchange="updateQsQty(${item.id},this.value)" style="width:70px;padding:6px"/>
      <div class="qs-price">${fmtRWF(item.unitPrice*item.qty)}</div>
      <span class="qs-remove" onclick="removeQsItem(${item.id})">✕</span>
    </div>`).join('');
  const sub=qsCart.reduce((a,x)=>a+x.unitPrice*x.qty,0);
  document.getElementById('qsSubtotal').textContent=fmtRWF(sub);
  document.getElementById('qsTotal').textContent=fmtRWF(sub);
  document.getElementById('qsSummary').innerHTML=qsCart.map(x=>`
    <div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)">
      <span>${x.name} × ${x.qty}</span><span class="mono">${fmtRWF(x.unitPrice*x.qty)}</span>
    </div>`).join('');
}

async function processQuickSale(){
  if(!qsCart.length){toast('Add items first','error');return;}
  const _cartSnapshot=qsCart.map(x=>({...x}));
  const _total=_cartSnapshot.reduce((a,x)=>a+x.unitPrice*x.qty,0);
  const _msg='Confirm Quick Sale?\n\n'+_cartSnapshot.map(x=>`${x.name} × ${x.qty} = ${fmtRWF(x.unitPrice*x.qty)}`).join('\n')+`\n\nTotal: ${fmtRWF(_total)}`;
  confirm2(_msg,async()=>{

    // Generate a clientUuid per item for idempotency
    const timestamp = new Date().toISOString();
    const itemsWithUuid = _cartSnapshot.map(x => ({
      ...x,
      clientUuid: newUuid(),
    }));

    // Write each item to sync_queue first
    for (const item of itemsWithUuid) {
      try {
        await dbPut('sync_queue', {
          clientUuid: item.clientUuid,
          type: 'sale',
          payload: { productId: item.id, qty: item.qty, total: item.unitPrice * item.qty },
          timestamp,
          status: 'pending',
          retryCount: 0,
        });
        // Decrement local stock immediately
        const cached = await dbGet('products', item.id);
        if (cached) await dbPut('products', { ...cached, stock: cached.stock - item.qty });
      } catch(e) {}
    }

    const res=await api('sales','quick',{items: itemsWithUuid.map(x=>({id:x.id,qty:x.qty,clientUuid:x.clientUuid}))});

    if(res.ok){
      // Remove all from sync_queue
      for (const item of itemsWithUuid) {
        try { await dbDelete('sync_queue', item.clientUuid); } catch(e) {}
      }
      toast(`Quick sale complete! ${fmtRWF(res.total)} received.`);
      qsCart=[];
      renderQsCart();
      await loadQsProducts();
      await updateSyncBadge();
    } else if(res.error === 'offline') {
      toast(`Saved offline — will sync when connected`, 'warning');
      qsCart=[];
      renderQsCart();
      await loadQsProducts();
      await updateSyncBadge();
      await registerBackgroundSync();
    } else {
      // Error — clean up queue and restore stock
      for (const item of itemsWithUuid) {
        try {
          await dbDelete('sync_queue', item.clientUuid);
          const cached = await dbGet('products', item.id);
          if (cached) await dbPut('products', { ...cached, stock: cached.stock + item.qty });
        } catch(e) {}
      }
      toast(res.error||res.message||'Error','error');
    }
  });
}

// ── VOID REQUEST (Manager) ────────────────────────
async function requestVoidSale(saleId,productName,amount){
  document.getElementById('modalContent').innerHTML=`
    <h3>Request Sale Void</h3>
    <p style="font-size:13px;color:var(--muted);margin:10px 0 16px">Sale: <strong>${productName}</strong> — ${fmtRWF(amount)}</p>
    <div class="form-group">
      <label class="form-label">Reason *</label>
      <textarea class="form-input" id="voidReasonInput" rows="3" placeholder="Explain why this sale should be voided…" style="resize:vertical"></textarea>
    </div>
    <button class="btn btn-primary" onclick="submitVoidRequest('sale',${saleId},'${productName}',${amount})">Submit to Owner</button>`;
  document.getElementById('modalOverlay').classList.add('show');
}
