/* ═══════════════════════════════════════════════════
   BARMS PRO — pos.js
   Tables & Orders Dashboard (Page 1)
   Takeaway Orders
═══════════════════════════════════════════════════ */

let _posTables      = [];
let _posTakeaways   = [];
let _posTab         = 'dinein';
let _activePosSession = null; // {type:'table'|'takeaway', id, tableId, tableName, items[], total, note}

// ── LOAD POS ──────────────────────────────────────
async function loadPOS() {
  // Load tables
  const res = await apiGet('sessions', 'list_tables');
  if (res.ok) {
    _posTables = res.data || [];
    renderDineInGrid();
  }
  // Load takeaway orders
  const tkRes = await apiGet('sessions', 'list_takeaways');
  if (tkRes.ok) {
    _posTakeaways = tkRes.data || [];
    renderTakeawayList();
  }
  // Update subtitle
  const occupied = _posTables.filter(t => t.status === 'occupied').length;
  const sub = document.getElementById('posSubtitle');
  if (sub) sub.textContent = `${_posTables.length} tables · ${occupied} occupied · ${_posTakeaways.length} takeaway orders`;
}

// ── SWITCH TAB ─────────────────────────────────────
function switchPOSTab(tab, el) {
  _posTab = tab;
  document.querySelectorAll('#page-pos .tab').forEach(t => {
    t.style.color = 'var(--muted)';
    t.style.borderBottomColor = 'transparent';
  });
  if (el) { el.style.color = 'var(--blue)'; el.style.borderBottomColor = 'var(--blue)'; }
  document.getElementById('posDineInGrid').style.display  = tab === 'dinein'   ? 'grid' : 'none';
  document.getElementById('posTakeawayList').style.display = tab === 'takeaway' ? 'block' : 'none';
}

// ── RENDER DINE-IN GRID ────────────────────────────
function renderDineInGrid() {
  const grid = document.getElementById('posDineInGrid');
  if (!grid) return;
  if (!_posTables.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted)">No tables yet — click "+ Add Table" to add one</div>`;
    return;
  }
  grid.innerHTML = _posTables.map(t => {
    const isOccupied = t.status === 'occupied';
    const isCleaning = t.status === 'cleaning';
    const mins = t.openedAt ? Math.floor((Date.now() - new Date(t.openedAt)) / 60000) : 0;
    const timeStr = isOccupied ? (mins < 60 ? `${mins}min` : `${Math.floor(mins/60)}h${mins%60}m`) : '';
    const statusClass = isOccupied ? 'occupied' : isCleaning ? 'cleaning' : '';
    const dotClass = isOccupied ? 'occupied' : isCleaning ? 'cleaning' : 'free';
    const statusLabel = isOccupied ? 'Occupied' : isCleaning ? 'Cleaning' : 'Free';
    const statusColor = isOccupied ? 'var(--green)' : isCleaning ? 'var(--orange)' : 'var(--muted)';

    return `<div class="pos-table-card ${statusClass}" onclick="handlePOSTableClick(${t.id})">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:6px">
          <div class="pos-dot ${dotClass}"></div>
          <span style="font-size:11px;font-weight:700;color:${statusColor}">${statusLabel}</span>
        </div>
        ${timeStr ? `<span style="font-size:10px;color:var(--muted);background:var(--bg);padding:2px 7px;border-radius:6px">${timeStr}</span>` : ''}
      </div>
      <div style="font-size:20px;font-weight:900;color:var(--text);margin-bottom:2px">${esc(t.name)}</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px">${t.capacity} seats</div>
      ${isOccupied ? `
        <div style="background:rgba(14,168,117,.1);border-radius:8px;padding:8px;margin-bottom:8px">
          <div style="font-size:13px;font-weight:800;color:var(--green)">${fmtRWF(t.sessionTotal||0)}</div>
          <div style="font-size:10px;color:var(--muted)">${t.itemCount||0} items · ${esc(t.openedBy||'')}</div>
        </div>
      ` : ''}
      ${isCleaning ? `
        <button onclick="event.stopPropagation();markTableAvailable(${t.id})" style="width:100%;padding:8px;background:var(--orange);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;margin-bottom:6px">Mark Available</button>
      ` : `
        <button style="width:100%;padding:8px;background:${isOccupied?'var(--green)':'var(--blue)'};color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;margin-bottom:6px">${isOccupied ? 'Open Order' : 'New Order'}</button>
      `}
      ${!isOccupied && !isCleaning ? `<button onclick="event.stopPropagation();deletePOSTable(${t.id},'${esc(t.name)}')" style="width:100%;padding:5px;background:transparent;border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:inherit;font-size:11px;color:var(--muted)">Remove</button>` : ''}
    </div>`;
  }).join('');
}

