<?php
// ============================================================
//  api/kitchen2.php — New Kitchen Module
//  Menu, Recipes, Ingredients Inventory, Dashboard Stats
// ============================================================
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/purchase_lib.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();
$action = $_REQUEST['action'] ?? '';
$sess   = requireAuth();
$db     = getDB();

// ── DASHBOARD: SALES STATS ────────────────────────────────────
if ($action === 'sales_stats') {
    $today = date('Y-m-d');
    $week  = date('Y-m-d', strtotime('-7 days'));
    $month = date('Y-m');

    // Sales from validated orders (kitchen items)
    $stmt = $db->prepare("
        SELECT
          SUM(CASE WHEN sale_date = ? THEN total ELSE 0 END) AS today_sales,
          SUM(CASE WHEN sale_date >= ? THEN total ELSE 0 END) AS week_sales,
          SUM(CASE WHEN sale_date >= ? THEN total ELSE 0 END) AS month_sales,
          SUM(CASE WHEN sale_date = ? THEN total ELSE 0 END) AS today_cost
        FROM kitchen_sales
        WHERE sale_date >= ?
    ");
    $monthStart = date('Y-m-01');
    $stmt->execute([$today, $week, $monthStart, $today, min($week, $monthStart)]);
    $stats = $stmt->fetch();

    // Cost = ingredients cost (today)
    $costStmt = $db->prepare("SELECT SUM(cost) AS total FROM kitchen_deductions WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)");
    $costStmt->execute([$today, $today]);
    $costRow = $costStmt->fetch();

    // Top selling foods today
    $topStmt = $db->prepare("
        SELECT product_name AS name, SUM(qty) AS qty
        FROM kitchen_sales
        WHERE sale_date = ?
        GROUP BY product_name
        ORDER BY qty DESC
        LIMIT 5
    ");
    $topStmt->execute([$today]);
    $topFoods = $topStmt->fetchAll();

    jsonOut([
        'ok' => true,
        'data' => [
            'todaySales'  => (float)($stats['today_sales']  ?? 0),
            'weekSales'   => (float)($stats['week_sales']   ?? 0),
            'monthSales'  => (float)($stats['month_sales']  ?? 0),
            'todayCost'   => (float)($costRow['total']      ?? 0),
            'topFoods'    => $topFoods,
        ]
    ]);
}

// ── DASHBOARD: EXPENSES TODAY ─────────────────────────────────
if ($action === 'expenses_today') {
    $today = date('Y-m-d');
    $stmt  = $db->prepare("
        SELECT
          SUM(CASE WHEN type='purchase'   THEN amount ELSE 0 END) AS purchases,
          SUM(CASE WHEN type='waste'      THEN amount ELSE 0 END) AS waste,
          SUM(CASE WHEN type='adjustment' THEN amount ELSE 0 END) AS adjustments
        FROM kitchen_stock_movements
        WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) AND amount > 0
    ");
    $stmt->execute([$today, $today]);
    $row = $stmt->fetch();
    jsonOut(['ok' => true, 'data' => [
        'purchases'   => (float)($row['purchases']   ?? 0),
        'waste'       => (float)($row['waste']       ?? 0),
        'adjustments' => (float)($row['adjustments'] ?? 0),
    ]]);
}

// ── MENU ──────────────────────────────────────────────────────
if ($action === 'menu_list') {
    $stmt = $db->query("
        SELECT km.*, kr.name AS recipe_name
        FROM kitchen_menu km
        LEFT JOIN kitchen_recipes kr ON kr.id = km.recipe_id
        ORDER BY km.id DESC
    ");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['price'] = (float)$r['price']; }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

if ($action === 'menu_get') {
    $id   = (int)($_GET['id'] ?? 0);
    $stmt = $db->prepare('SELECT * FROM kitchen_menu WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $row  = $stmt->fetch();
    if (!$row) jsonOut(['ok' => false, 'error' => 'Not found'], 404);
    $row['id'] = (int)$row['id']; $row['price'] = (float)$row['price'];
    jsonOut(['ok' => true, 'data' => $row]);
}

if ($action === 'menu_add') {
    requirePerm('canManageItems');
    $body = json_decode(file_get_contents('php://input'), true);
    $name      = trim($body['name']        ?? '');
    $category  = trim($body['category']    ?? '');
    $price     = (float)($body['price']    ?? 0);
    $desc      = trim($body['description'] ?? '');
    $recipeId  = (int)($body['recipeId']   ?? 0);
    $status    = trim($body['status']      ?? 'active');
    if (!$name || $price <= 0) jsonOut(['ok' => false, 'error' => 'Name and price required'], 400);
    $db->prepare('INSERT INTO kitchen_menu (name, category, price, description, recipe_id, status) VALUES (?,?,?,?,?,?)')
       ->execute([$name, $category, $price, $desc, $recipeId ?: null, $status]);
    $menuId = (int)$db->lastInsertId();
    $db->prepare('UPDATE kitchen_menu SET product_type=? WHERE id=?')->execute([cleanProductType($body['productType'] ?? ''), $menuId]);
    // Sync: update kitchen_recipes.menu_item_id to point back to this menu item
    if ($recipeId) {
        $db->prepare('UPDATE kitchen_recipes SET menu_item_id = ? WHERE id = ?')->execute([$menuId, $recipeId]);
    }
    jsonOut(['ok' => true, 'id' => $menuId]);
}

if ($action === 'menu_update') {
    requirePerm('canManageItems');
    $body = json_decode(file_get_contents('php://input'), true);
    $id        = (int)($body['id']         ?? 0);
    $name      = trim($body['name']        ?? '');
    $category  = trim($body['category']    ?? '');
    $price     = (float)($body['price']    ?? 0);
    $desc      = trim($body['description'] ?? '');
    $recipeId  = (int)($body['recipeId']   ?? 0);
    $status    = trim($body['status']      ?? 'active');
    if (!$id || !$name || $price <= 0) jsonOut(['ok' => false, 'error' => 'Invalid data'], 400);
    // Clear old recipe link first (if recipe was previously linked to this menu item)
    $db->prepare('UPDATE kitchen_recipes SET menu_item_id = NULL WHERE menu_item_id = ?')->execute([$id]);
    $db->prepare('UPDATE kitchen_menu SET name=?,category=?,price=?,description=?,recipe_id=?,status=? WHERE id=?')
       ->execute([$name, $category, $price, $desc, $recipeId ?: null, $status, $id]);
    if (array_key_exists('productType', $body)) $db->prepare('UPDATE kitchen_menu SET product_type=? WHERE id=?')->execute([cleanProductType($body['productType']), $id]);
    // Sync: update kitchen_recipes.menu_item_id to point back to this menu item
    if ($recipeId) {
        $db->prepare('UPDATE kitchen_recipes SET menu_item_id = ? WHERE id = ?')->execute([$id, $recipeId]);
    }
    jsonOut(['ok' => true]);
}

if ($action === 'menu_delete') {
    requirePerm('canManageItems');
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    if (!$id) jsonOut(['ok' => false, 'error' => 'id required'], 400);
    $db->prepare('DELETE FROM kitchen_menu WHERE id = ?')->execute([$id]);
    jsonOut(['ok' => true]);
}

// ── RECIPES ───────────────────────────────────────────────────
if ($action === 'recipes_list') {
    $stmt = $db->query("
        SELECT kr.*, km.name AS menu_item_name, km.price AS selling_price,
               COALESCE((
                 SELECT SUM(ri.qty * ki.cost_per_unit)
                 FROM recipe_ingredients ri
                 JOIN kitchen_ingredients ki ON ki.id = ri.ingredient_id
                 WHERE ri.recipe_id = kr.id
               ),0) AS total_cost
        FROM kitchen_recipes kr
        LEFT JOIN kitchen_menu km ON km.id = kr.menu_item_id
        ORDER BY kr.id DESC
    ");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']           = (int)$r['id'];
        $r['total_cost']   = (float)$r['total_cost'];
        $r['selling_price']= (float)($r['selling_price'] ?? 0);
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

if ($action === 'recipe_get') {
    $id   = (int)($_GET['id'] ?? 0);
    $stmt = $db->prepare('SELECT kr.*, km.name AS menu_item_name, km.price AS selling_price FROM kitchen_recipes kr LEFT JOIN kitchen_menu km ON km.id = kr.menu_item_id WHERE kr.id = ? LIMIT 1');
    $stmt->execute([$id]);
    $recipe = $stmt->fetch();
    if (!$recipe) jsonOut(['ok' => false, 'error' => 'Not found'], 404);
    $iStmt = $db->prepare('SELECT ri.*, ki.name AS ingredient_name, ki.unit, ki.cost_per_unit FROM recipe_ingredients ri JOIN kitchen_ingredients ki ON ki.id = ri.ingredient_id WHERE ri.recipe_id = ?');
    $iStmt->execute([$id]);
    $recipe['ingredients']   = $iStmt->fetchAll();
    $recipe['selling_price'] = (float)($recipe['selling_price'] ?? 0);
    jsonOut(['ok' => true, 'data' => $recipe]);
}

if ($action === 'recipe_costing') {
    require_once __DIR__ . '/recipe_costing.php';
    $id   = (int)($_GET['id'] ?? 0);
    $stmt = $db->prepare('SELECT kr.*, km.name AS menu_item_name, km.price AS selling_price FROM kitchen_recipes kr LEFT JOIN kitchen_menu km ON km.id = kr.menu_item_id WHERE kr.id = ? LIMIT 1');
    $stmt->execute([$id]);
    $recipe = $stmt->fetch();
    if (!$recipe) jsonOut(['ok' => false, 'error' => 'Recipe not found'], 404);
    $iStmt = $db->prepare('SELECT ri.ingredient_id, ri.qty, ki.name AS ingredient_name, ki.unit, ki.cost_per_unit FROM recipe_ingredients ri JOIN kitchen_ingredients ki ON ki.id = ri.ingredient_id WHERE ri.recipe_id = ? ORDER BY ki.name');
    $iStmt->execute([$id]);
    $sales = $recipe['menu_item_id'] ? recipeSalesStats($db, 'kitchen_sales', (int)$recipe['menu_item_id']) : [];
    $costing = buildRecipeCosting($db, $iStmt->fetchAll(), 'kitchen_ingredient', (float)($recipe['selling_price'] ?? 0), $sales);
    jsonOut(['ok' => true, 'data' => ['id' => (int)$recipe['id'], 'name' => $recipe['name'], 'itemName' => $recipe['menu_item_name']] + $costing]);
}

if ($action === 'recipe_add') {
    requirePerm('canManageItems');
    $body        = json_decode(file_get_contents('php://input'), true);
    $name        = trim($body['name']       ?? '');
    $menuItemId  = (int)($body['menuItemId'] ?? 0);
    $ingredients = $body['ingredients']      ?? [];
    if (!$name || !$ingredients) jsonOut(['ok' => false, 'error' => 'Name and ingredients required'], 400);
    $db->prepare('INSERT INTO kitchen_recipes (name, menu_item_id) VALUES (?,?)')
       ->execute([$name, $menuItemId ?: null]);
    $recipeId = (int)$db->lastInsertId();
    foreach ($ingredients as $ing) {
        $db->prepare('INSERT INTO recipe_ingredients (recipe_id, ingredient_id, qty) VALUES (?,?,?)')
           ->execute([$recipeId, (int)$ing['ingId'], (float)$ing['qty']]);
    }
    // Link recipe to menu item
    if ($menuItemId) {
        $db->prepare('UPDATE kitchen_menu SET recipe_id = ? WHERE id = ?')->execute([$recipeId, $menuItemId]);
    }
    jsonOut(['ok' => true, 'id' => $recipeId]);
}

if ($action === 'recipe_update') {
    requirePerm('canManageItems');
    $body        = json_decode(file_get_contents('php://input'), true);
    $id          = (int)($body['id']         ?? 0);
    $name        = trim($body['name']        ?? '');
    $menuItemId  = (int)($body['menuItemId'] ?? 0);
    $ingredients = $body['ingredients']       ?? [];
    if (!$id || !$name || !$ingredients) jsonOut(['ok' => false, 'error' => 'id, name and ingredients required'], 400);

    $db->beginTransaction();
    try {
        // Clear old menu_item link
        $db->prepare('UPDATE kitchen_recipes SET menu_item_id = NULL WHERE menu_item_id = ? AND id != ?')->execute([$menuItemId, $id]);
        // Update recipe
        $db->prepare('UPDATE kitchen_recipes SET name = ?, menu_item_id = ? WHERE id = ?')
           ->execute([$name, $menuItemId ?: null, $id]);
        // Replace ingredients
        $db->prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?')->execute([$id]);
        foreach ($ingredients as $ing) {
            $db->prepare('INSERT INTO recipe_ingredients (recipe_id, ingredient_id, qty) VALUES (?,?,?)')
               ->execute([$id, (int)$ing['ingId'], (float)$ing['qty']]);
        }
        // Sync menu item
        if ($menuItemId) {
            $db->prepare('UPDATE kitchen_menu SET recipe_id = ? WHERE id = ?')->execute([$id, $menuItemId]);
        }
        $db->commit();
        jsonOut(['ok' => true]);
    } catch (Exception $e) {
        $db->rollBack();
        serverFail($e);
    }
}

if ($action === 'recipe_delete') {
    requirePerm('canManageItems');
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    if (!$id) jsonOut(['ok' => false, 'error' => 'id required'], 400);
    $db->prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?')->execute([$id]);
    $db->prepare('DELETE FROM kitchen_recipes WHERE id = ?')->execute([$id]);
    jsonOut(['ok' => true]);
}

// ── INGREDIENTS ───────────────────────────────────────────────
if ($action === 'ingredients_list') {
    $stmt = $db->query('SELECT * FROM kitchen_ingredients ORDER BY name ASC');
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']           = (int)$r['id'];
        $r['quantity']     = (float)$r['quantity'];
        $r['cost_per_unit']= (float)$r['cost_per_unit'];
        $r['min_stock']    = (float)$r['min_stock'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

if ($action === 'ingredient_get') {
    $id   = (int)($_GET['id'] ?? 0);
    $stmt = $db->prepare('SELECT * FROM kitchen_ingredients WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $row  = $stmt->fetch();
    if (!$row) jsonOut(['ok' => false, 'error' => 'Not found'], 404);
    jsonOut(['ok' => true, 'data' => $row]);
}

if ($action === 'ingredient_add') {
    requirePerm('canManageItems');
    $body        = json_decode(file_get_contents('php://input'), true);
    $name        = trim($body['name']         ?? '');
    $quantity    = (float)($body['quantity']  ?? 0);
    $unit        = trim($body['unit']         ?? '');
    $costPerUnit = (float)($body['costPerUnit']?? 0);
    $minStock    = (float)($body['minStock']  ?? 5);
    if (!$name || !$unit) jsonOut(['ok' => false, 'error' => 'Name and unit required'], 400);
    $db->prepare('INSERT INTO kitchen_ingredients (name, quantity, unit, cost_per_unit, min_stock) VALUES (?,?,?,?,?)')
       ->execute([$name, $quantity, $unit, $costPerUnit, $minStock]);
    $newId = (int)$db->lastInsertId();
    if ($quantity > 0) {
        $db->prepare('INSERT INTO kitchen_stock_movements (ingredient_id, qty, type, reason, amount, unit_cost, total_cost, done_by) VALUES (?,?,?,?,?,?,?,?)')
           ->execute([$newId, $quantity, 'adjust', 'Opening stock', round($quantity * $costPerUnit, 2), $costPerUnit, round($quantity * $costPerUnit, 2), $sess['full_name']]);
    }
    jsonOut(['ok' => true, 'id' => $newId]);
}

if ($action === 'ingredient_update') {
    requirePerm('canManageItems');
    $body        = json_decode(file_get_contents('php://input'), true);
    $id          = (int)($body['id']          ?? 0);
    $name        = trim($body['name']         ?? '');
    $quantity    = (float)($body['quantity']  ?? 0);
    $unit        = trim($body['unit']         ?? '');
    $costPerUnit = (float)($body['costPerUnit']?? 0);
    $minStock    = (float)($body['minStock']  ?? 5);
    if (!$id || !$name || !$unit) jsonOut(['ok' => false, 'error' => 'Invalid data'], 400);
    $old = $db->prepare('SELECT quantity FROM kitchen_ingredients WHERE id = ? LIMIT 1');
    $old->execute([$id]);
    $oldQty = (float)$old->fetchColumn();
    $db->prepare('UPDATE kitchen_ingredients SET name=?,quantity=?,unit=?,cost_per_unit=?,min_stock=? WHERE id=?')
       ->execute([$name, $quantity, $unit, $costPerUnit, $minStock, $id]);
    if (abs($quantity - $oldQty) > 0.0005) {
        $db->prepare('INSERT INTO kitchen_stock_movements (ingredient_id, qty, type, reason, amount, unit_cost, total_cost, done_by) VALUES (?,?,?,?,?,?,?,?)')
           ->execute([$id, $quantity - $oldQty, 'adjust', 'Quantity edited on the ingredient form', round(abs($quantity - $oldQty) * $costPerUnit, 2), $costPerUnit, round(abs($quantity - $oldQty) * $costPerUnit, 2), $sess['full_name']]);
    }
    jsonOut(['ok' => true]);
}

if ($action === 'ingredient_delete') {
    requirePerm('canManageItems');
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    if (!$id) jsonOut(['ok' => false, 'error' => 'id required'], 400);
    $db->prepare('DELETE FROM kitchen_ingredients WHERE id = ?')->execute([$id]);
    jsonOut(['ok' => true]);
}

if ($action === 'stock_receive') {
    requirePerm('canEditStock');
    $body = json_decode(file_get_contents('php://input'), true);
    $ingId = (int)($body['ingId'] ?? 0);
    $qty = (float)($body['qty'] ?? 0);
    $unitCost = (float)($body['unitCost'] ?? 0);
    $note = trim($body['note'] ?? 'Stock received');
    $supplier = trim($body['supplier'] ?? '');
    $reference = trim($body['reference'] ?? '');
    $purchaseDate = trim($body['purchaseDate'] ?? date('Y-m-d'));
    if (!$ingId || $qty <= 0 || $unitCost <= 0) {
        jsonOut(['ok' => false, 'error' => 'Ingredient, quantity, and purchase cost per unit are required'], 400);
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $purchaseDate)
        || !checkdate((int)substr($purchaseDate, 5, 2), (int)substr($purchaseDate, 8, 2), (int)substr($purchaseDate, 0, 4))) {
        jsonOut(['ok' => false, 'error' => 'Enter a valid purchase date'], 400);
    }

    $db->beginTransaction();
    try {
        $pStmt = $db->prepare('SELECT name, unit, quantity, cost_per_unit FROM kitchen_ingredients WHERE id = ? LIMIT 1');
        $pStmt->execute([$ingId]);
        $ing = $pStmt->fetch();
        if (!$ing) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Ingredient not found'], 404); }
        $oldQuantity = (float)$ing['quantity'];
        $totalCost = round($unitCost * $qty, 2);
        $newQuantity = $oldQuantity + $qty;
        $newUnitCost = (($oldQuantity * (float)$ing['cost_per_unit']) + $totalCost) / $newQuantity;

        $db->prepare('UPDATE kitchen_ingredients SET quantity = ?, cost_per_unit = ? WHERE id = ?')->execute([$newQuantity, $newUnitCost, $ingId]);
        $db->prepare('INSERT INTO kitchen_stock_movements (ingredient_id, qty, type, reason, amount, unit_cost, total_cost, supplier, reference, purchase_date, done_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
           ->execute([$ingId, $qty, 'purchase', $note, $totalCost, $unitCost, $totalCost, $supplier ?: null, $reference ?: null, $purchaseDate, $sess['full_name']]);
        [$amountPaid, $payMethod] = purchasePayment($body, $totalCost, $supplier);
        $db->prepare('INSERT INTO inventory_purchases (inventory_type, inventory_id, item_name, quantity, unit, unit_cost, total_cost, amount_paid, payment_method, shift_id, supplier, reference, purchase_date, recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
           ->execute(['kitchen_ingredient', $ingId, $ing['name'], $qty, $ing['unit'], $unitCost, $totalCost, $amountPaid, $payMethod, currentShiftId(), $supplier ?: null, $reference ?: null, $purchaseDate, $sess['full_name']]);
        $db->commit();
        jsonOut(['ok' => true, 'newQuantity' => $newQuantity, 'unitCost' => $newUnitCost, 'stockValue' => round($newQuantity * $newUnitCost, 2), 'purchaseTotal' => $totalCost]);
    } catch (Exception $e) { $db->rollBack(); serverFail($e); }
}

if ($action === 'stock_adjust') {
    requirePerm('canEditStock');
    $body   = json_decode(file_get_contents('php://input'), true);
    $ingId  = (int)($body['ingId']  ?? 0);
    $qty    = (float)($body['qty']  ?? 0); // negative for deduction
    $type   = trim($body['type']    ?? 'waste');
    $reason = trim($body['reason']  ?? '');
    if (!$ingId || !$qty || !$reason) jsonOut(['ok' => false, 'error' => 'All fields required'], 400);

    $db->beginTransaction();
    try {
        $pStmt = $db->prepare('SELECT cost_per_unit, quantity FROM kitchen_ingredients WHERE id = ? LIMIT 1');
        $pStmt->execute([$ingId]);
        $ing = $pStmt->fetch();
        if ((float)$ing['quantity'] + $qty < 0) {
            $db->rollBack();
            jsonOut(['ok' => false, 'error' => 'Insufficient stock for this deduction'], 400);
        }
        $cost = abs($qty) * (float)($ing['cost_per_unit'] ?? 0);
        $db->prepare('UPDATE kitchen_ingredients SET quantity = quantity + ? WHERE id = ?')->execute([$qty, $ingId]);
        $db->prepare('INSERT INTO kitchen_stock_movements (ingredient_id, qty, type, reason, amount, unit_cost, total_cost, done_by) VALUES (?,?,?,?,?,?,?,?)')
           ->execute([$ingId, $qty, $type, $reason, $cost, $ing['cost_per_unit'] ?? 0, $cost, $sess['full_name']]);
        $db->commit();
        jsonOut(['ok' => true]);
    } catch (Exception $e) { $db->rollBack(); serverFail($e); }
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
