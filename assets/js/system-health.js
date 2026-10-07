/* ═══════════════════════════════════════════════════
   BARMS PRO — system-health.js   (Owner only)
   System Health page + the coloured dot in the top bar.
   • server checks: api/health.php?action=status (database, tables,
     structure, records, unfinished saves, version, business discrepancies)
   • device checks, done here in the browser: offline queue, service
     worker, local storage, connection
   • incidents: grouped problems with references and their history
   Statuses: healthy · degraded · recovering · action required · critical
═══════════════════════════════════════════════════ */

const SH_STATUS = {
  healthy:         { label: 'Healthy',         tone: 'good', text: 'Everything is working normally.' },
  degraded:        { label: 'Degraded',        tone: 'warn', text: 'BarMS works, but something needs a look soon.' },
  recovering:      { label: 'Recovering',      tone: 'info', text: 'BarMS found a problem and is fixing it by itself.' },
  action_required: { label: 'Action required', tone: 'bad',  text: 'A problem needs the Owner or support. Details below.' },
  critical:        { label: 'Critical',        tone: 'bad',  text: 'A critical part is not working. Data is protected; fix this before continuing normally.' },
};
const SH_CHECK = { ok: ['ok', 'OK'], warn: ['warn', 'Check'], fail: ['bad', 'Problem'] };
const SH = { range: '7d', showResolved: false, last: null, lastDot: 0 };

// ── device checks (this browser) ─────────────────
async function shDeviceChecks() {
  const out = [];
  const add = (key, label, status, detail, extra = {}) => out.push({ key, group: 'This device', label, status, detail, ...extra });
  add('online', 'Internet connection', navigator.onLine ? 'ok' : 'warn', navigator.onLine ? 'Online' : 'Offline — sales are kept on this device until the connection returns');
  // offline queue (older Quick Sale + expenses saved without connection)
  try {
    const q = await dbGetAll('sync_queue');
    const pending = q.filter(i => i.status === 'pending');
    const stuck = q.filter(i => i.status === 'failed' || (i.status === 'pending' && (i.retryCount || 0) >= 5));
    const conflicts = q.filter(i => i.status === 'conflict');
    const oldest = pending.reduce((m, i) => Math.min(m, i.createdAt || i.timestamp || Date.now()), Date.now());
    const hours = Math.floor((Date.now() - oldest) / 3600000);
    const st = stuck.length || conflicts.length ? 'fail' : (pending.length && hours >= 6 ? 'warn' : 'ok');
    add('queue', 'Saved offline, waiting to sync', st,
      !q.length ? 'Nothing waiting' : `${pending.length} waiting${hours ? `, oldest ${hours} h` : ''}${stuck.length ? ` · ${stuck.length} failed 5 times` : ''}${conflicts.length ? ` · ${conflicts.length} conflict(s) to review` : ''} — kept on this device, never deleted`,
      stuck.length ? { action: 'shRetryFailed()', actionLabel: 'Retry failed items' } : {});
  } catch (e) { add('queue', 'Saved offline, waiting to sync', 'fail', 'This browser\'s local storage cannot be read'); }
  try {
    const last = await dbGet('cache_meta', 'last_ims_sync');
    const h = last && last.timestamp ? Math.floor((Date.now() - last.timestamp) / 3600000) : null;
    add('lastsync', 'Last licence check with IMS', h === null ? 'warn' : h > 48 ? 'warn' : 'ok', h === null ? 'Never' : h < 1 ? 'Less than an hour ago' : `${h} h ago`);
  } catch (e) { /* covered by the queue check */ }
  // service worker (offline app)
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const ver = reg && reg.active ? await shSwVersion(reg.active) : null;
      add('sw', 'Offline app (service worker)', reg && reg.active ? 'ok' : 'warn', reg && reg.active ? `Active${ver ? ' · ' + ver : ''}` : 'Not installed — BarMS works online only on this device');
    } catch (e) { add('sw', 'Offline app (service worker)', 'warn', 'Could not be checked'); }
  } else add('sw', 'Offline app (service worker)', 'warn', 'This browser does not support it');
  // storage space
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      const pct = quota ? Math.round(usage / quota * 100) : 0;
      add('storage', 'Space on this device', pct > 85 ? 'warn' : 'ok', `${pct}% used (${Math.round(usage / 1048576)} MB)`);
    }
  } catch (e) {}
  return out;
}
function shSwVersion(worker) {
  return new Promise(resolve => {
    const done = v => { navigator.serviceWorker.removeEventListener('message', onMsg); resolve(v); };
    const onMsg = e => { if (e.data && e.data.type === 'VERSION') done(e.data.version); };
    navigator.serviceWorker.addEventListener('message', onMsg);
    try { worker.postMessage({ type: 'GET_VERSION' }); } catch (e) { done(null); }
    setTimeout(() => done(null), 1500);
  });
}

