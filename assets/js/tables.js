/* ═══════════════════════════════════════════════════
   BARMS PRO — tables.js
   Table Session & Receipt Management
   Kinyarwanda waiter interface
═══════════════════════════════════════════════════ */

let _allTables      = [];
let _activeSession  = null;
let _sessionProducts= [];
let _selectedPayMethod = 'Cash';
let _currentReceipt = null;
let _barName        = 'BarMS Pro';

// ── LOAD TABLES ───────────────────────────────────
async function loadTables() {
  const res = await apiGet('sessions', 'list_tables');
  if (!res.ok) { toast('Could not load data', 'error'); return; }
  _allTables = res.data || [];
  renderTablesGrid(_allTables);

  // Load recent sessions
  const sRes = await apiGet('sessions', 'recent_sessions');
  if (sRes.ok) renderSessionsTable(sRes.data || []);

  // Get bar name from settings
  try {
    try { const sett = await apiGet('misc', 'bar_info'); if (sett.ok) _barName = sett.barName || 'BarMS Pro'; } catch(e) {}
  } catch(e) {}
}

// ── RENDER TABLES GRID ────────────────────────────
function renderTablesGrid(tables) {
  const grid = document.getElementById('tablesGrid');
  if (!grid) return;

  if (!tables.length) {
    grid.innerHTML = `<div style="grid-column:1/-1">${uiEmpty('table','Nta ameza aboneka','Add a table to start.')}</div>`;
    return;
  }

  grid.innerHTML = tables.map(t => {
    const occupied = t.status === 'occupied';
    const mins     = t.openedAt ? Math.floor((Date.now() - new Date(t.openedAt)) / 60000) : 0;
    const timeStr  = occupied ? (mins < 60 ? `${mins}min` : `${Math.floor(mins/60)}h${mins%60}m`) : '';

    return `
    <div class="oc-table ${occupied ? 'occupied has-order' : 'free'}" role="button" tabindex="0" onclick="handleTableClick(${t.id})">
      <span class="oc-table-top"><span class="oc-table-name">${esc(t.name)}</span><span class="status ${occupied ? 'bad' : 'ok'}">${occupied ? 'Occupied' : 'Free'}</span></span>
      <span class="oc-table-seats">${t.capacity} abantu${timeStr ? ` · open ${timeStr}` : ''}</span>
      ${occupied && t.orderId ? `<span class="oc-table-order"><span>${t.orderItemCount} ibintu · ${esc(t.orderNumber || '')}</span><b>${fmtRWF(t.orderTotal)}</b></span>` : ''}
      ${occupied && !t.orderId && t.sessionId ? `<span class="oc-table-order"><span>Old bill · ${t.itemCount} ibintu</span><b>${fmtRWF(t.sessionTotal)}</b></span>` : ''}
      <span class="tb-card-actions">
        <button class="btn btn-sm ${occupied ? 'btn-green' : 'btn-blue'}" style="flex:1">${occupied ? (t.orderId ? 'Open order' : t.sessionId ? 'Pay old bill' : 'Gufungura Table') : 'Fungura Table'}</button>
        ${!occupied ? `<button class="icon-act danger" title="Remove table" aria-label="Remove table" onclick="event.stopPropagation();deleteTable(${t.id},'${esc(t.name)}')">${ic('trash')}</button>` : ''}
      </span>
    </div>`;
  }).join('');
}

