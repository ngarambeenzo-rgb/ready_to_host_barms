/* ═══════════════════════════════════════════════════
   BARMS PRO — offline-orders.js
   Orders, payments, receipts, cash shifts and stock without internet (offline devices only).
   When the server cannot be reached, the order screens keep working:
   their api()/apiGet() calls for orders are answered here, in the same
   format as api/orders.php.
   - New orders live on this device (negative ids, numbers OFF-0001…)
     until they are paid; then the whole order is queued as ONE record
     (orders.php action=offline_order) and sent with the payer's token.
   - Bills that were open on the server keep working from the last copy:
     items added, validate and pay are queued as normal order actions.
   - Unfinished device orders move to the server once someone is signed
     in online again.
   Load after api.js, offline.js and perf.js, before the page modules.
═══════════════════════════════════════════════════ */

const OO_STORE = 'offline_orders';
const OO_PROBE_MS = 20000;
let _ooNetDown = false;          // the server could not be reached (cleared by the probe)
const _ooIdMap = {};             // device order id → server order id, once moved

const apiRaw = api;              // the real calls (sync.js sends through these)
const apiGetRaw = apiGet;

// Work locally? Only on an offline device: signed in offline, or the server unreachable.
// Only the main device sells offline (the Owner's device does not: two sellers would clash).
async function ooLocal() {
  if ((await offlineRole()) !== 'main') return false;
  return !!(session && session.offline) || _ooNetDown || navigator.onLine === false;
}
function ooIsNetFail(res) { return res && !res.ok && !res.unconfirmed && (res.network || res.error === 'offline'); }

// ── STORE ─────────────────────────────────────────
async function ooAll() { return (await dbGetAll(OO_STORE)) || []; }
async function ooGet(id) { return dbGet(OO_STORE, Number(id)); }
async function ooPut(o) {
  o.total = o.items.reduce((a, i) => a + i.total, 0);
  await dbPut(OO_STORE, o);
  // already queued to move to the server (not sent yet): send this newer version instead
  const q = (await dbGetAll('sync_queue')).find(x => x.offlineOrderId === o.id && x.status === 'pending');
  if (q && o.status !== 'paid') await dbPut('sync_queue', { ...q, payload: ooSnapshot(o) });
  return o;
}
async function ooNextId() {
  const rec = await dbGet('settings', 'offline_order_seq');
  const n = ((rec && rec.value) || 0) + 1;
  await dbPut('settings', { key: 'offline_order_seq', value: n });
  return n;
}
const ooItemId = () => -(Date.now() * 100 + Math.floor(Math.random() * 100));

// ── QUEUE (sync.js sends these, oldest first) ─────
// _ooKey: the request key of an attempt that may have reached the server — the queued copy
// reuses it, so the server never applies it twice
let _ooKey = null;
async function ooQueue(action, payload, extra = {}) {
  const key = extra.noIdem ? null : _ooKey; _ooKey = null;   // a whole order never takes one
  const item = { clientUuid: newUuid(), type: 'op', resource: 'orders', action, payload, timestamp: new Date().toISOString(), status: 'pending', retryCount: 0, ...offlineStamp(), ...(key ? { idemKey: key } : {}), ...extra };
  await dbPut('sync_queue', item);
  if (typeof updateSyncBadge === 'function') updateSyncBadge();
  return item;
}
async function ooQueued(orderId) {
  return (await dbGetAll('sync_queue')).filter(q => q.type === 'op' && q.resource === 'orders' && q.status !== 'failed' && +(q.payload && q.payload.orderId) === +orderId)
    .sort((a, b) => (a.at || 0) - (b.at || 0));
}

// ── SERVER ORDERS: last copy + what was queued on this device ─
async function ooServerOrder(orderId) {
  const base = await offlineCacheGet('orders', 'get', { orderId });
  if (!base || !base.ok) return null;
  const o = JSON.parse(JSON.stringify(base));
  for (const q of await ooQueued(orderId)) {
    const p = q.payload;
    if (q.action === 'add_item') {
      const line = o.items.find(i => i.source_type === p.sourceType && +i.source_id === +p.sourceId);
      if (line) { line.qty += p.qty; line.total = line.unit_price * line.qty; if (!line._pending) line._grown = true; }
      else o.items.push({ id: q.lineId, _queue: q.clientUuid, _pending: true, product_id: p.sourceId, source_id: p.sourceId, source_type: p.sourceType, product_name: p.name, unit_price: p.price, qty: p.qty, total: p.price * p.qty, category: p.category });
    } else if (q.action === 'update_item') {
      const line = o.items.find(i => i.id === p.itemId); if (line) { line.qty = p.qty; line.total = line.unit_price * p.qty; }
    } else if (q.action === 'remove_item') {
      o.items = o.items.filter(i => i.id !== p.itemId);
    } else if (q.action === 'save_note') { o.order.note = p.note;
    } else if (q.action === 'validate') { o.order.status = 'validated'; if (p.note != null) o.order.note = p.note;
    } else if (q.action === 'pay') { o.order.status = 'paid'; o.order.paymentMethod = p.paymentMethod;
    } else if (q.action === 'refund') {
      for (const it of p.items || []) { const line = o.items.find(i => i.id === it.orderItemId); if (line) line.refunded_qty = (line.refunded_qty || 0) + it.qty; }
      o.order.refundedTotal = (o.order.refundedTotal || 0) + (q.amount || 0);
    }
  }
  o.total = o.items.reduce((a, i) => a + (+i.total || 0), 0);
  o.order.total = o.total;
  o.order.offline = true;
  return o;
}

// ── DEVICE ORDER → api/orders.php "get" answer ────
function ooAsGet(o) {
  return {
    ok: true, offline: true,
    order: { orderId: o.id, orderNumber: o.offlineRef, offlineRef: o.offlineRef, type: o.type, tableId: o.tableId, tableName: o.tableName, status: o.status, voided: false,
             note: o.note || '', total: o.total, paidAt: o.paidAt ? new Date(o.paidAt).toISOString() : null, discount: o.discount || 0, discountReason: o.discountReason || null,
             paymentMethod: o.paymentMethod || null, refundedTotal: 0, offline: true },
    refunds: [], items: o.items.map(i => ({ ...i })), total: o.total,
  };
}
function ooAsListRow(o) {
  return { id: o.id, orderNumber: o.offlineRef, order_number: o.offlineRef, type: o.type, tableName: o.tableName, table_name: o.tableName, status: o.status,
           total: o.total, itemCount: o.items.length, createdBy: o.createdByName || '', createdAt: new Date(o.createdAt).toISOString(), paidAt: o.paidAt ? new Date(o.paidAt).toISOString() : null,
           refundedTotal: 0, payment_method: o.paymentMethod || null, offline: true };
}

