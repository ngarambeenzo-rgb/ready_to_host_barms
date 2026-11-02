<?php

require_once __DIR__ . '/../config/db.php';

$action = $_REQUEST['action'] ?? '';

// ── LOGIN ─────────────────────────────────────────────────────
if ($action === 'login') {
    $body     = json_decode(file_get_contents('php://input'), true);
    $username = strtolower(trim($body['username'] ?? ''));
    $password = $body['password'] ?? '';

    if (!$username || !$password) {
        jsonOut(['ok' => false, 'error' => 'Username and password required'], 400);
    }

    $db   = getDB();
    if (empty($GLOBALS['BARMS_TENANT'])) {
        jsonOut(['ok' => false, 'error' => 'This device is not activated for a BarMS client. Enter the activation key from IMS first.'], 403);
    }
    $stmt = $db->prepare('SELECT * FROM users WHERE username = ? AND active = 1 LIMIT 1');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    // Task 124: Check login attempts — lockout after 5 fails
    if ($user && isset($user['login_attempts']) && $user['login_attempts'] >= 5) {
        jsonOut(['ok' => false, 'error' => 'Account locked after too many failed attempts. Contact your manager.'], 429);
    }

    // Support both MD5 (legacy) and bcrypt passwords
    // Auto-upgrade MD5 to bcrypt on successful login
    $validPassword = false;
    if ($user) {
        if (strlen($user['password']) === 32 && $user['password'] === md5($password)) {
            $validPassword = true;
            $db->prepare('UPDATE users SET password = ? WHERE id = ?')
               ->execute([password_hash($password, PASSWORD_BCRYPT), $user['id']]);
        } elseif (password_verify($password, $user['password'])) {
            $validPassword = true;
        }
    }

    if (!$user || !$validPassword) {
        // Task 124: Increment failed attempt count
        if ($user) {
            $db->prepare('UPDATE users SET login_attempts = login_attempts + 1 WHERE id = ?')
               ->execute([$user['id']]);
        }
        jsonOut(['ok' => false, 'error' => 'Invalid credentials'], 401);
    }

    // a fresh session for this user: nothing of a previous sign-in (user, role, backdate) carries over
    $_SESSION = [];
    session_regenerate_id(true);
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    tenantBindSession();

    // Task 124: Reset attempts on successful login + update last_login
    $db->prepare('UPDATE users SET login_attempts = 0, last_login = NOW() WHERE id = ?')
       ->execute([$user['id']]);

    // Store session
    $_SESSION['user_id']   = $user['id'];
    $_SESSION['username']  = $user['username'];
    $_SESSION['full_name'] = $user['full_name'];
    $_SESSION['role']      = $user['role'];
    $_SESSION['last_activity'] = time();

    // Log audit
    try {
        $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?, ?, ?)')
           ->execute(['LOGIN', $user['full_name'] . ' logged in as ' . $user['role'], $user['full_name']]);
    } catch (Exception $e) {}

    // Pending void requests
    $pendingVoids = 0;
    if (in_array($user['role'], ['Owner', 'Manager'])) {
        try {
            $vStmt = $db->query("SELECT COUNT(*) AS cnt FROM void_requests WHERE status='Pending'");
            $pendingVoids = (int)$vStmt->fetch()['cnt'];
        } catch (Exception $e) {}
    }

    jsonOut([
        'ok'          => true,
        'user'        => [
            'id'       => $user['id'],
            'username' => $user['username'],
            'fullName' => $user['full_name'],
            'role'     => $user['role'],
        ],
        'pendingVoids' => $pendingVoids,
        'csrf'         => $_SESSION['csrf'],
    ]);
}

// ── NEW CLIENT: is there an Owner yet? ──────────────────────
if ($action === 'setup_status') {
    $db = getDB();
    $t  = $GLOBALS['BARMS_TENANT'] ?? null;
    $users = $t ? (int)$db->query('SELECT COUNT(*) FROM users')->fetchColumn() : -1;
    jsonOut(['ok' => true, 'activated' => (bool)$t, 'needsOwner' => $t && $users === 0, 'barName' => $t['name'] ?? '']);
}

