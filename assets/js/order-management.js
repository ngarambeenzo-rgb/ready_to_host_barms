/* ═══════════════════════════════════════════════════
   order-management.js — Page 2: Order Management
   Products come from bar_items + kitchen_menu
   Two modes on one page:
     list  — open / paid orders (sidebar entry)
     order — product grid + current order (cart)
═══════════════════════════════════════════════════ */

let _omOrder    = null;
let _omProducts = []; // unified list: {id, sourceType, sourceId, name, price, stock, category, itemType, image}
let _omKitchenPollInterval = null;
let _omLastAdded = null;  // product, to highlight its cart line after refresh

// Switch the page between the orders list and one open order
function _omMode(mode) {
  const layout = document.getElementById('omLayout');
  if (layout) layout.classList.toggle('list-mode', mode === 'list');
  const grid = document.getElementById('omProductGrid');
  if (grid) { grid.style.gridTemplateColumns = ''; grid.classList.toggle('om-orders', mode === 'list'); }
}

// Tabs shown above the orders grid
function _omListTabs(active) {
  return `<div class="om-list-tabs"><div class="tabs">
    <button class="tab${active === 'open' ? ' active' : ''}" onclick="loadAllOrders()">Open orders</button>
    <button class="tab${active === 'paid' ? ' active' : ''}" onclick="loadPaidOrders()">Paid orders</button>
  </div></div>`;
}

// ── LOAD ALL OPEN ORDERS (sidebar entry point) ────
async function loadAllOrders() {
  _omStopKitchenPolling();
  showPage('order-management');
  _omMode('list');
  const header = document.getElementById('omOrderTitle');
  const sub    = document.getElementById('omOrderSub');
  const badge  = document.getElementById('omStatusBadge');
  const grid   = document.getElementById('omProductGrid');

  if (header) header.textContent = 'Open orders';
  if (sub)    sub.textContent    = 'Orders that are not paid yet';
  if (badge)  badge.style.display = 'none';

  if (grid) grid.innerHTML = _omListTabs('open') + `<div class="om-span">${uiLoader('Loading orders')}</div>`;

  const res = await apiGet('orders', 'list', { status: 'open' });
  if (!res.ok) { if (grid) grid.innerHTML = _omListTabs('open') + `<div class="om-span">${uiEmpty('alertcircle', 'Could not load orders', res.error || 'Check the connection and try again.')}</div>`; return; }

  const orders = res.data || [];
  if (!grid) return;

  if (!orders.length) {
    grid.innerHTML = _omListTabs('open') + `<div class="om-span">${uiEmpty('checkcircle', 'No open orders', 'Every order has been paid.', `<button class="btn btn-primary btn-sm" onclick="showPage('order-creation')">${ic('plus')}New order</button>`)}</div>`;
    return;
  }

  grid.innerHTML = _omListTabs('open') + orders.map(o => {
    const isDraft    = o.status === 'draft';
    const tableLabel = o.type === 'dinein' ? (o.tableName || 'Table') : 'Takeaway';
    const time       = o.createdAt ? new Date(String(o.createdAt).replace(' ', 'T')).toLocaleTimeString('en-RW', { hour: '2-digit', minute: '2-digit' }) : '';
    return `<button class="om-order-card" onclick="loadOrderManagement(${o.id})">
      <span class="om-oc-top"><span class="om-oc-no">${esc(o.orderNumber)}</span><span class="om-chip ${isDraft ? 'draft' : 'validated'}">${isDraft ? 'Draft' : 'Validated'}</span></span>
      <span class="om-oc-where">${ic(o.type === 'dinein' ? 'armchair' : 'bag')}${esc(tableLabel)}</span>
      <span class="om-oc-meta">${esc(time)} · ${o.itemCount} item${o.itemCount !== 1 ? 's' : ''} · ${esc(o.createdBy || '')}</span>
      <span class="om-oc-total">${fmtRWF(o.total || 0)}</span>
    </button>`;
  }).join('');
}

