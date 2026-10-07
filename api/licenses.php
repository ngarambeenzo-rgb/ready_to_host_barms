<?php
require_once __DIR__ . '/../config/db.php';
if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();
requireAuth();
$db = getDB();
$action = $_REQUEST['action'] ?? 'list';

if ($action === 'list') {
    $status = $_GET['status'] ?? '';
    $where = $status && $status !== 'all' ? "WHERE l.status = '$status'" : '';
    $stmt = $db->query("
        SELECT l.*, c.business_name AS client_name,
               d.device_uuid, sp.name AS plan_name
        FROM ims_licenses l
        JOIN ims_clients c ON c.id = l.client_id
        LEFT JOIN ims_devices d ON d.id = l.device_id
        LEFT JOIN ims_subscription_plans sp ON sp.id = l.plan_id
        $where
        ORDER BY l.issued_at DESC LIMIT 200
    ");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['maxDevices'] = (int)$r['max_devices'];
        $r['clientName'] = $r['client_name'];
        $r['planName']   = $r['plan_name'];
        $r['deviceUuid'] = $r['device_uuid'];
        $r['issuedAt']   = $r['issued_at'];
        $r['expiresAt']  = $r['expires_at'];
        // Truncate token for security in list view
        $r['token'] = substr($r['token'] ?? '', 0, 40) . '...';
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

// Generate license for a client (no device required - issues for all approved devices)
if ($action === 'generate') {
    $body     = json_decode(file_get_contents('php://input'), true);
    $clientId = (int)($body['clientId'] ?? 0);
    $durHrs   = (int)($body['durationHrs'] ?? 24);

    if (!$clientId) jsonOut(['ok' => false, 'error' => 'Select a client'], 400);

    if (!extension_loaded('openssl')) {
        jsonOut(['ok' => false, 'error' => 'OpenSSL not enabled. Enable it in php.ini first (Settings → RSA Keys).'], 500);
    }

    if (!file_exists(IMS_KEYS_DIR . 'private.pem')) {
        jsonOut(['ok' => false, 'error' => 'RSA keys not generated yet. Go to Settings → RSA Keys → Generate.'], 500);
    }

    // Get subscription
    $sub = $db->prepare('SELECT s.*, sp.name AS plan_name FROM ims_subscriptions s JOIN ims_subscription_plans sp ON sp.id=s.plan_id WHERE s.client_id=? ORDER BY s.expiry_date DESC LIMIT 1');
    $sub->execute([$clientId]);
    $subRow = $sub->fetch();
    if (!$subRow) jsonOut(['ok' => false, 'error' => 'No subscription found for this client'], 404);

    // Get all approved devices for this client
    $devStmt = $db->prepare('SELECT * FROM ims_devices WHERE client_id=? AND status="approved"');
    $devStmt->execute([$clientId]);
    $devices = $devStmt->fetchAll();

    if (empty($devices)) {
        // Generate a client-level license (no device binding) for manual use
        $result = _generateLicense($clientId, null, $subRow['plan_id'], $subRow['max_devices'], $durHrs);
        if (!$result) jsonOut(['ok' => false, 'error' => 'License generation failed'], 500);
        jsonOut(['ok' => true, 'count' => 1, 'message' => 'License generated (no approved devices — client-level license)']);
    } else {
        $count = 0;
        foreach ($devices as $device) {
            $result = _generateLicense($clientId, $device['id'], $subRow['plan_id'], $subRow['max_devices'], $durHrs);
            if ($result) $count++;
        }
        jsonOut(['ok' => true, 'count' => $count, 'message' => "Licenses generated for $count device(s)"]);
    }
}

if ($action === 'revoke') {
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    $db->prepare('UPDATE ims_licenses SET status="revoked" WHERE id=?')->execute([$id]);
    auditLog('LICENSE_REVOKED', "License ID $id revoked");
    jsonOut(['ok' => true]);
}

if ($action === 'view_token') {
    $id   = (int)($_GET['id'] ?? 0);
    $stmt = $db->prepare('SELECT l.token, c.business_name FROM ims_licenses l JOIN ims_clients c ON c.id=l.client_id WHERE l.id=?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) jsonOut(['ok' => false, 'error' => 'Not found'], 404);
    jsonOut(['ok' => true, 'token' => $row['token'], 'clientName' => $row['business_name']]);
}

// ── Core license generation ───────────────────────────────────
function _generateLicense($clientId, $deviceId, $planId, $maxDevices, $durationHrs = 24) {
    $db = getDB();
    $keysDir = IMS_KEYS_DIR;
    if (!file_exists($keysDir . 'private.pem')) return false;

    // Client info
    $cStmt = $db->prepare('SELECT c.*, sp.name AS plan_name FROM ims_clients c LEFT JOIN ims_subscriptions s ON s.client_id=c.id LEFT JOIN ims_subscription_plans sp ON sp.id=s.plan_id WHERE c.id=? LIMIT 1');
    $cStmt->execute([$clientId]);
    $client = $cStmt->fetch();
    if (!$client) return false;

    // Device info
    $deviceUuid = '';
    if ($deviceId) {
        $dStmt = $db->prepare('SELECT device_uuid FROM ims_devices WHERE id=?');
        $dStmt->execute([$deviceId]);
        $dev = $dStmt->fetch();
        $deviceUuid = $dev['device_uuid'] ?? '';
    }

    // Subscription expiry
    $subStmt = $db->prepare('SELECT expiry_date FROM ims_subscriptions WHERE client_id=? ORDER BY expiry_date DESC LIMIT 1');
    $subStmt->execute([$clientId]);
    $sub = $subStmt->fetch();

    $now       = time();
    $expiresAt = $now + ($durationHrs * 3600);
    $nonce     = bin2hex(random_bytes(8));

    $header  = rtrim(strtr(base64_encode(json_encode(['alg'=>'RS256','typ'=>'JWT'])), '+/', '-_'), '=');
    $payload = rtrim(strtr(base64_encode(json_encode([
        'clientId'        => $clientId,
        'barName'         => $client['business_name'],
        'plan'            => $client['plan_name'] ?? 'Standard',
        'maxDevices'      => (int)$maxDevices,
        'deviceId'        => $deviceUuid,
        'issuedAt'        => $now,
        'expiresAt'       => $expiresAt,
        'subscriptionEnd' => $sub ? strtotime($sub['expiry_date']) : $expiresAt,
        'nonce'           => $nonce,
    ])), '+/', '-_'), '=');

    $data = $header . '.' . $payload;
    $privateKey = openssl_pkey_get_private(file_get_contents($keysDir . 'private.pem'));
    if (!$privateKey) return false;

    $signature = '';
    openssl_sign($data, $signature, $privateKey, OPENSSL_ALGO_SHA256);
    $token = $data . '.' . rtrim(strtr(base64_encode($signature), '+/', '-_'), '=');
    $tokenHash = hash('sha256', $token);

    // Revoke old licenses for this device
    if ($deviceId) {
        $db->prepare('UPDATE ims_licenses SET status="expired" WHERE client_id=? AND device_id=? AND status="active"')->execute([$clientId, $deviceId]);
    }

    $db->prepare('INSERT INTO ims_licenses (client_id, device_id, plan_id, max_devices, token, token_hash, nonce, expires_at, status, issued_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
       ->execute([$clientId, $deviceId, $planId, $maxDevices, $token, $tokenHash, $nonce, date('Y-m-d H:i:s', $expiresAt), 'active', $_SESSION['ims_admin_name'] ?? 'system']);

    $licenseId = (int)$db->lastInsertId();
    auditLog('LICENSE_ISSUED', "License issued for {$client['business_name']} — expires " . date('Y-m-d H:i', $expiresAt));
    return $licenseId;
}


// This endpoint is called by BarMS during sync
// No CSRF needed — uses clientId + deviceUuid authentication
if ($action === 'get_for_device') {
    $body       = json_decode(file_get_contents('php://input'), true);
    $clientId   = (int)($body['clientId'] ?? 0);
    $deviceUuid = trim($body['deviceUuid'] ?? '');

    if (!$clientId || !$deviceUuid) {
        jsonOut(['ok' => false, 'error' => 'clientId and deviceUuid required'], 400);
    }

    // Check client exists and is active
    $clientStmt = $db->prepare('SELECT * FROM ims_clients WHERE id=? LIMIT 1');
    $clientStmt->execute([$clientId]);
    $client = $clientStmt->fetch();

    if (!$client) jsonOut(['ok' => false, 'error' => 'client_not_found'], 404);
    if ($client['status'] === 'suspended') jsonOut(['ok' => false, 'error' => 'client_suspended', 'message' => 'Your subscription has been suspended. Contact IMS Company.'], 403);

    // Check device is approved
    $devStmt = $db->prepare('SELECT * FROM ims_devices WHERE client_id=? AND device_uuid=? LIMIT 1');
    $devStmt->execute([$clientId, $deviceUuid]);
    $device = $devStmt->fetch();

    if (!$device) {
        // Auto-register device as pending
        $db->prepare('INSERT IGNORE INTO ims_devices (client_id, device_uuid, device_name, status) VALUES (?,?,?,?)')
           ->execute([$clientId, $deviceUuid, 'BarMS Device', 'pending']);
        jsonOut(['ok' => false, 'error' => 'device_pending', 'message' => 'Device is pending approval. Contact IMS Company.'], 403);
    }

    if ($device['status'] === 'blocked') {
        jsonOut(['ok' => false, 'error' => 'device_blocked', 'message' => 'This device has been blocked. Contact IMS Company.'], 403);
    }

    if ($device['status'] === 'pending') {
        jsonOut(['ok' => false, 'error' => 'device_pending', 'message' => 'Device is awaiting approval. Contact IMS Company.'], 403);
    }

    // Update last sync time
    $db->prepare('UPDATE ims_devices SET last_sync=NOW() WHERE id=?')->execute([$device['id']]);

    // Log sync
    $db->prepare('INSERT INTO ims_sync_log (client_id, device_id, license_status, ip_address) VALUES (?,?,?,?)')
       ->execute([$clientId, $device['id'], 'issued', $_SERVER['REMOTE_ADDR'] ?? '']);

    // Get active subscription
    $subStmt = $db->prepare('SELECT s.*, sp.name AS plan_name FROM ims_subscriptions s JOIN ims_subscription_plans sp ON sp.id=s.plan_id WHERE s.client_id=? AND s.status="active" ORDER BY s.expiry_date DESC LIMIT 1');
    $subStmt->execute([$clientId]);
    $sub = $subStmt->fetch();

    if (!$sub) {
        jsonOut(['ok' => false, 'error' => 'no_active_subscription', 'message' => 'No active subscription. Please renew with IMS Company.'], 403);
    }

    // Check subscription not expired
    if (strtotime($sub['expiry_date']) < time()) {
        $db->prepare('UPDATE ims_subscriptions SET status="expired" WHERE id=?')->execute([$sub['id']]);
        $db->prepare('UPDATE ims_clients SET status="expired" WHERE id=?')->execute([$clientId]);
        jsonOut(['ok' => false, 'error' => 'subscription_expired', 'message' => 'Subscription expired on ' . $sub['expiry_date'] . '. Please renew.'], 403);
    }

    // Generate fresh license token
    if (!file_exists(IMS_KEYS_DIR . 'private.pem') || !extension_loaded('openssl')) {
        // Return subscription info without RSA signature (fallback)
        $simpleToken = base64_encode(json_encode([
            'clientId'        => $clientId,
            'barName'         => $client['business_name'],
            'plan'            => $sub['plan_name'],
            'maxDevices'      => (int)$sub['max_devices'],
            'deviceId'        => $deviceUuid,
            'issuedAt'        => time(),
            'expiresAt'       => time() + 86400,
            'subscriptionEnd' => strtotime($sub['expiry_date']),
            'nonce'           => bin2hex(random_bytes(8)),
            'signed'          => false,
        ]));
        jsonOut(['ok' => true, 'token' => $simpleToken, 'barName' => $client['business_name'], 'plan' => $sub['plan_name'], 'expiresAt' => time() + 86400, 'subscriptionEnd' => strtotime($sub['expiry_date'])]);
    }

    // Generate proper RSA-signed license
    $licenseId = _generateLicense($clientId, $device['id'], $sub['plan_id'], $sub['max_devices'], 24);

    if (!$licenseId) {
        jsonOut(['ok' => false, 'error' => 'license_generation_failed'], 500);
    }

    // Get the generated token
    $tokenStmt = $db->prepare('SELECT token, expires_at FROM ims_licenses WHERE id=?');
    $tokenStmt->execute([$licenseId]);
    $license = $tokenStmt->fetch();

    jsonOut([
        'ok'              => true,
        'token'           => $license['token'],
        'barName'         => $client['business_name'],
        'plan'            => $sub['plan_name'],
        'maxDevices'      => (int)$sub['max_devices'],
        'expiresAt'       => strtotime($license['expires_at']),
        'subscriptionEnd' => strtotime($sub['expiry_date']),
        'daysLeft'        => max(0, (int)ceil((strtotime($sub['expiry_date']) - time()) / 86400)),
    ]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
