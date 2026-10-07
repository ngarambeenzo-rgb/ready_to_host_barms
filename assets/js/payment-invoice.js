/* ═══════════════════════════════════════════════════
   payment-invoice.js — Page 3: Payment & Invoice
   Flow: Display Invoice → Select Payment → Pay & Close
═══════════════════════════════════════════════════ */

let _piOrder    = null;
let _piPM       = 'Cash';
let _piDelivery = 'print';

// ── LOAD PAYMENT PAGE ─────────────────────────────
function loadPaymentInvoice(order) {
  // Guard: if accessed directly from sidebar with no order, redirect to orders list
  if (!order) {
    toast('Select an order first', 'warning');
    loadAllOrders();
    return;
  }
  _piOrder    = order;
  _piPM       = 'Cash';
  _piDelivery = 'print';

  const invoiceNum = `INV-${String(order.orderId).padStart(5, '0')}`;
  const now = new Date();

  // Header
  const invEl  = document.getElementById('piInvoiceNum');
  const metaEl = document.getElementById('piInvoiceMeta');
  const subEl  = document.getElementById('piPageSub');
  if (invEl)  invEl.textContent  = invoiceNum;
  if (metaEl) metaEl.textContent = `${order.type === 'dinein' ? order.tableName : 'Takeaway'} · ${now.toLocaleDateString('en-RW')} ${now.toLocaleTimeString('en-RW',{hour:'2-digit',minute:'2-digit'})}`;
  if (subEl)  subEl.textContent  = `${order.orderNumber} — ${order.items.length} items`;

  // Items table
  const tbody = document.getElementById('piItemsTable');
  if (tbody) {
    tbody.innerHTML = order.items.map(item => `
      <tr>
        <td class="strong">${esc(item.product_name)}</td>
        <td class="c muted">${item.qty}</td>
        <td class="r muted">${fmtRWF(item.unit_price)}</td>
        <td class="r strong">${fmtRWF(item.total)}</td>
      </tr>
    `).join('');
  }

  // Total
  const totEl  = document.getElementById('piTotal');
  const payTot = document.getElementById('piPayTotal');
  if (totEl)  totEl.textContent  = fmtRWF(order.total);
  if (payTot) payTot.textContent = fmtRWF(order.total);

  // Note
  const noteBox  = document.getElementById('piNoteBox');
  const noteText = document.getElementById('piNoteText');
  if (order.note && noteBox && noteText) {
    noteBox.style.display = ''; noteText.textContent = order.note;
  } else if (noteBox) { noteBox.style.display = 'none'; }

  // Reset UI
  document.querySelectorAll('.pi-pm-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('pipm_Cash')?.classList.add('active');
  document.querySelectorAll('.pi-delivery-opt').forEach(l => l.classList.remove('selected'));
  document.querySelector('.pi-delivery-opt')?.classList.add('selected');

  // Discounts: only the Owner's discounts for the items on this order (Settings → Discounts)
  const dIn = document.getElementById('piDiscount'); if (dIn) dIn.value = '';
  const dWhy = document.getElementById('piDiscountReason'); if (dWhy) dWhy.value = '';
  piLoadDiscounts(order.orderId);
  piUpdateTotals();
  piCheckShift();

  showPage('payment-invoice');
}

// ── DISCOUNT ──────────────────────────────────────
let _piDiscOpts = [];
async function piLoadDiscounts(orderId) {
  const box = document.getElementById('piDiscountBox');
  const list = document.getElementById('piDiscountRules');
  const free = document.getElementById('piDiscountFree');
  _piDiscOpts = [];
  if (box) box.style.display = 'none';
  const res = await apiGet('discounts', 'options', { orderId });
  if (!res.ok || !box) return;
  _piDiscOpts = res.data || [];
  const showRules = res.canApply && _piDiscOpts.length;
  if (!showRules && !res.canFree) return;
  box.style.display = '';
  free.style.display = res.canFree ? '' : 'none';
  document.getElementById('piDiscHint').textContent = res.canFree ? 'you are the Owner' : 'set by the Owner';
  list.innerHTML = showRules
    ? _piDiscOpts.map(o => `<label class="pi-drule"><input type="checkbox" value="${o.id}" onchange="piUpdateTotals()">
        <span class="pi-drule-name">${esc(o.name)}<span class="pi-drule-sub">${o.kind === 'percent' ? o.value + '% off' : fmtRWF(o.value) + ' off each'}</span></span>
        <span class="pi-drule-amt">− ${fmtRWF(o.amount)}</span></label>`).join('')
    : `<div class="form-hint" style="margin:0">No discount is set up for the items on this order.</div>`;
  piUpdateTotals();
}
function piCheckedRules() { return [...document.querySelectorAll('#piDiscountRules input:checked')].map(i => +i.value); }

function piDiscountValue() {
  const rules = piCheckedRules().reduce((a, id) => a + ((_piDiscOpts.find(o => o.id === id) || {}).amount || 0), 0);
  const v = rules + Math.round(+document.getElementById('piDiscount')?.value || 0);
  return Math.max(0, v);
}
function piUpdateTotals() {
  if (!_piOrder) return;
  const d = Math.min(piDiscountValue(), _piOrder.total);
  const due = _piOrder.total - d;
  const payTot = document.getElementById('piPayTotal');
  if (payTot) payTot.textContent = fmtRWF(due);
  const dueEl = document.getElementById('piDueAmt');
  if (dueEl) uiTween(dueEl, due);
  const info = document.getElementById('piDiscountInfo');
  if (info) info.textContent = d > 0 ? `${fmtRWF(_piOrder.total)} − ${fmtRWF(d)} (${(d / _piOrder.total * 100).toFixed(1)}%) = ${fmtRWF(due)} to pay` : '';
}
async function piCheckShift() {
  const hint = document.getElementById('piShiftHint');
  if (!hint) return;
  const res = await apiGet('shifts', 'current');
  const noShift = res.ok && !res.shift;
  const mustHave = session.role === 'Bartender';          // bartenders cannot take money without a shift
  hint.style.display = noShift ? '' : 'none';
  hint.classList.toggle('block', noShift && mustHave);
  const txt = hint.querySelector('span');
  if (txt) txt.innerHTML = noShift && mustHave
    ? 'Open your shift before taking payment. Count the cash in the drawer, then you can take money.<br><button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="showShiftModal()">Open shift</button>'
    : 'You have no open shift, so this payment will not be in a cash count. Open a shift from the top bar.';
  const btn = document.getElementById('piPayBtn');
  if (btn) { btn.disabled = noShift && mustHave; btn.classList.toggle('is-disabled', noShift && mustHave); }
}

// ── SELECT PAYMENT METHOD ─────────────────────────
// keys 1–5 pick the payment method (not while typing)
document.addEventListener('keydown', e => {
  if (!document.getElementById('page-payment-invoice')?.classList.contains('active')) return;
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '') || e.ctrlKey || e.metaKey || e.altKey) return;
  const m = ['Cash', 'MoMo', 'Card', 'Bank', 'Mixed'][+e.key - 1];
  if (m) { e.preventDefault(); piSelectPM(m, document.getElementById('pipm_' + m)); }
});