// ── HANDLE TABLE CLICK ────────────────────────────
async function handleTableClick(tableId) {
  const table = _allTables.find(t => t.id === tableId);
  if (!table) return;

  if (table.status === 'occupied' && table.sessionId) {
    // Open existing table session (old flow)
    await openSessionModal(table.sessionId, table);
  } else if (table.status === 'occupied' && table.orderId) {
    // Table has an open order (new flow) — go to Order Management
    toast(`${table.name} has an open order — opening Order Management`, 'info');
    loadOrderManagement(table.orderId);
  } else if (table.status === 'occupied') {
    // Occupied but no session or order found — may be stale
    if (!confirm(`${table.name} appears occupied but has no active order.\nMark it as free?`)) return;
    const res = await api('sessions', 'mark_available', { tableId });
    if (res.ok) { toast(`${table.name} marked as free `); await loadTables(); }
  } else {
    // Free table — start a new order for it (same as New order → Dine-in → this table)
    const res = await api('orders', 'create', { type: 'dinein', tableId, tableName: table.name });
    if (!res.ok) { toast(res.error || 'Could not open the table', 'error'); return; }
    toast(`${table.name}: order ${res.orderNumber} opened`);
    loadOrderManagement(res.orderId, true);
  }
}

// ── OPEN SESSION MODAL ────────────────────────────
async function openSessionModal(sessionId, tableHint) {
  _activeSession = null;

  const res = await apiGet('sessions', 'get_session', {sessionId});
  if (!res.ok) { toast(res.error || 'Error', 'error'); return; }

  _activeSession = res.session;

  // an old-system bill: it can only be paid now (no items from the retired list)
  _sessionProducts = [];

  // Update modal header
  const titleEl = document.getElementById('sessionModalTitle');
  const metaEl  = document.getElementById('sessionModalMeta');
  if (titleEl) titleEl.textContent = `${res.session.tableName} — Session #${sessionId}`;
  if (metaEl)  metaEl.textContent  = `Uguruwe na: ${res.session.openedBy} · ${new Date(res.session.openedAt).toLocaleTimeString('en-RW',{hour:'2-digit',minute:'2-digit'})}`;

  renderSessionItems(res.items, res.total);

  const modal = document.getElementById('sessionModal');
  if (modal) modal.style.display = 'flex';
}

function closeSessionModal() {
  const modal = document.getElementById('sessionModal');
  if (modal) modal.style.display = 'none';
  _activeSession = null;
  loadTables();
}

