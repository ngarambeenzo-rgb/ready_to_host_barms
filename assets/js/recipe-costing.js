/* ═══════════════════════════════════════════════════
   BARMS PRO — recipe-costing.js
   Recipe cost breakdown: ingredients, how they were
   purchased, their share of cost, and profit.
   Used by kitchen recipes and bar recipe (cocktail) items.
   Depends on: utils.js
═══════════════════════════════════════════════════ */

function renderRecipeCostingModal(c, footerHtml = '') {
  const th = 'padding:8px 6px;font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;white-space:nowrap';
  const td = 'padding:8px 6px;font-size:12px;vertical-align:top';
  const profitColor = c.profitPerServing >= 0 ? 'var(--green)' : 'var(--red)';
  const sale = (label, s) => s ? `
    <div class="rc-card"><div class="rc-label">${label}</div>
      <div class="rc-line"><span>Sold</span><strong>${+s.qty}</strong></div>
      <div class="rc-line"><span>Revenue</span><strong>${fmtRWF(s.revenue)}</strong></div>
      <div class="rc-line"><span>Ingredient cost</span><strong style="color:var(--red)">${fmtRWF(s.cost)}</strong></div>
      <div class="rc-line"><span>Profit</span><strong style="color:${s.profit>=0?'var(--green)':'var(--red)'}">${fmtRWF(s.profit)}</strong></div>
    </div>` : '';

  const rows = c.ingredients.map(i => {
    const lp = i.lastPurchase;
    const bought = lp
      ? `${esc(lp.date)} · ${+lp.quantity} ${esc(i.unit)} @ ${fmtRWF(lp.unitCost)}${lp.supplier ? `<br><span style="color:var(--muted)">${esc(lp.supplier)}${lp.reference ? ' · ' + esc(lp.reference) : ''}</span>` : ''}`
      : '<span style="color:var(--orange)">No purchase recorded</span>';
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="${td};font-weight:700">${esc(i.name)}</td>
      <td style="${td};text-align:right;white-space:nowrap">${+i.qtyPerServing} ${esc(i.unit)}</td>
      <td style="${td};text-align:right;white-space:nowrap;color:${i.avgUnitCost>0?'inherit':'var(--orange)'}">${i.avgUnitCost>0?fmtRWF(i.avgUnitCost):'No cost'}</td>
      <td style="${td};text-align:right;white-space:nowrap;font-weight:700;color:var(--red)">${fmtRWF(i.costPerServing)}</td>
      <td style="${td};min-width:90px">
        <div style="font-size:11px;font-weight:700">${i.shareOfCostPct}%</div>
        <div style="height:5px;background:var(--border);border-radius:3px;margin-top:3px"><div style="height:5px;width:${Math.min(100,i.shareOfCostPct)}%;background:var(--orange);border-radius:3px"></div></div>
      </td>
      <td style="${td};font-size:11px;min-width:150px">${bought}
        ${i.purchaseCount ? `<div style="color:var(--muted);margin-top:2px">Total bought: ${+i.purchasedQty} ${esc(i.unit)} · ${fmtRWF(i.purchasedSpent)}</div>` : ''}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" style="${td};text-align:center;color:var(--muted);padding:20px">No ingredients in this recipe yet</td></tr>`;

  document.getElementById('modalContent').innerHTML = `
    <h3 style="margin-bottom:4px">${esc(c.name)} — Costing</h3>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px">${c.itemName ? 'Sold as: <strong>' + esc(c.itemName) + '</strong> · ' : ''}Costs use the average purchase price of each ingredient.</div>
    ${c.missingCostCount ? `<div style="background:rgba(255,140,66,.12);color:var(--orange);border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:12px">${c.missingCostCount} ingredient(s) have no purchase cost yet, so the cost below is too low. Receive stock with its price to fix this.</div>` : ''}
    <div class="rc-summary">
      <div class="rc-card"><div class="rc-label">Selling price</div><div class="rc-big" style="color:var(--blue)">${fmtRWF(c.sellPrice)}</div></div>
      <div class="rc-card"><div class="rc-label">Ingredient cost</div><div class="rc-big" style="color:var(--red)">${fmtRWF(c.recipeCost)}</div></div>
      <div class="rc-card"><div class="rc-label">Profit per serving</div><div class="rc-big" style="color:${profitColor}">${fmtRWF(c.profitPerServing)}</div><div class="rc-label" style="margin-top:2px">${c.marginPct}% margin</div></div>
    </div>
    <div style="overflow-x:auto;margin:14px 0">
      <table style="width:100%;border-collapse:collapse;min-width:620px">
        <thead><tr style="border-bottom:2px solid var(--border)">
          <th style="${th};text-align:left">Ingredient</th>
          <th style="${th};text-align:right">Used per serving</th>
          <th style="${th};text-align:right">Avg cost / unit</th>
          <th style="${th};text-align:right">Cost per serving</th>
          <th style="${th};text-align:left">Share of cost</th>
          <th style="${th};text-align:left">Last purchase</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="border-top:2px solid var(--border)">
          <td colspan="3" style="${td};font-weight:800">Total ingredient cost</td>
          <td style="${td};text-align:right;font-weight:900;color:var(--red)">${fmtRWF(c.recipeCost)}</td>
          <td colspan="2" style="${td};color:var(--muted)">${c.sellPrice>0?Math.round(c.recipeCost/c.sellPrice*1000)/10+'% of selling price':''}</td>
        </tr></tfoot>
      </table>
    </div>
    ${c.sales && (c.sales.month || c.sales.all) ? `
      <div style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;margin-bottom:8px">Profit from sales</div>
      <div class="rc-summary">${sale('This month', c.sales.month)}${sale('All time', c.sales.all)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px">Ingredient cost of sales is estimated at today's average ingredient cost.</div>` : ''}
    ${footerHtml}`;
  document.getElementById('modalOverlay').classList.add('show');
}

async function showBarItemCosting(id) {
  const res = await apiGet('bar-inventory', 'item_costing', { id });
  if (!res.ok) { toast(res.error || 'Could not load costing', 'error'); return; }
  renderRecipeCostingModal(res.data);
}
