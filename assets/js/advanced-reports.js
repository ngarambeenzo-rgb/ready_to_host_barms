/* ═══════════════════════════════════════════════════
   BARMS PRO — advanced-reports.js
   Advanced Reports: overview, sales, products, stock,
   kitchen, purchases, expenses, discrepancies, data quality.
   All figures come from api/reports.php (api/report_lib.php);
   this file only displays them.
   Depends on: utils.js, api.js, auth.js
═══════════════════════════════════════════════════ */

const AR_TABS = [
  { id: 'overview',      label: 'Summary',          action: 'overview' },
  { id: 'sales',         label: 'Sales',            action: 'sales' },
  { id: 'products',      label: 'Products',         action: 'products' },
  { id: 'stock',         label: 'Stock',            action: 'stock' },
  { id: 'kitchen',       label: 'Kitchen',          action: 'kitchen' },
  { id: 'purchases',     label: 'Purchases',        action: 'purchases' },
  { id: 'expenses',      label: 'Expenses & Cash',  action: 'expenses' },
  { id: 'worth',         label: 'Business worth',   action: 'worth', owner: true },
  { id: 'discrepancies', label: 'To review',        action: 'issues' },
  { id: 'quality',       label: 'About the data',   action: 'quality' },
];
const AR_PRESETS = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This week'], ['last_week', 'Last week'],
  ['this_month', 'This month'], ['last_month', 'Last month'], ['custom', 'Custom…'],
];
const AR_SCOPES = [['all', 'Bar + Kitchen'], ['bar', 'Bar'], ['kitchen', 'Kitchen']];

const AR = { tab: 'overview', preset: 'today', from: '', to: '', scope: 'all', staff: '', cache: {}, tables: {}, sort: {}, filters: {}, issueFilter: 'active', stockKind: 'all', last: null, detailAll: {} };

// ── entry point (called by showPage) ──────────────
function loadAdvancedReports() {
  arRenderControls();
  arLoadTab();
}

function arParams(extra = {}) {
  const p = { preset: AR.preset, scope: AR.scope };
  if (AR.preset === 'custom') { p.from = AR.from; p.to = AR.to; }
  if (AR.staff) p.staff = AR.staff;
  return Object.assign(p, extra);
}
async function arGet(action, extra = {}) {
  const params = arParams(extra);
  const key = action + '|' + JSON.stringify(params);
  if (AR.cache[key]) return AR.cache[key];
  const res = await apiGet('reports', action, params);
  if (res.ok) AR.cache[key] = res;
  return res;
}
function arResetCache() { AR.cache = {}; AR.detailAll = {}; }
// a shortened list ("Showing the newest 300 of 55 965") → ask the server for every record of this tab
function arLoadAll(action) { AR.detailAll[action] = 1; arLoadTab(); }

// ── controls ──────────────────────────────────────
function arRenderControls() {
  document.getElementById('arPresets').innerHTML = AR_PRESETS.map(([id, l]) =>
    `<button class="ar-chip ${AR.preset === id ? 'active' : ''}" onclick="arSetPreset('${id}')">${l}</button>`).join('');
  document.getElementById('arScope').innerHTML = AR_SCOPES.map(([id, l]) =>
    `<button class="ar-chip ${AR.scope === id ? 'active' : ''}" onclick="arSetScope('${id}')">${l}</button>`).join('');
  document.getElementById('arCustom').classList.toggle('show', AR.preset === 'custom');
  if (!AR.from) { AR.from = today().slice(0, 8) + '01'; AR.to = today(); }
  document.getElementById('arFrom').value = AR.from;
  document.getElementById('arTo').value = AR.to;
  arRenderTabs();
}
function arRenderTabs(openIssues) {
  if (openIssues !== undefined) AR.openIssues = openIssues;
  document.getElementById('arTabs').innerHTML = arVisibleTabs().map(t =>
    `<button class="ar-tab ${AR.tab === t.id ? 'active' : ''}" role="tab" onclick="arSetTab('${t.id}')">${t.label}${t.id === 'discrepancies' && AR.openIssues ? `<span class="ar-tab-badge">${AR.openIssues}</span>` : ''}</button>`).join('');
}
// "Business worth" is the owner's information (the server refuses it to others too)
function arVisibleTabs() { return AR_TABS.filter(t => !t.owner || (typeof session !== 'undefined' && session.role === 'Owner')); }
function arSetPreset(p) {
  AR.preset = p;
  arRenderControls();
  if (p !== 'custom') { arResetCache(); arLoadTab(); }
}
function arApplyCustom() {
  const f = document.getElementById('arFrom').value, t = document.getElementById('arTo').value;
  if (!f || !t) { toast('Choose a start and end date', 'error'); return; }
  AR.from = f; AR.to = t; arResetCache(); arLoadTab();
}
function arSetScope(s) { AR.scope = s; AR.staff = ''; arRenderControls(); arResetCache(); arLoadTab(); }
function arSetTab(t) { AR.tab = t; arRenderTabs(); arLoadTab(); window.scrollTo?.(0, 0); }

let _arLoadSeq = 0;
async function arLoadTab() {
  const seq = ++_arLoadSeq; // only the latest request may draw the page
  const el = document.getElementById('arContent');
  const notice = document.getElementById('arNotice');
  notice.innerHTML = navigator.onLine ? '' : `<div class="ar-note warn">You are offline. Reports are calculated on the server, so they need a connection. Sales saved offline are not included until they sync.</div>`;
  el.innerHTML = `${uiLoader('Calculating the report')}`;
  AR.tables = {};
  const tab = AR_TABS.find(t => t.id === AR.tab);
  const res = await arGet(tab.action, AR.detailAll[tab.action] ? { detail: 'all' } : {});
  if (seq !== _arLoadSeq) return; // the user moved on to another tab or period
  if (!res.ok) { el.innerHTML = `<div class="ar-empty">${esc(res.error || 'Could not load this report')}</div>`; return; }
  AR.last = res;
  document.getElementById('arPeriodLabel').textContent =
    `${res.period.label} · ${res.period.from}${res.period.to !== res.period.from ? ' → ' + res.period.to : ''} · ${AR_SCOPES.find(s => s[0] === res.scope)[1]} · generated ${res.generatedAt}`;
  const render = { overview: arOverview, sales: arSales, products: arProducts, stock: arStock, kitchen: arKitchen, purchases: arPurchases, expenses: arExpenses, worth: arWorth, discrepancies: arIssues, quality: arQuality }[AR.tab];
  el.innerHTML = render(res.data, res) || '';
  arAfterRender();
  if (AR.tab === 'overview') arRenderTabs(res.data.issues?.open || 0);
}
// some tabs need wiring after their HTML is in place
let _arAfter = [];
function arAfterRender() { const fns = _arAfter; _arAfter = []; fns.forEach(f => f()); }

// ── formatting ────────────────────────────────────
const arM = v => v === null || v === undefined ? '—' : fmtRWF(Math.round(+v));
const arQ = v => v === null || v === undefined ? '—' : (+v).toLocaleString(undefined, { maximumFractionDigits: 3 });
const arP = v => v === null || v === undefined ? '—' : `${(+v).toFixed(1)}%`;
function arChange(cur, prev, higherIsGood = true) {
  if (prev === null || prev === undefined || cur === null || cur === undefined) return '';
  if (+prev === 0) return +cur === 0 ? '' : `<span class="muted">new vs previous period</span>`;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const good = higherIsGood ? pct >= 0 : pct <= 0;
  return `<span class="${good ? 'ar-up' : 'ar-down'}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span> <span class="muted">vs ${arM(prev)}</span>`;
}
function arKpi(label, value, sub = '', onclick = '', tone = '') {
  const na = value === null || value === undefined;
  return `<button class="ar-kpi ${onclick ? '' : 'static'} ${na ? 'na' : ''}" ${onclick ? `onclick="${onclick}"` : 'tabindex="-1"'}>
    <div class="ar-kpi-label">${label}</div>
    <div class="ar-kpi-value ${tone}">${na ? 'Not recorded yet' : value}</div>
    ${sub ? `<div class="ar-kpi-sub">${sub}</div>` : ''}
  </button>`;
}
function arSection(title, body, sub = '', right = '') {
  return `<div class="ar-section"><div class="ar-section-title"><span>${title}${sub ? `<div class="ar-section-sub">${sub}</div>` : ''}</span>${right}</div>${body}</div>`;
}
function arFlags(flags) {
  return (flags || []).map(f => {
    const cls = /Negative|No cost|No recipe/.test(f) ? 'bad' : /increased|falling|30 days|Low/.test(f) ? '' : 'info';
    return `<span class="ar-flag ${cls}">${esc(f)}</span>`;
  }).join('');
}

// ── sortable / searchable tables (also used for CSV) ─
/**
 * cols: [{ k: key, l: label, t: 'money'|'qty'|'pct'|'text'|'date', f?: row => html, csv?: row => value, sum?: true }]
 * opts: { title, search: [keys], rowClick: 'fnName', empty, limit }
 */