// ── RENDER SESSION ITEMS ──────────────────────────
function renderSessionItems(items, total) {
  const list = document.getElementById('sessionItemsList');
  const totEl = document.getElementById('sessionTotal');

  if (totEl) totEl.textContent = fmtRWF(total || 0);

  // Update pay button
  const payBtn = document.getElementById('payBtn');
  if (payBtn) payBtn.disabled = !items.length;

  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">No items on this table yet</div>`;
    return;
  }

  list.innerHTML = items.map(item => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--card2);border-radius:8px;margin-bottom:6px">
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(item.product_name)}</div>
        <div style="font-size:11px;color:var(--muted)">${item.qty} × ${fmtRWF(item.unitPrice||item.unit_price)}</div>
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--text)">${fmtRWF(item.total)}</div>

    </div>
  `).join('');
}

// ── SESSION PRODUCT CHANGE ────────────────────────
function onSessionProductChange() {
  const sel = document.getElementById('sessionProductSel');
  const infoEl = document.getElementById('sessionProductInfo');
  if (!sel || !infoEl) return;
  const p = _sessionProducts.find(p => p.id === +sel.value);
  if (p) infoEl.textContent = `Stock: ${p.stock} · Price: ${fmtRWF(p.sellPrice||p.sell_price)}`;
}

// ── ADD ITEM TO SESSION ───────────────────────────
async function addItemToSession() {
  if (!_activeSession) return;
  const sel = document.getElementById('sessionProductSel');
  const qty = +document.getElementById('sessionQtyInput')?.value || 1;
  const productId = +sel?.value;
  if (!productId) { toast('Hitamo igicuruzwa', 'error'); return; }

  const res = await api('sessions', 'add_item', {
    sessionId: _activeSession.id,
    productId,
    qty,
    clientUuid: newUuid(),
  });

  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast(`${res.productName} added `);

  // Refresh session
  const updated = await apiGet('sessions', 'get_session', {sessionId: _activeSession.id});
  if (updated.ok) renderSessionItems(updated.items, updated.total);

  // Reset qty
  const qtyEl = document.getElementById('sessionQtyInput');
  if (qtyEl) qtyEl.value = 1;
}

// ── REMOVE ITEM ───────────────────────────────────
async function removeSessionItem(saleId) {
  if (!confirm('Remove this item?')) return;
  const res = await api('sessions', 'remove_item', { saleId });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast('Item removed ');
  const updated = await apiGet('sessions', 'get_session', {sessionId: _activeSession.id});
  if (updated.ok) renderSessionItems(updated.items, updated.total);
}

// ── PAYMENT MODAL ─────────────────────────────────
function showPaymentModal() {
  if (!_activeSession) return;
  const updated = document.getElementById('sessionTotal')?.textContent || 'RWF 0';
  const tableNameEl = document.getElementById('payModalTableName');
  const totalEl     = document.getElementById('payModalTotal');
  if (tableNameEl) tableNameEl.textContent = _activeSession.tableName;
  if (totalEl)     totalEl.textContent     = updated;
  _selectedPayMethod = 'Cash';
  document.querySelectorAll('.pay-method-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('pm_Cash')?.classList.add('active');
  const modal = document.getElementById('paymentModal');
  if (modal) modal.style.display = 'flex';
}

function selectPayMethod(method, btn) {
  _selectedPayMethod = method;
  document.querySelectorAll('.pay-method-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

// ── PROCESS PAYMENT ───────────────────────────────
async function processPayment() {
  if (!_activeSession) return;
  const phone   = document.getElementById('payPhone')?.value?.trim() || '';
  const btn     = document.getElementById('confirmPayBtn');
  if (btn) { btn.textContent = 'Loading...'; btn.disabled = true; }

  const res = await api('sessions', 'close_session', {
    sessionId:     _activeSession.id,
    paymentMethod: _selectedPayMethod,
    customerPhone: phone,
  });

  if (btn) { btn.textContent = '✓ Confirm Payment'; btn.disabled = false; }

  if (!res.ok) { toast(res.error || 'Kwishyura byanze', 'error'); return; }

  // Close payment modal
  document.getElementById('paymentModal').style.display = 'none';
  document.getElementById('sessionModal').style.display = 'none';

  // Store receipt data
  _currentReceipt = res;

  // Show receipt
  renderReceipt(res);
  document.getElementById('receiptModal').style.display = 'flex';

  loadTables();
}

// ── RENDER AESTHETIC RECEIPT ──────────────────────
function renderReceipt(data) {
  const el = document.getElementById('receiptContent');
  if (!el) return;

  const date    = new Date(data.issuedAt || new Date());
  const dateStr = date.toLocaleDateString('en-RW', { day:'2-digit', month:'short', year:'numeric' });
  const timeStr = date.toLocaleTimeString('en-RW', { hour:'2-digit', minute:'2-digit' });

  const items   = data.items || [];
  const total   = data.total || 0;

  el.innerHTML = `
    <div style="font-family:'DM Mono',monospace;color:#1a1a2e;max-width:320px;margin:0 auto">

      <!-- Header -->
      <div style="text-align:center;padding-bottom:12px;border-bottom:2px dashed #ddd;margin-bottom:14px">
        <div style="font-size:28px;margin-bottom:4px"></div>
        <div style="font-size:18px;font-weight:900;letter-spacing:.1em;color:#1E3A8A">${esc(_barName.toUpperCase())}</div>
        <div style="font-size:10px;color:#666;margin-top:2px;letter-spacing:.05em">BAR MANAGEMENT SYSTEM</div>
      </div>

      <!-- Meta -->
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#444;margin-bottom:14px">
        <div>
          <div style="font-weight:700">${esc(data.tableName)}</div>
          <div style="color:#666">Session #${data.sessionId}</div>
        </div>
        <div style="text-align:right">
          <div>${dateStr}</div>
          <div style="color:#666">${timeStr}</div>
        </div>
      </div>

      <div style="border-top:1px dashed #ddd;margin-bottom:10px"></div>

      <!-- Items -->
      <div style="margin-bottom:12px">
        <div style="display:grid;grid-template-columns:1fr auto auto;gap:4px;font-size:10px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;padding:0 2px">
          <span>Product</span><span style="text-align:center">Quantity</span><span style="text-align:right">Total</span>
        </div>
        ${items.map(item => `
          <div style="display:grid;grid-template-columns:1fr auto auto;gap:4px;font-size:12px;padding:5px 2px;border-bottom:1px solid #f0f0f0">
            <span style="font-weight:600">${esc(item.name)}</span>
            <span style="text-align:center;color:#666">×${item.qty}</span>
            <span style="text-align:right;font-weight:700">${(item.total).toLocaleString()}</span>
          </div>
        `).join('')}
      </div>

      <!-- Totals -->
      <div style="border-top:2px solid #1E3A8A;padding-top:10px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#666;margin-bottom:4px">
          <span>Subtotal</span><span>${total.toLocaleString()} RWF</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:900;color:#1E3A8A">
          <span>IGITERANYO</span><span>${total.toLocaleString()} RWF</span>
        </div>
        <div style="font-size:11px;color:#666;margin-top:4px">
          Kwishyura: <strong>${esc(data.paymentMethod)}</strong>
          ${data.customerPhone ? ` · ${esc(data.customerPhone)}` : ''}
        </div>
      </div>

      <!-- Receipt number & staff -->
      <div style="font-size:10px;color:#999;border-top:1px dashed #ddd;padding-top:10px;margin-bottom:10px">
        <div>Receipt: <strong>${esc(data.receiptNumber)}</strong></div>
        <div>Served by: ${esc(data.issuedBy)}</div>
      </div>

      <!-- Footer -->
      <div style="text-align:center;padding-top:10px;border-top:2px dashed #ddd">
        <div style="font-size:14px;font-weight:700;color:#1E3A8A;letter-spacing:.02em">Murakoze Kudusura!</div>
        <div style="font-size:10px;color:#999;margin-top:4px"></div>
        <div style="font-size:9px;color:#bbb;margin-top:4px">Powered by BarMS Pro</div>
      </div>
    </div>
  `;
}

// ── PRINT RECEIPT ─────────────────────────────────
function printReceipt() {
  const content = document.getElementById('receiptContent')?.innerHTML;
  if (!content) return;
  const win = window.open('', '_blank', 'width=380,height=600');
  win.document.write(`
    <!DOCTYPE html><html><head>
    <title>Inyemezabwishyu</title>
    <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{background:#fff;padding:16px;font-family:'DM Mono',monospace}
      @media print{@page{margin:5mm;size:auto}body{width:100%;max-width:72mm;margin:0 auto;padding:0}}
    </style>
    </head><body>${content}
    <script>window.onload=()=>{window.print();window.close()}<\/script>
    </body></html>
  `);
  win.document.close();
  // Mark as printed
  if (_currentReceipt?.receiptId) {
    api('sessions', 'mark_printed', { receiptId: _currentReceipt.receiptId }).catch(()=>{});
  }
}

// ── SEND SMS ──────────────────────────────────────
async function sendSmsReceipt() {
  if (!_currentReceipt?.receiptId) { toast('Nta nyemezabwishyu iboneka', 'error'); return; }
  const phone = prompt('Enter phone number:\n(e.g. 0788000000)') || '';
  if (!phone) return;
  const res = await api('sessions', 'send_sms', { receiptId: _currentReceipt.receiptId, phone });
  toast(res.ok ? `SMS sent to ${phone} ` : (res.error || 'Failed'), res.ok ? 'success' : 'error');
}

// ── SEND WHATSAPP ──────────────────────────────────
async function sendWhatsAppReceipt() {
  if (!_currentReceipt?.receiptId) { toast('Nta nyemezabwishyu iboneka', 'error'); return; }
  const phone = prompt('Enter WhatsApp number:\n(e.g. 250788000000)') || '';
  if (!phone) return;

  const res = await api('sessions', 'send_whatsapp', { receiptId: _currentReceipt.receiptId, phone });
  if (res.ok) {
    toast(`WhatsApp sent to ${phone} `);
    // Open WhatsApp as fallback
    if (res.waUrl) {
      const items  = (_currentReceipt.items || []).map(i => `${i.name} ×${i.qty}`).join(', ');
      const msg    = encodeURIComponent(`*${_barName}*\n${_currentReceipt.tableName} — Receipt #${_currentReceipt.receiptNumber}\n${items}\n*Total: ${(_currentReceipt.total||0).toLocaleString()} RWF*\nMurakoze Kudusura! `);
      window.open(`https://wa.me/${phone.replace(/\D/g,'')}?text=${msg}`, '_blank');
    }
  } else {
    toast(res.error || 'Failed', 'error');
  }
}

