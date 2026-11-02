/* ═══════════════════════════════════════════════════
   BARMS PRO — attendance.js
   Start work / End work.
   - Manager, Bartender and Kitchen tap "Start work" when they arrive and "End work"
     when they finish. It is NOT the sign-in: the app signs people out after 10 idle
     minutes, their work goes on until they end it themselves. It never blocks anything.
   - The Owner (and a Manager allowed to see employees) sees who is on duty, who started
     late, who has not started, and the hours worked — on the dashboard and on the
     Attendance page — and gets a pop-up when someone starts.
   Server: api/attendance.php
   Depends on: utils.js, api.js, auth.js, shifts.js (shiftDeviceName)
═══════════════════════════════════════════════════ */

const ATT = { current: null, expected: null, at: 0, duty: null, known: null, range: 'today', hist: null, reminded: false, poll: null };

const attIsWorker = () => typeof session !== 'undefined' && ['Manager', 'Bartender', 'Kitchen'].includes(session.role);
const attCanSee = () => typeof session !== 'undefined' && (session.role === 'Owner' || (session.role === 'Manager' && typeof can === 'function' && can('canViewEmployees')));

// 135 → "2h 15m", 45 → "45m"
function attMin(m) {
  m = Math.max(0, Math.round(+m || 0));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}
