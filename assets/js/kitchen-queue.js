/* ═══════════════════════════════════════════════════
   BARMS PRO — kitchen-queue.js
   Smart Kitchen Production Queue
   Depends on: utils.js, api.js, auth.js, navigation.js
═══════════════════════════════════════════════════ */

let _kqPollInterval = null;
let _kqLastOrderIds = new Set();
let _kqStockCache = {};
let _kqRejectTarget = null;
let _kqRejectReason = '';
let _kqAcceptTarget = null;
let _kqRendered = false;
let _kqKnownIds = new Set();
let _kqHtml = {};

function _kqCount(id, n) {
  const el = document.getElementById(id);
  if (!el || el.textContent === String(n)) return;
  el.textContent = n;
  el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
}

// Redraw only columns that changed; tickets that change column glide there (FLIP).
function _kqPatch(cols, isFirst) {
  const changed = Object.keys(cols).filter(id => _kqHtml[id] !== cols[id]);
  if (!changed.length) return;
  const old = {};
  document.querySelectorAll('#page-kitchen-queue .kq-ticket[data-key]').forEach(t => { old[t.dataset.key] = t.getBoundingClientRect(); });
  changed.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = cols[id]; _kqHtml[id] = cols[id]; });
  if (isFirst || UI_REDUCED) return;
  document.querySelectorAll('#page-kitchen-queue .kq-ticket[data-key]').forEach(t => {
    const was = old[t.dataset.key];
    if (!was) { t.classList.add('enter'); return; }
    const now = t.getBoundingClientRect();
    const dx = was.left - now.left, dy = was.top - now.top;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    t.animate([{ transform: `translate(${dx}px,${dy}px)`, boxShadow: '0 12px 28px rgba(45,27,105,.18)' }, { transform: 'none', boxShadow: '0 1px 2px rgba(45,27,105,.05)' }],
      { duration: Math.abs(dx) > 40 ? 360 : 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    if (Math.abs(dx) > 40) t.classList.add('moved');
  });
}

// Busy state on the ticket button that was pressed
function _kqBusy(id, on) {
  document.querySelectorAll(`.kq-ticket[data-key="k${id}"] .kq-btn`).forEach(b => { b.disabled = on; });
  const b = document.querySelector(`.kq-ticket[data-key="k${id}"] .kq-btn.primary`);
  if (b) uiBusy(b, on);
}

// ── ENTRY POINT (called by navigation.js) ──────────
function loadKitchenQueue(){
  renderKitchenQueue();
  if(_kqPollInterval) clearInterval(_kqPollInterval);
  _kqPollInterval = setInterval(renderKitchenQueue, 8000);
}

function stopKitchenQueuePolling(){
  if(_kqPollInterval){ clearInterval(_kqPollInterval); _kqPollInterval=null; }
}

// ── MAIN RENDER ─────────────────────────────────────
async function renderKitchenQueue(){
  const page = document.getElementById('page-kitchen-queue');
  if(!page || !page.classList.contains('active')){ stopKitchenQueuePolling(); return; }

  const res = await apiGet('kitchen_orders','queue');
  if(!res.ok) return;
  const orders = res.data || [];

  // Detect NEW pending orders for popup notification
  const currentIds = new Set(orders.filter(o=>o.status==='pending').map(o=>o.id));
  for(const id of currentIds){
    if(!_kqLastOrderIds.has(id)){
      const o = orders.find(x=>x.id===id);
      if(o && _kqLastOrderIds.size>0){ // skip popup on very first load
        const itemSummary = (o.items||[]).map(it=>`${it.qty}× ${it.product_name}`).join(', ');
        showPopupNotif(`New order #${o.order_number} (${o.table_name||'—'}): ${itemSummary}`,'warning','');
      }
    }
  }
  _kqLastOrderIds = currentIds;

  const pending   = orders.filter(o=>o.status==='pending');
  const preparing = orders.filter(o=>o.status==='accepted'||o.status==='preparing');
  const readyRes  = await apiGet('kitchen_orders','ready_list');
  const ready     = readyRes.ok ? (readyRes.data||[]) : [];

  const isFirst = !_kqRendered;
  if (!isFirst) {
    const before = _kqKnownIds;
    const fresh = pending.filter(o => !before.has('k' + o.id));
    if (fresh.length) playSound('success');
  }
  _kqKnownIds = new Set([...pending, ...preparing, ...ready].map(o => 'k' + o.id));

  _kqCount('kqCountPending', pending.length);
  _kqCount('kqCountPreparing', preparing.length);
  _kqCount('kqCountReady', ready.length);

  const delayedCount = orders.filter(o=>o.is_delayed).length;
  const statsEl = document.getElementById('kqStats');
  statsEl.innerHTML = `
    <span class="kq-stat"><b>${orders.length}</b> active</span>
    ${delayedCount>0?`<span class="kq-stat late"><b>${delayedCount}</b> late</span>`:''}
    <span class="kq-live"><span class="kq-live-dot"></span>Live · updated ${nowTime()}</span>
  `;

  _kqPatch({
    kqColPending:   pending.length   ? pending.map(o=>renderTicket(o,'pending')).join('')   : uiEmpty('inbox','No new orders','New food orders appear here.'),
    kqColPreparing: preparing.length ? preparing.map(o=>renderTicket(o,o.status)).join('') : uiEmpty('flame','Nothing cooking','Accepted orders move here.'),
    kqColReady:     ready.length     ? ready.map(o=>renderReadyTicket(o)).join('')          : uiEmpty('checkcircle','Nothing waiting','Ready orders wait here for pickup.'),
  }, isFirst);
  _kqRendered = true;
  // Fetch stock status for pending orders (for badge)
  pending.forEach(o=>checkAndRenderStock(o.id));
}

function timerClass(remaining,isDelayed){
  if(isDelayed) return 'late';
  if(remaining<=3) return 'warn';
  return 'ok';
}

function renderTicket(o,stage){
  const itemsHtml = (o.items||[]).map(it=>`
    <div class="kq-item-row"><span><span class="kq-item-qty">${it.qty}×</span>${esc(it.product_name)}</span></div>
  `).join('');

  const pct = Math.min(100, Math.round((o.elapsed_minutes / Math.max(1,o.estimated_minutes)) * 100));
  const tClass = timerClass(o.remaining_minutes, o.is_delayed);

  let actions = '';
  if(stage==='pending'){
    actions = `
      <div id="kqStockBadge-${o.id}"></div>
      <div class="kq-actions">
        <button class="kq-btn primary" onclick="kqOpenAccept(${o.id},'${esc(o.order_number)}',${o.estimated_minutes})">${ic('check')}Accept</button>
        <button class="kq-btn ghost" onclick="kqOpenReject(${o.id},'${esc(o.order_number)}')">Reject</button>
      </div>`;
  } else if(stage==='accepted'){
    actions = `<div class="kq-actions"><button class="kq-btn primary" onclick="kqStartPreparing(${o.id})">${ic('flame')}Start preparing</button></div>`;
  } else if(stage==='preparing'){
    actions = `<div class="kq-actions"><button class="kq-btn primary ready" onclick="kqMarkReady(${o.id})">${ic('check')}Mark ready</button></div>`;
  }

  return `
    <div class="kq-ticket ${stage} ${o.is_delayed?'delayed':tClass==='warn'?'soon':''}" data-key="k${o.id}">
      <div class="kq-ticket-top">
        <div class="kq-order-num"><span class="kq-queue-pos" title="Queue position">${o.queue_position}</span>#${esc(o.order_number)}</div>
        <div class="kq-table-badge">${esc(o.table_name||'Takeaway')}</div>
      </div>
      <div class="kq-items">${itemsHtml}</div>
      ${o.customer_note?`<div class="kq-note">${esc(o.customer_note)}</div>`:''}
      <div class="kq-timer">
        ${ic('timer')}<span class="kq-timer-label">${stage==='pending'?'Estimated':'Time'}</span>
        <span class="kq-timer-val ${tClass}">${stage==='pending'?o.estimated_minutes+' min':(o.is_delayed?'+'+(o.elapsed_minutes-o.estimated_minutes)+' min late':o.remaining_minutes+' min left')}</span>
      </div>
      <div class="kq-progress-track"><div class="kq-progress-fill ${tClass}" style="width:${stage==='pending'?0:pct}%"></div></div>
      ${actions}
    </div>`;
}

function renderReadyTicket(o){
  const itemsHtml = (o.items||[]).map(it=>`
    <div class="kq-item-row"><span><span class="kq-item-qty">${it.qty}×</span>${esc(it.product_name)}</span></div>
  `).join('');
  return `
    <div class="kq-ticket ready" data-key="k${o.id}">
      <div class="kq-ticket-top">
        <div class="kq-order-num">#${esc(o.order_number)}</div>
        <div class="kq-table-badge">${esc(o.table_name||'Takeaway')}</div>
      </div>
      <div class="kq-items">${itemsHtml}</div>
      <div class="kq-actions">
        <button class="kq-btn primary" onclick="kqMarkServed(${o.id})">${ic('utensils')}Mark served</button>
      </div>
    </div>`;
}

// ── STOCK CHECK BADGE ───────────────────────────────
async function checkAndRenderStock(kitchenOrderId){
  const res = await apiGet('kitchen_orders','check_stock',{kitchenOrderId});
  const el = document.getElementById(`kqStockBadge-${kitchenOrderId}`);
  if(!el || !res.ok) return;
  const map = {
    can_prepare:   {cls:'kq-stock-ok',      label:'Can Prepare'},
    limited_stock: {cls:'kq-stock-limited', label:'Limited Stock'},
    cannot_prepare:{cls:'kq-stock-bad',     label:'Cannot Prepare'},
  };
  const info = map[res.status] || map.can_prepare;
  el.innerHTML = `<span class="kq-stock-badge ${info.cls}">${info.label}</span>`;
}

// ── ACCEPT (with time-setting modal) ────────────────
function kqOpenAccept(id, orderNumber, suggestedMinutes){
  _kqAcceptTarget = id;
  document.getElementById('modalContent').innerHTML = `
    <h3>Accept Order #${esc(orderNumber)}</h3>
    <p style="font-size:13px;color:var(--muted);margin:8px 0 10px">Confirm or adjust the prep time:</p>
    <div class="form-group">
      <label class="form-label">Minutes</label>
      <input type="number" class="form-input" id="kqAcceptMinutes" value="${suggestedMinutes}" min="1" max="120"/>
    </div>
    <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="kqConfirmAccept()">Confirm & Start Timer</button>`;
  document.getElementById('modalOverlay').classList.add('show');
}

async function kqConfirmAccept(){
  const minutes = +document.getElementById('kqAcceptMinutes')?.value || 0;
  if(!minutes || minutes<1){ toast('Enter a valid time','error'); return; }
  const res = await api('kitchen_orders','accept',{kitchenOrderId:_kqAcceptTarget, estimatedMinutes:minutes});
  if(!res.ok){ toast(res.error||'Error','error'); return; }
  closeModal();
  toast('Order accepted — timer started');
  renderKitchenQueue();
}

// ── REJECT ───────────────────────────────────────────
function kqOpenReject(id, orderNumber){
  _kqRejectTarget = id;
  _kqRejectReason = '';
  document.getElementById('modalContent').innerHTML = `
    <h3>Reject order #${esc(orderNumber)}</h3>
    <p style="font-size:13px;color:var(--muted);margin:8px 0 4px">Select a reason:</p>
    <div class="kq-reject-reasons" id="kqRejectReasons">
      ${['Ingredient Unavailable','Kitchen Overloaded','Equipment Issue','Other'].map(r=>`
        <button type="button" class="kq-reject-reason-btn" data-reason="${r}" onclick="kqSelectReason(this,'${r}')">${r}</button>
      `).join('')}
    </div>
    <button class="btn btn-primary" style="margin-top:10px" onclick="kqConfirmReject()">Confirm Rejection</button>`;
  document.getElementById('modalOverlay').classList.add('show');
}

function kqSelectReason(btn, reason){
  document.querySelectorAll('.kq-reject-reason-btn').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
  _kqRejectReason = reason;
}

async function kqConfirmReject(){
  if(!_kqRejectReason){ toast('Please select a reason','error'); return; }
  const res = await api('kitchen_orders','reject',{kitchenOrderId:_kqRejectTarget, reason:_kqRejectReason});
  if(!res.ok){ toast(res.error||'Error','error'); return; }
  closeModal();
  toast('Order rejected');
  renderKitchenQueue();
}

async function kqStartPreparing(id){
  _kqBusy(id, true);
  const res = await api('kitchen_orders','start_preparing',{kitchenOrderId:id});
  _kqBusy(id, false);
  if(!res.ok){ toast(res.error||'Error','error'); return; }
  toast('Started preparing','info');
  renderKitchenQueue();
}

async function kqMarkReady(id){
  _kqBusy(id, true);
  const res = await api('kitchen_orders','mark_ready',{kitchenOrderId:id});
  _kqBusy(id, false);
  if(!res.ok){ toast(res.error||'Error','error'); return; }
  toast('Marked as ready');
  renderKitchenQueue();
}

async function kqMarkServed(id){
  _kqBusy(id, true);
  const res = await api('kitchen_orders','mark_served',{kitchenOrderId:id});
  _kqBusy(id, false);
  if(!res.ok){ toast(res.error||'Error','error'); return; }
  toast('Marked as served');
  renderKitchenQueue();
}
