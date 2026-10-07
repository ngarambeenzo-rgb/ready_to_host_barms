/* ═══════════════════════════════════════════════════
   BARMS PRO — order.js
   Sales Order Page (Page 2)
   Handles dine-in sessions + takeaway orders
═══════════════════════════════════════════════════ */

let _orderProducts  = [];
let _orderSession   = null; // {sessionId, type, tableName, items[], total, note}
let _orderPrevPage  = 'pos'; // page to go back to

// ── LOAD ORDER PAGE ────────────────────────────────
async function loadOrderPage(type, sessionId, tableHint) {
  _orderSession = { type, sessionId, tableName: tableHint?.name || '', items: [], total: 0, note: '' };
  _orderPrevPage = 'pos';

  // Load session data
  const res = await apiGet('sessions', 'get_session', { sessionId });
  if (!res.ok) { toast(res.error || 'Could not load order', 'error'); return; }
  _orderSession.items = res.items || [];
  _orderSession.total = res.total || 0;
  _orderSession.note  = res.session?.note || '';
  _orderSession.tableName = res.session?.tableName || tableHint?.name || '';

  // Load products
  const pRes = await apiGet('products', 'list');
  _orderProducts = (pRes.data || []).filter(p => p.active);

  // Populate category filter
  const cats = [...new Set(_orderProducts.map(p => p.category).filter(Boolean))];
  const catSel = document.getElementById('orderCategoryFilter');
  if (catSel) {
    catSel.innerHTML = `<option value="">All Categories</option>` +
      cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }

  // Update page header
  const titleEl = document.getElementById('orderPageTitle');
  const subEl   = document.getElementById('orderPageSub');
  const panelTitle = document.getElementById('orderPanelTitle');
  const panelSub   = document.getElementById('orderPanelSub');
  if (titleEl) titleEl.textContent = type === 'takeaway' ? `${_orderSession.tableName}` : `${_orderSession.tableName}`;
  if (subEl)   subEl.textContent   = `Session #${sessionId}`;
  if (panelTitle) panelTitle.textContent = type === 'takeaway' ? `Takeaway ${_orderSession.tableName}` : `Table: ${_orderSession.tableName}`;
  if (panelSub)   panelSub.textContent   = `Session #${sessionId}`;

  // Restore note
  const noteEl = document.getElementById('orderNote');
  if (noteEl) noteEl.value = _orderSession.note;

  renderOrderProducts(_orderProducts);
  renderOrderItems();
  showPage('order');
}

// ── FILTER PRODUCTS ────────────────────────────────
function filterOrderProducts(query) {
  const q   = (typeof query === 'string' ? query : document.getElementById('orderProductSearch')?.value || '').toLowerCase();
  const cat = document.getElementById('orderCategoryFilter')?.value || '';
  const filtered = _orderProducts.filter(p => {
    const matchQ   = !q   || p.name.toLowerCase().includes(q);
    const matchCat = !cat || p.category === cat;
    return matchQ && matchCat;
  });
  renderOrderProducts(filtered);
}

// ── RENDER PRODUCTS ────────────────────────────────
function renderOrderProducts(products) {
  const grid = document.getElementById('orderProductGrid');
  if (!grid) return;
  if (!products.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--muted)">No products found</div>`;
    return;
  }
  grid.innerHTML = products.map(p => {
    const outOfStock = p.stock <= 0;
    return `<div class="order-product-card${outOfStock?' out-of-stock':''}" onclick="${outOfStock?'':` addOrderItem(${p.id})`}">
      <div style="font-size:22px;margin-bottom:6px">${p.icon||''}</div>
      <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:4px;line-height:1.3">${esc(p.name)}</div>
      <div style="font-size:13px;font-weight:800;color:var(--blue);margin-bottom:4px">${fmtRWF(p.sell_price||p.sellPrice||0)}</div>
      <div style="font-size:10px;color:${outOfStock?'var(--red)':'var(--muted)'}">Stock: ${p.stock}</div>
    </div>`;
  }).join('');
}