// ── THE WHOLE ORDER AS ONE RECORD (orders.php action=offline_order) ─
function ooSnapshot(o) {
  return {
    clientUuid: o.clientUuid, offlineRef: o.offlineRef, type: o.type, tableId: o.tableId || 0, tableName: o.tableName || '', note: o.note || '', status: o.status,
    createdAt: o.createdAt, validatedAt: o.validatedAt || null, paidAt: o.paidAt || null, createdBy: o.createdBy, validatedBy: o.validatedBy || null, paidBy: o.paidBy || null,
    items: o.items.map(i => ({ sourceType: i.source_type, sourceId: i.source_id, name: i.product_name, price: i.unit_price, category: i.category, qty: i.qty })),
    pay: o.pay || null,
  };
}

// ── DISCOUNTS (same rules as discountOptionsForOrder in api/discount_lib.php) ─
function ooDiscountOptions(items, rules) {
  const out = [];
  for (const r of rules) {
    let amount = 0; const lines = [];
    for (const it of items) {
      const type = it.source_type === 'kitchen' ? 'kitchen' : 'bar';
      if (type !== r.sourceType || +it.source_id !== +r.sourceId) continue;
      const lineTotal = +it.total;
      const off = r.kind === 'percent' ? Math.round(lineTotal * r.value) / 100 : Math.min(lineTotal, Math.round(r.value * it.qty * 100) / 100);
      if (off <= 0) continue;
      amount += off; lines.push(it.id);
    }
    if (amount > 0) out.push({ id: r.id, name: r.name, kind: r.kind, value: r.value, amount: Math.round(amount * 100) / 100, lines, item: items[0] ? items[0].product_name : '' });
  }
  out.sort((a, b) => b.amount - a.amount);
  const used = []; const final = [];
  for (const o of out) { if (o.lines.some(l => used.includes(l))) continue; used.push(...o.lines); final.push(o); }
  return final;
}

// May the person signed in now tick the Owner's discounts? (canApplyDiscounts in discount_lib.php)
function ooCanDiscount(rules) {
  if (!rules) return false;
  const pol = rules.policy || {};
  return session.role === 'Owner' || (session.role === 'Manager' && !!pol.manager) || (session.role === 'Bartender' && !!pol.bartender);
}

// ── ANSWERS FOR THE ORDER SCREENS ─────────────────
async function ooHandleGet(resource, action, params, role) {
  const ov = await ooListOverlay(resource, action);
  if (ov) return ov;
  if (role !== 'main') return null;
  if (resource === 'shifts' && action === 'current') return ooHandleShift('current', params);
  if (resource === 'attendance' && action === 'current') return ooHandleAttendance('current', params);
  if (resource === 'orders' && action === 'get') {
    const id = +params.orderId;
    if (id < 0) {
      if (_ooIdMap[id]) return apiGet('orders', 'get', { orderId: _ooIdMap[id] });
      const o = await ooGet(id);
      return o ? ooAsGet(o) : { ok: false, error: 'Order not found on this device' };
    }
    return (await ooServerOrder(id)) || { ok: false, offline: true, error: 'No internet, and this order was not opened on this device before. It can be finished when the internet is back.' };
  }
  if (resource === 'orders' && action === 'list') {
    const status = params.status || 'open';
    const mine = (await ooAll()).filter(o => status === 'all' || (status === 'open' ? o.status !== 'paid' : o.status === 'paid')).map(ooAsListRow);
    const cached = await offlineCacheGet('orders', 'list', params);
    const rows = [];
    for (const r of (cached && cached.data) || []) {
      const s = await ooServerOrder(r.id);
      if (s) { if (status === 'open' && s.order.status === 'paid') continue; rows.push({ ...r, status: s.order.status, total: s.total, itemCount: s.items.length }); }
      else rows.push(r);
    }
    return { ok: true, offline: true, data: [...mine.reverse(), ...rows] };
  }
  if (resource === 'kitchen_orders' && action === 'order_status') {
    // the kitchen screen cannot be reached offline: staff tell the kitchen themselves
    return { ok: true, offline: true, hasKitchenOrder: false };
  }
  if (resource === 'discounts' && action === 'options') {
    const ord = await ooHandleGet('orders', 'get', { orderId: params.orderId }, 'main');
    const rules = await offlineCacheGet('discounts', 'offline_rules', {});
    if (!ord.ok || !rules) return { ok: true, offline: true, data: [], canApply: false, canFree: session.role === 'Owner' };
    return { ok: true, offline: true, data: ooDiscountOptions(ord.items, rules.data || []), canApply: ooCanDiscount(rules), canFree: session.role === 'Owner' };
  }
  if (resource === 'sessions' && action === 'list_tables') {
    const cached = await offlineCacheGet('sessions', 'list_tables', params);
    if (!cached) return null;
    const open = (await ooAll()).filter(o => o.status !== 'paid' && o.type === 'dinein' && o.tableId);
    const data = (cached.data || []).map(t => {
      const o = open.find(x => +x.tableId === +t.id);
      return o ? { ...t, status: 'occupied', orderId: o.id, orderNumber: o.offlineRef, orderItemCount: o.items.length, orderTotal: o.total } : t;
    });
    return { ...cached, data };
  }
  return null;   // not an order screen read: the normal offline copy is used
}