function closeReceiptModal() {
  document.getElementById('receiptModal').style.display = 'none';
  _currentReceipt = null;
}

// ── ADD TABLE MODAL ───────────────────────────────
function showAddTableModal() {
  document.getElementById('modalContent').innerHTML = `
    <h3 style="margin-bottom:18px">Add New Table</h3>
    <div class="form-group">
      <label class="form-label">Table Name *</label>
      <input class="form-input" id="newTableName" placeholder="e.g. Table 6, VIP Room, Outside…" autofocus/>
    </div>
    <div class="form-group">
      <label class="form-label">Seating Capacity</label>
      <input type="number" class="form-input" id="newTableCap" value="4" min="1" max="50"/>
    </div>
    <div style="display:flex;gap:10px;margin-top:6px">
      <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="submitAddTable()">Add Table</button>
      <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="closeModal()">✕ Cancel</button>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('show');
  setTimeout(() => document.getElementById('newTableName')?.focus(), 100);
}

async function submitAddTable() {
  const name     = document.getElementById('newTableName')?.value?.trim();
  const capacity = +document.getElementById('newTableCap')?.value || 4;
  if (!name) { toast('Enter a table name', 'error'); return; }

  const btn = document.querySelector('#modalContent .btn-primary');
  if (btn) { btn.textContent = 'Adding...'; btn.disabled = true; }

  const res = await api('sessions', 'add_table', { name, capacity });
  if (!res.ok) {
    toast(res.error || 'Failed to add table', 'error');
    if (btn) { btn.textContent = 'Add Table'; btn.disabled = false; }
    return;
  }
  toast(`${name} added!`);
  closeModal();
  loadTables();
}

// ── DELETE TABLE ──────────────────────────────────
async function deleteTable(id, name) {
  confirm2(`Remove "${name}"?\n\nThis table will be hidden. Active sessions won't be affected.`, async () => {
    const res = await api('sessions', 'delete_table', { id });
    if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
    toast(`"${name}" removed`, 'warning');
    loadTables();
  });
}

// ── RENDER SESSIONS TABLE ─────────────────────────
function renderSessionsTable(sessions) {
  const tbody = document.getElementById('sessionsTableBody');
  if (!tbody) return;
  if (!sessions.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)">No sessions yet</td></tr>`;
    return;
  }
  tbody.innerHTML = sessions.map(s => `
    <tr>
      <td class="mono">#${s.id}</td>
      <td><strong>${esc(s.tableName)}</strong></td>
      <td>${s.itemCount}</td>
      <td><strong style="color:var(--green)">${fmtRWF(s.totalAmount ?? s.total ?? 0)}</strong></td>
      <td style="font-size:11px">${esc(s.openedBy||'—')}</td>
      <td style="font-size:11px">${esc(s.closedBy||'—')}</td>
      <td><span class="badge ${s.status==='open'?'badge-green':'badge-blue'}">${s.status==='open'?'Open':'Closed'}</span></td>
      <td style="font-size:11px;color:var(--muted)">${s.openedAt?new Date(s.openedAt).toLocaleString('en-RW',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—'}</td>
    </tr>
  `).join('');
}
