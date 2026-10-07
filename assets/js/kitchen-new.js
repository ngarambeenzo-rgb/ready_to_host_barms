/* ═══════════════════════════════════════════════════
   kitchen-new.js
   Kitchen Dashboard, Menu, Recipes, Ingredients
═══════════════════════════════════════════════════ */

function _knBlockIfKitchenRole(){
  if (session.role === 'Kitchen') {
    toast('View only — ask a manager to make changes', 'warning');
    return true;
  }
  return false;
}

// ══════════════════════════════════════════════════
// KITCHEN DASHBOARD
// ══════════════════════════════════════════════════
async function loadKitchenDashboard() {
  const [salesRes, ingRes, expRes] = await Promise.all([
    apiGet('kitchen2', 'sales_stats'),
    apiGet('kitchen2', 'ingredients_list'),
    apiGet('kitchen2', 'expenses_today'),
  ]);

  // Sales stats
  if (salesRes.ok) {
    const s = salesRes.data;
    document.getElementById('kdTodaySales').textContent = fmtRWF(s.todaySales || 0);
    document.getElementById('kdWeekSales').textContent  = fmtRWF(s.weekSales  || 0);
    document.getElementById('kdMonthSales').textContent = fmtRWF(s.monthSales || 0);

    const rev    = s.todaySales || 0;
    const cost   = s.todayCost  || 0;
    const profit = rev - cost;
    const margin = rev > 0 ? Math.round((profit / rev) * 100) : 0;

    document.getElementById('kdRevenue').textContent  = fmtRWF(rev);
    document.getElementById('kdFoodCost').textContent = fmtRWF(cost);
    document.getElementById('kdProfit').textContent   = fmtRWF(profit);
    document.getElementById('kdMargin').textContent   = `${margin}%`;
    document.getElementById('kdProfit').style.color   = profit >= 0 ? 'var(--green)' : 'var(--red)';

    // Top foods
    const topEl = document.getElementById('kdTopFoods');
    if (topEl) {
      const top = s.topFoods || [];
      topEl.innerHTML = top.length
        ? top.map((f, i) => `<div onclick="showPage('kitchen-menu')" style="padding:6px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;cursor:pointer" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''"><span>${i+1}. ${esc(f.name)}</span><span style="font-weight:700;color:var(--blue)">${f.qty} sold</span></div>`).join('')
        : '<div style="color:var(--muted)">No sales yet today</div>';
    }
  }

  // Expenses
  if (expRes.ok) {
    document.getElementById('kdPurchases').textContent   = fmtRWF(expRes.data.purchases   || 0);
    document.getElementById('kdWaste').textContent       = fmtRWF(expRes.data.waste       || 0);
    document.getElementById('kdAdjustments').textContent = fmtRWF(expRes.data.adjustments || 0);
  }

  // Low stock
  if (ingRes.ok) {
    const low = (ingRes.data || []).filter(i => i.quantity <= i.min_stock);
    const lowEl = document.getElementById('kdLowStock');
    if (lowEl) {
      lowEl.innerHTML = low.length
        ? `<div style="margin-bottom:6px;font-size:11px;color:var(--muted)">Click to manage</div>`
          + low.map(i => `<div onclick="showPage('kitchen-ingredients')" style="padding:6px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;cursor:pointer" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''"><span style="color:var(--red)">${esc(i.name)}</span><span style="font-size:12px;color:var(--muted)">${i.quantity} ${esc(i.unit)} left</span></div>`).join('')
        : '<div style="color:var(--green)">All ingredients well stocked</div>';
    }
  }
}

// ══════════════════════════════════════════════════
// MENU
// ══════════════════════════════════════════════════
let _kmRecipes = [];

