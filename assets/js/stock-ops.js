/* ═══════════════════════════════════════════════════
   BARMS PRO — stock-ops.js
   • Stock Count page (api/stockcount.php)
   • Cash Book page (api/cashbook.php, Owner only)
   Depends on: utils.js, api.js, auth.js
═══════════════════════════════════════════════════ */

// ── STOCK COUNT ───────────────────────────────────
const SC_AREAS = [['bar_item', 'Drinks'], ['bar_ingredient', 'Bar ingredients'], ['kitchen_ingredient', 'Kitchen ingredients']];
let _scArea = null, _scRows = [];

function loadStockCount() {
  const areas = session.role === 'Kitchen' ? SC_AREAS.filter(a => a[0] === 'kitchen_ingredient') : SC_AREAS;
  if (!_scArea || !areas.some(a => a[0] === _scArea)) _scArea = areas[0][0];
  document.getElementById('scAreas').innerHTML = areas.map(([k, l]) => `<button class="ar-chip ${_scArea === k ? 'active' : ''}" onclick="_scArea='${k}';loadStockCount()">${l}</button>`).join('');
  const d = document.getElementById('scDate'); if (!d.value) d.value = today();
  document.getElementById('scApplyBtn').style.display = can('canEditStock') ? '' : 'none';
  loadStockCountSheet();
  loadStockCountHistory();
  loadStockCountStatus();
}

async function loadStockCountStatus() {
  const el = document.getElementById('scStatus');
  const res = await apiGet('stockcount', 'status');
  if (!res.ok || !el) return;
  const tone = { ok: 'var(--green)', due: 'var(--orange)', overdue: 'var(--red)', never: 'var(--red)' };
  el.innerHTML = res.data.map(s => `<div class="ar-kpi static" style="flex:1 1 220px;border-left:4px solid ${tone[s.status]}">
      <div class="ar-kpi-label">${esc(s.label)} · every ${s.every} day${s.every > 1 ? 's' : ''}</div>
      <div class="ar-kpi-value" style="font-size:15px;color:${tone[s.status]}">${
        s.status === 'never' ? 'Never counted — due now' : s.status === 'overdue' ? `Overdue by ${s.daysSince - s.every} day(s)` : s.status === 'due' ? 'Due today' : `Next count in ${s.daysLeft} day(s)`}</div>
      <div class="ar-kpi-sub">${s.lastCount ? `Last count ${esc(s.lastCount)} · due ${esc(s.dueOn)}` : 'No count recorded yet'}</div>
    </div>`).join('');
}

// Reminder after login when a count is overdue (Owner, managers, kitchen)
async function remindStockCount() {
  if (!['Owner', 'Manager', 'Kitchen'].includes(session.role)) return;
  const res = await apiGet('stockcount', 'status');
  if (!res.ok) return;
  const late = res.data.filter(s => ['overdue', 'never', 'due'].includes(s.status));
  if (!late.length) return;
  const msg = `Stock count due: ${late.map(s => s.label + (s.status === 'overdue' ? ` (${s.daysSince - s.every} day(s) late)` : s.status === 'never' ? ' (never counted)' : ' (today)')).join(', ')}. Open Stock Count.`;
  if (typeof showPopupNotif === 'function') showPopupNotif(msg, 'warning', ''); else toast(msg, 'warning');
}

async function loadStockCountSheet() {
  const body = document.getElementById('scBody');
  body.innerHTML = `<tr><td colspan="5" class="ar-empty"><div class="ui-loader"><span class="ul-mark"><i></i><i></i><i></i></span><span class="ul-text">Loading…</span></div></td></tr>`;
  const res = await apiGet('stockcount', 'sheet', { area: _scArea });
  if (!res.ok) { body.innerHTML = `<tr><td colspan="5" class="ar-empty">${esc(res.error || 'Could not load')}</td></tr>`; return; }
  _scRows = res.data;
  body.innerHTML = _scRows.map((r, i) => `<tr>
      <td><strong>${esc(r.name)}</strong> <span class="muted">${esc(r.unit)}</span></td>
      <td class="num">${(+r.expected).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
      <td class="num"><input type="number" class="form-input" style="width:100px;padding:5px 8px;text-align:right" min="0" step="any" id="scIn${i}" oninput="scUpdate()"/></td>
      <td class="num" id="scDiff${i}">—</td><td class="num" id="scVal${i}">—</td></tr>`).join('')
    || `<tr><td colspan="5" class="ar-empty">Nothing to count here</td></tr>`;
  scUpdate();
}