// ── page ─────────────────────────────────────────
async function loadSystemHealth(force) {
  const banner = document.getElementById('shBanner');
  if (!banner) return;
  banner.innerHTML = uiLoader('Checking BarMS');
  const [res, device] = await Promise.all([apiGet('health', 'status', { full: 1, clientVersion: BARMS_CLIENT_VERSION }), shDeviceChecks()]);
  if (!res.ok) {
    banner.innerHTML = shBannerHtml('critical', res.error || 'The server did not answer the health check.');
    document.getElementById('shChecks').innerHTML = shChecksHtml(device);
    shSetDot('critical');
    return;
  }
  const d = res.data;
  let overall = d.overall;
  // a device problem lowers the status but never hides a server one
  if (overall === 'healthy' && device.some(c => c.status !== 'ok')) overall = device.some(c => c.status === 'fail') ? 'action_required' : 'degraded';
  SH.last = { ...d, overall };
  banner.innerHTML = shBannerHtml(overall, `Checked ${d.checkedAt} · server version ${d.serverVersion}`);
  document.getElementById('shChecks').innerHTML = shChecksHtml(d.checks.concat(device));
  shSetDot(overall);
  loadShIncidents();
  shAutoBackup(d.checks);
  if (force) toast('Health check finished');
}
function shBannerHtml(overall, sub) {
  const s = SH_STATUS[overall] || SH_STATUS.degraded;
  return `<div class="sh-banner ${s.tone}"><span class="sh-banner-dot"></span><div><div class="sh-banner-title">${s.label}</div><div>${esc(s.text)}</div><div class="sh-banner-sub">${esc(sub || '')}</div></div></div>`;
}
function shChecksHtml(checks) {
  const groups = [...new Set(checks.map(c => c.group))];
  return `<div class="sh-groups">${groups.map(g => `<div class="ar-section sh-group"><div class="ar-section-title"><span>${esc(g)}</span></div>
    ${checks.filter(c => c.group === g).map(c => { const [tone, word] = SH_CHECK[c.status] || SH_CHECK.warn;
      return `<div class="sh-check"><span class="status ${tone}">${word}</span><div><div class="sh-check-label">${esc(c.label)}</div><div class="sh-check-detail">${esc(c.detail || '')}</div>${c.action ? `<button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="${c.action}">${esc(c.actionLabel)}</button>` : ''}${c.download ? ` <a class="btn btn-ghost btn-sm" style="margin-top:6px" href="api/health.php?action=backup_download&file=${encodeURIComponent(c.download)}">Download</a>` : ''}</div></div>`; }).join('')}
    ${g === 'Business' ? '<div class="ar-note" style="margin-top:8px">Business differences are shown so you can act — BarMS never changes stock or cash figures to make them match.</div>' : ''}
  </div>`).join('')}</div>`;
}

async function loadShIncidents() {
  const rangeEl = document.getElementById('shRange');
  rangeEl.innerHTML = [['today', 'Today'], ['24h', '24 hours'], ['7d', '7 days'], ['30d', '30 days']].map(([k, l]) =>
    `<button class="ar-chip ${SH.range === k ? 'active' : ''}" onclick="SH.range='${k}';loadShIncidents()">${l}</button>`).join('')
    + `<button class="ar-chip ${SH.showResolved ? 'active' : ''}" onclick="SH.showResolved=!SH.showResolved;loadShIncidents()">Include resolved</button>`;
  const body = document.getElementById('shIncidents');
  const res = await apiGet('health', 'incidents', { range: SH.range, status: SH.showResolved ? 'all' : 'active' });
  if (!res.ok) { body.innerHTML = `<tr><td colspan="7" class="ar-empty">${esc(res.error || 'Could not load incidents')}</td></tr>`; return; }
  const sevTone = { critical: 'bad', error: 'bad', warning: 'warn', info: 'info' };
  const stTone = { open: 'bad', recovering: 'info', recovered: 'ok', resolved: 'ok' };
  body.innerHTML = res.data.map(i => `<tr class="clickable" onclick="showShIncident(${+i.id})">
      <td><strong>${esc(i.ref || '')}</strong></td>
      <td>${esc(i.title)}<div class="muted" style="font-size:11px">${esc(i.category)}${i.source ? ' · ' + esc(i.source) : ''}${i.auto_action ? ' · auto: ' + esc(i.auto_action) : ''}</div></td>
      <td><span class="status ${sevTone[i.severity] || 'warn'}">${esc(i.severity)}</span></td>
      <td class="num">${+i.occurrences}</td><td>${i.deviceCount || '—'}</td><td>${esc(i.last_seen)}</td>
      <td><span class="status ${stTone[i.status] || 'warn'}">${esc(i.status)}</span></td></tr>`).join('')
    || `<tr><td colspan="7" class="ar-empty">${SH.showResolved ? 'No incidents in this period' : 'No open incidents in this period'}</td></tr>`;
  const s = res.summary || {};
  document.getElementById('shIncSummary').textContent = `${+s.total || 0} incident(s) in this period · ${+s.recovered || 0} recovered automatically · ${+s.auto || 0} with an automatic recovery attempt.`;
}