function arTable(id, cols, rows, opts = {}) {
  AR.tables[id] = { cols, rows, opts };
  return `<div id="arT-${id}">${arTableHtml(id)}</div>`;
}
function arTableHtml(id) {
  const { cols: allCols, rows, opts } = AR.tables[id];
  const hasDetail = allCols.some(c => c.detail);
  const cols = hasDetail && !AR.filters[id + ':cols'] ? allCols.filter(c => !c.detail) : allCols;
  const q = (AR.filters[id] || '').toLowerCase();
  let list = q && opts.search ? rows.filter(r => opts.search.some(k => String(r[k] ?? '').toLowerCase().includes(q))) : rows.slice();
  const s = AR.sort[id];
  if (s) {
    list.sort((a, b) => {
      const x = a[s.k], y = b[s.k];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * s.dir;
    });
  }
  const num = c => ['money', 'qty', 'pct'].includes(c.t);
  const cell = (c, r) => {
    if (c.f) return c.f(r);
    const v = r[c.k];
    return c.t === 'money' ? arM(v) : c.t === 'qty' ? arQ(v) : c.t === 'pct' ? arP(v) : esc(v ?? '—');
  };
  const head = cols.map(c => `<th class="${num(c) ? 'num' : ''}" onclick="arSortBy('${id}','${c.k}')">${c.l}${s && s.k === c.k ? `<span class="ar-sort">${s.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('');
  const shown = opts.limit && !AR.filters[id + ':all'] ? list.slice(0, opts.limit) : list;
  const body = shown.map((r, i) => `<tr class="${opts.rowClick ? 'clickable' : ''}" ${opts.rowClick ? `onclick="${opts.rowClick}('${id}',${rows.indexOf(r)})"` : ''}>${cols.map(c => `<td class="${num(c) ? 'num' : ''}">${cell(c, r)}</td>`).join('')}</tr>`).join('');
  const lim = opts.limited;   // { shown, total, action } when the server sent only the newest records
  const hasSum = cols.some(c => c.sum) && !lim;
  const foot = hasSum && list.length ? `<tfoot><tr>${cols.map((c, i) => `<td class="${num(c) ? 'num' : ''}">${c.sum ? (c.t === 'money' ? arM(list.reduce((a, r) => a + (+r[c.k] || 0), 0)) : arQ(list.reduce((a, r) => a + (+r[c.k] || 0), 0))) : i === 0 ? 'Total' : ''}</td>`).join('')}</tr></tfoot>` : '';
  const limNote = lim ? `<div class="ar-note" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">Showing the newest ${lim.shown.toLocaleString()} of ${lim.total.toLocaleString()} records — search and sort cover these only. <button class="btn btn-ghost btn-sm" onclick="arLoadAll('${lim.action}')">Load all ${lim.total.toLocaleString()}</button></div>` : '';
  const search = opts.search ? `<input class="form-input ar-search" placeholder="${lim ? 'Search the newest ' + lim.shown + '…' : 'Search…'}" value="${esc(AR.filters[id] || '')}" oninput="arFilter('${id}',this.value)"/>` : '';
  const more = opts.limit && list.length > opts.limit && !AR.filters[id + ':all'] ? `<div style="text-align:center;margin-top:8px"><button class="btn btn-ghost btn-sm" onclick="AR.filters['${id}:all']=1;arRefreshTable('${id}')">Show all ${list.length}</button></div>` : '';
  const colToggle = hasDetail ? `<button class="ar-link" onclick="AR.filters['${id}:cols']=${AR.filters[id + ':cols'] ? 0 : 1};arRefreshTable('${id}')">${AR.filters[id + ':cols'] ? '− Fewer columns' : '+ Show all columns'}</button>` : '';
  return `${limNote}${search || colToggle ? `<div class="ar-table-tools">${search}${colToggle}</div>` : ''}
    <div class="ar-table-wrap"><table class="ar-table"><thead><tr>${head}</tr></thead>
    <tbody>${body || `<tr><td colspan="${cols.length}" class="ar-empty">${opts.empty || 'Nothing recorded for this period'}</td></tr>`}</tbody>${foot}</table></div>${more}`;
}
function arRefreshTable(id) {
  const el = document.getElementById('arT-' + id);
  if (!el) return;
  const active = document.activeElement && el.contains(document.activeElement) && document.activeElement.classList.contains('ar-search');
  el.innerHTML = arTableHtml(id);
  if (active) { const s = el.querySelector('.ar-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}
function arSortBy(id, k) {
  const s = AR.sort[id];
  AR.sort[id] = { k, dir: s && s.k === k ? -s.dir : -1 };
  arRefreshTable(id);
}
function arFilter(id, q) { AR.filters[id] = q; arRefreshTable(id); }

// ── CSV export / print ────────────────────────────
function arCsvValue(c, r) {
  if (c.csv) return c.csv(r);
  const v = r[c.k];
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join('; ');
  return typeof v === 'object' ? JSON.stringify(v) : v;
}
function arExportCurrent() {
  const ids = Object.keys(AR.tables).filter(id => !id.startsWith('drill'));
  if (!ids.length) { toast('Nothing to export for this period', 'warning'); return; }
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  const p = AR.last?.period || {};
  let out = [q(`BarMS Advanced Reports — ${AR_TABS.find(t => t.id === AR.tab).label.replace(/^\S+\s/, '')}`), q(`${p.from} to ${p.to}`), q(AR.scope)].join(',') + '\n';
  ids.forEach(id => {
    const { cols, rows, opts } = AR.tables[id];
    out += '\n' + q(opts.title || id) + '\n' + cols.map(c => q(c.l)).join(',') + '\n';
    rows.forEach(r => { out += cols.map(c => q(arCsvValue(c, r))).join(',') + '\n'; });
  });
  const blob = new Blob(['﻿' + out], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `barms-${AR.tab}-${p.from}_${p.to}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function arPrint() {
  // print every row, not just the first page of long tables
  let expanded = false;
  Object.keys(AR.tables).forEach(id => { if (AR.tables[id].opts.limit && !AR.filters[id + ':all']) { AR.filters[id + ':all'] = 1; arRefreshTable(id); expanded = true; } });
  const bar = await apiGet('misc', 'bar_info');
  document.getElementById('arPrintTitle').textContent = `${bar.ok ? bar.barName : 'BarMS'} — ${AR_TABS.find(t => t.id === AR.tab).label.replace(/^\S+\s/, '')}`;
  if (expanded) await new Promise(r => setTimeout(r, 50));
  printWithClass('print-ar');
}

// ── drill-down modal ──────────────────────────────
function arDrill(title, html, sub = '') {
  document.getElementById('modalContent').innerHTML = `<div class="ar-drill">
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px">
      <div><h3 style="margin:0">${title}</h3>${sub ? `<div class="ar-section-sub" style="margin-top:4px">${sub}</div>` : ''}</div>
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">✕</button>
    </div>${html}</div>`;
  document.getElementById('modalOverlay').classList.add('show');
  arAfterRender();
}
const AR_LINE_COLS = [
  { k: 'date', l: 'Date' }, { k: 'time', l: 'Time' }, { k: 'source', l: 'Area' }, { k: 'order', l: 'Order' },
  { k: 'name', l: 'Item' }, { k: 'staff', l: 'Staff' }, { k: 'qty', l: 'Qty', t: 'qty', sum: true },
  { k: 'unitPrice', l: 'Price', t: 'money' }, { k: 'total', l: 'Total', t: 'money', sum: true },
  { k: 'cost', l: 'Cost', t: 'money', sum: true },
  { k: 'costStatus', l: 'Cost basis', f: r => r.costStatus === 'recorded' ? '<span class="ar-flag good">at sale</span>' : r.costStatus === 'estimated' ? '<span class="ar-flag">estimated</span>' : '<span class="ar-flag bad">unknown</span>' },
];
async function arDrillSales(filter = null, title = 'Sales lines') {
  // every sales line of the period, loaded only now (the Sales tab itself shows totals)
  if (!AR.cache['sales|' + JSON.stringify(arParams({ detail: 'all' }))]) toast('Loading every sales line…');
  const res = await arGet('sales', { detail: 'all' });
  if (!res.ok) { toast(res.error || 'Could not load', 'error'); return; }
  let lines = res.data.lines;
  if (filter) lines = lines.filter(filter);
  arDrill(title, arTable('drillLines', AR_LINE_COLS, lines, { title, search: ['name', 'order', 'staff'], limit: 200 }),
    `${lines.length} line(s). Cost "at sale" was saved when sold; "estimated" uses today's average cost; "unknown" means no cost is set.`);
}
async function arDrillRefunds() {
  const res = await arGet('sales');
  arDrill('Refunds', arTable('drillRefunds', [
    { k: 'date', l: 'Date' }, { k: 'order', l: 'Order' }, { k: 'source', l: 'Area' }, { k: 'name', l: 'Item' },
    { k: 'qty', l: 'Qty', t: 'qty', sum: true }, { k: 'total', l: 'Refunded', t: 'money', sum: true },
    { k: 'restocked', l: 'Back in stock', f: r => r.restocked ? 'Yes' : 'No' }, { k: 'method', l: 'Method' }, { k: 'reason', l: 'Reason' }, { k: 'by', l: 'By' },
  ], res.data.refunds, { title: 'Refunds' }) + `<div class="ar-group-label" style="margin-top:14px">Discounts</div>` + arTable('drillDiscounts', AR_DISCOUNT_COLS, res.data.discounts, { title: 'Discounts', empty: 'No discounts in this period' }),
  'Refunds count on the refund date; discounts count on the payment date.');
}
async function arDrillCollections() {
  const res = await arGet('sales');
  const c = res.data.collections;
  arDrill('Money collected', arTable('drillCol', [
    { k: 'method', l: 'Payment method' }, { k: 'orders', l: 'Orders', t: 'qty', sum: true },
    { k: 'received', l: 'Received', t: 'money', sum: true }, { k: 'refunded', l: 'Refunded', t: 'money', sum: true }, { k: 'net', l: 'Net', t: 'money', sum: true },
  ], c.byMethod, { title: 'Collections by method' }), 'Counted on the day the order was paid. Revenue is counted on the day of the sale, so the two can differ.');
}
async function arDrillExpenses() {
  const res = await arGet('expenses');
  arDrill('Operating expenses', arTable('drillExp', AR_EXP_COLS, res.data.lines, { title: 'Expenses', search: ['description', 'category'] }),
    'Stock purchases are not expenses; they become cost of goods only when sold.');
}

// ════════════════════════════════════════════════
//  OVERVIEW
// ════════════════════════════════════════════════

const AR_DISCOUNT_COLS = [
  { k: 'date', l: 'Date' }, { k: 'order', l: 'Order' }, { k: 'orderTotal', l: 'Bill', t: 'money' },
  { k: 'discount', l: 'Discount', t: 'money', sum: true }, { k: 'pct', l: '% of bill', t: 'pct' }, { k: 'reason', l: 'Reason' }, { k: 'by', l: 'Given by' },
];
const AR_SHIFT_COLS = [
  { k: 'user', l: 'Staff' }, { k: 'device', l: 'Device' }, { k: 'openedAt', l: 'Opened' }, { k: 'closedAt', l: 'Closed', f: r => r.closedAt ? esc(r.closedAt) : '<span class="ar-flag">open</span>' },
  { k: 'openingFloat', l: 'Start cash', t: 'money' }, { k: 'expected', l: 'Expected', t: 'money', sum: true }, { k: 'counted', l: 'Counted', t: 'money', sum: true },
  { k: 'difference', l: 'Difference', t: 'money', sum: true, f: r => r.difference === null ? '—' : `<span class="${Math.abs(r.difference) >= 1 ? (r.difference < 0 ? 'ar-bad' : 'ar-warn') : 'ar-good'}">${r.difference > 0 ? '+' : ''}${arM(r.difference)}</span>` },
  { k: 'note', l: 'Note' },
];
function arShiftClick(id, idx) {
  const r = AR.tables[id].rows[idx], b = r.breakdown;
  const line = (l, v, sign) => v ? `<div class="ar-notrecorded"><span style="flex:1">${l}</span><strong>${sign} ${arM(v)}</strong></div>` : '';
  arDrill(`Shift of ${esc(r.user)}`, `
    ${line('Cash at the start', b.openingFloat, '')}${line('Cash sales (after discounts)', b.cashSales, '+')}${line('Customer debts collected in cash', b.debtCollections, '+')}
    ${line('Cash put in (capital, loans, transfers in)', b.cashIn, '+')}${line('Cash refunds', b.refunds, '−')}${line('Cash expenses', b.expenses, '−')}
    ${line('Cash paid to suppliers', b.supplierPayments, '−')}${line('Cash taken out (withdrawals, repayments, transfers out)', b.cashOut, '−')}
    <div class="ar-notrecorded"><span style="flex:1"><strong>Expected in the drawer</strong></span><strong>${arM(r.expected)}</strong></div>
    <div class="ar-notrecorded"><span style="flex:1">Counted</span><strong>${arM(r.counted)}</strong></div>
    <div class="ar-notrecorded"><span style="flex:1">Difference</span><strong>${r.difference === null ? 'Shift still open' : arM(r.difference)}</strong></div>
    ${b.mixedPayments ? `<div class="ar-note">${arM(b.mixedPayments)} paid as "Mixed" is not counted as cash.</div>` : ''}
    <div class="ar-note">${b.orders} order(s) paid in this shift; ${arM(b.otherPayments)} by MoMo/Card/Bank.</div>`,
    `${esc(r.openedAt)} → ${esc(r.closedAt || 'still open')} · ${esc(r.device || '')}`);
}

// ════════════════════════════════════════════════
//  SALES
// ════════════════════════════════════════════════
function arDayClick(id, idx) {
  const r = AR.tables[id].rows[idx];
  arDrillSales(l => l.date === r.date && l.source === r.source, `${r.source === 'kitchen' ? 'Kitchen' : 'Bar'} sales on ${r.date}`);
}

// ════════════════════════════════════════════════
//  PRODUCT PROFITABILITY
// ════════════════════════════════════════════════

// ════════════════════════════════════════════════
//  STOCK VALUATION
// ════════════════════════════════════════════════

// ════════════════════════════════════════════════
//  KITCHEN & INGREDIENTS
// ════════════════════════════════════════════════
function arDishClick(id, idx) {
  const r = AR.tables[id].rows[idx];
  arDrill(`${esc(r.name)}`, r.breakdown.length ? arTable('drillDish', [
    { k: 'ingredient', l: 'Ingredient' }, { k: 'qty', l: 'Per portion', t: 'qty', f: x => `${arQ(x.qty)} ${esc(x.unit)}` },
    { k: 'unitCost', l: 'Avg cost/unit', t: 'money' }, { k: 'cost', l: 'Cost/portion', t: 'money', sum: true }, { k: 'share', l: 'Share of cost', t: 'pct' },
  ], r.breakdown, { title: 'Recipe cost' }) + `<div class="ar-note">Price ${arM(r.price)} − recipe cost ${arM(r.portionCost)} = <strong>${arM(r.profitPerPortion)}</strong> per portion (${arP(r.portionMargin)}). ${r.qtySold ? `Sold ${arQ(r.qtySold)}: revenue ${arM(r.netRevenue)} − ingredients ${arM(r.ingredientCost)} = ${arM(r.grossProfit)}.` : ''}</div>`
    : '<div class="ar-note warn">This dish has no recipe, so its ingredient cost is unknown. Add a recipe in Kitchen → Recipes.</div>');
}

// ════════════════════════════════════════════════
//  PURCHASES
// ════════════════════════════════════════════════

// ════════════════════════════════════════════════
//  EXPENSES & CASH
// ════════════════════════════════════════════════

// ════════════════════════════════════════════════
//  DISCREPANCIES
// ════════════════════════════════════════════════
function arIssues(d) {
  const filters = [['active', 'Open & under review'], ['open', 'Open'], ['review', 'Under review'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed'], ['all', 'All']];
  const list = d.issues.filter(i => AR.issueFilter === 'all' ? true : AR.issueFilter === 'active' ? ['open', 'review'].includes(i.status) : i.status === AR.issueFilter);
  AR.tables.issues = { cols: [
    { k: 'severity', l: 'Severity' }, { k: 'type', l: 'Type' }, { k: 'title', l: 'Issue' }, { k: 'evidence', l: 'Evidence' },
    { k: 'date', l: 'Date' }, { k: 'impact', l: 'Impact', t: 'money' }, { k: 'status', l: 'Status' }, { k: 'note', l: 'Note' },
  ], rows: list, opts: { title: 'Discrepancies' } };
  const statusLabel = { open: 'Open', review: 'Under review', resolved: 'Resolved', dismissed: 'Dismissed' };
  return `<div class="ar-note" style="margin-bottom:12px">These are differences between what BarMS expects and what it holds. An unexplained difference is <strong>not proof of wrongdoing</strong> — it is often a missing record. Nothing here changes stock or past records; corrections must be made through the normal screens.</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${filters.map(([k, l]) => `<button class="ar-chip ${AR.issueFilter === k ? 'active' : ''}" onclick="AR.issueFilter='${k}';arLoadTab()">${l}</button>`).join('')}</div>
    ${list.length ? list.map(i => `<div class="ar-issue">
      <div class="ar-issue-head">
        <div style="flex:1;min-width:220px"><span class="ar-sev ${i.severity}">${i.severity}</span> <span class="muted" style="font-size:11px;font-weight:700">${esc(i.type)}</span>
          <div class="ar-issue-title" style="margin-top:4px">${esc(i.title)}</div></div>
        <div style="text-align:right">${i.impact !== null ? `<div style="font-weight:900">${arM(i.impact)}</div><div class="muted" style="font-size:10px">possible impact</div>` : ''}</div>
      </div>
      <div class="ar-issue-ev">${esc(i.evidence)}${i.date ? ` · ${esc(i.date)}` : ''}</div>
      ${i.note ? `<div class="ar-note">${esc(i.note)} — ${esc(i.reviewedBy || '')} ${esc(i.reviewedAt || '')}</div>` : ''}
      <div class="ar-issue-actions">
        <span class="ar-flag ${i.status === 'resolved' ? 'good' : i.status === 'dismissed' ? 'info' : ''}">${statusLabel[i.status]}</span>
        <button class="btn btn-ghost btn-sm" onclick="arSetTab('${i.tab}')">See ${i.tab}</button>
        ${i.status !== 'review' ? `<button class="btn btn-ghost btn-sm" onclick="arIssueSet('${esc(i.key)}','review')">Under review</button>` : ''}
        ${i.status !== 'resolved' ? `<button class="btn btn-ghost btn-sm" onclick="arIssueSet('${esc(i.key)}','resolved')">Resolved</button>` : ''}
        ${i.status !== 'dismissed' ? `<button class="btn btn-ghost btn-sm" onclick="arIssueSet('${esc(i.key)}','dismissed')">Dismiss</button>` : ''}
        ${['resolved', 'dismissed'].includes(i.status) ? `<button class="btn btn-ghost btn-sm" onclick="arIssueSet('${esc(i.key)}','open')">Reopen</button>` : ''}
      </div></div>`).join('') : '<div class="ar-empty">No issues in this view </div>'}`;
}
function arIssueSet(key, status) {
  const needsNote = ['resolved', 'dismissed'].includes(status);
  document.getElementById('modalContent').innerHTML = `
    <h3>${{ review: 'Mark under review', resolved: 'Mark resolved', dismissed: 'Dismiss issue', open: 'Reopen issue' }[status]}</h3>
    <div class="form-group"><label class="form-label">Note${needsNote ? ' *' : ''}</label>
      <textarea class="form-input" id="arIssueNote" rows="3" placeholder="What did you find or do?" style="resize:vertical"></textarea></div>
    <button class="btn btn-primary" onclick="arIssueSave(${JSON.stringify(key).replace(/"/g, '&quot;')},'${status}')">Save</button>`;
  document.getElementById('modalOverlay').classList.add('show');
}
async function arIssueSave(key, status) {
  const note = document.getElementById('arIssueNote')?.value?.trim() || '';
  if (['resolved', 'dismissed'].includes(status) && !note) { toast('Write a note explaining the resolution', 'error'); return; }
  const res = await api('reports', 'issue_update', { key, status, note });
  if (!res.ok) { toast(res.error || 'Could not save', 'error'); return; }
  closeModal(); toast('Issue updated'); arResetCache(); arLoadTab();
}

// ════════════════════════════════════════════════
//  DATA QUALITY
// ════════════════════════════════════════════════
function arQuality(d) {
  _arAfter.push(arShowPendingSync);
  const labels = { historicalCost: 'Historical stock cost', taxes: 'Taxes', mixedPayments: 'Mixed payments', olderRecords: 'Older records' };
  return `${arSection('Checks for this period', arTable('checks', [{ k: 'label', l: 'Check' }, { k: 'value', l: 'Result' }], d.checks, { title: 'Data checks' }))}
    ${arSection('Synchronisation', '<div id="arSyncState" class="muted">Checking…</div>')}
    ${arSection('Limits of these reports', Object.entries(d.notRecorded).map(([k, v]) => `<div class="ar-notrecorded"><span class="ar-flag" style="flex:0 0 auto">${esc(labels[k] || k)}</span><span>${esc(v)}</span></div>`).join(''),
      'Figures that cannot be exact are labelled instead of being guessed')}`;
}
async function arShowPendingSync() {
  const el = document.getElementById('arSyncState');
  if (!el) return;
  let pending = 0;
  try { pending = (await dbGetAll('sync_queue') || []).filter(x => x.status !== 'synced').length; } catch (e) {}
  el.innerHTML = pending
    ? `<span class="ar-warn">${pending} item(s) saved on this device are waiting to sync and are not in these reports yet.</span>`
    : (navigator.onLine ? 'Online — nothing on this device is waiting to sync.' : 'Offline — reports need a connection.');
}

// ════════════════════════════════════════════════
//  LAYOUT HELPERS — every tab: story → key figures → chart → main table → more details
// ════════════════════════════════════════════════
function arStory(sentences) {
  const list = sentences.filter(Boolean);
  return list.length ? `<div class="ar-story">${list.map(s => `<p>${esc(s)}</p>`).join('')}</div>` : '';
}
function arTiles(items) {
  return `<div class="bx-stats">${items.filter(Boolean).map(k => bxStat({ label: k.l, value: k.v, sub: k.s, icon: k.icon, delta: k.d, goodUp: k.goodUp, hero: k.hero, tone: k.tone, click: k.click })).join('')}</div>`;
}
function arBlock(title, body, sub = '', right = '') {
  return `<div class="ar-block"><div class="ar-block-head"><div><div class="ar-block-title">${title}</div>${sub ? `<div class="ar-block-sub">${sub}</div>` : ''}</div>${right}</div>${body}</div>`;
}
function arMore(title, body) {
  return `<details class="ar-more"><summary>${title}</summary><div class="ar-more-body">${body}</div></details>`;
}
function arHBars(rows, label, value, fmt = arM) {
  return bxHBars({ items: rows.map(r => ({ label: r[label], value: +r[value] || 0 })), fmt, emptyText: 'Nothing in this period' });
}
function arRings(rows, label, value, centerLabel, fmt = arM) {
  return bxRings({ items: rows.map(r => ({ label: r[label], value: +r[value] || 0 })), fmt, centerLabel, emptyText: 'Nothing in this period' });
}
const arPctOf = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;
function arChg(a, b, goodUp = true) {
  if (b === null || b === undefined || +b === 0) return '';
  const c = Math.round((a - b) / Math.abs(b) * 1000) / 10;
  return `<span class="${(goodUp ? c >= 0 : c <= 0) ? 'ar-up' : 'ar-down'}">${c >= 0 ? '▲' : '▼'} ${Math.abs(c)}%</span> vs previous period`;
}

// ════════════════════════════════════════════════
//  SUMMARY
// ════════════════════════════════════════════════
// Daily net sales vs gross profit (shared by Summary and Sales)
function arDailyColumns(days) {
  const byDay = {};
  days.forEach(r => { byDay[r.date] ??= { net: 0, gp: 0 }; byDay[r.date].net += r.net; byDay[r.date].gp += r.grossProfit; });
  const keys = Object.keys(byDay).sort();
  return bxColumns({
    categories: keys.map(k => new Date(k + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
    series: [{ name: 'Net sales', values: keys.map(k => byDay[k].net) }, { name: 'Gross profit', values: keys.map(k => Math.max(0, byDay[k].gp)) }],
    mutedFirst: true, fmt: v => arM(v), height: 210, emptyText: 'No sales in this period',
  });
}
async function arFillSummaryTrend() {
  const res = await arGet('sales');
  const el = document.getElementById('arSumTrend');
  if (el && res.ok) el.innerHTML = arDailyColumns(res.data.days);
}

function arOverview(d) {
  const c = d.current, p = d.previous, s = d.stock;
  _arAfter.push(arFillSummaryTrend);
  const owner = typeof session !== 'undefined' && session.role === 'Owner';
  if (owner) _arAfter.push(arFillSummaryWorth);
  return `${arStory(arNarrative({ overview: d, period: AR.last.period }))}
    <div class="ar-group">Money</div>
    ${arTiles([
      { l: 'Net sales', v: arM(c.netSales), s: `${c.transactions} orders`, icon: '', d: bxDelta(c.netSales, p.netSales), hero: true, click: "arSetTab('sales')" },
      { l: 'Gross profit', v: arM(c.grossProfit), s: `${arP(c.grossMargin)} of sales kept`, icon: '', d: bxDelta(c.grossProfit, p.grossProfit), tone: c.grossProfit < 0 ? 'bad' : '', click: "arSetTab('products')" },
      { l: 'Expenses', v: arM(c.operatingExpenses), s: 'running costs', icon: '', d: bxDelta(c.operatingExpenses, p.operatingExpenses), goodUp: false, click: "arSetTab('expenses')" },
      { l: 'Net operating profit', v: arM(c.netOperatingProfit), s: 'before tax', icon: '', d: bxDelta(c.netOperatingProfit, p.netOperatingProfit), tone: c.netOperatingProfit < 0 ? 'bad' : '', click: "arSetTab('expenses')" },
    ])}
    <div class="ar-group">What the business holds and owes</div>
    ${arTiles([
      { l: 'Stock value', v: arM(s.costValue), s: `could sell for ${arM(s.sellValue)}`, icon: '', click: "arSetTab('stock')" },
      d.collections && { l: 'Money received', v: arM(d.collections.net), s: 'after refunds', icon: '', click: 'arDrillCollections()' },
      { l: 'Owed to suppliers', v: arM(d.supplierDebts), icon: '', tone: d.supplierDebts > 0 ? 'warn' : '', click: "arSetTab('purchases')" },
      { l: 'Customers owe', v: arM(d.customerDebts.outstanding), s: `${d.customerDebts.count} unpaid`, icon: '', click: "showPage('custdebts')" },
    ])}
    ${owner ? `<div id="arSumWorth">${uiLoader('Working out what the business is worth')}</div>` : ''}
    <div class="ar-group">Needs attention</div>
    ${arTiles([
      { l: 'Points to review', v: d.issues.open, s: d.issues.impact ? `${arM(d.issues.impact)} possibly affected` : 'nothing open', icon: '', tone: d.issues.open ? 'warn' : 'good', click: "arSetTab('discrepancies')" },
      { l: 'Cash drawer', v: d.cashHandover.closed ? (d.cashHandover.difference === 0 ? 'Matches' : `${d.cashHandover.difference < 0 ? 'Short' : 'Over'} ${arM(Math.abs(d.cashHandover.difference))}`) : 'No closed shift',
        s: d.cashHandover.closed ? `${d.cashHandover.closed} shift(s) counted` : 'open shifts from the top bar', icon: '', tone: d.cashHandover.closed && d.cashHandover.difference !== 0 ? 'warn' : '', click: "arSetTab('expenses')" },
      { l: 'Discounts & refunds', v: arM(c.discounts + c.refunds), s: `${arM(c.discounts)} discounts · ${arM(c.refunds)} refunds`, icon: '', d: bxDelta(c.discounts + c.refunds, p.discounts + p.refunds), goodUp: false, click: 'arDrillRefunds()' },
      { l: 'Low or out of stock', v: s.low + s.out, s: `${s.low} low · ${s.out} out`, icon: '', tone: s.low + s.out ? 'warn' : '', click: "arSetTab('stock')" },
    ])}
    <div class="ar-two">
      ${arBlock('Sales and profit by day', `<div id="arSumTrend">${uiLoader('Drawing the chart')}</div>`, 'Hover a day to see its figures')}
      ${d.collections ? arBlock('How money came in', arRings(d.collections.byMethod, 'method', 'net', 'received')) : arBlock('Where the stock value is', arRings([{ n: 'Drinks', v: s.drinkValue }, { n: 'Bar ingredients', v: s.barIngredientValue }, { n: 'Kitchen ingredients', v: s.kitchenIngredientValue }], 'n', 'v', 'stock value'))}
    </div>
    ${d.insights.length ? arBlock('What stands out', `<div class="ar-insights">${d.insights.map(i => `<div class="ar-insight ${i.level}" onclick="arSetTab('${i.tab}')"><span class="ar-insight-dot"></span><span>${esc(i.text)}</span><span class="ar-insight-go">›</span></div>`).join('')}</div>`) : ''}
    ${arBlock('This period compared with the previous one', arTable('cmp', [
      { k: 'l', l: 'Figure' }, { k: 'a', l: 'This period', t: 'money' }, { k: 'b', l: 'Previous period', t: 'money' },
      { k: 'c', l: 'Change', f: r => arChg(r.a, r.b, r.good) || '—' },
    ], [['Net sales', c.netSales, p.netSales, true], ['Cost of goods sold', c.cogs, p.cogs, false], ['Gross profit', c.grossProfit, p.grossProfit, true],
        ['Expenses', c.operatingExpenses, p.operatingExpenses, false], ['Net operating profit', c.netOperatingProfit, p.netOperatingProfit, true]]
      .map(([l, a, b, good]) => ({ l, a, b, good })), { title: 'Comparison' }), `Previous period: ${AR.last.period.prevFrom} → ${AR.last.period.prevTo}`)}`;
}

// ════════════════════════════════════════════════
//  SALES
// ════════════════════════════════════════════════
function arSales(d) {
  const s = d.summary;
  const byDay = {};
  d.days.forEach(r => { byDay[r.date] ??= { net: 0, gp: 0 }; byDay[r.date].net += r.net; byDay[r.date].gp += r.grossProfit; });
  const dayKeys = Object.keys(byDay).sort();
  const best = dayKeys.reduce((b, k) => !b || byDay[k].net > byDay[b].net ? k : b, null);
  const pays = [...d.collections.byMethod].sort((a, b) => b.net - a.net);
  const items = [...d.items].sort((a, b) => b.gross - a.gross);
  const staffSel = `<select class="form-input ar-select" onchange="AR.staff=this.value;arResetCache();arLoadTab()">
      <option value="">All staff</option>${d.staffList.map(n => `<option ${AR.staff === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
  return `<div class="ar-filter-row"><span class="muted">Show sales by</span>${staffSel}</div>
    ${arStory([
      s.transactions ? `${s.transactions} order${s.transactions > 1 ? 's' : ''} brought in ${arM(s.grossSales)}${s.discounts + s.refunds ? `; after ${arM(s.discounts + s.refunds)} of discounts and refunds, net sales were ${arM(s.netSales)}` : ''}.` : 'No sales in this period.',
      best && dayKeys.length > 1 ? `The best day was ${best} with ${arM(byDay[best].net)} of net sales.` : '',
      pays.length ? `Most money came by ${pays[0].method} (${arPctOf(pays[0].net, d.collections.net)}% of what was received).` : '',
      items.length ? `The best-selling item was ${items[0].name} (${arQ(items[0].qty)} sold, ${arM(items[0].gross)}).` : '',
    ])}
    ${arTiles([
      { l: 'Net sales', v: arM(s.netSales), s: `${s.transactions} orders`, icon: '', hero: true, click: 'arDrillSales()' },
      { l: 'Gross profit', v: arM(s.grossProfit), s: `${arP(s.grossMargin)} margin`, icon: '', tone: s.grossProfit < 0 ? 'bad' : '' },
      { l: 'Discounts & refunds', v: arM(s.discounts + s.refunds), icon: '', click: 'arDrillRefunds()' },
      { l: 'Average order', v: s.transactions ? arM(s.grossSales / s.transactions) : '—', icon: '' },
    ])}
    ${arBlock('Sales and profit by day', arDailyColumns(d.days), 'Hover a day to see net sales and gross profit')}
    ${arBlock('Day by day', arTable('days', [
      { k: 'date', l: 'Date' }, { k: 'source', l: 'Area', f: r => r.source === 'kitchen' ? 'Kitchen' : 'Bar' },
      { k: 'transactions', l: 'Orders', t: 'qty', sum: true }, { k: 'gross', l: 'Sales', t: 'money', sum: true },
      { k: 'discounts', l: 'Discounts', t: 'money', sum: true, detail: true }, { k: 'refunds', l: 'Refunds', t: 'money', sum: true, detail: true },
      { k: 'net', l: 'Net sales', t: 'money', sum: true }, { k: 'cost', l: 'Cost of goods', t: 'money', sum: true, detail: true },
      { k: 'grossProfit', l: 'Gross profit', t: 'money', sum: true },
      { k: 'margin', l: 'Margin', t: 'pct', f: r => r.margin === null ? `<span class="muted" title="Some items sold this day have no cost recorded">unknown</span>` : arP(r.margin) },
      { k: 'staff', l: 'Staff', detail: true },
    ], d.days, { title: 'Sales by day', rowClick: 'arDayClick' }), 'Click a day to see every sale')}
    <div class="ar-two">
      ${arBlock('How customers paid', arRings(pays, 'method', 'net', 'received'))}
      ${arBlock('Best-selling items', arHBars(items, 'name', 'gross'))}
    </div>
    ${arMore('Sales by staff', arTable('staff', [{ k: 'staff', l: 'Staff' }, { k: 'source', l: 'Area' }, { k: 'transactions', l: 'Orders', t: 'qty', sum: true }, { k: 'itemsSold', l: 'Items', t: 'qty', sum: true }, { k: 'gross', l: 'Sales', t: 'money', sum: true }], d.staff, { title: 'Sales by staff' }))}
    ${arMore(`Cash drawer by shift (${d.shifts.length})`, arTable('shiftsSales', AR_SHIFT_COLS, d.shifts, { title: 'Shifts', rowClick: 'arShiftClick', empty: 'No shifts in this period. Staff open a shift from the top bar.' }))}
    ${arMore(`Refunds (${d.refunds.length})`, arTable('refunds', [
      { k: 'date', l: 'Date' }, { k: 'order', l: 'Order' }, { k: 'name', l: 'Item' }, { k: 'total', l: 'Amount', t: 'money', sum: true },
      { k: 'restocked', l: 'Back in stock', f: r => r.restocked ? 'Yes' : 'No' }, { k: 'reason', l: 'Reason' }, { k: 'by', l: 'By' },
    ], d.refunds, { title: 'Refunds', empty: 'No refunds in this period' }))}
    ${arMore(`Discounts (${d.discounts.length})`, arTable('discounts', AR_DISCOUNT_COLS, d.discounts, { title: 'Discounts', empty: 'No discounts in this period' }))}
    ${arMore(`Approved voids (${d.voids.length})`, arTable('voids', [
      { k: 'date', l: 'Approved' }, { k: 'label', l: 'What' }, { k: 'amount', l: 'Amount', t: 'money', sum: true },
      { k: 'reason', l: 'Reason' }, { k: 'requestedBy', l: 'Requested by' }, { k: 'reviewedBy', l: 'Approved by' },
    ], d.voids, { title: 'Voids', empty: 'No voids approved in this period' }))}`;
}

// ════════════════════════════════════════════════
//  PRODUCTS
// ════════════════════════════════════════════════
function arProducts(d) {
  const rows = d.products;
  const sold = rows.filter(r => r.qtySold > 0);
  const sum = k => rows.reduce((a, r) => a + (+r[k] || 0), 0);
  const top = [...sold].sort((a, b) => b.realizedProfit - a.realizedProfit);
  const flagged = rows.filter(r => r.flags.length);
  const rev = sum('netRevenue'), prof = sum('realizedProfit');
  return `${arStory([
      sold.length ? `Drinks earned ${arM(prof)} of profit on ${arM(rev)} of sales — ${arP(arPctOf(prof, rev))} of each sale was kept.` : 'No drinks were sold in this period.',
      top.length ? `The most profitable drink was ${top[0].name}: ${arM(top[0].realizedProfit)} from ${arQ(top[0].qtySold)} sold.` : '',
      flagged.length ? `${flagged.length} product${flagged.length > 1 ? 's need' : ' needs'} attention (${[...new Set(flagged.flatMap(f => f.flags))].join(', ').toLowerCase()}).` : 'No product needs attention.',
      `If all drinks in stock were sold at today's prices, they would add ${arM(sum('potentialProfit'))} of profit (not earned yet).`,
    ])}
    ${arTiles([
      { l: 'Profit earned on drinks', v: arM(prof), icon: '', hero: true },
      { l: 'Drink sales', v: arM(rev), s: `${arQ(sum('qtySold'))} units sold`, icon: '' },
      { l: 'Average margin', v: arP(arPctOf(prof, rev)) },
      { l: 'Need attention', v: flagged.length, icon: '', tone: flagged.length ? 'warn' : 'good' },
    ])}
    ${arBlock('Profit earned by product', arHBars(top.map(r => ({ ...r, p: Math.max(0, r.realizedProfit) })), 'name', 'p'))}
    ${arBlock('All products', arTable('products', [
      { k: 'name', l: 'Product', f: r => `<strong>${esc(r.name)}</strong>${arFlags(r.flags)}`, csv: r => r.name },
      { k: 'qtySold', l: 'Sold', t: 'qty', sum: true }, { k: 'price', l: 'Price', t: 'money' }, { k: 'avgCost', l: 'Avg cost', t: 'money' },
      { k: 'margin', l: 'Margin', t: 'pct' }, { k: 'netRevenue', l: 'Sales', t: 'money', sum: true }, { k: 'realizedProfit', l: 'Profit earned', t: 'money', sum: true },
      { k: 'remaining', l: 'In stock', t: 'qty', sum: true },
      { k: 'profitPerUnit', l: 'Profit / unit', t: 'money', detail: true }, { k: 'minCost', l: 'Cheapest cost', t: 'money', detail: true }, { k: 'maxCost', l: 'Highest cost', t: 'money', detail: true },
      { k: 'purchasedQty', l: 'Bought (period)', t: 'qty', detail: true }, { k: 'purchasedCost', l: 'Paid (period)', t: 'money', detail: true },
      { k: 'cogs', l: 'Cost of goods', t: 'money', sum: true, detail: true }, { k: 'remainingCost', l: 'Stock value', t: 'money', sum: true, detail: true },
      { k: 'potentialProfit', l: 'Potential profit', t: 'money', sum: true, detail: true }, { k: 'lastPurchase', l: 'Last bought', detail: true }, { k: 'lastSale', l: 'Last sold', detail: true },
    ], rows, { title: 'Products', search: ['name'] }), 'Profit / unit = price − average purchase cost · Profit earned = sales − cost of the units sold')}
    ${d.legacyLines ? `<div class="ar-note">${d.legacyLines} sale line(s) came from the old Quick Sale system; they count in sales totals but not in this list.</div>` : ''}`;
}

// ════════════════════════════════════════════════
//  STOCK
// ════════════════════════════════════════════════
function arStock(d) {
  const s = d.summary;
  const kinds = [['all', 'All'], ['bar_item', 'Drinks'], ['bar_ingredient', 'Bar ingredients'], ['kitchen_ingredient', 'Kitchen ingredients']];
  const kindLabel = { bar_item: 'Drink', bar_ingredient: 'Bar ingredient', kitchen_ingredient: 'Kitchen ingredient' };
  const items = (AR.stockKind === 'all' ? d.items : d.items.filter(i => i.kind === AR.stockKind)).map(i => Object.assign({}, i, {
    purchased: i.flows.purchased, sold: i.flows.sold + i.flows.usedInRecipes, wasted: i.flows.wasted,
    returned: i.flows.voidReturned + i.flows.refundReturned, adjusted: i.flows.adjusted + i.flows.countAdjusted,
  }));
  const groups = [['Drinks', s.drinkValue], ['Bar ingredients', s.barIngredientValue], ['Kitchen ingredients', s.kitchenIngredientValue]].map(([name, v]) => ({ name, v }));
  const attention = d.items.filter(i => i.status !== 'ok' || i.missingCost);
  return `${arStory([
      `Stock on hand is worth ${arM(s.costValue)} at purchase cost` + (groups.filter(g => g.v > 0).length > 1 ? ` (${groups.filter(g => g.v > 0).map(g => `${g.name.toLowerCase()} ${arM(g.v)}`).join(', ')}).` : '.'),
      `Selling all the drinks at today's prices would bring ${arM(s.sellValue)}, which is ${arM(s.potentialProfit)} more than they cost — profit not earned yet.`,
      s.low + s.out ? `${s.low} item(s) are running low and ${s.out} are out of stock.` : 'Nothing is low or out of stock.',
      s.wastedValue ? `${arM(s.wastedValue)} of stock was wasted or broken in this period.` : '',
      s.unexplainedItems ? `${s.unexplainedItems} item(s) hold ${arM(s.unexplainedValue)} of stock that no record explains — a stock count settles this.` : '',
    ])}
    ${arTiles([
      { l: 'Total stock value', v: arM(s.costValue), s: 'at purchase cost', icon: '', hero: true },
      { l: 'Could sell for', v: arM(s.sellValue), s: 'drinks at today\'s prices', icon: '' },
      { l: 'Potential profit', v: arM(s.potentialProfit), s: 'not earned yet', icon: '' },
      { l: 'Low / out of stock', v: `${s.low} / ${s.out}`, icon: '', tone: s.low + s.out ? 'warn' : 'good' },
    ])}
    <div class="ar-two">
      ${arBlock('Where the stock value is', arRings(groups, 'name', 'v', 'stock value'))}
      ${arBlock('Quantities on hand', `<div class="ar-chips">${s.quantities.map(q => `<span class="ar-chip-static">${arQ(q.quantity)} ${esc(q.unit)} <span class="muted">· ${q.items} item${q.items > 1 ? 's' : ''}</span></span>`).join('') || '—'}</div><div class="ar-block-sub" style="margin-top:8px">Different units are never added together</div>`)}
    </div>
    ${attention.length ? arBlock('Needs attention', arTable('stockAttention', [
      { k: 'name', l: 'Item' }, { k: 'kind', l: 'Type', f: r => kindLabel[r.kind] }, { k: 'current', l: 'In stock', t: 'qty', f: r => `${arQ(r.current)} ${esc(r.unit)}` },
      { k: 'minStock', l: 'Minimum', t: 'qty' }, { k: 'status', l: 'Problem', f: r => [r.status === 'out' ? 'Out of stock' : r.status === 'low' ? 'Running low' : r.status === 'negative' ? 'Negative stock' : '', r.missingCost ? 'No purchase cost' : ''].filter(Boolean).join(' · ') },
    ], attention, { title: 'Needs attention' })) : ''}
    ${arBlock('Stock on hand', `<div class="ar-chips" style="margin-bottom:10px">${kinds.map(([k, l]) => `<button class="ar-chip ${AR.stockKind === k ? 'active' : ''}" onclick="AR.stockKind='${k}';arLoadTab()">${l}</button>`).join('')}</div>` + arTable('stock', [
      { k: 'name', l: 'Item', f: r => `<strong>${esc(r.name)}</strong><div class="muted" style="font-size:11px">${kindLabel[r.kind]}</div>`, csv: r => r.name },
      { k: 'expectedClosing', l: 'Quantity', t: 'qty', f: r => `${arQ(r.expectedClosing)} <span class="muted">${esc(r.unit)}</span>` },
      { k: 'unitCost', l: 'Avg cost', t: 'money' }, { k: 'closingValue', l: 'Value', t: 'money', sum: true },
      { k: 'sellValue', l: 'Could sell for', t: 'money', sum: true },
      { k: 'status', l: 'Status', f: r => r.status === 'ok' ? '<span class="ar-flag good">OK</span>' : `<span class="ar-flag ${r.status === 'low' ? '' : 'bad'}">${{ low: 'Low', out: 'Out', negative: 'Negative' }[r.status]}</span>` },
      { k: 'opening', l: 'Opening', t: 'qty', detail: true }, { k: 'purchased', l: 'Bought', t: 'qty', detail: true }, { k: 'sold', l: 'Sold / used', t: 'qty', detail: true },
      { k: 'wasted', l: 'Wasted', t: 'qty', detail: true }, { k: 'returned', l: 'Returned', t: 'qty', detail: true }, { k: 'adjusted', l: 'Adjusted', t: 'qty', detail: true },
      { k: 'physicalCount', l: 'Counted', t: 'qty', detail: true }, { k: 'variance', l: 'Count difference', t: 'qty', detail: true },
      { k: 'potentialProfit', l: 'Potential profit', t: 'money', sum: true, detail: true }, { k: 'unexplained', l: 'Unexplained', t: 'qty', detail: true },
    ], items, { title: 'Stock', search: ['name'] }), 'Values use the current average purchase cost. "Show all columns" adds the movements: opening + bought − sold − wasted + returned ± adjusted = quantity now.')}
    ${arStockMovements(d.movements)}`;
}

// Every stock movement record in the period (shared by the Stock tab and the exports)
const AR_MOVE_COLS = [
  { k: 'at', l: 'When', f: r => `${esc(r.date)} <span class="muted">${esc(r.time)}</span>`, csv: r => r.at },
  { k: 'name', l: 'Item', f: r => `<strong>${esc(r.name)}</strong><div class="muted" style="font-size:11px">${esc(r.kind)}</div>`, csv: r => r.name },
  { k: 'typeLabel', l: 'What happened' },
  { k: 'qty', l: 'Quantity', t: 'qty', f: r => `<span class="${r.qty < 0 ? 'ar-bad' : 'ar-good'}">${r.qty > 0 ? '+' : ''}${arQ(r.qty)}</span> <span class="muted">${esc(r.unit)}</span>`, csv: r => r.qty },
  { k: 'value', l: 'Value', t: 'money', sum: true, f: r => `${arM(r.value)}${r.valueEstimated ? ' <span class="muted" title="No cost was saved on this record; today\'s average cost is used">est.</span>' : ''}`, csv: r => r.value },
  { k: 'by', l: 'By' },
  { k: 'reason', l: 'Reason / note', detail: true }, { k: 'order', l: 'Order', detail: true }, { k: 'supplier', l: 'Supplier', detail: true },
];
// was this list of the report on screen shortened by the server? → { shown, total, action }
function arLimited(list, action) {
  const l = AR.last && AR.last.limited && AR.last.limited[list];
  return l ? { shown: l.shown, total: l.total, action } : null;
}
function arStockMovements(m) {
  if (!m) return '';
  return arBlock(`Stock movement records (${m.count})`,
    `${m.byType.length ? `<div class="ar-chips" style="margin-bottom:10px">${m.byType.map(t => `<span class="ar-chip-static">${esc(t.type)} <span class="muted">· ${t.records} · ${[t.in ? '+' + arM(t.in) : '', t.out ? '−' + arM(t.out) : ''].filter(Boolean).join(' / ') || arM(0)}</span></span>`).join('')}</div>` : ''}` +
    arTable('moves', AR_MOVE_COLS, m.rows, { title: 'Stock movements', search: ['name', 'typeLabel', 'reason', 'by', 'order'], limit: 50, empty: 'No stock moved in this period', limited: arLimited('movements', 'stock') }),
    `Every time stock went in or out — ${arM(m.valueIn)} came in and ${arM(m.valueOut)} went out, at cost${m.estimated ? ` · ${m.estimated} older record(s) had no saved cost and use today's average cost (est.)` : ''}`);
}

// ════════════════════════════════════════════════
//  KITCHEN QUEUE (shown on the Kitchen tab)
// ════════════════════════════════════════════════
// minutes → "4 min" / "1 h 20 min" / "2 days"
function arMin(v) {
  if (v === null || v === undefined) return '—';
  const m = Math.round(+v);
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;
  return `${Math.round(m / 1440)} day${m >= 2160 ? 's' : ''}`;
}
const AR_QUEUE_COLS = [
  { k: 'date', l: 'When', f: r => `${esc(r.date)} <span class="muted">${esc(r.time)}</span>`, csv: r => `${r.date} ${r.time}` },
  { k: 'order', l: 'Order', f: r => `<strong>${esc(r.order)}</strong>${r.table ? `<div class="muted" style="font-size:11px">${esc(r.table)}</div>` : ''}`, csv: r => r.order },
  { k: 'dishes', l: 'Dishes' },
  { k: 'statusLabel', l: 'Status', f: r => `<span class="ar-flag ${r.status === 'served' ? 'good' : r.status === 'rejected' ? 'bad' : ''}">${esc(r.statusLabel)}</span>` },
  { k: 'waited', l: 'Waited', t: 'qty', f: r => arMin(r.waited) }, { k: 'cooking', l: 'Cooking', t: 'qty', f: r => arMin(r.cooking) },
  { k: 'readyIn', l: 'Ready after', t: 'qty', f: r => r.readyIn === null ? '—' : `<span class="${r.late ? 'ar-bad' : ''}">${arMin(r.readyIn)}</span> <span class="muted">/ ${r.estimated} min promised</span>` },
  { k: 'handover', l: 'Ready → served', t: 'qty', f: r => arMin(r.handover), detail: true }, { k: 'total', l: 'Total time', t: 'qty', f: r => arMin(r.total), detail: true },
  { k: 'acceptedBy', l: 'Accepted by', detail: true }, { k: 'servedBy', l: 'Served by', detail: true }, { k: 'rejectReason', l: 'Reject reason', detail: true },
];
function arKitchenQueue(q) {
  if (!q) return '';
  const s = q.summary;
  if (!s.tickets) return arBlock('Kitchen queue', `<div class="ar-empty">No kitchen tickets in this period</div>`);
  return `<div class="ar-group">Kitchen queue — how fast orders were handled</div>
    ${arStory([
      `${s.tickets} kitchen ticket${s.tickets > 1 ? 's' : ''} (${s.portions} portion${s.portions > 1 ? 's' : ''}): ${s.served} served${s.rejected ? `, ${s.rejected} rejected` : ''}${s.open ? `, ${s.open} still open` : ''}.`,
      s.avgReadyIn !== null ? `A typical order was ready ${arMin(s.avgReadyIn)} after it was sent to the kitchen; it waited ${arMin(s.avgWaited)} before the kitchen accepted it and took ${arMin(s.avgCooking)} to cook.` : '',
      s.onTimePct !== null ? `${arP(s.onTimePct)} of orders were ready within the time promised${s.late ? ` — ${s.late} were late` : ''}.` : '',
      s.busiestHour ? `The busiest hour was ${s.busiestHour}.` : '',
    ])}
    ${arTiles([
      { l: 'Kitchen tickets', v: s.tickets, s: `${s.served} served${s.rejected ? ` · ${s.rejected} rejected` : ''}`, icon: '', hero: true },
      { l: 'Typical time to ready', v: arMin(s.avgReadyIn), s: 'sent → ready', icon: '' },
      { l: 'On time', v: s.onTimePct === null ? '—' : arP(s.onTimePct), s: s.late ? `${s.late} late` : 'none late', icon: '', tone: s.late ? 'warn' : 'good' },
      { l: 'Typical wait to accept', v: arMin(s.avgWaited), s: `then ${arMin(s.avgCooking)} cooking`, icon: '' },
    ])}
    <div class="ar-two">
      ${arBlock('Tickets by hour', bxColumns({ categories: q.byHour.map(h => h.hour), series: [{ name: 'Tickets', values: q.byHour.map(h => h.tickets) }], fmt: v => `${v} ticket${v === 1 ? '' : 's'}`, height: 180, emptyText: 'No tickets' }))}
      ${arBlock('Dishes ordered', arTable('queueDishes', [
        { k: 'dish', l: 'Dish' }, { k: 'portions', l: 'Portions', t: 'qty', sum: true }, { k: 'avgReadyIn', l: 'Average ready after', t: 'qty', f: r => arMin(r.avgReadyIn) },
      ], q.byDish, { title: 'Dishes in the queue' }))}
    </div>
    ${arBlock('Every kitchen ticket', arTable('queue', AR_QUEUE_COLS, q.rows, { title: 'Kitchen queue', search: ['order', 'dishes', 'table'], limit: 50, limited: arLimited('queue', 'kitchen') }),
      'Waited = sent → accepted · Cooking = started → ready · "Ready after" in red = later than promised')}`;
}

// ════════════════════════════════════════════════
//  CASH BOOK (shown on the Expenses & Cash tab, Owner only)
// ════════════════════════════════════════════════
const AR_CASHBOOK_COLS = [
  { k: 'date', l: 'Date' },
  { k: 'typeLabel', l: 'Type', f: r => `${esc(r.typeLabel)}${r.voided ? ' <span class="ar-flag bad">voided</span>' : ''}`, csv: r => r.typeLabel + (r.voided ? ' (voided)' : '') },
  { k: 'amount', l: 'Amount', t: 'money', f: r => `<span class="${r.voided ? 'muted' : r.direction === 'in' ? 'ar-good' : r.direction === 'out' ? 'ar-bad' : ''}" ${r.voided ? 'style="text-decoration:line-through"' : ''}>${r.direction === 'in' ? '+' : r.direction === 'out' ? '−' : ''}${arM(r.amount)}</span>`, csv: r => r.voided ? 0 : (r.direction === 'out' ? -r.amount : r.amount) },
  { k: 'method', l: 'Account', f: r => esc(r.method) + (r.toMethod ? ` → ${esc(r.toMethod)}` : '') },
  { k: 'note', l: 'Note' }, { k: 'by', l: 'Recorded by', detail: true }, { k: 'recordedAt', l: 'Recorded at', detail: true },
];
function arCashBook(cb) {
  if (!cb) return '';
  const t = cb.totals;
  return arBlock(`Cash book (${cb.rows.length})`,
    `${arTiles([
      { l: 'Capital put in', v: arM(t.capital), s: 'raises what the business is worth', icon: '' },
      { l: 'Owner withdrawals', v: arM(t.withdrawals), icon: '' },
      { l: 'Loans', v: arM(t.loansIn), s: `${arM(t.loanRepayments)} repaid`, icon: '' },
      { l: 'Other in / out', v: `${arM(t.otherIn)} / ${arM(t.otherOut)}`, icon: '' },
    ])}` + arTable('cashbook', AR_CASHBOOK_COLS, cb.rows, { title: 'Cash book', search: ['note', 'typeLabel', 'by'], empty: 'No cash book entries in this period. Add them in Cash Book.' }),
    'Money that is neither a sale nor an expense. It changes cash, never profit.', `<button class="ar-link" onclick="showPage('cashbook')">Open Cash Book ›</button>`);
}

// ════════════════════════════════════════════════
//  KITCHEN
// ════════════════════════════════════════════════
function arKitchen(d) {
  const s = d.summary;
  const dishes = d.menu.filter(m => m.qtySold > 0);
  const best = d.mostProfitable[0];
  const topIng = d.ingredients.filter(i => i.usedCost > 0)[0];
  return `${arStory([
      s.revenue ? `The kitchen sold ${arM(s.revenue)} of food. Ingredients used cost ${arM(s.ingredientCost)}, leaving ${arM(s.grossProfit)} of gross profit${s.margin !== null ? ` (${arP(s.margin)})` : ''}.` : 'The kitchen sold nothing in this period.',
      best ? `The most profitable dish was ${best.name}: ${arM(best.grossProfit)}.` : '',
      topIng ? `${topIng.name} was the costliest ingredient: ${arM(topIng.usedCost)} for ${arQ(topIng.usedQty)} ${topIng.unit}.` : '',
      s.dishesWithoutRecipe ? `${s.dishesWithoutRecipe} dish(es) have no recipe, so their ingredient cost is unknown and kitchen profit looks higher than it really is. Add recipes in Kitchen → Recipes.` : '',
      `Kitchen ingredients in stock are worth ${arM(s.ingredientStockValue)}.`,
    ])}
    ${arTiles([
      { l: 'Kitchen sales', v: arM(s.revenue), s: `${arQ(dishes.reduce((a, m) => a + m.qtySold, 0))} portions`, icon: '', hero: true },
      { l: 'Ingredients used', v: arM(s.ingredientCost), icon: '' },
      { l: 'Kitchen profit', v: arM(s.grossProfit), s: s.margin !== null ? `${arP(s.margin)} margin` : '', icon: '', tone: s.grossProfit < 0 ? 'bad' : '' },
      { l: 'Dishes without recipe', v: s.dishesWithoutRecipe, icon: '', tone: s.dishesWithoutRecipe ? 'warn' : 'good' },
    ])}
    ${arBlock('Dishes', arTable('menu', [
      { k: 'name', l: 'Dish', f: r => `<strong>${esc(r.name)}</strong>${arFlags(r.flags)}`, csv: r => r.name },
      { k: 'qtySold', l: 'Sold', t: 'qty', sum: true }, { k: 'price', l: 'Price', t: 'money' }, { k: 'portionCost', l: 'Cost / portion', t: 'money' },
      { k: 'portionMargin', l: 'Margin', t: 'pct' }, { k: 'netRevenue', l: 'Sales', t: 'money', sum: true }, { k: 'grossProfit', l: 'Profit', t: 'money', sum: true },
      { k: 'profitPerPortion', l: 'Profit / portion', t: 'money', detail: true }, { k: 'ingredientCost', l: 'Ingredient cost', t: 'money', sum: true, detail: true },
    ], d.menu, { title: 'Dishes', rowClick: 'arDishClick' }), 'Click a dish to see what each ingredient costs')}
    ${arBlock('Ingredients', arTable('ingredients', [
      { k: 'name', l: 'Ingredient', f: r => `<strong>${esc(r.name)}</strong><div class="muted" style="font-size:11px">used in ${r.usedInRecipes.length ? esc(r.usedInRecipes.join(', ')) : 'no recipe'}</div>`, csv: r => r.name },
      { k: 'usedQty', l: 'Used', t: 'qty', f: r => `${arQ(r.usedQty)} <span class="muted">${esc(r.unit)}</span>` }, { k: 'usedCost', l: 'Cost of use', t: 'money', sum: true },
      { k: 'expectedClosing', l: 'Left', t: 'qty', f: r => `${arQ(r.expectedClosing)} <span class="muted">${esc(r.unit)}</span>` }, { k: 'closingValue', l: 'Stock value', t: 'money', sum: true },
      { k: 'status', l: 'Status', f: r => r.status === 'ok' ? '<span class="ar-flag good">OK</span>' : `<span class="ar-flag ${r.status === 'low' ? '' : 'bad'}">${r.status}</span>` },
      { k: 'avgCost', l: 'Avg cost / unit', t: 'money', detail: true }, { k: 'purchased', l: 'Bought', t: 'qty', detail: true }, { k: 'purchaseValue', l: 'Paid', t: 'money', sum: true, detail: true },
      { k: 'wasted', l: 'Wasted', t: 'qty', detail: true }, { k: 'lastPriceChange', l: 'Last price change', t: 'money', detail: true }, { k: 'priceImpact', l: 'Effect on this period', t: 'money', detail: true },
    ], d.ingredients, { title: 'Ingredients', empty: 'No kitchen ingredients recorded yet.' }), 'Ingredients carry cost only — the profit belongs to the dishes that use them')}
    ${arKitchenQueue(d.queue)}`;
}

// ════════════════════════════════════════════════
//  PURCHASES
// ════════════════════════════════════════════════
function arPurchases(d) {
  const owedNow = d.suppliers.reduce((a, x) => a + Math.max(0, x.balance), 0);
  const suppliersInPeriod = d.bySupplier.filter(x => x.key !== 'Not recorded');
  return `${arStory([
      d.count ? `${arM(d.total)} of stock was bought in ${d.count} deliver${d.count > 1 ? 'ies' : 'y'}${suppliersInPeriod.length ? ` from ${suppliersInPeriod.length} supplier(s)` : ''}. ${arM(d.paidNow)} was paid on delivery${d.owedFromPeriod ? ` and ${arM(d.owedFromPeriod)} was left unpaid` : ''}.` : 'No stock was bought in this period.',
      d.bySupplier.length ? `The biggest supplier was ${d.bySupplier[0].key} (${arM(d.bySupplier[0].total)}).` : '',
      owedNow ? `In total, the business currently owes suppliers ${arM(owedNow)}.` : 'No money is owed to suppliers.',
      'Stock purchases are not expenses: they become a cost only when the stock is sold or used.',
    ])}
    ${arTiles([
      { l: 'Stock bought', v: arM(d.total), s: `${d.count} deliveries`, icon: '', hero: true },
      { l: 'Paid on delivery', v: arM(d.paidNow), icon: '' },
      { l: 'Left unpaid', v: arM(d.owedFromPeriod), icon: '', tone: d.owedFromPeriod ? 'warn' : '' },
      { l: 'Owed to suppliers now', v: arM(owedNow), icon: '', tone: owedNow ? 'bad' : 'good', click: "showPage('suppliers')" },
    ])}
    <div class="ar-two">
      ${arBlock('Bought from', arHBars(d.bySupplier, 'key', 'total'))}
      ${arBlock('Biggest items', arHBars(d.byItem, 'key', 'total'))}
    </div>
    ${arBlock('Deliveries', arTable('purchases', [
      { k: 'date', l: 'Date' }, { k: 'supplier', l: 'Supplier' }, { k: 'name', l: 'Item' },
      { k: 'qty', l: 'Quantity', t: 'qty', f: r => r.packs ? esc(r.packs) : `${arQ(r.qty)} <span class="muted">${esc(r.unit)}</span>`, csv: r => r.qty },
      { k: 'total', l: 'Total', t: 'money', sum: true }, { k: 'owed', l: 'Still owed', t: 'money', sum: true, f: r => r.owed > 0 ? `<span class="ar-bad">${arM(r.owed)}</span>` : '—' },
      { k: 'reference', l: 'Invoice', detail: true }, { k: 'typeLabel', l: 'Type', detail: true }, { k: 'unitCost', l: 'Cost / unit', t: 'money', detail: true },
      { k: 'amountPaid', l: 'Paid', t: 'money', sum: true, detail: true }, { k: 'paymentMethod', l: 'Paid with', detail: true }, { k: 'by', l: 'Recorded by', detail: true },
    ], d.lines, { title: 'Deliveries', search: ['name', 'supplier', 'reference'], empty: 'No stock bought in this period' }))}
    ${arMore('Supplier balances (all time)', arTable('supBal', [
      { k: 'supplier', l: 'Supplier' }, { k: 'bought', l: 'Bought', t: 'money', sum: true }, { k: 'paid', l: 'Paid', t: 'money', sum: true, f: r => arM(r.paidOnDelivery + r.paidLater), csv: r => r.paidOnDelivery + r.paidLater },
      { k: 'balance', l: 'Still owed', t: 'money', sum: true }, { k: 'lastPurchase', l: 'Last delivery' },
    ], d.suppliers, { title: 'Supplier balances', empty: 'No suppliers recorded yet' }))}
    ${arMore('Price paid per unit over time', arTable('ranges', [
      { k: 'name', l: 'Item' }, { k: 'purchases', l: 'Deliveries', t: 'qty' }, { k: 'cheapest', l: 'Cheapest', t: 'money' }, { k: 'highest', l: 'Highest', t: 'money' },
      { k: 'weightedAvg', l: 'Average', t: 'money' }, { k: 'last', l: 'Last bought' },
    ], d.costRanges, { title: 'Cost ranges' }))}`;
}

// ════════════════════════════════════════════════
//  EXPENSES & CASH
// ════════════════════════════════════════════════
const AR_EXP_COLS = [
  { k: 'date', l: 'Date' }, { k: 'category', l: 'Category' }, { k: 'description', l: 'Description', f: r => `${esc(r.description)}${r.looksLikeStock ? ' <span class="ar-flag" title="Looks like a stock purchase">stock?</span>' : ''}` },
  { k: 'method', l: 'Paid with', f: r => esc(r.method || 'Not recorded') }, { k: 'amount', l: 'Amount', t: 'money', sum: true }, { k: 'by', l: 'Recorded by', detail: true },
];
function arExpenses(d) {
  const c = d.cash, ho = c.handover;
  const cats = d.byCategory;
  const cf = d.cashFlow;
  return `${arStory([
      d.total ? `Running costs were ${arM(d.total)}${d.salaries ? ` (of which salaries ${arM(d.salaries)})` : ''}${cats.length ? `; the biggest was ${cats[0].category} at ${arM(cats[0].total)}` : ''}.` : 'No expenses were recorded in this period.',
      `After expenses, the net operating profit is ${arM(d.profit.netOperatingProfit)} (before tax).`,
      ho.closed ? `In ${ho.closed} closed shift(s), ${arM(ho.expected)} was expected in the drawer and ${arM(ho.counted)} was counted — ${ho.difference === 0 ? 'it matches' : (ho.difference < 0 ? 'short by ' : 'over by ') + arM(Math.abs(ho.difference))}.` : 'No shift was closed, so the cash drawer was not checked in this period.',
      `Overall, ${arM(cf.in)} came in and ${arM(cf.out)} went out (net ${arM(cf.net)}), including owner withdrawals, capital and loans, which never count as profit.`,
      d.possibleDoubleCount.length ? `${d.possibleDoubleCount.length} expense(s) look like stock purchases; if those goods went into stock, record them as purchases instead.` : '',
    ])}
    ${arTiles([
      { l: 'Expenses', v: arM(d.total), s: d.salaries ? `incl. ${arM(d.salaries)} salaries` : 'running costs', icon: '', hero: true },
      { l: 'Net operating profit', v: arM(d.profit.netOperatingProfit), s: 'before tax', icon: '', tone: d.profit.netOperatingProfit < 0 ? 'bad' : '' },
      { l: 'Cash drawer', v: ho.closed ? (ho.difference === 0 ? 'Matches' : `${ho.difference < 0 ? 'Short' : 'Over'} ${arM(Math.abs(ho.difference))}`) : 'Not checked', icon: '', tone: ho.closed && ho.difference !== 0 ? 'warn' : '' },
      { l: 'Net cash movement', v: arM(cf.net), s: `${arM(cf.in)} in · ${arM(cf.out)} out`, icon: '' },
    ])}
    <div class="ar-two">
      ${arBlock('Expenses by category', cats.length <= 4 ? arRings(cats, 'category', 'total', 'expenses') : arHBars(cats, 'category', 'total'))}
      ${arBlock('Money by account', arTable('cashflow', [
        { k: 'method', l: 'Account' }, { k: 'in', l: 'In', t: 'money', sum: true }, { k: 'out', l: 'Out', t: 'money', sum: true }, { k: 'net', l: 'Net', t: 'money', sum: true },
      ], cf.byMethod, { title: 'Money by account' }))}
    </div>
    ${arBlock('Expense records', arTable('expenses', AR_EXP_COLS, d.lines, { title: 'Expenses', search: ['description', 'category'], empty: 'No expenses in this period' }))}
    ${arMore(`Cash drawer by shift (${d.shifts.length})`, arTable('shiftsExp', AR_SHIFT_COLS, d.shifts, { title: 'Shifts', rowClick: 'arShiftClick', empty: 'No shifts in this period' }))}
    ${arMore('Every money movement', arTable('cashflowRows', [
      { k: 'direction', l: 'In / out', f: r => r.direction === 'in' ? '<span class="ar-good">In</span>' : '<span class="ar-bad">Out</span>' }, { k: 'what', l: 'What' }, { k: 'method', l: 'Account' }, { k: 'amount', l: 'Amount', t: 'money' },
    ], cf.rows, { title: 'Cash flow' }))}
    ${arCashBook(d.cashBook)}
    <div class="ar-note">${esc(d.notRecorded.taxes)}</div>`;
}

// ════════════════════════════════════════════════
//  BUSINESS WORTH (Owner only)
// ════════════════════════════════════════════════
const AR_ACCOUNT_LABEL = { 'Not recorded': 'Paid with no account recorded', Mixed: 'Mixed payments (not split)' };
function arWorth(d) {
  const e = d.end, s = d.start, x = d.explained, o = e.owner;
  const owns = [
    { n: 'Money in accounts', v: Math.max(0, e.money) }, { n: 'Stock (at cost)', v: e.stock.value },
    { n: 'Equipment', v: e.equipmentValue }, { n: 'Customers owe', v: e.customerDebts.amount },
  ];
  const changeRows = [
    ['Worth at the start', s.worth, 'worth on ' + s.asOf, 'total'],
    ['Capital put in', x.capital, 'new money from the owner raises the worth', ''],
    ['Starting balances recorded', x.startingBalances, 'money that was already in the accounts', ''],
    ['Equipment brought in by the owner', x.equipmentBroughtIn, '', ''],
    ['Stock added with no payment recorded', x.stockWithoutPayment, 'opening stock or purchases with no payment entered', ''],
    ['Owner withdrawals', -x.withdrawals, 'money the owner took out lowers the worth', ''],
    ['Profit made (net operating profit)', x.profit, 'what the business earned after all costs', ''],
    ['Other differences', x.other, 'stock counts, cost changes, things not recorded', ''],
    ['Worth at the end', e.worth, 'worth on ' + e.asOf, 'total'],
  ].filter(r => r[3] === 'total' || Math.round(r[1]) !== 0).map(([l, v, n, k]) => ({ l, v, n, k }));
  return `${arStory([
      `On ${e.asOf} the business is worth ${arM(e.worth)}: it owns ${arM(e.owns)} and owes ${arM(e.owes)}.`,
      d.change ? `That is ${d.change > 0 ? 'up' : 'down'} ${arM(Math.abs(d.change))} since ${s.asOf}${x.capital ? `, including ${arM(x.capital)} of new capital` : ''}${x.profit ? ` and ${arM(x.profit)} of profit` : ''}.` : `It has not changed since ${s.asOf}.`,
      `The owner has put in ${arM(o.putIn)} and taken out ${arM(o.withdrawals)}.`,
      !e.hasStartingBalances ? 'No starting balance is recorded for any account, so money that was already in the till, MoMo or bank before BarMS is not counted. Add it once in Cash Book → Record money movement → Starting balance.' : '',
      e.negativeAccounts.length ? `${e.negativeAccounts.join(', ')} shows less than zero — a starting balance is missing or a payment was recorded from the wrong account.` : '',
    ])}
    ${arTiles([
      { l: 'Business worth', v: arM(e.worth), s: 'what it owns − what it owes', icon: '', hero: true, d: s.worth ? bxDelta(e.worth, s.worth) : undefined },
      { l: 'It owns', v: arM(e.owns), s: 'money, stock, equipment, debts', icon: '' },
      { l: 'It owes', v: arM(e.owes), s: `${arM(e.supplierDebt)} suppliers · ${arM(e.loans)} loans`, icon: '', tone: e.owes ? 'warn' : 'good' },
      { l: 'Owner put in', v: arM(o.putIn), s: `${arM(o.withdrawals)} taken out`, icon: '' },
    ])}
    <div class="ar-two">
      ${arBlock('What the business owns', arRings(owns, 'n', 'v', 'owns'))}
      ${arBlock('How the worth changed in this period', arTable('worthChange', [
        { k: 'l', l: '', f: r => r.k === 'total' ? `<strong>${esc(r.l)}</strong>` : `${esc(r.l)}${r.n ? `<div class="muted" style="font-size:11px">${esc(r.n)}</div>` : ''}`, csv: r => r.l },
        { k: 'v', l: 'Amount', t: 'money', f: r => r.k === 'total' ? `<strong>${arM(r.v)}</strong>` : `<span class="${r.v < 0 ? 'ar-bad' : 'ar-good'}">${r.v > 0 ? '+' : ''}${arM(r.v)}</span>`, csv: r => r.v },
      ], changeRows, { title: 'Change in worth' }))}
    </div>
    ${arBlock('Everything it owns and owes', arTable('worthLines', [
      { k: 'group', l: '' }, { k: 'item', l: 'Item', f: r => `${esc(r.item)}${r.note ? `<div class="muted" style="font-size:11px">${esc(r.note)}</div>` : ''}`, csv: r => r.item },
      { k: 'value', l: 'Value', t: 'money', f: r => `<span class="${r.value < 0 ? 'ar-bad' : ''}">${arM(r.value)}</span>`, csv: r => r.value },
    ], arWorthLines(e), { title: 'Business worth' }), `On ${e.asOf}. Stock is valued at what it cost; it could sell for ${arM(e.stock.sellValue)}.`,
      `<button class="ar-link" onclick="showPage('cashbook')">Equipment & starting balances ›</button>`)}
    ${arBlock('The owner\'s side', arTable('worthOwner', [
      { k: 'l', l: '' }, { k: 'v', l: 'Amount', t: 'money' },
    ], [
      { l: 'Capital put in', v: o.capital }, { l: 'Starting balances', v: o.startingBalances }, { l: 'Equipment brought in', v: o.equipmentBroughtIn },
      { l: 'Stock added with no payment recorded', v: o.stockWithoutPayment }, { l: 'Taken out by the owner', v: -o.withdrawals },
      { l: 'Earned and kept by the business (and anything not recorded)', v: o.keptByBusiness }, { l: 'Business worth', v: e.worth },
    ], { title: "Owner's side" }), 'Everything the business is worth either came from the owner or was earned and kept by the business.')}`;
}
// one flat list (screen, PDF and Excel)
function arWorthLines(e) {
  const L = [];
  e.accounts.forEach(a => L.push({ group: 'Owns · money', item: AR_ACCOUNT_LABEL[a.account] || a.account, value: a.balance, note: a.starting ? `starting balance ${arM(a.starting)} + ${arM(a.in)} in − ${arM(a.out)} out` : `${arM(a.in)} in − ${arM(a.out)} out` }));
  [['Drinks', e.stock.drinks], ['Bar ingredients', e.stock.barIngredients], ['Kitchen ingredients', e.stock.kitchenIngredients]].forEach(([n, v]) => v && L.push({ group: 'Owns · stock at cost', item: n, value: v }));
  e.equipment.forEach(q => L.push({ group: 'Owns · assets', item: q.name, value: q.value, note: `${q.category} · since ${q.acquired} · ${q.fundedBy === 'owner' ? 'brought in by the owner' : 'bought by the business'}` }));
  if (e.customerDebts.amount) L.push({ group: 'Owns · customers owe', item: `${e.customerDebts.count} unpaid customer debt(s)`, value: e.customerDebts.amount });
  e.suppliers.forEach(x => L.push({ group: 'Owes · suppliers', item: x.supplier, value: -x.owed }));
  if (e.loans) L.push({ group: 'Owes · loans', item: 'Loans not yet repaid', value: -e.loans });
  return L;
}
// Summary tab: business worth (money + stock + assets + customer debts − debts) at the end of the period
async function arFillSummaryWorth() {
  const el = document.getElementById('arSumWorth');
  if (!el) return;
  const res = await arGet('worth');
  if (!res || !res.ok || !res.data || !res.data.end) { el.innerHTML = ''; return; }
  const e = res.data.end, ch = res.data.change;
  el.innerHTML = arTiles([
    { l: 'Business worth', v: arM(e.worth), s: `on ${e.asOf}${ch ? ` · ${ch > 0 ? 'up' : 'down'} ${arM(Math.abs(ch))} in the period` : ''}`, icon: '', hero: true, click: "arSetTab('worth')" },
    { l: 'Assets', v: arM(e.equipmentValue), s: `${e.equipment.length} item${e.equipment.length === 1 ? '' : 's'} recorded`, icon: '', click: "showPage('assets')" },
    { l: 'Money in accounts', v: arM(e.money), s: 'all accounts', icon: '', click: "arSetTab('worth')" },
    { l: 'Owed (suppliers + loans)', v: arM(e.owes), icon: '', tone: e.owes ? 'warn' : 'good', click: "arSetTab('worth')" },
  ]);
}