<?php
// ============================================================
//  BarMS Pro — Database Configuration (PRODUCTION)
//  InfinityFree Hosting — barms.gt.tc
// ============================================================

$dbHostName = strtolower(explode(':', $_SERVER['HTTP_HOST'] ?? 'localhost')[0]);
$isLocalHost = in_array($dbHostName, ['localhost', '127.0.0.1'], true)
    || preg_match('/^(192\.168|10)\./', $dbHostName);

if ($isLocalHost) {
    define('DB_HOST', 'localhost');
    define('DB_USER', 'root');
    define('DB_PASS', '');
    define('DB_NAME', 'barms_db');
    define('BARMS_IMS_DB', 'ims_db');   // locally IMS has its own database
    define('BARMS_LEGACY_CLIENT', 5);  // IMS client that owns the data already in these tables (enzo)
} else {
    // live server: the password lives in config/db.hosting.php (never committed; template: db.hosting.example.php)
    if (!is_file(__DIR__ . '/db.hosting.php')) {
        http_response_code(500); header('Content-Type: application/json');
        exit(json_encode(['ok' => false, 'error' => 'Server not configured: upload config/db.hosting.php']));
    }
    require __DIR__ . '/db.hosting.php';
}

    define('SESSION_IDLE_TIMEOUT', 600);
    ini_set('session.gc_maxlifetime', '86400');

if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
        'lifetime' => 86400,
        'path'     => '/',
        'domain'   => '',
        'secure'   => !$isLocalHost,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
}

if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

error_reporting(0);
ini_set('display_errors', 0);

// A crash used to send an empty page, which the browser showed as "Network error".
// Now the details go to the server error log and the screen gets a clear message.
function barmsServerError(string $detail, ?string $userMessage = null, string $category = 'server'): void {
    error_log('[BarMS] ' . $detail);
    idempotencyFinish(null, 500);   // the request failed: free its key so a retry can run
    $ref = function_exists('incidentRecord') ? incidentRecord(['category' => $category, 'severity' => $category === 'database' ? 'critical' : 'error',
        // title = the first line without " in <file>:<line>" (the path stays in the detail)
        'title' => preg_replace('~ in \S+:\d+$~', '', (string)strtok($detail, "\n")), 'detail' => $detail, 'source' => basename($_SERVER['SCRIPT_NAME'] ?? '') . '?' . ($_REQUEST['action'] ?? '')]) : null;
    if (headers_sent()) return;
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => ($userMessage ?? 'BarMS could not finish this request. Please try again in a moment.') . ($ref ? " Reference: $ref." : ''), 'ref' => $ref], JSON_UNESCAPED_UNICODE);
}
set_exception_handler(function (Throwable $e) {
    $msg = $e->getMessage();
    $user = null;
    // MySQL 1932 "doesn't exist in engine" / 1146 "doesn't exist": a damaged or missing table
    if ($e instanceof PDOException && preg_match("/(?:1932|1146).*?Table '[^.']*\.([^']+)'/", $msg, $m)) {
        $user = 'Part of the BarMS data cannot be read right now, so this screen cannot load. Other screens keep working and the Owner has been told (System Health).';
    }
    barmsServerError(get_class($e) . ": $msg in " . $e->getFile() . ':' . $e->getLine() . "
" . $e->getTraceAsString(), $user, $e instanceof PDOException ? 'database' : 'server');
});
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        barmsServerError("{$e['message']} in {$e['file']}:{$e['line']}");
    }
});

require_once __DIR__ . '/tenant.php';
require_once __DIR__ . '/incidents.php';

function getDB() {
    static $pdo = null;
    if ($pdo === null) {
        try {
            $pdo = new TenantPDO(
                'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
                DB_USER, DB_PASS,
                [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES   => false,
                ]
            );
        } catch (PDOException $e) {
            header('Content-Type: application/json');
            http_response_code(500);
            die(json_encode(['ok' => false, 'error' => 'DB connection failed']));
        }
        // a session signed in before client separation existed has no client → sign in again once
        if (!empty($_SESSION['user_id']) && !isset($_SESSION['tenant_client']) && PHP_SAPI !== 'cli') {
            $_SESSION = [];
            session_regenerate_id(true);
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
        }
        tenantApply($pdo);
    }
    return $pdo;
}

