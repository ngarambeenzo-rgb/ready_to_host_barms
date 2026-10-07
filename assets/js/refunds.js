/* ═══════════════════════════════════════════════════
   BARMS PRO — refunds.js
   Paid orders: view, request a void (sale entered by
   mistake — Owner approves), refund (Owner only).
   Depends on: utils.js, api.js, auth.js, order-management.js, misc.js
═══════════════════════════════════════════════════ */

let _paidOrder = null; // { order, items, refunds } of the order open in the modal

// ── PAID ORDERS LIST ──────────────────────────────
async function loadPaidOrders() {
  _omStopKitchenPolling();
  showPage('order-management');
  _omMode('list');
  const header = document.getElementById('omOrderTitle');
  const sub    = document.getElementById('omOrderSub');
  const grid   = document.getElementById('omProductGrid');
  if (header) header.textContent = 'Paid orders';
  if (sub)    sub.textContent    = 'Last 100 paid orders — open one to request a void or refund';
  const badge = document.getElementById('omStatusBadge'); if (badge) badge.style.display = 'none';
  if (!grid) return;
  grid.innerHTML = _omListTabs('paid') + `<div class="om-span">${uiLoader('Loading paid orders')}</div>`;

  const res = await apiGet('orders', 'list', { status: 'paid' });
  if (!res.ok) { grid.innerHTML = _omListTabs('paid') + `<div class="om-span">${uiEmpty('alertcircle', 'Could not load paid orders', res.error || '')}</div>`; return; }
  const orders = res.data || [];
  if (!orders.length) {
    grid.innerHTML = _omListTabs('paid') + `<div class="om-span">${uiEmpty('receipt', 'No paid orders yet', 'Paid orders appear here after checkout.')}</div>`;
    return;
  }
  grid.innerHTML = _omListTabs('paid') + orders.map(o => {
    const paid = o.paidAt ? new Date(String(o.paidAt).replace(' ', 'T')) : null;
    const when = paid ? paid.toLocaleDateString('en-RW') + ' ' + paid.toLocaleTimeString('en-RW', { hour: '2-digit', minute: '2-digit' }) : '';
    const refunded = o.refundedTotal > 0;
    return `<button class="om-order-card" onclick="showPaidOrder(${o.id})">
      <span class="om-oc-top"><span class="om-oc-no">${esc(o.orderNumber)}</span><span class="om-chip ${refunded ? 'refunded' : 'paid'}">${refunded ? 'Refunded ' + fmtRWF(o.refundedTotal) : 'Paid'}</span></span>
      <span class="om-oc-where">${ic(o.type === 'dinein' ? 'armchair' : 'bag')}${o.type === 'dinein' ? esc(o.tableName || 'Table') : 'Takeaway'} · ${esc(o.payment_method || '')}</span>
      <span class="om-oc-meta">${esc(when)} · ${o.itemCount} item${o.itemCount !== 1 ? 's' : ''} · ${esc(o.paid_by || o.createdBy || '')}</span>
      <span class="om-oc-total">${fmtRWF(o.total)}</span>
    </button>`;
  }).join('');
}