async function ooHandlePost(resource, action, p) {
  if (resource === 'shifts') return ooHandleShift(action, p);
  if (resource === 'attendance') return ooHandleAttendance(action, p);
  if (resource === 'misc' && action === 'void_request_submit') {
    // the Owner (or an allowed manager) approves it online later
    if (p.type === 'order' && +p.refId < 0) return { ok: false, error: 'This order is still on this device. A void can be requested once it has reached the server.' };
    if (!p.refId || !String(p.label || '').trim()) return { ok: false, error: 'Invalid request' };
    if (!String(p.reason || '').trim()) return { ok: false, error: 'A reason is required' };
    await ooQueue('void_request_submit', { ...p }, { resource: 'misc' });
    return { ok: true, offline: true, id: 0 };
  }
  if (resource !== 'orders') return null;
  const who = { id: session.userId, name: session.fullName };
  const local = p.orderId != null && +p.orderId < 0;

  if (action === 'create') {
    const n = await ooNextId();
    const ref = 'OFF-' + String(n).padStart(4, '0');
    const o = { id: -n, clientUuid: newUuid(), offlineRef: ref, type: p.type === 'takeaway' ? 'takeaway' : 'dinein', tableId: p.type === 'takeaway' ? 0 : (+p.tableId || 0),
                tableName: p.type === 'takeaway' ? 'Takeaway ' + ref : (p.tableName || ''), status: 'draft', note: '', items: [], total: 0,
                createdAt: offlineNow(), createdBy: who.id, createdByName: who.name };
    await ooPut(o);
    return { ok: true, offline: true, orderId: o.id, orderNumber: ref };
  }

  // a line on a device order, or a line added offline to a server bill (still in the queue)
  const lineOwner = async itemId => {
    for (const o of await ooAll()) { const i = o.items.find(x => x.id === itemId); if (i) return { o, i }; }
    return null;
  };

  if (action === 'add_item') {
    if (local) {
      const o = await ooGet(p.orderId);
      if (!o || o.status !== 'draft') return { ok: false, error: 'Order is already validated' };
      const line = o.items.find(i => i.source_type === p.sourceType && +i.source_id === +p.sourceId);
      if (line) { line.qty += p.qty; line.total = line.unit_price * line.qty; }
      else o.items.push({ id: ooItemId(), product_id: p.sourceId, source_id: p.sourceId, source_type: p.sourceType, product_name: p.name, unit_price: +p.price, qty: p.qty, total: +p.price * p.qty, category: p.category, added_by: who.name });
      await ooPut(o);
      return { ok: true, offline: true };
    }
    const s = await ooServerOrder(p.orderId);
    if (!s) return { ok: false, error: 'No internet, and this order was not opened on this device before.' };
    if (s.order.status !== 'draft') return { ok: false, error: 'Order is already validated' };
    await ooQueue('add_item', { ...p }, { lineId: ooItemId() });
    return { ok: true, offline: true };
  }

  if (action === 'update_item' || action === 'remove_item') {
    const found = await lineOwner(p.itemId);
    if (found) {
      if (found.o.status !== 'draft') return { ok: false, error: 'Items can only be changed before the order is validated' };
      if (action === 'remove_item') found.o.items = found.o.items.filter(i => i.id !== p.itemId);
      else { found.i.qty = p.qty; found.i.total = found.i.unit_price * p.qty; }
      await ooPut(found.o);
      return { ok: true, offline: true };
    }
    // a line of a server bill: an item still waiting in the queue is changed there
    const q = (await dbGetAll('sync_queue')).find(x => x.type === 'op' && x.action === 'add_item' && x.status === 'pending' && x.lineId === p.itemId);
    if (q) {
      if (action === 'remove_item') await dbDelete('sync_queue', q.clientUuid);
      else await dbPut('sync_queue', { ...q, payload: { ...q.payload, qty: p.qty } });
      return { ok: true, offline: true };
    }
    // an item that was already on the bill: the server checks it is still a draft
    const mine = 'all|orders|get|';   // the shared copies of bills (offline.js OFFLINE_SHARED)
    const owner = (await dbGetAll('read_cache')).filter(r => String(r.key).startsWith(mine)).map(r => r.data).find(d => d && d.order && (d.items || []).some(i => i.id === p.itemId));
    const bill = owner && await ooServerOrder(owner.order.orderId);
    if (!bill) return { ok: false, error: 'No internet, and this item cannot be found on this device.' };
    if (bill.order.status !== 'draft') return { ok: false, error: 'Items can only be changed before the order is validated' };
    await ooQueue(action, { ...p, orderId: owner.order.orderId });
    return { ok: true, offline: true };
  }

  if (action === 'save_note') {
    if (local) { const o = await ooGet(p.orderId); if (o) { o.note = p.note; await ooPut(o); } return { ok: true, offline: true }; }
    await ooQueue('save_note', { ...p });
    return { ok: true, offline: true };
  }

  if (action === 'validate') {
    if (local) {
      const o = await ooGet(p.orderId);
      if (!o) return { ok: false, error: 'Order not found' };
      if (o.status !== 'draft') return { ok: true, alreadyDone: true, status: o.status };
      if (!o.items.length) return { ok: false, error: 'No items in order' };
      Object.assign(o, { status: 'validated', note: p.note || o.note, validatedAt: offlineNow(), validatedBy: who.id });
      await ooPut(o);
      for (const i of o.items) if (i.source_type === 'bar') await ooLedgerAdd('bar_item', i.source_id, -i.qty);
    } else {
      const s = await ooServerOrder(p.orderId);
      if (!s) return { ok: false, error: 'No internet, and this order was not opened on this device before.' };
      if (s.order.status !== 'draft') return { ok: true, alreadyDone: true, status: s.order.status };
      if (!s.items.length) return { ok: false, error: 'No items in order' };
      await ooQueue('validate', { ...p });
      for (const i of s.items) if (i.source_type === 'bar') await ooLedgerAdd('bar_item', i.source_id, -i.qty);
    }
    ooTellKitchen(p.orderId);
    return { ok: true, offline: true };
  }

  if (action === 'pay') {
    const ord = await ooHandleGet('orders', 'get', { orderId: p.orderId }, 'main');
    if (!ord.ok) return ord;
    if (ord.order.status === 'paid') return { ok: true, alreadyDone: true, orderId: p.orderId, orderNumber: ord.order.orderNumber, discount: ord.order.discount, paid: ord.total - ord.order.discount };
    if (ord.order.status !== 'validated') return { ok: false, error: 'Order must be validated before payment' };
    // discounts are worked out the same way the server will
    const rules = await offlineCacheGet('discounts', 'offline_rules', {});
    const extra = Math.round(+p.discount || 0);
    if (extra < 0) return { ok: false, error: 'Discount cannot be negative' };
    if (extra > 0 && session.role !== 'Owner') return { ok: false, error: 'Only the Owner can give a discount that is not set up in Settings → Discounts' };
    if (extra > 0 && !String(p.discountReason || '').trim()) return { ok: false, error: 'Give a reason for the discount' };
    const ruleIds = (p.discountRules || []).map(Number);
    if (ruleIds.length && !ooCanDiscount(rules)) return { ok: false, error: 'You are not allowed to apply discounts. Ask the Owner.' };
    const opts = ruleIds.length ? ooDiscountOptions(ord.items, (rules && rules.data) || []).filter(o => ruleIds.includes(o.id)) : [];
    const discount = Math.round((opts.reduce((a, o) => a + o.amount, 0) + extra) * 100) / 100;
    if (discount > ord.total) return { ok: false, error: 'Discount cannot be more than the order total' };
    const reason = [opts.map(o => o.name).join(', '), extra > 0 ? String(p.discountReason).trim() : ''].filter(Boolean).join('; ');
    const paid = ord.total - discount;
    const pay = { paymentMethod: p.paymentMethod || 'Cash', customerPhone: p.customerPhone || '', discount: extra, discountReason: p.discountReason || '', discountRules: ruleIds, expectPaid: paid };
    if (+p.orderId < 0) {
      const o = await ooGet(p.orderId);
      Object.assign(o, { status: 'paid', paidAt: offlineNow(), paidBy: who.id, pay, discount, discountReason: reason, paymentMethod: pay.paymentMethod });
      await ooPut(o);
      // the whole order goes up as one record, with the payer's token
      await ooQueue('offline_order', ooSnapshot(o), { noIdem: true, offlineOrderId: o.id });
    } else {
      await ooQueue('pay', { orderId: +p.orderId, ...pay });
    }
    await ooShiftAdd(pay.paymentMethod, paid);
    return { ok: true, offline: true, orderId: p.orderId, orderNumber: ord.order.orderNumber, discount, discountReason: reason, paid };
  }

  if (action === 'refund' || action === 'refund_request') {
    if (+p.orderId < 0) return { ok: false, error: 'This order is still on this device. It can be refunded once it has reached the server (when the internet is back).' };
    const s = await ooServerOrder(p.orderId);
    if (!s) return { ok: false, error: 'No internet, and this order was not opened on this device before.' };
    if (s.order.status !== 'paid') return { ok: false, error: 'Only paid orders can be refunded' };
    if (!String(p.reason || '').trim()) return { ok: false, error: 'A reason is required' };
    if (!(p.items || []).length) return { ok: false, error: 'Choose what to refund' };
    let amount = 0;
    for (const it of p.items) {
      const line = s.items.find(i => i.id === it.orderItemId);
      if (!line) return { ok: false, error: 'An item on the refund was not found on this order' };
      const left = line.qty - (line.refunded_qty || 0);
      if (!(it.qty > 0) || it.qty > left) return { ok: false, error: `Only ${left} ${line.product_name} can still be refunded` };
      amount += it.qty * line.unit_price;
    }
    amount = Math.round(amount * 100) / 100;
    await ooQueue(action, { ...p }, { amount });
    if (action === 'refund') {
      if ((p.method || 'Cash') === 'Cash') await ooShiftAdd('Cash', amount, 'refunds');
      for (const it of p.items) { const line = s.items.find(i => i.id === it.orderItemId); if (it.restock && line.source_type === 'bar') await ooLedgerAdd('bar_item', line.source_id, it.qty); }
    }
    return { ok: true, offline: true, amount };
  }

  if (action === 'send_sms') return { ok: false, error: 'SMS receipts need internet' };
  return { ok: false, error: 'This needs internet' };
}