// ── LOAD ORDER MANAGEMENT ─────────────────────────
async function loadOrderManagement(orderId, fromCreation = false) {
  const res = await apiGet('orders', 'get', { orderId });
  if (!res.ok) { toast(res.error || 'Could not load order', 'error'); return; }
  _omOrder       = res.order;
  _omOrder.items = res.items || [];
  _omOrder.total = res.total || 0;
  _omOrder._fromCreation = fromCreation;

  // Load bar items + kitchen menu in parallel
  const [barRes, kitRes] = await Promise.all([
    apiGet('bar-inventory', 'items_list'),
    apiGet('kitchen2', 'menu_list'),
  ]);

  // Unify into one product list
  _omProducts = [];

  // Bar items
  (barRes.data || []).filter(i => i.active).forEach(i => {
    _omProducts.push({
      id:         `bar_${i.id}`,
      sourceType: 'bar',
      sourceId:   i.id,
      name:       i.name,
      price:      i.price,
      stock:      i.type === 'direct' ? i.stock : 999, // recipe items no stock limit
      minStock:   i.min_stock,
      itemType:   i.type, // direct or recipe
      category:   'Drink',
      image:      i.image || null,
      productType: i.product_type || null,
      kind:       'bar',
    });
  });

  // Kitchen menu items
  (kitRes.data || []).filter(i => i.status === 'active').forEach(i => {
    _omProducts.push({
      id:         `kit_${i.id}`,
      sourceType: 'kitchen',
      sourceId:   i.id,
      name:       i.name,
      price:      i.price,
      stock:      999, // kitchen items managed via ingredients
      itemType:   'kitchen',
      category:   'Kitchen',
      image:      i.image || null,
      productType: i.product_type || null,
      kind:       'kitchen',
    });
  });

  const statusBadgeEl = document.getElementById('omStatusBadge');
  if (statusBadgeEl) statusBadgeEl.style.display = '';
  const rightPanel = document.getElementById('omRightPanel');
  if (rightPanel) rightPanel.style.display = '';
  _omMode('order');

  _omUpdateHeader();
  omFilterProducts();
  _omRenderItems();

  const noteEl = document.getElementById('omOrderNote');
  if (noteEl) noteEl.value = _omOrder.note || '';

  if (_omOrder.status === 'validated') _omStartKitchenPolling();
  else { _omStopKitchenPolling(); const ks = document.getElementById('omKitchenStatus'); if (ks) ks.style.display = 'none'; }

  showPage('order-management');
  // search is the fastest way in on a keyboard; on touch screens don't pop the keyboard
  if (!matchMedia('(pointer:coarse)').matches && _omOrder.status === 'draft') setTimeout(() => document.getElementById('omProductSearch')?.focus(), 60);
}

// ── UPDATE HEADER ─────────────────────────────────
function _omUpdateHeader() {
  const o = _omOrder;
  const titleEl = document.getElementById('omOrderTitle');
  const subEl   = document.getElementById('omOrderSub');
  const badge   = document.getElementById('omStatusBadge');
  const panelT  = document.getElementById('omPanelTitle');
  const panelS  = document.getElementById('omPanelSub');
  const valBtn  = document.getElementById('omValidateBtn');
  const payBtn  = document.getElementById('omPayBtn');

  if (titleEl) titleEl.textContent = `${o.orderNumber}`;
  if (subEl)   subEl.textContent   = o.type === 'dinein' ? `Dine-in · ${o.tableName}` : 'Takeaway';
  if (panelT)  panelT.textContent  = 'Current order';
  if (panelS)  panelS.textContent  = `${o.orderNumber} · ${o.type === 'dinein' ? o.tableName : 'Takeaway'}`;

  const labels = { draft: 'Draft', validated: 'Validated', paid: 'Paid' };
  if (badge) { badge.textContent = labels[o.status] || 'Draft'; badge.className = 'om-chip ' + (labels[o.status] ? o.status : 'draft'); }

  document.getElementById('omLayout')?.classList.toggle('locked', o.status !== 'draft');

  if (valBtn) {
    valBtn.style.display = o.status === 'draft' ? '' : 'none';
    valBtn.disabled      = o.items.length === 0;
  }
  if (payBtn) payBtn.style.display = o.status === 'validated' ? '' : 'none';
}

