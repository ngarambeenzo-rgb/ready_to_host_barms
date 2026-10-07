/* ═══════════════════════════════════════════════════
   BARMS PRO — products.js
   Products CRUD, price change requests
   Depends on: utils.js, api.js, auth.js
═══════════════════════════════════════════════════ */

let _editProductId=0;

async function loadProducts(filter=''){
  let prods = [];

  // Try network first
  const res = await apiGet('products','list');

  if (res.ok) {
    prods = res.data || [];
    // Task 60: Save to IndexedDB for offline use
    try {
      for (const p of prods) await dbPut('products', p);
      await dbSetSyncTime('products');
    } catch(e) { console.warn('[DB] Could not cache products:', e); }
  } else if (res.error === 'offline' || res.network) {
    // Task 61: Load from IndexedDB when offline
    try {
      prods = await dbGetAll('products');
      if (prods.length) showCachedDataBadge('products', 'pageTitle');
    } catch(e) { console.warn('[DB] Could not load cached products:', e); }
  } else {
    return;
  }

  if(filter) prods = prods.filter(p=>p.name.toLowerCase().includes(filter.toLowerCase())||p.category.toLowerCase().includes(filter.toLowerCase()));
  document.getElementById('productsBody').innerHTML=prods.map(p=>`
    <tr>
      <td style="font-weight:600">${esc(p.name)}</td><td class="muted">${esc(p.category)}</td><td class="muted">${esc(p.unit)}</td>
      <td class="mono" style="color:var(--green)">${fmtRWF(p.sellPrice)}</td>
      <td class="mono">${fmtRWF(p.costPrice)}</td>
      <td><span style="font-weight:700;font-variant-numeric:tabular-nums;color:${p.stock<=p.alert?'var(--red)':'var(--text)'}">${p.stock}</span></td>
      <td class="mono">${p.alert}</td>
      <td style="white-space:nowrap">
        ${session.role==='Owner'
          ?`<button class="btn btn-ghost btn-sm" onclick="editProduct(${p.id})">${t('edit2')}</button>
             <button class="btn btn-ghost btn-sm" style="color:var(--blue)" onclick="requestPriceChange(${p.id},'${p.name.replace(/'/g,"\\'")}',${p.sellPrice},${p.costPrice})">Prices</button>
             <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deactivateProduct(${p.id})">${p.active?t('remove'):''}</button>`
          :session.role==='Manager'
            ?`<button class="btn btn-ghost btn-sm" style="color:var(--blue)" onclick="requestPriceChange(${p.id},'${p.name.replace(/'/g,"\\'")}',${p.sellPrice},${p.costPrice})">${t('changePrice')}</button>`
            :''}
      </td>
    </tr>`).join('')||`<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px">${t('noProducts')}</td></tr>`;
}

function filterProducts(v){loadProducts(v);}

async function saveProduct(){
  const name=document.getElementById('pName').value.trim();
  if(!name){toast(t('productNameRequired'),'error');return;}
  const data={
    id:_editProductId||0,name,
    category:document.getElementById('pCategory').value||'General',
    unit:document.getElementById('pUnit').value||'Unit',
    sellPrice:+document.getElementById('pSellPrice').value||0,
    costPrice:+document.getElementById('pCostPrice').value||0,
    stock:+document.getElementById('pStock').value||0,
    alert:+document.getElementById('pAlert').value||5,
  };
  const res=await api('products','save',data);
  if(!res.ok){toast(res.error||'Error','error');return;}
  toast(_editProductId?t('productUpdated'):t('productSaved'));
  clearProductForm();
  loadProducts();
}

async function editProduct(id){
  const res=await apiGet('products','list');
  const p=(res.data||[]).find(x=>x.id===id);
  if(!p)return;
  _editProductId=id;
  document.getElementById('pName').value=p.name;
  document.getElementById('pCategory').value=p.category;
  document.getElementById('pUnit').value=p.unit;
  document.getElementById('pSellPrice').value=p.sellPrice;
  document.getElementById('pCostPrice').value=p.costPrice;
  document.getElementById('pStock').value=p.stock;
  document.getElementById('pAlert').value=p.alert;
  document.getElementById('pSaveBtn').textContent='UPDATE PRODUCT';
  document.getElementById('productFormTitle').textContent='EDIT PRODUCT';
  window.scrollTo(0,0);
}

function clearProductForm(){
  _editProductId=0;
  ['pName','pCategory','pUnit'].forEach(id=>document.getElementById(id).value=id==='pCategory'?'Beer':id==='pUnit'?'Bottle':'');
  ['pSellPrice','pCostPrice','pStock'].forEach(id=>document.getElementById(id).value=0);
  document.getElementById('pAlert').value=5;
  document.getElementById('pSaveBtn').textContent='SAVE PRODUCT';
  document.getElementById('productFormTitle').textContent='ADD PRODUCT — Click any row to edit';
}

