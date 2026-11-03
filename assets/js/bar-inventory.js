/* ═══════════════════════════════════════════════════
   bar-inventory.js
   Bar Inventory: Items, Ingredients, Stock Movements
═══════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════
// BAR ITEMS
// ══════════════════════════════════════════════════
let _biAllItems      = [];
let _biActiveFilter  = 'all';
let _biRecipes       = [];
let _biIngredients   = [];
let _biTempRecipeIngs = [];

async function loadBarItems() {
  const [itemsRes, recRes, ingRes] = await Promise.all([
    apiGet('bar-inventory', 'items_list'),
    apiGet('bar-inventory', 'recipes_list'),
    apiGet('bar-inventory', 'ingredients_list'),
  ]);
  _biAllItems    = itemsRes.data  || [];
  _biRecipes     = recRes.data    || [];
  _biIngredients = ingRes.data    || [];
  // Recipe items hold no stock of their own; their value is in the ingredients page
  // an opened bottle still counts: its share of a bottle is worth its share of the cost
  renderStockValueBox('biItemsValueBox', _biAllItems.filter(i => i.type === 'direct').map(i => ({ qty: i.stock + (i.bottle_size > 0 ? Math.max(0, i.open_amount) / i.bottle_size : 0), unitCost: i.cost_price })));
  _renderBarItems();
}

function filterBarItems(type, btn, search) {
  if (type !== null) _biActiveFilter = type || _biActiveFilter;
  if (btn) {
    document.querySelectorAll('.bi-filter-btn').forEach(b => {
      b.style.background = 'var(--card)'; b.style.color = 'var(--muted)';
      b.style.border = '1px solid var(--border)';
    });
    btn.style.background = 'var(--blue)'; btn.style.color = '#fff';
    btn.style.border = '1px solid var(--blue)';
  }
  _renderBarItems(search || document.getElementById('biSearch')?.value || '');
}

function _renderBarItems(search = '') {
  const tbody = document.getElementById('biItemsBody');
  if (!tbody) return;
  // shots and glasses are shown under their bottle, not as lines of their own
  let items = _biAllItems.filter(i => i.type !== 'portion');
  if (_biActiveFilter !== 'all') items = items.filter(i => i.type === _biActiveFilter);
  if (search) items = items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="padding:40px;text-align:center;color:var(--muted)">No items found</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(item => {
    const isLow  = item.type === 'direct' && item.stock <= item.min_stock;
    const isZero = item.type === 'direct' && item.stock <= 0;
    const measured = item.type === 'direct' && !!item.measure_unit;
    const portions = measured ? _biAllItems.filter(p => p.type === 'portion' && +p.parent_id === item.id && +p.active) : [];
    const stockDisplay = item.type === 'direct'
      ? `<span style="font-weight:800;color:${isZero?'var(--red)':isLow?'var(--orange)':'var(--text)'}">${item.stock}</span>${measured ? `<div style="font-size:10px;color:var(--muted)">sealed</div><div style="font-size:11px;margin-top:3px;color:var(--text)">Open: <b>${_biAmt(item.open_amount, item.measure_unit)}</b></div>` : ''}`
      : `<span style="color:var(--muted);font-size:11px">—</span>`;
    const portionChips = portions.length
      ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:5px">${portions.map(p => `<span style="font-size:10.5px;padding:2px 8px;border-radius:10px;background:rgba(14,168,117,.12);color:var(--green);font-weight:700;white-space:nowrap">${esc(p.pack_name || 'Portion')} ${_biAmt(p.portion_size, item.measure_unit)} · ${fmtRWF(p.price)} · ${p.portions_left} left</span>`).join('')}</div>`
      : '';
    const typeLabel = item.type === 'direct'
      ? `<span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:var(--blue-lt);color:var(--blue)">Direct</span>`
      : `<span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:rgba(124,58,237,.1);color:#7C3AED">Recipe</span>`;
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:12px 16px">
        <div class="item-cell">${uiThumbButton('bar', item)}<div style="min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--text)">${esc(item.name)}</div>
        ${isLow && !isZero ? `<div style="font-size:11px;color:var(--ink-orange)">Low stock</div>` : ''}
        ${isZero ? `<div style="font-size:11px;color:var(--ink-red)">${measured ? 'No sealed bottle' : 'Out of stock'}</div>` : ''}${portionChips}</div></div>
      </td>
      <td style="padding:12px 16px;text-align:center">${typeLabel}</td>
      <td style="padding:12px 16px;text-align:right;font-size:13px;font-weight:700;color:var(--blue)">${fmtRWF(item.price)}</td>
      <td style="padding:12px 16px;text-align:right;font-size:12px;color:${item.unit_cost>0?'var(--muted)':'var(--orange)'}">${item.unit_cost>0?fmtRWF(item.unit_cost):'No cost'}${item.type==='recipe'?'<div style="font-size:10px">from ingredients</div>':''}</td>
      <td style="padding:12px 16px;text-align:center">${stockDisplay}</td>
      <td style="padding:12px 16px;text-align:right;font-size:12px;font-weight:700">${item.type === 'direct' ? fmtRWF((item.stock + (measured && item.bottle_size > 0 ? Math.max(0, item.open_amount) / item.bottle_size : 0)) * item.cost_price) : '—'}</td>
      <td style="padding:12px 16px;font-size:12px;color:var(--muted)">${esc(item.recipe_name || '—')}</td>
      <td style="padding:12px 16px;text-align:center">
        <span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:${item.active?'rgba(14,168,117,.12)':'rgba(200,200,200,.2)'};color:${item.active?'var(--green)':'var(--muted)'}">
          ${item.active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td style="padding:12px 16px;text-align:center">
        <div style="display:flex;gap:6px;justify-content:center">
          ${measured?`<button data-perm="canEditStock" onclick="showMeasureCheckModal(${item.id})" style="background:rgba(37,99,235,.1);border:none;color:var(--blue);border-radius:6px;padding:5px 8px;cursor:pointer;font-size:11px;white-space:nowrap">Check bottle</button>`:''}
          ${item.type==='direct'?`<button data-perm="canEditStock" onclick="showAddStockToItemModal(${item.id})" style="background:rgba(14,168,117,.1);border:none;color:var(--green);border-radius:6px;padding:5px 8px;cursor:pointer;font-size:11px">+Stock</button>`:`<button onclick="showBarItemCosting(${item.id})" style="background:rgba(124,58,237,.1);border:none;color:#7C3AED;border-radius:6px;padding:5px 8px;cursor:pointer;font-size:11px">Costing</button>`}
          <button data-perm="canManageItems" class="icon-act" onclick="showEditBarItemModal(${item.id})" title="Edit" aria-label="Edit">${ic('pencil')}</button>
          <button data-perm="canManageItems" class="icon-act danger" onclick="deleteBarItem(${item.id})" title="Delete" aria-label="Delete">${ic('trash')}</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── ADD / EDIT ITEM MODAL ─────────────────────────
async function showAddBarItemModal() {
  // Ensure ingredients are loaded
  if (!_biIngredients.length) {
    const ingRes = await apiGet('bar-inventory', 'ingredients_list');
    _biIngredients = ingRes.data || [];
  }
  _biTempRecipeIngs = [];
  _showBarItemModal(null);
}
async function showEditBarItemModal(id) {
  if (!_biIngredients.length) {
    const ingRes = await apiGet('bar-inventory', 'ingredients_list');
    _biIngredients = ingRes.data || [];
  }
  const res = await apiGet('bar-inventory', 'item_get', { id });
  if (res.ok) {
    _biTempRecipeIngs = (res.data.recipeIngredients || []).map(ri => ({
      ingId: ri.ingredient_id, name: ri.ing_name, qty: ri.qty, unit: ri.unit
    }));
    _showBarItemModal(res.data);
  }
}

function _showBarItemModal(item) {
  _biTempRecipeIngs = item?.recipeIngredients || [];
  const ingOpts = _biIngredients.map(i => `<option value="${i.id}">${esc(i.name)} (${esc(i.unit)})</option>`).join('');
  document.getElementById('modalContent').innerHTML = `
    <h3 style="margin-bottom:18px">${item ? 'Edit Item' : 'Add Bar Item'}</h3>
    <div class="form-group"><label class="form-label">Item Name *</label>
      <input class="form-input" id="biName" value="${esc(item?.name||'')}" placeholder="e.g. Heineken, Mojito"/></div>
    ${uiTypePicker('bi', item?.product_type || '', 'bar', 'biName', () => ({ itemType: document.getElementById('biType')?.value }))}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label class="form-label">Selling Price (RWF) *</label>
        <input type="number" class="form-input" id="biPrice" value="${item?.price||''}" min="0"/></div>
      <div class="form-group" id="biCostWrap" style="${item?.type==='recipe'?'display:none':''}"><label class="form-label">Buy Price / Cost per Unit (RWF) *</label>
        <input type="number" class="form-input" id="biCostPrice" value="${item?.cost_price||''}" min="0" placeholder="What you paid for it"/></div>
      <div class="form-group" id="biCostNote" style="${item?.type==='recipe'?'':'display:none'};font-size:12px;color:var(--muted);align-self:end;padding-bottom:10px">Cost is calculated from the recipe ingredients</div>
    </div>
    <div class="form-group"><label class="form-label">Type *</label>
      <select class="form-input" id="biType" onchange="biToggleType()">
        <option value="direct" ${item?.type==='direct'||!item?'selected':''}>Direct</option>
        <option value="recipe" ${item?.type==='recipe'?'selected':''}>Recipe (Cocktail)</option>
      </select></div>
    <!-- Direct: stock fields -->
    <div id="biDirectFields" style="${item?.type==='recipe'?'display:none':''}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label class="form-label">Bought in (optional)</label>
          <select class="form-input" id="biPackName">
            ${['', 'Crate', 'Carton', 'Box', 'Pack', 'Case'].map(p => `<option value="${p}" ${(item?.pack_name || '') === p ? 'selected' : ''}>${p || '— single units only —'}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Units per pack</label>
          <input type="number" class="form-input" id="biUnitsPerPack" min="2" step="1" value="${item?.units_per_pack || ''}" placeholder="e.g. 12 or 24"/></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label class="form-label" id="biStockLabel">Current Stock</label>
          <input type="number" class="form-input" id="biStock" value="${item?.stock||'0'}" min="0"/></div>
        <div class="form-group"><label class="form-label">Min Stock Alert</label>
          <input type="number" class="form-input" id="biMinStock" value="${item?.min_stock||'5'}" min="0"/></div>
      </div>
      <!-- Sell by the shot or glass -->
      <label style="display:flex;gap:8px;align-items:center;font-weight:700;font-size:13px;cursor:pointer;margin:4px 0 8px">
        <input type="checkbox" id="biMeasureOn" ${item?.measure_unit ? 'checked' : ''} onchange="biToggleMeasure()"/> Also sell it by the shot or glass</label>
      <div id="biMeasureBox" style="display:none;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:12px;background:var(--bg)">
        <div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.5">Pick the unit you use. The bottle stays one item: a shot or glass pours from the open bottle and opens a new sealed one by itself when it runs out. A whole bottle can only be sold from the sealed ones.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group"><label class="form-label">Measure in</label>
            <select class="form-input" id="biMUnit" onchange="biMeasureUnitChanged()">
              ${Object.entries(BI_MEASURE_UNITS).map(([k, v]) => `<option value="${k}" ${(item?.measure_unit || 'ml') === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select></div>
          <div class="form-group"><label class="form-label">One full bottle holds <span id="biMUnitTxt1"></span></label>
            <input type="number" class="form-input" id="biMBottle" min="0" step="any" value="${item?.bottle_size || ''}" placeholder="e.g. 750"/></div>
        </div>
        <div style="font-size:12px;font-weight:700;color:var(--muted);margin:2px 0 6px">Shots and glasses you sell</div>
        <div id="biPortionList"></div>
        <button type="button" onclick="biAddPortion()" style="background:none;border:1px dashed var(--border);border-radius:8px;padding:7px 12px;cursor:pointer;font-family:inherit;font-size:12px;color:var(--blue);margin:4px 0 12px">+ Add a shot or glass size</button>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          ${item?.id ? '' : `<div class="form-group"><label class="form-label">Already open now (optional) <span id="biMUnitTxt2"></span></label>
            <input type="number" class="form-input" id="biMOpen" min="0" step="any" placeholder="how much is left in it"/></div>`}
          <div class="form-group"><label class="form-label">Empty bottle weight (g, optional)</label>
            <input type="number" class="form-input" id="biMEmpty" min="0" step="any" value="${item?.empty_weight || ''}" placeholder="to check by weighing"/></div>
          <div class="form-group" id="biMDensityWrap"><label class="form-label">Liquid weight per ml (g)</label>
            <input type="number" class="form-input" id="biMDensity" min="0.5" max="1.5" step="0.01" value="${item?.density || ''}" placeholder="0.94 for spirits"/></div>
        </div>
        <div style="font-size:11px;color:var(--muted);line-height:1.5">Weighing is optional. If you fill in the empty bottle's weight, you can later weigh the open bottle (or read its level, or type what is left) from <b>Check bottle</b> and see how much is missing.</div>
      </div>
    </div>
    <!-- Recipe: ingredients -->
    <div id="biRecipeFields" style="${item?.type!=='recipe'?'display:none':''}">
      <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:8px">Recipe Ingredients</div>
      <div id="biRecipeIngList" style="margin-bottom:10px"></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select class="form-input" id="biIngSelect" style="flex:1;min-width:140px"><option value="">Select ingredient...</option>${ingOpts}</select>
        <input type="number" class="form-input" id="biIngQty" placeholder="Qty" style="width:70px" min="0"/>
        <input class="form-input" id="biIngUnit" placeholder="Unit" style="width:60px"/>
        <button onclick="biAddRecipeIng()" style="background:var(--blue);color:#fff;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;font-family:inherit;font-size:13px;white-space:nowrap">+ Add</button>
      </div>
    </div>
    <div class="form-group" style="margin-top:12px"><label class="form-label">Status</label>
      <select class="form-input" id="biStatus">
        <option value="1" ${item?.active||!item?'selected':''}>Active</option>
        <option value="0" ${item?.active===0?'selected':''}>Inactive</option>
      </select></div>
    <div style="display:flex;gap:10px;margin-top:6px">
      <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="submitBarItem(${item?.id||0})">Save Item</button>
      <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="closeModal()">Cancel</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('show');
  _biTempPortions = (item?.portions || []).map(p => ({ id: p.id, name: p.name, size: +p.size, price: +p.price }));
  _biRenderRecipeIngs();
  biToggleMeasure(true);
}

// ── sell by the shot or glass ──────────────────────
const BI_MEASURE_UNITS = { ml: 'Millilitres (ml)', cl: 'Centilitres (cl)', oz: 'Fluid ounces (oz)', g: 'Grams (g), weigh the pour' };
const BI_PORTION_PRESETS = { ml: [['Shot', 50], ['Glass', 150]], cl: [['Shot', 5], ['Glass', 15]], oz: [['Shot', 1.5], ['Glass', 5]], g: [['Shot', 40], ['Glass', 120]] };
let _biTempPortions = [];

function biToggleMeasure(initial) {
  const on = document.getElementById('biMeasureOn')?.checked && document.getElementById('biType')?.value === 'direct';
  const box = document.getElementById('biMeasureBox'); if (!box) return;
  box.style.display = on ? '' : 'none';
  const lbl = document.getElementById('biStockLabel'); if (lbl) lbl.textContent = on ? 'Sealed bottles in stock' : 'Current Stock';
  if (on) {
    if (!_biTempPortions.length && !initial) BI_PORTION_PRESETS[document.getElementById('biMUnit').value].forEach(([n, s]) => _biTempPortions.push({ name: n, size: s, price: '' }));
    biMeasureUnitChanged(true);
  }
}
function biMeasureUnitChanged(keep) {
  const u = document.getElementById('biMUnit')?.value || 'ml';
  document.querySelectorAll('#biMUnitTxt1, #biMUnitTxt2').forEach(e => e.textContent = '(' + u + ')');
  const d = document.getElementById('biMDensityWrap'); if (d) d.style.display = u === 'g' ? 'none' : '';
  if (keep !== true && _biTempPortions.length) {   // the owner switched unit: offer the usual sizes in the new unit
    const pre = BI_PORTION_PRESETS[u];
    _biTempPortions.forEach(p => { const m = pre.find(x => x[0] === p.name); if (m) p.size = m[1]; });
  }
  _biRenderPortions();
}
function _biRenderPortions() {
  const el = document.getElementById('biPortionList'); if (!el) return;
  const u = document.getElementById('biMUnit')?.value || 'ml';
  el.innerHTML = _biTempPortions.map((p, i) => `
    <div style="display:grid;grid-template-columns:1.1fr 1fr 1.1fr 28px;gap:8px;margin-bottom:8px;align-items:end">
      <div><div style="font-size:10px;color:var(--muted)">Name</div><input class="form-input" value="${esc(p.name)}" oninput="_biTempPortions[${i}].name=this.value" placeholder="Shot, Glass, Tot"/></div>
      <div><div style="font-size:10px;color:var(--muted)">Amount (${u})</div><input type="number" class="form-input" min="0" step="any" value="${p.size}" oninput="_biTempPortions[${i}].size=+this.value"/></div>
      <div><div style="font-size:10px;color:var(--muted)">Price (RWF)</div><input type="number" class="form-input" min="0" value="${p.price}" oninput="_biTempPortions[${i}].price=+this.value"/></div>
      <button type="button" onclick="_biTempPortions.splice(${i},1);_biRenderPortions()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:15px;height:34px" aria-label="Remove">✕</button>
    </div>`).join('') || '<div style="color:var(--muted);font-size:12px;margin-bottom:6px">No shot or glass added yet</div>';
}
function biAddPortion() { _biTempPortions.push({ name: '', size: '', price: '' }); _biRenderPortions(); }

function _biAmt(n, unit) { return (Math.round((+n || 0) * 10) / 10) + ' ' + (unit || ''); }

function biToggleType() {
  const type = document.getElementById('biType')?.value;
  uiTypeRefreshAuto('bi', 'bar', 'biName', () => ({ itemType: type }));
  document.getElementById('biDirectFields').style.display = type === 'direct' ? '' : 'none';
  document.getElementById('biRecipeFields').style.display = type === 'recipe' ? '' : 'none';
  document.getElementById('biCostWrap').style.display = type === 'direct' ? '' : 'none';
  document.getElementById('biCostNote').style.display = type === 'recipe' ? '' : 'none';
}

function biAddRecipeIng() {
  const ingId = +document.getElementById('biIngSelect')?.value;
  const qty   = +document.getElementById('biIngQty')?.value;
  const unit  = document.getElementById('biIngUnit')?.value?.trim();
  if (!ingId || !qty) { toast('Select ingredient and enter quantity', 'error'); return; }
  const ing = _biIngredients.find(i => i.id === ingId);
  if (!ing) return;
  const existing = _biTempRecipeIngs.findIndex(i => i.ingId === ingId);
  if (existing >= 0) { _biTempRecipeIngs[existing].qty = qty; _biTempRecipeIngs[existing].unit = unit || ing.unit; }
  else _biTempRecipeIngs.push({ ingId, name: ing.name, qty, unit: unit || ing.unit });
  document.getElementById('biIngSelect').value = '';
  document.getElementById('biIngQty').value = '';
  document.getElementById('biIngUnit').value = '';
  _biRenderRecipeIngs();
}

function _biRenderRecipeIngs() {
  const el = document.getElementById('biRecipeIngList');
  if (!el) return;
  if (!_biTempRecipeIngs.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px;margin-bottom:8px">No ingredients added yet</div>'; return; }
  el.innerHTML = _biTempRecipeIngs.map((i, idx) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
      <span style="flex:1">${esc(i.name)}</span>
      <span style="color:var(--muted)">${i.qty} ${esc(i.unit)}</span>
      <button onclick="_biRemoveRecipeIng(${idx})" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:14px">✕</button>
    </div>`).join('');
}

function _biRemoveRecipeIng(idx) { _biTempRecipeIngs.splice(idx, 1); _biRenderRecipeIngs(); }

async function submitBarItem(id) {
  const name      = document.getElementById('biName')?.value?.trim();
  const price     = +document.getElementById('biPrice')?.value || 0;
  const costPrice = +document.getElementById('biCostPrice')?.value || 0;
  const type      = document.getElementById('biType')?.value;
  const active    = +document.getElementById('biStatus')?.value;
  const stock     = type === 'direct' ? +document.getElementById('biStock')?.value || 0 : 0;
  const minStock  = type === 'direct' ? +document.getElementById('biMinStock')?.value || 5 : 0;
  if (!name || !price) { toast('Name and selling price are required', 'error'); return; }
  if (type === 'direct' && !costPrice) { toast('Buy cost is required for direct items', 'error'); return; }
  if (type === 'recipe' && !_biTempRecipeIngs.length) { toast('Add at least one ingredient to the recipe', 'error'); return; }
  const packName = document.getElementById('biPackName')?.value || '';
  const unitsPerPack = +document.getElementById('biUnitsPerPack')?.value || 0;
  if (type === 'direct' && packName && unitsPerPack < 2) { toast(`Enter how many units are in one ${packName.toLowerCase()}`, 'error'); return; }
  let measure = { enabled: false };
  if (type === 'direct' && document.getElementById('biMeasureOn')?.checked) {
    const bottleSize = +document.getElementById('biMBottle')?.value || 0;
    if (!bottleSize) { toast('Enter how much one full bottle holds', 'error'); return; }
    if (!_biTempPortions.length) { toast('Add at least one shot or glass size, or untick "sell by the shot or glass"', 'error'); return; }
    if (_biTempPortions.some(p => !String(p.name || '').trim() || !(+p.size > 0) || !(+p.price > 0))) { toast('Each shot or glass needs a name, an amount and a price', 'error'); return; }
    measure = {
      enabled: true, unit: document.getElementById('biMUnit').value, bottleSize,
      emptyWeight: document.getElementById('biMEmpty')?.value || '', density: document.getElementById('biMDensity')?.value || '',
      portions: _biTempPortions.map(p => ({ id: p.id || 0, name: String(p.name).trim(), size: +p.size, price: +p.price })),
    };
    if (!id) measure.openAmount = document.getElementById('biMOpen')?.value || '';
  }
  const res = await api('bar-inventory', id ? 'item_update' : 'item_add', {
    id, name, price, costPrice, type, stock, minStock, active, productType: uiTypeValue('bi'), measure,
    packName: packName && unitsPerPack > 1 ? packName : '', unitsPerPack: packName ? unitsPerPack : 0,
    recipeIngredients: type === 'recipe' ? _biTempRecipeIngs : [],
  });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast(id ? 'Item updated ' : 'Item added ');
  closeModal();
  loadBarItems();
}

// ── check the open bottle: weigh it, read its level, or type what is left ──
let _bmcItem = null;
function _bmcFromGrams(g, unit, density) {
  if (unit === 'g') return g;
  const ml = g / (density > 0 ? density : 0.94);
  return unit === 'cl' ? ml / 10 : unit === 'oz' ? ml / 29.5735 : ml;
}
async function showMeasureCheckModal(id) {
  const item = _biAllItems.find(i => i.id === id); if (!item) return;
  _bmcItem = item;
  const hasEmpty = +item.empty_weight > 0;
  document.getElementById('modalContent').innerHTML = `
    <h3 style="margin-bottom:6px">Check open bottle</h3>
    <div style="font-size:13px;margin-bottom:12px"><b>${esc(item.name)}</b> · the system expects <b>${_biAmt(item.open_amount, item.measure_unit)}</b> in the open bottle</div>
    <div class="form-group"><label class="form-label">How do you check it?</label>
      <select class="form-input" id="bmcMethod" onchange="bmcMethodChanged()">
        <option value="gross" ${hasEmpty ? 'selected' : ''}>Weigh the bottle on the scale (grams)</option>
        <option value="level" ${hasEmpty ? '' : 'selected'}>Read the level by eye (tenths)</option>
        <option value="amount">I measured how much is left (${esc(item.measure_unit)})</option>
      </select></div>
    <div class="form-group"><label class="form-label" id="bmcLabel"></label>
      <input type="number" class="form-input" id="bmcValue" min="0" step="any" oninput="bmcPreview()"/>
      <div id="bmcPreview" style="font-size:12px;color:var(--muted);margin-top:5px;min-height:16px"></div></div>
    <div class="form-group"><label class="form-label">Note (optional)</label>
      <input class="form-input" id="bmcNote" maxlength="120" placeholder="e.g. morning check"/></div>
    <div id="bmcResult"></div>
    <div style="display:flex;gap:10px;margin-top:6px">
      <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="submitMeasureCheck()">Save check</button>
      <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="closeModal()">Close</button>
    </div>
    <div style="font-size:12px;font-weight:700;color:var(--muted);margin:16px 0 6px">Recent checks</div>
    <div id="bmcHistory" style="font-size:12px"></div>`;
  document.getElementById('modalOverlay').classList.add('show');
  bmcMethodChanged();
  _bmcHistory(id);
}
function bmcMethodChanged() {
  const m = document.getElementById('bmcMethod').value, it = _bmcItem;
  const lab = { gross: 'Weight of the bottle with the drink in it (g)', level: 'How full is it? (0 = empty, 10 = full)', amount: `Amount left (${it.measure_unit})` };
  document.getElementById('bmcLabel').textContent = lab[m];
  const v = document.getElementById('bmcValue'); v.value = '';
  if (m === 'gross' && !(+it.empty_weight > 0)) document.getElementById('bmcPreview').textContent = 'Add the empty-bottle weight first: Edit item, then "Empty bottle weight".';
  else document.getElementById('bmcPreview').textContent = '';
}
function bmcPreview() {
  const it = _bmcItem, m = document.getElementById('bmcMethod').value, val = +document.getElementById('bmcValue').value, out = document.getElementById('bmcPreview');
  if (!val && val !== 0) { out.textContent = ''; return; }
  let found = null;
  if (m === 'gross' && +it.empty_weight > 0) found = val >= +it.empty_weight ? _bmcFromGrams(val - it.empty_weight, it.measure_unit, +it.density) : null;
  else if (m === 'level') found = val / 10 * it.bottle_size;
  else if (m === 'amount') found = val;
  out.textContent = found === null ? (m === 'gross' ? 'That is lighter than the empty bottle.' : '') : `About ${_biAmt(found, it.measure_unit)} left`;
}
async function submitMeasureCheck() {
  const it = _bmcItem, value = document.getElementById('bmcValue').value;
  if (value === '') { toast('Enter the weight, level or amount', 'error'); return; }
  const res = await api('bar-inventory', 'measure_check', { id: it.id, method: document.getElementById('bmcMethod').value, value: +value, note: document.getElementById('bmcNote').value });
  if (!res.ok) { toast(res.error || 'Could not save the check', 'error'); return; }
  const short = res.diff < -0.05, over = res.diff > 0.05;
  const col = short ? 'var(--red)' : over ? 'var(--orange)' : 'var(--green)';
  document.getElementById('bmcResult').innerHTML = `<div style="border:1px solid ${col};border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:13px;line-height:1.6">
    Found <b>${_biAmt(res.found, res.unit)}</b>, the system expected <b>${_biAmt(res.expected, res.unit)}</b>.<br>
    <b style="color:${col}">${short ? `${_biAmt(-res.diff, res.unit)} missing` : over ? `${_biAmt(res.diff, res.unit)} more than expected` : 'Matches the sales'}</b>${res.portions !== null && (short || over) ? ` (about ${Math.abs(res.portions)} shot${Math.abs(res.portions) === 1 ? '' : 's'}, ${fmtRWF(Math.abs(res.value))})` : ''}.
    The open bottle now counts as ${_biAmt(res.found, res.unit)}.</div>`;
  document.getElementById('bmcValue').value = ''; document.getElementById('bmcPreview').textContent = '';
  await loadBarItems();
  _bmcItem = _biAllItems.find(i => i.id === it.id) || it;
  _bmcHistory(it.id);
}
async function _bmcHistory(id) {
  const el = document.getElementById('bmcHistory'); if (!el) return;
  const res = await apiGet('bar-inventory', 'measure_history', { id });
  const rows = res.data || [];
  el.innerHTML = rows.length ? rows.map(r => {
    const d = +r.qty_change, c = d < -0.05 ? 'var(--red)' : d > 0.05 ? 'var(--orange)' : 'var(--green)';
    return `<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--border)"><span style="color:var(--muted)">${esc(String(r.created_at).slice(0, 16))} · ${esc(r.done_by || '')}</span><b style="color:${c}">${d > 0 ? '+' : ''}${_biAmt(d, r.unit)}${Math.abs(+r.total_cost) > 0 ? ` (${fmtRWF(Math.abs(+r.total_cost))})` : ''}</b></div>`;
  }).join('') : '<div style="color:var(--muted)">No checks yet</div>';
}

async function deleteBarItem(id) {
  if (!confirm('Delete this item?')) return;
  const res = await api('bar-inventory', 'item_delete', { id });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast('Deleted', 'warning');
  loadBarItems();
}

// ── ADD STOCK TO ITEM ─────────────────────────────
function showAddStockToItemModal(id) {
  const item = _biAllItems.find(row => row.id === id);
  if (!item) return;
  const per = +item.units_per_pack || 0;
  const packName = item.pack_name || 'Crate';
  document.getElementById('modalContent').innerHTML = `
    <h3 style="margin-bottom:18px">Receive Stock — ${esc(item.name)}</h3>
    ${per > 1 ? `<div class="form-group"><label class="form-label">Receive in</label>
      <div style="display:flex;gap:6px">
        <button type="button" class="ar-chip active" id="biRecvModePack" onclick="biSetRecvMode(true)">${esc(packName)}s of ${per}</button>
        <button type="button" class="ar-chip" id="biRecvModeUnit" onclick="biSetRecvMode(false)">Single bottles / pieces</button>
      </div></div>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label" id="biAddStockQtyLabel">${per > 1 ? `Number of ${esc(packName.toLowerCase())}s *` : 'Quantity to add *'}</label>
        <input type="number" class="form-input" id="biAddStockQty" min="0" step="any" oninput="biRecvTotals()"/></div>
      <div class="form-group"><label class="form-label" id="biAddStockCostLabel">${per > 1 ? `Price per ${esc(packName.toLowerCase())} (RWF) *` : 'Purchase cost per unit (RWF) *'}</label>
        <input type="number" class="form-input" id="biAddStockCost" min="0" step="0.01" value="${per > 1 && item.cost_price ? Math.round(item.cost_price * per) : (item.cost_price || '')}" oninput="biRecvTotals()"/></div>
    </div>
    <div id="biRecvSummary" class="ar-note" style="margin:-4px 0 12px"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Supplier</label>
        <input class="form-input" id="biAddStockSupplier" placeholder="Supplier name" list="supplierNames"/></div>
      <div class="form-group"><label class="form-label">Invoice / receipt no.</label>
        <input class="form-input" id="biAddStockReference"/></div>
    </div>
    ${purchasePayFields('biAddStock')}
    <div class="form-group"><label class="form-label">Purchase Date *</label>
      <input type="date" class="form-input" id="biAddStockDate" value="${today()}"/></div>
    <div class="form-group"><label class="form-label">Note</label>
      <input class="form-input" id="biAddStockNote" placeholder="e.g. Weekly delivery"/></div>
    <div style="display:flex;gap:10px;margin-top:6px">
      <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="submitAddStockToItem(${id})">Receive Stock</button>
      <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="closeModal()">Cancel</button>
    </div>`;
  window._biRecv = { item, per, packName, packs: per > 1 };
  loadSupplierNames();
  document.getElementById('modalOverlay').classList.add('show');
  biRecvTotals();
  setTimeout(() => document.getElementById('biAddStockQty')?.focus(), 100);
}

function biSetRecvMode(packs) {
  const r = window._biRecv; if (!r) return;
  const cost = document.getElementById('biAddStockCost');
  // keep the same money value when switching between crate price and unit price
  if (r.packs !== packs && +cost.value) cost.value = packs ? Math.round(+cost.value * r.per) : Math.round(+cost.value / r.per * 100) / 100;
  r.packs = packs;
  document.getElementById('biRecvModePack').classList.toggle('active', packs);
  document.getElementById('biRecvModeUnit').classList.toggle('active', !packs);
  document.getElementById('biAddStockQtyLabel').textContent = packs ? `Number of ${r.packName.toLowerCase()}s *` : 'Quantity to add (single units) *';
  document.getElementById('biAddStockCostLabel').textContent = packs ? `Price per ${r.packName.toLowerCase()} (RWF) *` : 'Purchase cost per unit (RWF) *';
  biRecvTotals();
}

// Units, unit cost and total for what is being received
function biRecvValues() {
  const r = window._biRecv;
  const q = +document.getElementById('biAddStockQty')?.value || 0;
  const c = +document.getElementById('biAddStockCost')?.value || 0;
  if (r && r.packs) return { units: q * r.per, unitCost: Math.round(c / r.per * 10000) / 10000, total: Math.round(q * c * 100) / 100, packQty: q };
  return { units: q, unitCost: c, total: Math.round(q * c * 100) / 100, packQty: 0 };
}
function biRecvTotals() {
  const r = window._biRecv, v = biRecvValues(), el = document.getElementById('biRecvSummary');
  if (!el) return;
  el.innerHTML = v.units > 0 && v.unitCost > 0
    ? `${r && r.packs ? `${v.packQty} ${esc(r.packName.toLowerCase())}(s) × ${r.per} = ` : ''}<strong>${v.units} units</strong> at ${fmtRWF(Math.round(v.unitCost * 100) / 100)} each · total <strong>${fmtRWF(v.total)}</strong>`
    : 'Enter the quantity and price to see the total.';
  purchasePayTotal('biAddStock', v.total);
}

async function submitAddStockToItem(id) {
  const r = window._biRecv, v = biRecvValues();
  const note = document.getElementById('biAddStockNote')?.value?.trim() || 'Stock received';
  const supplier = document.getElementById('biAddStockSupplier')?.value?.trim() || '';
  const reference = document.getElementById('biAddStockReference')?.value?.trim() || '';
  const purchaseDate = document.getElementById('biAddStockDate')?.value || '';
  if (!(v.units > 0) || !(v.unitCost > 0) || !purchaseDate) { toast('Quantity, purchase price, and date are required', 'error'); return; }
  const pay = readPurchasePay('biAddStock', v.total, supplier);
  if (!pay) return;
  const res = await api('bar-inventory', 'item_add_stock', {
    id, qty: v.units, unitCost: v.unitCost, supplier, reference, purchaseDate, note, ...pay,
    ...(r && r.packs ? { packQty: v.packQty, packName: r.packName, unitsPerPack: r.per } : {}),
  });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast(`+${v.units} ${r?.item?.name || ''} received `);
  closeModal();
  loadBarItems();
}

// ══════════════════════════════════════════════════
// BAR INGREDIENTS
// ══════════════════════════════════════════════════
async function loadBarIngredients() {
  const res = await apiGet('bar-inventory', 'ingredients_list');
  const ings = res.data || [];
  const tbody = document.getElementById('biIngBody');
  if (!tbody) return;

  // Low stock alert banner
  const lowAlert = document.getElementById('biLowStockAlert');
  const low = ings.filter(i => i.quantity <= i.min_stock);
  if (lowAlert) {
    if (low.length) {
      lowAlert.style.display = '';
      lowAlert.innerHTML = `<strong>${low.length} ingredient${low.length>1?'s':''} low on stock:</strong> ${low.map(i => `${esc(i.name)} (${i.quantity} ${esc(i.unit)})`).join(', ')}`;
    } else {
      lowAlert.style.display = 'none';
    }
  }

  renderStockValueBox('biIngValueBox', ings.map(i => ({ qty: i.quantity, unitCost: i.cost_per_unit })));

  if (!ings.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:40px;text-align:center;color:var(--muted)">No ingredients yet — add one</td></tr>`;
    return;
  }
  tbody.innerHTML = ings.map(i => {
    const isLow  = i.quantity <= i.min_stock;
    const isZero = i.quantity <= 0;
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:12px 16px;font-size:13px;font-weight:700;color:var(--text)">${esc(i.name)}</td>
      <td style="padding:12px 16px;text-align:center;font-size:15px;font-weight:900;color:${isZero?'var(--red)':isLow?'var(--orange)':'var(--text)'}">${i.quantity}</td>
      <td style="padding:12px 16px;font-size:13px;color:var(--muted)">${esc(i.unit)}</td>
      <td style="padding:12px 16px;text-align:right;font-size:13px;color:${i.cost_per_unit>0?'var(--text)':'var(--orange)'}">${i.cost_per_unit>0?fmtRWF(Math.round(i.cost_per_unit*100)/100):'No cost'}</td>
      <td style="padding:12px 16px;text-align:right;font-size:13px;font-weight:700;color:var(--green)">${fmtRWF(Math.round(i.stock_value||0))}</td>
      <td style="padding:12px 16px;text-align:center;font-size:13px;color:var(--muted)">${i.min_stock}</td>
      <td style="padding:12px 16px;text-align:center">
        <span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:${isZero?'rgba(239,68,68,.12)':isLow?'rgba(255,140,66,.12)':'rgba(14,168,117,.12)'};color:${isZero?'var(--red)':isLow?'var(--orange)':'var(--green)'}">
          ${isZero ? 'Empty' : isLow ? 'Low' : 'OK'}
        </span>
      </td>
      <td style="padding:12px 16px;text-align:center">
        <div style="display:flex;gap:6px;justify-content:center">
          <button data-perm="canManageItems" class="icon-act" onclick="showEditBarIngredientModal(${i.id})" title="Edit" aria-label="Edit">${ic('pencil')}</button>
          <button data-perm="canManageItems" class="icon-act danger" onclick="deleteBarIngredient(${i.id})" title="Delete" aria-label="Delete">${ic('trash')}</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function showAddBarIngredientModal(item) {
  document.getElementById('modalContent').innerHTML = `
    <h3 style="margin-bottom:18px">${item ? 'Edit Ingredient' : 'Add Ingredient'}</h3>
    <div class="form-group"><label class="form-label">Ingredient Name *</label>
      <input class="form-input" id="biIngName" value="${esc(item?.name||'')}" placeholder="e.g. Rum, Mint, Beer bottle" autofocus/></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label class="form-label">Quantity *</label>
        <input type="number" class="form-input" id="biIngQtyField" value="${item?.quantity||'0'}" min="0"/></div>
      <div class="form-group"><label class="form-label">Unit *</label>
        <input class="form-input" id="biIngUnitField" value="${esc(item?.unit||'')}" placeholder="ml, pcs, bottle, g…"/></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label class="form-label">Cost per Unit (RWF)</label>
        <input type="number" class="form-input" id="biIngCost" value="${item?.cost_per_unit||'0'}" min="0" step="0.01"/></div>
      <div class="form-group"><label class="form-label">Minimum Stock Alert Level</label>
        <input type="number" class="form-input" id="biIngMinStock" value="${item?.min_stock||'5'}" min="0"/></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:6px">
      <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="submitBarIngredient(${item?.id||0})">Save</button>
      <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="closeModal()">Cancel</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('show');
  setTimeout(() => document.getElementById('biIngName')?.focus(), 100);
}

async function showEditBarIngredientModal(id) {
  const res = await apiGet('bar-inventory', 'ingredient_get', { id });
  if (res.ok) showAddBarIngredientModal(res.data);
}

async function submitBarIngredient(id) {
  const name     = document.getElementById('biIngName')?.value?.trim();
  const quantity = +document.getElementById('biIngQtyField')?.value || 0;
  const unit     = document.getElementById('biIngUnitField')?.value?.trim();
  const minStock = +document.getElementById('biIngMinStock')?.value || 5;
  const costPerUnit = +document.getElementById('biIngCost')?.value || 0;
  if (!name || !unit) { toast('Name and unit are required', 'error'); return; }
  if (quantity > 0 && costPerUnit <= 0) { toast('Enter the cost per unit so stock value and recipe cost are correct', 'error'); return; }
  const res = await api('bar-inventory', id ? 'ingredient_update' : 'ingredient_add', { id, name, quantity, unit, minStock, costPerUnit });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast(id ? 'Updated ' : 'Ingredient added ');
  closeModal();
  loadBarIngredients();
}

async function deleteBarIngredient(id) {
  if (!confirm('Delete this ingredient?')) return;
  const res = await api('bar-inventory', 'ingredient_delete', { id });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast('Deleted', 'warning');
  loadBarIngredients();
}

function showBarReceiveStockModal() {
  apiGet('bar-inventory', 'ingredients_list').then(res => {
    const ings = res.data || [];
    const opts = ings.map(i => `<option value="${i.id}">${esc(i.name)} (${esc(i.unit)}) — ${i.quantity} left</option>`).join('');
    document.getElementById('modalContent').innerHTML = `
      <h3 style="margin-bottom:18px">Receive Stock</h3>
      <div class="form-group"><label class="form-label">Ingredient *</label>
        <select class="form-input" id="bmRecvIng"><option value="">Select...</option>${opts}</select></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group"><label class="form-label">Quantity to Add *</label>
          <input type="number" class="form-input" id="bmRecvQty" min="0.001" step="any" placeholder="e.g. 500" oninput="purchasePayTotal('bmRecv', (+this.value||0)*(+document.getElementById('bmRecvCost').value||0))"/></div>
        <div class="form-group"><label class="form-label">Purchase Cost per Unit (RWF) *</label>
          <input type="number" class="form-input" id="bmRecvCost" min="0.01" step="0.01" oninput="purchasePayTotal('bmRecv', (+this.value||0)*(+document.getElementById('bmRecvQty').value||0))"/></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group"><label class="form-label">Supplier</label>
          <input class="form-input" id="bmRecvSupplier" placeholder="Supplier name" list="supplierNames"/></div>
        <div class="form-group"><label class="form-label">Reference</label>
          <input class="form-input" id="bmRecvReference" placeholder="Invoice / receipt no."/></div>
      </div>
      ${purchasePayFields('bmRecv')}
      <div class="form-group"><label class="form-label">Purchase Date *</label>
        <input type="date" class="form-input" id="bmRecvDate" value="${today()}"/></div>
      <div class="form-group"><label class="form-label">Note</label>
        <input class="form-input" id="bmRecvNote" placeholder="e.g. Weekly purchase"/></div>
      <div style="display:flex;gap:10px;margin-top:6px">
        <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="submitBarReceiveStock()">Receive Stock</button>
        <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="closeModal()">Cancel</button>
      </div>`;
    document.getElementById('modalOverlay').classList.add('show');
    loadSupplierNames();
  });
}

async function submitBarReceiveStock() {
  const ingId = +document.getElementById('bmRecvIng')?.value;
  const qty   = +document.getElementById('bmRecvQty')?.value;
  const note  = document.getElementById('bmRecvNote')?.value?.trim() || 'Stock received';
  const unitCost     = +document.getElementById('bmRecvCost')?.value;
  const supplier     = document.getElementById('bmRecvSupplier')?.value?.trim() || '';
  const reference    = document.getElementById('bmRecvReference')?.value?.trim() || '';
  const purchaseDate = document.getElementById('bmRecvDate')?.value || '';
  if (!ingId || !(qty > 0) || !(unitCost > 0) || !purchaseDate) { toast('Ingredient, quantity, purchase cost, and date are required', 'error'); return; }
  const pay = readPurchasePay('bmRecv', Math.round(qty * unitCost * 100) / 100, supplier);
  if (!pay) return;
  const res = await api('bar-inventory', 'ingredient_receive', { ingId, qty, unitCost, supplier, reference, purchaseDate, note, ...pay });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast(`Stock received — spent ${fmtRWF(res.purchaseTotal)}`);
  closeModal();
  loadBarIngredients();
}

function showBarBreakageModal() {
  Promise.all([
    apiGet('bar-inventory', 'items_list'),
    apiGet('bar-inventory', 'ingredients_list'),
  ]).then(([itemsRes, ingRes]) => {
    const items = (itemsRes.data || []).filter(i => i.type === 'direct');
    const ings  = ingRes.data || [];
    const itemOpts = items.map(i => `<option value="item_${i.id}">${esc(i.name)} — ${i.stock} left</option>`).join('');
    const ingOpts  = ings.map(i => `<option value="ing_${i.id}">${esc(i.name)} (${esc(i.unit)}) — ${i.quantity} left</option>`).join('');
    document.getElementById('modalContent').innerHTML = `
      <h3 style="margin-bottom:18px">Record Breakage / Loss</h3>
      <div class="form-group"><label class="form-label">What broke/was lost? *</label>
        <select class="form-input" id="bmBrkTarget">
          <option value="">Select item or ingredient...</option>
          <optgroup label="Items (Direct)">${itemOpts}</optgroup>
          <optgroup label="Ingredients">${ingOpts}</optgroup>
        </select></div>
      <div class="form-group"><label class="form-label">Quantity Lost *</label>
        <input type="number" class="form-input" id="bmBrkQty" min="1"/></div>
      <div class="form-group"><label class="form-label">Reason *</label>
        <input class="form-input" id="bmBrkReason" placeholder="e.g. Bottle broke, Spilled…"/></div>
      <div style="display:flex;gap:10px;margin-top:6px">
        <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="submitBarBreakage()">Record</button>
        <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="closeModal()">Cancel</button>
      </div>`;
    document.getElementById('modalOverlay').classList.add('show');
  });
}

async function submitBarBreakage() {
  const target = document.getElementById('bmBrkTarget')?.value;
  const qty    = +document.getElementById('bmBrkQty')?.value;
  const reason = document.getElementById('bmBrkReason')?.value?.trim();
  if (!target || !qty || !reason) { toast('All fields required', 'error'); return; }
  const [targetType, targetId] = target.split('_');
  const res = await api('bar-inventory', 'record_breakage', { targetType, targetId: +targetId, qty, reason });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast('Breakage recorded ');
  closeModal();
  loadBarIngredients();
}

// ══════════════════════════════════════════════════
// STOCK MOVEMENTS
// ══════════════════════════════════════════════════
let _bmFilter   = 'today';
let _bmType     = 'all';
let _bmAllRows  = [];

async function loadBarMovements(filter) {
  _bmFilter = filter || 'today';
  ['today','week','month','date'].forEach(f => {
    const btn = document.getElementById(`bmFilter-${f}`);
    if (btn) {
      btn.style.fontWeight  = f === _bmFilter ? '800' : '600';
      btn.style.borderColor = f === _bmFilter ? 'var(--blue)' : 'var(--border)';
      btn.style.color       = f === _bmFilter ? 'var(--blue)' : 'var(--muted)';
    }
  });
  const params = { filter: _bmFilter };
  if (_bmFilter === 'date') params.date = document.getElementById('bmPickDate')?.value || '';
  const res = await apiGet('bar-inventory', 'movements_list', params);
  _bmAllRows = res.data || [];
  _renderMovements();
}

function bmFilterType(type, btn) {
  _bmType = type;
  document.querySelectorAll('.bm-type-btn').forEach(b => {
    b.style.background = 'var(--card)'; b.style.color = 'var(--muted)';
    b.style.border = '1px solid var(--border)';
  });
  if (btn) { btn.style.background = 'var(--blue)'; btn.style.color = '#fff'; btn.style.border = '1px solid var(--blue)'; }
  _renderMovements();
}

function _renderMovements() {
  const tbody = document.getElementById('bmMovementsBody');
  if (!tbody) return;
  let rows = _bmAllRows;
  if (_bmType !== 'all') rows = rows.filter(r => r.type === _bmType);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:40px;text-align:center;color:var(--muted)">No movements found for this period</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const isPos  = r.qty_change > 0;
    const typeMap = {
      sale:     { label: 'Sale',     color: 'var(--green)'  },
      purchase: { label: 'Purchase', color: 'var(--blue)'   },
      breakage: { label: 'Breakage', color: 'var(--red)'    },
      void:     { label: 'Void Restore', color: 'var(--orange)' },
      auto_deduction: { label: 'Deduction', color: 'var(--orange)' },
    };
    const tm = typeMap[r.type] || { label: r.type, color: 'var(--muted)' };
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:12px 16px;font-size:12px;color:var(--muted)">${esc(r.date)}</td>
      <td style="padding:12px 16px;font-size:13px;font-weight:600;color:var(--text)">${esc(r.item_name)}</td>
      <td style="padding:12px 16px;text-align:center">
        <span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:rgba(0,0,0,.05);color:${tm.color}">${tm.label}</span>
      </td>
      <td style="padding:12px 16px;text-align:center;font-size:14px;font-weight:900;color:${isPos?'var(--green)':'var(--red)'}">
        ${isPos?'+':''}${r.qty_change} ${esc(r.unit||'')}
      </td>
      <td style="padding:12px 16px;text-align:right;font-size:12px;color:var(--muted)">${r.type==='purchase'&&+r.total_cost>0?`<strong>${fmtRWF(r.total_cost)}</strong><br>${fmtRWF(r.unit_cost||0)} / ${esc(r.unit||'unit')}`:'—'}</td>
      <td style="padding:12px 16px;font-size:12px;color:var(--muted)">${esc(r.reason||r.order_number||'—')}${r.supplier?`<br>Supplier: ${esc(r.supplier)}`:''}${r.reference?`<br>Ref: ${esc(r.reference)}`:''}</td>
      <td style="padding:12px 16px;font-size:12px;color:var(--muted)">${esc(r.done_by||'')}</td>
    </tr>`;
  }).join('');
}
