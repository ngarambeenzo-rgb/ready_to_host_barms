/* ═══════════════════════════════════════════════════
   BARMS PRO — support.js
   Help & support: the Owner writes to IMS from BarMS.
   Messages are saved in BarMS and sent to the IMS server,
   which emails the addresses set in IMS → Settings → Email & alerts.
═══════════════════════════════════════════════════ */

const SUP_STATUS = { sent: ['ok', 'Received by IMS'], failed: ['bad', 'Not delivered'], pending: ['warn', 'Sending'] };

async function loadSupport() {
  const list = document.getElementById('supList');
  const res = await apiGet('support', 'list');
  if (!res.ok) { list.innerHTML = uiEmpty('alertcircle', 'Could not load your messages', res.error || ''); return; }
  document.getElementById('supConfigNote').innerHTML = res.configured ? '' :
    `<div class="sup-warn">${ic('alert')}<span>The IMS address is missing (ims_config.json), so messages are saved here but not delivered.</span></div>`;
  const cats = res.categories || {};
  const rows = res.data || [];
  list.innerHTML = rows.length ? rows.map(r => {
    const [tone, label] = SUP_STATUS[r.email_status] || SUP_STATUS.pending;
    return `<div class="sup-item">
      <div class="sup-item-top"><span class="sup-subj">${esc(r.subject)}</span><span class="status ${tone}">${label}</span></div>
      <div class="sup-meta">${esc(cats[r.category] || r.category)} · ${esc(r.created_at)} · ${esc(r.sent_by || '')}</div>
      <div class="sup-msg">${esc(r.message)}</div>
      ${r.email_status === 'sent' && r.email_error ? `<div class="sup-err">${esc(r.email_error)}</div>` : ''}
      ${r.email_status === 'failed' ? `<div class="sup-err">${esc(r.email_error || '')}</div><button class="btn btn-ghost btn-sm" onclick="resendSupport(${+r.id}, this)">${ic('refresh')}Send again</button>` : ''}
    </div>`;
  }).join('') : uiEmpty('inbox', 'No messages yet', 'Messages you send to IMS appear here with their delivery status.');
}

// which IMS client and device this BarMS is (from the activation key)
async function supIds() {
  try { return { clientId: await getClientId(), deviceUuid: await getDeviceUuid() }; } catch (e) { return {}; }
}

async function sendSupport() {
  const btn = document.getElementById('supSendBtn');
  const category = document.getElementById('supCategory').value;
  const subject = document.getElementById('supSubject').value.trim();
  const message = document.getElementById('supMessage').value.trim();
  const contact = document.getElementById('supContact').value.trim();
  if (!subject) { toast('Write a short subject', 'error'); return; }
  if (message.length < 10) { toast('Describe the issue in at least a sentence', 'error'); return; }
  uiBusy(btn, true); btn.disabled = true;
  const res = await api('support', 'send', { category, subject, message, contact, ...(await supIds()) });
  uiBusy(btn, false); btn.disabled = false;
  if (!res.ok) { toast(res.error || 'Could not send', 'error'); return; }
  if (res.emailed && res.emailError) toast(res.emailError, 'warning');
  else if (res.emailed) toast('Message sent to IMS — we will get back to you', 'success');
  else toast('Message saved, but it could not reach IMS yet: ' + (res.emailError || ''), 'warning');
  document.getElementById('supSubject').value = '';
  document.getElementById('supMessage').value = '';
  loadSupport();
}

async function resendSupport(id, btn) {
  uiBusy(btn, true);
  const res = await api('support', 'resend', { id, ...(await supIds()) });
  uiBusy(btn, false);
  toast(res.ok ? 'Message delivered to IMS' : ('Still not delivered: ' + (res.error || '')), res.ok ? 'success' : 'error');
  loadSupport();
}
