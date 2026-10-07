<?php
// ============================================================
//  api/sessions.php — Table & Session Management
//  GET  action=list_tables
//  GET  action=get_session     { sessionId }
//  GET  action=recent_sessions
//  POST action=open_session    { tableId }
//  POST action=add_item        { sessionId, productId, qty, clientUuid }
//  POST action=remove_item     { itemId }
//  POST action=close_session   { sessionId, paymentMethod, customerPhone }
//  POST action=add_table       { name, capacity }
// ============================================================
require_once __DIR__ . '/../config/db.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();

$action = $_REQUEST['action'] ?? '';
$sess   = requireAuth();
$db     = getDB();

// ── LIST TABLES ───────────────────────────────────────────────
// The old item list ("products") is retired: everything is sold through orders
// (api/orders.php, the Items list). Old table sessions can still be viewed and the
// one still open can be paid (close_session), but nothing new is sold from them.
const SESSIONS_RETIRED = ['open_session', 'open_takeaway', 'add_item', 'update_item_qty', 'remove_item'];
if (in_array($action, SESSIONS_RETIRED, true)) {
    jsonOut(['ok' => false, 'error' => 'The old table system is retired. Use New order (or tap the table) to sell — it uses your current Items list and stock.', 'retired' => true], 410);
}

if ($action === 'list_tables') {
    // Query 1: Get all tables with their table_sessions (fast, simple)
    $stmt = $db->query('
        SELECT t.*,
               ts.id         AS session_id,
               ts.total      AS session_total,
               ts.opened_by,
               ts.opened_at,
               COUNT(tsi.id) AS item_count
        FROM tables t
        LEFT JOIN table_sessions ts ON ts.table_id = t.id AND ts.status = "open"
        LEFT JOIN table_session_items tsi ON tsi.session_id = ts.id
        WHERE t.active = 1
        GROUP BY t.id, ts.id
        ORDER BY t.id ASC
    ');
    $rows = $stmt->fetchAll();

    // Query 2: Get open orders per table (separate simple query — no cartesian product)
    $orderStmt = $db->query('
        SELECT o.id, o.table_id, o.order_number, o.total, o.status,
               o.created_by, o.created_at,
               COUNT(oi.id) AS item_count
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE o.status IN ("draft","validated") AND o.table_id > 0
        GROUP BY o.id
    ');
    $openOrders = [];
    foreach ($orderStmt->fetchAll() as $o) {
        $openOrders[(int)$o['table_id']] = $o;
    }

    foreach ($rows as &$r) {
        $r['id']           = (int)$r['id'];
        $r['capacity']     = (int)$r['capacity'];
        $r['sessionId']    = $r['session_id'] ? (int)$r['session_id'] : null;
        $r['sessionTotal'] = (float)($r['session_total'] ?? 0);
        $r['itemCount']    = (int)($r['item_count'] ?? 0);
        $r['openedBy']     = $r['opened_by'] ?? '';
        $r['openedAt']     = $r['opened_at'] ?? null;

        // Attach open order if exists for this table
        $o = $openOrders[$r['id']] ?? null;
        $r['orderId']        = $o ? (int)$o['id']         : null;
        $r['orderNumber']    = $o ? $o['order_number']     : null;
        $r['orderTotal']     = $o ? (float)$o['total']     : 0;
        $r['orderStatus']    = $o ? $o['status']           : null;
        $r['orderCreatedBy'] = $o ? $o['created_by']       : null;
        $r['orderCreatedAt'] = $o ? $o['created_at']       : null;
        $r['orderItemCount'] = $o ? (int)$o['item_count']  : 0;

        // Status: use tables.status column (set by orders.php) OR open session
        $r['status'] = ($r['session_id'] || $o || $r['status'] === 'occupied') ? 'occupied' : 'free';
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

// ── GET SESSION ───────────────────────────────────────────────
if ($action === 'get_session') {
    $sessionId = (int)($_GET['sessionId'] ?? 0);
    if (!$sessionId) jsonOut(['ok' => false, 'error' => 'sessionId required'], 400);

    $sStmt = $db->prepare('
        SELECT ts.*, COALESCE(t.name, ts.table_name) AS table_name
        FROM table_sessions ts
        LEFT JOIN tables t ON t.id = ts.table_id AND ts.table_id > 0
        WHERE ts.id = ? LIMIT 1
    ');
    $sStmt->execute([$sessionId]);
    $session = $sStmt->fetch();
    if (!$session) jsonOut(['ok' => false, 'error' => 'Session not found'], 404);

    $iStmt = $db->prepare('
        SELECT tsi.*, p.name AS product_name_current
        FROM table_session_items tsi
        LEFT JOIN products p ON p.id = tsi.product_id
        WHERE tsi.session_id = ?
        ORDER BY tsi.id ASC
    ');
    $iStmt->execute([$sessionId]);
    $items = $iStmt->fetchAll();

    foreach ($items as &$i) {
        $i['id']         = (int)$i['id'];
        $i['product_id'] = (int)$i['product_id'];
        $i['qty']        = (int)$i['qty'];
        $i['unit_price'] = (float)$i['unit_price'];
        $i['unitPrice']  = (float)$i['unit_price'];
        $i['total']      = (float)$i['total'];
    }
    unset($i);

    $total = array_sum(array_column($items, 'total'));

    jsonOut([
        'ok'      => true,
        'session' => [
            'id'        => (int)$session['id'],
            'tableId'   => (int)$session['table_id'],
            'tableName' => $session['table_name'],
            'openedBy'  => $session['opened_by'],
            'openedAt'  => $session['opened_at'],
            'status'    => $session['status'],
            'total'     => (float)$session['total'],
            'note'      => $session['note'] ?? '',
        ],
        'items' => $items,
        'total' => $total,
    ]);
}

// ── RECENT SESSIONS ───────────────────────────────────────────
if ($action === 'recent_sessions') {
    $stmt = $db->query('
        SELECT ts.*, t.name AS table_name,
               COUNT(tsi.id) AS item_count
        FROM table_sessions ts
        LEFT JOIN tables t ON t.id = ts.table_id AND ts.table_id > 0
        LEFT JOIN table_session_items tsi ON tsi.session_id = ts.id
        GROUP BY ts.id
        ORDER BY ts.id DESC
        LIMIT 50
    ');
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']        = (int)$r['id'];
        $r['total']     = (float)$r['total'];
        $r['itemCount'] = (int)$r['item_count'];
        $r['tableName'] = $r['table_name'];
        $r['openedBy']  = $r['opened_by'];
        $r['closedBy']  = $r['closed_by'];
        $r['openedAt']  = $r['opened_at'];
        $r['closedAt']  = $r['closed_at'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

// ── OPEN SESSION ──────────────────────────────────────────────
if ($action === 'open_session') {
    $body    = json_decode(file_get_contents('php://input'), true);
    $tableId = (int)($body['tableId'] ?? 0);
    if (!$tableId) jsonOut(['ok' => false, 'error' => 'tableId required'], 400);

    // Check table exists
    $tStmt = $db->prepare('SELECT * FROM tables WHERE id = ? AND active = 1 LIMIT 1');
    $tStmt->execute([$tableId]);
    $table = $tStmt->fetch();
    if (!$table) jsonOut(['ok' => false, 'error' => 'Table not found'], 404);

    // Lock the table: two devices opening it at the same moment get the same session
    $db->beginTransaction();
    try {
        $db->prepare('SELECT id FROM tables WHERE id = ? FOR UPDATE')->execute([$tableId]);
        $existing = $db->prepare('SELECT id FROM table_sessions WHERE table_id = ? AND status = "open" LIMIT 1');
        $existing->execute([$tableId]);
        $openSession = $existing->fetch();
        if ($openSession) {
            $db->rollBack();
            jsonOut(['ok' => true, 'sessionId' => (int)$openSession['id'], 'message' => 'Session already open']);
        }
        $db->prepare('INSERT INTO table_sessions (table_id, table_name, opened_by, status, total) VALUES (?,?,?,?,?)')
           ->execute([$tableId, $table['name'], $sess['full_name'], 'open', 0]);
        $sessionId = (int)$db->lastInsertId();
        $db->prepare('UPDATE tables SET status = "occupied" WHERE id = ?')->execute([$tableId]);
        $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
           ->execute(['TABLE', "Opened session for {$table['name']}", $sess['full_name']]);
        $db->commit();
    } catch (Exception $e) { serverFail($e); }
    jsonOut(['ok' => true, 'sessionId' => $sessionId]);
}

// ── ADD ITEM TO SESSION ───────────────────────────────────────
if ($action === 'add_item') {
    $body       = json_decode(file_get_contents('php://input'), true);
    $sessionId  = (int)($body['sessionId'] ?? 0);
    $productId  = (int)($body['productId'] ?? 0);
    $qty        = (int)($body['qty'] ?? 1);
    $clientUuid = trim($body['clientUuid'] ?? '');

    if (!$sessionId || !$productId || $qty < 1) {
        jsonOut(['ok' => false, 'error' => 'sessionId, productId and qty required'], 400);
    }

    // Idempotency check
    if ($clientUuid) {
        $chk = $db->prepare('SELECT id FROM table_session_items WHERE client_uuid = ? LIMIT 1');
        $chk->execute([$clientUuid]);
        if ($chk->fetch()) jsonOut(['ok' => true, 'duplicate' => true]);
    }

    // Get session
    $sStmt = $db->prepare('SELECT * FROM table_sessions WHERE id = ? AND status = "open" LIMIT 1');
    $sStmt->execute([$sessionId]);
    $session = $sStmt->fetch();
    if (!$session) jsonOut(['ok' => false, 'error' => 'Session not found or closed'], 404);

    // Get product with stock lock
    $db->beginTransaction();
    try {
        // the session must still be open when the item is written (not closed by another device meanwhile)
        $lk = $db->prepare('SELECT status FROM table_sessions WHERE id = ? FOR UPDATE');
        $lk->execute([$sessionId]);
        if ($lk->fetchColumn() !== 'open') { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'This table was closed in the meantime. Open it again to add items.'], 409); }
        if ($clientUuid) {   // the same tap arriving twice at once: only one is added
            $chk = $db->prepare('SELECT id FROM table_session_items WHERE client_uuid = ? LIMIT 1');
            $chk->execute([$clientUuid]);
            if ($chk->fetch()) { $db->rollBack(); jsonOut(['ok' => true, 'duplicate' => true]); }
        }
        $pStmt = $db->prepare('SELECT * FROM products WHERE id = ? AND active = 1 FOR UPDATE');
        $pStmt->execute([$productId]);
        $product = $pStmt->fetch();
        if (!$product) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Product not found'], 404); }
        if ($product['stock'] < $qty) {
            $db->rollBack();
            jsonOut(['ok' => false, 'error' => "Only {$product['stock']} {$product['name']} in stock"], 400);
        }

        $unitPrice = (float)$product['sell_price'];
        $total     = $unitPrice * $qty;

        // Add item
        $db->prepare('INSERT INTO table_session_items (session_id, product_id, product_name, qty, unit_price, total, client_uuid, added_by) VALUES (?,?,?,?,?,?,?,?)')
           ->execute([$sessionId, $productId, $product['name'], $qty, $unitPrice, $total, $clientUuid ?: null, $sess['full_name']]);

        // Deduct stock
        $db->prepare('UPDATE products SET stock = stock - ? WHERE id = ?')->execute([$qty, $productId]);

        // Record stock movement
        $db->prepare('INSERT INTO stock_movements (product_id, product_name, type, qty, note, move_date, moved_by) VALUES (?,?,?,?,?,?,?)')
           ->execute([$productId, $product['name'], 'OUT', $qty, 'Table Sale - Session #'.$sessionId, date('Y-m-d'), $sess['full_name']]);

        // Update session total
        $db->prepare('UPDATE table_sessions SET total = total + ? WHERE id = ?')->execute([$total, $sessionId]);

        $db->commit();

        jsonOut(['ok' => true, 'productName' => $product['name'], 'total' => $total]);
    } catch (Exception $e) {
        $db->rollBack();
        serverFail($e);
    }
}

// ── REMOVE ITEM ───────────────────────────────────────────────
if ($action === 'remove_item') {
    // Allow all roles to remove items (Bartenders can remove items they added)
    $body   = json_decode(file_get_contents('php://input'), true);
    $itemId = (int)($body['itemId'] ?? 0);
    if (!$itemId) jsonOut(['ok' => false, 'error' => 'itemId required'], 400);

    $iStmt = $db->prepare('SELECT * FROM table_session_items WHERE id = ? LIMIT 1');
    $iStmt->execute([$itemId]);
    $item = $iStmt->fetch();
    if (!$item) jsonOut(['ok' => false, 'error' => 'Item not found'], 404);

    $db->beginTransaction();
    try {
        $lk = $db->prepare('SELECT status FROM table_sessions WHERE id = ? FOR UPDATE');
        $lk->execute([$item['session_id']]);
        if ($lk->fetchColumn() !== 'open') { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'This table is already closed; use a void instead'], 409); }
        $del = $db->prepare('DELETE FROM table_session_items WHERE id = ?');
        $del->execute([$itemId]);
        if ($del->rowCount() !== 1) { $db->rollBack(); jsonOut(['ok' => true, 'alreadyDone' => true]); }   // removed by another request: stock was given back once
        $db->prepare('UPDATE products SET stock = stock + ? WHERE id = ?')->execute([$item['qty'], $item['product_id']]);
        $db->prepare('UPDATE table_sessions SET total = total - ? WHERE id = ?')->execute([$item['total'], $item['session_id']]);
        // Record stock movement (IN = restored)
        $db->prepare('INSERT INTO stock_movements (product_id, product_name, type, qty, note, move_date, moved_by) VALUES (?,?,?,?,?,?,?)')
           ->execute([$item['product_id'], $item['product_name'], 'IN', $item['qty'], 'Item removed from table session', date('Y-m-d'), $sess['full_name']]);
        $db->commit();
        jsonOut(['ok' => true]);
    } catch(Exception $e) {
        $db->rollBack();
        serverFail($e);
    }
}

// ── CLOSE SESSION / PAYMENT ───────────────────────────────────
if ($action === 'close_session') {
    $body          = json_decode(file_get_contents('php://input'), true);
    $sessionId     = (int)($body['sessionId'] ?? 0);
    $paymentMethod = trim($body['paymentMethod'] ?? 'Cash');
    $customerPhone = trim($body['customerPhone'] ?? '');

    if (!$sessionId) jsonOut(['ok' => false, 'error' => 'sessionId required'], 400);

    $sStmt = $db->prepare('SELECT ts.*, COALESCE(t.name, ts.table_name) AS table_name FROM table_sessions ts LEFT JOIN tables t ON t.id = ts.table_id AND ts.table_id > 0 WHERE ts.id = ? LIMIT 1');
    $sStmt->execute([$sessionId]);
    $session = $sStmt->fetch();
    if (!$session) jsonOut(['ok' => false, 'error' => 'Session not found or already closed'], 404);

    $db->beginTransaction();
    try {
        // Lock the session: a double tap or a retry closes (and records the sale) only once
        $lk = $db->prepare('SELECT status, total, payment_method, closed_by, closed_at FROM table_sessions WHERE id = ? FOR UPDATE');
        $lk->execute([$sessionId]);
        $now = $lk->fetch();
        if ($now['status'] !== 'open') {
            $db->rollBack();
            $it = $db->prepare('SELECT * FROM table_session_items WHERE session_id = ?');
            $it->execute([$sessionId]);
            jsonOut(['ok' => true, 'alreadyDone' => true, 'sessionId' => $sessionId, 'tableName' => $session['table_name'], 'items' => $it->fetchAll(),
                     'total' => (float)$now['total'], 'paymentMethod' => $now['payment_method'], 'issuedBy' => $now['closed_by'], 'issuedAt' => $now['closed_at'],
                     'receiptId' => $sessionId, 'receiptNumber' => 'INV-' . str_pad($sessionId, 5, '0', STR_PAD_LEFT)]);
        }
        // Get all items
        $items = $db->prepare('SELECT * FROM table_session_items WHERE session_id = ?');
        $items->execute([$sessionId]);
        $itemRows = $items->fetchAll();

        $total = array_sum(array_column($itemRows, 'total'));

        // Record each item as a sale (stock already deducted in add_item)
        $saleDate = date('Y-m-d');
        $saleTime = date('H:i:s');
        foreach ($itemRows as $item) {
            // Generate unique client_uuid per sale line
            $saleUuid = sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
                mt_rand(0,0xffff), mt_rand(0,0xffff), mt_rand(0,0xffff),
                mt_rand(0,0x0fff)|0x4000, mt_rand(0,0x3fff)|0x8000,
                mt_rand(0,0xffff), mt_rand(0,0xffff), mt_rand(0,0xffff));
            $db->prepare('INSERT INTO sales (client_uuid, product_id, product_name, qty, unit_price, total, sold_by, sale_date, sale_time, sync_status) VALUES (?,?,?,?,?,?,?,?,?,?)')
               ->execute([$saleUuid, $item['product_id'], $item['product_name'], $item['qty'], $item['unit_price'], $item['total'], $sess['full_name'], $saleDate, $saleTime, 'synced']);
        }
        // Audit log for the sale
        $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
           ->execute(['SALE', "Table sale: {$session['table_name']} — ".count($itemRows)." items — RWF $total via $paymentMethod", $sess['full_name']]);

        // Close session
        $db->prepare('UPDATE table_sessions SET status="closed", closed_by=?, closed_at=NOW(), total=?, payment_method=?, customer_phone=? WHERE id=?')
           ->execute([$sess['full_name'], $total, $paymentMethod, $customerPhone, $sessionId]);

        // Set table to Cleaning status (cashier marks Available manually)
        // Skip for takeaway orders (table_id = 0)
        if ((int)$session['table_id'] > 0) {
            $db->prepare('UPDATE tables SET status="cleaning" WHERE id=?')->execute([$session['table_id']]);
        }

        $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
           ->execute(['TABLE', "Closed session #{$sessionId} for {$session['table_name']} — RWF $total via $paymentMethod", $sess['full_name']]);

        $db->commit();

        jsonOut([
            'ok'            => true,
            'sessionId'     => $sessionId,
            'tableName'     => $session['table_name'],
            'items'         => $itemRows,
            'total'         => $total,
            'paymentMethod' => $paymentMethod,
            'issuedBy'      => $sess['full_name'],
            'issuedAt'      => date('Y-m-d H:i:s'),
            'receiptId'     => $sessionId,
            'receiptNumber' => 'INV-' . str_pad($sessionId, 5, '0', STR_PAD_LEFT),
        ]);
    } catch(Exception $e) {
        $db->rollBack();
        serverFail($e);
    }
}

// ── ADD TABLE ─────────────────────────────────────────────────
if ($action === 'add_table') {
    requireAuth(); // All roles can add tables
    $body     = json_decode(file_get_contents('php://input'), true);
    $name     = trim($body['name'] ?? '');
    $capacity = (int)($body['capacity'] ?? 4);
    if (!$name) jsonOut(['ok' => false, 'error' => 'Table name required'], 400);

    $db->prepare('INSERT INTO tables (name, capacity, status) VALUES (?,?,?)')
       ->execute([$name, $capacity, 'free']);
    $id = (int)$db->lastInsertId();

    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['TABLE', "Added table: $name (capacity: $capacity)", $sess['full_name']]);

    jsonOut(['ok' => true, 'id' => $id]);
}

// ── DELETE TABLE ──────────────────────────────────────────────
if ($action === 'delete_table') {
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    if (!$id) jsonOut(['ok' => false, 'error' => 'id required'], 400);
    $db->prepare('UPDATE tables SET active = 0 WHERE id = ?')->execute([$id]);
    jsonOut(['ok' => true]);
}

// ── BAR INFO (used by tables.js) ──────────────────────────────
if ($action === 'bar_info') {
    $stmt = $db->query('SELECT bar_name FROM settings LIMIT 1');
    $row  = $stmt->fetch();
    jsonOut(['ok' => true, 'barName' => $row['bar_name'] ?? 'BarMS Pro']);
}


// ── MARK TABLE AVAILABLE ──────────────────────────────────────
if ($action === 'mark_available') {
    $body    = json_decode(file_get_contents('php://input'), true);
    $tableId = (int)($body['tableId'] ?? 0);
    if (!$tableId) jsonOut(['ok' => false, 'error' => 'tableId required'], 400);
    $db->prepare('UPDATE tables SET status = "free" WHERE id = ?')->execute([$tableId]);
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['TABLE', "Marked table #$tableId as available", $sess['full_name']]);
    jsonOut(['ok' => true]);
}

// ── OPEN TAKEAWAY ─────────────────────────────────────────────
if ($action === 'open_takeaway') {
    // Generate takeaway ID
    $stmt = $db->query('SELECT COUNT(*) AS cnt FROM table_sessions WHERE takeaway_id IS NOT NULL');
    $cnt  = (int)$stmt->fetchColumn();
    $tkId = 'TK-' . str_pad($cnt + 1, 3, '0', STR_PAD_LEFT);

    $db->prepare('INSERT INTO table_sessions (table_id, table_name, opened_by, status, total, takeaway_id) VALUES (?,?,?,?,?,?)')
       ->execute([0, $tkId, $sess['full_name'], 'open', 0, $tkId]);
    $sessionId = (int)$db->lastInsertId();

    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['TAKEAWAY', "Opened takeaway order $tkId", $sess['full_name']]);

    jsonOut(['ok' => true, 'sessionId' => $sessionId, 'takeawayId' => $tkId]);
}

// ── LIST TAKEAWAYS ────────────────────────────────────────────
if ($action === 'list_takeaways') {
    $stmt = $db->query('
        SELECT ts.id AS session_id, ts.takeaway_id AS id, ts.opened_by, ts.total, ts.status,
               COUNT(tsi.id) AS item_count
        FROM table_sessions ts
        LEFT JOIN table_session_items tsi ON tsi.session_id = ts.id
        WHERE ts.takeaway_id IS NOT NULL AND ts.status = "open"
        GROUP BY ts.id
        ORDER BY ts.id DESC
    ');
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['sessionId'] = (int)$r['session_id'];
        $r['total']     = (float)$r['total'];
        $r['itemCount'] = (int)$r['item_count'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

// ── UPDATE ITEM QTY ───────────────────────────────────────────
if ($action === 'update_item_qty') {
    $body   = json_decode(file_get_contents('php://input'), true);
    $itemId = (int)($body['itemId'] ?? 0);
    $newQty = (int)($body['qty'] ?? 1);
    if (!$itemId || $newQty < 1) jsonOut(['ok' => false, 'error' => 'itemId and qty required'], 400);

    $iStmt = $db->prepare('SELECT * FROM table_session_items WHERE id = ? LIMIT 1');
    $iStmt->execute([$itemId]);
    $item = $iStmt->fetch();
    if (!$item) jsonOut(['ok' => false, 'error' => 'Item not found'], 404);

    $db->beginTransaction();
    try {
        // re-read under lock: two changes at once must each start from the real quantity
        $lk = $db->prepare('SELECT ts.status FROM table_sessions ts WHERE ts.id = ? FOR UPDATE');
        $lk->execute([$item['session_id']]);
        if ($lk->fetchColumn() !== 'open') { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'This table is already closed'], 409); }
        $re = $db->prepare('SELECT * FROM table_session_items WHERE id = ? FOR UPDATE');
        $re->execute([$itemId]);
        $item = $re->fetch();
        if (!$item) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Item not found'], 404); }
        $db->prepare('SELECT id FROM products WHERE id = ? FOR UPDATE')->execute([$item['product_id']]);
        $diff      = $newQty - $item['qty'];
        $newTotal  = $item['unit_price'] * $newQty;
        $totalDiff = $newTotal - $item['total'];

        if ($diff > 0) {
            // Check stock
            $pStmt = $db->prepare('SELECT stock FROM products WHERE id = ? LIMIT 1');
            $pStmt->execute([$item['product_id']]);
            $stock = (int)$pStmt->fetchColumn();
            if ($stock < $diff) {
                $db->rollBack();
                jsonOut(['ok' => false, 'error' => "Only $stock in stock"], 400);
            }
            $db->prepare('UPDATE products SET stock = stock - ? WHERE id = ?')->execute([$diff, $item['product_id']]);
        } elseif ($diff < 0) {
            $db->prepare('UPDATE products SET stock = stock + ? WHERE id = ?')->execute([abs($diff), $item['product_id']]);
        }

        $db->prepare('UPDATE table_session_items SET qty = ?, total = ? WHERE id = ?')->execute([$newQty, $newTotal, $itemId]);
        $db->prepare('UPDATE table_sessions SET total = total + ? WHERE id = ?')->execute([$totalDiff, $item['session_id']]);
        $db->commit();
        jsonOut(['ok' => true]);
    } catch (Exception $e) {
        $db->rollBack();
        serverFail($e);
    }
}

// ── SAVE NOTE ─────────────────────────────────────────────────
if ($action === 'save_note') {
    $body      = json_decode(file_get_contents('php://input'), true);
    $sessionId = (int)($body['sessionId'] ?? 0);
    $note      = trim($body['note'] ?? '');
    if (!$sessionId) jsonOut(['ok' => false, 'error' => 'sessionId required'], 400);
    $db->prepare('UPDATE table_sessions SET note = ? WHERE id = ?')->execute([$note, $sessionId]);
    jsonOut(['ok' => true]);
}

// ── MARK PRINTED ──────────────────────────────────────────────
if ($action === 'mark_printed') {
    $body      = json_decode(file_get_contents('php://input'), true);
    $receiptId = (int)($body['receiptId'] ?? 0);
    if ($receiptId) {
        $db->prepare('UPDATE table_sessions SET printed = 1 WHERE id = ?')->execute([$receiptId]);
    }
    jsonOut(['ok' => true]);
}

// ── SEND SMS RECEIPT ──────────────────────────────────────────
if ($action === 'send_sms') {
    $body      = json_decode(file_get_contents('php://input'), true);
    $receiptId = (int)($body['receiptId'] ?? 0);
    $phone     = trim($body['phone'] ?? '');
    if (!$phone) jsonOut(['ok' => false, 'error' => 'Phone number required'], 400);
    // SMS integration placeholder — connect to Africa's Talking or similar
    // For now log the attempt and return ok
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['SMS', "SMS receipt requested to $phone for session $receiptId", $sess['full_name']]);
    jsonOut(['ok' => true, 'message' => 'SMS sent (integration pending)']);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
