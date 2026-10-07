/* ═══════════════════════════════════════════════════
   BARMS PRO — charts.js
   Charts page: monthly sales, bar vs kitchen share,
   sales vs expenses. Drawn with bx-charts.js.
   Depends on: utils.js, api.js, navigation.js, bx-charts.js
═══════════════════════════════════════════════════ */

const CH_MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  fr: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'],
};
const chMonthKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');

async function loadCharts() {
  const now = new Date();
  const [dashRes, reportRes, expRes] = await Promise.all([
    apiGet('misc', 'dashboard'),
    apiGet('misc', 'report', { type: 'monthly', month: chMonthKey(now) }),
    apiGet('expenses', 'list'),
  ]);
  const monthly = dashRes.ok ? (dashRes.data.monthlySales || []) : [];
  const revFor = mo => monthly.filter(m => m.mo && m.mo.startsWith(mo)).reduce((a, m) => a + (+m.rev || 0), 0);
  const expenses = (expRes.data || []).filter(e => !e.voided);
  const expFor = mo => expenses.filter(e => (e.date || '').startsWith(mo)).reduce((a, e) => a + (+e.amount || 0), 0);
  const L = CH_MONTHS[currentLang === 'fr' ? 'fr' : 'en'];

  // 1. this year, month by month (months not reached yet are left out)
  const yearMonths = [...Array(now.getMonth() + 1)].map((_, i) => new Date(now.getFullYear(), i, 1));
  drawBarChart(yearMonths.map(d => ({ label: L[d.getMonth()], rev: revFor(chMonthKey(d)) })));

  // 2. bar vs kitchen this month
  const sales = (reportRes.data?.sales || []).filter(s => !s.voided);
  const byArea = { Bar: 0, Kitchen: 0 };
  sales.forEach(s => { byArea[s.source === 'kitchen' ? 'Kitchen' : 'Bar'] += +s.total || 0; });
  drawPieChart(byArea);

  // 3. last 6 months: sales and expenses side by side
  const six = [...Array(6)].map((_, i) => new Date(now.getFullYear(), now.getMonth() - 5 + i, 1));
  drawLineChart(six.map(d => ({ label: L[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? ' ' + String(d.getFullYear()).slice(2) : ''), rev: revFor(chMonthKey(d)), exp: expFor(chMonthKey(d)) })));
}

// Monthly sales — one series, no legend (the card title names it)
function drawBarChart(months) {
  const wrap = document.getElementById('barCanvas');
  if (!wrap) return;
  wrap.innerHTML = bxColumns({
    categories: months.map(m => m.label),
    series: [{ name: currentLang === 'fr' ? 'Ventes' : 'Sales', values: months.map(m => m.rev) }],
    fmt: v => fmtRWF(Math.round(v)), height: 220,
    emptyText: currentLang === 'fr' ? 'Aucune vente cette année' : 'No sales this year yet',
  });
}

// Bar vs kitchen — concentric rings, share of this month's sales
function drawPieChart(byArea) {
  const el = document.getElementById('pieChart');
  if (!el) return;
  el.innerHTML = bxRings({
    items: Object.entries(byArea).map(([label, value]) => ({ label: label === 'Kitchen' && currentLang === 'fr' ? 'Cuisine' : label, value })),
    fmt: v => fmtRWF(Math.round(v)), centerLabel: currentLang === 'fr' ? 'ce mois' : 'this month',
    emptyText: currentLang === 'fr' ? 'Aucune vente ce mois' : 'No sales this month yet',
  });
}

// Sales and expenses — two series side by side, with a legend
function drawLineChart(rows) {
  const wrap = document.getElementById('lineCanvas');
  if (!wrap) return;
  wrap.innerHTML = bxColumns({
    categories: rows.map(r => r.label),
    series: [
      { name: currentLang === 'fr' ? 'Ventes' : 'Sales', values: rows.map(r => r.rev) },
      { name: currentLang === 'fr' ? 'Dépenses' : 'Expenses', values: rows.map(r => r.exp) },
    ],
    fmt: v => fmtRWF(Math.round(v)), height: 240,
    emptyText: currentLang === 'fr' ? 'Aucune donnée sur 6 mois' : 'No sales or expenses in the last 6 months',
  });
}