async function showShIncident(id) {
  const res = await apiGet('health', 'incident', { id });
  if (!res.ok) { toast(res.error || 'Could not open', 'error'); return; }
  const i = res.data;
  document.getElementById('modalContent').innerHTML = `
    <h3>${esc(i.ref || 'Incident')} — ${esc(i.title)}</h3>
    <div class="sh-meta">${esc(i.category)} · ${esc(i.severity)} · ${esc(i.status)} · ${+i.occurrences} time(s) · first ${esc(i.first_seen)} · last ${esc(i.last_seen)}</div>
    ${i.devices ? `<div class="sh-meta">Devices: ${esc(i.devices)}</div>` : ''}${i.users ? `<div class="sh-meta">Users: ${esc(i.users)}</div>` : ''}
    ${i.auto_action ? `<div class="sh-meta">Automatic action: ${esc(i.auto_action)}</div>` : ''}
    ${i.detail ? `<details class="ar-more"><summary>Technical detail</summary><pre class="sh-pre">${esc(i.detail)}</pre></details>` : ''}
    <div class="sh-history">${(i.events || []).map(e => `<div><span class="muted">${esc(e.created_at)}</span> <strong>${esc(e.kind)}</strong> ${esc(e.note || '')}</div>`).join('')}</div>
    ${i.status !== 'resolved' ? `<div class="form-group" style="margin-top:12px"><label class="form-label">What was done to fix it *</label><input class="form-input" id="shResolveNote"/></div>
      <button class="btn btn-primary" onclick="resolveShIncident(${+i.id})">Mark resolved</button>`
      : `<div class="ar-note">Resolved by ${esc(i.resolved_by || '')} on ${esc(i.resolved_at || '')}: ${esc(i.resolved_note || '')}</div>`}`;
  document.getElementById('modalOverlay').classList.add('show');
}
async function resolveShIncident(id) {
  const note = document.getElementById('shResolveNote').value.trim();
  if (!note) { toast('Write what was done to fix it', 'error'); return; }
  const res = await api('health', 'resolve', { id, note });
  if (!res.ok) { toast(res.error || 'Could not save', 'error'); return; }
  closeModal(); toast('Incident resolved'); loadSystemHealth();
}

// ── top-bar dot (Owner): quick check every 10 minutes ─
function shSetDot(overall) {
  const btn = document.getElementById('healthBtn'), dot = document.getElementById('healthDot');
  if (!btn || !dot) return;
  const s = SH_STATUS[overall] || SH_STATUS.degraded;
  btn.style.display = '';
  const mi = document.getElementById('healthMi'); if (mi) mi.style.display = '';
  dot.className = 'sh-dot ' + s.tone;
  btn.title = 'System health: ' + s.label;
}
async function shTick() {
  if (typeof session === 'undefined' || session.role !== 'Owner') { const b = document.getElementById('healthBtn'); if (b) b.style.display = 'none'; return; }
  if (document.getElementById('appShell')?.style.display === 'none') return;
  if (Date.now() - SH.lastDot < 10 * 60 * 1000) return;
  SH.lastDot = Date.now();
  const res = await apiGet('health', 'status', { full: 0, clientVersion: BARMS_CLIENT_VERSION });
  shSetDot(res.ok ? res.data.overall : 'critical');
  if (res.ok) shAutoBackup(res.data.checks);
}
setTimeout(shTick, 8000);
setInterval(shTick, 60 * 1000);

// Owner: give failed offline items another chance (safe: the server ignores a sale it already has)
async function shRetryFailed() {
  if (!navigator.onLine) { toast('Connect to the internet first', 'error'); return; }
  const q = await dbGetAll('sync_queue');
  const failed = q.filter(i => i.status === 'failed' || (i.status === 'pending' && (i.retryCount || 0) >= 5));
  for (const i of failed) await dbPut('sync_queue', { ...i, status: 'pending', retryCount: 0 });
  await syncPendingItems();
  const left = (await dbGetAll('sync_queue')).filter(i => i.status === 'failed' || (i.retryCount || 0) >= 5).length;
  healthReport('sync', left ? `Manual sync retry: ${left} item(s) still failing` : `Manual sync retry: ${failed.length} item(s) synced`, { severity: left ? 'error' : 'info', source: 'offline queue', autoAction: 'Owner retried failed offline items' });
  toast(left ? `${left} item(s) still could not sync — support may be needed` : 'All items synced', left ? 'warning' : 'success');
  loadSystemHealth();
}

// ── database backup ──────────────────────────────
async function shBackupNow(silent) {
  if (!silent) toast('Making a backup…');
  const res = await api('health', 'backup', {});
  if (!res.ok) { toast(res.error || 'The backup failed', 'error'); return false; }
  if (!silent) toast(`Backup made and verified (${(+res.data.rows).toLocaleString()} rows)`, 'success');
  if (document.getElementById('page-system-health')?.classList.contains('active')) loadSystemHealth();
  return true;
}
// once a day, when the Owner's health check sees no recent backup (the hosting has no scheduler)
async function shAutoBackup(checks) {
  const b = (checks || []).find(c => c.key === 'backup');
  if (!b || !(b.due || b.status !== 'ok')) return;
  const today = new Date().toISOString().slice(0, 10);
  try { if (localStorage.getItem('barms_auto_backup') === today) return; localStorage.setItem('barms_auto_backup', today); } catch (e) {}
  shBackupNow(true);
}