// ── KITCHEN STATUS POLLING (for bartender/owner view) ─
function _omStartKitchenPolling() {
  _omRenderKitchenStatus();
  if (_omKitchenPollInterval) clearInterval(_omKitchenPollInterval);
  _omKitchenPollInterval = setInterval(_omRenderKitchenStatus, 8000);
}

function _omStopKitchenPolling() {
  if (_omKitchenPollInterval) { clearInterval(_omKitchenPollInterval); _omKitchenPollInterval = null; }
}

async function _omRenderKitchenStatus() {
  const page = document.getElementById('page-order-management');
  if (!page || !page.classList.contains('active') || !_omOrder) { _omStopKitchenPolling(); return; }

  const res = await apiGet('kitchen_orders', 'order_status', { orderId: _omOrder.orderId });
  if (!res.ok) return;

  let el = document.getElementById('omKitchenStatus');
  if (!el) {
    const foot = document.querySelector('#omRightPanel .om-cart-foot');
    if (!foot) return;
    el = document.createElement('div');
    el.id = 'omKitchenStatus';
    el.className = 'om-kstatus';
    foot.insertAdjacentElement('afterbegin', el);
  }

  if (!res.hasKitchenOrder) { el.style.display = 'none'; return; }

  el.style.display = '';
  const d = res.data;
  const statusMap = {
    pending:   { label: 'Waiting for kitchen', tone: 'info' },
    accepted:  { label: 'Accepted by kitchen', tone: 'info' },
    preparing: { label: 'Preparing',           tone: 'warn' },
    ready:     { label: 'Ready for pickup',    tone: 'ok'   },
    served:    { label: 'Food served',         tone: 'ok'   },
    rejected:  { label: 'Rejected by kitchen', tone: 'bad'  },
  };
  const s = statusMap[d.status] || statusMap.pending;

  let timeText = '';
  if (d.status === 'pending') {
    timeText = `Est. ${d.estimatedMinutes} min`;
  } else if (d.status === 'accepted' || d.status === 'preparing') {
    timeText = d.isDelayed ? `${d.elapsedMinutes - d.estimatedMinutes} min late` : `${d.remainingMinutes} min left`;
  }
  const prev = el.dataset.state;
  el.dataset.state = d.status;
  el.className = 'om-kstatus ' + s.tone;
  el.innerHTML = `${ic('chef')}<span class="om-ks-label">${s.label}</span>${timeText ? `<span class="om-ks-time">${timeText}</span>` : ''}`;
  if (prev && prev !== d.status) { uiFlash(el); if (d.status === 'ready') playSound('success'); }

  if (d.status === 'served') _omStopKitchenPolling();
}

// ── FILTER PRODUCTS ───────────────────────────────
function omSetCategory(cat, btn) {
  const sel = document.getElementById('omCategoryFilter');
  if (sel) sel.value = cat;
  document.querySelectorAll('#omCatTabs .tab').forEach(t => t.classList.toggle('active', t === btn));
  omFilterProducts();
}

function omFilterProducts(query) {
  const q   = (typeof query === 'string' ? query : document.getElementById('omProductSearch')?.value || '').toLowerCase();
  const cat = document.getElementById('omCategoryFilter')?.value || '';
  const filtered = _omProducts.filter(p => {
    const matchQ   = !q   || p.name.toLowerCase().includes(q);
    const matchCat = !cat || p.category.toLowerCase() === cat.toLowerCase();
    return matchQ && matchCat;
  });
  _omRenderProducts(filtered);
}

// Enter in the search box adds the first match (fast keyboard ordering)
document.addEventListener('keydown', e => {
  if (e.target.id !== 'omProductSearch' || e.key !== 'Enter') return;
  const first = document.querySelector('#omProductGrid .om-tile:not(.out)');
  if (first) { e.preventDefault(); first.click(); }
});

