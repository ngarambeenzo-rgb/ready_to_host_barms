/* ═══════════════════════════════════════════════════
   order-creation.js — Page 1: Order Creation
   Flow: Select Type → Select Table (Dine-In) → Create Order
═══════════════════════════════════════════════════ */

let _ocType      = null; // 'dinein' | 'takeaway'
let _ocTableId   = null;
let _ocTableName = null;
let _ocTables    = [];

// ── INIT: called when page loads ──────────────────
async function loadOrderCreation() {
  _ocType = null; _ocTableId = null; _ocTableName = null;
  _showOCStep(1);
  // Pre-load tables in background
  const res = await apiGet('sessions', 'list_tables');
  if (res.ok) _ocTables = res.data || [];
}

// ── STEP 1: Select Type ───────────────────────────
function ocSelectType(type) {
  _ocType = type;
  document.querySelectorAll('#ocBtn-dinein,#ocBtn-takeaway').forEach(b => b.classList.remove('selected'));
  document.getElementById(`ocBtn-${type}`)?.classList.add('selected');
  setTimeout(() => {
    if (type === 'dinein') {
      _showOCStep(2);
      renderOCTables();
    } else {
      _ocTableId   = null;
      _ocTableName = null;
      _showOCStep3Takeaway();
    }
  }, 150);
}

// ── STEP 2: Select Table ──────────────────────────
async function renderOCTables() {
  const res = await apiGet('sessions', 'list_tables');
  if (res.ok) _ocTables = res.data || [];
  const grid = document.getElementById('ocTableGrid');
  if (!grid) return;
  if (!_ocTables.length) {
    grid.innerHTML = uiEmpty('table', 'No tables yet', 'Add your first table to start dine-in orders.');
    return;
  }
  grid.innerHTML = _ocTables.map(t => {
    const occupied = t.status === 'occupied' || t.status === 'cleaning';
    const state = t.status === 'occupied' ? 'occupied' : t.status === 'cleaning' ? 'cleaning' : 'free';
    const statusLabel = { occupied: 'Occupied', cleaning: 'Cleaning', free: 'Free' }[state];
    // If occupied and has an open order, allow clicking to open that order
    const hasOpenOrder = occupied && t.orderId;
    const clickAction = hasOpenOrder
      ? `ocOpenExistingOrder(${t.orderId})`
      : occupied
        ? `toast('Table is occupied','warning')`
        : `ocSelectTable(${t.id},'${esc(t.name)}',this)`;
    return `<button class="oc-table ${state}${hasOpenOrder ? ' has-order' : ''}" onclick="${clickAction}">
      <span class="oc-table-top"><span class="oc-table-name">${esc(t.name)}</span><span class="status ${state === 'free' ? 'ok' : state === 'occupied' ? 'bad' : 'warn'}">${statusLabel}</span></span>
      <span class="oc-table-seats">${t.capacity} seats</span>
      ${hasOpenOrder
        ? `<span class="oc-table-order"><span>${esc(t.orderNumber || '')} · ${t.orderItemCount} item${t.orderItemCount !== 1 ? 's' : ''}</span><b>${fmtRWF(t.orderTotal || 0)}</b></span><span class="oc-table-cta">Open order</span>`
        : state === 'free' ? '<span class="oc-table-cta">Start order</span>' : ''}
    </button>`;
  }).join('');
}

function ocSelectTable(id, name, el) {
  _ocTableId   = id;
  _ocTableName = name;
  document.querySelectorAll('.oc-table-card').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.oc-table-card').forEach(c => c.classList.remove('selected'));
  if (el) el.classList.add('selected');
  setTimeout(() => _showOCStep3DineIn(), 150);
}

// ── STEP 3: Confirm ───────────────────────────────
function _showOCStep3DineIn() {
  document.getElementById('ocConfirmIcon').innerHTML    = ic('armchair');
  document.getElementById('ocConfirmTitle').textContent = `New dine-in order`;
  document.getElementById('ocConfirmSub').textContent   = `Table: ${_ocTableName}`;
  document.getElementById('ocSummaryType').textContent  = 'Dine-In';
  document.getElementById('ocSummaryTable').textContent = _ocTableName;
  document.getElementById('ocSummaryTableRow').style.display = 'flex';
  document.getElementById('ocStep3Back').onclick = () => ocBackToStep(2);
  _showOCStep(3);
}

