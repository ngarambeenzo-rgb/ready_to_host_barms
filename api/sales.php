<?php
// ============================================================
//  api/sales.php — Phase 4: Sync engine support
//  Tasks 90-91: Idempotency via client_uuid
//  Task 103: Stock conflict detection with FOR UPDATE
//  Task 106: Timestamp trust validation
//  Task 107: list_conflicts endpoint
// ============================================================
require_once __DIR__ . '/../config/db.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();

$action = $_REQUEST['action'] ?? 'list';
$db     = getDB();

// ── LIST ──────────────────────────────────────────────────────
if ($action === 'list') {
    $sess   = requireAuth();
    $filter = $_GET['filter'] ?? 'today';
    $date   = $_GET['date']   ?? date('Y-m-d');

    if ($filter === 'date') {
        $where = 'sale_date = ?'; $params = [$date];
    } elseif ($filter === 'week') {
        $where = 'sale_date >= ?'; $params = [date('Y-m-d', strtotime('-7 days'))];
    } elseif ($filter === 'month') {
        $where = 'sale_date LIKE ?'; $params = [date('Y-m') . '%'];
    } else {
        $where = 'sale_date = ?'; $params = [date('Y-m-d')];
    }

    if ($sess['role'] === 'Bartender') {
        $where   .= ' AND sold_by = ?';
        $params[] = $sess['full_name'];
    }

    $stmt = $db->prepare("SELECT s.*, p.category FROM sales s LEFT JOIN products p ON s.product_id=p.id WHERE $where ORDER BY s.id DESC LIMIT 500");
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']          = (int)$r['id'];
        $r['product_id']  = (int)$r['product_id'];
        $r['qty']         = (int)$r['qty'];
        $r['unit_price']  = (float)$r['unit_price'];
        $r['total']       = (float)$r['total'];
        $r['voided']      = (bool)$r['voided'];
        $r['productId']   = $r['product_id'];
        $r['productName'] = $r['product_name'];
        $r['unitPrice']   = $r['unit_price'];
        $r['soldBy']      = $r['sold_by'];
        $r['date']        = $r['sale_date'];
        $r['time']        = substr($r['sale_time'], 0, 5);
        $r['category']    = $r['category'] ?? 'General';
        $r['syncStatus']  = $r['sync_status'] ?? 'synced';
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

// ── RECORD SINGLE SALE (Task 90: idempotency, Task 103: conflict, Task 106: timestamp) ──
if ($action === 'record') {
    $sess = requireAuth();
    $body = json_decode(file_get_contents('php://input'), true);

    $productId       = (int)($body['productId'] ?? 0);
    $qty             = (int)($body['qty'] ?? 0);
    $clientUuid      = trim($body['clientUuid'] ?? '');
    $clientCreatedAt = trim($body['clientCreatedAt'] ?? '');

    if (!$productId || $qty < 1) jsonOut(['ok' => false, 'error' => 'Invalid data'], 400);

    // Task 90: Idempotency — check if this clientUuid already exists
    if ($clientUuid) {
        $chk = $db->prepare('SELECT id, total FROM sales WHERE client_uuid = ? LIMIT 1');
        $chk->execute([$clientUuid]);
        $existing = $chk->fetch();
        if ($existing) {
            jsonOut(['ok' => true, 'id' => (int)$existing['id'], 'total' => (float)$existing['total'], 'duplicate' => true]);
        }
    }

    // Task 106: Timestamp trust — reject sales older than 24 hours
    if ($clientCreatedAt) {
        $clientTime = strtotime($clientCreatedAt);
        if ($clientTime && (time() - $clientTime) > 86400) {
            jsonOut(['ok' => false, 'error' => 'conflict', 'message' => 'Sale timestamp is older than 24 hours — flagged for review', 'code' => 'TIMESTAMP_EXPIRED']);
        }
    }

    $db->beginTransaction();
    try {
        // Task 103: Lock row for stock conflict detection.
        // A sale saved offline before the old list was retired must still be recorded,
        // so retired (inactive) items are accepted here; nothing new can be sold from them.
        $stmt = $db->prepare('SELECT * FROM products WHERE id = ? FOR UPDATE');
        $stmt->execute([$productId]);
        $product = $stmt->fetch();
        if (!$product) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Product not found'], 404); }
        // the same offline sale arriving twice at once: the second one waited for the lock above
        if ($clientUuid) {
            $chk = $db->prepare('SELECT id, total FROM sales WHERE client_uuid = ? LIMIT 1');
            $chk->execute([$clientUuid]);
            if ($existing = $chk->fetch()) { $db->rollBack(); jsonOut(['ok' => true, 'id' => (int)$existing['id'], 'total' => (float)$existing['total'], 'duplicate' => true]); }
        }

        // Task 103: Stock conflict — not enough stock
        if ($product['stock'] < $qty) {
            $db->rollBack();
            jsonOut(['ok' => false, 'error' => 'conflict', 'message' => "Only {$product['stock']} {$product['name']} in stock", 'available' => (int)$product['stock'], 'code' => 'STOCK_CONFLICT']);
        }

        $total    = $product['sell_price'] * $qty;
        $saleDate = date('Y-m-d');
        $saleTime = date('H:i:s');
        $clientTs = $clientCreatedAt ?: null;

        $db->prepare('INSERT INTO sales (client_uuid, product_id, product_name, qty, unit_price, total, sold_by, sale_date, sale_time, client_created_at, sync_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
           ->execute([$clientUuid ?: null, $productId, $product['name'], $qty, $product['sell_price'], $total, $sess['full_name'], $saleDate, $saleTime, $clientTs, 'synced']);
        $saleId = (int)$db->lastInsertId();

        $db->prepare('UPDATE products SET stock = stock - ? WHERE id = ?')->execute([$qty, $productId]);
        $db->prepare('INSERT INTO stock_movements (product_id, product_name, type, qty, note, move_date, moved_by) VALUES (?,?,?,?,?,?,?)')
           ->execute([$productId, $product['name'], 'OUT', $qty, 'Sale', $saleDate, $sess['full_name']]);
        $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
           ->execute(['SALE', "Sold {$qty}× {$product['name']} for RWF $total", $sess['full_name']]);

        $db->commit();
        jsonOut(['ok' => true, 'id' => $saleId, 'total' => $total]);
    } catch (Exception $e) {
        $db->rollBack();
        serverFail($e);
    }
}

// ── QUICK SALE (Task 91: idempotency per item) ────────────────
if ($action === 'quick') {
    // the old Quick Sale sold from the retired item list: use New order instead
    jsonOut(['ok' => false, 'error' => 'Quick Sale is retired. Use New order — it uses your current Items list and stock.', 'retired' => true], 410);
    $sess  = requireAuth();
    $body  = json_decode(file_get_contents('php://input'), true);
    $items = $body['items'] ?? [];
    if (empty($items)) jsonOut(['ok' => false, 'error' => 'No items'], 400);

    $db->beginTransaction();
    try {
        $grandTotal = 0;
        $saleDate   = date('Y-m-d');
        $saleTime   = date('H:i:s');

        foreach ($items as $item) {
            $productId  = (int)($item['id'] ?? 0);
            $qty        = (int)($item['qty'] ?? 0);
            $clientUuid = trim($item['clientUuid'] ?? '');
            if (!$productId || $qty < 1) continue;

            // Task 91: Skip if already synced
            if ($clientUuid) {
                $chk = $db->prepare('SELECT id FROM sales WHERE client_uuid = ? LIMIT 1');
                $chk->execute([$clientUuid]);
                if ($chk->fetch()) continue; // already synced, skip
            }

            // Task 103: Lock row
            $stmt = $db->prepare('SELECT * FROM products WHERE id = ? AND active = 1 FOR UPDATE');
            $stmt->execute([$productId]);
            $product = $stmt->fetch();

            if (!$product || $product['stock'] < $qty) {
                $db->rollBack();
                $name = $product['name'] ?? "Product #$productId";
                jsonOut(['ok' => false, 'error' => 'conflict', 'message' => "Insufficient stock for: $name", 'code' => 'STOCK_CONFLICT']);
            }

            $total = $product['sell_price'] * $qty;
            $grandTotal += $total;

            $db->prepare('INSERT INTO sales (client_uuid, product_id, product_name, qty, unit_price, total, sold_by, sale_date, sale_time, sync_status) VALUES (?,?,?,?,?,?,?,?,?,?)')
               ->execute([$clientUuid ?: null, $productId, $product['name'], $qty, $product['sell_price'], $total, $sess['full_name'], $saleDate, $saleTime, 'synced']);
            $db->prepare('UPDATE products SET stock = stock - ? WHERE id = ?')->execute([$qty, $productId]);
            $db->prepare('INSERT INTO stock_movements (product_id, product_name, type, qty, note, move_date, moved_by) VALUES (?,?,?,?,?,?,?)')
               ->execute([$productId, $product['name'], 'OUT', $qty, 'Quick Sale', $saleDate, $sess['full_name']]);
        }

        $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
           ->execute(['SALE', "Quick sale: " . count($items) . " items, total RWF $grandTotal", $sess['full_name']]);

        $db->commit();
        jsonOut(['ok' => true, 'total' => $grandTotal]);
    } catch (Exception $e) {
        $db->rollBack();
        serverFail($e);
    }
}

// ── VOID SALE (Owner only) ────────────────────────────────────
if ($action === 'void') {
    requirePerm('canApproveVoids');
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    if (!$id) jsonOut(['ok' => false, 'error' => 'Invalid id'], 400);

    $stmt = $db->prepare('SELECT * FROM sales WHERE id = ? AND voided = 0');
    $stmt->execute([$id]);
    $sale = $stmt->fetch();
    if (!$sale) jsonOut(['ok' => false, 'error' => 'Sale not found or already voided'], 404);

    $db->beginTransaction();
    try {
        // only the request that really voids it gives the stock back (two at once: one wins)
        $vd = $db->prepare('UPDATE sales SET voided = 1 WHERE id = ? AND voided = 0');
        $vd->execute([$id]);
        if ($vd->rowCount() !== 1) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'This sale was already voided'], 409); }
        $db->prepare('UPDATE products SET stock = stock + ? WHERE id = ?')->execute([$sale['qty'], $sale['product_id']]);
        $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
           ->execute(['VOID', "Voided sale #{$id}: {$sale['product_name']} x{$sale['qty']} RWF {$sale['total']}", $_SESSION['full_name']]);
        $db->commit();
        jsonOut(['ok' => true]);
    } catch (Exception $e) {
        $db->rollBack();
        serverFail($e);
    }
}

// ── LIST CONFLICTS (Task 107) ─────────────────────────────────
if ($action === 'list_conflicts') {
    requireRole(['Owner', 'Manager']);
    $stmt = $db->query("SELECT s.*, p.name AS current_product_name FROM sales s LEFT JOIN products p ON s.product_id = p.id WHERE s.sync_status = 'conflict' ORDER BY s.id DESC");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']          = (int)$r['id'];
        $r['qty']         = (int)$r['qty'];
        $r['total']       = (float)$r['total'];
        $r['productName'] = $r['product_name'];
        $r['soldBy']      = $r['sold_by'];
        $r['date']        = $r['sale_date'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
