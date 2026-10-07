/* ═══════════════════════════════════════════════════
   BARMS PRO — backdate.js
   Backdate mode UI: activate, deactivate, banner, modal
   Depends on: api.js, utils.js
═══════════════════════════════════════════════════ */

let _backdateActive = false;
let _backdateDate   = null;
let _backdateReason = null;

// ── Init: restore state from server session on page load ──
async function initBackdateMode() {
  try {
    const res = await apiGet('misc', 'backdate_status');
    if (res.active) {
      _backdateActive = true;
      _backdateDate   = res.date;
      _backdateReason = res.reason;
      showBackdateBanner();
    }
  } catch(e) {}
}

function _openBackdateModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('show');
}

// ── Show the change-date modal ──
function showBackdateModal() {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  _openBackdateModal(`
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-size:32px"></div>
      <h3 style="margin:8px 0 4px">Change Working Date</h3>
      <p style="font-size:12px;color:var(--text-muted);margin:0">
        All sales and orders will be recorded under the selected date
      </p>
    </div>
    <div class="form-group">
      <label class="form-label">Target Date</label>
      <input type="date" id="bdDate" class="form-input"
             max="${yesterday}"
             value="${_backdateDate || yesterday}" />
      <p style="font-size:11px;color:var(--text-muted);margin-top:4px">Must be a past date</p>
    </div>
    <div class="form-group">
      <label class="form-label">Reason <span style="color:var(--red)">*</span></label>
      <textarea id="bdReason" class="form-input" rows="3"
                placeholder="e.g. Forgot to record yesterday's evening sales"
                style="resize:vertical">${_backdateReason || ''}</textarea>
    </div>
    <div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:12px;margin-bottom:16px;font-size:12px;color:#92400E">
      <strong>Important:</strong> You can only <em>add new sales</em> for the target date.
      Paid orders cannot be voided. All backdated entries are logged and visible to the Owner.
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="activateBackdate()">
        Switch to Date
      </button>
      ${_backdateActive ? `
      <button class="btn btn-ghost" style="flex:1;justify-content:center;color:var(--red)" onclick="deactivateBackdate()">
        ✕ Return to Today
      </button>` : ''}
    </div>
  `);
}

// ── Activate backdate ──
async function activateBackdate() {
  const date   = document.getElementById('bdDate')?.value?.trim();
  const reason = document.getElementById('bdReason')?.value?.trim();

  if (!date)   return toast('Please select a date', 'error');
  if (!reason) return toast('Please enter a reason', 'error');

  const today = new Date().toISOString().split('T')[0];
  if (date >= today) return toast('Must be a past date', 'error');

  try {
    const res = await api('misc', 'backdate_activate', { date, reason });
    if (!res.ok) return toast(res.error || 'Failed to activate', 'error');

    _backdateActive = true;
    _backdateDate   = date;
    _backdateReason = reason;

    closeModal();
    showBackdateBanner();
    toast(`Now working in: ${bdFormatDate(date)}`, 'success');
  } catch(e) {
    toast('Error activating backdate mode', 'error');
  }
}

// ── Deactivate backdate ──
async function deactivateBackdate() {
  try {
    await api('misc', 'backdate_deactivate', {});
    _backdateActive = false;
    _backdateDate   = null;
    _backdateReason = null;
    closeModal();
    hideBackdateBanner();
    toast('Returned to today', 'success');
  } catch(e) {
    toast('Error deactivating', 'error');
  }
}

// ── Banner ──
function showBackdateBanner() {
  const banner = document.getElementById('backdateBanner');
  if (!banner) return;
  banner.style.display = 'flex';
  const dateEl = document.getElementById('bdBannerDate');
  const reasonEl = document.getElementById('bdBannerReason');
  if (dateEl) dateEl.textContent = bdFormatDate(_backdateDate);
  if (reasonEl) reasonEl.textContent = _backdateReason;
}

function hideBackdateBanner() {
  const banner = document.getElementById('backdateBanner');
  if (banner) banner.style.display = 'none';
}

function bdFormatDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString('en-RW', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Owner: manage backdate permissions ──
async function showBackdatePermissions() {
  try {
    const res = await apiGet('misc', 'backdate_users_list');
    if (!res.ok) return toast('Failed to load users', 'error');

    const rows = res.data.map(u => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-weight:600;font-size:13px">${esc(u.fullName)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${esc(u.username)} — ${esc(u.role)}</div>
        </div>
        ${u.role === 'Owner' ?
          '<span style="font-size:11px;color:var(--text-muted)">Always allowed</span>' :
          `<button class="btn btn-sm ${u.canBackdate ? 'btn-ghost' : 'btn-primary'}"
                   style="font-size:11px"
                   onclick="toggleBackdatePerm(${u.id}, ${u.canBackdate})">
            ${u.canBackdate ? 'Revoke' : 'Grant'}
           </button>`
        }
      </div>
    `).join('');

    _openBackdateModal(`
      <h3 style="margin:0 0 4px">Backdate Permissions</h3>
      <p style="font-size:12px;color:var(--text-muted);margin:0 0 16px">
        Control who can record sales for past dates
      </p>
      <div>${rows}</div>
      <button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:16px"
              onclick="showBackdateLog()">View Backdate Log</button>
    `);
  } catch(e) {
    toast('Error loading users', 'error');
  }
}

async function toggleBackdatePerm(userId, currentState) {
  const action = currentState ? 'backdate_revoke' : 'backdate_grant';
  try {
    const res = await api('misc', action, { userId });
    if (!res.ok) return toast(res.error || 'Failed', 'error');
    toast(currentState ? 'Permission revoked' : 'Permission granted', 'success');
    showBackdatePermissions();
  } catch(e) {
    toast('Error updating permission', 'error');
  }
}

async function showBackdateLog() {
  try {
    const res = await apiGet('misc', 'backdate_log');
    if (!res.ok) return toast('Failed to load log', 'error');

    const rows = res.data.length === 0
      ? '<p style="text-align:center;color:var(--text-muted);padding:20px">No backdate activity yet</p>'
      : res.data.map(r => `
          <div style="padding:10px 0;border-bottom:1px solid var(--border);font-size:12px">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <strong>${esc(r.username)}</strong>
              <span style="color:var(--text-muted)">${(r.activatedAt||'').substring(0,16)}</span>
            </div>
            <div>Target: <strong style="color:var(--blue)">${esc(r.targetDate)}</strong></div>
            <div style="color:var(--text-muted);margin-top:2px">Reason: ${esc(r.reason)}</div>
          </div>
        `).join('');

    _openBackdateModal(`
      <h3 style="margin:0 0 16px">Backdate Activity Log</h3>
      <div style="max-height:400px;overflow-y:auto">${rows}</div>
    `);
  } catch(e) {
    toast('Error loading log', 'error');
  }
}

// Init on load
document.addEventListener('DOMContentLoaded', initBackdateMode);