function ooTellKitchen(orderId) {
  ooHandleGet('orders', 'get', { orderId }, 'main').then(o => {
    if (o.ok && o.items.some(i => (i.category || '').toLowerCase() === 'kitchen' || i.source_type === 'kitchen')) {
      setTimeout(() => toast('No internet: the kitchen screen cannot see this order. Tell the kitchen yourself.', 'warning'), 600);
    }
  });
}

// ── CASH SHIFTS OFFLINE (stage 3) ─────────────────
// The person's shift as this device knows it: one opened offline, or the one open on the server
// at the last copy. Payments made offline are added to its running total here, so the expected
// cash stays right even after those orders have synced. The server works the shift out again
// from the real records when the open / payments / close reach it (oldest first).
const ooShiftKey = uid => 'offline_shift:' + uid;
const ooZeroCash = () => ({ cashSales: 0, otherPayments: 0, mixedPayments: 0, orders: 0, supplierPayments: 0, expenses: 0, refunds: 0, othersOrders: 0, othersCash: 0 });
const ooShiftRef = sh => sh.clientUuid || 'srv:' + sh.serverShiftId;   // which shift a device record is

async function ooShiftCurrent() {
  const rec = await dbGet('settings', ooShiftKey(session.userId));
  if (rec) return rec.closed ? null : rec;
  const cached = await offlineCacheGet('shifts', 'current', {});
  if (cached && cached.shift) {
    const s = cached.shift;
    return { key: ooShiftKey(session.userId), serverShiftId: s.id, openedAt: s.openedAt, openingFloat: s.openingFloat, device: s.device, base: s.cash, offline: ooZeroCash() };
  }
  return null;
}

function ooShiftCash(sh) {
  const b = sh.base || { openingFloat: sh.openingFloat, cashSales: 0, debtCollections: 0, cashIn: 0, refunds: 0, expenses: 0, supplierPayments: 0, cashOut: 0,
                         mixedPayments: 0, otherPayments: 0, orders: 0, expected: sh.openingFloat };
  const o = sh.offline || ooZeroCash();
  const r = x => Math.round(x * 100) / 100;
  const out = (o.supplierPayments || 0) + (o.expenses || 0) + (o.refunds || 0);
  return { ...b, cashSales: r(b.cashSales + o.cashSales), otherPayments: r(b.otherPayments + o.otherPayments), mixedPayments: r(b.mixedPayments + o.mixedPayments),
           supplierPayments: r(b.supplierPayments + (o.supplierPayments || 0)), expenses: r(b.expenses + (o.expenses || 0)), refunds: r(b.refunds + (o.refunds || 0)),
           orders: b.orders + o.orders, expected: r(b.expected + o.cashSales - out), offline: true,
           othersOrders: (b.othersOrders || 0) + (o.othersOrders || 0), othersCash: r((b.othersCash || 0) + (o.othersCash || 0)) };
}