// ── ONE PAID ORDER ────────────────────────────────
async function showPaidOrder(orderId) {
  const res = await apiGet('orders', 'get', { orderId });
  if (!res.ok) { toast(res.error || 'Could not load order', 'error'); return; }
  _paidOrder = { order: res.order, items: res.items || [], refunds: res.refunds || [] };
  const o = res.order;
  const hasRefund = _paidOrder.refunds.length > 0;
  const canRequest = ['Owner', 'Manager', 'Bartender'].includes(session.role);

  document.getElementById('modalContent').innerHTML = `
    <h3 style="margin-bottom:4px">${esc(o.orderNumber)} — Paid</h3>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px">${o.type === 'dinein' ? '' + esc(o.tableName) : 'Takeaway'} · ${esc(o.paymentMethod || '')} · ${esc(o.paidAt || '')}</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
      <thead><tr style="border-bottom:2px solid var(--border)">
        <th style="text-align:left;padding:6px 4px;font-size:11px;color:var(--muted)">Item</th>
        <th style="text-align:center;padding:6px 4px;font-size:11px;color:var(--muted)">Qty</th>
        <th style="text-align:right;padding:6px 4px;font-size:11px;color:var(--muted)">Total</th>
      </tr></thead>
      <tbody>${_paidOrder.items.map(i => `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:6px 4px;font-size:13px">${esc(i.product_name)}${i.refunded_qty ? `<div style="font-size:11px;color:var(--orange)">${i.refunded_qty} refunded</div>` : ''}</td>
        <td style="padding:6px 4px;text-align:center;font-size:13px">${i.qty}</td>
        <td style="padding:6px 4px;text-align:right;font-size:13px;font-weight:700">${fmtRWF(i.total)}</td></tr>`).join('')}
        <tr><td colspan="2" style="padding:8px 4px;font-weight:800">Paid</td><td style="padding:8px 4px;text-align:right;font-weight:900;color:var(--green)">${fmtRWF(o.total)}</td></tr>
        ${hasRefund ? `<tr><td colspan="2" style="padding:4px;font-weight:700;color:var(--orange)">Refunded</td><td style="padding:4px;text-align:right;font-weight:800;color:var(--orange)">− ${fmtRWF(o.refundedTotal)}</td></tr>` : ''}
      </tbody>
    </table>
    ${hasRefund ? `<div style="font-size:12px;background:var(--bg);border-radius:8px;padding:8px 10px;margin-bottom:12px">${_paidOrder.refunds.map(r =>
      `<div>${esc(r.refund_date)} · ${fmtRWF(r.amount)} via ${esc(r.method)} by ${esc(r.refunded_by)} — ${esc(r.reason)}</div>`).join('')}</div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${canRequest && !hasRefund ? `<button class="btn btn-ghost" style="flex:1;justify-content:center;color:var(--red)" onclick="requestVoidPaidOrder()">Request Void</button>` : ''}
      ${can('canGiveRefunds')
        ? `<button class="btn btn-primary" style="flex:1;justify-content:center" onclick="showRefundForm()">Refund</button>`
        : canRequest ? `<button class="btn btn-primary" style="flex:1;justify-content:center" onclick="showRefundForm()">Request Refund</button>` : ''}
    </div>
    <div style="font-size:11px;color:var(--muted);margin-top:10px">
      <strong>Void</strong> = this sale never really happened (entered by mistake). The Owner checks and approves it; everything is reversed.<br>
      <strong>Refund</strong> = the customer paid but is given money back. Needs the Owner's permission: without it, your refund is sent to the Owner to approve. It is subtracted from revenue on the day it is given.
    </div>`;
  document.getElementById('modalOverlay').classList.add('show');
}

function requestVoidPaidOrder() {
  const o = _paidOrder?.order;
  if (!o) return;
  document.getElementById('modalContent').innerHTML = `
    <h3>Request Void — ${esc(o.orderNumber)}</h3>
    <p style="font-size:13px;color:var(--muted);margin:10px 0 16px">Use this only if the sale was <strong>entered by mistake</strong> and no money was really taken. The <strong>Owner</strong> must check and approve it. Approving cancels the <strong>whole order</strong> (${fmtRWF(o.total)}) and puts the drinks back in stock.<br>If the customer paid and wants money back, ask the Owner for a <strong>refund</strong> instead.</p>
    <div class="form-group">
      <label class="form-label">What was the mistake? *</label>
      <textarea class="form-input" id="voidReasonInput" rows="3" placeholder="e.g. Entered on the wrong table, the customer never ordered this" style="resize:vertical"></textarea>
    </div>
    <button class="btn btn-primary" onclick="submitVoidRequest('order',${o.orderId},'Order',${o.total})">Send to Owner</button>`;
}

// ── REFUND FORM ───────────────────────────────────
// With the refund permission the refund happens at once; otherwise it is sent to the Owner as a request
function showRefundForm() {
  if (!_paidOrder) return;
  const o = _paidOrder.order;
  const direct = can('canGiveRefunds');
  const rows = _paidOrder.items.map(i => {
    const left = i.qty - (i.refunded_qty || 0);
    const isBar = (i.source_type || 'bar') !== 'kitchen';
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 4px;font-size:13px">${esc(i.product_name)}<div style="font-size:11px;color:var(--muted)">${fmtRWF(i.unit_price)} each · ${left} of ${i.qty} refundable</div></td>
      <td style="padding:8px 4px;text-align:center"><input type="number" class="form-input rf-qty" data-item="${i.id}" data-price="${i.unit_price}" min="0" max="${left}" value="0" ${left ? '' : 'disabled'} style="width:70px;text-align:center;padding:6px" oninput="updateRefundTotal()"/></td>
      <td style="padding:8px 4px;text-align:center">${isBar
        ? `<label style="font-size:12px;display:inline-flex;gap:4px;align-items:center;cursor:pointer"><input type="checkbox" class="rf-restock" data-item="${i.id}"/> Sealed — back in stock</label>`
        : '<span style="font-size:11px;color:var(--muted)">Food — not restocked</span>'}</td>
    </tr>`;
  }).join('');
  document.getElementById('modalContent').innerHTML = `
    <h3 style="margin-bottom:4px">${direct ? 'Refund' : 'Request Refund'} — ${esc(o.orderNumber)}</h3>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Choose how many of each item to refund.${direct ? '' : ' <strong>No money is given back until the Owner approves this request.</strong>'}</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:420px">
      <thead><tr style="border-bottom:2px solid var(--border)">
        <th style="text-align:left;padding:6px 4px;font-size:11px;color:var(--muted)">Item</th>
        <th style="padding:6px 4px;font-size:11px;color:var(--muted)">Refund qty</th>
        <th style="padding:6px 4px;font-size:11px;color:var(--muted)">Stock</th>
      </tr></thead><tbody>${rows}</tbody>
    </table></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
      <div class="form-group"><label class="form-label">Money returned by *</label>
        <select class="form-input" id="rfMethod"><option>Cash</option><option>MoMo</option><option>Card</option><option>Other</option></select></div>
      <div class="form-group"><label class="form-label">Refund total</label>
        <div id="rfTotal" style="font-size:20px;font-weight:900;color:var(--orange);padding-top:6px">RWF 0</div></div>
    </div>
    <div class="form-group"><label class="form-label">Reason *</label>
      <textarea class="form-input" id="rfReason" rows="2" placeholder="e.g. Drink was flat, customer complained" style="resize:vertical"></textarea></div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-primary" id="rfSubmitBtn" style="flex:1;justify-content:center" onclick="submitRefund()">${direct ? 'Confirm Refund' : 'Send to Owner'}</button>
      <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="showPaidOrder(${o.orderId})">← Back</button>
    </div>`;
}

