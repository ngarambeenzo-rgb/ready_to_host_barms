/* ═══════════════════════════════════════════════════
   BARMS PRO — stock.js
   Stock movements, stock overview table
   Depends on: utils.js, api.js, auth.js
═══════════════════════════════════════════════════ */

let _stockProducts=[];

function localStockDate(){
  const now=new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

async function loadStockProducts(){
  const dateInput=document.getElementById('stockDate');
  if(dateInput&&!dateInput.value)dateInput.value=localStockDate();
  let data = [];
  const res = await apiGet('products','list');

  if (res.ok) {
    data = res.data || [];
    // Task 65: Cache stock levels for offline
    try {
      for (const p of data) await dbPut('products', p);
      await dbSetSyncTime('stock');
    } catch(e) {}
  } else {
    try { data = await dbGetAll('products'); } catch(e) {}
  }

  _stockProducts = data.filter(p=>p.active);
  document.getElementById('stockProduct').innerHTML=
    _stockProducts.map(p=>`<option value="${p.id}">${esc(p.name)} [${p.stock} ${esc(p.unit)}]</option>`).join('');
  onStockProductChange();
  onStockTypeChange(); // Show/hide IN-only fields based on current type
}

function onStockProductChange(){
  const id=+document.getElementById('stockProduct').value;
  const p=_stockProducts.find(x=>x.id===id);
  if(p){
    document.getElementById('stockCurrentInfo').textContent=`${p.stock} ${esc(p.unit)}`;
    // Pre-fill cost with current cost price
    const costEl=document.getElementById('stockCost');
    if(costEl && +costEl.value===0 && p.costPrice>0) costEl.value=p.costPrice;
  }
  updateStockPreview();
}

function onStockTypeChange(){
  const type=document.getElementById('stockType')?.value;
  const inOnly=['stockCostGroup','stockSupplierGroup','stockReferenceGroup'];
  inOnly.forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.display=type==='IN'?'':'none';
  });
  updateStockPreview();
}

function updateStockPreview(){
  const id=+document.getElementById('stockProduct').value;
  const qty=+document.getElementById('stockQty')?.value||0;
  const cost=+document.getElementById('stockCost')?.value||0;
  const type=document.getElementById('stockType')?.value||'IN';
  const p=_stockProducts.find(x=>x.id===id);
  const preview=document.getElementById('stockPreview');
  const totalCostInfo=document.getElementById('stockTotalCostInfo');
  if(!p||!qty) { if(preview) preview.textContent=''; return; }
  const newStock=type==='IN'?p.stock+qty:p.stock-qty;
  if(preview) preview.textContent=`${p.name}: ${p.stock} → ${newStock} ${p.unit}${type==='IN'&&cost>0?` | Total: ${fmtRWF(qty*cost)}`:''}`;
  if(totalCostInfo&&cost>0&&qty>0) totalCostInfo.textContent=`Total purchase cost: ${fmtRWF(qty*cost)}`;
  else if(totalCostInfo) totalCostInfo.textContent='';
}

async function recordStock(){
  const id=+document.getElementById('stockProduct').value;
  const type=document.getElementById('stockType').value;
  const qty=+document.getElementById('stockQty').value||0;
  const costPerUnit=+document.getElementById('stockCost').value||0;
  const note=document.getElementById('stockNote').value||'';
  const supplier=document.getElementById('stockSupplier')?.value?.trim()||'';
  const reference=document.getElementById('stockReference')?.value?.trim()||'';
  const purchaseDate=document.getElementById('stockDate')?.value||'';
  if(!id){toast('Select a product','error');return;}
  if(qty<1){toast('Enter a valid quantity','error');return;}
  if(type==='IN'&&costPerUnit<=0){toast('Enter the purchase cost per unit','error');return;}
  if(!purchaseDate){toast('Select a purchase or movement date','error');return;}
  if(type==='IN' && !note && !supplier){toast('Please add a note or supplier name','error');return;}
  const res=await api('stock','record',{productId:id,type,qty,costPerUnit,cost:costPerUnit,note:note||type,supplier,reference,purchaseDate});
  if(!res.ok){toast(res.error||'Error','error');return;}
  const product=_stockProducts.find(p=>p.id===id);
  toast(`Stock ${type}: ${qty} ${product?.unit||''} of ${product?.name||''} recorded`);
  // Clear form
  document.getElementById('stockQty').value=1;
  document.getElementById('stockCost').value=0;
  document.getElementById('stockNote').value='';
  if(document.getElementById('stockSupplier')) document.getElementById('stockSupplier').value='';
  if(document.getElementById('stockReference')) document.getElementById('stockReference').value='';
  if(document.getElementById('stockDate')) document.getElementById('stockDate').value=localStockDate();
  auditAction('STOCK',`Stock ${type}: ${qty}× product #${id}`);
  await loadStockProducts();
  loadStockData();
}

async function loadStockData(filter=''){
  const [pRes,mRes]=await Promise.all([apiGet('products','list'),apiGet('stock','list')]);
  let prods=(pRes.data||[]).filter(p=>p.active);
  if(filter)prods=prods.filter(p=>p.name.toLowerCase().includes(filter.toLowerCase())||p.category.toLowerCase().includes(filter.toLowerCase()));
  const allMoves=mRes.data||[];
  document.getElementById('stockSummaryBody').innerHTML=prods.map(p=>{
    const prodMoves=allMoves.filter(m=>m.productId===p.id);
    const totalIn=prodMoves.filter(m=>m.type==='IN').reduce((a,m)=>a+m.qty,0);
    const totalOut=prodMoves.filter(m=>m.type==='OUT').reduce((a,m)=>a+m.qty,0);
    const lastMove=prodMoves[0];
    const pct=Math.min(100,Math.round((p.stock/(p.alert*3||30))*100));
    const color=p.stock<=0?'var(--red)':p.stock<=p.alert?'var(--orange)':'var(--green)';
    return`<tr>
      <td style="font-weight:700">${esc(p.name)}</td>
      <td class="muted">${esc(p.category)}</td>
      <td>
        <span style="font-weight:800;color:${color};font-variant-numeric:tabular-nums;font-size:15px">${p.stock}</span>
        <div class="stock-bar" style="margin-top:4px"><div class="stock-fill" style="width:${pct}%;background:${color}"></div></div>
      </td>
      <td class="muted">${fmtRWF(p.costPrice||0)}</td>
      <td style="font-weight:700">${fmtRWF((p.stock||0)*(p.costPrice||0))}</td>
      <td><span style="font-weight:700;color:var(--green);font-variant-numeric:tabular-nums">▲ ${totalIn}</span></td>
      <td><span style="font-weight:700;color:var(--red);font-variant-numeric:tabular-nums">▼ ${totalOut}</span></td>
      <td class="muted">${esc(p.unit)}</td>
      <td><span class="badge ${p.stock<=0?'badge-red':p.stock<=p.alert?'badge-orange':'badge-green'}">${p.stock<=0?t('empty'):p.stock<=p.alert?t('low'):t('ok')}</span></td>
      <td>${lastMove?`<span class="badge ${lastMove.type==='IN'?'badge-green':'badge-red'}">${lastMove.type}</span> <span style="font-size:12px;color:var(--muted)">${lastMove.qty} — ${lastMove.note||''}</span>`:`<span style="color:var(--faint);font-size:12px">${t('noStock')}</span>`}</td>
      <td class="muted" style="font-size:12px">${lastMove?lastMove.date:'—'}</td>
    </tr>`;
  }).join('')||`<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:20px">${t('noProducts')}</td></tr>`;
}

function filterStockTable(v){loadStockData(v);}
