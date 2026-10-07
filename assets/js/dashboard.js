/* ═══════════════════════════════════════════════════
   BARMS PRO — dashboard.js
   Dashboard: today's figures, live kitchen, things that
   need attention, cash flow, monthly chart, today's sales,
   low stock, fraud check.
   All figures come from api/misc.php?action=dashboard.
   Depends on: utils.js, api.js, auth.js, navigation.js, ui.js
═══════════════════════════════════════════════════ */

// ── Pull-to-refresh on touch screens ──────────────
(function initPullToRefresh() {
  let startY = 0, pulling = false, indicator = null;
  function createIndicator() {
    if (indicator) return;
    indicator = document.createElement('div');
    indicator.id = 'pullRefreshIndicator';
    indicator.className = 'ptr';
    document.body.appendChild(indicator);
  }
  const onDash = () => document.getElementById('page-dashboard')?.classList.contains('active');
  document.addEventListener('touchstart', e => {
    const content = document.querySelector('.content');
    if (!onDash() || !content || content.scrollTop > 0) return;
    startY = e.touches[0].clientY; pulling = true; createIndicator();
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!pulling) return;
    if (e.touches[0].clientY - startY > 60 && indicator) {
      indicator.textContent = currentLang === 'fr' ? 'Relâcher pour actualiser' : 'Release to refresh';
      indicator.classList.add('show');
    }
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!pulling || !indicator) return;
    pulling = false;
    if (e.changedTouches[0].clientY - startY > 60) {
      indicator.textContent = currentLang === 'fr' ? 'Actualisation…' : 'Refreshing…';
      loadDashboard(true).then(() => setTimeout(() => indicator.classList.remove('show'), 300));
    } else indicator.classList.remove('show');
  }, { passive: true });
})();

const _dbFr = () => currentLang === 'fr';

