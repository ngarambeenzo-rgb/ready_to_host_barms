<?php
require_once __DIR__ . '/../config/db.php';
if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();
requireAuth();
$db = getDB();
$action = $_REQUEST['action'] ?? 'list';

if ($action === 'list') {
    $status = $_GET['status'] ?? '';
    // Use parameterized query to prevent SQL injection
    if ($status) {
        $stmt = $db->prepare("
            SELECT s.*, c.business_name AS client_name, sp.name AS plan_name
            FROM ims_subscriptions s
            JOIN ims_clients c ON c.id = s.client_id
            LEFT JOIN ims_subscription_plans sp ON sp.id = s.plan_id
            WHERE s.status = ?
            ORDER BY s.expiry_date ASC
        ");
        $stmt->execute([$status]);
    } else {
        $stmt = $db->query("
            SELECT s.*, c.business_name AS client_name, sp.name AS plan_name
            FROM ims_subscriptions s
            JOIN ims_clients c ON c.id = s.client_id
            LEFT JOIN ims_subscription_plans sp ON sp.id = s.plan_id
            ORDER BY s.expiry_date ASC
        ");
    }
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']         = (int)$r['id'];
        $r['clientId']   = (int)$r['client_id'];
        $r['maxDevices'] = (int)$r['max_devices'];
        $r['clientName'] = $r['client_name'];
        $r['planName']   = $r['plan_name'];
        $r['startDate']  = $r['start_date'];
        $r['expiryDate'] = $r['expiry_date'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

if ($action === 'plans') {
    $stmt = $db->query("
        SELECT sp.*, COUNT(s.id) AS client_count
        FROM ims_subscription_plans sp
        LEFT JOIN ims_subscriptions s ON s.plan_id = sp.id
        GROUP BY sp.id ORDER BY sp.duration_days ASC
    ");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']           = (int)$r['id'];
        $r['durationDays'] = (int)$r['duration_days'];
        $r['priceRwf']     = (float)$r['price_rwf'];
        $r['clientCount']  = (int)$r['client_count'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

if ($action === 'add_plan') {
    $body = json_decode(file_get_contents('php://input'), true);
    $name = trim($body['name'] ?? '');
    $days = (int)($body['durationDays'] ?? 0);
    $price= (float)($body['priceRwf'] ?? 0);
    if (!$name || !$days) jsonOut(['ok' => false, 'error' => 'Name and duration required'], 400);
    $db->prepare('INSERT INTO ims_subscription_plans (name, duration_days, price_rwf) VALUES (?,?,?)')
       ->execute([$name, $days, $price]);
    auditLog('PLAN_ADD', "Added plan: $name ($days days)");
    jsonOut(['ok' => true, 'id' => (int)$db->lastInsertId()]);
}

if ($action === 'edit_plan') {
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    $db->prepare('UPDATE ims_subscription_plans SET name=?, duration_days=?, price_rwf=? WHERE id=?')
       ->execute([$body['name'] ?? '', (int)($body['durationDays'] ?? 30), (float)($body['priceRwf'] ?? 0), $id]);
    auditLog('PLAN_EDIT', "Edited plan ID: $id");
    jsonOut(['ok' => true]);
}

if ($action === 'delete_plan') {
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    // Check if plan is in use
    $check = $db->prepare('SELECT COUNT(*) AS cnt FROM ims_subscriptions WHERE plan_id=?');
    $check->execute([$id]);
    if ($check->fetch()['cnt'] > 0) {
        jsonOut(['ok' => false, 'error' => 'Cannot delete — plan is in use by active subscriptions'], 400);
    }
    $db->prepare('DELETE FROM ims_subscription_plans WHERE id=?')->execute([$id]);
    auditLog('PLAN_DELETE', "Deleted plan ID: $id");
    jsonOut(['ok' => true]);
}

if ($action === 'edit') {
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    $db->prepare('UPDATE ims_subscriptions SET plan_id=?, max_devices=?, expiry_date=? WHERE id=?')
       ->execute([(int)($body['planId'] ?? 0), (int)($body['maxDevices'] ?? 1), $body['expiryDate'] ?? '', $id]);
    auditLog('SUB_EDITED', "Subscription ID $id edited");
    jsonOut(['ok' => true]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);

// ── AUTO LICENSE on subscription edit ────────────────────────
// Called internally after subscription changes
function autoReissueLicenses($clientId, $planId, $maxDevices) {
    if (!$clientId || !file_exists(IMS_KEYS_DIR . 'private.pem') || !extension_loaded('openssl')) return 0;
    require_once __DIR__ . '/licenses.php';
    global $db;
    $devStmt = $db->prepare("SELECT * FROM ims_devices WHERE client_id=? AND status='approved'");
    $devStmt->execute([$clientId]);
    $devices = $devStmt->fetchAll();
    $count = 0;
    foreach ($devices as $device) {
        if (_generateLicense($clientId, $device['id'], $planId, $maxDevices, 24)) $count++;
    }
    return $count;
}