function jsonOut($data, $code = 200) {
    idempotencyFinish($data, (int)$code);
    http_response_code($code);
    header('Content-Type: application/json');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function requireAuth() {
    if (empty($_SESSION['user_id'])) {
        jsonOut(['ok' => false, 'error' => 'Not authenticated'], 401);
    }

    $now = time();
    $hasRecentUserActivity = ($_SERVER['HTTP_X_USER_ACTIVITY'] ?? '') === '1';
    if ($hasRecentUserActivity) {
        $_SESSION['last_activity'] = $now;
    }

    $lastActivity = (int)($_SESSION['last_activity'] ?? $now);
    if (!$hasRecentUserActivity && $now - $lastActivity >= SESSION_IDLE_TIMEOUT) {
        $_SESSION = [];
        session_destroy();
        jsonOut(['ok' => false, 'error' => 'Session expired after inactivity'], 401);
    }

    // PHP locks the session file for the whole request, so one slow request made every
    // other request of the same user wait (the app looked frozen). Reads never change
    // the session, so they release the lock now; POST requests keep it.
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET' && session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
    return $_SESSION;
}

function requireRole($roles) {
    $sess = requireAuth();
    if (!in_array($sess['role'], (array)$roles)) {
        jsonOut(['ok' => false, 'error' => 'Access denied'], 403);
    }
    return $sess;
}

// Manager permissions the Owner can grant: key => [db column, default if column missing]
const MGR_PERMISSIONS = [
    'canViewReports'    => ['can_view_reports',    1],
    'canEditStock'      => ['can_edit_stock',      1],
    'canManageItems'    => ['can_manage_items',    1],
    'canViewEmployees'  => ['can_view_employees',  1],
    'canPaySalaries'    => ['can_pay_salaries',    0],
    'canViewAudit'      => ['can_view_audit',      0],
    'canRecordExpenses' => ['can_record_expenses', 1],
    'canVoidExpenses'   => ['can_void_expenses',   0],
    'canApproveVoids'   => ['can_approve_voids',   0],
    'canGiveRefunds'    => ['can_give_refunds',    0],
    'canGiveDiscounts'  => ['can_give_discounts',  0],
    'canDeleteRecords'  => ['can_delete_records',  0],
    'canManageUsers'    => ['can_manage_users',    0],
    'canEditSettings'   => ['can_edit_settings',   0],
];

function getMgrPermissions() {
    static $perms = null;
    if ($perms !== null) return $perms;
    $row = [];
    try {
        $row = getDB()->query('SELECT * FROM mgr_permissions WHERE id = 1')->fetch() ?: [];
    } catch (Exception $e) {}
    $perms = [];
    foreach (MGR_PERMISSIONS as $key => [$col, $default]) {
        $perms[$key] = (bool)($row[$col] ?? $default);
    }
    return $perms;
}

function hasPerm($perm) {
    $role = $_SESSION['role'] ?? '';
    if ($role === 'Owner') return true;
    if ($role !== 'Manager') return false;
    return getMgrPermissions()[$perm] ?? false;
}

// Owner always passes; Manager passes if granted $perm; $alsoRoles pass unconditionally
function requirePerm($perm, $alsoRoles = []) {
    $sess = requireAuth();
    if (in_array($sess['role'], (array)$alsoRoles, true) || hasPerm($perm)) {
        return $sess;
    }
    jsonOut(['ok' => false, 'error' => 'You do not have permission for this. Ask the Owner.'], 403);
}

/** The current user's open shift, if any (cash they take or pay out is counted in it). */
function currentShiftId(): ?int {
    if (empty($_SESSION['user_id'])) return null;
    try {
        $st = getDB()->prepare("SELECT id FROM shifts WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1");
        $st->execute([(int)$_SESSION['user_id']]);
        $id = $st->fetchColumn();
        return $id ? (int)$id : null;
    } catch (Exception $e) {
        return null;
    }
}

const PAYMENT_METHODS = ['Cash', 'MoMo', 'Card', 'Bank', 'Mixed'];
function cleanMethod($m, string $default = 'Cash'): string {
    $m = trim((string)$m);
    foreach (PAYMENT_METHODS as $ok) if (strcasecmp($m, $ok) === 0) return $ok;
    return $default;
}

// Product types the owner can pick for an item's picture (NULL = guess from the name)
const PRODUCT_TYPES = ['beer','soda','spirits','wine','water','juice','hot','cocktail','local','bottle','dish','bowl','skewer'];
function cleanProductType($t): ?string {
    $t = strtolower(trim((string)$t));
    return in_array($t, PRODUCT_TYPES, true) ? $t : null;
}

function requireCsrf() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') return;
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!$token || !hash_equals($_SESSION['csrf'], $token)) {
        jsonOut(['ok' => false, 'error' => 'Invalid CSRF token'], 403);
    }
    idempotencyStart();
}