// ── RENDER PRODUCTS ───────────────────────────────
function _omRenderProducts(products) {
  const grid = document.getElementById('omProductGrid');
  if (!grid) return;
  if (!products.length) {
    grid.innerHTML = `<div class="om-span">${uiEmpty('search', 'No products found', 'Try another name or category.')}</div>`;
    return;
  }
  const inCart = {};
  (_omOrder?.items || []).forEach(i => { const k = (i.source_type === 'kitchen' ? 'kit_' : 'bar_') + i.source_id; inCart[k] = (inCart[k] || 0) + (+i.qty || 0); });
  const groups = [['Drink', 'Drinks'], ['Kitchen', 'Kitchen']]
    .map(([c, label]) => [label, products.filter(p => p.category === c)])
    .filter(([, list]) => list.length);
  const tile = p => {
    const outOfStock = p.itemType === 'direct' && p.stock <= 0;
    const lowStock   = p.itemType === 'direct' && p.stock > 0 && p.stock <= Math.max(5, +p.minStock || 0);
    const qty        = inCart[p.id] || 0;
    const stockText  = p.itemType === 'direct' ? `${+p.stock} in stock` : p.itemType === 'recipe' ? 'Cocktail' : 'Kitchen';
    return `<button class="om-tile${outOfStock ? ' out' : ''}" data-pid="${p.id}"
      onclick="${outOfStock ? `toast('Out of stock','error')` : `omAddItem('${p.id}', this)`}"
      ${outOfStock ? 'aria-disabled="true"' : ''} title="${esc(p.name)}">
      <span class="om-tile-img">${uiProductThumb(p)}${qty ? `<span class="om-tile-qty">${qty}</span>` : ''}</span>
      <span class="om-tile-name">${esc(p.name)}</span>
      <span class="om-tile-foot"><span class="om-tile-price">${fmtRWF(p.price)}</span>
        <span class="om-tile-stock${outOfStock ? ' bad' : lowStock ? ' warn' : ''}">${outOfStock ? 'Out of stock' : stockText}</span></span>
    </button>`;
  };
  grid.innerHTML = groups.map(([label, list]) => `<div class="om-group-h">${label}<span>${list.length}</span></div>${list.map(tile).join('')}`).join('');
}

// ── ADD ITEM ──────────────────────────────────────
async function omAddItem(productId, tileEl) {
  if (!_omOrder || _omOrder.status !== 'draft') {
    toast(_omOrder && _omOrder.status === 'validated' ? 'Order is already validated' : 'This order can no longer be changed', 'warning'); return;
  }

  const product = _omProducts.find(p => p.id === productId);
  if (!product) return;

  // Stock check for direct bar items
  if (product.itemType === 'direct' && product.stock <= 0) {
    toast(`${product.name} is out of stock`, 'error'); return;
  }
  if (product.itemType === 'direct' && product.stock <= 3) {
    toast(`Only ${product.stock} ${product.name} left in stock`, 'warning');
  }

  // instant feedback on the tile while the server confirms
  if (tileEl) {
    tileEl.classList.remove('hit'); void tileEl.offsetWidth; tileEl.classList.add('hit');
    const img = tileEl.querySelector('.om-tile-img');
    let b = tileEl.querySelector('.om-tile-qty');
    if (!b && img) { b = document.createElement('span'); b.className = 'om-tile-qty'; b.textContent = '0'; img.appendChild(b); }
    if (b) { b.textContent = (+b.textContent || 0) + 1; b.classList.remove('tick'); void b.offsetWidth; b.classList.add('tick'); }
  }

  const res = await api('orders', 'add_item', {
    orderId:    _omOrder.orderId,
    sourceType: product.sourceType,
    sourceId:   product.sourceId,
    name:       product.name,
    price:      product.price,
    category:   product.category,
    qty:        1,
    clientUuid: newUuid(),
  });
  if (!res.ok) { toast(res.error || 'Failed to add item', 'error'); omFilterProducts(); return; }

  // Update local stock count for direct items
  if (product.itemType === 'direct') product.stock = Math.max(0, product.stock - 1);

  _omLastAdded = product;
  await _omRefresh();
  omFilterProducts();
}

