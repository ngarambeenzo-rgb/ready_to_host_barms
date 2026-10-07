/* ═══════════════════════════════════════════════════
   BARMS PRO — ar-export.js
   Whole Advanced Report as:
     • a professional printable document (Print / Save as PDF)
     • an Excel workbook (.xlsx, one sheet per section)
   Every figure comes from api/reports.php — the same numbers
   as the screen.
   Depends on: utils.js, api.js, advanced-reports.js
═══════════════════════════════════════════════════ */

const AR_SECTIONS = ['overview', 'sales', 'products', 'stock', 'kitchen', 'purchases', 'expenses', 'issues', 'quality'];

// Fetch every section for the current period and scope (uses the page cache)
async function arFetchAll() {
  // business worth is the owner's information
  const sections = AR_SECTIONS.concat(typeof session !== 'undefined' && session.role === 'Owner' ? ['worth'] : []);
  // the printed report and the workbook hold every record
  const results = await Promise.all(sections.map(a => arGet(a, { detail: 'all' })));
  const bad = results.find(r => !r.ok);
  if (bad) throw new Error(bad.error || 'Could not load the report');
  const out = {};
  sections.forEach((a, i) => { out[a] = results[i].data; });
  out.period = results[0].period;
  out.scope = results[0].scope;
  out.generatedAt = results[0].generatedAt;
  const s = await apiGet('misc', 'settings_get');
  out.barName = (s.ok && s.data.barName) || 'BarMS';
  out.location = (s.ok && s.data.location) || '';
  return out;
}

const xrMin = v => typeof arMin === 'function' ? arMin(v) : (v === null || v === undefined ? '—' : Math.round(v) + ' min');

// ── formatting shared by the document and the narrative ─
const xr = {
  m: v => v === null || v === undefined ? '—' : 'RWF ' + Math.round(+v).toLocaleString('en-US'),
  q: v => v === null || v === undefined ? '—' : (+v).toLocaleString('en-US', { maximumFractionDigits: 2 }),
  p: v => v === null || v === undefined ? '—' : (+v).toFixed(1) + '%',
  chg: (a, b) => (b === null || b === undefined || +b === 0) ? null : Math.round((a - b) / Math.abs(b) * 1000) / 10,
  date: d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
  scope: s => ({ all: 'Bar and kitchen', bar: 'Bar only', kitchen: 'Kitchen only' }[s] || s),
};

/** Plain-language summary of the period, sentence by sentence (used on screen and in the report). */
function arNarrative(R) {
  const o = R.overview, c = o.current, p = o.previous, st = o.stock;
  const S = [];
  const chg = xr.chg(c.netSales, p.netSales);
  S.push(`From ${xr.date(R.period.from)} to ${xr.date(R.period.to)}, the business sold ${xr.m(c.grossSales)} worth of drinks and food in ${c.transactions} order${c.transactions === 1 ? '' : 's'}.`
    + (c.discounts + c.refunds > 0 ? ` After ${c.discounts ? xr.m(c.discounts) + ' in discounts' : ''}${c.discounts && c.refunds ? ' and ' : ''}${c.refunds ? xr.m(c.refunds) + ' in refunds' : ''}, net sales were ${xr.m(c.netSales)}.` : ` Net sales were ${xr.m(c.netSales)}.`)
    + (chg !== null ? ` That is ${Math.abs(chg)}% ${chg >= 0 ? 'more' : 'less'} than the previous period (${xr.m(p.netSales)}).` : ''));
  S.push(`The goods sold cost ${xr.m(c.cogs)}, so the business kept ${xr.m(c.grossProfit)} as gross profit — ${xr.p(c.grossMargin)} of every franc sold.`);
  S.push(c.operatingExpenses > 0
    ? `After ${xr.m(c.operatingExpenses)} of operating expenses, the business made a net operating ${c.netOperatingProfit >= 0 ? 'profit' : 'loss'} of ${xr.m(Math.abs(c.netOperatingProfit))} (before tax).`
    : `No operating expenses were recorded, so the net operating profit is also ${xr.m(c.netOperatingProfit)} (before tax).`);
  if (o.collections) S.push(`Money actually received was ${xr.m(o.collections.net)}${o.collections.byMethod.length ? ' (' + o.collections.byMethod.map(m => `${m.method} ${xr.m(m.net)}`).join(', ') + ')' : ''}.`);
  S.push(`Stock on hand is worth ${xr.m(st.costValue)} at purchase cost. If all the drinks in stock sold at today's prices they would bring ${xr.m(st.sellValue)} — ${xr.m(st.potentialProfit)} of profit that is not earned yet.`);
  const owe = [];
  if (o.supplierDebts > 0) owe.push(`the business owes suppliers ${xr.m(o.supplierDebts)}`);
  if (o.customerDebts.outstanding > 0) owe.push(`customers owe ${xr.m(o.customerDebts.outstanding)}`);
  if (owe.length) S.push(owe.join(' and ').replace(/^./, x => x.toUpperCase()) + '.');
  if (o.cashHandover.closed) S.push(`In ${o.cashHandover.closed} closed shift${o.cashHandover.closed > 1 ? 's' : ''}, ${xr.m(o.cashHandover.expected)} was expected in the cash drawer and ${xr.m(o.cashHandover.counted)} was counted (${o.cashHandover.difference === 0 ? 'no difference' : (o.cashHandover.difference < 0 ? 'short by ' : 'over by ') + xr.m(Math.abs(o.cashHandover.difference))}).`);
  if (o.issues.open) S.push(`${o.issues.open} point${o.issues.open > 1 ? 's need' : ' needs'} review.`);
  return S;
}