async function deactivateProduct(id){
  confirm2('Remove this product from active listings?',async()=>{
    const res=await api('products','deactivate',{id});
    if(!res.ok){toast(res.error||'Error','error');return;}
    toast('Product removed','warning');
    loadProducts();
  });
}

// ── PRICE CHANGE (Manager/Owner) ──────────────────
function requestPriceChange(productId,productName,sellPrice,costPrice){
  const isOwner=session.role==='Owner';
  document.getElementById('modalContent').innerHTML=`
    <h3>${isOwner?'Edit Prices':'Change Price'}</h3>
    <p style="font-size:13px;color:var(--muted);margin:8px 0 14px">Product: <strong>${esc(productName)}</strong></p>
    <div class="form-row cols-2" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group">
        <label class="form-label">Selling Price (RWF) *</label>
        <input type="number" inputmode="numeric" class="form-input" id="newSellPriceInput" value="${sellPrice}" min="0"/>
        <div style="font-size:11px;color:var(--muted);margin-top:3px">Current: ${fmtRWF(sellPrice)}</div>
      </div>
      <div class="form-group">
        <label class="form-label">Buying Price (RWF)</label>
        <input type="number" inputmode="numeric" class="form-input" id="newCostPriceInput" value="${costPrice||0}" min="0" ${isOwner?'':''}/>
        <div style="font-size:11px;color:var(--muted);margin-top:3px">Current: ${fmtRWF(costPrice||0)}</div>
      </div>
    </div>
    <div class="form-group" style="margin-top:8px">
      <label class="form-label">Reason for Change ${isOwner?'(optional)':'*'}</label>
      <textarea class="form-input" id="priceReasonInput" rows="2" placeholder="e.g. Supplier increased cost, promotion, market adjustment…" style="resize:vertical"></textarea>
    </div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="confirmPriceChange(${productId},'${esc(productName)}',${sellPrice},${costPrice||0})">Save Prices</button>
      <button class="btn btn-ghost btn-sm" onclick="showPriceHistory(${productId},'${esc(productName)}')">History</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('show');
}

async function confirmPriceChange(productId,productName,oldSell,oldCost){
  const newSell=+document.getElementById('newSellPriceInput').value;
  const newCost=+document.getElementById('newCostPriceInput').value;
  const reason=document.getElementById('priceReasonInput')?.value?.trim()||'';
  const isOwner=session.role==='Owner';

  if(newSell<0){toast('Enter a valid selling price','error');return;}
  if(!isOwner && !reason){toast('Reason is required for price changes','error');return;}

  let changed=false;
  // Update sell price if changed
  if(Math.abs(newSell-oldSell)>0.01){
    const r=await api('products','update_price',{id:productId,price:newSell,field:'sell_price',reason:reason||'Updated by owner'});
    if(!r.ok){toast(r.error||'Failed to update sell price','error');return;}
    changed=true;
  }
  // Update cost price if changed (Owner only for cost price changes)
  if(isOwner && Math.abs(newCost-oldCost)>0.01){
    const r=await api('products','update_price',{id:productId,price:newCost,field:'cost_price',reason:reason||'Updated by owner'});
    if(!r.ok){toast(r.error||'Failed to update cost price','error');return;}
    changed=true;
  }

  if(!changed){toast('No changes made','warning');closeModal();return;}
  closeModal();
  toast('Prices updated successfully');
  loadProducts();
}

async function showPriceHistory(productId,productName){
  const res=await apiGet('products','price_history',{productId});
  const rows=res.data||[];
  const html=rows.length?rows.map(r=>`
    <tr style="font-size:12px">
      <td style="padding:6px 4px">${r.field==='sell_price'?'Sell':'Cost'}</td>
      <td style="padding:6px 4px;font-family:monospace">${fmtRWF(r.old_price)}</td>
      <td style="padding:6px 4px;font-family:monospace;color:var(--green)">${fmtRWF(r.new_price)}</td>
      <td style="padding:6px 4px;color:var(--muted)">${esc(r.reason)}</td>
      <td style="padding:6px 4px;color:var(--muted)">${esc(r.changed_by)}</td>
      <td style="padding:6px 4px;color:var(--muted)">${r.created_at?.split(' ')[0]||''}</td>
    </tr>`).join('')
    :'<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:16px">No price changes recorded</td></tr>';
  document.getElementById('modalContent').innerHTML=`
    <h3>Price History — ${esc(productName)}</h3>
    <div style="overflow-x:auto;margin-top:10px">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="border-bottom:1px solid var(--border);font-size:11px;color:var(--muted)">
          <th style="padding:6px 4px;text-align:left">Field</th>
          <th style="padding:6px 4px;text-align:left">Old</th>
          <th style="padding:6px 4px;text-align:left">New</th>
          <th style="padding:6px 4px;text-align:left">Reason</th>
          <th style="padding:6px 4px;text-align:left">By</th>
          <th style="padding:6px 4px;text-align:left">Date</th>
        </tr></thead>
        <tbody>${html}</tbody>
      </table>
    </div>`;
  document.getElementById('modalOverlay').classList.add('show');
}