// ── NEW CLIENT: create the first Owner (only while no user exists) ──
if ($action === 'setup_owner') {
    requireCsrf();
    $db = getDB();
    $t  = $GLOBALS['BARMS_TENANT'] ?? null;
    if (!$t) jsonOut(['ok' => false, 'error' => 'This device is not activated for a BarMS client.'], 403);
    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $name = mb_substr(trim($body['fullName'] ?? ''), 0, 100);
    $user = strtolower(trim($body['username'] ?? ''));
    $pass = (string)($body['password'] ?? '');
    if ($name === '' || !preg_match('/^[a-z0-9._-]{3,30}$/', $user)) jsonOut(['ok' => false, 'error' => 'Enter your name and a username of 3–30 letters or numbers'], 400);
    if (strlen($pass) < 6) jsonOut(['ok' => false, 'error' => 'The password must have at least 6 characters'], 400);
    $db->beginTransaction();
    if ((int)$db->query('SELECT COUNT(*) FROM users FOR UPDATE')->fetchColumn() > 0) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'This BarMS already has an Owner. Sign in instead.'], 409); }
    $db->prepare('INSERT INTO users (full_name, username, password, role, active) VALUES (?,?,?,?,1)')->execute([$name, $user, password_hash($pass, PASSWORD_BCRYPT), 'Owner']);
    $db->commit();
    try { $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')->execute(['SETUP', "Owner account created for {$t['name']}", $name]); } catch (Exception $e) {}
    jsonOut(['ok' => true]);
}

// ── LOGOUT ────────────────────────────────────────────────────
if ($action === 'logout') {
    $_SESSION = [];
    session_regenerate_id(true);
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    tenantBindSession();
    jsonOut(['ok' => true, 'csrf' => $_SESSION['csrf']]);
}

// current security token for this session (used to recover from a stale page)
if ($action === 'csrf') {
    jsonOut(['ok' => true, 'csrf' => $_SESSION['csrf']]);
}

// ── SESSION CHECK ─────────────────────────────────────────────
if ($action === 'me') {
    requireAuth();
    jsonOut([
        'ok'   => true,
        'user' => [
            'id'       => $_SESSION['user_id'],
            'username' => $_SESSION['username'],
            'fullName' => $_SESSION['full_name'],
            'role'     => $_SESSION['role'],
        ],
    ]);
}

// ── CHANGE PASSWORD ───────────────────────────────────────────
if ($action === 'change_password') {
    requireAuth();
    $body    = json_decode(file_get_contents('php://input'), true);
    $current = $body['current'] ?? '';
    $newPwd  = $body['new']     ?? '';

    if (!$current || !$newPwd) jsonOut(['ok' => false, 'error' => 'Fill both fields'], 400);

    $db   = getDB();
    $stmt = $db->prepare('SELECT password FROM users WHERE id = ?');
    $stmt->execute([$_SESSION['user_id']]);
    $row  = $stmt->fetch();

    $valid = false;
    if (strlen($row['password']) === 32 && $row['password'] === md5($current)) $valid = true;
    elseif (password_verify($current, $row['password'])) $valid = true;

    if (!$valid) jsonOut(['ok' => false, 'error' => 'Current password is wrong'], 401);

    // Save as bcrypt (Task 2 — never MD5)
    $db->prepare('UPDATE users SET password = ? WHERE id = ?')
       ->execute([password_hash($newPwd, PASSWORD_BCRYPT), $_SESSION['user_id']]);

    jsonOut(['ok' => true]);
}


// ── OFFLINE TOKEN ─────────────────────────────────────────────
// Called right after an online sign-in. On one of the two offline devices (Settings →
// Offline devices) the signed-in person gets a token for THIS device, used later to send
// the records they make offline (see offlineTokenUser in config/db.php). One token per
// person per device: signing in on another device does not cancel this one.
if ($action === 'token') {
    requireCsrf();
    $sess   = requireAuth();
    $db     = getDB();
    $userId = (int)$sess['user_id'];
    $device = trim($_SERVER['HTTP_X_BARMS_DEVICE'] ?? '');
    $role   = offlineDeviceRole($db, $device);

    if (!offlineRoleAllows($role, (string)$sess['role'])) {
        // not allowed offline here (any more): no new token. An old one is kept until it
        // expires, so records already made offline on this device can still be sent.
        jsonOut(['ok' => false, 'offlineRole' => $role, 'error' => 'not_offline_device']);
    }

    $rawToken  = bin2hex(random_bytes(32)); // 64-char hex string
    $expiresAt = date('Y-m-d H:i:s', strtotime('+' . OFFLINE_TOKEN_DAYS . ' days'));   // for the device only; the server uses its own clock
    $db->prepare('DELETE FROM api_tokens WHERE user_id = ? AND device_uuid = ?')->execute([$userId, $device]);
    $db->prepare('INSERT INTO api_tokens (user_id, device_uuid, token, expires_at) VALUES (?, ?, ?, NOW() + INTERVAL ' . OFFLINE_TOKEN_DAYS . ' DAY)')
       ->execute([$userId, $device, hash('sha256', $rawToken)]);

    jsonOut([
        'ok'          => true,
        'token'       => $rawToken,
        'expiresAt'   => $expiresAt,
        'offlineRole' => $role,
    ]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);