function scUpdate() {
  let total = 0;
  _scRows.forEach((r, i) => {
    const v = document.getElementById('scIn' + i)?.value;
    const dEl = document.getElementById('scDiff' + i), vEl = document.getElementById('scVal' + i);
    if (v === '' || v === undefined) { dEl.textContent = '—'; vEl.textContent = '—'; return; }
    const diff = Math.round((+v - r.expected) * 1000) / 1000;
    const val = Math.round(diff * r.unit_cost);
    total += val;
    const col = diff < 0 ? 'var(--red)' : diff > 0 ? 'var(--orange)' : 'var(--green)';
    dEl.innerHTML = `<span style="color:${col};font-weight:800">${diff > 0 ? '+' : ''}${diff.toLocaleString()}</span>`;
    vEl.innerHTML = `<span style="color:${col}">${fmtRWF(val)}</span>`;
  });
  document.getElementById('scTotal').textContent = fmtRWF(total);
}

async function saveStockCount(apply) {
  const lines = _scRows.map((r, i) => ({ id: r.id, counted: document.getElementById('scIn' + i)?.value })).filter(l => l.counted !== '' && l.counted !== undefined);
  if (!lines.length) { toast('Enter at least one counted quantity', 'error'); return; }
  const go = async () => {
    const res = await api('stockcount', 'save', { area: _scArea, date: document.getElementById('scDate').value, note: document.getElementById('scNote').value.trim(), lines, apply });
    if (!res.ok) { toast(res.error || 'Could not save', 'error'); return; }
    toast(apply ? `Count saved and stock adjusted (${res.items} items)` : `Count saved (${res.items} items)`);
    document.getElementById('scNote').value = '';
    loadStockCountSheet(); loadStockCountHistory();
  };
  if (apply) confirm2(`Set stock to the counted quantities for ${lines.length} item(s)? Each difference is recorded as an adjustment.`, go);
  else go();
}

async function loadStockCountHistory() {
  const res = await apiGet('stockcount', 'list');
  const label = Object.fromEntries(SC_AREAS);
  document.getElementById('scHistory').innerHTML = (res.data || []).map(c => `<tr>
      <td>${esc(c.count_date)}</td><td>${label[c.area] || esc(c.area)}</td><td>${esc(c.counted_by)}</td>
      <td class="num">${+c.items}</td><td class="num">${+c.differing || 0}</td>
      <td class="num" style="color:${+c.variance_value < 0 ? 'var(--red)' : 'inherit'}">${fmtRWF(Math.round(+c.variance_value))}</td>
      <td>${+c.applied ? 'Yes' : 'No'}</td><td class="muted">${esc(c.note || '')}</td></tr>`).join('')
    || `<tr><td colspan="8" class="ar-empty">No counts yet</td></tr>`;
}

// ── CASH BOOK ─────────────────────────────────────
const CB_TYPES = { owner_withdrawal: 'Owner withdrawal', capital: 'Capital put in', loan_in: 'Loan received', loan_repayment: 'Loan repayment', transfer: 'Transfer between accounts', other_in: 'Other money in', other_out: 'Other money out', opening_balance: 'Starting balance' };
const CB_SYSTEM = { asset_purchase: 'Equipment bought' };
const CB_IN = ['capital', 'loan_in', 'other_in'];

async function loadCashbook() {
  const body = document.getElementById('cbBody');
  const res = await apiGet('cashbook', 'list', { from: today().slice(0, 8) + '01', to: today() });
  if (!res.ok) { body.innerHTML = `<tr><td colspan="7" class="ar-empty">${esc(res.error || 'Could not load')}</td></tr>`; return; }
  const rows = res.data;
  const live = rows.filter(r => !+r.voided);
  const sum = types => live.filter(r => types.includes(r.type)).reduce((a, r) => a + +r.amount, 0);
  document.getElementById('cbKpis').innerHTML = [
    ['Owner withdrawals', sum(['owner_withdrawal'])], ['Capital & loans in', sum(['capital', 'loan_in'])],
    ['Loan repayments', sum(['loan_repayment'])], ['Transfers', sum(['transfer'])],
  ].map(([l, v]) => `<div class="ar-kpi static"><div class="ar-kpi-label">${l} (this month)</div><div class="ar-kpi-value">${fmtRWF(Math.round(v))}</div></div>`).join('');
  body.innerHTML = rows.map(r => `<tr style="${+r.voided ? 'opacity:.5;text-decoration:line-through' : ''}">
      <td>${esc(r.movement_date)}</td><td>${CB_TYPES[r.type] || CB_SYSTEM[r.type] || esc(r.type)}</td>
      <td class="num" style="font-weight:800;color:${['transfer', 'opening_balance'].includes(r.type) ? 'inherit' : CB_IN.includes(r.type) ? 'var(--green)' : 'var(--red)'}">${['transfer', 'opening_balance'].includes(r.type) ? '' : CB_IN.includes(r.type) ? '+ ' : '− '}${fmtRWF(Math.round(+r.amount))}</td>
      <td>${esc(r.method)}${r.to_method ? ' → ' + esc(r.to_method) : ''}</td><td>${esc(r.note || '')}</td><td class="muted">${esc(r.recorded_by)}</td>
      <td>${+r.voided ? 'Voided' : r.type === 'asset_purchase' ? '<span class="muted">see Equipment</span>' : `<button class="btn btn-ghost btn-sm" onclick="voidCashbook(${+r.id})">Void</button>`}</td></tr>`).join('')
    || `<tr><td colspan="7" class="ar-empty">Nothing recorded this month</td></tr>`;
}

function showCashbookAdd() {
  const methods = ['Cash', 'MoMo', 'Bank', 'Card'].map(m => `<option>${m}</option>`).join('');
  document.getElementById('modalContent').innerHTML = `
    <h3>Record money movement</h3>
    <div class="form-group"><label class="form-label">What is it? *</label>
      <select class="form-input" id="cbType" onchange="document.getElementById('cbToWrap').style.display=this.value==='transfer'?'':'none';document.getElementById('cbStartHelp').style.display=this.value==='opening_balance'?'':'none'">
        ${Object.entries(CB_TYPES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
      </select></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Amount (RWF) *</label><input type="number" class="form-input" id="cbAmount" min="1"/></div>
      <div class="form-group"><label class="form-label">Account *</label><select class="form-input" id="cbMethod">${methods}</select></div>
    </div>
    <div class="form-group" id="cbToWrap" style="display:none"><label class="form-label">Moved to *</label><select class="form-input" id="cbTo">${['MoMo', 'Bank', 'Cash', 'Card'].map(m => `<option>${m}</option>`).join('')}</select></div>
    <div style="display:grid;grid-template-columns:1fr 2fr;gap:10px">
      <div class="form-group"><label class="form-label">Date *</label><input type="date" class="form-input" id="cbDate" value="${today()}"/></div>
      <div class="form-group"><label class="form-label">Note (who, why) *</label><input class="form-input" id="cbNote"/></div>
    </div>
    <div class="ar-note" id="cbStartHelp" style="display:none;margin-bottom:10px">Record once per account: the money that was already in it on the day you started using BarMS (use that date). It counts in Business worth, not as income.</div>
    <div class="ar-note" style="margin-bottom:10px">Cash taken from or put into the drawer during your open shift is included in that shift's expected cash.</div>
    <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="submitCashbook()">Save</button>`;
  document.getElementById('modalOverlay').classList.add('show');
}
async function submitCashbook() {
  const res = await api('cashbook', 'add', {
    type: document.getElementById('cbType').value, amount: +document.getElementById('cbAmount').value,
    method: document.getElementById('cbMethod').value, toMethod: document.getElementById('cbTo').value,
    date: document.getElementById('cbDate').value, note: document.getElementById('cbNote').value.trim(),
  });
  if (!res.ok) { toast(res.error || 'Could not save', 'error'); return; }
  closeModal(); toast('Saved '); loadCashbook();
}
function voidCashbook(id) {
  document.getElementById('modalContent').innerHTML = `
    <h3>Void this entry?</h3>
    <div class="form-group"><label class="form-label">Reason *</label><input class="form-input" id="cbVoidReason"/></div>
    <button class="btn btn-primary" onclick="confirmVoidCashbook(${+id})">Void</button>`;
  document.getElementById('modalOverlay').classList.add('show');
}
async function confirmVoidCashbook(id) {
  const reason = document.getElementById('cbVoidReason').value.trim();
  if (!reason) { toast('A reason is required', 'error'); return; }
  const res = await api('cashbook', 'void', { id, reason });
  if (!res.ok) { toast(res.error || 'Could not void', 'error'); return; }
  closeModal(); toast('Voided', 'warning'); loadCashbook();
}