async function loadKitchenMenu() {
  const [menuRes, recipeRes] = await Promise.all([
    apiGet('kitchen2', 'menu_list'),
    apiGet('kitchen2', 'recipes_list'),
  ]);
  _kmRecipes = recipeRes.data || [];
  const tbody = document.getElementById('kmMenuBody');
  if (!tbody) return;
  const items = menuRes.data || [];
  const viewOnly = session.role === 'Kitchen';
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:40px;text-align:center;color:var(--muted)">No menu items yet${viewOnly ? '' : ' — add one'}</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(item => `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:12px 16px">
        <div class="item-cell">${viewOnly ? uiProductThumb({ name: item.name, image: item.image, kind: 'kitchen', productType: item.product_type }, 'sm') : uiThumbButton('kitchen', item)}<div style="min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--text)">${esc(item.name)}</div>
        <div style="font-size:11px;color:var(--muted)">${esc(item.description || '')}</div></div></div>
      </td>
      <td style="padding:12px 16px;font-size:13px;color:var(--muted)">${esc(item.category || '')}</td>
      <td style="padding:12px 16px;text-align:right;font-size:13px;font-weight:700;color:var(--blue)">${fmtRWF(item.price)}</td>
      <td style="padding:12px 16px;font-size:12px;color:var(--muted)">${esc(item.recipe_name || '—')}</td>
      <td style="padding:12px 16px;text-align:center">
        <span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:${item.status==='active'?'rgba(14,168,117,.12)':'rgba(200,200,200,.2)'};color:${item.status==='active'?'var(--green)':'var(--muted)'}">
          ${item.status === 'active' ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td style="padding:12px 16px;text-align:center;display:flex;gap:6px;justify-content:center">
        ${viewOnly ? '' : `
        <button data-perm="canManageItems" class="icon-act" onclick="showEditMenuItemModal(${item.id})" title="Edit" aria-label="Edit">${ic('pencil')}</button>
        <button data-perm="canManageItems" class="icon-act danger" onclick="deleteMenuItem(${item.id})" title="Delete" aria-label="Delete">${ic('trash')}</button>
        `}
      </td>
    </tr>
  `).join('');
}

function showAddMenuItemModal() {
  if (_knBlockIfKitchenRole()) return;
  _showMenuItemModal(null);
}
function showEditMenuItemModal(id) {
  if (_knBlockIfKitchenRole()) return;
  apiGet('kitchen2', 'menu_get', { id }).then(res => {
    if (res.ok) _showMenuItemModal(res.data);
  });
}

function _showMenuItemModal(item) {
  const recipeOpts = _kmRecipes.map(r => `<option value="${r.id}" ${item?.recipe_id==r.id?'selected':''}>${esc(r.name)}</option>`).join('');
  document.getElementById('modalContent').innerHTML = `
    <h3 style="margin-bottom:18px">${item ? 'Edit Menu Item' : 'Add Menu Item'}</h3>
    <div class="form-group"><label class="form-label">Food Name *</label>
      <input class="form-input" id="kmName" value="${esc(item?.name||'')}" placeholder="e.g. Rolex Omelet"/></div>
    ${uiTypePicker('km', item?.product_type || '', 'kitchen', 'kmName')}
    <div class="form-group"><label class="form-label">Category</label>
      <input class="form-input" id="kmCategory" value="${esc(item?.category||'')}" placeholder="e.g. Breakfast, Main, Drinks"/></div>
    <div class="form-group"><label class="form-label">Selling Price (RWF) *</label>
      <input type="number" class="form-input" id="kmPrice" value="${item?.price||''}" min="0"/></div>
    <div class="form-group"><label class="form-label">Description</label>
      <input class="form-input" id="kmDesc" value="${esc(item?.description||'')}" placeholder="Optional description"/></div>
    <div class="form-group"><label class="form-label">Linked Recipe</label>
      <select class="form-input" id="kmRecipe"><option value="">— No Recipe —</option>${recipeOpts}</select></div>
    <div class="form-group"><label class="form-label">Status</label>
      <select class="form-input" id="kmStatus">
        <option value="active" ${item?.status==='active'||!item?'selected':''}>Active</option>
        <option value="inactive" ${item?.status==='inactive'?'selected':''}>Inactive</option>
      </select></div>
    <div style="display:flex;gap:10px;margin-top:6px">
      <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="submitMenuItem(${item?.id||0})">Save</button>
      <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="closeModal()">Cancel</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('show');
}

async function submitMenuItem(id) {
  if (_knBlockIfKitchenRole()) return;
  const name     = document.getElementById('kmName')?.value?.trim();
  const category = document.getElementById('kmCategory')?.value?.trim();
  const price    = +document.getElementById('kmPrice')?.value || 0;
  const desc     = document.getElementById('kmDesc')?.value?.trim();
  const recipeId = +document.getElementById('kmRecipe')?.value || 0;
  const status   = document.getElementById('kmStatus')?.value;
  if (!name || !price) { toast('Name and price are required', 'error'); return; }
  const res = await api('kitchen2', id ? 'menu_update' : 'menu_add', { id, name, category, price, description: desc, recipeId, status, productType: uiTypeValue('km') });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast(id ? 'Menu item updated ' : 'Menu item added ');
  closeModal();
  loadKitchenMenu();
}

async function deleteMenuItem(id) {
  if (_knBlockIfKitchenRole()) return;
  if (!confirm('Delete this menu item?')) return;
  const res = await api('kitchen2', 'menu_delete', { id });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast('Deleted', 'warning');
  loadKitchenMenu();
}

// ══════════════════════════════════════════════════
// RECIPES
// ══════════════════════════════════════════════════
let _krIngredients = [];
let _krMenuItems   = [];
let _krTempIngredients = []; // for add/edit modal

async function loadKitchenRecipes() {
  const [recRes, ingRes, menuRes] = await Promise.all([
    apiGet('kitchen2', 'recipes_list'),
    apiGet('kitchen2', 'ingredients_list'),
    apiGet('kitchen2', 'menu_list'),
  ]);
  _krIngredients = ingRes.data || [];
  _krMenuItems   = menuRes.data || [];
  const tbody = document.getElementById('krRecipeBody');
  if (!tbody) return;
  const recipes = recRes.data || [];
  const viewOnly = session.role === 'Kitchen';
  if (!recipes.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:40px;text-align:center;color:var(--muted)">No recipes yet${viewOnly ? '' : ' — add one'}</td></tr>`;
    return;
  }
  tbody.innerHTML = recipes.map(r => `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:12px 16px;font-size:13px;font-weight:700;color:var(--text)">${esc(r.name)}</td>
      <td style="padding:12px 16px;font-size:13px;color:var(--muted)">${esc(r.menu_item_name || '—')}</td>
      <td style="padding:12px 16px;text-align:right;font-size:13px;color:var(--red);font-weight:700">${fmtRWF(r.total_cost || 0)}</td>
      <td style="padding:12px 16px;text-align:right;font-size:13px;color:var(--blue);font-weight:700">${fmtRWF(r.selling_price || 0)}</td>
      <td style="padding:12px 16px;text-align:right;font-size:13px;font-weight:700;color:${(r.selling_price-r.total_cost)>=0?'var(--green)':'var(--red)'}">${fmtRWF((r.selling_price||0)-(r.total_cost||0))}</td>
      <td style="padding:12px 16px;text-align:center;display:flex;gap:6px;justify-content:center">
        <button onclick="showRecipeDetail(${r.id})" style="background:var(--blue-lt);border:none;color:var(--blue);border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px">View</button>
        ${viewOnly ? '' : `<button data-perm="canManageItems" class="icon-act danger" onclick="deleteRecipe(${r.id})" title="Delete" aria-label="Delete">${ic('trash')}</button>`}
      </td>
    </tr>
  `).join('');
}

function showAddRecipeModal() {
  if (_knBlockIfKitchenRole()) return;
  _krTempIngredients = [];
  const menuOpts = _krMenuItems.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  const ingOpts  = _krIngredients.map(i => `<option value="${i.id}">${esc(i.name)} (${esc(i.unit)})</option>`).join('');
  document.getElementById('modalContent').innerHTML = `
    <h3 style="margin-bottom:18px">Add Recipe</h3>
    <div class="form-group"><label class="form-label">Recipe Name *</label>
      <input class="form-input" id="krName" placeholder="e.g. Rolex Recipe"/></div>
    <div class="form-group"><label class="form-label">Linked Menu Item</label>
      <select class="form-input" id="krMenuItem"><option value="">— None —</option>${menuOpts}</select></div>
    <div style="margin-bottom:12px">
      <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:8px">Ingredients</div>
      <div id="krIngList" style="margin-bottom:10px"></div>
      <div style="display:flex;gap:8px;align-items:center">
        <select class="form-input" id="krIngSelect" style="flex:1"><option value="">Select ingredient...</option>${ingOpts}</select>
        <input type="number" class="form-input" id="krIngQty" placeholder="Qty" style="width:80px" min="0"/>
        <button onclick="krAddIngredient()" style="background:var(--blue);color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-family:inherit;font-size:13px;white-space:nowrap">+ Add</button>
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:6px">
      <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="submitRecipe()">Save Recipe</button>
      <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="closeModal()">Cancel</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('show');
  _renderKrIngList();
}

function krAddIngredient() {
  const ingId  = +document.getElementById('krIngSelect')?.value;
  const qty    = +document.getElementById('krIngQty')?.value;
  if (!ingId || !qty) { toast('Select ingredient and enter quantity', 'error'); return; }
  const ing = _krIngredients.find(i => i.id === ingId);
  if (!ing) return;
  // Replace if already added
  const existing = _krTempIngredients.findIndex(i => i.ingId === ingId);
  if (existing >= 0) _krTempIngredients[existing].qty = qty;
  else _krTempIngredients.push({ ingId, name: ing.name, unit: ing.unit, qty, costPerUnit: ing.cost_per_unit || 0 });
  document.getElementById('krIngSelect').value = '';
  document.getElementById('krIngQty').value = '';
  _renderKrIngList();
}

function _renderKrIngList() {
  const el = document.getElementById('krIngList');
  if (!el) return;
  if (!_krTempIngredients.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px">No ingredients added yet</div>'; return; }
  el.innerHTML = _krTempIngredients.map((i, idx) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
      <span style="flex:1">${esc(i.name)}</span>
      <span style="color:var(--muted)">${i.qty} ${esc(i.unit)}</span>
      <span style="color:var(--red);font-size:11px">${fmtRWF(i.qty * i.costPerUnit)}</span>
      <button onclick="_krRemoveIng(${idx})" style="background:none;border:none;cursor:pointer;color:var(--red)">✕</button>
    </div>`).join('');
}

