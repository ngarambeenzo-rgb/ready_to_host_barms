<?php
// BarMS Pro — api/activate.php
header('Content-Type: application/json');
error_reporting(0);
ini_set('display_errors', 0);

// Start session safely
if (session_status() === PHP_SESSION_NONE) {
    @session_start();
}

// Load DB
require_once __DIR__ . '/../config/db.php';

$action = $_REQUEST['action'] ?? $_GET['action'] ?? '';
$body   = json_decode(file_get_contents('php://input'), true) ?? [];

try {
    $db = getDB();
} catch (Exception $e) {
    echo json_encode(['ok'=>false,'error'=>'DB connection failed']);
    exit;
}

// ── ACTIVATE WITH KEY ──────────────────────────────────────
if ($action === 'activate_with_key') {
    $activationKey = strtoupper(trim($body['activationKey'] ?? ''));
    $deviceUuid    = trim($body['deviceUuid']   ?? '');
    $deviceName    = trim($body['deviceName']   ?? 'Unknown');
    $deviceType    = trim($body['deviceType']   ?? 'Desktop');

    if (!$activationKey || !$deviceUuid) {
        echo json_encode(['ok'=>false,'error'=>'Activation key and device ID required']);
        exit;
    }

    // Find client
    $stmt = $db->prepare('SELECT * FROM ims_clients WHERE activation_key = ? LIMIT 1');
    $stmt->execute([$activationKey]);
    $client = $stmt->fetch();

    if (!$client) {
        echo json_encode(['ok'=>false,'error'=>'Invalid activation key. Check the key and try again.']);
        exit;
    }
    if ($client['status'] === 'suspended') {
        echo json_encode(['ok'=>false,'error'=>'Account suspended. Contact IMS Company.']);
        exit;
    }

    $clientId = (int)$client['id'];

    // Find active subscription
    $stmt = $db->prepare('SELECT s.*, sp.name AS plan_name FROM ims_subscriptions s JOIN ims_subscription_plans sp ON sp.id = s.plan_id WHERE s.client_id = ? AND s.status = ? ORDER BY s.expiry_date DESC LIMIT 1');
    $stmt->execute([$clientId, 'active']);
    $sub = $stmt->fetch();

    if (!$sub) {
        echo json_encode(['ok'=>false,'error'=>'No active subscription. Contact IMS Company.']);
        exit;
    }
    if (strtotime($sub['expiry_date']) < time()) {
        echo json_encode(['ok'=>false,'error'=>'Subscription expired. Contact IMS Company to renew.']);
        exit;
    }

    $maxDevices = (int)($sub['max_devices'] ?? 2);

    // Register device
    $stmt = $db->prepare('SELECT * FROM ims_devices WHERE client_id=? AND device_uuid=? LIMIT 1');
    $stmt->execute([$clientId, $deviceUuid]);
    $device = $stmt->fetch();

    if (!$device) {
        $cnt = $db->prepare('SELECT COUNT(*) AS c FROM ims_devices WHERE client_id=? AND status=?');
        $cnt->execute([$clientId, 'approved']);
        $count = (int)$cnt->fetch()['c'];
        if ($count >= $maxDevices) {
            echo json_encode(['ok'=>false,'error'=>'Max devices reached. Contact IMS Company.']);
            exit;
        }
        $db->prepare('INSERT INTO ims_devices (client_id, device_uuid, device_name, device_type, status) VALUES (?,?,?,?,?)')
           ->execute([$clientId, $deviceUuid, $deviceName, $deviceType, 'approved']);
        $deviceId = (int)$db->lastInsertId();
    } else {
        $deviceId = (int)$device['id'];
        if ($device['status'] === 'blocked') {
            echo json_encode(['ok'=>false,'error'=>'Device blocked. Contact IMS Company.']);
            exit;
        }
        $db->prepare('UPDATE ims_devices SET last_sync=NOW() WHERE id=?')->execute([$deviceId]);
    }

    // Generate token
    $now             = time();
    $subscriptionEnd = strtotime($sub['expiry_date']);
    $expiresAt       = $now + 86400;

    $payload = [
        'clientId'        => $clientId,
        'deviceId'        => $deviceId,
        'barName'         => $client['business_name'],
        'plan'            => $sub['plan_name'],
        'subscriptionEnd' => $subscriptionEnd,
        'expiresAt'       => $expiresAt,
        'issuedAt'        => $now,
    ];

    $h     = rtrim(strtr(base64_encode(json_encode(['alg'=>'none','typ'=>'JWT'])), '+/', '-_'), '=');
    $p     = rtrim(strtr(base64_encode(json_encode($payload)), '+/', '-_'), '=');
    $token = $h . '.' . $p . '.';

    $daysLeft = max(0, (int)(($subscriptionEnd - $now) / 86400));

    echo json_encode([
        'ok'       => true,
        'token'    => $token,
        'clientId' => $clientId,
        'barName'  => $client['business_name'],
        'plan'     => $sub['plan_name'],
        'daysLeft' => $daysLeft,
    ]);
    exit;
}

