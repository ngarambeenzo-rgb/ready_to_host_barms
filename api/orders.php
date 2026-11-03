<?php
// ============================================================
//  api/orders.php — Order Management
//  POST action=create        { type, tableId?, tableName? }
//  GET  action=get           { orderId }
//  POST action=add_item      { orderId, productId, qty, clientUuid }
//  POST action=remove_item   { itemId }
//  POST action=update_item   { itemId, qty }
//  POST action=save_note     { orderId, note }
//  POST action=validate      { orderId, note? }
//  POST action=pay           { orderId, paymentMethod, customerPhone? }
//  GET  action=bar_sales     { filter, date? }
//  POST action=send_sms      { orderId, phone }
//  GET  action=list          { status: open | paid | all }
//  POST action=refund        { orderId, items:[{orderItemId, qty, restock}], reason, method }  Owner / allowed Manager
//  POST action=refund_request  same body — sent to the Owner for approval
//  POST action=offline_order   a whole order made offline (offline devices only, see below)
// ============================================================
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/measure_lib.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();

$action = $_REQUEST['action'] ?? '';
$sess   = requireAuth();
$db     = getDB();
$effectiveDate = (!empty($_SESSION['backdate_active']) && !empty($_SESSION['backdate_date']))
    ? $_SESSION['backdate_date']
    : date('Y-m-d');
$effectiveTime = date('H:i:s');

// ── CREATE ORDER ──────────────────────────────────────────────
if ($action === 'create') {
    $body      = json_decode(file_get_contents('php://input'), true);
    $type      = trim($body['type']      ?? 'dinein');
    $tableId   = (int)($body['tableId']   ?? 0);
    $tableName = trim($body['tableName']  ?? '');

    // For takeaway, generate TK number
    if ($type === 'takeaway') {
        $tableName = 'TK-' . str_pad(orderCounterNext($db, 'takeaway'), 3, '0', STR_PAD_LEFT);
        $tableId   = 0;
    }

    // Order number SO-0001, SO-0002 … from the counter. If the counter is ever behind the
    // records (a restored backup), it catches up and the next number is used.
    for ($try = 0; ; $try++) {
        $orderNumber = 'SO-' . str_pad(orderCounterNext($db, 'order'), 4, '0', STR_PAD_LEFT);
        try {
            $db->prepare('INSERT INTO orders (order_number, type, table_id, table_name, status, total, created_by) VALUES (?,?,?,?,?,?,?)')
               ->execute([$orderNumber, $type, $tableId, $tableName, 'draft', 0, $sess['full_name']]);
            break;
        } catch (PDOException $e) {
            if ($e->getCode() !== '23000' || $try >= 2) throw $e;
            orderCounterResync($db);
        }
    }
    $orderId = (int)$db->lastInsertId();

    // Mark table as occupied (after the order exists)
    if ($type === 'dinein' && $tableId > 0) {
        $db->prepare('UPDATE tables SET status = "occupied" WHERE id = ?')->execute([$tableId]);
    }

    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['ORDER', "Created order $orderNumber ($type)", $sess['full_name']]);

    jsonOut(['ok' => true, 'orderId' => $orderId, 'orderNumber' => $orderNumber]);
}

