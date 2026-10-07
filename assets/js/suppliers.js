/* ═══════════════════════════════════════════════════
   BARMS PRO — suppliers.js
   • Payment fields shared by every "receive stock" form
   • Suppliers page: what each supplier is owed + payments
   Balances are calculated on the server (report_lib rpSupplierBalances).
   Depends on: utils.js, api.js, auth.js
═══════════════════════════════════════════════════ */

// ── shared payment fields for receiving stock ─────
function purchasePayFields(prefix) {
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Amount paid now (RWF)</label>
        <input type="number" class="form-input" id="${prefix}Paid" min="0" step="1" placeholder="Full amount" oninput="purchasePayHint('${prefix}')"/></div>
      <div class="form-group"><label class="form-label">Paid with</label>
        <select class="form-input" id="${prefix}PayMethod">
          <option value="Cash">Cash (from the drawer)</option><option value="MoMo">MoMo</option>
          <option value="Bank">Bank</option><option value="Card">Card</option>
        </select></div>
    </div>
    <div id="${prefix}PayHint" style="font-size:11px;color:var(--muted);margin:-6px 0 10px">Leave "Amount paid now" empty if you paid in full. Anything unpaid is recorded as owed to the supplier.</div>`;
}
const _purchaseTotals = {};
function purchasePayTotal(prefix, total) { _purchaseTotals[prefix] = total; purchasePayHint(prefix); }
function purchasePayHint(prefix) {
  const el = document.getElementById(prefix + 'PayHint');
  const inp = document.getElementById(prefix + 'Paid');
  if (!el || !inp) return;
  const total = _purchaseTotals[prefix] || 0;
  if (inp.value === '') { el.innerHTML = 'Leave "Amount paid now" empty if you paid in full. Anything unpaid is recorded as owed to the supplier.'; return; }
  const owed = total - (+inp.value || 0);
  el.innerHTML = owed > 0 ? `<span style="color:var(--orange)">RWF ${owed.toLocaleString()} will be recorded as owed to the supplier.</span>`
    : owed < 0 ? '<span style="color:var(--red)">Paid is more than the total.</span>' : '<span style="color:var(--green)">Paid in full.</span>';
}
/** Returns {amountPaid, paymentMethod} or null (and shows why) */
function readPurchasePay(prefix, total, supplier) {
  const raw = document.getElementById(prefix + 'Paid')?.value ?? '';
  const amountPaid = raw === '' ? total : +raw;
  const paymentMethod = document.getElementById(prefix + 'PayMethod')?.value || 'Cash';
  if (amountPaid < 0 || amountPaid > total + 0.001) { toast('Amount paid must be between 0 and the total', 'error'); return null; }
  if (amountPaid < total - 0.001 && !supplier) { toast('Enter the supplier — the unpaid part is owed to them', 'error'); return null; }
  return { amountPaid, paymentMethod };
}
// Suggest supplier names already used
async function loadSupplierNames() {
  if (!can('canEditStock')) return;
  let dl = document.getElementById('supplierNames');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'supplierNames'; document.body.appendChild(dl); }
  const res = await apiGet('suppliers', 'list');
  if (res.ok) dl.innerHTML = res.data.map(s => `<option value="${esc(s.supplier)}"></option>`).join('');
}

// ── Suppliers page ────────────────────────────────
async function loadSuppliers() {
  const body = document.getElementById('supBody');
  if (!body) return;
  body.innerHTML = `<tr><td colspan="8" class="ar-empty"><div class="ui-loader"><span class="ul-mark"><i></i><i></i><i></i></span><span class="ul-text">Loading…</span></div></td></tr>`;
  const res = await apiGet('suppliers', 'list');
  if (!res.ok) { body.innerHTML = `<tr><td colspan="8" class="ar-empty">${esc(res.error || 'Could not load')}</td></tr>`; return; }
  const rows = res.data;
  const owed = rows.reduce((a, r) => a + Math.max(0, r.balance), 0);
  document.getElementById('supTotalOwed').textContent = fmtRWF(Math.round(owed));
  document.getElementById('supCount').textContent = rows.filter(r => r.balance > 0.5).length;
  body.innerHTML = rows.map((r, i) => `<tr>
      <td><strong>${esc(r.supplier)}</strong>${r.untracked ? `<div class="muted" style="font-size:11px">${r.untracked} older purchase(s) with no payment record — treated as paid</div>` : ''}</td>
      <td class="num">${r.purchases}</td>
      <td class="num">${fmtRWF(Math.round(r.bought))}</td>
      <td class="num">${fmtRWF(Math.round(r.paidOnDelivery))}</td>
      <td class="num">${fmtRWF(Math.round(r.paidLater))}</td>
      <td class="num" style="font-weight:900;color:${r.balance > 0.5 ? 'var(--red)' : 'var(--green)'}">${fmtRWF(Math.round(r.balance))}</td>
      <td class="muted">${esc(r.lastPurchase || '—')}</td>
      <td style="white-space:nowrap">
        ${r.balance > 0.5 && can('canRecordExpenses') ? `<button class="btn btn-primary btn-sm" onclick="showSupplierPay(${i})">Pay</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="showSupplierHistory(${i})">History</button>
      </td></tr>`).join('') || `<tr><td colspan="8" class="ar-empty">No suppliers yet. Suppliers appear when stock is received with a supplier name.</td></tr>`;
  window._suppliers = rows;
}