// ── CHANGE QTY ────────────────────────────────────
async function omChangeQty(itemId, delta) {
  if (!_omOrder) return;
  const item = _omOrder.items.find(i => i.id === itemId);
  if (!item) return;
  const newQty = item.qty + delta;
  if (newQty < 1) { await omRemoveItem(itemId); return; }

  // Stock check for increase
  if (delta > 0) {
    const product = _omProducts.find(p => p.sourceId === item.source_id && p.sourceType === item.source_type);
    if (product && product.itemType === 'direct' && product.stock <= 0) {
      toast(`No more ${item.product_name} in stock`, 'error'); return;
    }
  }

  // show the new quantity straight away
  const row = document.querySelector(`.om-line[data-item="${itemId}"]`);
  const q = row && row.querySelector('.om-qty-val');
  if (q) { q.textContent = newQty; q.classList.remove('tick'); void q.offsetWidth; q.classList.add('tick'); }

  const res = await api('orders', 'update_item', { itemId, qty: newQty });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); await _omRefresh(); return; }
  await _omRefresh();
  omFilterProducts();
}

// ── REMOVE ITEM ───────────────────────────────────
async function omRemoveItem(itemId) {
  if (!_omOrder) return;
  if (!confirm('Remove this item?')) return;
  const row = document.querySelector(`.om-line[data-item="${itemId}"]`);
  if (row) row.classList.add('leaving');
  const res = await api('orders', 'remove_item', { itemId });
  if (!res.ok) { if (row) row.classList.remove('leaving'); toast(res.error || 'Failed', 'error'); return; }
  toast('Item removed', 'info');
  await _omRefresh();
  // Reload products to reflect restored stock
  loadOrderManagement(_omOrder.orderId, _omOrder._fromCreation);
}

// ── SAVE NOTE ─────────────────────────────────────
async function omSaveNote() {
  if (!_omOrder) return;
  const note = document.getElementById('omOrderNote')?.value?.trim() || '';
  _omOrder.note = note;
  await api('orders', 'save_note', { orderId: _omOrder.orderId, note });
}

// ── VALIDATE ORDER ────────────────────────────────
async function omValidateOrder() {
  if (!_omOrder || !_omOrder.items.length) { toast('Add items first', 'error'); return; }
  const btn = document.getElementById('omValidateBtn');
  uiBusy(btn, true); btn.disabled = true;

  const note = document.getElementById('omOrderNote')?.value?.trim() || '';
  _omOrder.note = note;

  const res = await api('orders', 'validate', { orderId: _omOrder.orderId, note });
  uiBusy(btn, false); btn.disabled = false;
  if (!res.ok) { toast(res.error || 'Validation failed', 'error'); return; }

  _omOrder.status = 'validated';
  const hasFood = _omOrder.items.some(i => (i.category || '').toLowerCase() === 'kitchen');
  toast(hasFood ? 'Order validated — food sent to the kitchen' : 'Order validated', 'success');
  await _omRefresh();
  omFilterProducts();
  _omStartKitchenPolling();
}

// ── PROCEED TO PAYMENT ────────────────────────────
async function omProceedToPayment() {
  if (!_omOrder || _omOrder.status !== 'validated') {
    toast('Validate the order first', 'error'); return;
  }
  // Food must be served before payment and receipt
  const k = await apiGet('kitchen_orders', 'order_status', { orderId: _omOrder.orderId });
  if (k.ok && k.hasKitchenOrder && k.data.status !== 'served') {
    if (k.data.status === 'rejected') {
      toast('Kitchen rejected the food on this order. Void it and create a new order without that food.', 'error');
    } else {
      const left = k.data.isDelayed ? 'delayed' : `about ${k.data.remainingMinutes} min left`;
      toast(`Kitchen has not served this order yet (${k.data.status}, ${left}). Payment opens once food is served.`, 'warning');
    }
    return;
  }
  loadPaymentInvoice(_omOrder);
}

// ── REFRESH ───────────────────────────────────────
async function _omRefresh() {
  const res = await apiGet('orders', 'get', { orderId: _omOrder.orderId });
  if (res.ok) {
    const from = _omOrder._fromCreation;
    _omOrder       = res.order;
    _omOrder.items = res.items || [];
    _omOrder.total = res.total || 0;
    _omOrder._fromCreation = from;
  }
  _omUpdateHeader();
  _omRenderItems();
}