// Other people's shifts that are open, as this device knows them: shifts opened on this device
// (even offline) and the ones that were open at the last online copy. A Bartender or Manager with no
// shift of their own takes payments in the latest of these (the server does the same when it
// receives the payment, by the time of the payment), so the screen can say whose it is.
async function ooOthersOpen() {
  const me = session.userId, out = [], seen = new Set(), closed = new Set();
  const add = s => { const k = s.userName + '|' + s.openedAt; if (s.userName && !seen.has(k)) { seen.add(k); out.push(s); } };
  const recs = (await dbGetAll('settings')).filter(r => String(r.key || '').startsWith('offline_shift:') && r.key !== ooShiftKey(me));
  for (const r of recs) { if (r.closed) { if (r.userName) closed.add(r.userName); } else add({ id: r.serverShiftId || 0, userName: r.userName || '', openedAt: r.openedAt, local: true }); }
  const cached = await offlineCacheGet('shifts', 'current', {});
  for (const o of (cached && cached.others) || []) if (!closed.has(o.userName)) add({ id: o.id, userName: o.userName, openedAt: o.openedAt });
  return out.sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt)));
}

async function ooShiftAnswer(sh) {
  return { ok: true, offline: true, shift: sh ? { id: sh.serverShiftId || 0, openedAt: sh.openedAt, openingFloat: sh.openingFloat, device: sh.device, userName: sh.userName || session.fullName, cash: ooShiftCash(sh) } : null,
           others: await ooOthersOpen() };
}

// money taken or paid out offline goes into the person's shift total. With no shift of their own, a
// payment is counted in the latest other shift kept on this device (marked as paid by others);
// cash paid out (expenses, suppliers) is never added to someone else's drawer.
// kind: 'sale' (a payment taken), 'supplierPayments' or 'expenses' (cash paid out)
async function ooShiftAdd(method, amount, kind = 'sale') {
  let sh = await ooShiftCurrent(), byOthers = false;
  if (!sh && kind === 'sale' && ['Bartender', 'Manager'].includes(session.role)) {
    const target = (await ooOthersOpen()).find(o => o.local);
    const rec = target && (await dbGetAll('settings')).find(r => String(r.key || '').startsWith('offline_shift:') && !r.closed && r.userName === target.userName && r.openedAt === target.openedAt);
    if (rec) { sh = rec; byOthers = true; }
  }
  if (!sh) return;
  sh.offline = { ...ooZeroCash(), ...(sh.offline || {}) };
  if (kind !== 'sale') { if (method === 'Cash') { sh.offline[kind] += amount; await dbPut('settings', sh); } return; }
  if (method === 'Cash') sh.offline.cashSales += amount;
  else if (method === 'Mixed') sh.offline.mixedPayments += amount;
  else sh.offline.otherPayments += amount;
  sh.offline.orders++;
  if (byOthers) { sh.offline.othersOrders++; if (method === 'Cash') sh.offline.othersCash += amount; }
  await dbPut('settings', sh);
}

async function ooHandleShift(action, p) {
  if (action === 'current') return ooShiftAnswer(await ooShiftCurrent());
  if (action === 'open') {
    if (await ooShiftCurrent()) return { ok: false, error: 'You already have an open shift. Close it first.' };
    const float = Math.round((+p.openingFloat || 0) * 100) / 100;
    if (float < 0) return { ok: false, error: 'Opening cash cannot be negative' };
    const now = new Date(offlineNow());
    const pad = n => String(n).padStart(2, '0');
    const rec = { key: ooShiftKey(session.userId), clientUuid: newUuid(), serverShiftId: null, userName: session.fullName, openingFloat: float, device: p.device || '',
                  openedAt: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
                  base: null, offline: ooZeroCash() };
    await dbPut('settings', rec);
    await ooQueue('open', { openingFloat: float, device: rec.device, clientUuid: rec.clientUuid }, { resource: 'shifts' });
    return { ok: true, offline: true, id: 0 };
  }
  if (action === 'close') {
    const sh = await ooShiftCurrent();
    if (!sh) return { ok: false, error: 'You have no open shift' };
    if (p.countedCash === '' || p.countedCash == null || +p.countedCash < 0) return { ok: false, error: 'Count the cash in the drawer and enter the amount' };
    const counted = Math.round(+p.countedCash * 100) / 100;
    const expected = ooShiftCash(sh).expected;
    const diff = Math.round((counted - expected) * 100) / 100;
    const note = String(p.note || '').trim().slice(0, 255);
    if (Math.abs(diff) >= 0.01 && !note) return { ok: false, error: 'The count differs from what is expected — add a note explaining it', expected, difference: diff };
    await ooQueue('close', { countedCash: counted, note, shiftUuid: sh.clientUuid || null, expectedOffline: expected }, { resource: 'shifts', shiftRef: ooShiftRef(sh) });
    await dbPut('settings', { ...sh, closed: true });
    return { ok: true, offline: true, expected, counted, difference: diff };
  }
  return null;
}

// signed in online again: the server's shift is the truth once nothing about it is waiting
async function ooShiftCleanup() {
  const waiting = (await dbGetAll('sync_queue')).some(q => q.resource === 'shifts' && q.userId === session.userId && q.status !== 'failed');
  if (!waiting) await dbDelete('settings', ooShiftKey(session.userId));
}

// ── WORK ATTENDANCE OFFLINE ───────────────────────
// "Start work" / "End work" without internet: kept on this device with the real (clock-corrected)
// time and sent when the internet is back; the server stamps them with that time, works out
// lateness from it, and ignores a start it already has (the device's clientUuid).
const ooAttKey = uid => 'offline_att:' + uid;
const ooAttPad = n => String(n).padStart(2, '0');
const ooAttStamp = ms => { const d = new Date(ms); return `${d.getFullYear()}-${ooAttPad(d.getMonth() + 1)}-${ooAttPad(d.getDate())} ${ooAttPad(d.getHours())}:${ooAttPad(d.getMinutes())}:${ooAttPad(d.getSeconds())}`; };