function updateRefundTotal() {
  let total = 0;
  document.querySelectorAll('.rf-qty').forEach(inp => {
    const max = +inp.max || 0;
    if (+inp.value > max) inp.value = max;
    if (+inp.value < 0) inp.value = 0;
    total += (Math.floor(+inp.value) || 0) * (+inp.dataset.price || 0);
  });
  const el = document.getElementById('rfTotal');
  if (el) el.textContent = fmtRWF(total);
  return total;
}

async function submitRefund() {
  if (!_paidOrder) return;
  const items = [...document.querySelectorAll('.rf-qty')]
    .map(inp => ({
      orderItemId: +inp.dataset.item,
      qty: Math.floor(+inp.value) || 0,
      restock: !!document.querySelector(`.rf-restock[data-item="${inp.dataset.item}"]`)?.checked,
    }))
    .filter(i => i.qty > 0);
  const reason = document.getElementById('rfReason')?.value?.trim() || '';
  const method = document.getElementById('rfMethod')?.value || 'Cash';
  if (!items.length) { toast('Enter how many items to refund', 'error'); return; }
  if (!reason) { toast('A reason is required', 'error'); return; }
  const total = updateRefundTotal();
  const direct = can('canGiveRefunds');
  const question = direct ? `Refund ${fmtRWF(total)} to the customer via ${method}?` : `Send a refund request of ${fmtRWF(total)} to the Owner?`;
  confirm2(question, async () => {
    const res = await api('orders', direct ? 'refund' : 'refund_request', { orderId: _paidOrder.order.orderId, items, reason, method });
    if (!res.ok) { toast(res.error || 'Refund failed', 'error'); return; }
    if (direct) toast(`Refunded ${fmtRWF(res.amount)}`, 'warning');
    else { toast(`Refund request sent (${fmtRWF(res.amount)}) — the Owner, or a manager allowed to give refunds, approves it in Requests`, 'success'); if (typeof updateVoidBadge === 'function') updateVoidBadge(); }
    closeModal();
    loadPaidOrders();
  });
}