// ── IDEMPOTENCY: a write sent twice (retry after a lost connection) runs once ──
// The browser sends X-Idempotency-Key with every write and reuses it when it retries.
//   first time      → the key is reserved, the request runs, its answer is stored
//   same key again  → the stored answer is sent back; nothing is saved a second time
//   still running   → 409 inProgress (the browser waits and asks again)
//   server error    → the key is released, so a retry can run normally
function idempotencyStart(): void {
    static $started = false;
    if ($started) return;
    $started = true;
    $key = $_SERVER['HTTP_X_IDEMPOTENCY_KEY'] ?? '';
    if (!preg_match('/^[A-Za-z0-9-]{16,64}$/', $key)) return;
    $endpoint = mb_substr(basename($_SERVER['SCRIPT_NAME'] ?? '') . '?' . ($_REQUEST['action'] ?? ''), 0, 80);
    $db = idempotencyDB();
    if (!$db) return;
    try {
        if (mt_rand(1, 200) === 1) $db->exec('DELETE FROM request_keys WHERE created_at < NOW() - INTERVAL 3 DAY');
        $db->prepare('INSERT INTO request_keys (idem_key, user_id, endpoint) VALUES (?,?,?)')->execute([$key, $_SESSION['user_id'] ?? null, $endpoint]);
        $GLOBALS['BARMS_IDEM'] = $key;
        return;
    } catch (PDOException $e) {
        if ($e->getCode() !== '23000') { error_log('[BarMS] idempotency unavailable: ' . $e->getMessage()); return; } // table missing: run without it
    }
    $st = $db->prepare('SELECT * FROM request_keys WHERE idem_key = ?');
    $st->execute([$key]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if ($row && $row['endpoint'] !== $endpoint) {   // a key is never valid for another action
        http_response_code(409); header('Content-Type: application/json');
        exit(json_encode(['ok' => false, 'error' => 'Request key reused for another action']));
    }
    if ($row && $row['status'] === 'done') {
        http_response_code((int)$row['http_code']); header('Content-Type: application/json'); header('X-Idempotent-Replay: 1');
        exit($row['response']);
    }
    $stale = $row && strtotime($row['created_at']) < time() - 300;
    http_response_code(409); header('Content-Type: application/json');
    exit(json_encode($stale
        ? ['ok' => false, 'error' => 'The first attempt did not finish, so BarMS cannot confirm whether it was saved. Check the list before trying again.', 'unconfirmed' => true]
        : ['ok' => false, 'inProgress' => true, 'error' => 'This is already being saved. Please wait a moment.']));
}
// own connection: the key is stored even when the request's transaction is rolled back
function idempotencyDB(): ?PDO { return barmsSideDB(); }
function idempotencyFinish($data, int $code): void {
    $key = $GLOBALS['BARMS_IDEM'] ?? null;
    if (!$key) return;
    unset($GLOBALS['BARMS_IDEM']);
    try {
        $db = idempotencyDB();
        if (!$db) return;
        if ($code >= 500 || $data === null) $db->prepare('DELETE FROM request_keys WHERE idem_key = ?')->execute([$key]);
        else $db->prepare("UPDATE request_keys SET status = 'done', http_code = ?, response = ? WHERE idem_key = ?")
                ->execute([$code, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $key]);
    } catch (Throwable $e) { error_log('[BarMS] idempotency store failed: ' . $e->getMessage()); }
}

function requireToken() {
    $db = getDB();
    try { $db->exec("DELETE FROM api_tokens WHERE expires_at < NOW()"); } catch (Exception $e) {}
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer\s+(.+)$/i', $header, $m)) {
        jsonOut(['ok' => false, 'error' => 'Token required'], 401);
    }
    $tokenHash = hash('sha256', $m[1]);
    $stmt = $db->prepare(
        'SELECT u.* FROM api_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token = ? AND t.expires_at > NOW() AND u.active = 1 LIMIT 1'
    );
    $stmt->execute([$tokenHash]);
    $user = $stmt->fetch();
    if (!$user) jsonOut(['ok' => false, 'error' => 'Invalid or expired token'], 401);
    return $user;
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token, Authorization');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }
