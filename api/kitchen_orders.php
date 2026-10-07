<?php
// ============================================================
//  api/kitchen_orders.php — Smart Kitchen Production Queue
//  GET  action=queue               → active kitchen orders for Kitchen dashboard
//  GET  action=ready_list          → orders marked Ready (for bartenders/waiters)
//  GET  action=check_stock         → ingredient availability check for an order
//  GET  action=order_status        → kitchen status/countdown for a given orderId (bartender view)
//  POST action=accept              { kitchenOrderId, estimatedMinutes? }
//  POST action=reject              { kitchenOrderId, reason }
//  POST action=start_preparing     { kitchenOrderId }
//  POST action=mark_ready          { kitchenOrderId }
//  POST action=mark_served         { kitchenOrderId }
//  GET  action=performance         → kitchen performance metrics
// ============================================================
require_once __DIR__ . '/../config/db.php';

// every write needs the security token (blocks requests forged by other websites)
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') requireCsrf();
// (InfinityFree's reverse proxy causes session ID mismatches between page load and API calls,
//  which broke CSRF validation the same way it did in misc.php — see that fix for full context)
$action = $_REQUEST['action'] ?? '';
$sess   = requireAuth();
$db     = getDB();

// ── QUEUE: All active kitchen orders ──────────────────────────
if ($action === 'queue') {
    $stmt = $db->query("
        SELECT ko.*
        FROM kitchen_orders ko
        WHERE ko.status IN ('pending','accepted','preparing')
        ORDER BY ko.created_at ASC
    ");
    $orders = $stmt->fetchAll();

    $now = time();
    $queuePosition = 0;
    foreach ($orders as &$o) {
        $o['id']                = (int)$o['id'];
        $o['order_id']          = (int)$o['order_id'];
        $o['estimated_minutes'] = (int)$o['estimated_minutes'];
        $createdTs               = strtotime($o['created_at']);
        $elapsedMin               = (int)round(($now - $createdTs) / 60);
        $o['elapsed_minutes']    = $elapsedMin;
        $o['remaining_minutes']  = max(0, $o['estimated_minutes'] - $elapsedMin);
        $o['is_delayed']         = $elapsedMin > $o['estimated_minutes'];
        $o['queue_position']     = ++$queuePosition;

        $iStmt = $db->prepare('SELECT * FROM kitchen_order_items WHERE kitchen_order_id = ?');
        $iStmt->execute([$o['id']]);
        $o['items'] = $iStmt->fetchAll();
        foreach ($o['items'] as &$it) { $it['id']=(int)$it['id']; $it['qty']=(int)$it['qty']; $it['prep_minutes']=(int)$it['prep_minutes']; }
        unset($it);
    }
    unset($o);

    jsonOut(['ok' => true, 'data' => $orders]);
}

// ── READY LIST: For bartenders/waiters to see what's ready to collect ──
if ($action === 'ready_list') {
    $stmt = $db->query("
        SELECT ko.*
        FROM kitchen_orders ko
        WHERE ko.status = 'ready'
        ORDER BY ko.ready_at ASC
    ");
    $orders = $stmt->fetchAll();
    foreach ($orders as &$o) {
        $o['id'] = (int)$o['id'];
        $o['order_id'] = (int)$o['order_id'];
        $iStmt = $db->prepare('SELECT * FROM kitchen_order_items WHERE kitchen_order_id = ?');
        $iStmt->execute([$o['id']]);
        $o['items'] = $iStmt->fetchAll();
    }
    unset($o);
    jsonOut(['ok' => true, 'data' => $orders]);
}

// ── CHECK STOCK: Ingredient availability for a kitchen order ─────
if ($action === 'check_stock') {
    $kitchenOrderId = (int)($_GET['kitchenOrderId'] ?? 0);
    if (!$kitchenOrderId) jsonOut(['ok' => false, 'error' => 'kitchenOrderId required'], 400);

    $iStmt = $db->prepare('SELECT * FROM kitchen_order_items WHERE kitchen_order_id = ?');
    $iStmt->execute([$kitchenOrderId]);
    $items = $iStmt->fetchAll();

    $status = 'can_prepare'; // can_prepare | limited_stock | cannot_prepare
    $details = [];

    foreach ($items as $item) {
        if (!$item['menu_item_id']) continue;
        $rStmt = $db->prepare('SELECT recipe_id FROM kitchen_menu WHERE id = ? LIMIT 1');
        $rStmt->execute([$item['menu_item_id']]);
        $menuRow = $rStmt->fetch();
        if (!$menuRow || !$menuRow['recipe_id']) continue;

        $riStmt = $db->prepare('SELECT ri.qty, ki.name, ki.quantity AS available, ki.min_stock FROM recipe_ingredients ri JOIN kitchen_ingredients ki ON ki.id = ri.ingredient_id WHERE ri.recipe_id = ?');
        $riStmt->execute([$menuRow['recipe_id']]);
        $ings = $riStmt->fetchAll();

        foreach ($ings as $ing) {
            $needed = (float)$ing['qty'] * (int)$item['qty'];
            $available = (float)$ing['available'];
            if ($available < $needed) {
                $status = 'cannot_prepare';
                $details[] = "{$ing['name']}: need {$needed}, have {$available}";
            } elseif ($available - $needed < (float)$ing['min_stock'] && $status !== 'cannot_prepare') {
                $status = 'limited_stock';
                $details[] = "{$ing['name']}: will be low after this order";
            }
        }
    }

    jsonOut(['ok' => true, 'status' => $status, 'details' => $details]);
}

// ── ORDER STATUS (for bartender/owner view, lookup by orderId) ───
if ($action === 'order_status') {
    $orderId = (int)($_GET['orderId'] ?? 0);
    if (!$orderId) jsonOut(['ok' => false, 'error' => 'orderId required'], 400);

    $stmt = $db->prepare("SELECT * FROM kitchen_orders WHERE order_id = ? ORDER BY id DESC LIMIT 1");
    $stmt->execute([$orderId]);
    $ko = $stmt->fetch();

    if (!$ko) jsonOut(['ok' => true, 'hasKitchenOrder' => false]);

    $createdTs        = strtotime($ko['created_at']);
    $elapsedMin        = (int)round((time() - $createdTs) / 60);
    $estimatedMinutes = (int)$ko['estimated_minutes'];
    $remainingMinutes = max(0, $estimatedMinutes - $elapsedMin);
    $isDelayed         = $elapsedMin > $estimatedMinutes;

    jsonOut(['ok' => true, 'hasKitchenOrder' => true, 'data' => [
        'id'                => (int)$ko['id'],
        'status'            => $ko['status'],
        'estimatedMinutes'  => $estimatedMinutes,
        'elapsedMinutes'    => $elapsedMin,
        'remainingMinutes'  => $remainingMinutes,
        'isDelayed'         => $isDelayed,
    ]]);
}

// ── ACCEPT ORDER ───────────────────────────────────────────────
if ($action === 'accept') {
    requireRole(['Owner', 'Manager', 'Kitchen']);
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['kitchenOrderId'] ?? 0);
    $estimatedMinutes = isset($body['estimatedMinutes']) ? (int)$body['estimatedMinutes'] : null;
    if (!$id) jsonOut(['ok' => false, 'error' => 'kitchenOrderId required'], 400);

    $stmt = $db->prepare("SELECT * FROM kitchen_orders WHERE id = ? LIMIT 1");
    $stmt->execute([$id]);
    $ko = $stmt->fetch();
    if (!$ko) jsonOut(['ok' => false, 'error' => 'Kitchen order not found'], 404);
    if ($ko['status'] !== 'pending') jsonOut(['ok' => false, 'error' => 'Order already processed'], 400);

    if ($estimatedMinutes !== null && $estimatedMinutes > 0) {
        $db->prepare("UPDATE kitchen_orders SET status='accepted', accepted_at=NOW(), accepted_by=?, estimated_minutes=? WHERE id=?")
           ->execute([$sess['full_name'], $estimatedMinutes, $id]);
    } else {
        $db->prepare("UPDATE kitchen_orders SET status='accepted', accepted_at=NOW(), accepted_by=? WHERE id=?")
           ->execute([$sess['full_name'], $id]);
    }

    $db->prepare('INSERT INTO notifications (message, type) VALUES (?,?)')
       ->execute(["Kitchen accepted order #{$ko['order_number']}", 'success']);

    jsonOut(['ok' => true]);
}

// ── REJECT ORDER ───────────────────────────────────────────────
if ($action === 'reject') {
    requireRole(['Owner', 'Manager', 'Kitchen']);
    $body   = json_decode(file_get_contents('php://input'), true);
    $id     = (int)($body['kitchenOrderId'] ?? 0);
    $reason = trim($body['reason'] ?? 'Other');
    if (!$id) jsonOut(['ok' => false, 'error' => 'kitchenOrderId required'], 400);

    $stmt = $db->prepare("SELECT * FROM kitchen_orders WHERE id = ? LIMIT 1");
    $stmt->execute([$id]);
    $ko = $stmt->fetch();
    if (!$ko) jsonOut(['ok' => false, 'error' => 'Kitchen order not found'], 404);

    $db->prepare("UPDATE kitchen_orders SET status='rejected', reject_reason=? WHERE id=?")
       ->execute([$reason, $id]);

    $db->prepare('INSERT INTO notifications (message, type) VALUES (?,?)')
       ->execute(["Kitchen rejected order #{$ko['order_number']}: $reason", 'error']);

    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['KITCHEN', "Rejected kitchen order #{$ko['order_number']}: $reason", $sess['full_name']]);

    jsonOut(['ok' => true]);
}