// ════════════════════════════════════════════════
//  FULL REPORT DOCUMENT (print / PDF)
// ════════════════════════════════════════════════
function xrTable(cols, rows, opts = {}) {
  const num = c => ['m', 'q', 'p'].includes(c.t);
  const cell = (c, r) => { const v = c.f ? c.f(r) : r[c.k]; return c.t === 'm' ? xr.m(v) : c.t === 'q' ? xr.q(v) : c.t === 'p' ? xr.p(v) : (v === null || v === undefined || v === '' ? '—' : esc(String(v))); };
  const list = opts.limit ? rows.slice(0, opts.limit) : rows;
  if (!list.length) return `<p class="empty">${opts.empty || 'Nothing recorded in this period.'}</p>`;
  const totals = cols.some(c => c.sum) ? `<tfoot><tr>${cols.map((c, i) => `<td class="${num(c) ? 'n' : ''}">${c.sum ? (c.t === 'm' ? xr.m(list.reduce((a, r) => a + (+((c.f ? c.f(r) : r[c.k])) || 0), 0)) : xr.q(list.reduce((a, r) => a + (+((c.f ? c.f(r) : r[c.k])) || 0), 0))) : (i === 0 ? 'Total' : '')}</td>`).join('')}</tr></tfoot>` : '';
  return `<table><thead><tr>${cols.map(c => `<th class="${num(c) ? 'n' : ''}">${c.l}</th>`).join('')}</tr></thead>
    <tbody>${list.map(r => `<tr>${cols.map(c => `<td class="${num(c) ? 'n' : ''}">${cell(c, r)}</td>`).join('')}</tr>`).join('')}</tbody>${totals}</table>
    ${opts.limit && rows.length > opts.limit ? `<p class="note">Showing the top ${opts.limit} of ${rows.length}. The Excel workbook contains all of them.</p>` : ''}`;
}
function xrKpis(items) {
  return `<div class="kpis">${items.map(k => `<div class="kpi ${k.tone || ''}"><div class="kl">${k.l}</div><div class="kv">${k.v}</div>${k.s ? `<div class="ks">${k.s}</div>` : ''}</div>`).join('')}</div>`;
}
function xrChangeText(a, b, goodUp = true) {
  const c = xr.chg(a, b);
  if (c === null) return '';
  const good = goodUp ? c >= 0 : c <= 0;
  return `<span class="${good ? 'up' : 'down'}">${c >= 0 ? '▲' : '▼'} ${Math.abs(c)}%</span> vs previous`;
}
// Charts in the printed report use the same kit as the screen (bx-charts.js)
function xrDailyChart(days) { return typeof arDailyColumns === 'function' ? arDailyColumns(days) : xrDailyChartOld(days); }
function xrHBars(rows, labelKey, valueKey) { return bxHBars({ items: rows.map(r => ({ label: r[labelKey], value: +r[valueKey] || 0 })), fmt: v => xr.m(v) }); }
function xrRings(rows, labelKey, valueKey, center) { return bxRings({ items: rows.map(r => ({ label: r[labelKey], value: +r[valueKey] || 0 })), fmt: v => xr.m(v), centerLabel: center }); }
// (older inline-SVG versions kept below as a fallback)
function xrDailyChartOld(days) {
  const byDay = {};
  days.forEach(r => { byDay[r.date] ??= { net: 0, gp: 0 }; byDay[r.date].net += r.net; byDay[r.date].gp += r.grossProfit; });
  const keys = Object.keys(byDay).sort();
  if (!keys.length) return '';
  const W = 680, H = 170, pad = 30, max = Math.max(1, ...keys.map(k => byDay[k].net));
  const bw = Math.min(46, (W - pad) / keys.length - 6);
  const bars = keys.map((k, i) => {
    const x = pad + i * ((W - pad) / keys.length) + 3, hN = byDay[k].net / max * (H - 30), hG = Math.max(0, byDay[k].gp) / max * (H - 30);
    return `<rect x="${x}" y="${H - 20 - hN}" width="${bw}" height="${hN}" fill="#C7D2FE"/><rect x="${x}" y="${H - 20 - hG}" width="${bw}" height="${hG}" fill="#059669"/>
      <text x="${x + bw / 2}" y="${H - 6}" font-size="9" text-anchor="middle" fill="#64748B">${k.slice(8)}/${k.slice(5, 7)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}"><line x1="${pad}" y1="${H - 20}" x2="${W}" y2="${H - 20}" stroke="#CBD5E1"/>
    <text x="0" y="12" font-size="9" fill="#64748B">${xr.m(max)}</text>${bars}</svg>
    <p class="legend"><i style="background:#059669"></i>Gross profit <i style="background:#C7D2FE"></i>Rest of net sales (cost of goods)</p>`;
}
function xrHBarsOld(rows, labelKey, valueKey) {
  const list = rows.filter(r => +r[valueKey] > 0).slice(0, 8);
  if (!list.length) return '';
  const max = Math.max(...list.map(r => +r[valueKey]));
  return `<div class="hbars">${list.map(r => `<div class="hb"><span class="hl">${esc(r[labelKey])}</span><span class="ht"><span style="width:${+r[valueKey] / max * 100}%"></span></span><span class="hv">${xr.m(r[valueKey])}</span></div>`).join('')}</div>`;
}

function arBuildReportHtml(R) {
  const o = R.overview, c = o.current, p = o.previous, st = o.stock;
  const S = R.sales, P = R.products.products, K = R.kitchen, PU = R.purchases, E = R.expenses;
  const issues = R.issues.issues.filter(i => ['open', 'review'].includes(i.status));
  const sec = (n, title, intro, body) => `<section><h2><span>${n}</span>${title}</h2><p class="intro">${intro}</p>${body}</section>`;
  const sold = P.filter(x => x.qtySold > 0);
  const flagged = P.filter(x => x.flags.length);
  const stockRows = R.stock.items.map(i => ({ ...i, kindL: { bar_item: 'Drink', bar_ingredient: 'Bar ingredient', kitchen_ingredient: 'Kitchen ingredient' }[i.kind] }));

  const body = `
  <header class="cover">
    <div class="brand">${esc(R.barName)}</div>
    ${R.location ? `<div class="loc">${esc(R.location)}</div>` : ''}
    <h1>Business Report</h1>
    <div class="period">${xr.date(R.period.from)} – ${xr.date(R.period.to)}</div>
    <div class="meta">${xr.scope(R.scope)} · ${R.period.days} day${R.period.days > 1 ? 's' : ''} · compared with ${xr.date(R.period.prevFrom)} – ${xr.date(R.period.prevTo)}</div>
    <div class="meta">Generated ${esc(R.generatedAt)} by ${esc(session.fullName || '')}</div>
    <ol class="toc"><li>Summary</li><li>Sales</li><li>Profit by product</li><li>Stock, its value and movements</li><li>Kitchen and its queue</li><li>Purchases and suppliers</li><li>Expenses, cash and cash book</li>${R.worth ? "<li>Business worth</li>" : ""}<li>Points to review</li></ol>
  </header>

  ${sec(1, 'Summary', 'The most important figures for the period, in plain words.', `
    <div class="story">${arNarrative(R).map(s => `<p>${esc(s)}</p>`).join('')}</div>
    ${xrKpis([
      { l: 'Net sales', v: xr.m(c.netSales), s: xrChangeText(c.netSales, p.netSales) },
      { l: 'Gross profit', v: xr.m(c.grossProfit), s: `${xr.p(c.grossMargin)} margin`, tone: c.grossProfit < 0 ? 'bad' : 'good' },
      { l: 'Operating expenses', v: xr.m(c.operatingExpenses), s: xrChangeText(c.operatingExpenses, p.operatingExpenses, false) },
      { l: 'Net operating profit', v: xr.m(c.netOperatingProfit), s: 'before tax', tone: c.netOperatingProfit < 0 ? 'bad' : 'good' },
      { l: 'Money received', v: o.collections ? xr.m(o.collections.net) : '—', s: 'after refunds' },
      { l: 'Stock value (cost)', v: xr.m(st.costValue), s: `could sell for ${xr.m(st.sellValue)}` },
      { l: 'Owed to suppliers', v: xr.m(o.supplierDebts), tone: o.supplierDebts > 0 ? 'warn' : '' },
      { l: 'Customers owe', v: xr.m(o.customerDebts.outstanding) },
      ...(R.worth ? [
        { l: 'Business worth', v: xr.m(R.worth.end.worth), s: `on ${xr.date(R.worth.end.asOf)}`, tone: R.worth.end.worth < 0 ? 'bad' : 'good' },
        { l: 'Assets recorded', v: xr.m(R.worth.end.equipmentValue), s: `${R.worth.end.equipment.length} item(s)` },
        { l: 'Money in accounts', v: xr.m(R.worth.end.money) },
        { l: 'Owed (suppliers + loans)', v: xr.m(R.worth.end.owes) },
      ] : []),
    ])}
    <h3>This period compared with the previous one</h3>
    ${xrTable([{ k: 'l', l: 'Figure' }, { k: 'a', l: 'This period', t: 'm' }, { k: 'b', l: 'Previous period', t: 'm' }, { k: 'c', l: 'Change' }],
      [['Gross sales', c.grossSales, p.grossSales], ['Discounts', c.discounts, p.discounts], ['Refunds', c.refunds, p.refunds], ['Net sales', c.netSales, p.netSales],
       ['Cost of goods sold', c.cogs, p.cogs], ['Gross profit', c.grossProfit, p.grossProfit], ['Operating expenses', c.operatingExpenses, p.operatingExpenses], ['Net operating profit', c.netOperatingProfit, p.netOperatingProfit]]
      .map(([l, a, b]) => ({ l, a, b, c: xr.chg(a, b) === null ? '—' : (xr.chg(a, b) >= 0 ? '+' : '') + xr.chg(a, b) + '%' })))}
    ${o.insights.length ? `<h3>What stands out</h3><ul class="insights">${o.insights.map(i => `<li class="in-${i.level}">${esc(i.text)}</li>`).join('')}</ul>` : ''}`)}

  ${sec(2, 'Sales', 'What was sold each day, how customers paid, and who served them. Net sales = sales − discounts − refunds. Gross profit = net sales − cost of the goods sold.', `
    ${xrKpis([
      { l: 'Orders', v: xr.q(S.summary.transactions) }, { l: 'Gross sales', v: xr.m(S.summary.grossSales) },
      { l: 'Discounts + refunds', v: xr.m(S.summary.discounts + S.summary.refunds) }, { l: 'Net sales', v: xr.m(S.summary.netSales) },
    ])}
    ${xrDailyChart(S.days)}
    <h3>Day by day</h3>
    ${xrTable([{ k: 'date', l: 'Date', f: r => xr.date(r.date) }, { k: 'source', l: 'Area', f: r => r.source === 'kitchen' ? 'Kitchen' : 'Bar' }, { k: 'transactions', l: 'Orders', t: 'q', sum: 1 },
      { k: 'gross', l: 'Sales', t: 'm', sum: 1 }, { k: 'discRef', l: 'Discounts + refunds', t: 'm', sum: 1, f: r => r.discounts + r.refunds }, { k: 'net', l: 'Net sales', t: 'm', sum: 1 },
      { k: 'grossProfit', l: 'Gross profit', t: 'm', sum: 1 }, { k: 'margin', l: 'Margin', t: 'p' }], [...S.days].reverse())}
    <div class="two">
      <div><h3>How customers paid</h3>${xrRings(S.collections.byMethod, 'method', 'net', 'received')}${xrTable([{ k: 'method', l: 'Method' }, { k: 'orders', l: 'Orders', t: 'q', sum: 1 }, { k: 'net', l: 'Received', t: 'm', sum: 1 }], S.collections.byMethod)}</div>
      <div><h3>Sales by staff</h3>${xrTable([{ k: 'staff', l: 'Staff' }, { k: 'transactions', l: 'Orders', t: 'q', sum: 1 }, { k: 'gross', l: 'Sales', t: 'm', sum: 1 }], S.staff)}</div>
    </div>
    <h3>Best-selling items</h3>
    ${xrHBars([...S.items].sort((a, b) => b.gross - a.gross), 'name', 'gross')}
    ${S.shifts.length ? `<h3>Cash drawer by shift</h3>${xrTable([{ k: 'user', l: 'Staff' }, { k: 'openedAt', l: 'Opened' }, { k: 'expected', l: 'Expected cash', t: 'm', sum: 1 }, { k: 'counted', l: 'Counted', t: 'm', sum: 1 }, { k: 'difference', l: 'Difference', t: 'm', sum: 1 }], S.shifts)}` : ''}
    ${S.refunds.length ? `<h3>Refunds</h3>${xrTable([{ k: 'date', l: 'Date', f: r => xr.date(r.date) }, { k: 'order', l: 'Order' }, { k: 'name', l: 'Item' }, { k: 'total', l: 'Amount', t: 'm', sum: 1 }, { k: 'reason', l: 'Reason' }, { k: 'by', l: 'By' }], S.refunds)}` : ''}
    ${S.discounts.length ? `<h3>Discounts</h3>${xrTable([{ k: 'date', l: 'Date', f: r => xr.date(r.date) }, { k: 'order', l: 'Order' }, { k: 'discount', l: 'Discount', t: 'm', sum: 1 }, { k: 'reason', l: 'Reason' }, { k: 'by', l: 'Given by' }], S.discounts)}` : ''}`)}

  ${sec(3, 'Profit by product', 'How much each drink earns. Profit per unit = selling price − average purchase cost. Earned profit = what was actually made on the units sold in this period.', `
    ${xrKpis([
      { l: 'Profit earned on drinks', v: xr.m(P.reduce((a, r) => a + r.realizedProfit, 0)), tone: 'good' },
      { l: 'Drink sales (net)', v: xr.m(P.reduce((a, r) => a + r.netRevenue, 0)) },
      { l: 'Products needing attention', v: flagged.length, tone: flagged.length ? 'warn' : '' },
    ])}
    <h3>Products sold, most profitable first</h3>
    ${xrTable([{ k: 'name', l: 'Product' }, { k: 'qtySold', l: 'Sold', t: 'q', sum: 1 }, { k: 'price', l: 'Price', t: 'm' }, { k: 'avgCost', l: 'Avg cost', t: 'm' },
      { k: 'margin', l: 'Margin', t: 'p' }, { k: 'netRevenue', l: 'Sales', t: 'm', sum: 1 }, { k: 'realizedProfit', l: 'Profit earned', t: 'm', sum: 1 }], sold, { empty: 'No drinks sold in this period.' })}
    ${flagged.length ? `<h3>Products needing attention</h3>${xrTable([{ k: 'name', l: 'Product' }, { k: 'flags', l: 'Why', f: r => r.flags.join(', ') }, { k: 'margin', l: 'Margin', t: 'p' }, { k: 'remainingCost', l: 'Stock value', t: 'm' }], flagged)}` : ''}`)}

  ${sec(4, 'Stock and its value', 'What is on the shelves now, what it cost, and what it could sell for. Potential profit is only earned when the stock is sold. Values use the current average purchase cost.', `
    ${xrKpis([
      { l: 'Total stock value', v: xr.m(st.costValue), tone: 'good' }, { l: 'Drinks', v: xr.m(st.drinkValue) },
      { l: 'Bar ingredients', v: xr.m(st.barIngredientValue) }, { l: 'Kitchen ingredients', v: xr.m(st.kitchenIngredientValue) },
      { l: 'Could sell for (drinks)', v: xr.m(st.sellValue) }, { l: 'Potential profit', v: xr.m(st.potentialProfit), s: 'not earned yet' },
      { l: 'Low / out of stock', v: `${st.low} / ${st.out}`, tone: st.low + st.out ? 'warn' : '' }, { l: 'Wasted / broken', v: xr.m(st.wastedValue) },
    ])}
    <h3>Stock on hand</h3>
    ${xrTable([{ k: 'name', l: 'Item' }, { k: 'kindL', l: 'Type' }, { k: 'expectedClosing', l: 'Quantity', f: r => `${xr.q(r.expectedClosing)} ${r.unit}` },
      { k: 'unitCost', l: 'Avg cost', t: 'm' }, { k: 'closingValue', l: 'Value', t: 'm', sum: 1 }, { k: 'sellValue', l: 'Could sell for', t: 'm', sum: 1 },
      { k: 'status', l: 'Status', f: r => ({ ok: 'OK', low: 'Low', out: 'Out', negative: 'Negative' }[r.status]) + (r.missingCost ? ' · no cost' : '') }], stockRows)}
    <h3>Movements in the period</h3>
    ${xrTable([{ k: 'name', l: 'Item' }, { k: 'opening', l: 'Opening', t: 'q' }, { k: 'b', l: 'Bought', t: 'q', f: r => r.flows.purchased }, { k: 's', l: 'Sold / used', t: 'q', f: r => r.flows.sold + r.flows.usedInRecipes },
      { k: 'w', l: 'Wasted', t: 'q', f: r => r.flows.wasted }, { k: 'expectedClosing', l: 'Closing', t: 'q' }, { k: 'physicalCount', l: 'Counted', t: 'q' }, { k: 'variance', l: 'Difference', t: 'q' }], stockRows)}
    <h3>Every stock movement record</h3>
    <p class="note">Each time stock went in or out. Value is at purchase cost${R.stock.movements.estimated ? '; "est." = no cost was saved on the record, so today\'s average cost is used' : ''}.</p>
    ${xrTable([{ k: 'at', l: 'When', f: r => `${xr.date(r.date)} ${r.time}` }, { k: 'name', l: 'Item' }, { k: 'typeLabel', l: 'What happened' },
      { k: 'qty', l: 'Quantity', f: r => `${r.qty > 0 ? '+' : ''}${xr.q(r.qty)} ${r.unit}` }, { k: 'value', l: 'Value', t: 'm', sum: 1 }, { k: 'e', l: '', f: r => r.valueEstimated ? 'est.' : '' },
      { k: 'by', l: 'By' }, { k: 'reason', l: 'Note' }], R.stock.movements.rows, { empty: 'No stock moved in this period.' })}`)}

  ${sec(5, 'Kitchen', 'What the kitchen sold, what the ingredients cost, and which dishes earn the most. Revenue belongs to the dishes; ingredients only carry cost.', `
    ${xrKpis([
      { l: 'Kitchen revenue', v: xr.m(K.summary.revenue) }, { l: 'Ingredients used', v: xr.m(K.summary.ingredientCost) },
      { l: 'Kitchen gross profit', v: xr.m(K.summary.grossProfit), s: `${xr.p(K.summary.margin)} margin`, tone: K.summary.grossProfit < 0 ? 'bad' : 'good' },
      { l: 'Ingredient stock value', v: xr.m(K.summary.ingredientStockValue) },
    ])}
    ${K.summary.dishesWithoutRecipe ? `<p class="warn">${K.summary.dishesWithoutRecipe} dish(es) have no recipe, so their ingredient cost is unknown and kitchen profit is overstated.</p>` : ''}
    <h3>Dishes</h3>
    ${xrTable([{ k: 'name', l: 'Dish' }, { k: 'qtySold', l: 'Sold', t: 'q', sum: 1 }, { k: 'price', l: 'Price', t: 'm' }, { k: 'portionCost', l: 'Cost / portion', t: 'm' },
      { k: 'portionMargin', l: 'Margin', t: 'p' }, { k: 'netRevenue', l: 'Sales', t: 'm', sum: 1 }, { k: 'grossProfit', l: 'Profit', t: 'm', sum: 1 }], K.menu)}
    <h3>Ingredients</h3>
    ${xrTable([{ k: 'name', l: 'Ingredient' }, { k: 'usedQty', l: 'Used', f: r => `${xr.q(r.usedQty)} ${r.unit}` }, { k: 'usedCost', l: 'Cost of use', t: 'm', sum: 1 },
      { k: 'expectedClosing', l: 'Left', f: r => `${xr.q(r.expectedClosing)} ${r.unit}` }, { k: 'closingValue', l: 'Stock value', t: 'm', sum: 1 }], K.ingredients, { empty: 'No kitchen ingredients recorded.' })}
    <h3>Kitchen queue — how fast orders were handled</h3>
    ${K.queue.summary.tickets ? `${xrKpis([
      { l: 'Kitchen tickets', v: K.queue.summary.tickets, s: `${K.queue.summary.served} served · ${K.queue.summary.rejected} rejected` },
      { l: 'Typical time to ready', v: xrMin(K.queue.summary.avgReadyIn) },
      { l: 'Ready on time', v: xr.p(K.queue.summary.onTimePct), s: `${K.queue.summary.late} late`, tone: K.queue.summary.late ? 'warn' : 'good' },
      { l: 'Typical wait to accept', v: xrMin(K.queue.summary.avgWaited), s: `then ${xrMin(K.queue.summary.avgCooking)} cooking` },
    ])}
    ${xrTable([{ k: 'date', l: 'When', f: r => `${xr.date(r.date)} ${r.time}` }, { k: 'order', l: 'Order' }, { k: 'dishes', l: 'Dishes' }, { k: 'statusLabel', l: 'Status' },
      { k: 'waited', l: 'Waited', f: r => xrMin(r.waited) }, { k: 'cooking', l: 'Cooking', f: r => xrMin(r.cooking) },
      { k: 'readyIn', l: 'Ready after', f: r => r.readyIn === null ? '—' : `${xrMin(r.readyIn)} / ${r.estimated} min${r.late ? ' (late)' : ''}` }, { k: 'servedBy', l: 'Served by' }], K.queue.rows)}` : '<p class="empty">No kitchen tickets in this period.</p>'}`)}

  ${sec(6, 'Purchases and suppliers', 'Stock bought in the period and what is still owed. Purchases are not expenses: they become cost only when the stock is sold or used.', `
    ${xrKpis([
      { l: 'Stock purchased', v: xr.m(PU.total), s: `${PU.count} delivery record(s)` }, { l: 'Paid on delivery', v: xr.m(PU.paidNow) },
      { l: 'Left unpaid', v: xr.m(PU.owedFromPeriod), tone: PU.owedFromPeriod ? 'warn' : '' },
      { l: 'Owed to suppliers now', v: xr.m(PU.suppliers.reduce((a, x) => a + Math.max(0, x.balance), 0)), tone: 'warn' },
    ])}
    <h3>Deliveries</h3>
    ${xrTable([{ k: 'date', l: 'Date', f: r => xr.date(r.date) }, { k: 'supplier', l: 'Supplier' }, { k: 'name', l: 'Item' }, { k: 'qty', l: 'Quantity', f: r => r.packs || `${xr.q(r.qty)} ${r.unit}` },
      { k: 'total', l: 'Total', t: 'm', sum: 1 }, { k: 'owed', l: 'Still owed', t: 'm', sum: 1 }], PU.lines, { empty: 'No stock purchased in this period.' })}
    <h3>Supplier balances</h3>
    ${xrTable([{ k: 'supplier', l: 'Supplier' }, { k: 'bought', l: 'Bought', t: 'm', sum: 1 }, { k: 'paid', l: 'Paid', t: 'm', sum: 1, f: r => r.paidOnDelivery + r.paidLater }, { k: 'balance', l: 'Still owed', t: 'm', sum: 1 }], PU.suppliers, { empty: 'No suppliers recorded.' })}`)}

  ${sec(7, 'Expenses and cash', 'Running costs of the business, and every movement of money. Owner withdrawals, capital and loans change cash but not profit.', `
    ${xrKpis([
      { l: 'Operating expenses', v: xr.m(E.operating) }, { l: 'Salaries', v: xr.m(E.salaries) },
      { l: 'Net operating profit', v: xr.m(E.profit.netOperatingProfit), tone: E.profit.netOperatingProfit < 0 ? 'bad' : 'good' },
      { l: 'Cash check (shifts)', v: E.cash.handover.closed ? xr.m(E.cash.handover.difference) : 'No closed shift', s: E.cash.handover.closed ? `expected ${xr.m(E.cash.handover.expected)}, counted ${xr.m(E.cash.handover.counted)}` : '' },
    ])}
    <div class="two">
      <div><h3>Expenses by category</h3>${xrTable([{ k: 'category', l: 'Category' }, { k: 'total', l: 'Amount', t: 'm', sum: 1 }], E.byCategory)}</div>
      <div><h3>Money in and out by account</h3>${xrTable([{ k: 'method', l: 'Account' }, { k: 'in', l: 'In', t: 'm', sum: 1 }, { k: 'out', l: 'Out', t: 'm', sum: 1 }, { k: 'net', l: 'Net', t: 'm', sum: 1 }], E.cashFlow.byMethod)}</div>
    </div>
    <h3>Expense records</h3>
    ${xrTable([{ k: 'date', l: 'Date', f: r => xr.date(r.date) }, { k: 'category', l: 'Category' }, { k: 'description', l: 'Description' }, { k: 'method', l: 'Paid with' }, { k: 'amount', l: 'Amount', t: 'm', sum: 1 }], E.lines)}
    ${E.cashBook ? `<h3>Cash book — capital, withdrawals, loans</h3>
    ${xrKpis([{ l: 'Capital put in', v: xr.m(E.cashBook.totals.capital), tone: 'good' }, { l: 'Owner withdrawals', v: xr.m(E.cashBook.totals.withdrawals) },
      { l: 'Loans received', v: xr.m(E.cashBook.totals.loansIn) }, { l: 'Loan repayments', v: xr.m(E.cashBook.totals.loanRepayments) }])}
    ${xrTable([{ k: 'date', l: 'Date', f: r => xr.date(r.date) }, { k: 'typeLabel', l: 'Type', f: r => r.typeLabel + (r.voided ? ' (voided)' : '') },
      { k: 'amount', l: 'Amount', t: 'm', f: r => r.voided ? 0 : r.amount }, { k: 'method', l: 'Account', f: r => r.method + (r.toMethod ? ' → ' + r.toMethod : '') }, { k: 'note', l: 'Note' }, { k: 'by', l: 'By' }],
      E.cashBook.rows, { empty: 'No cash book entries in this period.' })}` : ''}`)}

  ${R.worth ? sec(8, 'Business worth', 'Everything the business owns minus everything it owes. New capital raises the worth; owner withdrawals lower it; a loan adds money but also a debt, so it does not change the worth.', `
    ${xrKpis([
      { l: 'Business worth', v: xr.m(R.worth.end.worth), s: `on ${xr.date(R.worth.end.asOf)}`, tone: R.worth.end.worth < 0 ? 'bad' : 'good' },
      { l: 'It owns', v: xr.m(R.worth.end.owns) }, { l: 'It owes', v: xr.m(R.worth.end.owes), tone: R.worth.end.owes ? 'warn' : '' },
      { l: 'Change in the period', v: xr.m(R.worth.change), s: `from ${xr.m(R.worth.start.worth)}` },
    ])}
    <h3>How the worth changed</h3>
    ${xrTable([{ k: 'l', l: '' }, { k: 'v', l: 'Amount', t: 'm' }], arWorthChangeRows(R.worth))}
    <h3>Everything it owns and owes</h3>
    ${xrTable([{ k: 'group', l: '' }, { k: 'item', l: 'Item' }, { k: 'value', l: 'Value', t: 'm', sum: 1 }], arWorthLines(R.worth.end))}
    ${!R.worth.end.hasStartingBalances ? '<p class="warn">No starting balance is recorded for any account, so money that was already in the till, MoMo or bank before BarMS is not counted.</p>' : ''}`) : ''}

  ${sec(R.worth ? 9 : 8, 'Points to review', 'Differences between what BarMS expects and what it holds. An unexplained difference is not proof of wrongdoing — it is often a missing record.', `
    ${issues.length ? `<ul class="issues">${issues.map(i => `<li class="${i.severity}"><strong>${esc(i.title)}</strong>${i.impact !== null ? ` <span class="imp">${xr.m(i.impact)}</span>` : ''}<br><span>${esc(i.evidence)}</span>${i.status === 'review' ? ' <em>(under review)</em>' : ''}</li>`).join('')}</ul>` : '<p class="empty">Nothing needs review. </p>'}
    <h3>Notes on these figures</h3>
    <ul class="notes">${Object.values(R.quality.notRecorded).map(n => `<li>${esc(n)}</li>`).join('')}</ul>`)}
  `;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(R.barName)} — Business Report ${R.period.from} to ${R.period.to}</title>
<style>${BX_CSS}
  .bx-col{break-inside:avoid}.bx-rings{break-inside:avoid}.bx-ring-chart svg{width:150px;height:150px}.bx-ring-chart{width:150px;height:150px}
  @page{size:A4;margin:14mm 12mm 16mm}
  @page{@bottom-left{content:"${esc(R.barName).replace(/"/g, '')} · Business Report · BarMS Pro by IMS";font:9px Arial;color:#94A3B8}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:9px Arial;color:#94A3B8}}
  *{box-sizing:border-box}
  body{margin:0;font:11.5px/1.5 "Segoe UI",Arial,sans-serif;color:#1E293B;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .cover{min-height:250mm;display:flex;flex-direction:column;justify-content:center;padding:0 10mm;border-left:8px solid #1E3A8A}
  .brand{font-size:30px;font-weight:800;color:#1E3A8A}.loc{color:#64748B;font-size:13px}
  h1{font-size:42px;margin:30px 0 6px;color:#0F172A;letter-spacing:-.5px}
  .period{font-size:20px;font-weight:700;color:#334155}.meta{color:#64748B;margin-top:6px}
  .toc{margin-top:40px;columns:2;color:#334155;font-size:13px;line-height:2}
  section{break-before:page}
  h2{font-size:21px;color:#1E3A8A;border-bottom:2px solid #1E3A8A;padding-bottom:6px;margin:0 0 6px;display:flex;align-items:center;gap:10px}
  h2 span{background:#1E3A8A;color:#fff;border-radius:6px;font-size:14px;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center}
  h3{font-size:13.5px;color:#0F172A;margin:18px 0 6px;break-after:avoid}
  .intro{color:#475569;margin:0 0 12px;font-size:11.5px}
  .story{background:#F1F5F9;border-left:4px solid #1E3A8A;border-radius:6px;padding:10px 14px;margin-bottom:14px}
  .story p{margin:5px 0;font-size:12.5px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:8px 0 6px}
  .kpi{border:1px solid #E2E8F0;border-radius:8px;padding:8px 10px;break-inside:avoid}
  .kl{font-size:9px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.04em}
  .kv{font-size:16px;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums}
  .ks{font-size:9.5px;color:#64748B;margin-top:1px}
  .kpi.good .kv{color:#047857}.kpi.bad .kv{color:#DC2626}.kpi.warn .kv{color:#C2410C}
  .up{color:#047857;font-weight:700}.down{color:#DC2626;font-weight:700}
  table{width:100%;border-collapse:collapse;margin:4px 0 6px;font-size:10.5px}
  thead{display:table-header-group}
  th{background:#1E3A8A;color:#fff;text-align:left;padding:5px 6px;font-weight:600;font-size:9.5px}
  td{padding:4px 6px;border-bottom:1px solid #E2E8F0;vertical-align:top}
  tbody tr:nth-child(even) td{background:#F8FAFC}
  tr{break-inside:avoid}
  tfoot td{font-weight:800;border-top:2px solid #1E3A8A;border-bottom:none;background:#fff}
  .n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .empty{color:#94A3B8;font-style:italic}.note{color:#64748B;font-size:9.5px}
  .warn{background:#FFF7ED;color:#9A3412;border-radius:6px;padding:6px 10px}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .legend{font-size:9.5px;color:#64748B;margin:0}.legend i{display:inline-block;width:9px;height:9px;margin:0 4px 0 10px;vertical-align:-1px}
  .hbars{margin:4px 0}.hb{display:grid;grid-template-columns:150px 1fr 100px;gap:8px;align-items:center;margin:3px 0}
  .hl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ht{background:#E2E8F0;border-radius:3px;height:10px}.ht span{display:block;height:10px;background:#1E3A8A;border-radius:3px}.hv{text-align:right;font-variant-numeric:tabular-nums}
  .insights,.issues,.notes{padding-left:18px;margin:6px 0}.insights li,.issues li{margin:5px 0}
  .insights li.in-good::marker{color:#047857}.insights li.in-bad::marker,.issues li.high::marker{color:#DC2626}.insights li.in-warn::marker,.issues li.medium::marker{color:#C2410C}
  .issues li span{color:#475569}.imp{float:right;font-weight:700}.notes{color:#64748B;font-size:10px}
  @media screen{body{background:#E2E8F0}body>*{background:#fff;max-width:210mm;margin:12px auto;padding:14mm 12mm;box-shadow:0 2px 12px rgba(0,0,0,.12)}section{break-before:auto}}
</style></head><body>${body}</body></html>`;
}

// Print the whole report (the browser's print window can "Save as PDF")
async function arPrintFullReport() {
  toast('Preparing the full report…');
  let R;
  try { R = await arFetchAll(); } catch (e) { toast(e.message, 'error'); return; }
  const html = arBuildReportHtml(R);
  let frame = document.getElementById('arReportFrame');
  if (frame) frame.remove();
  frame = document.createElement('iframe');
  frame.id = 'arReportFrame';
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  frame.srcdoc = html;
  frame.onload = () => { setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); }, 300); };
}

// ════════════════════════════════════════════════
//  EXCEL WORKBOOK (.xlsx) — built in the browser
// ════════════════════════════════════════════════
const XL_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function xlCrc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = XL_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
// Minimal ZIP (stored, no compression) — enough for an .xlsx
function xlZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  files.forEach(f => {
    const name = enc.encode(f.name), data = enc.encode(f.data), crc = xlCrc32(data);
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
    parts.push(local, name, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + data.length;
  });
  const cdSize = central.reduce((a, p) => a + p.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const xlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
function xlCol(n) { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
// style ids: 0 normal, 1 header, 2 money, 3 percent, 4 quantity, 5 title, 6 subtitle, 7 total label, 8 total money, 9 total qty
const XL_STYLE = { m: 2, p: 3, q: 4 };
function xlSheet(title, subtitle, cols, rows) {
  const r = [];
  const strCell = (ref, v, s) => `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${xlEsc(v)}</t></is></c>`;
  const numCell = (ref, v, s) => `<c r="${ref}" s="${s}"><v>${+v}</v></c>`;
  r.push(`<row r="1">${strCell('A1', title, 5)}</row>`);
  r.push(`<row r="2">${strCell('A2', subtitle, 6)}</row>`);
  r.push(`<row r="4">${cols.map((c, i) => strCell(xlCol(i) + '4', c.l, 1)).join('')}</row>`);
  rows.forEach((row, ri) => {
    const n = ri + 5;
    r.push(`<row r="${n}">${cols.map((c, i) => {
      const v = c.f ? c.f(row) : row[c.k];
      if (v === null || v === undefined || v === '') return '';
      return (XL_STYLE[c.t] && !isNaN(+v)) ? numCell(xlCol(i) + n, v, XL_STYLE[c.t]) : strCell(xlCol(i) + n, Array.isArray(v) ? v.join(', ') : v);
    }).join('')}</row>`);
  });
  const last = rows.length + 4;
  if (rows.length && cols.some(c => c.sum)) {
    const n = last + 1;
    r.push(`<row r="${n}">${cols.map((c, i) => i === 0 && !c.sum ? strCell(xlCol(i) + n, 'Total', 7)
      : c.sum ? `<c r="${xlCol(i)}${n}" s="${c.t === 'm' ? 8 : 9}"><f>SUM(${xlCol(i)}5:${xlCol(i)}${last})</f></c>` : '').join('')}</row>`);
  }
  const widths = cols.map(c => c.w || (XL_STYLE[c.t] ? 15 : Math.min(45, Math.max(12, c.l.length + 4))));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${r.join('')}</sheetData>
${rows.length ? `<autoFilter ref="A4:${xlCol(cols.length - 1)}${last}"/>` : ''}
</worksheet>`;
}
function xlWorkbook(sheets) {
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0&quot;%&quot;"/><numFmt numFmtId="165" formatCode="#,##0.###"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="15"/><color rgb="FF1E3A8A"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border/><border><top style="thin"><color rgb="FF1E3A8A"/></top></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="3" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1"/>
</cellXfs></styleSheet>`;
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xlEsc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: styles },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml })),
  ];
  return xlZip(files);
}

function arBuildWorkbookSheets(R) {
  const o = R.overview, c = o.current, p = o.previous, st = o.stock;
  const sub = `${R.barName} · ${xr.date(R.period.from)} – ${xr.date(R.period.to)} · ${xr.scope(R.scope)} · generated ${R.generatedAt}`;
  const sheet = (name, title, cols, rows) => ({ name, xml: xlSheet(title, sub, cols, rows) });
  const pct = (a, b) => xr.chg(a, b);
  return [
    sheet('Summary', 'Business summary', [{ k: 'l', l: 'Figure', w: 38 }, { k: 'a', l: 'This period', t: 'm' }, { k: 'b', l: 'Previous period', t: 'm' }, { k: 'c', l: 'Change %', t: 'p' }],
      [['Gross sales', c.grossSales, p.grossSales], ['Discounts', c.discounts, p.discounts], ['Refunds', c.refunds, p.refunds], ['Net sales', c.netSales, p.netSales],
       ['Cost of goods sold', c.cogs, p.cogs], ['Gross profit', c.grossProfit, p.grossProfit], ['Operating expenses', c.operatingExpenses, p.operatingExpenses],
       ['Net operating profit (before tax)', c.netOperatingProfit, p.netOperatingProfit], ['Money received', o.collections ? o.collections.net : null, null],
       ['Stock value at cost', st.costValue, null], ['Stock could sell for (drinks)', st.sellValue, null], ['Potential profit on stock (not earned)', st.potentialProfit, null],
       ['Owed to suppliers', o.supplierDebts, null], ['Customers owe', o.customerDebts.outstanding, null], ['Cash expected (closed shifts)', o.cashHandover.expected, null],
       ['Cash counted (closed shifts)', o.cashHandover.counted, null], ['Cash difference', o.cashHandover.difference, null]]
      .concat(R.worth ? [['Business worth (end of period)', R.worth.end.worth, R.worth.start.worth], ['Assets recorded', R.worth.end.equipmentValue, R.worth.start.equipmentValue],
        ['Money in accounts', R.worth.end.money, R.worth.start.money], ['Owed to suppliers and lenders', R.worth.end.owes, R.worth.start.owes]] : [])
      .map(([l, a, b]) => ({ l, a, b, c: b === null ? null : pct(a, b) })).concat(arNarrative(R).map(t => ({ l: t })))),
    sheet('Daily Sales', 'Sales day by day', [{ k: 'date', l: 'Date' }, { k: 'source', l: 'Area' }, { k: 'staff', l: 'Staff', w: 22 }, { k: 'transactions', l: 'Orders', t: 'q', sum: 1 }, { k: 'itemsSold', l: 'Items', t: 'q', sum: 1 },
      { k: 'gross', l: 'Sales', t: 'm', sum: 1 }, { k: 'discounts', l: 'Discounts', t: 'm', sum: 1 }, { k: 'refunds', l: 'Refunds', t: 'm', sum: 1 }, { k: 'net', l: 'Net sales', t: 'm', sum: 1 },
      { k: 'cost', l: 'Cost of goods', t: 'm', sum: 1 }, { k: 'grossProfit', l: 'Gross profit', t: 'm', sum: 1 }, { k: 'margin', l: 'Margin', t: 'p' }], [...R.sales.days].reverse()),
    sheet('Sale Lines', 'Every item sold', [{ k: 'date', l: 'Date' }, { k: 'time', l: 'Time' }, { k: 'source', l: 'Area' }, { k: 'order', l: 'Order' }, { k: 'name', l: 'Item', w: 28 }, { k: 'staff', l: 'Staff', w: 20 },
      { k: 'qty', l: 'Qty', t: 'q', sum: 1 }, { k: 'unitPrice', l: 'Price', t: 'm' }, { k: 'total', l: 'Total', t: 'm', sum: 1 }, { k: 'cost', l: 'Cost', t: 'm', sum: 1 }, { k: 'costStatus', l: 'Cost basis', f: r => ({ recorded: 'Saved at sale', estimated: 'Estimated (today\'s cost)', unknown: 'Unknown' }[r.costStatus]) }], R.sales.lines),
    sheet('Payments', 'Money received by payment method', [{ k: 'method', l: 'Method' }, { k: 'orders', l: 'Orders', t: 'q', sum: 1 }, { k: 'received', l: 'Received', t: 'm', sum: 1 }, { k: 'refunded', l: 'Refunded', t: 'm', sum: 1 }, { k: 'net', l: 'Net', t: 'm', sum: 1 }], R.sales.collections.byMethod),
    sheet('Products', 'Profit by product', [{ k: 'name', l: 'Product', w: 26 }, { k: 'category', l: 'Type' }, { k: 'qtySold', l: 'Sold', t: 'q', sum: 1 }, { k: 'price', l: 'Price', t: 'm' }, { k: 'avgCost', l: 'Avg cost', t: 'm' },
      { k: 'minCost', l: 'Cheapest cost', t: 'm' }, { k: 'maxCost', l: 'Highest cost', t: 'm' }, { k: 'profitPerUnit', l: 'Profit / unit', t: 'm' }, { k: 'margin', l: 'Margin', t: 'p' },
      { k: 'netRevenue', l: 'Net sales', t: 'm', sum: 1 }, { k: 'cogs', l: 'Cost of goods', t: 'm', sum: 1 }, { k: 'realizedProfit', l: 'Profit earned', t: 'm', sum: 1 },
      { k: 'remaining', l: 'In stock', t: 'q', sum: 1 }, { k: 'remainingCost', l: 'Stock value', t: 'm', sum: 1 }, { k: 'potentialProfit', l: 'Potential profit', t: 'm', sum: 1 },
      { k: 'lastPurchase', l: 'Last bought' }, { k: 'lastSale', l: 'Last sold' }, { k: 'flags', l: 'Attention', w: 30 }], R.products.products),
    sheet('Stock', 'Stock on hand and movements', [{ k: 'name', l: 'Item', w: 26 }, { k: 'kind', l: 'Type', f: r => ({ bar_item: 'Drink', bar_ingredient: 'Bar ingredient', kitchen_ingredient: 'Kitchen ingredient' }[r.kind]) }, { k: 'unit', l: 'Unit' },
      { k: 'opening', l: 'Opening', t: 'q' }, { k: 'b', l: 'Bought', t: 'q', f: r => r.flows.purchased }, { k: 's', l: 'Sold', t: 'q', f: r => r.flows.sold }, { k: 'u', l: 'Used in recipes', t: 'q', f: r => r.flows.usedInRecipes },
      { k: 'w', l: 'Wasted', t: 'q', f: r => r.flows.wasted }, { k: 'expectedClosing', l: 'Closing', t: 'q' }, { k: 'physicalCount', l: 'Counted', t: 'q' }, { k: 'variance', l: 'Difference', t: 'q' },
      { k: 'unitCost', l: 'Avg cost', t: 'm' }, { k: 'closingValue', l: 'Value', t: 'm', sum: 1 }, { k: 'sellValue', l: 'Could sell for', t: 'm', sum: 1 }, { k: 'potentialProfit', l: 'Potential profit', t: 'm', sum: 1 }, { k: 'status', l: 'Status', f: r => ({ ok: 'OK', low: 'Low', out: 'Out of stock', negative: 'Negative' }[r.status]) + (r.missingCost ? ', no cost' : '') }], R.stock.items),
    sheet('Stock Movements', 'Every stock movement record', [{ k: 'date', l: 'Date' }, { k: 'time', l: 'Time' }, { k: 'area', l: 'Area' }, { k: 'kind', l: 'Type' }, { k: 'name', l: 'Item', w: 26 },
      { k: 'typeLabel', l: 'What happened', w: 18 }, { k: 'qty', l: 'Quantity', t: 'q' }, { k: 'unit', l: 'Unit' }, { k: 'value', l: 'Value at cost', t: 'm', sum: 1 }, { k: 'est', l: 'Value basis', f: r => r.valueEstimated ? "Estimated (today's cost)" : 'Saved on the record' },
      { k: 'order', l: 'Order' }, { k: 'supplier', l: 'Supplier' }, { k: 'by', l: 'By', w: 18 }, { k: 'reason', l: 'Note', w: 40 }], R.stock.movements.rows),
    sheet('Kitchen Dishes', 'Kitchen dishes', [{ k: 'name', l: 'Dish', w: 26 }, { k: 'qtySold', l: 'Sold', t: 'q', sum: 1 }, { k: 'price', l: 'Price', t: 'm' }, { k: 'portionCost', l: 'Cost / portion', t: 'm' }, { k: 'portionMargin', l: 'Margin', t: 'p' },
      { k: 'netRevenue', l: 'Sales', t: 'm', sum: 1 }, { k: 'ingredientCost', l: 'Ingredient cost', t: 'm', sum: 1 }, { k: 'grossProfit', l: 'Profit', t: 'm', sum: 1 }, { k: 'flags', l: 'Attention', w: 28 }], R.kitchen.menu),
    sheet('Ingredients', 'Kitchen ingredients', [{ k: 'name', l: 'Ingredient', w: 24 }, { k: 'unit', l: 'Unit' }, { k: 'opening', l: 'Opening', t: 'q' }, { k: 'purchased', l: 'Bought', t: 'q' }, { k: 'purchaseValue', l: 'Paid', t: 'm', sum: 1 },
      { k: 'usedQty', l: 'Used', t: 'q' }, { k: 'usedCost', l: 'Cost of use', t: 'm', sum: 1 }, { k: 'wasted', l: 'Wasted', t: 'q' }, { k: 'expectedClosing', l: 'Left', t: 'q' }, { k: 'avgCost', l: 'Avg cost', t: 'm' },
      { k: 'closingValue', l: 'Stock value', t: 'm', sum: 1 }, { k: 'usedInRecipes', l: 'Used in', w: 30 }], R.kitchen.ingredients),
    sheet('Kitchen Queue', 'Kitchen tickets and timing (minutes)', [{ k: 'date', l: 'Date' }, { k: 'time', l: 'Time' }, { k: 'order', l: 'Order' }, { k: 'table', l: 'Table' }, { k: 'dishes', l: 'Dishes', w: 34 },
      { k: 'statusLabel', l: 'Status' }, { k: 'estimated', l: 'Promised (min)', t: 'q' }, { k: 'waited', l: 'Waited (min)', t: 'q' }, { k: 'cooking', l: 'Cooking (min)', t: 'q' }, { k: 'readyIn', l: 'Ready after (min)', t: 'q' },
      { k: 'handover', l: 'Ready to served (min)', t: 'q' }, { k: 'total', l: 'Total (min)', t: 'q' }, { k: 'late', l: 'Late', f: r => r.readyIn === null ? '' : (r.late ? 'Yes' : 'No') },
      { k: 'acceptedBy', l: 'Accepted by' }, { k: 'servedBy', l: 'Served by' }, { k: 'rejectReason', l: 'Reject reason', w: 30 }], R.kitchen.queue.rows),
    sheet('Purchases', 'Stock deliveries', [{ k: 'date', l: 'Date' }, { k: 'supplier', l: 'Supplier', w: 20 }, { k: 'reference', l: 'Invoice' }, { k: 'name', l: 'Item', w: 24 }, { k: 'typeLabel', l: 'Type' },
      { k: 'packs', l: 'As bought' }, { k: 'qty', l: 'Units', t: 'q', sum: 1 }, { k: 'unitCost', l: 'Cost / unit', t: 'm' }, { k: 'total', l: 'Total', t: 'm', sum: 1 },
      { k: 'amountPaid', l: 'Paid', t: 'm', sum: 1 }, { k: 'owed', l: 'Still owed', t: 'm', sum: 1 }, { k: 'paymentMethod', l: 'Paid with' }, { k: 'by', l: 'Recorded by' }], R.purchases.lines),
    sheet('Suppliers', 'Supplier balances (now)', [{ k: 'supplier', l: 'Supplier', w: 24 }, { k: 'purchases', l: 'Deliveries', t: 'q' }, { k: 'bought', l: 'Bought', t: 'm', sum: 1 }, { k: 'paidOnDelivery', l: 'Paid on delivery', t: 'm', sum: 1 },
      { k: 'paidLater', l: 'Paid later', t: 'm', sum: 1 }, { k: 'balance', l: 'Still owed', t: 'm', sum: 1 }, { k: 'lastPurchase', l: 'Last delivery' }], R.purchases.suppliers),
    sheet('Expenses', 'Expenses', [{ k: 'date', l: 'Date' }, { k: 'source', l: 'Area' }, { k: 'category', l: 'Category' }, { k: 'description', l: 'Description', w: 34 }, { k: 'method', l: 'Paid with' }, { k: 'amount', l: 'Amount', t: 'm', sum: 1 }, { k: 'by', l: 'Recorded by' }], R.expenses.lines),
    sheet('Cash Flow', 'Every movement of money', [{ k: 'direction', l: 'In / out' }, { k: 'what', l: 'What', w: 30 }, { k: 'method', l: 'Account' }, { k: 'amount', l: 'Amount', t: 'm' }], R.expenses.cashFlow.rows),
    ...(R.expenses.cashBook ? [sheet('Cash Book', 'Capital, owner withdrawals, loans and transfers', [{ k: 'date', l: 'Date' }, { k: 'typeLabel', l: 'Type', w: 24 }, { k: 'dir', l: 'In / out', f: r => ({ in: 'In', out: 'Out', move: 'Transfer' }[r.direction]) },
      { k: 'amount', l: 'Amount', t: 'm' }, { k: 'method', l: 'Account' }, { k: 'toMethod', l: 'To account' }, { k: 'note', l: 'Note', w: 40 }, { k: 'by', l: 'Recorded by', w: 18 }, { k: 'v', l: 'Voided', f: r => r.voided ? 'Yes' : '' }], R.expenses.cashBook.rows)] : []),
    ...(R.worth ? [sheet('Business Worth', `Business worth on ${R.worth.end.asOf}`, [{ k: 'group', l: 'Group', w: 24 }, { k: 'item', l: 'Item', w: 34 }, { k: 'value', l: 'Value', t: 'm', sum: 1 }, { k: 'note', l: 'Note', w: 50 }],
      arWorthLines(R.worth.end).concat([{ group: '' }, { group: 'How the worth changed' }], arWorthChangeRows(R.worth).map(r => ({ group: '', item: r.l, value: r.v }))))] : []),
    sheet('Shifts', 'Cash drawer by shift', [{ k: 'user', l: 'Staff', w: 20 }, { k: 'device', l: 'Device', w: 18 }, { k: 'openedAt', l: 'Opened', w: 18 }, { k: 'closedAt', l: 'Closed', w: 18 }, { k: 'openingFloat', l: 'Start cash', t: 'm' },
      { k: 'expected', l: 'Expected', t: 'm', sum: 1 }, { k: 'counted', l: 'Counted', t: 'm', sum: 1 }, { k: 'difference', l: 'Difference', t: 'm', sum: 1 }, { k: 'note', l: 'Note', w: 30 }], R.expenses.shifts),
    sheet('Points to Review', 'Points to review', [{ k: 'severity', l: 'Importance', f: r => ({ high: 'High', medium: 'Medium', low: 'Low' }[r.severity]) }, { k: 'type', l: 'Type', w: 24 }, { k: 'title', l: 'Issue', w: 45 }, { k: 'evidence', l: 'Details', w: 70 }, { k: 'impact', l: 'Possible impact', t: 'm' }, { k: 'status', l: 'Status', f: r => ({ open: 'Open', review: 'Under review', resolved: 'Resolved', dismissed: 'Dismissed' }[r.status]) }, { k: 'note', l: 'Note', w: 30 }], R.issues.issues),
  ];
}

async function arDownloadWorkbook() {
  toast('Preparing the Excel workbook…');
  let R;
  try { R = await arFetchAll(); } catch (e) { toast(e.message, 'error'); return; }
  const blob = xlWorkbook(arBuildWorkbookSheets(R));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${R.barName.replace(/[^\w-]+/g, '_')}_Business_Report_${R.period.from}_to_${R.period.to}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// change in worth, line by line (document and workbook)
function arWorthChangeRows(W) {
  const x = W.explained;
  return [['Worth at the start (' + W.start.asOf + ')', W.start.worth, 1], ['Capital put in', x.capital], ['Starting balances recorded', x.startingBalances],
    ['Equipment brought in by the owner', x.equipmentBroughtIn], ['Stock added with no payment recorded', x.stockWithoutPayment], ['Owner withdrawals', -x.withdrawals],
    ['Profit made (net operating profit)', x.profit], ['Other differences (stock counts, cost changes, not recorded)', x.other], ['Worth at the end (' + W.end.asOf + ')', W.end.worth, 1]]
    .filter(r => r[2] || Math.round(r[1]) !== 0).map(([l, v]) => ({ l, v }));
}