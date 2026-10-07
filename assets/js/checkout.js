/* ═══════════════════════════════════════════════════
   BARMS PRO — checkout.js
   Checkout & Invoice Page (Page 3)
═══════════════════════════════════════════════════ */

let _checkoutPM       = 'Cash';
let _checkoutDelivery = 'print';
let _lastReceipt      = null;

// ── LOAD CHECKOUT PAGE ─────────────────────────────
async function loadCheckoutPage() {
  if (!_orderSession) return;

  const sess = _orderSession;
  const invoiceNum = `INV-${String(sess.sessionId).padStart(5, '0')}`;

  // Update header
  const metaEl = document.getElementById('checkoutInvoiceMeta');
  const subEl  = document.getElementById('checkoutPageSub');
  const invEl  = document.getElementById('checkoutInvoiceNum');
  const now    = new Date();
  if (invEl)  invEl.textContent  = invoiceNum;
  if (metaEl) metaEl.textContent = `${sess.type === 'takeaway' ? 'Takeaway' : '' + sess.tableName} · ${now.toLocaleDateString('en-RW')} ${now.toLocaleTimeString('en-RW',{hour:'2-digit',minute:'2-digit'})}`;
  if (subEl)  subEl.textContent  = `${sess.tableName} — ${sess.items.length} items`;

  // Render items table
  const tbody = document.getElementById('checkoutItemsTable');
  if (tbody) {
    tbody.innerHTML = sess.items.map(item => `
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:10px 4px;font-size:13px;font-weight:600">${esc(item.product_name)}</td>
        <td style="padding:10px 4px;text-align:center;font-size:13px;color:var(--muted)">${item.qty}</td>
        <td style="padding:10px 4px;text-align:right;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums">${fmtRWF(item.unit_price||item.unitPrice)}</td>
        <td style="padding:10px 4px;text-align:right;font-size:13px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums">${fmtRWF(item.total)}</td>
      </tr>
    `).join('');
  }

  // Totals
  const total = sess.total;
  const subEl2 = document.getElementById('checkoutSubtotal');
  const totEl  = document.getElementById('checkoutTotal');
  const payTot = document.getElementById('checkoutPayTotal');
  if (subEl2) subEl2.textContent = fmtRWF(total);
  if (totEl)  totEl.textContent  = fmtRWF(total);
  if (payTot) payTot.textContent = fmtRWF(total);

  // Note
  const noteRow  = document.getElementById('checkoutNoteRow');
  const noteText = document.getElementById('checkoutNoteText');
  if (sess.note && noteRow && noteText) {
    noteRow.style.display = 'block';
    noteText.textContent  = sess.note;
  } else if (noteRow) {
    noteRow.style.display = 'none';
  }

  // Reset payment method
  _checkoutPM = 'Cash';
  document.querySelectorAll('.checkout-pm-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('cpm_Cash')?.classList.add('active');

  showPage('checkout');
}

// ── SELECT PAYMENT METHOD ──────────────────────────
function selectCheckoutPM(method, btn) {
  _checkoutPM = method;
  document.querySelectorAll('.checkout-pm-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

// ── SELECT DELIVERY ────────────────────────────────
function selectDelivery(type, labelEl) {
  _checkoutDelivery = type;
  document.querySelectorAll('#page-checkout label').forEach(l => l.style.borderColor = 'var(--border)');
  if (labelEl) labelEl.style.borderColor = 'var(--blue)';
}

// ── PROCESS CHECKOUT ────────────────────────────────
async function processCheckout() {
  if (!_orderSession) return;
  const phone = document.getElementById('checkoutPhone')?.value?.trim() || '';
  const note  = _orderSession.note || '';
  const btn   = document.getElementById('payAndCloseBtn');

  if (btn) { btn.textContent = 'Processing...'; btn.disabled = true; }

  const res = await api('sessions', 'close_session', {
    sessionId:     _orderSession.sessionId,
    paymentMethod: _checkoutPM,
    customerPhone: phone,
    note,
  });

  if (btn) { btn.textContent = `Pay & Close — ${fmtRWF(_orderSession.total)}`; btn.disabled = false; }

  if (!res.ok) { toast(res.error || 'Payment failed', 'error'); return; }

  _lastReceipt = res;

  // Handle delivery
  if (_checkoutDelivery === 'print' || _checkoutDelivery === 'both') {
    printCheckoutReceipt(res);
  }
  if ((_checkoutDelivery === 'sms' || _checkoutDelivery === 'both') && phone) {
    const smsRes = await api('sessions', 'send_sms', { receiptId: res.receiptId, phone });
    toast(smsRes.ok ? `SMS sent to ${phone} ` : 'SMS failed', smsRes.ok ? 'success' : 'error');
  } else if ((_checkoutDelivery === 'sms' || _checkoutDelivery === 'both') && !phone) {
    toast('Enter a phone number to send SMS', 'warning');
  }

  toast('Payment successful!', 'success');

  // Go back to POS
  _orderSession = null;
  showPage('pos');
  loadPOS();
}

// ── PRINT RECEIPT ──────────────────────────────────
function printCheckoutReceipt(data) {
  const items   = data.items || _orderSession?.items || [];
  const total   = data.total || _orderSession?.total || 0;
  const table   = data.tableName || _orderSession?.tableName || '';
  const pm      = data.paymentMethod || _checkoutPM;
  const sessId  = data.sessionId || _orderSession?.sessionId || '';
  const now     = new Date();
  const invoiceNum = `INV-${String(sessId).padStart(5,'0')}`;
  const dateStr = now.toLocaleDateString('en-RW',{day:'2-digit',month:'short',year:'numeric'});
  const timeStr = now.toLocaleTimeString('en-RW',{hour:'2-digit',minute:'2-digit'});

  const win = window.open('', '_blank', 'width=400,height=650');
  if (!win) { toast('Allow popups to print receipt', 'warning'); return; }
  win.document.write(`<!DOCTYPE html><html><head>
    <title>Receipt ${invoiceNum}</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:13px;padding:16px;color:#111;background:#fff}
    .center{text-align:center}.dashed{border-top:1px dashed #999;margin:10px 0}
    .row{display:flex;justify-content:space-between;padding:4px 0}
    .total-row{display:flex;justify-content:space-between;font-size:16px;font-weight:900;border-top:2px solid #111;padding-top:8px;margin-top:6px}
    @media print{@page{margin:5mm;size:auto}body{width:100%;max-width:72mm;margin:0 auto;padding:0}}</style>
  </head><body>
    <div class="center" style="margin-bottom:14px">
      <div style="font-size:22px"></div>
      <div style="font-size:16px;font-weight:900;letter-spacing:.1em">BAR MANAGEMENT</div>
      <div style="font-size:10px;color:#666;margin-top:2px">BarMS Pro</div>
    </div>
    <div class="dashed"></div>
    <div class="row"><span>${table}</span><span>${invoiceNum}</span></div>
    <div class="row" style="font-size:11px;color:#666"><span>${dateStr}</span><span>${timeStr}</span></div>
    <div class="dashed"></div>
    <div style="font-size:10px;color:#666;display:flex;justify-content:space-between;margin-bottom:4px"><span>PRODUCT</span><span>QTY × PRICE = TOTAL</span></div>
    ${items.map(i=>`<div class="row"><span>${esc(i.product_name||i.name)}</span><span>${i.qty} × ${(i.unit_price||i.unitPrice||0).toLocaleString()} = ${(i.total||0).toLocaleString()}</span></div>`).join('')}
    <div class="dashed"></div>
    <div class="total-row"><span>TOTAL</span><span>${total.toLocaleString()} RWF</span></div>
    <div class="row" style="font-size:12px;margin-top:6px"><span>Payment</span><span>${esc(pm)}</span></div>
    <div class="dashed"></div>
    <div class="center" style="margin-top:12px;font-size:13px;font-weight:700">Murakoze Kudusura! </div>
    <div class="center" style="font-size:10px;color:#999;margin-top:4px"></div>
    <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),500)}<\/script>
  </body></html>`);
  win.document.close();
}

// ── CLOSE CHECKOUT PAGE ────────────────────────────
function closeCheckoutPage() {
  showPage('order');
}
