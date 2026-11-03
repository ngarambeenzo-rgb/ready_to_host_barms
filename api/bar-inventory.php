<?php
// ============================================================
//  api/bar-inventory.php
//  Items, Ingredients, Stock Movements
// ============================================================
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/purchase_lib.php';
require_once __DIR__ . '/measure_lib.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();
$action = $_REQUEST['action'] ?? '';
$sess   = requireAuth();
$db     = getDB();

// ── ITEMS LIST ────────────────────────────────────────────────
if ($action === 'items_list') {
    $stmt = $db->query("
        SELECT bi.*, br.name AS recipe_name,
               COALESCE((SELECT SUM(bri.qty * bing.cost_per_unit)
                         FROM bar_recipe_ingredients bri
                         JOIN bar_ingredients bing ON bing.id = bri.ingredient_id
                         WHERE bri.recipe_id = bi.recipe_id), 0) AS recipe_cost
        FROM bar_items bi
        LEFT JOIN bar_recipes br ON br.id = bi.recipe_id
        ORDER BY bi.name ASC
    ");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']         = (int)$r['id'];
        $r['price']      = (float)$r['price'];
        $r['cost_price'] = (float)($r['cost_price'] ?? 0);
        $r['recipe_cost'] = round((float)$r['recipe_cost'], 2);
        // Recipe items: cost of one serving comes from their ingredients
        $r['unit_cost']  = $r['type'] === 'recipe' ? $r['recipe_cost'] : $r['cost_price'];
        $r['stock']      = (float)$r['stock'];
        $r['min_stock']  = (float)$r['min_stock'];
        $r['active']     = (int)$r['active'];
        $r['open_amount'] = (float)($r['open_amount'] ?? 0);
        $r['bottle_size'] = $r['bottle_size'] !== null ? (float)$r['bottle_size'] : null;
        $r['portion_size'] = $r['portion_size'] !== null ? (float)$r['portion_size'] : null;
    }
    unset($r);
    // shots / glasses: how many can still be sold from the bottle they come from
    $byId = []; foreach ($rows as $x) $byId[$x['id']] = $x;
    foreach ($rows as &$r) {
        if ($r['type'] !== 'portion') continue;
        $bt = $byId[(int)$r['parent_id']] ?? null;
        $r['portions_left'] = $bt ? measurePortionsLeft($bt, (float)$r['portion_size']) : 0;
        $r['unit_cost']     = $bt ? measurePortionCost($bt, (float)$r['portion_size']) : 0;
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

// ── ITEM GET ──────────────────────────────────────────────────
if ($action === 'item_get') {
    $id   = (int)($_GET['id'] ?? 0);
    $stmt = $db->prepare('SELECT bi.*, br.name AS recipe_name FROM bar_items bi LEFT JOIN bar_recipes br ON br.id = bi.recipe_id WHERE bi.id = ? LIMIT 1');
    $stmt->execute([$id]);
    $item = $stmt->fetch();
    if (!$item) jsonOut(['ok' => false, 'error' => 'Not found'], 404);
    $item['cost_price'] = (float)($item['cost_price'] ?? 0);
    foreach (['bottle_size', 'open_amount', 'empty_weight', 'density', 'portion_size'] as $k) if ($item[$k] !== null) $item[$k] = (float)$item[$k];
    if ($item['measure_unit']) {
        $ps = $db->prepare("SELECT id, pack_name AS name, portion_size AS size, price FROM bar_items WHERE parent_id = ? AND type = 'portion' AND active = 1 ORDER BY portion_size");
        $ps->execute([$id]);
        $item['portions'] = $ps->fetchAll();
    }
    // Load recipe ingredients if recipe item
    if ($item['recipe_id']) {
        $riStmt = $db->prepare('SELECT bri.*, bi2.name AS ing_name, bi2.unit FROM bar_recipe_ingredients bri JOIN bar_ingredients bi2 ON bi2.id = bri.ingredient_id WHERE bri.recipe_id = ?');
        $riStmt->execute([$item['recipe_id']]);
        $item['recipeIngredients'] = $riStmt->fetchAll();
    }
    jsonOut(['ok' => true, 'data' => $item]);
}

// ── ITEM COSTING (recipe items) ───────────────────────────────
if ($action === 'item_costing') {
    require_once __DIR__ . '/recipe_costing.php';
    $id   = (int)($_GET['id'] ?? 0);
    $stmt = $db->prepare('SELECT * FROM bar_items WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $item = $stmt->fetch();
    if (!$item) jsonOut(['ok' => false, 'error' => 'Item not found'], 404);
    $ings = [];
    if ($item['type'] === 'recipe' && $item['recipe_id']) {
        $iStmt = $db->prepare('SELECT bri.ingredient_id, bri.qty, bing.name AS ingredient_name, bing.unit, bing.cost_per_unit FROM bar_recipe_ingredients bri JOIN bar_ingredients bing ON bing.id = bri.ingredient_id WHERE bri.recipe_id = ? ORDER BY bing.name');
        $iStmt->execute([$item['recipe_id']]);
        $ings = $iStmt->fetchAll();
    }
    $costing = buildRecipeCosting($db, $ings, 'bar_ingredient', (float)$item['price'], recipeSalesStats($db, 'bar_sales', $id));
    jsonOut(['ok' => true, 'data' => ['id' => (int)$item['id'], 'name' => $item['name'], 'itemName' => $item['name']] + $costing]);
}

// ── ITEM ADD ──────────────────────────────────────────────────
if ($action === 'item_add') {
    requirePerm('canManageItems');
    $body      = json_decode(file_get_contents('php://input'), true);
    $name      = trim($body['name']      ?? '');
    $price     = (float)($body['price']  ?? 0);
    $costPrice = (float)($body['costPrice'] ?? 0);
    $type      = trim($body['type']      ?? 'direct');
    $stock     = (float)($body['stock']  ?? 0);
    $minStock  = (float)($body['minStock'] ?? 5);
    $active    = (int)($body['active']   ?? 1);
    $recipeIngs= $body['recipeIngredients'] ?? [];
    if (!$name || $price <= 0) jsonOut(['ok' => false, 'error' => 'Name and selling price are required'], 400);
    if ($type === 'direct' && $costPrice <= 0) jsonOut(['ok' => false, 'error' => 'Buy cost is required for direct items'], 400);
    if ($type === 'recipe' && !$recipeIngs) jsonOut(['ok' => false, 'error' => 'Add at least one ingredient to the recipe'], 400);
    if ($type === 'recipe') $costPrice = 0; // recipe cost comes from its ingredients
    // crate/carton size for this product (each product has its own)
    $unitsPerPack = (int)($body['unitsPerPack'] ?? 0) > 1 && $type === 'direct' ? (int)$body['unitsPerPack'] : null;
    $packName     = $unitsPerPack ? (mb_substr(trim($body['packName'] ?? ''), 0, 30) ?: 'Crate') : null;
    if ($type === 'direct' && $stock < 0) jsonOut(['ok' => false, 'error' => 'Stock cannot be negative'], 400);

    $db->beginTransaction();
    try {
        $recipeId = null;
        if ($type === 'recipe' && $recipeIngs) {
            $db->prepare('INSERT INTO bar_recipes (name) VALUES (?)')->execute([$name . ' Recipe']);
            $recipeId = (int)$db->lastInsertId();
            foreach ($recipeIngs as $ri) {
                $db->prepare('INSERT INTO bar_recipe_ingredients (recipe_id, ingredient_id, qty, unit) VALUES (?,?,?,?)')
                   ->execute([$recipeId, (int)$ri['ingId'], (float)$ri['qty'], $ri['unit']]);
            }
        }
        $db->prepare('INSERT INTO bar_items (name, price, cost_price, type, stock, min_stock, active, recipe_id, pack_name, units_per_pack) VALUES (?,?,?,?,?,?,?,?,?,?)')
           ->execute([$name, $price, $costPrice, $type, $type==='direct'?$stock:0, $minStock, $active, $recipeId, $packName, $unitsPerPack]);
        $itemId = (int)$db->lastInsertId();
        $db->prepare('UPDATE bar_items SET product_type=? WHERE id=?')->execute([cleanProductType($body['productType'] ?? ''), $itemId]);
        if (!empty($body['measure']['enabled'])) {
            $err = measureSave($db, $itemId, $body['measure']);
            if ($err) { $db->rollBack(); jsonOut(['ok' => false, 'error' => $err], 400); }
            if (isset($body['measure']['openAmount']) && $body['measure']['openAmount'] !== '') $db->prepare('UPDATE bar_items SET open_amount = ? WHERE id = ?')->execute([max(0, (float)$body['measure']['openAmount']), $itemId]);
        }

        if ($type === 'direct' && $stock > 0) {
                $initialCost = round($stock * $costPrice, 2);
                $db->prepare('INSERT INTO bar_movements (item_name, item_id, qty_change, type, reason, unit, unit_cost, total_cost, done_by) VALUES (?,?,?,?,?,?,?,?,?)')
                    ->execute([$name, $itemId, $stock, 'purchase', 'Initial stock', 'pcs', $costPrice, $initialCost, $sess['full_name']]);
                $db->prepare('INSERT INTO inventory_purchases (inventory_type, inventory_id, item_name, quantity, unit, unit_cost, total_cost, purchase_date, recorded_by) VALUES (?,?,?,?,?,?,?,?,?)')
                    ->execute(['bar_item', $itemId, $name, $stock, 'pcs', $costPrice, $initialCost, date('Y-m-d'), $sess['full_name']]);
        }
        $db->commit();
        jsonOut(['ok' => true, 'id' => $itemId]);
    } catch (Exception $e) { $db->rollBack(); serverFail($e); }
}

// ── ITEM UPDATE ───────────────────────────────────────────────
if ($action === 'item_update') {
    requirePerm('canManageItems');
    $body     = json_decode(file_get_contents('php://input'), true);
    $id       = (int)($body['id']       ?? 0);
    $name     = trim($body['name']      ?? '');
    $price    = (float)($body['price']  ?? 0);
    $costPrice= (float)($body['costPrice'] ?? 0);
    $type     = trim($body['type']      ?? 'direct');
    $minStock = (float)($body['minStock'] ?? 5);
    $active   = (int)($body['active']   ?? 1);
    $recipeIngs = $body['recipeIngredients'] ?? [];
    if (!$id || !$name || $price <= 0) jsonOut(['ok' => false, 'error' => 'Name and selling price are required'], 400);
    if ($type === 'direct' && $costPrice <= 0) jsonOut(['ok' => false, 'error' => 'Buy cost is required for direct items'], 400);
    if ($type === 'recipe' && !$recipeIngs) jsonOut(['ok' => false, 'error' => 'Add at least one ingredient to the recipe'], 400);
    if ($type === 'recipe') $costPrice = 0; // recipe cost comes from its ingredients
    // crate/carton size for this product (each product has its own)
    $unitsPerPack = (int)($body['unitsPerPack'] ?? 0) > 1 && $type === 'direct' ? (int)$body['unitsPerPack'] : null;
    $packName     = $unitsPerPack ? (mb_substr(trim($body['packName'] ?? ''), 0, 30) ?: 'Crate') : null;

    $db->beginTransaction();
    try {
        // Get current recipe_id
        $curStmt = $db->prepare('SELECT recipe_id, type FROM bar_items WHERE id = ? LIMIT 1');
        $curStmt->execute([$id]);
        $cur = $curStmt->fetch();
        $recipeId = $cur['recipe_id'];

        if ($type === 'recipe') {
            if ($recipeId) {
                $db->prepare('DELETE FROM bar_recipe_ingredients WHERE recipe_id = ?')->execute([$recipeId]);
            } else {
                $db->prepare('INSERT INTO bar_recipes (name) VALUES (?)')->execute([$name . ' Recipe']);
                $recipeId = (int)$db->lastInsertId();
            }
            foreach ($recipeIngs as $ri) {
                $db->prepare('INSERT INTO bar_recipe_ingredients (recipe_id, ingredient_id, qty, unit) VALUES (?,?,?,?)')
                   ->execute([$recipeId, (int)$ri['ingId'], (float)$ri['qty'], $ri['unit']]);
            }
        } else {
            $recipeId = null;
        }

        $db->prepare('UPDATE bar_items SET pack_name=?, units_per_pack=? WHERE id=?')->execute([$packName, $unitsPerPack, $id]);
        if (array_key_exists('productType', $body)) $db->prepare('UPDATE bar_items SET product_type=? WHERE id=?')->execute([cleanProductType($body['productType']), $id]);
        $db->prepare('UPDATE bar_items SET name=?,price=?,cost_price=?,type=?,min_stock=?,active=?,recipe_id=? WHERE id=?')
           ->execute([$name, $price, $costPrice, $type, $minStock, $active, $recipeId, $id]);
        if (array_key_exists('measure', $body)) {
            $err = measureSave($db, $id, $body['measure']);
            if ($err) { $db->rollBack(); jsonOut(['ok' => false, 'error' => $err], 400); }
        }
        measureSyncPortionCosts($db, $id);
        $db->commit();
        jsonOut(['ok' => true]);
    } catch (Exception $e) { $db->rollBack(); serverFail($e); }
}

// ── ITEM DELETE ───────────────────────────────────────────────
if ($action === 'item_delete') {
    requirePerm('canManageItems');
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    if (!$id) jsonOut(['ok' => false, 'error' => 'id required'], 400);
    $ps = $db->prepare("SELECT id FROM bar_items WHERE parent_id = ? AND type = 'portion'");
    $ps->execute([$id]);
    foreach ($ps->fetchAll(PDO::FETCH_COLUMN) as $pid) measureRemovePortion($db, (int)$pid);
    $db->prepare('DELETE FROM bar_items WHERE id = ?')->execute([$id]);
    jsonOut(['ok' => true]);
}

// ── ITEM ADD STOCK ────────────────────────────────────────────
if ($action === 'item_add_stock') {
    requirePerm('canEditStock');
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id']  ?? 0);
    $qty  = (float)($body['qty'] ?? 0);
    $note = trim($body['note'] ?? 'Stock received');
    $unitCost = (float)($body['unitCost'] ?? 0);
    $supplier = trim($body['supplier'] ?? '');
    $reference = trim($body['reference'] ?? '');
    $purchaseDate = trim($body['purchaseDate'] ?? date('Y-m-d'));
    if (!$id || $qty <= 0 || $unitCost <= 0) jsonOut(['ok' => false, 'error' => 'Item, quantity, and purchase cost per unit are required'], 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $purchaseDate)
        || !checkdate((int)substr($purchaseDate, 5, 2), (int)substr($purchaseDate, 8, 2), (int)substr($purchaseDate, 0, 4))) {
        jsonOut(['ok' => false, 'error' => 'Enter a valid purchase date'], 400);
    }

    $db->beginTransaction();
    try {
          $nStmt = $db->prepare('SELECT name, stock, cost_price FROM bar_items WHERE id = ? AND type="direct" LIMIT 1');
        $nStmt->execute([$id]);
        $item = $nStmt->fetch();
          if (!$item) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Direct stock item not found'], 404); }
          $newStock = (float)$item['stock'] + $qty;
          $totalCost = round($qty * $unitCost, 2);
          [$amountPaid, $payMethod] = purchasePayment($body, $totalCost, $supplier);
          [$packQty, $packName, $perPack] = purchasePacks($body, $qty);
          $newCost = ((max(0, (float)$item['stock']) * $item['cost_price']) + $totalCost) / max(0.001, max(0, (float)$item['stock']) + $qty);
          $db->prepare('UPDATE bar_items SET stock = ?, cost_price = ? WHERE id = ?')->execute([$newStock, $newCost, $id]);
          measureSyncPortionCosts($db, $id);
          $db->prepare('INSERT INTO bar_movements (item_name, item_id, qty_change, type, reason, unit, supplier, reference, unit_cost, total_cost, done_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
              ->execute([$item['name'], $id, $qty, 'purchase', $note, 'pcs', $supplier ?: null, $reference ?: null, $unitCost, $totalCost, $sess['full_name']]);
          $db->prepare('INSERT INTO inventory_purchases (inventory_type, inventory_id, item_name, quantity, unit, unit_cost, total_cost, amount_paid, payment_method, pack_qty, pack_name, units_per_pack, shift_id, supplier, reference, purchase_date, recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
              ->execute(['bar_item', $id, $item['name'], $qty, 'pcs', $unitCost, $totalCost, $amountPaid, $payMethod, $packQty, $packName, $perPack, currentShiftId(), $supplier ?: null, $reference ?: null, $purchaseDate, $sess['full_name']]);
        $db->commit();
          jsonOut(['ok' => true, 'newStock' => $newStock, 'unitCost' => $newCost, 'stockValue' => round($newStock * $newCost, 2), 'purchaseTotal' => $totalCost]);
    } catch (Exception $e) { $db->rollBack(); serverFail($e); }
}

// ── CHECK THE OPEN BOTTLE (weigh it, read its level, or type what is left) ──
if ($action === 'measure_check') {
    requirePerm('canEditStock');
    $body   = json_decode(file_get_contents('php://input'), true);
    $id     = (int)($body['id'] ?? 0);
    $method = (string)($body['method'] ?? '');
    $value  = (float)($body['value'] ?? 0);
    $note   = mb_substr(trim((string)($body['note'] ?? '')), 0, 120);
    $db->beginTransaction();
    try {
        $b = measureLoadBottle($db, $id, true);
        if (!$b || !$b['measure_unit'] || (float)$b['bottle_size'] <= 0) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'This item is not sold by the shot or glass'], 400); }
        $unit = $b['measure_unit']; $size = (float)$b['bottle_size'];
        if ($method === 'gross') {
            $empty = (float)($b['empty_weight'] ?? 0);
            if ($empty <= 0) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Save the empty-bottle weight on this item first (Edit item → Weighing)'], 400); }
            if ($value < $empty) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'That is lighter than the empty bottle. Check the weight and the empty-bottle weight.'], 400); }
            $found = measureFromGrams($value - $empty, $unit, (float)($b['density'] ?: 0.94));
            $how = 'weighed ' . rtrim(rtrim(number_format($value, 1, '.', ''), '0'), '.') . ' g';
        } elseif ($method === 'level') {
            if ($value < 0 || $value > 10) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Level is between 0 and 10 tenths'], 400); }
            $found = $value / 10 * $size;
            $how = 'level ' . rtrim(rtrim(number_format($value, 1, '.', ''), '0'), '.') . '/10';
        } elseif ($method === 'amount') {
            if ($value < 0) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Amount cannot be negative'], 400); }
            $found = $value;
            $how = 'measured';
        } else { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Choose how you checked the bottle'], 400); }
        $found = round(min($found, $size), 3);
        $expected = round((float)$b['open_amount'], 3);
        $diff = round($found - $expected, 3);
        $perUnit = measureCostPerUnit($b);
        $db->prepare('UPDATE bar_items SET open_amount = ? WHERE id = ?')->execute([$found, $id]);
        $fmt = fn($n) => rtrim(rtrim(number_format($n, 1, '.', ''), '0'), '.');
        $reason = "Open bottle check ($how): system expected {$fmt($expected)} $unit, found {$fmt($found)} $unit" . ($note ? " — $note" : '');
        // item_id stays empty on purpose: the amount is in $unit, not in bottles, so it must not mix into the bottle count
        $db->prepare('INSERT INTO bar_movements (item_name, item_id, qty_change, type, reason, unit, reference, unit_cost, total_cost, done_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
           ->execute([$b['name'] . ' (open bottle)', null, $diff, 'measure_check', $reason, $unit, 'bottle:' . $id, $perUnit, round($diff * $perUnit, 2), $sess['full_name']]);
        $db->commit();
        $ps = $db->prepare("SELECT MIN(portion_size) FROM bar_items WHERE parent_id = ? AND type = 'portion' AND active = 1");
        $ps->execute([$id]);
        $small = (float)$ps->fetchColumn();
        jsonOut(['ok' => true, 'expected' => $expected, 'found' => $found, 'diff' => $diff, 'unit' => $unit, 'value' => round($diff * $perUnit, 2),
                 'portions' => $small > 0 ? round($diff / $small, 1) : null]);
    } catch (Exception $e) { $db->rollBack(); serverFail($e); }
}