// ── START PREPARING ────────────────────────────────────────────
if ($action === 'start_preparing') {
    requireRole(['Owner', 'Manager', 'Kitchen']);
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['kitchenOrderId'] ?? 0);
    if (!$id) jsonOut(['ok' => false, 'error' => 'kitchenOrderId required'], 400);

    $stmt = $db->prepare("SELECT * FROM kitchen_orders WHERE id = ? LIMIT 1");
    $stmt->execute([$id]);
    $ko = $stmt->fetch();
    if (!$ko) jsonOut(['ok' => false, 'error' => 'Kitchen order not found'], 404);

    $db->prepare("UPDATE kitchen_orders SET status='preparing', preparing_at=NOW() WHERE id=?")->execute([$id]);

    jsonOut(['ok' => true]);
}

// ── MARK READY ──────────────────────────────────────────────────
if ($action === 'mark_ready') {
    requireRole(['Owner', 'Manager', 'Kitchen']);
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['kitchenOrderId'] ?? 0);
    if (!$id) jsonOut(['ok' => false, 'error' => 'kitchenOrderId required'], 400);

    $stmt = $db->prepare("SELECT * FROM kitchen_orders WHERE id = ? LIMIT 1");
    $stmt->execute([$id]);
    $ko = $stmt->fetch();
    if (!$ko) jsonOut(['ok' => false, 'error' => 'Kitchen order not found'], 404);

    $db->prepare("UPDATE kitchen_orders SET status='ready', ready_at=NOW() WHERE id=?")->execute([$id]);

    // Record prep history for learning-based estimates
    if ($ko['preparing_at']) {
        $actualMin = (strtotime('now') - strtotime($ko['preparing_at'])) / 60;
        $iStmt = $db->prepare('SELECT * FROM kitchen_order_items WHERE kitchen_order_id = ?');
        $iStmt->execute([$id]);
        foreach ($iStmt->fetchAll() as $item) {
            if (!$item['menu_item_id']) continue;
            $db->prepare('INSERT INTO kitchen_prep_history (menu_item_id, product_name, actual_minutes) VALUES (?,?,?)')
               ->execute([$item['menu_item_id'], $item['product_name'], round($actualMin, 2)]);
        }
    }

    $db->prepare('INSERT INTO notifications (message, type) VALUES (?,?)')
       ->execute(["Order #{$ko['order_number']} is READY for pickup ({$ko['table_name']})", 'success']);

    jsonOut(['ok' => true]);
}