// ── RENDER TAKEAWAY LIST ───────────────────────────
function renderTakeawayList() {
  const list = document.getElementById('posTakeawayList');
  if (!list) return;
  if (!_posTakeaways.length) {
    list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">No takeaway orders — click "New Takeaway" to create one</div>`;
    return;
  }
  list.innerHTML = _posTakeaways.map(tk => {
    const isAwaiting = tk.status === 'awaiting_payment';
    const statusLabel = isAwaiting ? 'Awaiting Payment' : 'Open';
    const statusColor = isAwaiting ? 'var(--gold)' : 'var(--green)';
    return `<div class="pos-tk-card ${isAwaiting?'awaiting':''}" onclick="openTakeawayOrder('${tk.id}')">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-size:22px"></div>
        <div>
          <div style="font-size:14px;font-weight:800;color:var(--text)">${esc(tk.id)}</div>
          <div style="font-size:11px;color:var(--muted)">${tk.itemCount||0} items · ${esc(tk.openedBy||'')}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:15px;font-weight:800;color:var(--green)">${fmtRWF(tk.total||0)}</div>
        <div style="font-size:11px;font-weight:700;color:${statusColor}">${statusLabel}</div>
      </div>
    </div>`;
  }).join('');
}

// ── HANDLE TABLE CLICK ─────────────────────────────
async function handlePOSTableClick(tableId) {
  const table = _posTables.find(t => t.id === tableId);
  if (!table) return;
  if (table.status === 'cleaning') {
    toast('Table is being cleaned. Mark it Available first.', 'warning');
    return;
  }
  if (table.status === 'occupied' && table.sessionId) {
    // Load existing session and go to order page
    await loadOrderPage('table', table.sessionId, table);
  } else {
    // Open new session
    const res = await api('sessions', 'open_session', { tableId });
    if (!res.ok) { toast(res.error || 'Failed to open table', 'error'); return; }
    await loadOrderPage('table', res.sessionId, table);
  }
}

// ── MARK TABLE AVAILABLE ───────────────────────────
async function markTableAvailable(tableId) {
  const res = await api('sessions', 'mark_available', { tableId });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast('Table marked as Available ');
  loadPOS();
}

// ── START TAKEAWAY ─────────────────────────────────
async function startTakeaway() {
  const res = await api('sessions', 'open_takeaway', {});
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  await loadOrderPage('takeaway', res.sessionId, { name: res.takeawayId, id: null });
}

// ── OPEN TAKEAWAY ORDER ────────────────────────────
async function openTakeawayOrder(tkId) {
  const tk = _posTakeaways.find(t => t.id === tkId);
  if (!tk) return;
  await loadOrderPage('takeaway', tk.sessionId, { name: tk.id, id: null });
}

// ── DELETE TABLE ───────────────────────────────────
async function deletePOSTable(id, name) {
  if (!confirm(`Remove "${name}"?`)) return;
  const res = await api('sessions', 'delete_table', { id });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast(`"${name}" removed`);
  loadPOS();
}

// ── ADD TABLE MODAL ────────────────────────────────
function showAddTableModal() {
  document.getElementById('modalContent').innerHTML = `
    <h3 style="margin-bottom:18px">Add New Table</h3>
    <div class="form-group">
      <label class="form-label">Table Name *</label>
      <input class="form-input" id="newTableName" placeholder="e.g. T01, VIP Room, Outside…" autofocus/>
    </div>
    <div class="form-group">
      <label class="form-label">Seating Capacity</label>
      <input type="number" class="form-input" id="newTableCap" value="4" min="1" max="50"/>
    </div>
    <div style="display:flex;gap:10px;margin-top:6px">
      <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="submitAddPOSTable()">Add Table</button>
      <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="closeModal()">✕ Cancel</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('show');
  setTimeout(() => document.getElementById('newTableName')?.focus(), 100);
}

async function submitAddPOSTable() {
  const name     = document.getElementById('newTableName')?.value?.trim();
  const capacity = +document.getElementById('newTableCap')?.value || 4;
  if (!name) { toast('Enter a table name', 'error'); return; }
  const btn = document.querySelector('#modalContent .btn-primary');
  if (btn) { btn.textContent = 'Adding...'; btn.disabled = true; }
  const res = await api('sessions', 'add_table', { name, capacity });
  if (!res.ok) {
    toast(res.error || 'Failed', 'error');
    if (btn) { btn.textContent = 'Add Table'; btn.disabled = false; }
    return;
  }
  toast(`${name} added!`);
  closeModal();
  loadPOS();
}