// ── RENDER ITEMS ──────────────────────────────────
function _omRenderItems() {
  const list        = document.getElementById('omItemsList');
  const totEl       = document.getElementById('omTotal');
  const cntEl       = document.getElementById('omItemCount');
  const items       = _omOrder?.items || [];
  const total       = _omOrder?.total || 0;
  const editable    = _omOrder?.status === 'draft';
  const units       = items.reduce((a, i) => a + (+i.qty || 0), 0);

  if (totEl) uiTween(totEl, total);
  if (cntEl) cntEl.textContent = `${units} item${units !== 1 ? 's' : ''}`;

  if (!list) return;
  if (!items.length) {
    list.innerHTML = uiEmpty('bag', 'No items yet', 'Tap a product to add it to this order.');
    const preview = document.getElementById('omRoutingPreview');
    if (preview) preview.style.display = 'none';
    return;
  }

  list.innerHTML = items.map(item => {
    const isKitchen = (item.category || '').toLowerCase() === 'kitchen';
    const p = _omProducts.find(x => x.sourceId === item.source_id && x.sourceType === item.source_type) || { name: item.product_name, kind: isKitchen ? 'kitchen' : 'bar' };
    return `<div class="om-line" data-item="${item.id}" data-src="${esc(item.source_type)}_${item.source_id}">
      ${uiProductThumb(p, 'sm')}
      <div class="om-line-main">
        <div class="om-line-name">${esc(item.product_name)}</div>
        <div class="om-line-meta">${fmtRWF(item.unit_price)} · ${isKitchen ? 'Kitchen' : 'Bar'}</div>
      </div>
      <div class="om-qty">
        ${editable ? `<button class="om-qty-btn" onclick="omChangeQty(${item.id},-1)" aria-label="One less">${ic('minus')}</button>` : ''}
        <span class="om-qty-val">${editable ? '' : '×'}${item.qty}</span>
        ${editable ? `<button class="om-qty-btn" onclick="omChangeQty(${item.id},1)" aria-label="One more">${ic('plus')}</button>` : ''}
      </div>
      <div class="om-line-total">${fmtRWF(item.total)}</div>
      ${editable ? `<button class="om-line-x" onclick="omRemoveItem(${item.id})" title="Remove" aria-label="Remove">${ic('x')}</button>` : ''}
    </div>`;
  }).join('');

  // highlight the line that just changed
  if (_omLastAdded) {
    const key = (_omLastAdded.sourceType === 'kitchen' ? 'kitchen' : 'bar') + '_' + _omLastAdded.sourceId;
    const line = list.querySelector(`.om-line[data-src="${key}"]`);
    if (line) { uiFlash(line); line.scrollIntoView({ block: 'nearest', behavior: UI_REDUCED ? 'auto' : 'smooth' }); }
    _omLastAdded = null;
  }

  // Routing preview
  const barItems = items.filter(i => (i.category || '').toLowerCase() !== 'kitchen');
  const kitItems = items.filter(i => (i.category || '').toLowerCase() === 'kitchen');
  const preview  = document.getElementById('omRoutingPreview');
  if (preview) {
    preview.style.display = '';
    document.getElementById('omBarItems').style.display = barItems.length ? '' : 'none';
    document.getElementById('omKitchenItems').style.display = kitItems.length ? '' : 'none';
    document.getElementById('omBarItemsList').textContent     = barItems.map(i => `${i.product_name} ×${i.qty}`).join(', ');
    document.getElementById('omKitchenItemsList').textContent = kitItems.map(i => `${i.product_name} ×${i.qty}`).join(', ');
  }
}

// ── BACK ──────────────────────────────────────────
function omBack() {
  _omStopKitchenPolling();
  // If we came from the orders list (sidebar), go back to list
  // If we came from order creation, go back to order creation
  if (_omOrder && _omOrder._fromCreation) {
    showPage('order-creation');
    loadOrderCreation();
  } else {
    loadAllOrders();
  }
}

// Phones: the order panel is a bottom bar that expands on tap
function omToggleCart(force) {
  if (window.innerWidth > 900) return;
  const c = document.getElementById('omRightPanel');
  if (c) c.classList.toggle('open', force);
}