// ── MARK SERVED ────────────────────────────────────────────────
if ($action === 'mark_served') {
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['kitchenOrderId'] ?? 0);
    if (!$id) jsonOut(['ok' => false, 'error' => 'kitchenOrderId required'], 400);

    $db->prepare("UPDATE kitchen_orders SET status='served', served_at=NOW(), served_by=? WHERE id=?")
       ->execute([$sess['full_name'], $id]);

    jsonOut(['ok' => true]);
}

// ── KITCHEN PERFORMANCE METRICS ───────────────────────────────
if ($action === 'performance') {
    $today = date('Y-m-d');

    $completedStmt = $db->prepare("SELECT COUNT(*) AS cnt FROM kitchen_orders WHERE status IN ('ready','served') AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)");
    $completedStmt->execute([$today, $today]);
    $completedToday = (int)$completedStmt->fetch()['cnt'];

    $avgPrepStmt = $db->query("SELECT AVG(actual_minutes) AS avg_min FROM kitchen_prep_history WHERE created_at >= CURDATE() AND created_at < CURDATE() + INTERVAL 1 DAY");
    $avgPrepToday = (float)($avgPrepStmt->fetch()['avg_min'] ?? 0);

    $avgWaitStmt = $db->query("SELECT AVG(TIMESTAMPDIFF(MINUTE, created_at, accepted_at)) AS avg_wait FROM kitchen_orders WHERE accepted_at IS NOT NULL AND created_at >= CURDATE() AND created_at < CURDATE() + INTERVAL 1 DAY");
    $avgWaitToday = (float)($avgWaitStmt->fetch()['avg_wait'] ?? 0);

    $workloadStmt = $db->query("SELECT COUNT(*) AS cnt FROM kitchen_orders WHERE status IN ('pending','accepted','preparing')");
    $currentWorkload = (int)$workloadStmt->fetch()['cnt'];

    $mostOrderedStmt = $db->query("
        SELECT product_name, COUNT(*) AS cnt
        FROM kitchen_order_items koi
        JOIN kitchen_orders ko ON ko.id = koi.kitchen_order_id
        WHERE ko.created_at >= CURDATE() AND ko.created_at < CURDATE() + INTERVAL 1 DAY
        GROUP BY product_name ORDER BY cnt DESC LIMIT 5
    ");
    $mostOrdered = $mostOrderedStmt->fetchAll();

    $slowestStmt = $db->query("
        SELECT product_name, AVG(actual_minutes) AS avg_min
        FROM kitchen_prep_history
        WHERE created_at >= CURDATE() - INTERVAL 90 DAY
        GROUP BY product_name ORDER BY avg_min DESC LIMIT 3
    ");
    $slowest = $slowestStmt->fetchAll();

    $fastestStmt = $db->query("
        SELECT product_name, AVG(actual_minutes) AS avg_min
        FROM kitchen_prep_history
        WHERE created_at >= CURDATE() - INTERVAL 90 DAY
        GROUP BY product_name ORDER BY avg_min ASC LIMIT 3
    ");
    $fastest = $fastestStmt->fetchAll();

    $delayedStmt = $db->query("
        SELECT COUNT(*) AS cnt FROM kitchen_orders
        WHERE status IN ('pending','accepted','preparing')
          AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) > estimated_minutes
    ");
    $delayedCount = (int)$delayedStmt->fetch()['cnt'];

    jsonOut(['ok' => true, 'data' => [
        'completedToday'   => $completedToday,
        'avgPrepMinutes'   => round($avgPrepToday, 1),
        'avgWaitMinutes'   => round($avgWaitToday, 1),
        'currentWorkload'  => $currentWorkload,
        'delayedCount'     => $delayedCount,
        'mostOrdered'      => $mostOrdered,
        'slowest'          => $slowest,
        'fastest'          => $fastest,
    ]]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