// ── ADD ITEM ───────────────────────────────────────
async function addOrderItem(productId) {
  if (!_orderSession) return;
  const product = _orderProducts.find(p => p.id === productId);
  if (!product || product.stock <= 0) { toast('Out of stock', 'error'); return; }

  const res = await api('sessions', 'add_item', {
    sessionId: _orderSession.sessionId,
    productId,
    qty: 1,
    clientUuid: newUuid(),
  });
  if (!res.ok) { toast(res.error || 'Failed to add item', 'error'); return; }

  // Refresh session
  const updated = await apiGet('sessions', 'get_session', { sessionId: _orderSession.sessionId });
  if (updated.ok) {
    _orderSession.items = updated.items || [];
    _orderSession.total = updated.total || 0;
    // Refresh product stock count locally
    const prod = _orderProducts.find(p => p.id === productId);
    if (prod) prod.stock = Math.max(0, prod.stock - 1);
    renderOrderItems();
    filterOrderProducts();
  }
  toast(`${product.name} added `, 'success');
}

// ── CHANGE ITEM QTY ────────────────────────────────
async function changeOrderItemQty(itemId, delta) {
  if (!_orderSession) return;
  const item = _orderSession.items.find(i => i.id === itemId);
  if (!item) return;
  const newQty = item.qty + delta;
  if (newQty < 1) {
    await removeOrderItem(itemId);
    return;
  }
  const res = await api('sessions', 'update_item_qty', { itemId, qty: newQty });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  const updated = await apiGet('sessions', 'get_session', { sessionId: _orderSession.sessionId });
  if (updated.ok) {
    _orderSession.items = updated.items || [];
    _orderSession.total = updated.total || 0;
    renderOrderItems();
  }
}

// ── REMOVE ITEM ────────────────────────────────────
async function removeOrderItem(itemId) {
  if (!_orderSession) return;
  if (!confirm('Remove this item?')) return;
  const res = await api('sessions', 'remove_item', { itemId });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast('Item removed');
  const updated = await apiGet('sessions', 'get_session', { sessionId: _orderSession.sessionId });
  if (updated.ok) {
    _orderSession.items = updated.items || [];
    _orderSession.total = updated.total || 0;
    renderOrderItems();
  }
}

// ── RENDER ORDER ITEMS ─────────────────────────────
function renderOrderItems() {
  const list  = document.getElementById('orderItemsList');
  const totEl = document.getElementById('orderTotal');
  const cntEl = document.getElementById('orderItemCount');
  const chkBtn = document.getElementById('checkoutBtn');

  const total = _orderSession?.total || 0;
  const items = _orderSession?.items || [];

  if (totEl) totEl.textContent = fmtRWF(total);
  if (cntEl) cntEl.textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;
  if (chkBtn) chkBtn.disabled = items.length === 0;

  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px">No items yet — tap a product to add</div>`;
    return;
  }
  list.innerHTML = items.map(item => `
    <div class="order-item-row">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.product_name)}</div>
        <div style="font-size:11px;color:var(--muted)">${fmtRWF(item.unit_price||item.unitPrice)} each</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <button class="order-qty-btn" onclick="changeOrderItemQty(${item.id},-1)">−</button>
        <span style="font-size:13px;font-weight:700;min-width:20px;text-align:center">${item.qty}</span>
        <button class="order-qty-btn" onclick="changeOrderItemQty(${item.id},1)">+</button>
      </div>
      <div style="font-size:13px;font-weight:800;color:var(--text);min-width:70px;text-align:right">${fmtRWF(item.total)}</div>
      <button onclick="removeOrderItem(${item.id})" style="background:var(--red-lt);border:none;color:var(--red);border-radius:6px;padding:4px 7px;cursor:pointer;font-size:11px;flex-shrink:0">✕</button>
    </div>
  `).join('');
}

// ── HOLD ORDER ─────────────────────────────────────
async function holdOrder() {
  // Save note then go back to POS
  const note = document.getElementById('orderNote')?.value?.trim() || '';
  if (note && _orderSession) {
    await api('sessions', 'save_note', { sessionId: _orderSession.sessionId, note });
  }
  toast('Order saved — table is held');
  showPage('pos');
  loadPOS();
}

// ── GO TO CHECKOUT ─────────────────────────────────
function goToCheckout() {
  if (!_orderSession || !_orderSession.items.length) {
    toast('Add items before checkout', 'error');
    return;
  }
  // Save note
  const note = document.getElementById('orderNote')?.value?.trim() || '';
  _orderSession.note = note;
  loadCheckoutPage();
}

// ── CLOSE ORDER PAGE ───────────────────────────────
function closeOrderPage() {
  showPage('pos');
  loadPOS();
}
