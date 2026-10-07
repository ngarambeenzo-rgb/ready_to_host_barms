<?php
// ============================================================
//  config/tenant.php — one BarMS, many clients, data kept apart.
//
//  Every IMS client (activation key) has its own copy of every BarMS
//  table inside the same database:
//     the original client (barms_tenants.legacy = 1) → orders, users, …
//     any other client #7                           → t7_orders, t7_users, …
//  TenantPDO rewrites table names in every query, so the rest of BarMS
//  is unchanged and one client can never read another's rows.
//
//  Which client? The browser sends its IMS client id + device id
//  (X-Barms-Client / X-Barms-Device). The server only accepts it when
//  IMS has APPROVED that device for that client (ims_devices). Once a
//  user signs in, the client is fixed in the session; a device that
//  switches to another key is signed out.
//  A brand-new client starts with empty tables and creates its Owner
//  account on the first sign-in screen.
// ============================================================

// BarMS tables (never ims_* — those belong to IMS)
const BARMS_TENANT_TABLES = [
    'api_tokens','audit_log','business_assets','request_keys','system_incidents','system_incident_events','bar_ingredients','bar_items','bar_movements','bar_recipe_ingredients','bar_recipes','bar_sales',
    'cash_movements','counters','customer_debts','discount_rules','employee_debts','employees','expenses','inventory_purchases',
    'kitchen_deductions','kitchen_expenses','kitchen_ingredients','kitchen_menu','kitchen_order_items','kitchen_orders',
    'kitchen_prep_history','kitchen_recipes','kitchen_revenue','kitchen_sales','kitchen_stock_movements','mgr_permissions',
    'notifications','order_items','order_refund_items','order_refunds','orders','products','recipe_ingredients','report_issues',
    'salary_payments','sales','settings','shifts','stock_count_lines','stock_counts','stock_movements','supplier_payments',
    'support_requests','table_session_items','table_sessions','tables','users','void_requests',
];

// Rewrites table names to the active client's tables
class TenantPDO extends PDO {
    public string $tenantPrefix = '';
    private static ?string $re = null;

    public function tbl(string $name): string {
        return ($this->tenantPrefix !== '' && in_array($name, BARMS_TENANT_TABLES, true)) ? $this->tenantPrefix . $name : $name;
    }
    public function rewrite(string $sql): string {
        if ($this->tenantPrefix === '') return $sql;
        if (self::$re === null) {
            $names = implode('|', array_map(fn($t) => preg_quote($t, '/'), BARMS_TENANT_TABLES));
            // a table name only where SQL expects a table (not after "KEY UPDATE", where columns follow)
            self::$re = '/(?<!KEY )\b(FROM|JOIN|INTO|UPDATE|TABLE|TABLES|EXISTS|REFERENCES|DESCRIBE)(\s+)(`?)(' . $names . ')(`?)(?![\w$])/i';
        }
        $p = $this->tenantPrefix;
        // SHOW TABLES LIKE 'orders' (the one place a table name sits inside quotes)
        $sql = preg_replace_callback("/(SHOW\s+TABLES\s+LIKE\s+')([a-z_]+)(')/i", fn($m) => $m[1] . $this->tbl($m[2]) . $m[3], $sql);
        // rewrite only outside quoted text, so values like 'FROM sales' are never touched
        $parts = preg_split("/('(?:[^'\\\\]|\\\\.|'')*'|\"(?:[^\"\\\\]|\\\\.)*\")/s", $sql, -1, PREG_SPLIT_DELIM_CAPTURE);
        $names = implode('|', array_map(fn($t) => preg_quote($t, '/'), BARMS_TENANT_TABLES));
        foreach ($parts as $i => &$part) {
            if ($i % 2 === 1) continue;                      // a quoted literal
            $part = preg_replace_callback(self::$re, fn($m) => $m[1] . $m[2] . $m[3] . $p . $m[4] . $m[5], $part);
            // table-qualified columns: bar_items.name → t7_bar_items.name
            $part = preg_replace('/(?<![\w.`$])(`?)(' . $names . ')(`?)\.(?=[`\w*])/', '$1' . $p . '$2$3.', $part);
        }
        unset($part);
        return implode('', $parts);
    }
    #[\ReturnTypeWillChange]
    public function prepare($statement, $options = []) { return parent::prepare($this->rewrite($statement), $options); }
    #[\ReturnTypeWillChange]
    public function exec($statement) { return parent::exec($this->rewrite($statement)); }
    #[\ReturnTypeWillChange]
    public function query($statement, $mode = null, ...$args) {
        $statement = $this->rewrite($statement);
        return $mode === null ? parent::query($statement) : parent::query($statement, $mode, ...$args);
    }
}

// The IMS tables live in the same database on the hosting, in ims_db locally
function tenantImsDb(): string { return defined('BARMS_IMS_DB') ? BARMS_IMS_DB : DB_NAME; }