const attHM = dt => (dt ? String(dt).slice(11, 16) : '');
const attDay = dt => String(dt || '').slice(0, 10);
const attInitials = n => String(n || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

// minutes late for a start at `at` ('YYYY-MM-DD HH:MM:SS') — the same rule as api/attendance.php (5 minutes of grace;
// null = nothing to compare with, or hours after the expected time: another shift of the day). Used offline, for display;
// the server works it out again from the real time when the start reaches it.
function attLateMinutes(expected, at) {
  if (!expected) return null;
  const ms = s => new Date(String(s).replace(' ', 'T')).getTime();
  let diff = Math.round((ms(at) - ms(`${String(at).slice(0, 10)} ${expected}:00`)) / 60000);
  if (diff < -12 * 60) diff += 24 * 60;
  if (diff > 12 * 60) return null;
  return diff > 5 ? diff : 0;
}

// minutes on duty now: the server's figure plus the time since it was read (no dependence on this phone's clock)
function attLive() {
  return ATT.current ? ATT.current.minutes + Math.floor((Date.now() - ATT.at) / 60000) : 0;
}

// ── MY BUTTON (top bar) ───────────────────────────
async function refreshWorkButton() {
  const btn = document.getElementById('workBtn');
  if (!btn) return;
  if (!attIsWorker()) { btn.style.display = 'none'; return; }
  btn.style.display = '';
  const res = await apiGet('attendance', 'current');
  if (res.ok) {
    ATT.current = res.attendance;
    ATT.expected = res.expectedStart;
    ATT.at = Date.now();
  } else if (!res.network) {
    return;   // a real error: keep what the button showed
  }
  paintWorkButton();
}

function paintWorkButton() {
  const btn = document.getElementById('workBtn');
  if (!btn || !attIsWorker()) return;
  const c = ATT.current;
  btn.classList.toggle('on', !!c && !c.stale);
  if (c && c.stale) {
    btn.innerHTML = '<span class="status warn">Work not ended</span>';
    btn.title = 'You started work a long time ago and never ended it — tap to fix';
  } else if (c) {
    btn.innerHTML = `<span class="status ok">On duty — ${esc(attMin(attLive()))}</span>`;
    btn.title = `You started work at ${attHM(c.startedAt)} — tap to end your work`;
  } else {
    btn.innerHTML = '<span class="status">Start work</span>';
    btn.title = 'Tell the Owner you have started work';
  }
}
setInterval(() => { if (ATT.current) paintWorkButton(); }, 30 * 1000);

async function showWorkModal() {
  hideWorkReminder();
  await refreshWorkButton();
  const mc = document.getElementById('modalContent');
  const c = ATT.current;
  if (!c) {
    mc.innerHTML = `
      <h3>Start work</h3>
      <p style="font-size:13px;color:var(--muted);margin-bottom:12px">Tell the Owner you have arrived. You stay on duty until you end your work yourself, even if the app signs you out.</p>
      ${ATT.expected ? `<div class="att-modal-meta">Expected start: ${esc(ATT.expected)}</div>` : ''}
      <div class="form-group"><label class="form-label">Note (optional)</label>
        <input class="form-input" id="workNote" maxlength="200" placeholder="e.g. covering the evening"/></div>
      <div class="att-modal-meta">Device: ${esc(typeof shiftDeviceName === 'function' ? shiftDeviceName() : '')}</div>
      <button class="btn btn-primary" style="width:100%;justify-content:center" id="workGo" onclick="startWork()">Start work</button>`;
  } else {
    mc.innerHTML = `
      <h3>Your work</h3>
      ${c.stale ? '<div class="att-warn">This work started a long time ago and was never ended. If you end it now, its hours will not be counted. Start work again for today.</div>' : ''}
      <div class="att-modal-time">${esc(attMin(attLive()))}</div>
      <div class="att-modal-meta">On duty since ${esc(attHM(c.startedAt))}${c.lateMinutes ? `<span class="att-tag late">Late by ${c.lateMinutes} min</span>` : ''}</div>
      <div class="form-group"><label class="form-label">Note (optional)</label>
        <input class="form-input" id="workNote" maxlength="200" placeholder="e.g. closing time"/></div>
      <button class="btn btn-primary" style="width:100%;justify-content:center" id="workGo" onclick="endWork()">End work</button>`;
  }
  document.getElementById('modalOverlay').classList.add('show');
}

async function startWork() {
  const go = document.getElementById('workGo'); if (go) go.disabled = true;
  const note = (document.getElementById('workNote')?.value || '').trim();
  const res = await attSend('start', { device: typeof shiftDeviceName === 'function' ? shiftDeviceName() : '', note, clientUuid: newUuid() });
  if (!res.ok) {
    if (go) go.disabled = false;
    toast(res.error || 'Could not start work', 'error');
    if (res.alreadyStarted) { closeModal(); refreshWorkButton(); }
    return;
  }
  closeModal();
  toast(res.lateMinutes ? `Work started — ${res.lateMinutes} min late` : 'Work started', res.lateMinutes ? 'warning' : 'success');
  await refreshWorkButton();
}

async function endWork() {
  const go = document.getElementById('workGo'); if (go) go.disabled = true;
  const note = (document.getElementById('workNote')?.value || '').trim();
  const res = await attSend('end', { note });
  if (!res.ok) { if (go) go.disabled = false; toast(res.error || 'Could not end work', 'error'); return; }
  closeModal();
  if (res.forgotten) toast(res.message || 'That work was never ended, so its hours are not counted.', 'warning');
  else toast(`Work ended — you worked ${attMin(res.minutes)}`, 'success');
  ATT.current = null;
  await refreshWorkButton();
}

// one place for the call, so offline devices can queue it (see the offline stage)
async function attSend(action, payload) { return api('attendance', action, payload); }

// ── REMINDER (never blocks) ───────────────────────
function showWorkReminder() {
  if (!attIsWorker() || ATT.current || ATT.reminded || session.offline) return;
  ATT.reminded = true;
  hideWorkReminder();
  const el = document.createElement('div');
  el.id = 'workReminder';
  el.innerHTML = `<b>You have not started work</b>Tap Start work so the Owner knows when you arrived.
    <div class="wr-actions"><button class="btn btn-primary btn-sm" onclick="hideWorkReminder();showWorkModal()">Start work</button>
    <button class="btn btn-ghost btn-sm" onclick="hideWorkReminder()">Later</button></div>`;
  document.body.appendChild(el);
}
function hideWorkReminder() { document.getElementById('workReminder')?.remove(); }

// ── OWNER: who is on duty ─────────────────────────
function attWorkingRow(w, withEnd) {
  const sub = `Since ${attHM(w.startedAt)} — ${attMin(w.minutes)}`;
  return `<div class="att-row">
    <div class="att-av">${esc(attInitials(w.user))}</div>
    <div class="att-info"><div class="att-name">${esc(w.user)}${w.lateMinutes ? `<span class="att-tag late">${w.lateMinutes} min late</span>` : ''}${w.stale ? '<span class="att-tag bad">Never ended</span>' : ''}</div>
      <div class="att-sub">${esc(w.role)} — ${esc(sub)}</div></div>
    ${withEnd ? `<button class="btn btn-ghost btn-sm" onclick="attForceEnd(${+w.id})">End work</button>` : ''}
  </div>`;
}
function attNotRow(n) {
  return `<div class="att-row">
    <div class="att-av warn">${esc(attInitials(n.user))}</div>
    <div class="att-info"><div class="att-name">${esc(n.user)}<span class="att-tag late">${n.minutesLate} min late</span></div>
      <div class="att-sub">${esc(n.role)} — Expected ${esc(n.expectedStart)}</div></div>
  </div>`;
}

async function attPollDuty() {
  if (!attCanSee() || document.getElementById('appShell')?.style.display === 'none') return;
  const res = await apiGet('attendance', 'on_duty');
  if (!res.ok) return;
  ATT.duty = res;
  // a pop-up for each person who started since the last look (not for the first look after signing in)
  const ids = new Set(res.working.map(w => w.id));
  if (ATT.known) {
    res.working.filter(w => !ATT.known.has(w.id) && !w.stale).forEach(w => {
      showPopupNotif(`${w.user} started work at ${attHM(w.startedAt)}${w.lateMinutes ? ` — ${w.lateMinutes} min late` : ''}`, w.lateMinutes ? 'warning' : 'info', '');
    });
    if (res.working.some(w => !ATT.known.has(w.id)) && typeof updateNotifBadge === 'function') updateNotifBadge();
  }
  ATT.known = ids;
  renderDutyCard();
  if (document.getElementById('page-attendance')?.classList.contains('active')) renderAttBoard();
}

function renderDutyCard() {
  const panel = document.getElementById('dbDutyPanel');
  if (!panel) return;
  if (!attCanSee()) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  const d = ATT.duty;
  const body = document.getElementById('dbDutyBody');
  if (!d) { body.innerHTML = uiLoader('Loading'); return; }
  let h = '';
  if (d.working.length) h += `<div class="att-duty">${d.working.map(w => attWorkingRow(w, false)).join('')}</div>`;
  else h += '<div class="att-empty">Nobody has started work yet.</div>';
  if (d.notStarted.length) h += `<div class="att-duty-note"><b>Not started yet</b> ${d.notStarted.map(n => `<span>${esc(n.user)}</span> <span class="att-tag late">${n.minutesLate} min late</span>`).join(' ')}</div>`;
  body.innerHTML = h;
}

// the dashboard shows the card each time it loads
if (typeof loadDashboard === 'function') {
  const _attLoadDashboard = loadDashboard;
  loadDashboard = async function () {
    const r = await _attLoadDashboard.apply(this, arguments);
    if (attCanSee()) { renderDutyCard(); attPollDuty(); }
    return r;
  };
}

// ── OWNER: Attendance page ────────────────────────
const ATT_RANGES = [['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This week'], ['last_week', 'Last week'], ['this_month', 'This month'], ['last_month', 'Last month']];

async function loadAttendance() {
  if (!attCanSee()) return;
  document.getElementById('attRange').innerHTML = ATT_RANGES.map(([k, l]) => `<button class="ar-chip ${ATT.range === k ? 'active' : ''}" onclick="ATT.range='${k}';loadAttendanceHistory()">${l}</button>`).join('');
  await attPollDuty();
  renderAttBoard();
  loadAttendanceHistory();
  loadExpectedStarts();
}

function renderAttBoard() {
  const d = ATT.duty;
  if (!d) return;
  const owner = session.role === 'Owner';
  document.getElementById('attWorkingCount').textContent = d.working.length;
  document.getElementById('attNotCount').textContent = d.notStarted.length;
  document.getElementById('attWorking').innerHTML = d.working.length ? d.working.map(w => attWorkingRow(w, owner)).join('') : '<div class="att-empty">Nobody has started work yet.</div>';
  document.getElementById('attNotStarted').innerHTML = d.notStarted.length ? d.notStarted.map(attNotRow).join('') : '<div class="att-empty">Everyone with an expected start time has started.</div>';
}

async function loadAttendanceHistory() {
  document.getElementById('attRange').innerHTML = ATT_RANGES.map(([k, l]) => `<button class="ar-chip ${ATT.range === k ? 'active' : ''}" onclick="ATT.range='${k}';loadAttendanceHistory()">${l}</button>`).join('');
  const person = document.getElementById('attPerson').value;
  const res = await apiGet('attendance', 'list', { preset: ATT.range, ...(person ? { userId: person } : {}) });
  if (!res.ok) { toast(res.error || 'Could not load the attendance', 'error'); return; }
  ATT.hist = res;
  // the person filter lists everyone who started in this period (and keeps the choice)
  const sel = document.getElementById('attPerson');
  if (!person) {
    sel.innerHTML = '<option value="">Everyone</option>' + res.people.map(p => `<option value="${p.userId}">${esc(p.user)}</option>`).join('');
  }
  document.getElementById('attPeople').innerHTML = res.people.length ? res.people.map(p => `<tr>
      <td><b>${esc(p.user)}</b></td><td>${esc(p.role)}</td><td class="num">${p.days}</td><td class="num">${p.starts}</td>
      <td class="num">${esc(attMin(p.minutes))}</td>
      <td class="num">${p.late ? `${p.late} (${esc(attMin(p.lateMinutes))})` : '0'}</td>
      <td class="num">${p.forgot || 0}</td></tr>`).join('')
    : '<tr><td colspan="7" class="att-empty">Nobody started work in this period.</td></tr>';
  document.getElementById('attRows').innerHTML = res.rows.length ? res.rows.map(r => {
    const ended = r.status === 'closed' ? attHM(r.endedAt) : r.status === 'forgot' || r.stale ? '<span class="att-tag bad">Never ended</span>' : '<span class="att-tag ok">On duty</span>';
    const note = [r.startNote, r.endNote, r.endedBy ? `ended by ${r.endedBy}` : ''].filter(Boolean).join(' — ');
    return `<tr><td>${esc(attDay(r.startedAt))}</td><td><b>${esc(r.user)}</b></td><td>${esc(r.role)}</td>
      <td>${esc(attHM(r.startedAt))}${r.lateMinutes ? `<span class="att-tag late">${r.lateMinutes} min late</span>` : ''}</td>
      <td>${ended}</td><td class="num">${r.status === 'closed' ? esc(attMin(r.minutes)) : '—'}</td>
      <td>${esc(note)}</td><td>${esc(r.device || '')}</td></tr>`;
  }).join('') : '<tr><td colspan="8" class="att-empty">Nothing to show.</td></tr>';
  document.getElementById('attNote').textContent = res.rows.length >= 1000 ? 'Showing the latest 1000 starts. Choose a shorter period to see the rest.' : 'Hours are counted only for work that was ended. Work that was never ended has no hours.';
}

async function attForceEnd(id) {
  const w = ((ATT.duty && ATT.duty.working) || []).find(x => x.id === id);
  if (!confirm(`End work for ${w ? w.user : 'this person'} now?`)) return;
  const res = await api('attendance', 'force_end', { id });
  if (!res.ok) { toast(res.error || 'Could not end the work', 'error'); return; }
  toast('Work ended');
  await attPollDuty();
  loadAttendanceHistory();
}

// ── OWNER: expected start times ───────────────────
async function loadExpectedStarts() {
  const sec = document.getElementById('attExpectedSection');
  if (session.role !== 'Owner') { sec.style.display = 'none'; return; }
  sec.style.display = '';
  const res = await apiGet('attendance', 'staff');
  if (!res.ok) return;
  document.getElementById('attExpected').innerHTML = res.staff.length ? res.staff.map(s => `<tr>
      <td><b>${esc(s.user)}</b></td><td>${esc(s.role)}</td>
      <td><input type="time" class="form-input att-time-input" id="attExp_${s.userId}" value="${esc(s.expectedStart || '')}"/></td>
      <td><button class="btn btn-primary btn-sm" onclick="saveExpected(${s.userId})">Save</button>
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('attExp_${s.userId}').value='';saveExpected(${s.userId})">Clear</button></td></tr>`).join('')
    : '<tr><td colspan="4" class="att-empty">No staff yet. Add them in Settings.</td></tr>';
}

async function saveExpected(userId) {
  const time = document.getElementById('attExp_' + userId).value;
  const res = await api('attendance', 'set_expected', { userId, time });
  if (!res.ok) { toast(res.error || 'Could not save', 'error'); return; }
  toast(time ? 'Expected start saved' : 'Expected start removed');
  attPollDuty();
}

// ── SIGN-IN / SIGN-OUT ────────────────────────────
function attAfterSignIn() {
  ATT.current = null; ATT.known = null; ATT.duty = null; ATT.reminded = false;
  if (attIsWorker()) {
    refreshWorkButton().then(() => setTimeout(showWorkReminder, 2500));
    // work started offline is being sent just now: look again once it has reached the server
    if (!session.offline) setTimeout(refreshWorkButton, 8000);
  } else {
    const btn = document.getElementById('workBtn'); if (btn) btn.style.display = 'none';
  }
  if (attCanSee()) {
    attPollDuty();
    if (!ATT.poll) ATT.poll = setInterval(attPollDuty, 60 * 1000);
  }
}
if (typeof applyRoleAccess === 'function') {
  const _attRole = applyRoleAccess;
  applyRoleAccess = async function () { const r = await _attRole.apply(this, arguments); attAfterSignIn(); return r; };
}
if (typeof doLogout === 'function') {
  const _attLogout = doLogout;
  doLogout = async function () {
    hideWorkReminder();
    const btn = document.getElementById('workBtn'); if (btn) btn.style.display = 'none';
    ATT.current = null; ATT.known = null; ATT.duty = null;
    if (ATT.poll) { clearInterval(ATT.poll); ATT.poll = null; }
    return _attLogout.apply(this, arguments);
  };
}