function _showOCStep3Takeaway() {
  document.getElementById('ocConfirmIcon').innerHTML    = ic('bag');
  document.getElementById('ocConfirmTitle').textContent = `New takeaway order`;
  document.getElementById('ocConfirmSub').textContent   = `A sequence number will be assigned`;
  document.getElementById('ocSummaryType').textContent  = 'Takeaway';
  document.getElementById('ocSummaryTableRow').style.display = 'none';
  document.getElementById('ocStep3Back').onclick = () => ocBackToStep(1);
  _showOCStep(3);
}

// ── CREATE ORDER ──────────────────────────────────
async function ocCreateOrder() {
  const btn = document.getElementById('ocCreateBtn');
  if (btn.disabled) return;
  uiBusy(btn, true);
  btn.disabled = true;

  let res;
  if (_ocType === 'dinein') {
    res = await api('orders', 'create', { type: 'dinein', tableId: _ocTableId, tableName: _ocTableName });
  } else {
    res = await api('orders', 'create', { type: 'takeaway' });
  }

  uiBusy(btn, false);
  btn.disabled = false;

  if (!res.ok) { toast(res.error || 'Failed to create order', 'error'); return; }

  toast(`Order ${res.orderNumber} created`);
  // Navigate to Order Management with this order
  loadOrderManagement(res.orderId, true); // true = came from creation
}

// ── NAVIGATE BACK ─────────────────────────────────
function ocBack() { _showOCStep(1); _ocType = null; }
function ocBackToStep(n) { _showOCStep(n); if (n === 1) _ocType = null; }

// ── SHOW STEP ─────────────────────────────────────
function _showOCStep(n) {
  ['ocStep1','ocStep2','ocStep3'].forEach((id,i) => {
    const el = document.getElementById(id);
    if (el) el.style.display = (i + 1 === n) ? '' : 'none';
  });
  _ocStep = n;
  document.querySelectorAll('#ocSteps li').forEach(li => {
    const k = +li.dataset.step;
    li.classList.toggle('on', k === n);
    li.classList.toggle('done', k < n);
    li.style.display = (k === 2 && _ocType === 'takeaway') ? 'none' : '';
  });
  if (n === 3) setTimeout(() => document.getElementById('ocCreateBtn')?.focus(), 50);
}
let _ocStep = 1;

// Keyboard: 1 / 2 pick the type, Enter creates, Escape goes back
document.addEventListener('keydown', e => {
  if (!document.getElementById('page-order-creation')?.classList.contains('active')) return;
  if (document.getElementById('modalOverlay')?.classList.contains('show')) return;
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '')) return;
  if (_ocStep === 1 && (e.key === '1' || e.key === '2')) { e.preventDefault(); ocSelectType(e.key === '1' ? 'dinein' : 'takeaway'); }
  else if (_ocStep === 3 && e.key === 'Enter' && e.target.id !== 'ocStep3Back') { e.preventDefault(); ocCreateOrder(); }
  else if (e.key === 'Escape' && _ocStep > 1) { e.preventDefault(); _ocStep === 3 && _ocType === 'dinein' ? ocBackToStep(2) : ocBack(); }
});

// ── ADD TABLE MODAL ───────────────────────────────
function showOCAddTableModal() {
  document.getElementById('modalContent').innerHTML = `
    <h3 style="margin-bottom:18px">Add New Table</h3>
    <div class="form-group">
      <label class="form-label">Table Name *</label>
      <input class="form-input" id="ocNewTableName" placeholder="e.g. T01, VIP, Outside…" autofocus/>
    </div>
    <div class="form-group">
      <label class="form-label">Seating Capacity</label>
      <input type="number" class="form-input" id="ocNewTableCap" value="4" min="1" max="50"/>
    </div>
    <div style="display:flex;gap:10px;margin-top:6px">
      <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="ocSubmitAddTable()">Add Table</button>
      <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="closeModal()">Cancel</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('show');
  setTimeout(() => document.getElementById('ocNewTableName')?.focus(), 100);
}

async function ocSubmitAddTable() {
  const name     = document.getElementById('ocNewTableName')?.value?.trim();
  const capacity = +document.getElementById('ocNewTableCap')?.value || 4;
  if (!name) { toast('Enter a table name', 'error'); return; }
  const res = await api('sessions', 'add_table', { name, capacity });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast(`${name} added!`);
  closeModal();
  renderOCTables();
}

// ── OPEN EXISTING ORDER (from occupied table) ─────
function ocOpenExistingOrder(orderId) {
  if (!orderId) { toast('No open order found for this table', 'error'); return; }
  loadOrderManagement(orderId);
}