async function loadDashboard(manual) {
  const params = (_backdateActive && _backdateDate) ? { backdate: _backdateDate } : {};
  if (!document.getElementById('kpiRow1').children.length) _dbSkeleton();
  const res = await apiGet('misc', 'dashboard', params);
  if (!res.ok) {
    document.getElementById('kpiRow1').innerHTML = `<div class="db-cell" style="grid-column:1/-1">${uiEmpty('alertcircle', _dbFr() ? 'Tableau indisponible' : 'Could not load the dashboard', res.error || (_dbFr() ? 'Vérifiez la connexion puis actualisez.' : 'Check the connection, then refresh.'))}</div>`;
    return;
  }
  const d = res.data;
  const fr = _dbFr();

  // page date + greeting
  const pageDate = document.getElementById('pageDate');
  const dateText = (_backdateActive && _backdateDate)
    ? bdFormatDate(_backdateDate) + ' (BACKDATE MODE)'
    : new Date().toLocaleDateString(fr ? 'fr-FR' : 'en-RW', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  if (pageDate) pageDate.textContent = dateText;
  const h = new Date().getHours();
  const first = String(session.fullName || session.username || '').split(' ')[0];
  const part = fr ? (h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir') : (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');
  document.getElementById('dbGreeting').textContent = first ? `${part}, ${first}` : part;
  document.getElementById('dbGreetSub').textContent = (_backdateActive && _backdateDate)
    ? (fr ? `Vous travaillez sur le ${dateText}.` : `You are working on ${dateText}.`)
    : (fr ? "Voici comment se passe la journée." : 'Here is how today is going.');
  document.getElementById('dbUpdated').textContent = (fr ? 'Mis à jour ' : 'Updated ') + nowTime();
  if (manual) toast(fr ? 'Tableau actualisé' : 'Dashboard updated', 'success');

  const isBartender = session.role === 'Bartender';
  document.querySelectorAll('#page-dashboard .db-row-2col').forEach(el => el.style.display = isBartender ? 'none' : '');
  document.getElementById('kpiRow2Panel').style.display = isBartender ? 'none' : '';
  document.querySelector('#page-dashboard .db-grid-live').classList.toggle('single', isBartender);

  // ── Today strip ────────────────────────────────
  const gross = (d.todayRevenue || 0) - (d.todayCogs || 0);
  const margin = d.todayRevenue > 0 ? gross / d.todayRevenue * 100 : null;
  const salesSub = `${d.todayTx} ${fr ? 'ventes enregistrées' : (d.todayTx === 1 ? 'sale recorded' : 'sales recorded')}`;
  if (isBartender) {
    document.getElementById('kpiRow1').innerHTML = _dbCell(fr ? 'Ventes du jour' : 'Sales today', d.todayRevenue, salesSub, 'lead');
  } else {
    document.getElementById('kpiRow1').innerHTML =
      _dbCell(fr ? 'Ventes du jour' : 'Sales today', d.todayRevenue, salesSub, 'lead') +
      _dbCell(fr ? 'Marge brute' : 'Gross profit', gross, margin === null ? (fr ? 'après coût des marchandises' : 'after cost of goods') : `${margin.toFixed(1)}% ${fr ? 'de marge' : 'margin'}`, gross < 0 ? 'neg' : '') +
      _dbCell(fr ? 'Dépenses' : 'Expenses', d.todayExpenses, fr ? 'coûts de fonctionnement' : 'running costs today') +
      _dbCell(fr ? 'Bénéfice net' : 'Net profit', d.todayProfit, d.todayProfit >= 0 ? (fr ? 'en bénéfice' : 'in profit') : (fr ? 'en perte' : 'in loss'), d.todayProfit < 0 ? 'neg' : 'pos');
  }

  if (!isBartender) {
    // ── Needs attention ──────────────────────────
    const items = [];
    if (d.lowStockCount > 0) items.push({ icon: 'package', tone: 'warn', label: fr ? 'Articles en stock bas' : 'Items low on stock', value: d.lowStockCount, go: "showPage('bar-items')" });
    if (d.pendingVoids > 0 && ['Owner', 'Manager'].includes(session.role)) items.push({ icon: 'ban', tone: 'bad', label: fr ? "Demandes d'annulation" : 'Void and refund requests', value: d.pendingVoids, go: "showPage('voidreqs')" });
    if (d.unreadNotifs > 0) items.push({ icon: 'bell', tone: 'info', label: fr ? 'Notifications non lues' : 'Unread notifications', value: d.unreadNotifs, go: 'toggleNotif()' });
    document.getElementById('kpiRow2').innerHTML = items.length
      ? items.map(i => `<button class="db-attn-row" onclick="event.stopPropagation();${i.go}"><span class="db-attn-ic ${i.tone}">${ic(i.icon)}</span><span class="db-attn-label">${i.label}</span><span class="db-attn-val">${i.value}</span>${ic('chevright', 'db-attn-go')}</button>`).join('')
      : uiEmpty('checkcircle', fr ? 'Rien à signaler' : 'All clear', fr ? 'Aucun stock bas ni demande en attente.' : 'No low stock and no pending requests.');

    // ── Cash flow ────────────────────────────────
    const moneyIn = d.moneyInToday ?? (d.todayRevenue + (d.kitchenRevenue || 0));
    const moneyOut = d.todayExpenses;
    const netCash = moneyIn - moneyOut;
    const cfEl = document.getElementById('cashFlowStatus');
    if (cfEl) { cfEl.textContent = netCash >= 0 ? (fr ? 'Positif' : 'Positive') : (fr ? 'Négatif' : 'Negative'); cfEl.className = 'status ' + (netCash >= 0 ? 'ok' : 'bad'); }
    document.getElementById('cashFlowGrid').innerHTML =
      _dbCashRow(fr ? 'Argent entrant' : 'Money in', moneyIn, fr ? 'ventes bar + cuisine' : 'bar and kitchen sales', 'in') +
      _dbCashRow(fr ? 'Argent sortant' : 'Money out', moneyOut, fr ? 'dépenses' : 'expenses', 'out') +
      _dbCashRow(fr ? 'Coût des marchandises' : 'Cost of goods sold', d.todayCogs || 0, fr ? 'stock vendu, au prix d\'achat' : 'stock sold, at purchase cost', '') +
      _dbCashRow(fr ? 'Flux net' : 'Net cash flow', netCash, fr ? 'entrant moins sortant' : 'money in minus money out', netCash >= 0 ? 'total pos' : 'total neg');

    document.getElementById('dbMonthSub').textContent = `${fr ? 'Ce mois' : 'This month so far'}: ${fmtRWF(d.monthRevenue || 0)}`;

    // ── Today's sales ────────────────────────────
    const txBadge = document.getElementById('todayTxCount');
    if (txBadge) txBadge.textContent = fr ? `${(d.recentSales || []).length} dernières ventes` : `Last ${(d.recentSales || []).length} sales today`;
    const tbody = document.getElementById('todaySalesBody');
    if (tbody) {
      tbody.innerHTML = (d.recentSales || []).map(s => `
        <tr>
          <td class="muted">${esc(s.time || '')}</td>
          <td class="strong">${esc(s.productName || '')}</td>
          <td class="r">${esc(s.qty || 0)}</td>
          <td class="r strong">${fmtRWF(s.total || 0)}</td>
          <td class="muted">${esc(s.soldBy || '')}</td>
        </tr>`).join('') || `<tr><td colspan="5">${uiEmpty('receipt', fr ? "Pas encore de ventes aujourd'hui" : 'No sales yet today', fr ? 'Les ventes apparaîtront ici dès leur paiement.' : 'Sales appear here as soon as they are paid.')}</td></tr>`;
    }

    // ── Low stock: bar items + older products list ──
    _dbLowStock();
    buildMonthlyChart(d.monthlySales);
  }

  if (d.lowStockCount > 0 && !isBartender && !manual && !window._dbLowShown) {
    window._dbLowShown = true;
    showPopupNotif(fr ? `${d.lowStockCount} produit${d.lowStockCount > 1 ? 's' : ''} en stock bas` : `${d.lowStockCount} product${d.lowStockCount > 1 ? 's' : ''} low on stock`, 'warning', '');
  }

  updateVoidBadge();
  updateNotifBadge();
  _dbStartKitchenOverviewPolling();
}

function _dbSkeleton() {
  document.getElementById('kpiRow1').innerHTML = [0, 1, 2, 3].map(() => `<div class="db-cell"><div class="skel skel-line" style="width:40%"></div><div class="skel" style="height:26px;width:70%;margin:10px 0 8px"></div><div class="skel skel-line" style="width:50%"></div></div>`).join('');
}

// One figure inside the today strip
function _dbCell(label, amount, sub, tone) {
  return `<div class="db-cell ${tone || ''}">
    <div class="db-cell-label">${label}</div>
    <div class="db-cell-value">${fmtRWF(Math.round(amount || 0))}</div>
    <div class="db-cell-sub">${sub || ''}</div>
  </div>`;
}

function _dbCashRow(label, amount, sub, tone) {
  return `<div class="db-cash-row ${tone || ''}">
    <div><div class="db-cash-label">${label}</div><div class="db-cash-sub">${sub}</div></div>
    <div class="db-cash-val">${fmtRWF(Math.round(amount || 0))}</div>
  </div>`;
}

async function _dbLowStock() {
  const lsBody = document.getElementById('lowStockBody');
  const lsCount = document.getElementById('lowStockCount');
  if (!lsBody) return;
  const fr = _dbFr();
  const [bRes, kRes] = await Promise.all([apiGet('bar-inventory', 'items_list'), apiGet('kitchen2', 'ingredients_list')]);
  const low = [
    ...(bRes.data || []).filter(i => +i.active && i.type === 'direct' && i.stock <= i.min_stock)
      .map(i => ({ name: i.name, stock: i.stock, alert: i.min_stock, image: i.image, kind: 'bar', productType: i.product_type })),
    ...(kRes.data || []).filter(k => +k.quantity <= +k.min_stock)
      .map(k => ({ name: k.name, stock: +k.quantity, alert: +k.min_stock, image: null, kind: 'kitchen', productType: 'bowl' })),
  ].sort((a, b) => a.stock - b.stock);
  if (lsCount) lsCount.textContent = low.length;
  lsBody.innerHTML = low.map(p => `<tr>
      <td><div class="db-prod">${uiProductThumb(p, 'xs')}<span class="strong">${esc(p.name)}</span></div></td>
      <td class="r strong ${p.stock <= 0 ? 'neg' : 'warn'}">${+p.stock}</td>
      <td class="r muted">${+p.alert}</td>
      <td><span class="status ${p.stock <= 0 ? 'bad' : 'warn'}">${p.stock <= 0 ? (fr ? 'Épuisé' : 'Out of stock') : (fr ? 'Bas' : 'Low')}</span></td>
    </tr>`).join('') || `<tr><td colspan="4">${uiEmpty('checkcircle', fr ? 'Stock correct' : 'Stock levels are fine', fr ? 'Aucun article sous son seuil.' : 'No item is below its alert level.')}</td></tr>`;
}

// ── KITCHEN OVERVIEW (polls while the dashboard is open) ──
let _dbKitchenPollInterval = null;

function _dbStartKitchenOverviewPolling() {
  _dbRenderKitchenOverview();
  if (_dbKitchenPollInterval) clearInterval(_dbKitchenPollInterval);
  _dbKitchenPollInterval = setInterval(_dbRenderKitchenOverview, 8000);
}

function _dbStopKitchenOverviewPolling() {
  if (_dbKitchenPollInterval) { clearInterval(_dbKitchenPollInterval); _dbKitchenPollInterval = null; }
}

async function _dbRenderKitchenOverview() {
  const page = document.getElementById('page-dashboard');
  if (!page || !page.classList.contains('active')) { _dbStopKitchenOverviewPolling(); return; }
  const box = document.getElementById('dbKitchenOverview');
  if (!box) return;

  const [queueRes, readyRes] = await Promise.all([
    apiGet('kitchen_orders', 'queue'),
    apiGet('kitchen_orders', 'ready_list'),
  ]);
  if (!queueRes.ok) { box.innerHTML = uiEmpty('alertcircle', 'Kitchen status unavailable', queueRes.error || ''); return; }

  const active = queueRes.data || [];
  const ready = readyRes.ok ? (readyRes.data || []) : [];
  const fr = _dbFr();

  if (!active.length && !ready.length) {
    box.innerHTML = uiEmpty('chef', fr ? 'Cuisine calme' : 'Kitchen is quiet', fr ? 'Aucune commande en préparation.' : 'No food orders are being prepared.');
    return;
  }

  const statusMap = {
    pending:   { label: fr ? 'En attente' : 'Waiting',   tone: 'info' },
    accepted:  { label: fr ? 'Acceptée' : 'Accepted',    tone: 'info' },
    preparing: { label: fr ? 'En préparation' : 'Preparing', tone: 'warn' },
  };
  const row = (o, st, time, late) => `<div class="db-k-row${late ? ' late' : ''}">
      <span class="db-k-no">#${esc(o.order_number)}</span>
      <span class="db-k-where">${esc(o.table_name || 'Takeaway')}</span>
      <span class="status ${st.tone}">${st.label}</span>
      <span class="db-k-time">${time}</span>
    </div>`;

  box.innerHTML =
    ready.map(o => row(o, { label: fr ? 'Prête à servir' : 'Ready to serve', tone: 'ok' }, '', false)).join('') +
    active.map(o => {
      const s = statusMap[o.status] || statusMap.pending;
      const late = !!o.is_delayed && o.status !== 'pending';
      const time = o.status === 'pending'
        ? `${fr ? 'Est.' : 'Est.'} ${o.estimated_minutes} min`
        : (late ? `${o.elapsed_minutes - o.estimated_minutes} min ${fr ? 'de retard' : 'late'}` : `${o.remaining_minutes} min ${fr ? 'restantes' : 'left'}`);
      return row(o, s, time, late);
    }).join('');
}

// ── KPI CARD (still used by kitchen.js) ───────────
function kpiCard(label, value, note, color) {
  return `<div class="db-kpi-card">
    <div class="db-kpi-label">${label}</div>
    <div class="db-kpi-value">${value}</div>
    <div class="db-kpi-note ${color === 'red' ? 'down' : ''}">${note}</div>
  </div>`;
}

// ── MONTHLY CHART ─────────────────────────────────
function buildMonthlyChart(monthlySales) {
  const wrap = document.getElementById('monthlyChart');
  if (!wrap) return;
  const LBL_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LBL_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  const LBLS = currentLang === 'fr' ? LBL_FR : LBL_EN;
  // the last 6 months, oldest first (matches the card title)
  const now = new Date();
  const months = [...Array(6)].map((_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const mo = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const rev = (monthlySales || []).filter(m => m.mo && m.mo.startsWith(mo)).reduce((a, m) => a + (+m.rev || 0), 0);
    return { label: LBLS[d.getMonth()], rev };
  });
  wrap.innerHTML = bxColumns({
    categories: months.map(m => m.label),
    series: [{ name: currentLang === 'fr' ? 'Ventes' : 'Sales', values: months.map(m => m.rev) }],
    fmt: v => fmtRWF(Math.round(v)), height: 190,
    emptyText: currentLang === 'fr' ? 'Aucune vente sur 6 mois' : 'No sales in the last 6 months',
  });
}

// ── FRAUD CHECK ───────────────────────────────────
async function runFraudCheck() {
  if (session.role === 'Bartender') return;
  const res = await apiGet('misc', 'dashboard', {});
  if (!res.ok) return;
  const d = res.data;
  if (d.pendingVoids > 0) {
    showPopupNotif(currentLang === 'fr' ? `${d.pendingVoids} demande${d.pendingVoids > 1 ? 's' : ''} d'annulation en attente` : `${d.pendingVoids} void request${d.pendingVoids > 1 ? 's' : ''} pending review`, 'warning', '');
  }
}
function runPeriodicFraudCheck() { if (session.role !== 'Bartender') runFraudCheck(); }