if ($action === 'measure_history') {
    $id = (int)($_GET['id'] ?? 0);
    $st = $db->prepare("SELECT qty_change, unit, reason, total_cost, done_by, created_at FROM bar_movements WHERE type = 'measure_check' AND reference = ? ORDER BY id DESC LIMIT 15");
    $st->execute(['bottle:' . $id]);
    jsonOut(['ok' => true, 'data' => $st->fetchAll()]);
}

// ── INGREDIENTS LIST ──────────────────────────────────────────
if ($action === 'ingredients_list') {
    $stmt = $db->query('SELECT * FROM bar_ingredients ORDER BY name ASC');
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']        = (int)$r['id'];
        $r['quantity']  = (float)$r['quantity'];
        $r['min_stock'] = (float)$r['min_stock'];
        $r['cost_per_unit'] = (float)$r['cost_per_unit'];
        $r['stock_value']   = round($r['quantity'] * $r['cost_per_unit'], 2);
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

// ── INGREDIENT GET ────────────────────────────────────────────
if ($action === 'ingredient_get') {
    $id   = (int)($_GET['id'] ?? 0);
    $stmt = $db->prepare('SELECT * FROM bar_ingredients WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $row  = $stmt->fetch();
    if (!$row) jsonOut(['ok' => false, 'error' => 'Not found'], 404);
    jsonOut(['ok' => true, 'data' => $row]);
}

// ── INGREDIENT ADD ────────────────────────────────────────────
if ($action === 'ingredient_add') {
    requirePerm('canManageItems');
    $body     = json_decode(file_get_contents('php://input'), true);
    $name     = trim($body['name']     ?? '');
    $quantity = (float)($body['quantity'] ?? 0);
    $unit     = trim($body['unit']     ?? '');
    $minStock = (float)($body['minStock'] ?? 5);
    $costPerUnit = (float)($body['costPerUnit'] ?? 0);
    if (!$name || !$unit) jsonOut(['ok' => false, 'error' => 'Name and unit required'], 400);
    if ($costPerUnit < 0) jsonOut(['ok' => false, 'error' => 'Cost cannot be negative'], 400);
    if ($quantity > 0 && $costPerUnit <= 0) jsonOut(['ok' => false, 'error' => 'Enter the cost per unit so stock value and recipe cost are correct'], 400);
    $db->prepare('INSERT INTO bar_ingredients (name, quantity, unit, cost_per_unit, min_stock) VALUES (?,?,?,?,?)')
       ->execute([$name, $quantity, $unit, $costPerUnit, $minStock]);
    $newId = (int)$db->lastInsertId();
    if ($quantity > 0) {
        $db->prepare('INSERT INTO bar_movements (item_name, ingredient_id, qty_change, type, reason, unit, unit_cost, total_cost, done_by) VALUES (?,?,?,?,?,?,?,?,?)')
           ->execute([$name, $newId, $quantity, 'adjust', 'Opening stock', $unit, $costPerUnit, round($quantity * $costPerUnit, 2), $sess['full_name']]);
    }
    jsonOut(['ok' => true, 'id' => $newId]);
}

// ── INGREDIENT UPDATE ─────────────────────────────────────────
if ($action === 'ingredient_update') {
    requirePerm('canManageItems');
    $body     = json_decode(file_get_contents('php://input'), true);
    $id       = (int)($body['id']      ?? 0);
    $name     = trim($body['name']     ?? '');
    $quantity = (float)($body['quantity'] ?? 0);
    $unit     = trim($body['unit']     ?? '');
    $minStock = (float)($body['minStock'] ?? 5);
    $costPerUnit = (float)($body['costPerUnit'] ?? 0);
    if (!$id || !$name || !$unit) jsonOut(['ok' => false, 'error' => 'Invalid data'], 400);
    if ($costPerUnit < 0) jsonOut(['ok' => false, 'error' => 'Cost cannot be negative'], 400);
    if ($quantity > 0 && $costPerUnit <= 0) jsonOut(['ok' => false, 'error' => 'Enter the cost per unit so stock value and recipe cost are correct'], 400);
    $old = $db->prepare('SELECT quantity FROM bar_ingredients WHERE id = ? LIMIT 1');
    $old->execute([$id]);
    $oldQty = (float)$old->fetchColumn();
    $db->prepare('UPDATE bar_ingredients SET name=?,quantity=?,unit=?,cost_per_unit=?,min_stock=? WHERE id=?')
       ->execute([$name, $quantity, $unit, $costPerUnit, $minStock, $id]);
    if (abs($quantity - $oldQty) > 0.0005) {
        $db->prepare('INSERT INTO bar_movements (item_name, ingredient_id, qty_change, type, reason, unit, unit_cost, total_cost, done_by) VALUES (?,?,?,?,?,?,?,?,?)')
           ->execute([$name, $id, $quantity - $oldQty, 'adjust', 'Quantity edited on the ingredient form', $unit, $costPerUnit, round(abs($quantity - $oldQty) * $costPerUnit, 2), $sess['full_name']]);
    }
    jsonOut(['ok' => true]);
}

// ── INGREDIENT DELETE ─────────────────────────────────────────
if ($action === 'ingredient_delete') {
    requirePerm('canManageItems');
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    if (!$id) jsonOut(['ok' => false, 'error' => 'id required'], 400);
    $db->prepare('DELETE FROM bar_ingredients WHERE id = ?')->execute([$id]);
    jsonOut(['ok' => true]);
}

// ── INGREDIENT RECEIVE STOCK ──────────────────────────────────
if ($action === 'ingredient_receive') {
    requirePerm('canEditStock');
    $body  = json_decode(file_get_contents('php://input'), true);
    $ingId = (int)($body['ingId'] ?? 0);
    $qty   = (float)($body['qty'] ?? 0);
    $note  = trim($body['note']   ?? 'Stock received');
    $unitCost     = (float)($body['unitCost'] ?? 0);
    $supplier     = trim($body['supplier'] ?? '');
    $reference    = trim($body['reference'] ?? '');
    $purchaseDate = trim($body['purchaseDate'] ?? date('Y-m-d'));
    if (!$ingId || $qty <= 0 || $unitCost <= 0) jsonOut(['ok' => false, 'error' => 'Ingredient, quantity, and purchase cost per unit are required'], 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $purchaseDate)
        || !checkdate((int)substr($purchaseDate, 5, 2), (int)substr($purchaseDate, 8, 2), (int)substr($purchaseDate, 0, 4))) {
        jsonOut(['ok' => false, 'error' => 'Enter a valid purchase date'], 400);
    }

    $db->beginTransaction();
    try {
        $nStmt = $db->prepare('SELECT name, unit, quantity, cost_per_unit FROM bar_ingredients WHERE id = ? LIMIT 1 FOR UPDATE');
        $nStmt->execute([$ingId]);
        $ing = $nStmt->fetch();
        if (!$ing) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Ingredient not found'], 404); }
        $oldQty      = max(0, (float)$ing['quantity']);
        $totalCost   = round($qty * $unitCost, 2);
        $newQty      = $oldQty + $qty;
        $newUnitCost = (($oldQty * (float)$ing['cost_per_unit']) + $totalCost) / $newQty;
        $db->prepare('UPDATE bar_ingredients SET quantity = ?, cost_per_unit = ? WHERE id = ?')->execute([$newQty, $newUnitCost, $ingId]);
        $db->prepare('INSERT INTO bar_movements (item_name, ingredient_id, qty_change, type, reason, unit, supplier, reference, unit_cost, total_cost, done_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
           ->execute([$ing['name'], $ingId, $qty, 'purchase', $note, $ing['unit'], $supplier ?: null, $reference ?: null, $unitCost, $totalCost, $sess['full_name']]);
        [$amountPaid, $payMethod] = purchasePayment($body, $totalCost, $supplier);
        $db->prepare('INSERT INTO inventory_purchases (inventory_type, inventory_id, item_name, quantity, unit, unit_cost, total_cost, amount_paid, payment_method, shift_id, supplier, reference, purchase_date, recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
           ->execute(['bar_ingredient', $ingId, $ing['name'], $qty, $ing['unit'], $unitCost, $totalCost, $amountPaid, $payMethod, currentShiftId(), $supplier ?: null, $reference ?: null, $purchaseDate, $sess['full_name']]);
        $db->commit();
        jsonOut(['ok' => true, 'newQuantity' => $newQty, 'unitCost' => $newUnitCost, 'stockValue' => round($newQty * $newUnitCost, 2), 'purchaseTotal' => $totalCost]);
    } catch (Exception $e) { $db->rollBack(); serverFail($e); }
}

// ── RECORD BREAKAGE ───────────────────────────────────────────
if ($action === 'record_breakage') {
    $body       = json_decode(file_get_contents('php://input'), true);
    $targetType = trim($body['targetType'] ?? '');
    $targetId   = (int)($body['targetId']  ?? 0);
    $qty        = (float)($body['qty']     ?? 0);
    $reason     = trim($body['reason']     ?? '');
    if (!$targetType || !$targetId || $qty <= 0 || !$reason) jsonOut(['ok' => false, 'error' => 'All fields required'], 400);

    $db->beginTransaction();
    try {
        if ($targetType === 'item') {
            $nStmt = $db->prepare('SELECT name, stock, cost_price FROM bar_items WHERE id = ? AND type = "direct" LIMIT 1');
            $nStmt->execute([$targetId]);
            $item = $nStmt->fetch();
            if (!$item) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Item not found'], 404); }
            if ($item['stock'] < $qty) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Not enough stock'], 400); }
            $db->prepare('UPDATE bar_items SET stock = stock - ? WHERE id = ?')->execute([$qty, $targetId]);
            $db->prepare('INSERT INTO bar_movements (item_name, item_id, qty_change, type, reason, unit, unit_cost, total_cost, done_by) VALUES (?,?,?,?,?,?,?,?,?)')
               ->execute([$item['name'], $targetId, -$qty, 'breakage', $reason, 'pcs', $item['cost_price'], round($qty * (float)$item['cost_price'], 2), $sess['full_name']]);
        } else {
            $nStmt = $db->prepare('SELECT name, unit, quantity, cost_per_unit FROM bar_ingredients WHERE id = ? LIMIT 1');
            $nStmt->execute([$targetId]);
            $ing = $nStmt->fetch();
            if (!$ing) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Ingredient not found'], 404); }
            if ($ing['quantity'] < $qty) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Not enough stock'], 400); }
            $db->prepare('UPDATE bar_ingredients SET quantity = quantity - ? WHERE id = ?')->execute([$qty, $targetId]);
            $db->prepare('INSERT INTO bar_movements (item_name, ingredient_id, qty_change, type, reason, unit, unit_cost, total_cost, done_by) VALUES (?,?,?,?,?,?,?,?,?)')
               ->execute([$ing['name'], $targetId, -$qty, 'breakage', $reason, $ing['unit'], $ing['cost_per_unit'], round($qty * (float)$ing['cost_per_unit'], 2), $sess['full_name']]);
        }
        $db->commit();
        jsonOut(['ok' => true]);
    } catch (Exception $e) { $db->rollBack(); serverFail($e); }
}

// ── MOVEMENTS LIST ────────────────────────────────────────────
if ($action === 'movements_list') {
    $filter = $_GET['filter'] ?? 'today';
    $date   = $_GET['date']   ?? '';
    switch ($filter) {
        case 'week':  $where = "WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)"; break;
        case 'month': $where = "WHERE created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')"; break;
        case 'date':  $day = preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ? $db->quote($date) : 'CURDATE()'; $where = "WHERE created_at >= $day AND created_at < DATE_ADD($day, INTERVAL 1 DAY)"; break;
        default:      $where = "WHERE created_at >= CURDATE() AND created_at < CURDATE() + INTERVAL 1 DAY"; break;
    }
    $stmt = $db->query("SELECT * FROM bar_movements $where ORDER BY id DESC");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']         = (int)$r['id'];
        $r['qty_change'] = (float)$r['qty_change'];
        $r['date']       = date('d M Y H:i', strtotime($r['created_at']));
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

// ── RECIPES LIST (for items modal) ────────────────────────────
if ($action === 'recipes_list') {
    $stmt = $db->query('SELECT id, name FROM bar_recipes ORDER BY name ASC');
    jsonOut(['ok' => true, 'data' => $stmt->fetchAll()]);
}

// ── CHECK STOCK (used by order-management) ────────────────────
if ($action === 'check_stock') {
    $itemId = (int)($_GET['itemId'] ?? 0);
    $qty    = (float)($_GET['qty']  ?? 1);
    if (!$itemId) jsonOut(['ok' => false, 'error' => 'itemId required'], 400);
    $stmt = $db->prepare('SELECT name, type, stock FROM bar_items WHERE id = ? AND active = 1 LIMIT 1');
    $stmt->execute([$itemId]);
    $item = $stmt->fetch();
    if (!$item) jsonOut(['ok' => false, 'error' => 'Item not found'], 404);
    if ($item['type'] === 'direct') {
        if ($item['stock'] <= 0) jsonOut(['ok' => false, 'error' => "{$item['name']} is out of stock", 'outOfStock' => true]);
        if ($item['stock'] < $qty) jsonOut(['ok' => false, 'error' => "Only {$item['stock']} {$item['name']} left in stock", 'lowStock' => true]);
    }
    jsonOut(['ok' => true, 'stock' => (float)$item['stock']]);
}

// ── PROCESS SALE (called when order is validated for bar items) ─
if ($action === 'process_sale') {
    $body    = json_decode(file_get_contents('php://input'), true);
    $items   = $body['items']       ?? [];
    $orderId = (int)($body['orderId'] ?? 0);
    $orderNo = trim($body['orderNumber'] ?? '');
    if (!$items) jsonOut(['ok' => false, 'error' => 'No items'], 400);

    $db->beginTransaction();
    try {
        foreach ($items as $saleItem) {
            $itemId  = (int)$saleItem['barItemId'];
            $qty     = (float)$saleItem['qty'];

            $iStmt = $db->prepare('SELECT * FROM bar_items WHERE id = ? AND active = 1 LIMIT 1');
            $iStmt->execute([$itemId]);
            $item = $iStmt->fetch();
            if (!$item) continue;

            if ($item['type'] === 'direct') {
                // Deduct directly from item stock
                $db->prepare('UPDATE bar_items SET stock = stock - ? WHERE id = ?')->execute([$qty, $itemId]);
                $db->prepare('INSERT INTO bar_movements (item_name, item_id, qty_change, type, reason, unit, order_number, unit_cost, total_cost, done_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
                   ->execute([$item['name'], $itemId, -$qty, 'sale', "Order $orderNo", 'pcs', $orderNo, $item['cost_price'], round($qty * (float)$item['cost_price'], 2), $sess['full_name']]);
            } elseif ($item['type'] === 'recipe' && $item['recipe_id']) {
                // Deduct ingredients via recipe
                $riStmt = $db->prepare('SELECT bri.*, bi.name AS ing_name, bi.unit, bi.cost_per_unit FROM bar_recipe_ingredients bri JOIN bar_ingredients bi ON bi.id = bri.ingredient_id WHERE bri.recipe_id = ?');
                $riStmt->execute([$item['recipe_id']]);
                $recipeIngs = $riStmt->fetchAll();
                foreach ($recipeIngs as $ri) {
                    $totalQty = $ri['qty'] * $qty;
                    $db->prepare('UPDATE bar_ingredients SET quantity = quantity - ? WHERE id = ?')->execute([$totalQty, $ri['ingredient_id']]);
                    $db->prepare('INSERT INTO bar_movements (item_name, ingredient_id, qty_change, type, reason, unit, order_number, unit_cost, total_cost, done_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
                       ->execute([$ri['ing_name'], $ri['ingredient_id'], -$totalQty, 'sale', "Recipe: {$item['name']} × $qty via Order $orderNo", $ri['unit'], $orderNo, $ri['cost_per_unit'], round($totalQty * (float)$ri['cost_per_unit'], 2), $sess['full_name']]);
                }
            }
        }
        $db->commit();
        jsonOut(['ok' => true]);
    } catch (Exception $e) { $db->rollBack(); serverFail($e); }
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