function _krRemoveIng(idx) { _krTempIngredients.splice(idx, 1); _renderKrIngList(); }

async function submitRecipe() {
  if (_knBlockIfKitchenRole()) return;
  const name       = document.getElementById('krName')?.value?.trim();
  const menuItemId = +document.getElementById('krMenuItem')?.value || 0;
  if (!name) { toast('Recipe name is required', 'error'); return; }
  if (!_krTempIngredients.length) { toast('Add at least one ingredient', 'error'); return; }
  const res = await api('kitchen2', 'recipe_add', { name, menuItemId, ingredients: _krTempIngredients });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast('Recipe saved ');
  closeModal();
  loadKitchenRecipes();
}

async function showRecipeDetail(id) {
  const res = await apiGet('kitchen2', 'recipe_costing', { id });
  if (!res.ok) { toast(res.error || 'Could not load recipe', 'error'); return; }
  const viewOnly = session.role === 'Kitchen';
  renderRecipeCostingModal(res.data, viewOnly ? '' : `
    <div style="display:flex;gap:8px;margin-top:14px">
      <button data-perm="canManageItems" class="btn btn-primary" style="flex:1;justify-content:center" onclick="showEditRecipeModal(${res.data.id})">Edit Recipe</button>
    </div>`);
}

async function showEditRecipeModal(id) {
  if (_knBlockIfKitchenRole()) return;
  closeModal();
  const res = await apiGet('kitchen2', 'recipe_get', { id });
  if (!res.ok) { toast('Could not load recipe', 'error'); return; }
  const r = res.data;

  // Build ingredient options
  const ingOpts = _krIngredients.map(i =>
    `<option value="${i.id}">${esc(i.name)} (${esc(i.unit)})</option>`
  ).join('');

  // Build menu item options
  const menuOpts = _krMenuItems.map(m =>
    `<option value="${m.id}" ${m.id == r.menu_item_id ? 'selected' : ''}>${esc(m.name)}</option>`
  ).join('');

  // Build existing ingredients list
  let editIngredients = (r.ingredients || []).map(i => ({
    ingId: i.ingredient_id, name: i.ingredient_name, unit: i.unit, qty: i.qty
  }));

  function renderEditIngList() {
    const tbody = document.getElementById('editIngList');
    if (!tbody) return;
    if (!editIngredients.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="padding:12px;text-align:center;color:var(--muted)">No ingredients yet</td></tr>';
      return;
    }
    tbody.innerHTML = editIngredients.map((ing, idx) => `
      <tr>
        <td style="padding:6px 4px;font-size:13px">${esc(ing.name)}</td>
        <td style="padding:6px 4px;text-align:center"><input type="number" value="${ing.qty}" min="0.001" step="0.001"
          style="width:70px;padding:4px;border:1px solid var(--border);border-radius:6px;text-align:center"
          onchange="editIngredients[${idx}].qty=+this.value"></td>
        <td style="padding:6px 4px;font-size:13px;color:var(--muted)">${esc(ing.unit)}</td>
        <td style="padding:6px 4px;text-align:center">
          <button onclick="editIngredients.splice(${idx},1);renderEditIngList()" style="background:var(--red-lt);border:none;border-radius:6px;padding:4px 8px;cursor:pointer;color:var(--red);font-size:12px">✕</button>
        </td>
      </tr>`).join('');
  }

  document.getElementById('modalContent').innerHTML = `
    <h3 style="margin-bottom:16px">Edit Recipe</h3>
    <div class="form-group" style="margin-bottom:12px">
      <label style="font-size:12px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">RECIPE NAME</label>
      <input class="form-input" id="editRecipeName" value="${esc(r.name)}" style="width:100%">
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label style="font-size:12px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">LINKED MENU ITEM</label>
      <select class="form-input" id="editRecipeMenuItem" style="width:100%">
        <option value="">— None —</option>${menuOpts}
      </select>
    </div>
    <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px">INGREDIENTS</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:10px">
      <thead><tr style="border-bottom:1px solid var(--border)">
        <th style="text-align:left;padding:6px 4px;font-size:11px;color:var(--muted)">Ingredient</th>
        <th style="text-align:center;padding:6px 4px;font-size:11px;color:var(--muted)">Qty</th>
        <th style="text-align:left;padding:6px 4px;font-size:11px;color:var(--muted)">Unit</th>
        <th style="padding:6px 4px;font-size:11px;color:var(--muted)"></th>
      </tr></thead>
      <tbody id="editIngList"></tbody>
    </table>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <select class="form-input" id="editIngSelect" style="flex:1"><option value="">— Add ingredient —</option>${ingOpts}</select>
      <input type="number" id="editIngQty" class="form-input" placeholder="Qty" min="0.001" step="0.001" style="width:80px">
      <button class="btn btn-ghost btn-sm" onclick="
        const sel=document.getElementById('editIngSelect');
        const qty=+document.getElementById('editIngQty').value;
        const ing=_krIngredients.find(i=>i.id==+sel.value);
        if(!ing||!qty){toast('Select ingredient and qty','error');return;}
        editIngredients.push({ingId:ing.id,name:ing.name,unit:ing.unit,qty});
        renderEditIngList();
        sel.value='';document.getElementById('editIngQty').value='';
      ">+ Add</button>
    </div>
    <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="saveEditRecipe(${id})">Save Changes</button>`;

  renderEditIngList();
  document.getElementById('modalOverlay').classList.add('show');
}