function ooAttRow(rec) {
  const mins = Math.max(0, Math.floor((offlineNow() - rec.startedMs) / 60000));
  return { id: 0, userId: session.userId, user: session.fullName, role: session.role, startedAt: rec.startedAt, endedAt: null, status: 'open', expectedStart: rec.expected || null,
           lateMinutes: rec.lateMinutes, device: rec.device || null, startNote: rec.note || null, endNote: null, endedBy: null, minutes: mins, stale: mins >= 18 * 60 };
}

// the person's work as this device knows it: started here, or open on the server at the last copy
async function ooAttState() {
  const rec = await dbGet('settings', ooAttKey(session.userId));
  if (rec) return { rec, open: !rec.closed, expected: rec.expected || null };
  const cached = await offlineCacheGet('attendance', 'current', {});
  const a = cached && cached.attendance;
  return { rec: null, open: !!(a && a.status === 'open'), server: a && a.status === 'open' ? { ...a, minutes: a.minutes + Math.floor((Date.now() - cached.cachedAt) / 60000) } : null, expected: (cached && cached.expectedStart) || null };
}

async function ooHandleAttendance(action, p) {
  const st = await ooAttState();
  if (action === 'current') {
    if (st.rec) return { ok: true, offline: true, canClock: true, expectedStart: st.expected, attendance: st.open ? ooAttRow(st.rec) : null };
    return null;   // nothing started on this device: the last copy of the server's answer is used
  }
  if (action === 'start') {
    if (st.open) {
      const at = st.rec ? st.rec.startedAt : st.server.startedAt;
      return { ok: false, error: 'You already started work at ' + String(at).slice(11, 16) + '. End it first.', alreadyStarted: true };
    }
    const nowMs = offlineNow();
    const stamp = ooAttStamp(nowMs);
    const rec = { key: ooAttKey(session.userId), clientUuid: p.clientUuid || newUuid(), startedMs: nowMs, startedAt: stamp, expected: st.expected, lateMinutes: typeof attLateMinutes === 'function' ? attLateMinutes(st.expected, stamp) : null,
                  device: p.device || '', note: String(p.note || '').slice(0, 255), closed: false };
    await dbPut('settings', rec);
    await ooQueue('start', { device: rec.device, note: rec.note, clientUuid: rec.clientUuid }, { resource: 'attendance' });
    return { ok: true, offline: true, id: 0, lateMinutes: rec.lateMinutes || 0, startedAt: stamp };
  }
  if (action === 'end') {
    const note = String(p.note || '').trim().slice(0, 255);
    if (st.rec && st.open) {   // started on this device
      const minutes = Math.max(0, Math.round((offlineNow() - st.rec.startedMs) / 60000));
      await ooQueue('end', { note, attendanceUuid: st.rec.clientUuid }, { resource: 'attendance' });
      await dbPut('settings', { ...st.rec, closed: true });
      return { ok: true, offline: true, minutes };
    }
    if (st.server) {   // started online before the connection dropped: the server ends the one it has open
      await ooQueue('end', { note }, { resource: 'attendance' });
      await dbPut('settings', { key: ooAttKey(session.userId), clientUuid: null, startedMs: 0, startedAt: st.server.startedAt, expected: st.expected, closed: true });
      return { ok: true, offline: true, minutes: Math.max(0, st.server.minutes) };
    }
    return { ok: false, error: 'You have not started work' };
  }
  return null;
}

// signed in online again: the server is the truth once nothing about attendance is waiting
async function ooAttCleanup() {
  const waiting = (await dbGetAll('sync_queue')).some(q => q.resource === 'attendance' && q.userId === session.userId && q.status !== 'failed');
  if (!waiting) await dbDelete('settings', ooAttKey(session.userId));
}

// ── STOCK AND SUPPLIER PAYMENTS OFFLINE (stage 4) ─
// Deliveries, breakage, kitchen waste, stock counts and supplier payments are queued as normal
// actions; the server replays them oldest first with their original time (a count is compared
// with the stock at the time of counting). The main device does all of them; the Owner's device
// records deliveries and supplier payments.
const OO_STOCK = {
  'bar-inventory': ['item_add_stock', 'ingredient_receive', 'record_breakage'],
  kitchen2: ['stock_receive', 'stock_adjust'],
  stockcount: ['save'],
  suppliers: ['pay'],
};
const ooIsStock = (resource, action) => (OO_STOCK[resource] || []).includes(action);
function ooStockAllowed(role, action) {
  if (role === 'main') return true;
  return role === 'owner' && ['item_add_stock', 'ingredient_receive', 'stock_receive', 'pay'].includes(action);
}

// Stock changes made offline, so the stock lists show them (display only — the server keeps
// the real figures). Emptied when a fresh list arrives and nothing is waiting to be sent.
const OO_LISTS = { bar_item: ['bar-inventory', 'items_list', 'stock'], bar_ingredient: ['bar-inventory', 'ingredients_list', 'quantity'],
                   kitchen_ingredient: ['kitchen2', 'ingredients_list', 'quantity'] };
async function ooLedger() { return ((await dbGet('settings', 'offline_stock_delta')) || { v: {} }).v; }
async function ooLedgerAdd(list, id, delta) {
  const rec = (await dbGet('settings', 'offline_stock_delta')) || { key: 'offline_stock_delta', v: {} };
  const k = list + ':' + id;
  rec.v[k] = Math.round(((rec.v[k] || 0) + delta) * 1000) / 1000;
  await dbPut('settings', rec);
}
async function ooListOverlay(resource, action) {
  const list = Object.keys(OO_LISTS).find(k => OO_LISTS[k][0] === resource && OO_LISTS[k][1] === action);
  if (!list) return null;
  const cached = await offlineCacheGet(resource, action, {});
  if (!cached) return null;
  const led = await ooLedger(), col = OO_LISTS[list][2];
  return { ...cached, data: (cached.data || []).map(r => led[list + ':' + r.id] ? { ...r, [col]: Math.round(((+r[col] || 0) + led[list + ':' + r.id]) * 1000) / 1000 } : r) };
}
async function ooLedgerMaybeClear() {
  const waiting = (await dbGetAll('sync_queue')).some(q => q.type === 'op' && q.status === 'pending' && (q.resource === 'orders' || ooIsStock(q.resource, q.action)));
  if (!waiting && !(await ooAll()).length) await dbDelete('settings', 'offline_stock_delta');
}

