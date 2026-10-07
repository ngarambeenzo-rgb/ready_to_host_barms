/* ═══════════════════════════════════════════════════
   BARMS PRO — shifts.js
   Cash shifts: open with the cash in the drawer, close
   with the cash counted. Expected cash is calculated on
   the server (api/shifts.php → report_lib rpShiftCash).
   Depends on: utils.js, api.js, auth.js
═══════════════════════════════════════════════════ */

let _shift = null;

// Show the Shift button for staff who take money, with the shift state
async function refreshShiftButton() {
  const btn = document.getElementById('shiftBtn');
  if (!btn) return;
  if (!['Owner', 'Manager', 'Bartender'].includes(session.role)) { btn.style.display = 'none'; return; }
  btn.style.display = '';
  const res = await apiGet('shifts', 'current');
  _shift = res.ok ? res.shift : null;
  btn.innerHTML = `<span class="status ${_shift ? 'ok' : ''}">${_shift ? 'Shift open' : 'Open shift'}</span>`;
  btn.title = _shift ? 'Your cash shift is open — click to close it' : 'Open a cash shift before taking money';
}

function shiftDeviceName() {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

async function showShiftModal() {
  await refreshShiftButton();
  const mc = document.getElementById('modalContent');
  if (!_shift) {
    mc.innerHTML = `
      <h3>Open a shift</h3>
      <p style="font-size:13px;color:var(--muted);margin-bottom:14px">Count the cash already in the drawer before you start. Every cash payment, refund and cash expense during your shift is added to it, so at the end the system knows how much cash should be there.</p>
      <div class="form-group"><label class="form-label">Cash in the drawer now (RWF) *</label>
        <input type="number" class="form-input" id="shiftFloat" min="0" step="1" value="0"/></div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:12px">Device: ${esc(shiftDeviceName())}</div>
      <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="openShift()">Open shift</button>`;
  } else {
    const c = _shift.cash;
    const line = (l, v, sign = '') => `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px"><span>${l}</span><span>${sign}${fmtRWF(v)}</span></div>`;
    mc.innerHTML = `
      <h3>Your shift</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px">Opened ${esc(_shift.openedAt)} · ${esc(_shift.device || '')} · ${c.orders} order(s) paid</div>
      <div style="background:var(--bg);border-radius:10px;padding:10px 12px;margin-bottom:12px">
        ${line('Cash at the start', c.openingFloat)}
        ${line('Cash sales', c.cashSales, '+ ')}
        ${c.debtCollections ? line('Customer debts collected in cash', c.debtCollections, '+ ') : ''}
        ${c.cashIn ? line('Cash put in', c.cashIn, '+ ') : ''}
        ${c.refunds ? line('Cash refunds', c.refunds, '− ') : ''}
        ${c.expenses ? line('Cash expenses', c.expenses, '− ') : ''}
        ${c.supplierPayments ? line('Cash paid to suppliers', c.supplierPayments, '− ') : ''}
        ${c.cashOut ? line('Cash taken out', c.cashOut, '− ') : ''}
        <div style="border-top:2px solid var(--border);margin-top:6px;padding-top:6px;display:flex;justify-content:space-between;font-weight:900"><span>Expected in the drawer</span><span id="shiftExpected">${fmtRWF(c.expected)}</span></div>
        ${c.otherPayments || c.mixedPayments ? `<div style="font-size:11px;color:var(--muted);margin-top:6px">Not cash: ${fmtRWF(c.otherPayments)} by MoMo/Card/Bank${c.mixedPayments ? `, ${fmtRWF(c.mixedPayments)} "Mixed" (not counted as cash)` : ''}</div>` : ''}
      </div>
      <div class="form-group"><label class="form-label">Cash counted in the drawer (RWF) *</label>
        <input type="number" class="form-input" id="shiftCounted" min="0" step="1" oninput="shiftShowDiff(${c.expected})"/></div>
      <div id="shiftDiff" style="font-size:13px;font-weight:800;margin:-4px 0 10px"></div>
      <div class="form-group"><label class="form-label">Note (required if the count is different)</label>
        <input class="form-input" id="shiftNote" placeholder="e.g. 500 given as wrong change"/></div>
      <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="closeShift()">Close shift</button>`;
  }
  document.getElementById('modalOverlay').classList.add('show');
}

function shiftShowDiff(expected) {
  const el = document.getElementById('shiftDiff');
  const v = document.getElementById('shiftCounted').value;
  if (v === '') { el.textContent = ''; return; }
  const d = Math.round(+v - expected);
  el.innerHTML = d === 0 ? '<span style="color:var(--green)">Matches what is expected</span>'
    : `<span style="color:${d < 0 ? 'var(--red)' : 'var(--orange)'}">${d < 0 ? 'Short' : 'Over'} by ${fmtRWF(Math.abs(d))}</span>`;
}

async function openShift() {
  const v = document.getElementById('shiftFloat').value;
  if (v === '' || +v < 0) { toast('Enter the cash in the drawer (0 if empty)', 'error'); return; }
  const res = await api('shifts', 'open', { openingFloat: +v, device: shiftDeviceName() });
  if (!res.ok) { toast(res.error || 'Could not open the shift', 'error'); return; }
  closeModal(); toast('Shift opened'); refreshShiftButton();
  if (document.getElementById('page-payment-invoice')?.classList.contains('active') && typeof piCheckShift === 'function') piCheckShift();
  if (typeof piCheckShift === 'function') piCheckShift();
}

async function closeShift() {
  const v = document.getElementById('shiftCounted').value;
  if (v === '' || +v < 0) { toast('Count the cash and enter the amount', 'error'); return; }
  const note = document.getElementById('shiftNote').value.trim();
  const res = await api('shifts', 'close', { countedCash: +v, note });
  if (!res.ok) { toast(res.error || 'Could not close the shift', 'error'); return; }
  closeModal();
  toast(res.difference === 0 ? 'Shift closed — cash matches' : `Shift closed — ${res.difference < 0 ? 'short' : 'over'} by ${fmtRWF(Math.abs(res.difference))}`, res.difference === 0 ? 'success' : 'warning');
  refreshShiftButton();
}