async function saveEditRecipe(id) {
  if (_knBlockIfKitchenRole()) return;
  const name       = document.getElementById('editRecipeName')?.value?.trim();
  const menuItemId = +document.getElementById('editRecipeMenuItem')?.value || 0;
  if (!name)              { toast('Recipe name required', 'error'); return; }
  if (!editIngredients.length) { toast('Add at least one ingredient', 'error'); return; }
  const res = await api('kitchen2', 'recipe_update', { id, name, menuItemId, ingredients: editIngredients });
  if (!res.ok) { toast(res.error || 'Failed to save', 'error'); return; }
  toast('Recipe updated ');
  closeModal();
  loadKitchenRecipes();
  loadKitchenMenu();
}

async function deleteRecipe(id) {
  if (_knBlockIfKitchenRole()) return;
  if (!confirm('Delete this recipe?')) return;
  const res = await api('kitchen2', 'recipe_delete', { id });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast('Deleted', 'warning');
  loadKitchenRecipes();
}

// ══════════════════════════════════════════════════
// INGREDIENTS INVENTORY
// ══════════════════════════════════════════════════
async function loadKitchenIngredients() {
  const res = await apiGet('kitchen2', 'ingredients_list');
  const tbody = document.getElementById('kiIngBody');
  if (!tbody) return;
  const ings = res.data || [];
  const viewOnly = session.role === 'Kitchen';
  renderStockValueBox('kiIngValueBox', ings.map(i => ({ qty: i.quantity, unitCost: i.cost_per_unit })));
  if (!ings.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:40px;text-align:center;color:var(--muted)">No ingredients yet${viewOnly ? '' : ' — add one'}</td></tr>`;
    return;
  }
  tbody.innerHTML = ings.map(i => {
    const isLow = i.quantity <= i.min_stock;
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:12px 16px;font-size:13px;font-weight:700;color:var(--text)">${esc(i.name)}</td>
      <td style="padding:12px 16px;text-align:center;font-size:14px;font-weight:900;color:${isLow?'var(--red)':'var(--text)'}">${i.quantity}</td>
      <td style="padding:12px 16px;font-size:13px;color:var(--muted)">${esc(i.unit)}</td>
      <td style="padding:12px 16px;text-align:right;font-size:13px;color:var(--muted)">${fmtRWF(i.cost_per_unit || 0)}</td>
      <td style="padding:12px 16px;text-align:right;font-size:13px;font-weight:700">${fmtRWF((i.quantity||0)*(i.cost_per_unit||0))}</td>
      <td style="padding:12px 16px;text-align:center;font-size:13px;color:var(--muted)">${i.min_stock}</td>
      <td style="padding:12px 16px;text-align:center">
        <span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:${isLow?'rgba(239,68,68,.12)':'rgba(14,168,117,.12)'};color:${isLow?'var(--red)':'var(--green)'}">
          ${isLow ? 'Low' : 'OK'}
        </span>
      </td>
      <td style="padding:12px 16px;text-align:center;display:flex;gap:6px;justify-content:center">
        ${viewOnly ? '' : `
        <button data-perm="canManageItems" class="icon-act" onclick="showEditIngredientModal(${i.id})" title="Edit" aria-label="Edit">${ic('pencil')}</button>
        <button data-perm="canManageItems" class="icon-act danger" onclick="deleteIngredient(${i.id})" title="Delete" aria-label="Delete">${ic('trash')}</button>
        `}
      </td>
    </tr>`;
  }).join('');
}

function showAddIngredientModal(item) {
  if (_knBlockIfKitchenRole()) return;
  document.getElementById('modalContent').innerHTML = `
    <h3 style="margin-bottom:18px">${item ? 'Edit Ingredient' : 'Add Ingredient'}</h3>
    <div class="form-group"><label class="form-label">Ingredient Name *</label>
      <input class="form-input" id="kiName" value="${esc(item?.name||'')}" placeholder="e.g. Eggs"/></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label class="form-label">Quantity *</label>
        <input type="number" class="form-input" id="kiQty" value="${item?.quantity||''}" min="0"/></div>
      <div class="form-group"><label class="form-label">Unit *</label>
        <input class="form-input" id="kiUnit" value="${esc(item?.unit||'')}" placeholder="pcs, kg, L, g…"/></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label class="form-label">Cost per Unit (RWF)</label>
        <input type="number" class="form-input" id="kiCost" value="${item?.cost_per_unit||''}" min="0"/></div>
      <div class="form-group"><label class="form-label">Minimum Stock Alert</label>
        <input type="number" class="form-input" id="kiMinStock" value="${item?.min_stock||'5'}" min="0"/></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:6px">
      <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="submitIngredient(${item?.id||0})">Save</button>
      <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="closeModal()">Cancel</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('show');
}

async function showEditIngredientModal(id) {
  if (_knBlockIfKitchenRole()) return;
  const res = await apiGet('kitchen2', 'ingredient_get', { id });
  if (res.ok) showAddIngredientModal(res.data);
}

async function submitIngredient(id) {
  if (_knBlockIfKitchenRole()) return;
  const name        = document.getElementById('kiName')?.value?.trim();
  const quantity    = +document.getElementById('kiQty')?.value || 0;
  const unit        = document.getElementById('kiUnit')?.value?.trim();
  const costPerUnit = +document.getElementById('kiCost')?.value || 0;
  const minStock    = +document.getElementById('kiMinStock')?.value || 5;
  if (!name || !unit) { toast('Name and unit are required', 'error'); return; }
  const res = await api('kitchen2', id ? 'ingredient_update' : 'ingredient_add', { id, name, quantity, unit, costPerUnit, minStock });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast(id ? 'Updated ' : 'Ingredient added ');
  closeModal();
  loadKitchenIngredients();
}

async function deleteIngredient(id) {
  if (_knBlockIfKitchenRole()) return;
  if (!confirm('Delete this ingredient?')) return;
  const res = await api('kitchen2', 'ingredient_delete', { id });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast('Deleted', 'warning');
  loadKitchenIngredients();
}

function showAddStockModal() {
  if (_knBlockIfKitchenRole()) return;
  apiGet('kitchen2', 'ingredients_list').then(res => {
    const ings = res.data || [];
    const opts = ings.map(i => `<option value="${i.id}">${esc(i.name)} (${esc(i.unit)}) — current: ${i.quantity}</option>`).join('');
    const now = new Date();
    const todayDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    document.getElementById('modalContent').innerHTML = `
      <h3 style="margin-bottom:18px">Receive Stock</h3>
      <div class="form-group"><label class="form-label">Ingredient *</label>
        <select class="form-input" id="kiStockIng"><option value="">Select...</option>${opts}</select></div>
      <div class="form-group"><label class="form-label">Quantity to Add *</label>
        <input type="number" class="form-input" id="kiStockQty" min="0" step="any" placeholder="e.g. 200" oninput="purchasePayTotal('kiStock', (+this.value||0)*(+document.getElementById('kiStockCost').value||0))"/></div>
      <div class="form-group"><label class="form-label">Purchase Cost per Unit (RWF) *</label>
        <input type="number" class="form-input" id="kiStockCost" min="0.01" step="0.01" oninput="purchasePayTotal('kiStock', (+this.value||0)*(+document.getElementById('kiStockQty').value||0))"/></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group"><label class="form-label">Supplier</label>
          <input class="form-input" id="kiStockSupplier" placeholder="Supplier name" list="supplierNames"/></div>
        <div class="form-group"><label class="form-label">Reference</label>
          <input class="form-input" id="kiStockReference" placeholder="Invoice / receipt no."/></div>
      </div>
      ${purchasePayFields('kiStock')}
      <div class="form-group"><label class="form-label">Purchase Date *</label>
        <input type="date" class="form-input" id="kiStockDate" value="${todayDate}"/></div>
      <div class="form-group"><label class="form-label">Note</label>
        <input class="form-input" id="kiStockNote" placeholder="e.g. Weekly purchase"/></div>
      <div style="display:flex;gap:10px;margin-top:6px">
        <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="submitReceiveStock()">Receive Stock</button>
        <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="closeModal()">Cancel</button>
      </div>`;
    document.getElementById('modalOverlay').classList.add('show');
  });
}

async function submitReceiveStock() {
  if (_knBlockIfKitchenRole()) return;
  const ingId = +document.getElementById('kiStockIng')?.value;
  const qty   = +document.getElementById('kiStockQty')?.value;
  const unitCost = +document.getElementById('kiStockCost')?.value;
  const note  = document.getElementById('kiStockNote')?.value?.trim() || 'Stock received';
  const supplier = document.getElementById('kiStockSupplier')?.value?.trim() || '';
  const reference = document.getElementById('kiStockReference')?.value?.trim() || '';
  const purchaseDate = document.getElementById('kiStockDate')?.value || '';
  if (!ingId || !qty || !unitCost || unitCost <= 0 || !purchaseDate) { toast('Ingredient, quantity, purchase cost, and date are required', 'error'); return; }
  const pay = readPurchasePay('kiStock', Math.round(qty * unitCost * 100) / 100, supplier);
  if (!pay) return;
  const res = await api('kitchen2', 'stock_receive', { ingId, qty, unitCost, supplier, reference, purchaseDate, note, ...pay });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast(`Stock received `);
  closeModal();
  loadKitchenIngredients();
}

function showWasteModal() {
  if (_knBlockIfKitchenRole()) return;
  apiGet('kitchen2', 'ingredients_list').then(res => {
    const ings = res.data || [];
    const opts = ings.map(i => `<option value="${i.id}">${esc(i.name)} (${esc(i.unit)}) — current: ${i.quantity}</option>`).join('');
    document.getElementById('modalContent').innerHTML = `
      <h3 style="margin-bottom:18px">Record Waste / Adjustment</h3>
      <div class="form-group"><label class="form-label">Ingredient *</label>
        <select class="form-input" id="kiWasteIng"><option value="">Select...</option>${opts}</select></div>
      <div class="form-group"><label class="form-label">Quantity to Deduct *</label>
        <input type="number" class="form-input" id="kiWasteQty" min="1"/></div>
      <div class="form-group"><label class="form-label">Type</label>
        <select class="form-input" id="kiWasteType">
          <option value="waste">Waste / Spoiled</option>
          <option value="adjustment">Adjustment</option>
        </select></div>
      <div class="form-group"><label class="form-label">Reason *</label>
        <input class="form-input" id="kiWasteReason" placeholder="e.g. Expired, Broken…"/></div>
      <div style="display:flex;gap:10px;margin-top:6px">
        <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="submitWaste()">Record</button>
        <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="closeModal()">Cancel</button>
      </div>`;
    document.getElementById('modalOverlay').classList.add('show');
  });
}

async function submitWaste() {
  if (_knBlockIfKitchenRole()) return;
  const ingId  = +document.getElementById('kiWasteIng')?.value;
  const qty    = +document.getElementById('kiWasteQty')?.value;
  const type   = document.getElementById('kiWasteType')?.value;
  const reason = document.getElementById('kiWasteReason')?.value?.trim();
  if (!ingId || !qty || !reason) { toast('All fields required', 'error'); return; }
  const res = await api('kitchen2', 'stock_adjust', { ingId, qty: -qty, type, reason });
  if (!res.ok) { toast(res.error || 'Failed', 'error'); return; }
  toast('Recorded ');
  closeModal();
  loadKitchenIngredients();
}