function piSelectPM(method, btn) {
  _piPM = method;
  document.querySelectorAll('.pi-pm-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

// ── SELECT DELIVERY ───────────────────────────────
function piSelectDelivery(type, labelEl) {
  _piDelivery = type;
  document.querySelectorAll('.pi-delivery-opt').forEach(l => l.classList.remove('selected'));
  if (labelEl) labelEl.classList.add('selected');
}

// ── PAY & CLOSE ───────────────────────────────────
async function piPayAndClose() {
  if (!_piOrder) return;
  const phone = document.getElementById('piPhone')?.value?.trim() || '';
  const btn   = document.getElementById('piPayBtn');

  const discount = piDiscountValue();
  const extraOff = Math.round(+document.getElementById('piDiscount')?.value || 0);
  const discountRules = piCheckedRules();
  const discountReason = document.getElementById('piDiscountReason')?.value?.trim() || '';
  if (extraOff > 0 && !discountReason) { toast('Give a reason for the discount', 'error'); return; }
  if (discount > _piOrder.total) { toast('Discount cannot be more than the total', 'error'); return; }

  if (btn) { if (btn.disabled) return; uiBusy(btn, true); btn.disabled = true; }

  const res = await api('orders', 'pay', {
    orderId:       _piOrder.orderId,
    paymentMethod: _piPM,
    customerPhone: phone,
    discount: extraOff, discountReason, discountRules,
  });

  if (btn) { uiBusy(btn, false); btn.disabled = false; }
  if (res.ok) { _piOrder.discount = res.discount || 0; _piOrder.discountReason = res.discountReason || discountReason; }

  if (!res.ok) { toast(res.error || 'Payment failed', 'error'); return; }

  if ((_piDelivery === 'sms' || _piDelivery === 'both') && phone) {
    const smsRes = await api('orders', 'send_sms', { orderId: _piOrder.orderId, phone });
    toast(smsRes.ok ? `SMS sent to ${phone} ` : 'SMS failed — check phone number', smsRes.ok ? 'success' : 'error');
  } else if ((_piDelivery === 'sms' || _piDelivery === 'both') && !phone) {
    toast('Enter a phone number to send SMS', 'warning');
  }

  await uiPaymentSuccess({ amount: _piOrder.total - (res.discount || 0), sub: `${_piPM} · ${_piOrder.orderNumber}${_piOrder.type === 'dinein' ? ' · table is free' : ''}` });

  if (_piDelivery === 'print' || _piDelivery === 'both') {
    await _piShowReceiptPreview(res);
    return;
  }

  // Return to orders list
  _piOrder = null;
  loadAllOrders();
}

// ── RECEIPT PREVIEW ───────────────────────────────
async function _piShowReceiptPreview(data) {
  const order  = _piOrder;
  const items  = order.items || [];
  const total  = order.total || 0;
  const now    = new Date();
  const invNum = `INV-${String(order.orderId).padStart(5,'0')}`;
  const preview = document.getElementById('piReceiptPreview');
  if (!preview) return;
  let barName = 'BarMS Pro';
  try {
    const [settings, licensedName] = await Promise.all([
      apiGet('sessions', 'bar_info'),
      dbGet('settings', 'licensed_bar_name'),
    ]);
    if (settings.ok && settings.barName && settings.barName !== 'BarMS Pro') {
      barName = settings.barName;
    } else if (licensedName?.value) {
      barName = licensedName.value;
    } else if (settings.ok && settings.barName) {
      barName = settings.barName;
    }
  } catch(e) {}

  preview.innerHTML = `
    <header style="text-align:center;margin-bottom:14px">
      <div style="font-size:16px;font-weight:900;overflow-wrap:anywhere">${esc(barName)}</div>
      <div style="font-size:11px;color:#555;margin-top:3px">BarMS Pro Receipt</div>
    </header>
    <div style="border-top:1px dashed #888;margin:10px 0"></div>
    <div style="display:flex;justify-content:space-between;gap:8px"><span>${esc(order.type === 'dinein' ? order.tableName : 'Takeaway')}</span><span>${invNum}</span></div>
    <div style="display:flex;justify-content:space-between;gap:8px;color:#555;font-size:11px;margin-top:5px"><span>${now.toLocaleDateString('en-RW',{day:'2-digit',month:'short',year:'numeric'})}</span><span>${now.toLocaleTimeString('en-RW',{hour:'2-digit',minute:'2-digit'})}</span></div>
    <div style="border-top:1px dashed #888;margin:10px 0"></div>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:#555;margin-bottom:5px"><span>ITEM</span><span>QTY x PRICE</span></div>
    ${items.map(item => `<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0"><span>${esc(item.product_name)}</span><span style="white-space:nowrap">${item.qty} x ${(item.unit_price || 0).toLocaleString()} = ${(item.total || 0).toLocaleString()}</span></div>`).join('')}
    <div style="border-top:1px dashed #888;margin:10px 0"></div>
    ${order.discount > 0 ? `
    <div style="display:flex;justify-content:space-between;font-size:12px"><span>Subtotal</span><span>${total.toLocaleString()} RWF</span></div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin:3px 0 6px"><span>Discount${order.discountReason ? ' (' + esc(order.discountReason) + ')' : ''}</span><span>− ${order.discount.toLocaleString()} RWF</span></div>
    <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:900"><span>TOTAL PAID</span><span>${(total - order.discount).toLocaleString()} RWF</span></div>` : `
    <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:900"><span>TOTAL</span><span>${total.toLocaleString()} RWF</span></div>`}
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:7px"><span>Payment</span><span>${esc(_piPM)}</span></div>
    ${order.note ? `<div style="border-top:1px dashed #888;margin:10px 0"></div><div style="font-size:11px;color:#555">Note: ${esc(order.note)}</div>` : ''}
    <div style="border-top:1px dashed #888;margin:10px 0"></div>
    <div style="text-align:center;margin-top:10px;font-size:13px;font-weight:700">Murakoze Kudusura!</div>
    <div style="text-align:center;margin-top:6px;font-size:10px;color:#777">BarMS Pro · IMS — Integrated Management Solutions</div>
  `;

  const receiptModal = document.getElementById('piReceiptModal');
  if (receiptModal.parentElement !== document.body) document.body.appendChild(receiptModal);
  receiptModal.style.display = 'flex';
}

function piPrintReceiptNow() {
  printWithClass('print-receipt');
}

function piFinishReceipt() {
  document.getElementById('piReceiptModal').style.display = 'none';
  _piOrder = null;
  loadAllOrders();
}

// ── BACK ──────────────────────────────────────────
function piBack() {
  if (_piOrder) loadOrderManagement(_piOrder.orderId);
  else loadAllOrders();
}