// ── RENEW ──────────────────────────────────────────────────
if ($action === 'renew') {
    $clientId   = (int)($body['clientId']    ?? 0);
    $deviceUuid = trim($body['deviceUuid']   ?? '');

    if (!$clientId || !$deviceUuid) {
        echo json_encode(['ok'=>false,'error'=>'clientId and deviceUuid required']);
        exit;
    }

    $stmt = $db->prepare('SELECT * FROM ims_clients WHERE id = ? LIMIT 1');
    $stmt->execute([$clientId]);
    $client = $stmt->fetch();

    if (!$client || $client['status'] === 'suspended') {
        echo json_encode(['ok'=>false,'lockNow'=>true,'error'=>'client_suspended']);
        exit;
    }

    $stmt = $db->prepare('SELECT * FROM ims_devices WHERE client_id=? AND device_uuid=? LIMIT 1');
    $stmt->execute([$clientId, $deviceUuid]);
    $device = $stmt->fetch();

    if (!$device || $device['status'] === 'blocked') {
        echo json_encode(['ok'=>false,'lockNow'=>true,'error'=>'device_blocked']);
        exit;
    }

    $stmt = $db->prepare('SELECT s.*, sp.name AS plan_name FROM ims_subscriptions s JOIN ims_subscription_plans sp ON sp.id = s.plan_id WHERE s.client_id = ? AND s.status = ? ORDER BY s.expiry_date DESC LIMIT 1');
    $stmt->execute([$clientId, 'active']);
    $sub = $stmt->fetch();

    if (!$sub || strtotime($sub['expiry_date']) < time()) {
        echo json_encode(['ok'=>false,'lockNow'=>true,'error'=>'subscription_expired']);
        exit;
    }

    $now             = time();
    $subscriptionEnd = strtotime($sub['expiry_date']);
    $expiresAt       = $now + 86400;

    $payload = [
        'clientId'        => $clientId,
        'deviceId'        => (int)$device['id'],
        'barName'         => $client['business_name'],
        'plan'            => $sub['plan_name'],
        'subscriptionEnd' => $subscriptionEnd,
        'expiresAt'       => $expiresAt,
        'issuedAt'        => $now,
    ];

    $h     = rtrim(strtr(base64_encode(json_encode(['alg'=>'none','typ'=>'JWT'])), '+/', '-_'), '=');
    $p     = rtrim(strtr(base64_encode(json_encode($payload)), '+/', '-_'), '=');
    $token = $h . '.' . $p . '.';

    $db->prepare('UPDATE ims_devices SET last_sync=NOW() WHERE id=?')->execute([$device['id']]);

    echo json_encode([
        'ok'       => true,
        'token'    => $token,
        'clientId' => $clientId,
        'barName'  => $client['business_name'],
        'plan'     => $sub['plan_name'],
        'daysLeft' => max(0, (int)(($subscriptionEnd - $now) / 86400)),
    ]);
    exit;
}

echo json_encode(['ok'=>false,'error'=>'Unknown action']);