function tenantRegistry(PDO $raw): void {
    static $done = false;
    if ($done) return;
    $raw->exec("CREATE TABLE IF NOT EXISTS barms_tenants (
        client_id  INT PRIMARY KEY,
        prefix     VARCHAR(20) NOT NULL,
        legacy     TINYINT(1) NOT NULL DEFAULT 0,
        bar_name   VARCHAR(150) NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $done = true;
}

// Is this device approved by IMS for this client?  → [ok, business_name]
function tenantVerifyDevice(PDO $raw, int $clientId, string $device): array {
    if ($clientId <= 0 || $device === '') return [false, null];
    $key = "tenant_ok_{$clientId}_" . substr(hash('sha256', $device), 0, 16);
    if (!empty($_SESSION[$key]) && $_SESSION[$key]['t'] > time() - 300) return [true, $_SESSION[$key]['name']];
    try {
        $ims = '`' . str_replace('`', '', tenantImsDb()) . '`';
        $st = $raw->prepare("SELECT c.business_name FROM $ims.ims_devices d JOIN $ims.ims_clients c ON c.id = d.client_id
                             WHERE d.client_id = ? AND d.device_uuid = ? AND d.status = 'approved' AND c.status <> 'suspended' LIMIT 1");
        $st->execute([$clientId, $device]);
        $name = $st->fetchColumn();
    } catch (Exception $e) { return [false, null]; }
    if ($name === false) return [false, null];
    $_SESSION[$key] = ['t' => time(), 'name' => $name];
    return [true, $name];
}

// Prefix for a client; creates its empty tables the first time
function tenantPrefixFor(PDO $raw, int $clientId, ?string $barName): string {
    tenantRegistry($raw);
    $st = $raw->prepare('SELECT prefix FROM barms_tenants WHERE client_id = ?');
    $st->execute([$clientId]);
    $p = $st->fetchColumn();
    if ($p !== false) return (string)$p;

    // The first client ever seen owns the data that is already here (no copy, nothing moves)
    // BARMS_LEGACY_CLIENT (config/db.php) names that client; without it, the first client seen claims it.
    $hasLegacy = (int)$raw->query('SELECT COUNT(*) FROM barms_tenants WHERE legacy = 1')->fetchColumn();
    $owner = defined('BARMS_LEGACY_CLIENT') ? (int)BARMS_LEGACY_CLIENT : 0;
    if (!$hasLegacy && (!$owner || $owner === $clientId)) {
        $raw->prepare('INSERT INTO barms_tenants (client_id, prefix, legacy, bar_name) VALUES (?, \'\', 1, ?)')->execute([$clientId, $barName]);
        return '';
    }
    $prefix = 't' . $clientId . '_';
    tenantCreateTables($raw, $prefix, $barName);
    $raw->prepare('INSERT INTO barms_tenants (client_id, prefix, legacy, bar_name) VALUES (?,?,0,?)')->execute([$clientId, $prefix, $barName]);
    return $prefix;
}

// Empty copies of every BarMS table (same columns and indexes), plus the rows BarMS needs to start
function tenantCreateTables(PDO $raw, string $prefix, ?string $barName): void {
    $existing = array_flip($raw->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
    foreach (BARMS_TENANT_TABLES as $t) {
        if (!isset($existing[$t]) || isset($existing[$prefix . $t])) continue;
        $raw->exec("CREATE TABLE `{$prefix}{$t}` LIKE `$t`");
    }
    // one settings row and the manager-permission row, as a fresh install has
    if (isset($existing['settings']) && !(int)$raw->query("SELECT COUNT(*) FROM `{$prefix}settings`")->fetchColumn()) {
        $raw->prepare("INSERT INTO `{$prefix}settings` (bar_name) VALUES (?)")->execute([$barName ?: 'BarMS Pro']);
    }
    if (isset($existing['mgr_permissions']) && !(int)$raw->query("SELECT COUNT(*) FROM `{$prefix}mgr_permissions`")->fetchColumn()) {
        $raw->exec("INSERT INTO `{$prefix}mgr_permissions` (id) VALUES (1)");
    }
}

// Decide the client for this request and apply it to the connection
function tenantApply(TenantPDO $pdo): void {
    $hdrClient = (int)($_SERVER['HTTP_X_BARMS_CLIENT'] ?? 0);
    $hdrDevice = trim($_SERVER['HTTP_X_BARMS_DEVICE'] ?? '');

    if (isset($_SESSION['tenant_client'])) {
        if ($hdrClient && $hdrClient !== (int)$_SESSION['tenant_client']) {
            // this device now uses another key → sign out, start fresh
            $_SESSION = [];
            session_regenerate_id(true);
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
            header('Content-Type: application/json');
            http_response_code(401);
            die(json_encode(['ok' => false, 'error' => 'BarMS now uses another client key. Please sign in again.', 'tenantChanged' => true, 'csrf' => $_SESSION['csrf']]));
        }
        if (!empty($_SESSION['user_id'])) {
            // Signed in: the client is fixed in the session. It is also published for
            // auth.php, so signing in again on a session that is still alive (page reloaded,
            // signed out only in the browser) works instead of failing with "not activated".
            $pdo->tenantPrefix = (string)$_SESSION['tenant_prefix'];
            $GLOBALS['BARMS_TENANT'] = ['client' => (int)$_SESSION['tenant_client'], 'prefix' => $pdo->tenantPrefix, 'name' => (string)($_SESSION['tenant_name'] ?? '')];
            return;
        }
        // a client left in a session nobody is signed in to: check the device again below
        unset($_SESSION['tenant_client'], $_SESSION['tenant_prefix'], $_SESSION['tenant_name']);
    }

    // Not signed in yet: trust the header only for a device IMS approved
    if ($hdrClient) {
        [$ok, $name] = tenantVerifyDevice($pdo, $hdrClient, $hdrDevice);
        if ($ok) {
            $pdo->tenantPrefix = tenantPrefixFor($pdo, $hdrClient, $name);
            $GLOBALS['BARMS_TENANT'] = ['client' => $hdrClient, 'prefix' => $pdo->tenantPrefix, 'name' => $name];
            return;
        }
    }
    $GLOBALS['BARMS_TENANT'] = null;   // unknown device: original data only (login is refused, see auth.php)
}

// Called by login: remember the client for the whole session
function tenantBindSession(): bool {
    $t = $GLOBALS['BARMS_TENANT'] ?? null;
    if (!$t) return false;
    $_SESSION['tenant_client'] = $t['client'];
    $_SESSION['tenant_prefix'] = $t['prefix'];
    $_SESSION['tenant_name']   = $t['name'];
    return true;
}