// ── ASSETS & WORTH page (things the business owns) ──
let _assetCats = ['Equipment', 'Furniture', 'Electronics', 'Vehicle', 'Building / renovation', 'Other'];
let _assets = [];
async function loadAssets() {
  const body = document.getElementById('assetBody');
  if (!body) return;
  const res = await apiGet('cashbook', 'assets_list');
  if (!res.ok) { body.innerHTML = `<tr><td colspan="7" class="ar-empty">${esc(res.error || 'Could not load')}</td></tr>`; return; }
  _assets = res.data; if (res.categories) _assetCats = res.categories;
  const live = _assets.filter(a => !a.disposed_date);
  body.innerHTML = _assets.map(a => `<tr style="${a.disposed_date ? 'opacity:.55' : ''}">
      <td><strong>${esc(a.name)}</strong>${a.disposed_date ? `<div class="muted" style="font-size:11px">Removed ${esc(a.disposed_date)} — ${esc(a.disposed_reason || '')}</div>` : ''}</td>
      <td>${esc(a.category)}</td><td class="num" style="font-weight:800">${fmtRWF(Math.round(+a.value))}</td><td>${esc(a.acquired_date)}</td>
      <td>${a.funded_by === 'owner' ? 'Owner (capital)' : 'Business' + (a.method ? ' · ' + esc(a.method) : '')}</td><td class="muted">${esc(a.note || '')}</td>
      <td style="white-space:nowrap">${a.disposed_date ? '' : `<button class="btn btn-ghost btn-sm" onclick="showAssetEdit(${+a.id})">Edit</button> <button class="btn btn-ghost btn-sm" onclick="showAssetRemove(${+a.id})">Remove</button>`}</td></tr>`).join('')
    + (live.length ? `<tr><td colspan="2"><strong>Total owned now</strong></td><td class="num" style="font-weight:800">${fmtRWF(Math.round(live.reduce((s, a) => s + +a.value, 0)))}</td><td colspan="4"></td></tr>` : '')
    || `<tr><td colspan="7" class="ar-empty">No assets recorded yet — press “+ Add asset”</td></tr>`;
}
function showAssetAdd() {
  const methods = ['Cash', 'MoMo', 'Bank', 'Card'].map(m => `<option>${m}</option>`).join('');
  document.getElementById('modalContent').innerHTML = `
    <h3>Add an asset</h3>
    <div class="form-group"><label class="form-label">What is it? *</label><input class="form-input" id="asName" placeholder="Fridge — Samsung 400 L"/></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Type</label><select class="form-input" id="asCat">${_assetCats.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Worth (RWF) *</label><input type="number" class="form-input" id="asValue" min="1"/></div>
    </div>
    <div class="form-group"><label class="form-label">Who paid for it? *</label>
      <select class="form-input" id="asFunded" onchange="document.getElementById('asMethodWrap').style.display=this.value==='business'?'':'none'">
        <option value="business">The business paid (money leaves an account)</option>
        <option value="owner">The owner brought it in (counts as capital)</option>
      </select></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group" id="asMethodWrap"><label class="form-label">Paid from *</label><select class="form-input" id="asMethod">${methods}</select></div>
      <div class="form-group"><label class="form-label">Date *</label><input type="date" class="form-input" id="asDate" value="${today()}"/></div>
    </div>
    <div class="form-group"><label class="form-label">Note</label><input class="form-input" id="asNote" placeholder="supplier, serial number…"/></div>
    <div class="ar-note" style="margin-bottom:10px">Buying equipment is not an expense: the money becomes something the business owns, so its worth does not drop.</div>
    <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="submitAsset()">Save</button>`;
  document.getElementById('modalOverlay').classList.add('show');
}
async function submitAsset() {
  const res = await api('cashbook', 'asset_add', {
    name: document.getElementById('asName').value.trim(), category: document.getElementById('asCat').value, value: +document.getElementById('asValue').value,
    fundedBy: document.getElementById('asFunded').value, method: document.getElementById('asMethod').value,
    date: document.getElementById('asDate').value, note: document.getElementById('asNote').value.trim(),
  });
  if (!res.ok) { toast(res.error || 'Could not save', 'error'); return; }
  closeModal(); toast('Asset saved'); assetsRefresh();
}
function showAssetEdit(id) {
  const a = _assets.find(x => +x.id === id); if (!a) return;
  document.getElementById('modalContent').innerHTML = `
    <h3>Edit asset</h3>
    <div class="form-group"><label class="form-label">Name *</label><input class="form-input" id="asName" value="${esc(a.name)}"/></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Type</label><select class="form-input" id="asCat">${_assetCats.map(c => `<option ${c === a.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Worth now (RWF) *</label><input type="number" class="form-input" id="asValue" value="${+a.value}"/></div>
    </div>
    <div class="form-group"><label class="form-label">Note</label><input class="form-input" id="asNote" value="${esc(a.note || '')}"/></div>
    <div class="ar-note" style="margin-bottom:10px">Lower the worth as the item ages. Entered by mistake? <button class="ar-link" onclick="showAssetVoid(${+a.id})">Void it</button> — the money goes back to the account that paid.</div>
    <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="submitAssetEdit(${+a.id})">Save</button>`;
  document.getElementById('modalOverlay').classList.add('show');
}
async function submitAssetEdit(id) {
  const res = await api('cashbook', 'asset_update', { id, name: document.getElementById('asName').value.trim(), category: document.getElementById('asCat').value, value: +document.getElementById('asValue').value, note: document.getElementById('asNote').value.trim() });
  if (!res.ok) { toast(res.error || 'Could not save', 'error'); return; }
  closeModal(); toast('Saved'); assetsRefresh();
}
function showAssetRemove(id) {
  const a = _assets.find(x => +x.id === id); if (!a) return;
  document.getElementById('modalContent').innerHTML = `
    <h3>Remove ${esc(a.name)}?</h3>
    <div class="ar-note" style="margin-bottom:10px">Sold, broken or thrown away. It stops counting in Business worth from this date. If it was sold, record the money as "Other money in".</div>
    <div style="display:grid;grid-template-columns:1fr 2fr;gap:10px">
      <div class="form-group"><label class="form-label">Date *</label><input type="date" class="form-input" id="asDisDate" value="${today()}"/></div>
      <div class="form-group"><label class="form-label">Reason *</label><input class="form-input" id="asDisReason" placeholder="broken, sold to…"/></div>
    </div>
    <button class="btn btn-primary" onclick="submitAssetRemove(${+a.id})">Remove</button>`;
  document.getElementById('modalOverlay').classList.add('show');
}
async function submitAssetRemove(id) {
  const res = await api('cashbook', 'asset_dispose', { id, date: document.getElementById('asDisDate').value, reason: document.getElementById('asDisReason').value.trim() });
  if (!res.ok) { toast(res.error || 'Could not remove', 'error'); return; }
  closeModal(); toast('Removed', 'warning'); assetsRefresh();
}
function showAssetVoid(id) {
  document.getElementById('modalContent').innerHTML = `
    <h3>Void this equipment entry?</h3>
    <div class="ar-note" style="margin-bottom:10px">Only for a mistake. The entry is deleted and the money it took goes back to the account.</div>
    <div class="form-group"><label class="form-label">Reason *</label><input class="form-input" id="asVoidReason"/></div>
    <button class="btn btn-primary" onclick="submitAssetVoid(${+id})">Void</button>`;
}
async function submitAssetVoid(id) {
  const res = await api('cashbook', 'asset_void', { id, reason: document.getElementById('asVoidReason').value.trim() });
  if (!res.ok) { toast(res.error || 'Could not void', 'error'); return; }
  closeModal(); toast('Voided', 'warning'); assetsRefresh();
}
// open Advanced Reports on the Business worth tab
function arOpenWorth() { if (typeof AR !== 'undefined') AR.tab = 'worth'; showPage('advanced-reports'); }
// Assets & Worth page: today's worth on top, the asset list below
async function loadAssetsPage() {
  const box = document.getElementById('assetsWorth');
  if (box) box.innerHTML = uiLoader('Working out what the business is worth');
  loadAssets();
  if (!box) return;
  const res = await apiGet('reports', 'worth', { preset: 'today' });
  if (!res.ok) { box.innerHTML = `<div class="ar-note warn">${esc(res.error || 'Could not work out the worth')}</div>`; return; }
  const e = res.data.end;
  const lines = arWorthLines(e);
  box.innerHTML = `${arTiles([
      { l: 'Business worth today', v: arM(e.worth), s: 'what it owns − what it owes', icon: '', hero: true },
      { l: 'It owns', v: arM(e.owns), s: `${arM(e.money)} money · ${arM(e.stock.value)} stock · ${arM(e.equipmentValue)} assets`, icon: '' },
      { l: 'It owes', v: arM(e.owes), s: `${arM(e.supplierDebt)} suppliers · ${arM(e.loans)} loans`, icon: '', tone: e.owes ? 'warn' : 'good' },
      { l: 'Assets recorded', v: arM(e.equipmentValue), s: `${e.equipment.length} item${e.equipment.length === 1 ? '' : 's'}`, icon: '' },
    ])}
    ${!e.hasStartingBalances ? `<div class="ar-note warn" style="margin-bottom:12px">No starting balance is recorded, so money that was in the till, MoMo or bank before BarMS is not counted. <button class="ar-link" onclick="showPage('cashbook');setTimeout(showCashbookAdd,300)">Add a starting balance</button></div>` : ''}
    <div class="ar-section">
      <div class="ar-section-title"><span>Everything it owns and owes<div class="ar-section-sub">Today, ${esc(e.asOf)}. Stock at what it cost; it could sell for ${arM(e.stock.sellValue)}.</div></span></div>
      <div class="ar-table-wrap"><table class="ar-table"><thead><tr><th></th><th>Item</th><th class="num">Value</th></tr></thead><tbody>
        ${lines.map(r => `<tr><td class="muted">${esc(r.group)}</td><td>${esc(r.item)}${r.note ? `<div class="muted" style="font-size:11px">${esc(r.note)}</div>` : ''}</td><td class="num ${r.value < 0 ? 'ar-bad' : ''}" style="font-weight:700">${arM(r.value)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td></td><td><strong>Business worth</strong></td><td class="num"><strong>${arM(e.worth)}</strong></td></tr></tfoot></table></div>
    </div>`;
}
function assetsRefresh() {
  if (document.getElementById('page-assets')?.classList.contains('active')) loadAssetsPage(); else loadAssets();
}