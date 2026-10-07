/* ═══════════════════════════════════════════════════
   bar-sales.js — Page 4: Bar Sales
   Shows drink items sold from validated orders
═══════════════════════════════════════════════════ */
let _bsCurrentFilter = 'today';
// ── LOAD BAR SALES ────────────────────────────────
async function loadBarSales(filter) {
  _bsCurrentFilter = filter || 'today';
  // Update active filter button
  ['today','week','month','date'].forEach(f => {
    const btn = document.getElementById(`bsFilter-${f}`);
    if (btn) {
      btn.style.fontWeight  = f === _bsCurrentFilter ? '800' : '600';
      btn.style.borderColor = f === _bsCurrentFilter ? 'var(--blue)' : 'var(--border)';
      btn.style.color       = f === _bsCurrentFilter ? 'var(--blue)' : 'var(--muted)';
    }
  });
  const params = { filter: _bsCurrentFilter };
  if (_bsCurrentFilter === 'date') {
    params.date = document.getElementById('bsPickDate')?.value || '';
  }
  const tbody = document.getElementById('bsTableBody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="padding:30px;text-align:center;color:var(--muted)"><div class="ui-loader"><span class="ul-mark"><i></i><i></i><i></i></span><span class="ul-text">Loading…</span></div></td></tr>`;
  const res = await apiGet('orders', 'bar_sales', params);
  if (!res.ok) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="padding:30px;text-align:center;color:var(--red)">Could not load data</td></tr>`;
    return;
  }
  const sales = res.data || [];
  // KPIs
  const kpiTotal = sales.reduce((a, s) => a + (s.total || 0), 0);
  const kpiItems = sales.reduce((a, s) => a + (s.qty || 0), 0);
  document.getElementById('bsKpiTotal').textContent = fmtRWF(kpiTotal);
  document.getElementById('bsKpiItems').textContent = kpiItems;
  document.getElementById('bsKpiTx').textContent    = sales.length;
  // Table
  if (!tbody) return;
  if (!sales.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:40px;text-align:center;color:var(--muted)">No bar sales found for this period</td></tr>`;
    return;
  }
  const canRequestVoid = ['Owner','Manager','Bartender'].includes(session.role);
  tbody.innerHTML = sales.map(s => `
    <tr style="border-bottom:1px solid var(--border);transition:background .1s" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
      <td style="padding:12px 16px;font-size:13px;color:var(--muted)">${esc(s.date)}</td>
      <td style="padding:12px 16px;font-size:13px;font-weight:600;color:var(--text)">${esc(s.product_name)}</td>
      <td style="padding:12px 16px;text-align:center;font-size:13px;font-weight:700;color:var(--text)">${s.qty}</td>
      <td style="padding:12px 16px;text-align:right;font-size:13px;color:var(--muted)">${fmtRWF(s.unit_price)}</td>
      <td style="padding:12px 16px;text-align:right;font-size:13px;font-weight:800;color:var(--green)">${fmtRWF(s.total)}</td>
      <td style="padding:12px 16px;font-size:12px;color:var(--muted)">${esc(s.sold_by || '')}</td>
      <td style="padding:12px 16px;text-align:center">
        <span style="font-size:11px;padding:3px 8px;border-radius:8px;background:var(--blue-lt);color:var(--blue);font-weight:700">${esc(s.order_number || '')}</span>
      </td>
      <td style="padding:12px 16px;text-align:center">
        ${canRequestVoid && s.order_id
          ? `<button class="btn btn-ghost btn-sm" style="color:var(--orange)" onclick="openSaleOrder(${+s.order_id})">Void / Refund</button>`
          : ''}
      </td>
    </tr>
  `).join('');
}

// ── VOID / REFUND: open the whole order this sale line belongs to ──
async function openSaleOrder(orderId) {
  const res = await apiGet('orders', 'get', { orderId });
  if (!res.ok) { toast(res.error || 'Could not load order', 'error'); return; }
  if (res.order.voided) { toast('This order is already voided', 'warning'); return; }
  if (res.order.status === 'paid') { showPaidOrder(orderId); return; }
  // Not paid yet: a void request cancels the whole order
  _paidOrder = { order: res.order, items: res.items || [], refunds: [] };
  requestVoidPaidOrder();
  document.getElementById('modalOverlay').classList.add('show');
}