function showSupplierPay(i) {
  const s = window._suppliers[i];
  document.getElementById('modalContent').innerHTML = `
    <h3>Pay ${esc(s.supplier)}</h3>
    <div class="ar-note" style="margin-bottom:12px">Owed: <strong>${fmtRWF(Math.round(s.balance))}</strong></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Amount (RWF) *</label>
        <input type="number" class="form-input" id="spAmount" min="1" max="${s.balance}" value="${Math.round(s.balance)}"/></div>
      <div class="form-group"><label class="form-label">Paid with *</label>
        <select class="form-input" id="spMethod"><option value="Cash">Cash (from the drawer)</option><option value="MoMo">MoMo</option><option value="Bank">Bank</option><option value="Card">Card</option></select></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Date *</label><input type="date" class="form-input" id="spDate" value="${today()}"/></div>
      <div class="form-group"><label class="form-label">Reference</label><input class="form-input" id="spRef" placeholder="Receipt / transaction no."/></div>
    </div>
    <div class="form-group"><label class="form-label">Note</label><input class="form-input" id="spNote"/></div>
    <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="submitSupplierPay(${i})">Record payment</button>`;
  document.getElementById('modalOverlay').classList.add('show');
}
async function submitSupplierPay(i) {
  const s = window._suppliers[i];
  const amount = +document.getElementById('spAmount').value;
  if (!(amount > 0)) { toast('Enter an amount', 'error'); return; }
  const res = await api('suppliers', 'pay', {
    supplier: s.supplier, amount, method: document.getElementById('spMethod').value,
    date: document.getElementById('spDate').value, reference: document.getElementById('spRef').value.trim(), note: document.getElementById('spNote').value.trim(),
  });
  if (!res.ok) { toast(res.error || 'Could not record the payment', 'error'); return; }
  closeModal(); toast('Payment recorded '); loadSuppliers();
}
async function showSupplierHistory(i) {
  const s = window._suppliers[i];
  const res = await apiGet('suppliers', 'history', { supplier: s.supplier });
  if (!res.ok) { toast(res.error || 'Could not load', 'error'); return; }
  const tbl = (head, rows) => `<div class="ar-table-wrap"><table class="ar-table"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}" class="ar-empty">None</td></tr>`}</tbody></table></div>`;
  document.getElementById('modalContent').innerHTML = `<div class="ar-drill">
    <h3>${esc(s.supplier)}</h3>
    <div class="ar-group-label" style="margin-top:6px">Deliveries</div>
    ${tbl(['Date', 'Item', 'Qty', 'Total', 'Paid on delivery', 'Owed', 'Ref'], res.purchases.map(p => `<tr><td>${esc(p.date)}</td><td>${esc(p.item_name)}</td><td class="num">${+p.quantity} ${esc(p.unit)}</td><td class="num">${fmtRWF(Math.round(p.total_cost))}</td><td class="num">${p.amount_paid === null ? 'not recorded' : fmtRWF(Math.round(p.amount_paid)) + ' ' + esc(p.payment_method || '')}</td><td class="num">${p.amount_paid === null ? '—' : fmtRWF(Math.round(p.total_cost - p.amount_paid))}</td><td>${esc(p.reference || '')}</td></tr>`).join(''))}
    <div class="ar-group-label" style="margin-top:12px">Payments</div>
    ${tbl(['Date', 'Amount', 'Method', 'Reference', 'Note', 'By'], res.payments.map(p => `<tr><td>${esc(p.date)}</td><td class="num">${fmtRWF(Math.round(p.amount))}</td><td>${esc(p.method)}</td><td>${esc(p.reference || '')}</td><td>${esc(p.note || '')}</td><td>${esc(p.recorded_by)}</td></tr>`).join(''))}
  </div>`;
  document.getElementById('modalOverlay').classList.add('show');
}