async function ooHandleStock(resource, action, p) {
  const r2 = x => Math.round(x * 100) / 100;
  const answer = { ok: true, offline: true };
  if (['item_add_stock', 'ingredient_receive', 'stock_receive'].includes(action)) {
    const qty = +p.qty, cost = +p.unitCost;
    if (!(qty > 0) || !(cost > 0)) return { ok: false, error: 'Item, quantity, and purchase cost per unit are required' };
    if (p.purchaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(p.purchaseDate)) return { ok: false, error: 'Enter a valid purchase date' };
    const total = r2(qty * cost);
    const paid = p.amountPaid === '' || p.amountPaid == null ? total : r2(+p.amountPaid);
    if (paid < 0) return { ok: false, error: 'Amount paid cannot be negative' };
    if (paid > total + 0.001) return { ok: false, error: `Amount paid cannot be more than the purchase total (RWF ${total.toLocaleString()})` };
    if (paid < total - 0.001 && !String(p.supplier || '').trim()) return { ok: false, error: 'Enter the supplier — the unpaid part is recorded as money owed to them' };
    answer.purchaseTotal = total;
    const list = action === 'item_add_stock' ? 'bar_item' : action === 'ingredient_receive' ? 'bar_ingredient' : 'kitchen_ingredient';
    await ooLedgerAdd(list, action === 'item_add_stock' ? p.id : p.ingId, qty);
    if ((p.paymentMethod || 'Cash') === 'Cash' && paid > 0) await ooShiftAdd('Cash', paid, 'supplierPayments');
  } else if (action === 'record_breakage') {
    if (!p.targetType || !p.targetId || !(+p.qty > 0) || !String(p.reason || '').trim()) return { ok: false, error: 'All fields required' };
    await ooLedgerAdd(p.targetType === 'item' ? 'bar_item' : 'bar_ingredient', p.targetId, -p.qty);
  } else if (action === 'stock_adjust') {
    if (!p.ingId || !+p.qty) return { ok: false, error: 'Ingredient and quantity are required' };
    await ooLedgerAdd('kitchen_ingredient', p.ingId, +p.qty);
  } else if (action === 'save') {   // stock count
    const lines = (p.lines || []).filter(l => l.counted !== '' && l.counted != null);
    if (!lines.length) return { ok: false, error: 'Enter at least one counted quantity' };
    if (lines.some(l => +l.counted < 0)) return { ok: false, error: 'Counted quantities cannot be negative' };
    if (p.date && !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return { ok: false, error: 'Enter a valid date' };
    Object.assign(answer, { id: 0, items: lines.length, varianceValue: 0, applied: !!p.apply });
    if (p.apply && OO_LISTS[p.area]) {
      const shown = await ooListOverlay(OO_LISTS[p.area][0], OO_LISTS[p.area][1]);
      for (const l of lines) {
        const row = shown && (shown.data || []).find(r => +r.id === +l.id);
        if (row) await ooLedgerAdd(p.area, l.id, +l.counted - (+row[OO_LISTS[p.area][2]] || 0));
      }
    }
  } else if (action === 'pay') {   // a supplier
    if (!(+p.amount > 0) || !String(p.supplier || '').trim()) return { ok: false, error: 'Enter the supplier and the amount' };
    if ((p.method || 'Cash') === 'Cash') await ooShiftAdd('Cash', +p.amount, 'supplierPayments');
  }
  await ooQueue(action, { ...p }, { resource });
  return answer;
}

// ── WRAP api() / apiGet() ─────────────────────────
window.apiGet = async function (resource, action, params = {}) {
  const ours = ['orders', 'kitchen_orders', 'discounts', 'sessions', 'shifts', 'bar-inventory', 'kitchen2', 'attendance'].includes(resource);
  const localId = resource === 'orders' && action === 'get' && +params.orderId < 0;
  const role = ours ? await offlineRole() : null;
  if (ours && (localId || (role && ooOffline()))) {
    const r = await ooHandleGet(resource, action, params, localId ? 'main' : role);
    if (r) return r;
  }
  const res = await apiGetRaw(resource, action, params);
  if (res.ok && !res.offline) {
    if (_ooNetDown) ooBackOnline();
    if (role && Object.values(OO_LISTS).some(l => l[0] === resource && l[1] === action)) ooLedgerMaybeClear();
    return res;
  }
  if ((res.offline || ooIsNetFail(res)) && ours && role) {
    _ooNetDown = true;
    const r = await ooHandleGet(resource, action, params, role);
    if (r) return r;
  }
  return res;
};

window.api = async function (resource, action, payload = {}, ...rest) {
  if (ooIsStock(resource, action)) return ooApiStock(resource, action, payload);
  if (resource !== 'orders' && !(resource === 'shifts' && ['open', 'close'].includes(action)) && !(resource === 'attendance' && ['start', 'end'].includes(action)) && !(resource === 'misc' && action === 'void_request_submit')) return apiRaw(resource, action, payload, ...rest);
  // work started or ended on this device and not yet sent: send it first, so the server never gets a second start
  if (resource === 'attendance' && session && session.userId && !(await ooLocal()) && (await dbGet('settings', ooAttKey(session.userId))) && typeof syncPendingItems === 'function') await syncPendingItems();
  const localId = payload.orderId != null && +payload.orderId < 0;
  const localItem = payload.itemId != null && +payload.itemId < 0;
  if (localId || localItem || await ooLocal()) {
    const r = await ooHandlePost(resource, action, payload);
    if (r) return r;
  }
  if (['create', 'add_item', 'validate', 'pay', 'open', 'close', 'refund', 'refund_request', 'void_request_submit'].includes(action) && (await offlineRole()) === 'owner' && ((session && session.offline) || navigator.onLine === false)) {
    return { ok: false, error: 'No internet. This can be done offline only on the main device.' };
  }
  const key = newRequestKey();
  const res = await apiRaw(resource, action, payload, false, key);
  // a payment online changes the shift total: keep this device's copy of it current
  if (res && res.ok && action === 'pay' && (await offlineRole()) === 'main') apiGetRaw('shifts', 'current', {}).catch(() => {});
  // also when "unconfirmed" (it may have reached the server): every order action is safe to
  // send again — items carry their clientUuid, validate/pay check the status, quantities are
  // absolute. At worst an empty draft order is left on the server.
  if (res && !res.ok && (res.network || res.error === 'offline') && (await offlineRole()) === 'owner') {
    return { ...res, error: 'No internet. This can be done offline only on the main device.' };
  }
  if (res && !res.ok && (res.network || res.error === 'offline') && (await offlineRole()) === 'main') {
    _ooNetDown = true;
    _ooKey = res.unconfirmed ? key : null;
    toast('No internet — working on this device. Everything is sent when the internet is back.', 'warning');
    let r;
    try { r = await ooHandlePost(resource, action, payload); } finally { _ooKey = null; }   // only for this call
    if (r) return r;
  }
  return res;
};

const ooOffline = () => !!(session && session.offline) || _ooNetDown || navigator.onLine === false;
async function ooApiStock(resource, action, payload) {
  const role = await offlineRole();
  const refuse = { ok: false, error: 'No internet. This can be done offline only on the main device.' };
  if (role && ooOffline()) return ooStockAllowed(role, action) ? ooHandleStock(resource, action, payload) : refuse;
  const key = newRequestKey();
  const res = await apiRaw(resource, action, payload, false, key);
  if (role && res && !res.ok && (res.network || res.error === 'offline')) {
    _ooNetDown = true;
    if (!ooStockAllowed(role, action)) return refuse;
    _ooKey = res.unconfirmed ? key : null;
    toast('No internet — saved on this device. It is sent when the internet is back.', 'warning');
    try { return await ooHandleStock(resource, action, payload); } finally { _ooKey = null; }   // only for this call
  }
  return res;
}

// ── BACK ONLINE ───────────────────────────────────
// The probe notices the server again; signed in online, unfinished device orders move up.
async function ooBackOnline() {
  _ooNetDown = false;
  if (session && session.userId && !session.offline) await ooMoveUnfinished();
  if (typeof syncPendingItems === 'function') syncPendingItems();
}

// one at a time: two triggers at once must not queue the same order twice
let _ooMoving = Promise.resolve();
function ooMoveUnfinished() {
  _ooMoving = _ooMoving.then(async () => {
    for (const o of await ooAll()) {
      if (o.status === 'paid') continue;   // already queued as a paid order
      const queued = (await dbGetAll('sync_queue')).some(q => q.offlineOrderId === o.id);
      if (!queued) await ooQueue('offline_order', ooSnapshot(o), { noIdem: true, offlineOrderId: o.id });
    }
  }).catch(e => console.warn('[Offline] Could not move unfinished orders:', e));
  return _ooMoving;
}

// sync.js calls this after a record reached the server
async function offlineAfterSync(item, result) {
  if (item.type === 'op' && item.resource === 'shifts' && item.action === 'close') {
    // only the shift that was closed: a newer shift opened after it stays
    const rec = await dbGet('settings', ooShiftKey(item.userId));
    if (rec && rec.closed && ooShiftRef(rec) === item.shiftRef) await dbDelete('settings', ooShiftKey(item.userId));
  }
  if (item.type === 'op' && item.resource === 'attendance' && item.action === 'end') {
    // only the work that was ended: a newer start on this device stays
    const rec = await dbGet('settings', ooAttKey(item.userId));
    if (rec && rec.closed && (rec.clientUuid || null) === ((item.payload && item.payload.attendanceUuid) || null)) await dbDelete('settings', ooAttKey(item.userId));
  }
  if (item.type === 'op' && item.action === 'offline_order' && item.offlineOrderId) {
    if (result && result.orderId) _ooIdMap[item.offlineOrderId] = result.orderId;
    await dbDelete(OO_STORE, item.offlineOrderId);
  }
}

setInterval(async () => {
  const offSession = session && session.offline;
  if ((!_ooNetDown && !offSession) || !navigator.onLine) return;
  const r = await apiGetRaw('auth', 'csrf', {});
  if (!(r && r.ok && !r.offline)) return;
  if (_ooNetDown) ooBackOnline();
  if (offSession) ooSignInAgainBanner();
}, OO_PROBE_MS);

// Signed in offline (no server session): work goes on here, but live data needs a new sign-in
function ooSignInAgainBanner() {
  if (document.getElementById('ooBackBanner')) return;
  const b = document.createElement('div');
  b.id = 'ooBackBanner';
  b.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9996;background:#0F7B4B;color:#fff;padding:10px 14px;border-radius:12px;display:flex;gap:12px;align-items:center;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:calc(100% - 32px)';
  b.innerHTML = '<span>Internet is back. Your offline work is being sent. Sign in again to see live data.</span><button class="btn btn-sm" style="background:#fff;color:#0F7B4B;border:none" onclick="document.getElementById(\'ooBackBanner\').remove();doLogout()">Sign in</button>';
  document.body.appendChild(b);
}

// ── KEEP THE LAST COPY READY (online, offline devices only) ─
// What the order screens need without internet, loaded ahead of time.
async function offlinePreload() {
  if (!(await offlineRole()) || !session.userId || session.offline || _ooNetDown) return;
  await ooShiftCleanup();
  await ooAttCleanup();
  const reads = [['bar-inventory', 'items_list'], ['kitchen2', 'menu_list'], ['sessions', 'list_tables'], ['sessions', 'bar_info'],
                 ['discounts', 'offline_rules'], ['shifts', 'current'], ['attendance', 'current'], ['bar-inventory', 'ingredients_list'], ['kitchen2', 'ingredients_list'], ['suppliers', 'list'],
                 ['stockcount', 'sheet', { area: 'bar_item' }], ['stockcount', 'sheet', { area: 'bar_ingredient' }], ['stockcount', 'sheet', { area: 'kitchen_ingredient' }], ['orders', 'list', { status: 'open' }], ['orders', 'list', { status: 'paid' }]];
  for (const [r, a, p] of reads) { try { await apiGetRaw(r, a, p || {}); } catch (e) {} }
  try {
    const open = await apiGetRaw('orders', 'list', { status: 'open' });
    for (const o of (open.ok && open.data) || []) await apiGetRaw('orders', 'get', { orderId: o.id });
    const paid = await apiGetRaw('orders', 'list', { status: 'paid' });
    for (const o of ((paid.ok && paid.data) || []).slice(0, 30)) await apiGetRaw('orders', 'get', { orderId: o.id });
  } catch (e) {}
}
setInterval(offlinePreload, 10 * 60 * 1000);
