<?php
// ============================================================
//  api/stock.php — Stock movements
//  GET  action=list
//  POST action=record { productId, type, qty, cost, note }
// ============================================================
require_once __DIR__ . '/../config/db.php';

// Task 11: Validate CSRF token on all POST requests
if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();


$action = $_REQUEST['action'] ?? 'list';
$db     = getDB();

if ($action === 'list') {
    requireAuth();
    $stmt = $db->query('SELECT * FROM stock_movements ORDER BY id DESC LIMIT 500');
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['product_id'] = (int)$r['product_id'];
        $r['qty'] = (int)$r['qty'];
        $r['productId'] = $r['product_id'];
        $r['productName'] = $r['product_name'];
        $r['date'] = $r['move_date'];
        $r['by'] = $r['moved_by'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

if ($action === 'record') {
    requirePerm('canEditStock');
    $sess = $_SESSION;
    $body = json_decode(file_get_contents('php://input'), true);

    $productId   = (int)($body['productId']    ?? 0);
    $type        = $body['type']              ?? 'IN';
    $qty         = (int)($body['qty']         ?? 0);
    $cost        = (float)($body['cost']      ?? 0);
    $note        = trim($body['note']         ?? $type);
    $supplier    = trim($body['supplier']     ?? '');
    $reference   = trim($body['reference']   ?? '');
    $costPerUnit = (float)($body['costPerUnit'] ?? $cost);
    $purchaseDate = trim($body['purchaseDate'] ?? date('Y-m-d'));

    if (!$productId || $qty < 1 || !in_array($type, ['IN', 'OUT'], true)) {
        jsonOut(['ok' => false, 'error' => 'Invalid product, movement type, or quantity'], 400);
    }
    if ($type === 'IN' && $costPerUnit <= 0) {
        jsonOut(['ok' => false, 'error' => 'Enter the purchase cost per unit'], 400);
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $purchaseDate)
        || !checkdate((int)substr($purchaseDate, 5, 2), (int)substr($purchaseDate, 8, 2), (int)substr($purchaseDate, 0, 4))) {
        jsonOut(['ok' => false, 'error' => 'Enter a valid purchase date'], 400);
    }

    $stmt = $db->prepare('SELECT * FROM products WHERE id = ?');
    $stmt->execute([$productId]);
    $product = $stmt->fetch();
    if (!$product) jsonOut(['ok' => false, 'error' => 'Product not found'], 404);

    if ($type === 'OUT' && $product['stock'] < $qty) {
        jsonOut(['ok' => false, 'error' => "Only {$product['stock']} in stock"], 400);
    }

    $oldStock = (float)$product['stock'];
    $oldUnitCost = (float)$product['cost_price'];
    $movementUnitCost = $type === 'IN' ? $costPerUnit : $oldUnitCost;
    $totalCost = round($qty * $movementUnitCost, 2);
    $newStock = $oldStock + ($type === 'IN' ? $qty : -$qty);
    $newUnitCost = $type === 'IN' && $newStock > 0
        ? (($oldStock * $oldUnitCost) + ($qty * $costPerUnit)) / $newStock
        : $oldUnitCost;

    $db->beginTransaction();
    try {
        if ($type === 'IN') {
            $db->prepare('UPDATE products SET stock = ?, cost_price = ? WHERE id = ?')
               ->execute([$newStock, $newUnitCost, $productId]);
        } else {
            $db->prepare('UPDATE products SET stock = stock - ? WHERE id = ?')->execute([$qty, $productId]);
        }

        $db->prepare('INSERT INTO stock_movements (product_id, product_name, type, qty, cost, note, supplier, reference, cost_per_unit, total_cost, move_date, moved_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
           ->execute([$productId, $product['name'], $type, $qty, $totalCost, $note, $supplier ?: null, $reference ?: null, $movementUnitCost, $totalCost, $purchaseDate, $sess['full_name']]);

        if ($type === 'IN') {
            $db->prepare('INSERT INTO inventory_purchases (inventory_type, inventory_id, item_name, quantity, unit, unit_cost, total_cost, supplier, reference, purchase_date, recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
               ->execute(['product', $productId, $product['name'], $qty, $product['unit'], $costPerUnit, $totalCost, $supplier ?: null, $reference ?: null, $purchaseDate, $sess['full_name']]);
        }

        $details = "Stock $type: {$qty}× {$product['name']}";
        if ($supplier) $details .= ". Supplier: $supplier";
        if ($reference) $details .= ". Ref: $reference";
        if ($note) $details .= ". Note: $note";

        $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
           ->execute(['STOCK', $details, $sess['full_name']]);

        $db->commit();
        jsonOut(['ok' => true, 'newStock' => $newStock, 'unitCost' => $newUnitCost, 'stockValue' => round($newStock * $newUnitCost, 2), 'totalCost' => $totalCost]);
    } catch (Exception $e) {
        $db->rollBack();
        serverFail($e);
    }
}

// List stock movements with full details
if ($action === 'list_purchases') {
    requireRole(['Owner', 'Manager']);
    $stmt = $db->query("SELECT sm.*, p.sell_price AS current_sell FROM stock_movements sm LEFT JOIN products p ON p.id = sm.product_id WHERE sm.type = 'IN' ORDER BY sm.id DESC LIMIT 200");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['product_id'] = (int)$r['product_id'];
        $r['qty'] = (int)$r['qty'];
        $r['cost_per_unit'] = (float)($r['cost_per_unit'] ?? 0);
        $r['productId'] = $r['product_id'];
        $r['productName'] = $r['product_name'];
        $r['date'] = $r['move_date'];
        $r['by'] = $r['moved_by'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