// ── OFFLINE ORDER (sent by an offline device when it syncs) ────
// A whole order made on the device without internet: its items, and how far it got
// (draft / validated / paid) with the real times and the people who did each step.
// Built with the same validate and pay code as online orders. Resumable: the order is found
// again by its clientUuid, so a sync that stopped halfway carries on and nothing is doubled.
//   { clientUuid, offlineRef, type, tableId, tableName, note, status, createdAt, validatedAt,
//     paidAt (ms), createdBy, validatedBy, paidBy (user ids), items:[{clientUuid, sourceType,
//     sourceId, name, price, category, qty}], pay:{paymentMethod, customerPhone, discount,
//     discountReason, discountRules, expectPaid} }
if ($action === 'offline_order') {
    if (empty($_SESSION['offline'])) jsonOut(['ok' => false, 'error' => 'Only sent by an offline device'], 403);
    $b      = json_decode(file_get_contents('php://input'), true) ?: [];
    $uuid   = trim((string)($b['clientUuid'] ?? ''));
    $target = (string)($b['status'] ?? 'draft');
    $items  = array_values(array_filter((array)($b['items'] ?? []), fn($i) => (int)($i['qty'] ?? 0) > 0 && (int)($i['sourceId'] ?? 0) > 0));
    if (!preg_match('/^[A-Za-z0-9-]{8,64}$/', $uuid)) jsonOut(['ok' => false, 'error' => 'clientUuid required'], 400);
    if (!in_array($target, ['draft', 'validated', 'paid'], true)) jsonOut(['ok' => false, 'error' => 'Unknown order status'], 400);
    if ($target !== 'draft' && !$items) jsonOut(['ok' => false, 'error' => 'No items in order'], 400);

    // a time from the device (ms) → DATETIME on the server clock; outside the offline window → now
    $flags = [];
    $ts = function ($ms) use ($db, &$flags) {
        $t = is_numeric($ms) ? intdiv((int)$ms, 1000) : 0;
        if ($t < time() - OFFLINE_MAX_AGE_DAYS * 86400 || $t > time() + 300) { $flags['time'] = true; $t = time(); }
        $st = $db->prepare('SELECT FROM_UNIXTIME(?)'); $st->execute([$t]);
        return (string)$st->fetchColumn();
    };
    // the person who did a step (an active user of this business), else the sender
    $person = function ($id) use ($db, $sess) {
        $st = $db->prepare('SELECT id, full_name, role, username FROM users WHERE id = ? AND active = 1 LIMIT 1');
        $st->execute([(int)$id]);
        $u = $st->fetch();
        return $u ? ['user_id' => (int)$u['id'], 'full_name' => $u['full_name'], 'role' => $u['role'], 'username' => $u['username']] : $sess;
    };
    $createdAt = $ts($b['createdAt'] ?? 0);
    $creator   = $person($b['createdBy'] ?? 0);

    $find = $db->prepare('SELECT * FROM orders WHERE client_uuid = ? LIMIT 1');
    $find->execute([$uuid]);
    $order = $find->fetch();

    if (!$order) {
        $type      = ($b['type'] ?? '') === 'takeaway' ? 'takeaway' : 'dinein';
        $tableId   = $type === 'dinein' ? (int)($b['tableId'] ?? 0) : 0;
        $tableName = mb_substr(trim((string)($b['tableName'] ?? '')), 0, 50);
        if ($type === 'takeaway') $tableName = 'TK-' . str_pad(orderCounterNext($db, 'takeaway'), 3, '0', STR_PAD_LEFT);
        $db->beginTransaction();
        try {
            for ($try = 0; ; $try++) {
                $orderNumber = 'SO-' . str_pad(orderCounterNext($db, 'order'), 4, '0', STR_PAD_LEFT);
                try {
                    $db->prepare('INSERT INTO orders (order_number, client_uuid, offline_ref, type, table_id, table_name, status, total, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
                       ->execute([$orderNumber, $uuid, mb_substr((string)($b['offlineRef'] ?? ''), 0, 20) ?: null, $type, $tableId, $tableName, 'draft', 0, trim((string)($b['note'] ?? '')), $creator['full_name'], $createdAt]);
                    break;
                } catch (PDOException $e) {
                    if ($e->getCode() !== '23000' || $try >= 2) throw $e;
                    $again = $db->prepare('SELECT id FROM orders WHERE client_uuid = ? LIMIT 1');   // sent twice at once
                    $again->execute([$uuid]);
                    if ($again->fetchColumn()) { $db->rollBack(); jsonOut(['ok' => false, 'inProgress' => true, 'error' => 'This order is already being saved.'], 409); }
                    orderCounterResync($db);
                }
            }
            $orderId = (int)$db->lastInsertId();
            $total = 0;
            $ins = $db->prepare('INSERT INTO order_items (order_id, product_id, product_name, qty, unit_price, total, source_type, source_id, category, client_uuid, added_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
            foreach ($items as $it) {
                $src   = ($it['sourceType'] ?? 'bar') === 'kitchen' ? 'kitchen' : 'bar';
                $qty   = (int)$it['qty'];
                $price = round((float)($it['price'] ?? 0), 2);
                $ins->execute([$orderId, (int)$it['sourceId'], mb_substr(trim((string)($it['name'] ?? '')), 0, 150), $qty, $price, round($price * $qty, 2),
                               $src, (int)$it['sourceId'], $src === 'kitchen' ? 'Kitchen' : 'Drink', null, $creator['full_name'], $createdAt]);
                $total += round($price * $qty, 2);
                // the price charged offline is kept; a different price on the server is reported
                $cur = $db->prepare($src === 'kitchen' ? 'SELECT price FROM kitchen_menu WHERE id = ?' : 'SELECT price FROM bar_items WHERE id = ?');
                $cur->execute([(int)$it['sourceId']]);
                $p = $cur->fetchColumn();
                if ($p !== false && abs((float)$p - $price) > 0.009) $flags['price'][] = "{$it['name']}: charged " . (float)$price . ', price now ' . (float)$p;
            }
            $db->prepare('UPDATE orders SET total = ? WHERE id = ?')->execute([$total, $orderId]);
            if ($type === 'dinein' && $tableId > 0 && $target !== 'paid') $db->prepare('UPDATE tables SET status = "occupied" WHERE id = ?')->execute([$tableId]);
            $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
               ->execute(['ORDER', "Created order $orderNumber ($type) offline as " . ($b['offlineRef'] ?? '?') . ' at ' . substr($createdAt, 0, 16), $creator['full_name']]);
            $db->commit();
        } catch (Exception $e) {
            if ($db->inTransaction()) $db->rollBack();
            serverFail($e);
        }
        $find->execute([$uuid]);
        $order = $find->fetch();
    }
    $orderId = (int)$order['id'];

    // carry on to the status it reached on the device
    if (in_array($target, ['validated', 'paid'], true) && $order['status'] === 'draft') {
        $v = $person($b['validatedBy'] ?? 0);
        [$res, $code] = ordValidate($db, $orderId, trim((string)($b['note'] ?? '')), $v['full_name'], $ts($b['validatedAt'] ?? ($b['createdAt'] ?? 0)));
        if (!$res['ok']) jsonOut($res + ['orderId' => $orderId], $code);
    }
    $paid = null;
    if ($target === 'paid') {
        $payer = $person($b['paidBy'] ?? 0);
        [$paid, $code] = ordPay($db, $orderId, (array)($b['pay'] ?? []), $payer, $ts($b['paidAt'] ?? 0));
        if (!$paid['ok']) jsonOut($paid + ['orderId' => $orderId], $code);
        $expect = $b['pay']['expectPaid'] ?? null;
        if ($expect !== null && empty($paid['alreadyDone']) && abs((float)$expect - (float)$paid['paid']) > 0.009) {
            $flags['paid'] = 'the receipt said ' . (float)$expect . ' RWF, the records say ' . (float)$paid['paid'] . ' RWF';
        }
    }
    if ($flags && empty($paid['alreadyDone'])) {
        $msg = "Offline order {$order['order_number']} (" . ($b['offlineRef'] ?? '') . '): '
             . implode('; ', array_filter([
                 !empty($flags['price']) ? 'price changed — ' . implode(', ', $flags['price']) : '',
                 $flags['paid'] ?? '',
                 !empty($flags['time']) ? 'the device clock was wrong, so the time of syncing was used' : '',
             ]));
        $db->prepare('INSERT INTO notifications (message, type) VALUES (?,?)')->execute([$msg, 'warning']);
    }
    jsonOut(['ok' => true, 'orderId' => $orderId, 'orderNumber' => $order['order_number'], 'paid' => $paid['paid'] ?? null]);
}

// Next number of a counter ('order' or 'takeaway'), in one atomic statement.
function orderCounterNext(PDO $db, string $name): int {
    try {
        $db->prepare('INSERT INTO counters (name, value) VALUES (?, LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(value + 1)')->execute([$name]);
        return (int)$db->lastInsertId();
    } catch (PDOException $e) {
        if (!str_contains($e->getMessage(), 'counters')) throw $e;
        // longevity-migration.sql not run yet: the old way
        return $name === 'order'
            ? (int)$db->query('SELECT COUNT(*) FROM orders')->fetchColumn() + 1
            : (int)$db->query("SELECT COUNT(*) FROM orders WHERE type = 'takeaway'")->fetchColumn() + 1;
    }
}
// The order counter caught up with the highest SO- number in the records.
function orderCounterResync(PDO $db): void {
    $max = (int)$db->query("SELECT COALESCE(MAX(CAST(SUBSTRING(order_number, 4) AS UNSIGNED)), 0) FROM orders WHERE order_number LIKE 'SO-%'")->fetchColumn();
    try { $db->prepare("UPDATE counters SET value = GREATEST(value, ?) WHERE name = 'order'")->execute([$max]); } catch (PDOException $e) {}
}

// ── GET ORDER ─────────────────────────────────────────────────
if ($action === 'get') {
    $orderId = (int)($_GET['orderId'] ?? 0);
    if (!$orderId) jsonOut(['ok' => false, 'error' => 'orderId required'], 400);

    $oStmt = $db->prepare('SELECT * FROM orders WHERE id = ? LIMIT 1');
    $oStmt->execute([$orderId]);
    $order = $oStmt->fetch();
    if (!$order) jsonOut(['ok' => false, 'error' => 'Order not found'], 404);

    $iStmt = $db->prepare('
        SELECT oi.*
        FROM order_items oi
        WHERE oi.order_id = ?
        ORDER BY oi.id ASC
    ');
    $iStmt->execute([$orderId]);
    $items = $iStmt->fetchAll();

    $rqStmt = $db->prepare('SELECT ri.order_item_id, SUM(ri.qty) AS q FROM order_refund_items ri JOIN order_refunds r ON r.id = ri.refund_id WHERE r.order_id = ? GROUP BY ri.order_item_id');
    $rqStmt->execute([$orderId]);
    $refundedQty = array_column($rqStmt->fetchAll(), 'q', 'order_item_id');
    $rfStmt = $db->prepare('SELECT * FROM order_refunds WHERE order_id = ? ORDER BY id');
    $rfStmt->execute([$orderId]);
    $refunds = $rfStmt->fetchAll();

    // paid in someone else's cash shift? (a Bartender with no shift of their own sold while another's was open)
    $shiftOwner = null;
    if (!empty($order['shift_id'])) {
        $so = $db->prepare('SELECT user_name FROM shifts WHERE id = ?');
        $so->execute([(int)$order['shift_id']]);
        $name = $so->fetchColumn();
        if ($name && $name !== $order['paid_by']) $shiftOwner = $name;
    }

    $total = 0;
    foreach ($items as &$i) {
        $i['refunded_qty'] = (int)($refundedQty[$i['id']] ?? 0);
        $i['id']         = (int)$i['id'];
        $i['product_id'] = (int)$i['product_id'];
        $i['qty']        = (int)$i['qty'];
        $i['unit_price'] = (float)$i['unit_price'];
        $i['total']      = (float)$i['total'];
        $total          += $i['total'];
    }
    unset($i);

    jsonOut([
        'ok'    => true,
        'order' => [
            'orderId'     => (int)$order['id'],
            'orderNumber' => $order['order_number'],
            'type'        => $order['type'],
            'tableId'     => (int)$order['table_id'],
            'tableName'   => $order['table_name'],
            'status'      => $order['status'],
            'voided'      => (bool)($order['voided'] ?? 0),
            'note'        => $order['note'] ?? '',
            'total'       => (float)$order['total'],
            'paidAt'      => $order['paid_at'],
            'discount'    => (float)($order['discount'] ?? 0),
            'discountReason' => $order['discount_reason'] ?? null,
            'paymentMethod' => $order['payment_method'],
            'offlineRef'  => $order['offline_ref'] ?? null,
            'paidBy'      => $order['paid_by'] ?? null,
            'shiftOwner'  => $shiftOwner,
            'refundedTotal' => array_sum(array_map(fn($r) => (float)$r['amount'], $refunds)),
        ],
        'refunds' => $refunds,
        'items' => $items,
        'total' => $total,
    ]);
}

// ── ADD ITEM ──────────────────────────────────────────────────
if ($action === 'add_item') {
    $body       = json_decode(file_get_contents('php://input'), true);
    $orderId    = (int)($body['orderId']    ?? 0);
    $sourceType = trim($body['sourceType']  ?? 'bar'); // 'bar' or 'kitchen'
    $sourceId   = (int)($body['sourceId']   ?? 0);
    $name       = trim($body['name']        ?? '');
    $price      = (float)($body['price']    ?? 0);
    $category   = trim($body['category']    ?? 'Drink');
    $qty        = (int)($body['qty']        ?? 1);
    $clientUuid = trim($body['clientUuid']  ?? '');
    if (!$orderId || !$sourceId || !$name) jsonOut(['ok' => false, 'error' => 'orderId, sourceId and name required'], 400);

    // Check order status
    $oStmt = $db->prepare('SELECT status FROM orders WHERE id = ? LIMIT 1');
    $oStmt->execute([$orderId]);
    $order = $oStmt->fetch();
    if (!$order) jsonOut(['ok' => false, 'error' => 'Order not found'], 404);
    if ($order['status'] === 'validated') jsonOut(['ok' => false, 'error' => 'Order is already validated'], 400);

    // Idempotency
    if ($clientUuid) {
        $dupe = $db->prepare('SELECT id FROM order_items WHERE client_uuid = ? LIMIT 1');
        $dupe->execute([$clientUuid]);
        if ($dupe->fetch()) jsonOut(['ok' => true, 'duplicate' => true]);
    }

    // Stock check for bar direct items. Offline the drink was already served: it is added
    // (stock may go below zero, which the stock reports show).
    $offAt = ordOfflineAt();
    if ($sourceType === 'bar' && !$offAt) {
        $biStmt = $db->prepare('SELECT type, stock, parent_id, portion_size, measure_unit FROM bar_items WHERE id = ? AND active = 1 LIMIT 1');
        $biStmt->execute([$sourceId]);
        $barItem = $biStmt->fetch();
        if (!$barItem) jsonOut(['ok' => false, 'error' => 'Item not found in bar inventory'], 404);
        if ($barItem['type'] === 'portion') {
            // a shot or glass: enough must be left in the open bottle plus the sealed ones
            $bottle = measureLoadBottle($db, (int)$barItem['parent_id']);
            $left = $bottle ? measurePortionsLeft($bottle, (float)$barItem['portion_size']) : 0;
            if ($left <= 0) jsonOut(['ok' => false, 'error' => "$name: nothing left in the bottle"], 400);
            if ($left < $qty) jsonOut(['ok' => false, 'error' => "Only $left $name left in the bottle"], 400);
        }
        if ($barItem['type'] === 'direct' && $barItem['stock'] <= 0) {
            jsonOut(['ok' => false, 'error' => $barItem['measure_unit'] ? "No sealed bottle of $name left. The open bottle can only be sold by the shot or glass." : "$name is out of stock"], 400);
        }
        if ($barItem['type'] === 'direct' && $barItem['stock'] < $qty) {
            jsonOut(['ok' => false, 'error' => "Only {$barItem['stock']} $name left in stock"], 400);
        }
    }

    $db->beginTransaction();
    try {
        $unitPrice = $price;
        $total     = $unitPrice * $qty;

        // Check if same item already in order
        $eStmt = $db->prepare('SELECT id, qty, total FROM order_items WHERE order_id = ? AND source_type = ? AND source_id = ? LIMIT 1');
        $eStmt->execute([$orderId, $sourceType, $sourceId]);
        $existing = $eStmt->fetch();

        if ($existing) {
            $newQty   = $existing['qty'] + $qty;
            $newTotal = $unitPrice * $newQty;
            $db->prepare('UPDATE order_items SET qty = ?, total = ? WHERE id = ?')
               ->execute([$newQty, $newTotal, $existing['id']]);
            $db->prepare('UPDATE orders SET total = total + ? WHERE id = ?')->execute([$total, $orderId]);
        } else {
            $db->prepare('INSERT INTO order_items (order_id, product_id, product_name, qty, unit_price, total, source_type, source_id, category, client_uuid, added_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,' . ($offAt ? '?' : 'NOW()') . ')')
               ->execute(array_merge([$orderId, $sourceId, $name, $qty, $unitPrice, $total, $sourceType, $sourceId, $category, $clientUuid ?: null, $sess['full_name']], $offAt ? [$offAt] : []));
            $db->prepare('UPDATE orders SET total = total + ? WHERE id = ?')->execute([$total, $orderId]);
        }

        $db->commit();
        jsonOut(['ok' => true]);
    } catch (Exception $e) {
        $db->rollBack();
        serverFail($e);
    }
}

// ── REMOVE ITEM ───────────────────────────────────────────────
if ($action === 'remove_item') {
    $body   = json_decode(file_get_contents('php://input'), true);
    $itemId = (int)($body['itemId'] ?? 0);
    if (!$itemId) jsonOut(['ok' => false, 'error' => 'itemId required'], 400);

    $db->beginTransaction();
    try {
        $iStmt = $db->prepare('SELECT * FROM order_items WHERE id = ? LIMIT 1');
        $iStmt->execute([$itemId]);
        $item = $iStmt->fetch();
        if (!$item) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Item not found'], 404); }
        $stStmt = $db->prepare('SELECT status FROM orders WHERE id = ? LIMIT 1 FOR UPDATE');
        $stStmt->execute([$item['order_id']]);
        if ($stStmt->fetchColumn() !== 'draft') { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Items can only be removed before the order is validated. Use a void or refund instead.'], 400); }
        // No stock change: a draft order has not taken any stock yet (stock is deducted at validation)

        $db->prepare('UPDATE orders SET total = total - ? WHERE id = ?')->execute([$item['total'], $item['order_id']]);
        $db->prepare('DELETE FROM order_items WHERE id = ?')->execute([$itemId]);
        $db->commit();
        jsonOut(['ok' => true]);
    } catch (Exception $e) {
        $db->rollBack();
        serverFail($e);
    }
}

// ── UPDATE ITEM QTY ───────────────────────────────────────────
if ($action === 'update_item') {
    $body   = json_decode(file_get_contents('php://input'), true);
    $itemId = (int)($body['itemId'] ?? 0);
    $newQty = (int)($body['qty']    ?? 1);
    if (!$itemId || $newQty < 1) jsonOut(['ok' => false, 'error' => 'itemId and qty required'], 400);

    $db->beginTransaction();
    try {
        $iStmt = $db->prepare('SELECT * FROM order_items WHERE id = ? LIMIT 1');
        $iStmt->execute([$itemId]);
        $item = $iStmt->fetch();
        if (!$item) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Item not found'], 404); }

        $stStmt = $db->prepare('SELECT status FROM orders WHERE id = ? LIMIT 1 FOR UPDATE');
        $stStmt->execute([$item['order_id']]);
        if ($stStmt->fetchColumn() !== 'draft') { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Quantities can only be changed before the order is validated'], 400); }

        $diff      = $newQty - $item['qty'];
        $newTotal  = $item['unit_price'] * $newQty;
        $totalDiff = $newTotal - $item['total'];

        // Check bar stock for the new quantity (stock itself is deducted at validation)
        if ($diff > 0 && ($item['source_type'] ?? 'bar') === 'bar' && !ordOfflineAt()) {   // offline: already served
            $bStmt = $db->prepare("SELECT name, type, stock, parent_id, portion_size FROM bar_items WHERE id = ? LIMIT 1");
            $bStmt->execute([$item['source_id'] ?: $item['product_id']]);
            $bi = $bStmt->fetch();
            if ($bi && $bi['type'] === 'portion') {
                $bottle = measureLoadBottle($db, (int)$bi['parent_id']);
                $left = $bottle ? measurePortionsLeft($bottle, (float)$bi['portion_size']) : 0;
                if ($left < $newQty) { $db->rollBack(); jsonOut(['ok' => false, 'error' => "Only $left {$bi['name']} left in the bottle"], 400); }
            }
            if ($bi && $bi['type'] === 'direct' && (float)$bi['stock'] < $newQty) {
                $db->rollBack();
                jsonOut(['ok' => false, 'error' => 'Only ' . (float)$bi['stock'] . " {$bi['name']} left in stock"], 400);
            }
        }

        $db->prepare('UPDATE order_items SET qty = ?, total = ? WHERE id = ?')->execute([$newQty, $newTotal, $itemId]);
        $db->prepare('UPDATE orders SET total = total + ? WHERE id = ?')->execute([$totalDiff, $item['order_id']]);
        $db->commit();
        jsonOut(['ok' => true]);
    } catch (Exception $e) {
        $db->rollBack();
        serverFail($e);
    }
}

// ── SAVE NOTE ─────────────────────────────────────────────────
if ($action === 'save_note') {
    $body    = json_decode(file_get_contents('php://input'), true);
    $orderId = (int)($body['orderId'] ?? 0);
    $note    = trim($body['note']     ?? '');
    if (!$orderId) jsonOut(['ok' => false, 'error' => 'orderId required'], 400);
    $db->prepare('UPDATE orders SET note = ? WHERE id = ?')->execute([$note, $orderId]);
    jsonOut(['ok' => true]);
}

// ── VALIDATE ORDER ────────────────────────────────────────────
if ($action === 'validate') {
    $body    = json_decode(file_get_contents('php://input'), true);
    $orderId = (int)($body['orderId'] ?? 0);
    $note    = trim($body['note']     ?? '');
    if (!$orderId) jsonOut(['ok' => false, 'error' => 'orderId required'], 400);
    [$res, $code] = ordValidate($db, $orderId, $note, $sess['full_name'], ordOfflineAt());
    jsonOut($res, $code);
}

// When an offline record really happened (null = online: now / back-dated day as before)
function ordOfflineAt(): ?string {
    return !empty($_SESSION['offline']) ? barmsActionTime() : null;
}

// Validate an order: record the bar and kitchen sales, take the stock, send food to the kitchen.
// $at = original time of an offline record (null online). → [answer, http code]
function ordValidate(PDO $db, int $orderId, string $note, string $who, ?string $at): array {
    global $effectiveDate, $effectiveTime;
    $saleDate = $at ? substr($at, 0, 10) : $effectiveDate;
    $saleTime = $at ? substr($at, 11, 8) : $effectiveTime;
    $nowSql   = $at ? '?' : 'NOW()';   // validated_at / created_at of what this writes

    $oStmt = $db->prepare('SELECT * FROM orders WHERE id = ? LIMIT 1');
    $oStmt->execute([$orderId]);
    $order = $oStmt->fetch();
    if (!$order) return [['ok' => false, 'error' => 'Order not found'], 404];

    $db->beginTransaction();
    try {
        // Lock the order: a double tap or a retry after a timeout must never record the
        // sale and deduct stock twice. The second request waits here, then sees the result.
        $lk = $db->prepare('SELECT status FROM orders WHERE id = ? FOR UPDATE');
        $lk->execute([$orderId]);
        $status = $lk->fetchColumn();
        if ($status !== 'draft') {
            $db->rollBack();
            if (in_array($status, ['validated', 'paid'], true)) return [['ok' => true, 'alreadyDone' => true, 'status' => $status], 200];
            return [['ok' => false, 'error' => "This order cannot be validated (it is $status)"], 409];
        }
        $iStmt = $db->prepare('SELECT oi.* FROM order_items oi WHERE oi.order_id = ?');
        $iStmt->execute([$orderId]);
        $items = $iStmt->fetchAll();
        if (!$items) { $db->rollBack(); return [['ok' => false, 'error' => 'No items in order'], 400]; }

        // Update order status
        $db->prepare("UPDATE orders SET status = \"validated\", note = ?, validated_by = ?, validated_at = $nowSql WHERE id = ? AND status = \"draft\"")
           ->execute($at ? [$note, $who, $at, $orderId] : [$note, $who, $orderId]);

        // Cost of one bar unit right now: direct item = average buy cost, recipe item = sum of its ingredients
        $barUnitCost = function (int $barItemId) use ($db): ?float {
            if ($barItemId <= 0) return null;
            $st = $db->prepare('SELECT type, cost_price, recipe_id FROM bar_items WHERE id = ? LIMIT 1');
            $st->execute([$barItemId]);
            $bi = $st->fetch();
            if (!$bi) return null;
            if ($bi['type'] === 'portion') {
                $bt = measureLoadBottle($db, (int)$bi['parent_id']);
                return $bt ? measurePortionCost($bt, (float)$bi['portion_size']) : (float)$bi['cost_price'];
            }
            if ($bi['type'] !== 'recipe') return (float)$bi['cost_price'];
            if (!$bi['recipe_id']) return null;
            $rc = $db->prepare('SELECT COALESCE(SUM(bri.qty * bing.cost_per_unit),0) FROM bar_recipe_ingredients bri JOIN bar_ingredients bing ON bing.id = bri.ingredient_id WHERE bri.recipe_id = ?');
            $rc->execute([$bi['recipe_id']]);
            return (float)$rc->fetchColumn();
        };
        // created_at of a stock / kitchen row: the offline time, or the column default (now)
        $atCol = $at ? ', created_at' : '';
        $atVal = $at ? ',?' : '';
        $atArg = $at ? [$at] : [];

        // Route items to Bar (bar_sales) and Kitchen (kitchen_sales)
        $barSaleItems = [];
        foreach ($items as $item) {
            $category  = strtolower($item['category'] ?? 'drink');
            $sourceType = $item['source_type'] ?? 'bar';
            $sourceId   = (int)($item['source_id'] ?? 0);
            $isKitchen = ($sourceType === 'kitchen' || $category === 'kitchen');

            if ($isKitchen) {
                continue; // kitchen items are recorded once in the kitchen loop below
            } else {
                // Insert into bar_sales (drink items)
                $db->prepare("INSERT INTO bar_sales (product_id, product_name, qty, unit_price, total, unit_cost, sold_by, order_id, order_number, sale_date, sale_time$atCol) VALUES (?,?,?,?,?,?,?,?,?,?,?$atVal)")
                   ->execute(array_merge([$item['product_id'], $item['product_name'], $item['qty'], $item['unit_price'], $item['total'], $barUnitCost($sourceId), $who, $orderId, $order['order_number'], $saleDate, $saleTime], $atArg));
                // Deduct bar stock using source_id directly
                if ($sourceId > 0) {
                    $barSaleItems[] = ['barItemId' => $sourceId, 'qty' => (int)$item['qty']];
                }
            }
        }

        // Deduct bar inventory stock for matched items
        if ($barSaleItems) {
            foreach ($barSaleItems as $bsi) {
                $biStmt = $db->prepare('SELECT * FROM bar_items WHERE id = ? LIMIT 1');
                $biStmt->execute([$bsi['barItemId']]);
                $bi = $biStmt->fetch();
                if (!$bi) continue;
                if ($bi['type'] === 'portion') {
                    // pour from the open bottle, opening a sealed one when it runs short
                    $bt = measureLoadBottle($db, (int)$bi['parent_id']);
                    if ($bt) {
                        $pour = (float)$bi['portion_size'] * $bsi['qty'];
                        measureTake($db, (int)$bt['id'], $pour, $who, "Order {$order['order_number']}", $at ?: null);
                        $pc = measurePortionCost($bt, (float)$bi['portion_size']);
                        $db->prepare("INSERT INTO bar_movements (item_name, item_id, qty_change, type, reason, unit, order_number, unit_cost, total_cost, done_by$atCol) VALUES (?,?,?,?,?,?,?,?,?,?$atVal)")
                           ->execute(array_merge([$bi['name'], $bi['id'], -$bsi['qty'], 'sale', "Order {$order['order_number']}: {$bsi['qty']} x {$bi['name']} (" . rtrim(rtrim(number_format($pour, 1, '.', ''), '0'), '.') . " {$bt['measure_unit']} poured)", 'pcs', $order['order_number'], $pc, round($bsi['qty'] * $pc, 2), $who], $atArg));
                    }
                } elseif ($bi['type'] === 'direct') {
                    $db->prepare('UPDATE bar_items SET stock = stock - ? WHERE id = ?')->execute([$bsi['qty'], $bi['id']]);
                    $db->prepare("INSERT INTO bar_movements (item_name, item_id, qty_change, type, reason, unit, order_number, unit_cost, total_cost, done_by$atCol) VALUES (?,?,?,?,?,?,?,?,?,?$atVal)")
                       ->execute(array_merge([$bi['name'], $bi['id'], -$bsi['qty'], 'sale', "Order {$order['order_number']}", 'pcs', $order['order_number'], $bi['cost_price'], round($bsi['qty'] * (float)$bi['cost_price'], 2), $who], $atArg));
                } elseif ($bi['type'] === 'recipe' && $bi['recipe_id']) {
                    $riStmt = $db->prepare('SELECT bri.*, bing.name AS ing_name, bing.unit, bing.cost_per_unit FROM bar_recipe_ingredients bri JOIN bar_ingredients bing ON bing.id = bri.ingredient_id WHERE bri.recipe_id = ?');
                    $riStmt->execute([$bi['recipe_id']]);
                    foreach ($riStmt->fetchAll() as $ri) {
                        $totalQty = $ri['qty'] * $bsi['qty'];
                        $db->prepare('UPDATE bar_ingredients SET quantity = quantity - ? WHERE id = ?')->execute([$totalQty, $ri['ingredient_id']]);
                        $db->prepare("INSERT INTO bar_movements (item_name, ingredient_id, qty_change, type, reason, unit, order_number, unit_cost, total_cost, done_by$atCol) VALUES (?,?,?,?,?,?,?,?,?,?$atVal)")
                           ->execute(array_merge([$ri['ing_name'], $ri['ingredient_id'], -$totalQty, 'sale', "Recipe: {$bi['name']} via Order {$order['order_number']}", $ri['unit'], $order['order_number'], $ri['cost_per_unit'], round($totalQty * (float)$ri['cost_per_unit'], 2), $who], $atArg));
                    }
                }
            }
        }

        // Auto-deduct ingredients, record kitchen sales, and create Kitchen Order ticket
        $kitchenItemsForTicket = [];
        foreach ($items as $item) {
            $category = strtolower($item['category'] ?? 'drink');
            if (($item['source_type'] ?? 'bar') !== 'kitchen' && $category !== 'kitchen') continue;

            // Find linked menu item (for prep_minutes + recipe_id)
            $kitchenSourceId = (int)($item['source_id'] ?? 0);
            $menuStmt = $db->prepare("SELECT km.id AS menu_id, km.recipe_id, km.prep_minutes FROM kitchen_menu km WHERE km.id = ? LIMIT 1");
            $menuStmt->execute([$kitchenSourceId ?: 0]);
            $menuRow = $menuStmt->fetch();
            if (!$menuRow) {
                // Fallback: match by name
                $menuStmt2 = $db->prepare("SELECT km.id AS menu_id, km.recipe_id, km.prep_minutes FROM kitchen_menu km WHERE km.name = ? LIMIT 1");
                $menuStmt2->execute([$item['product_name']]);
                $menuRow = $menuStmt2->fetch();
            }

            $prepMinutes = (int)($menuRow['prep_minutes'] ?? 10);
            $recipeId    = $menuRow['recipe_id'] ?? null;
            $menuItemId  = $menuRow['menu_id'] ?? null;

            $recipeIngs = [];
            if ($recipeId) {
                $riStmt = $db->prepare("SELECT ri.*, ki.cost_per_unit FROM recipe_ingredients ri JOIN kitchen_ingredients ki ON ki.id = ri.ingredient_id WHERE ri.recipe_id = ?");
                $riStmt->execute([$recipeId]);
                $recipeIngs = $riStmt->fetchAll();
            }
            // Ingredient cost of one portion right now (NULL = dish has no recipe, so its cost is unknown)
            $portionCost = $recipeId ? array_sum(array_map(fn($r) => (float)$r['qty'] * (float)$r['cost_per_unit'], $recipeIngs)) : null;

            // Record the kitchen sale once (reports and dashboards read kitchen_sales)
            $db->prepare("INSERT INTO kitchen_sales (product_id, product_name, qty, unit_price, total, unit_cost, sold_by, order_id, sale_date, sale_time$atCol) VALUES (?,?,?,?,?,?,?,?,?,?$atVal)")
               ->execute(array_merge([$item['product_id'], $item['product_name'], $item['qty'], $item['unit_price'], $item['total'], $portionCost, $who, $orderId, $saleDate, $saleTime], $atArg));

            foreach ($recipeIngs as $ri) {
                $totalQty = $ri['qty'] * $item['qty'];
                $cost     = $totalQty * (float)$ri['cost_per_unit'];
                $db->prepare("UPDATE kitchen_ingredients SET quantity = quantity - ? WHERE id = ?")->execute([$totalQty, $ri['ingredient_id']]);
                $db->prepare("INSERT INTO kitchen_deductions (order_id, menu_item_id, order_item_id, ingredient_id, qty, cost$atCol) VALUES (?,?,?,?,?,?$atVal)")->execute(array_merge([$orderId, $menuItemId, $item['id'], $ri['ingredient_id'], $totalQty, $cost], $atArg));
                $db->prepare("INSERT INTO kitchen_stock_movements (ingredient_id, qty, type, reason, amount, unit_cost, total_cost, done_by$atCol) VALUES (?,?,?,?,?,?,?,?$atVal)")->execute(array_merge([$ri['ingredient_id'], -$totalQty, 'auto_deduction', "Order {$order['order_number']}", $cost, $ri['cost_per_unit'], $cost, $who], $atArg));
            }

            $kitchenItemsForTicket[] = [
                'menu_item_id' => $menuRow['menu_id'] ?? null,
                'product_name' => $item['product_name'],
                'qty'          => (int)$item['qty'],
                'prep_minutes' => $prepMinutes,
            ];
        }

        // Create Kitchen Order ticket if there are kitchen items
        if ($kitchenItemsForTicket) {
            $maxItemPrep = max(array_column($kitchenItemsForTicket, 'prep_minutes'));
            $queueStmt = $db->query("SELECT COALESCE(SUM(estimated_minutes),0) AS load_min FROM kitchen_orders WHERE status IN ('pending','accepted','preparing')");
            $queueLoad = (int)$queueStmt->fetch()['load_min'];
            $estimatedMinutes = $maxItemPrep + (int)round($queueLoad * 0.3);
            if ($estimatedMinutes < 5) $estimatedMinutes = 5;

            $db->prepare("INSERT INTO kitchen_orders (order_id, order_number, table_name, customer_note, status, estimated_minutes$atCol) VALUES (?,?,?,?,?,?$atVal)")
               ->execute(array_merge([$orderId, $order['order_number'], $order['table_name'], $note, 'pending', $estimatedMinutes], $atArg));
            $kitchenOrderId = (int)$db->lastInsertId();

            foreach ($kitchenItemsForTicket as $kit) {
                $db->prepare("INSERT INTO kitchen_order_items (kitchen_order_id, menu_item_id, product_name, qty, prep_minutes$atCol) VALUES (?,?,?,?,?$atVal)")
                   ->execute(array_merge([$kitchenOrderId, $kit['menu_item_id'], $kit['product_name'], $kit['qty'], $kit['prep_minutes']], $atArg));
            }

            $itemSummary = implode(', ', array_map(fn($k)=>"{$k['qty']}× {$k['product_name']}", $kitchenItemsForTicket));
            $db->prepare('INSERT INTO notifications (message, type) VALUES (?,?)')
               ->execute(["New kitchen order #{$order['order_number']} ({$order['table_name']}): $itemSummary — Est. {$estimatedMinutes} min" . ($at ? ' (made offline at ' . substr($at, 0, 16) . ')' : ''), 'info']);
        }

        $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
           ->execute(['ORDER', "Validated order {$order['order_number']} — items routed to Bar/Kitchen" . ($at ? ' (offline, ' . substr($at, 0, 16) . ')' : ''), $who]);

        $db->commit();
        return [['ok' => true], 200];
    } catch (Exception $e) {
        $db->rollBack();
        serverFail($e);
    }
}

// ── PAY ORDER ─────────────────────────────────────────────────
if ($action === 'pay') {
    $body = json_decode(file_get_contents('php://input'), true);
    [$res, $code] = ordPay($db, (int)($body['orderId'] ?? 0), $body ?: [], $sess, ordOfflineAt());
    jsonOut($res, $code);
}

// The cash shift a payment belongs to: online the person's own open shift; offline the shift
// that was open at the time of the payment. A Bartender or Manager with no shift of their own
// still takes payments while someone else's shift is open (the latest one): the money is counted
// in that shift, and the order shows whose shift it was (ordPay, orders get/list, shift report).
// The Owner never lands in someone else's drawer: without a shift of their own, no shift.
function ordShiftAt(PDO $db, int $userId, ?string $at, string $role = ''): ?int {
    if (!$at) {
        $own = currentShiftId();
    } else {
        $st = $db->prepare("SELECT id FROM shifts WHERE user_id = ? AND opened_at <= ? AND (closed_at IS NULL OR closed_at >= ?) ORDER BY id DESC LIMIT 1");
        $st->execute([$userId, $at, $at]);
        $own = $st->fetchColumn();
    }
    if ($own) return (int)$own;
    if (!in_array($role, ['Bartender', 'Manager'], true)) return null;
    if (!$at) {
        $st = $db->query("SELECT id FROM shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1");
    } else {
        $st = $db->prepare("SELECT id FROM shifts WHERE opened_at <= ? AND (closed_at IS NULL OR closed_at >= ?) ORDER BY id DESC LIMIT 1");
        $st->execute([$at, $at]);
    }
    $id = $st->fetchColumn();
    return $id ? (int)$id : null;
}

// Take payment for a validated order. $at = original time of an offline record (null online).
// → [answer, http code]
function ordPay(PDO $db, int $orderId, array $body, array $sess, ?string $at): array {
    $paymentMethod = cleanMethod($body['paymentMethod'] ?? 'Cash');
    $customerPhone = trim($body['customerPhone']  ?? '');
    $extraOff      = round((float)($body['discount'] ?? 0), 2);   // free amount — Owner only
    $discountWhy   = trim($body['discountReason'] ?? '');
    $ruleIds       = array_values(array_filter(array_map('intval', (array)($body['discountRules'] ?? []))));
    if (!$orderId) return [['ok' => false, 'error' => 'orderId required'], 400];

    $oStmt = $db->prepare('SELECT * FROM orders WHERE id = ? LIMIT 1');
    $oStmt->execute([$orderId]);
    $order = $oStmt->fetch();
    if (!$order) return [['ok' => false, 'error' => 'Order not found'], 404];
    // (a paid order goes on: a retry gets the recorded payment back from the locked check below)
    if (!in_array($order['status'], ['validated', 'paid'], true)) return [['ok' => false, 'error' => 'Order must be validated before payment'], 400];
    // Discounts: staff may only apply the Owner's discounts (Settings → Discounts);
    // the amount is worked out here from the order, never taken from the screen.
    require_once __DIR__ . '/discount_lib.php';
    if ($extraOff < 0) return [['ok' => false, 'error' => 'Discount cannot be negative'], 400];
    $ruleOff = 0; $ruleNames = [];
    if ($ruleIds) {
        if (!canApplyDiscounts($db, $sess)) return [['ok' => false, 'error' => 'You are not allowed to apply discounts. Ask the Owner.'], 403];
        [$ruleOff, $ruleNames] = discountFromRules($db, $orderId, $ruleIds);
    }
    if ($extraOff > 0) {
        if ($sess['role'] !== 'Owner') return [['ok' => false, 'error' => 'Only the Owner can give a discount that is not set up in Settings → Discounts'], 403];
        if ($discountWhy === '') return [['ok' => false, 'error' => 'Give a reason for the discount'], 400];
    }
    $discount = round($ruleOff + $extraOff, 2);
    if ($discount > (float)$order['total']) return [['ok' => false, 'error' => 'Discount cannot be more than the order total'], 400];
    $discountWhy = trim(implode(', ', $ruleNames) . ($extraOff > 0 ? (($ruleNames ? '; ' : '') . $discountWhy) : ''));

    $shiftId = ordShiftAt($db, (int)$sess['user_id'], $at, (string)$sess['role']);
    // Bartenders take money only inside an open cash shift: their own, or — when they have none —
    // someone else's that is open (counted there and marked). Offline the money has already been
    // taken: it is recorded, and the Owner is told it had no shift.
    if ($sess['role'] === 'Bartender' && !$shiftId && !$at) {
        return [['ok' => false, 'error' => 'No shift is open. Open your shift first (Open shift, top bar): Bartenders cannot take payments when no shift is open.', 'needShift' => true], 403];
    }
    // whose shift is it? (someone else's: the order, the audit log and the shift report say so)
    $shiftOwner = null;
    if ($shiftId) {
        $so = $db->prepare('SELECT user_id, user_name FROM shifts WHERE id = ?');
        $so->execute([$shiftId]);
        $sr = $so->fetch();
        if ($sr && (int)$sr['user_id'] !== (int)$sess['user_id']) $shiftOwner = $sr['user_name'];
    }

    // Food must be served before payment and receipt. Offline the kitchen screen could not be
    // reached, so staff confirmed it themselves: the ticket is closed as served at payment.
    $kStmt = $db->prepare("SELECT id, status, reject_reason FROM kitchen_orders WHERE order_id = ? AND status <> 'served' ORDER BY id DESC LIMIT 1");
    $kStmt->execute([$orderId]);
    $kitchen = $kStmt->fetch();
    if ($kitchen) {
        if ($kitchen['status'] === 'rejected') {
            return [['ok' => false, 'error' => 'The kitchen rejected the food on this order (' . ($kitchen['reject_reason'] ?: 'no reason') . '). Void this order and create a new one without that food.'], 409];
        }
        if (!$at) return [['ok' => false, 'error' => 'The kitchen has not served this order yet (status: ' . $kitchen['status'] . '). Payment and receipt are available once the food is served.'], 409];
    }

    $db->beginTransaction();
    try {
        // Lock the order: a retry after a timeout returns the payment already recorded
        // instead of paying (and auditing) the order a second time.
        $lk = $db->prepare('SELECT status, payment_method, discount, discount_reason, total FROM orders WHERE id = ? FOR UPDATE');
        $lk->execute([$orderId]);
        $now = $lk->fetch();
        if ($now['status'] === 'paid') {
            $db->rollBack();
            return [['ok' => true, 'alreadyDone' => true, 'orderId' => $orderId, 'orderNumber' => $order['order_number'], 'discount' => (float)$now['discount'],
                     'discountReason' => (string)$now['discount_reason'], 'paid' => (float)$now['total'] - (float)$now['discount'], 'paymentMethod' => $now['payment_method']], 200];
        }
        if ($now['status'] !== 'validated') { $db->rollBack(); return [['ok' => false, 'error' => 'Order must be validated before payment'], 400]; }

        if ($kitchen && $at) {
            $db->prepare("UPDATE kitchen_orders SET status = 'served', served_at = ? WHERE order_id = ? AND status NOT IN ('served','rejected')")->execute([$at, $orderId]);
        }

        // Close order
        $db->prepare('UPDATE orders SET status = "paid", payment_method = ?, customer_phone = ?, paid_by = ?, paid_at = ' . ($at ? '?' : 'NOW()') . ', shift_id = ?, discount = ?, discount_reason = ?, discount_rules = ? WHERE id = ? AND status = "validated"')
           ->execute(array_merge([$paymentMethod, $customerPhone, $sess['full_name']], $at ? [$at] : [], [$shiftId, $discount, $discount > 0 ? $discountWhy : null, $ruleIds ? implode(',', $ruleIds) : null, $orderId]));

        // Free the table immediately
        if ((int)$order['table_id'] > 0) {
            $db->prepare('UPDATE tables SET status = "free" WHERE id = ?')->execute([$order['table_id']]);
        }

        $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
           ->execute(['PAYMENT', "Paid order {$order['order_number']} — " . ((float)$order['total'] - $discount) . " RWF via $paymentMethod" . ($discount > 0 ? " (discount RWF $discount: $discountWhy)" : '')
                      . ($at ? ' (offline, ' . substr($at, 0, 16) . ($shiftId ? '' : ', no open shift') . ')' : '')
                      . ($shiftOwner ? " — counted in $shiftOwner's shift" : ''), $sess['full_name']]);
        if ($at && $sess['role'] === 'Bartender' && !$shiftId) {
            $db->prepare('INSERT INTO notifications (message, type) VALUES (?,?)')
               ->execute(["{$sess['full_name']} took payment for {$order['order_number']} offline without an open shift (" . substr($at, 0, 16) . '). It is not in any cash count.', 'warning']);
        }

        $db->commit();
        return [['ok' => true, 'orderId' => $orderId, 'orderNumber' => $order['order_number'], 'discount' => $discount, 'discountReason' => $discount > 0 ? $discountWhy : '', 'paid' => (float)$order['total'] - $discount, 'inShiftOf' => $shiftOwner], 200];
    } catch (Exception $e) {
        $db->rollBack();
        serverFail($e);
    }
}

// ── REFUND (paid orders) ──────────────────────────────────────
//  refund         — done at once: Owner, or a Manager the Owner allowed (canGiveRefunds)
//  refund_request — anyone else: saved as a request the Owner approves in Void Requests
if ($action === 'refund' || $action === 'refund_request') {
    require_once __DIR__ . '/refund_lib.php';
    if ($action === 'refund') requirePerm('canGiveRefunds');
    else requireRole(['Owner', 'Manager', 'Bartender']);

    $body    = json_decode(file_get_contents('php://input'), true) ?? [];
    $orderId = (int)($body['orderId'] ?? 0);
    $reason  = trim($body['reason'] ?? '');
    $method  = trim($body['method'] ?? 'Cash');
    $lines   = is_array($body['items'] ?? null) ? $body['items'] : [];
    if (!$orderId || !$lines) jsonOut(['ok' => false, 'error' => 'Choose the items to refund'], 400);
    if ($reason === '') jsonOut(['ok' => false, 'error' => 'A reason is required for every refund'], 400);
    if (!in_array($method, REFUND_METHODS, true)) $method = 'Other';

    if ($action === 'refund_request') {
        try {
            $plan = planRefund($db, $orderId, $lines);
        } catch (RuntimeException $e) {
            jsonOut(['ok' => false, 'error' => $e->getMessage()], 400);
        }
        $dup = $db->prepare("SELECT id FROM void_requests WHERE type = 'refund' AND ref_id = ? AND status = 'Pending' LIMIT 1");
        $dup->execute([$orderId]);
        if ($dup->fetch()) jsonOut(['ok' => false, 'error' => 'A refund request for this order is already waiting for the Owner'], 409);
        $details = json_encode([
            'method' => $method,
            'items'  => array_map(fn($p) => ['orderItemId' => (int)$p['item']['id'], 'qty' => $p['qty'], 'restock' => $p['restock']], $plan['lines']),
        ]);
        $label = "Refund {$plan['order']['order_number']}: " . describeRefundPlan($plan);
        $db->prepare('INSERT INTO void_requests (type, ref_id, label, amount, reason, requested_by, details) VALUES (?,?,?,?,?,?,?)')
           ->execute(['refund', $orderId, mb_substr($label, 0, 250), $plan['amount'], $reason, $sess['full_name'], $details]);
        try {
            $db->prepare('INSERT INTO notifications (message, type) VALUES (?,?)')
               ->execute([mb_substr("Refund request from {$sess['full_name']}: {$plan['order']['order_number']} (RWF " . number_format($plan['amount']) . ") — open Requests to approve or reject", 0, 255), 'warning']);
        } catch (Exception $e) {}
        jsonOut(['ok' => true, 'requested' => true, 'amount' => $plan['amount']]);
    }

    $db->beginTransaction();
    try {
        $plan = planRefund($db, $orderId, $lines, true);
        [$refundId, $amount] = performRefund($db, $plan, $reason, $method, $sess['full_name'], $effectiveDate);
        $db->commit();
        jsonOut(['ok' => true, 'refundId' => $refundId, 'amount' => $amount]);
    } catch (RuntimeException $e) {
        $db->rollBack();
        jsonOut(['ok' => false, 'error' => $e->getMessage()], 400);
    } catch (Exception $e) {
        $db->rollBack();
        serverFail($e, 'The refund');
    }
}


// ── BAR SALES ─────────────────────────────────────────────────
if ($action === 'bar_sales') {
    $filter = $_GET['filter'] ?? 'today';
    $date   = $_GET['date']   ?? '';

    switch ($filter) {
        case 'week':  $where = 'WHERE bs.sale_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)'; break;
        case 'month': $where = "WHERE bs.sale_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')"; break;
        case 'date':  $where = $date ? "WHERE bs.sale_date = " . $db->quote($date) : 'WHERE bs.sale_date = CURDATE()'; break;
        default:      $where = 'WHERE bs.sale_date = CURDATE()'; break;
    }

    $stmt = $db->query("
        SELECT bs.id, bs.order_id, bs.product_name, bs.qty, bs.unit_price, bs.total,
               bs.sold_by, bs.order_number, bs.sale_date, bs.sale_time
        FROM bar_sales bs
        $where
        ORDER BY bs.id DESC
    ");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['order_id']   = (int)$r['order_id'];
        $r['qty']        = (int)$r['qty'];
        $r['unit_price'] = (float)$r['unit_price'];
        $r['total']      = (float)$r['total'];
        $r['date']       = $r['sale_date'] . ' ' . substr($r['sale_time'], 0, 5);
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

// ── SEND SMS ──────────────────────────────────────────────────
if ($action === 'send_sms') {
    $body    = json_decode(file_get_contents('php://input'), true);
    $orderId = (int)($body['orderId'] ?? 0);
    $phone   = trim($body['phone']    ?? '');
    if (!$phone) jsonOut(['ok' => false, 'error' => 'Phone number required'], 400);
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['SMS', "SMS receipt requested to $phone for order #$orderId", $sess['full_name']]);
    jsonOut(['ok' => true, 'message' => 'SMS integration pending']);
}


// ── LIST OPEN ORDERS ──────────────────────────────
if ($action === 'list') {
    $status = $_GET['status'] ?? 'open'; // open = draft + validated
    $db     = getDB();

    if ($status === 'open') {
        $stmt = $db->query("
            SELECT o.*,
                   COUNT(oi.id) AS item_count
            FROM orders o
            LEFT JOIN order_items oi ON oi.order_id = o.id
            WHERE o.status IN ('draft','validated')
            GROUP BY o.id
            ORDER BY o.created_at DESC
        ");
    } elseif ($status === 'paid') {
        $stmt = $db->query("
            SELECT o.*,
                   (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
                   (SELECT COALESCE(SUM(r.amount),0) FROM order_refunds r WHERE r.order_id = o.id) AS refunded_total,
                   (SELECT s.user_name FROM shifts s WHERE s.id = o.shift_id) AS shift_user
            FROM orders o
            WHERE o.status = 'paid' AND o.voided = 0
            ORDER BY o.paid_at DESC
            LIMIT 100
        ");
    } else {
        $stmt = $db->query("
            SELECT o.*,
                   COUNT(oi.id) AS item_count
            FROM orders o
            LEFT JOIN order_items oi ON oi.order_id = o.id
            GROUP BY o.id
            ORDER BY o.created_at DESC
            LIMIT 100
        ");
    }

    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']          = (int)$r['id'];
        $r['total']       = (float)$r['total'];
        $r['itemCount']   = (int)$r['item_count'];
        $r['orderNumber'] = $r['order_number'];
        $r['tableName']   = $r['table_name'];
        $r['createdBy']   = $r['created_by'];
        $r['createdAt']   = $r['created_at'];
        $r['paidAt']      = $r['paid_at'];
        $r['refundedTotal'] = (float)($r['refunded_total'] ?? 0);
        // paid in someone else's cash shift
        $r['shiftOwner'] = (!empty($r['shift_user']) && $r['shift_user'] !== ($r['paid_by'] ?? null)) ? $r['shift_user'] : null;
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
