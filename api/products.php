<?php
// ============================================================
//  api/products.php
//  GET    action=list              → all products
//  POST   action=save              → add/update product
//  POST   action=deactivate        → soft-delete product
//  POST   action=request_price_change → manager price change request
// ============================================================
require_once __DIR__ . '/../config/db.php';
if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();

$action = $_REQUEST['action'] ?? 'list';
$db     = getDB();

// ── LIST ──────────────────────────────────────────────────────
if ($action === 'list') {
    requireAuth();
    $stmt = $db->query('SELECT * FROM products ORDER BY active DESC, name ASC');
    $rows = $stmt->fetchAll();
    // Normalise types for JS
    foreach ($rows as &$r) {
        $r['id']          = (int)$r['id'];
        $r['sell_price']  = (float)$r['sell_price'];
        $r['cost_price']  = (float)$r['cost_price'];
        $r['stock']       = (int)$r['stock'];
        $r['alert_level'] = (int)$r['alert_level'];
        $r['active']      = (bool)$r['active'];
        // JS-compatible aliases
        $r['sellPrice']   = $r['sell_price'];
        $r['costPrice']   = $r['cost_price'];
        $r['alert']       = $r['alert_level'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

// ── SAVE (add or update) ──────────────────────────────────────
if ($action === 'save') {
    requirePerm('canManageItems');
    $body = json_decode(file_get_contents('php://input'), true);

    $id        = (int)($body['id'] ?? 0);
    $name      = trim($body['name'] ?? '');
    $category  = trim($body['category'] ?? 'General');
    $unit      = trim($body['unit'] ?? 'Unit');
    $sellPrice = (float)($body['sellPrice'] ?? 0);
    $costPrice = (float)($body['costPrice'] ?? 0);
    $stock     = (int)($body['stock'] ?? 0);
    $alert     = (int)($body['alert'] ?? 5);

    if (!$name) jsonOut(['ok' => false, 'error' => 'Product name required'], 400);

    if ($id > 0) {
        // Get old prices before updating
        $oldStmt = $db->prepare('SELECT sell_price, cost_price, name FROM products WHERE id = ?');
        $oldStmt->execute([$id]);
        $oldProduct = $oldStmt->fetch();
        $sess = $_SESSION;

        $db->prepare('UPDATE products SET name=?, category=?, unit=?, sell_price=?, cost_price=?, stock=?, alert_level=? WHERE id=?')
           ->execute([$name, $category, $unit, $sellPrice, $costPrice, $stock, $alert, $id]);

        // Log sell price change if changed
        if ($oldProduct && abs((float)$oldProduct['sell_price'] - $sellPrice) > 0.01) {
            $reason = trim($body['priceReason'] ?? 'Price updated by owner');
            $db->prepare('INSERT INTO price_change_log (product_id, product_name, field, old_price, new_price, reason, changed_by) VALUES (?,?,?,?,?,?,?)')
               ->execute([$id, $name, 'sell_price', (float)$oldProduct['sell_price'], $sellPrice, $reason, $sess['full_name']]);
        }
        // Log cost price change if changed
        if ($oldProduct && abs((float)$oldProduct['cost_price'] - $costPrice) > 0.01) {
            $reason = trim($body['priceReason'] ?? 'Cost price updated by owner');
            $db->prepare('INSERT INTO price_change_log (product_id, product_name, field, old_price, new_price, reason, changed_by) VALUES (?,?,?,?,?,?,?)')
               ->execute([$id, $name, 'cost_price', (float)$oldProduct['cost_price'], $costPrice, $reason, $sess['full_name']]);
        }

        $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
           ->execute(['PRODUCT', "Updated product: $name", $sess['full_name']]);
    } else {
        $db->prepare('INSERT INTO products (name, category, unit, sell_price, cost_price, stock, alert_level) VALUES (?,?,?,?,?,?,?)')
           ->execute([$name, $category, $unit, $sellPrice, $costPrice, $stock, $alert]);
        $id = (int)$db->lastInsertId();
        $sess = $_SESSION;
        $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
           ->execute(['PRODUCT', "Added product: $name at $sellPrice", $sess['full_name']]);
    }

    jsonOut(['ok' => true, 'id' => $id]);
}

// ── DEACTIVATE ────────────────────────────────────────────────
if ($action === 'deactivate') {
    requirePerm('canManageItems');
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    if (!$id) jsonOut(['ok' => false, 'error' => 'Invalid id'], 400);
    $db->prepare('UPDATE products SET active = 0 WHERE id = ?')->execute([$id]);
    jsonOut(['ok' => true]);
}

// ── UPDATE PRICE (Manager with reason, Owner free) ────────────
if ($action === 'update_price') {
    requirePerm('canManageItems');
    $body     = json_decode(file_get_contents('php://input'), true);
    $id       = (int)($body['id']       ?? 0);
    $price    = (float)($body['price']  ?? 0);
    $field    = in_array($body['field'] ?? '', ['sell_price','cost_price']) ? $body['field'] : 'sell_price';
    $reason   = trim($body['reason']    ?? '');
    $sess     = $_SESSION;

    if ($id <= 0 || $price < 0) jsonOut(['ok' => false, 'error' => 'Invalid data'], 400);
    // Manager MUST provide reason
    if ($sess['role'] === 'Manager' && !$reason) {
        jsonOut(['ok' => false, 'error' => 'Reason is required for price changes'], 400);
    }

    // Get old price
    $oldStmt = $db->prepare('SELECT sell_price, cost_price, name FROM products WHERE id = ?');
    $oldStmt->execute([$id]);
    $old = $oldStmt->fetch();
    if (!$old) jsonOut(['ok' => false, 'error' => 'Product not found'], 404);

    $oldPrice = $field === 'sell_price' ? (float)$old['sell_price'] : (float)$old['cost_price'];
    $reasonText = $reason ?: ($sess['role'] === 'Owner' ? 'Updated by owner' : 'Price change');

    $db->prepare("UPDATE products SET $field = ? WHERE id = ?")->execute([$price, $id]);

    // Log to price_change_log
    $db->prepare('INSERT INTO price_change_log (product_id, product_name, field, old_price, new_price, reason, changed_by) VALUES (?,?,?,?,?,?,?)')
       ->execute([$id, $old['name'], $field, $oldPrice, $price, $reasonText, $sess['full_name']]);

    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['PRODUCT', "$field updated for {$old['name']}: {$oldPrice} → {$price}. Reason: {$reasonText}", $sess['full_name']]);

    jsonOut(['ok' => true]);
}

// ── PRICE CHANGE HISTORY ──────────────────────────────────────
if ($action === 'price_history') {
    requireRole(['Owner', 'Manager']);
    $productId = (int)($_GET['productId'] ?? 0);
    if ($productId) {
        $stmt = $db->prepare('SELECT * FROM price_change_log WHERE product_id = ? ORDER BY created_at DESC LIMIT 50');
        $stmt->execute([$productId]);
    } else {
        $stmt = $db->query('SELECT * FROM price_change_log ORDER BY created_at DESC LIMIT 100');
    }
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['old_price'] = (float)$r['old_price'];
        $r['new_price'] = (float)$r['new_price'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
