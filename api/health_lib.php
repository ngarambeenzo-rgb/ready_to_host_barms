<?php
// ============================================================
//  api/health_lib.php — BarMS health checks (used by api/health.php)
//
//  Every check is read-only and cheap. A check that finds a problem
//  records an incident (grouped, not repeated on every run); nothing here
//  ever changes business data. Business discrepancies (negative stock,
//  a short cash drawer) are reported, never "corrected".
//
//  Overall status:
//    critical         database unreachable or a table cannot be read
//    action_required  missing migration, open error incidents, broken records
//    degraded         warnings (stock below zero, unconfirmed writes, old pending items)
//    healthy          nothing found
// ============================================================

/** A check result. status: ok | warn | fail */
function hlCheck(string $key, string $group, string $label, string $status, string $detail = '', array $extra = []): array {
    return ['key' => $key, 'group' => $group, 'label' => $label, 'status' => $status, 'detail' => $detail] + $extra;
}

// Database reachable, and how fast it answers
function hlDatabase(PDO $db): array {
    $t = microtime(true);
    try { $db->query('SELECT 1')->fetchColumn(); }
    catch (Throwable $e) { return hlCheck('db', 'Database', 'Database connection', 'fail', 'The database does not answer'); }
    $ms = round((microtime(true) - $t) * 1000);
    return hlCheck('db', 'Database', 'Database connection', $ms > 500 ? 'warn' : 'ok', $ms > 500 ? "Answering slowly ({$ms} ms)" : "Answering ({$ms} ms)", ['ms' => $ms]);
}

// Every BarMS table can be read (finds damaged tables like "doesn't exist in engine")
function hlTables(PDO $db): array {
    $bad = [];
    foreach (BARMS_TENANT_TABLES as $t) {
        try { $db->query("SELECT 1 FROM `$t` LIMIT 1")->fetchColumn(); }
        catch (Throwable $e) {
            $code = preg_match('/\b(1932|1146|1033|1030|145|126)\b/', $e->getMessage(), $m) ? $m[1] : '?';
            $bad[] = ['table' => $t, 'reason' => $code === '1146' ? 'missing' : 'damaged', 'error' => mb_substr($e->getMessage(), 0, 200)];
        }
    }
    if (!$bad) return hlCheck('tables', 'Database', 'All tables readable', 'ok', count(BARMS_TENANT_TABLES) . ' tables checked');
    foreach ($bad as $b) {
        incidentRecord(['category' => 'database', 'severity' => 'critical', 'quiet' => true, 'title' => "Table {$b['table']} is {$b['reason']}",
            'detail' => $b['error'] . "\nRepair: restore the table from a backup, or recreate it from the migration files. Never edited automatically.", 'source' => 'health check']);
    }
    return hlCheck('tables', 'Database', 'All tables readable', 'fail',
        count($bad) . ' table(s) cannot be read: ' . implode(', ', array_map(fn($b) => "{$b['table']} ({$b['reason']})", $bad)), ['tables' => $bad]);
}

/**
 * Database structure matches the code: every table and column that the migration
 * files create must exist. The files themselves are the list, so a new migration
 * is checked automatically.
 */
function hlSchema(PDO $db): array {
    $need = [];   // file => [table => [columns]]
    foreach (glob(__DIR__ . '/../*-migration.sql') as $file) {
        $sql = preg_replace('/^\s*--.*$/m', '', file_get_contents($file));
        foreach (preg_split('/;\s*$/m', $sql) as $st) {
            if (preg_match('/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`?(\w+)`?/i', $st, $m)) $need[basename($file)][$m[1]] ??= [];
            if (preg_match('/ALTER\s+TABLE\s+`?(\w+)`?/i', $st, $m) && preg_match_all('/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/i', $st, $cols)) {
                foreach ($cols[1] as $c) $need[basename($file)][$m[1]][] = $c;
            }
        }
    }
    $have = [];
    $missing = [];
    foreach ($need as $file => $tables) {
        foreach ($tables as $t => $cols) {
            if (!array_key_exists($t, $have)) {
                try { $have[$t] = array_column($db->query("SHOW COLUMNS FROM `$t`")->fetchAll(PDO::FETCH_ASSOC), 'Field'); }
                catch (Throwable $e) { $have[$t] = null; }
            }
            if ($have[$t] === null) { $missing[$file][] = "table $t"; continue; }
            foreach (array_unique($cols) as $c) if (!in_array($c, $have[$t], true)) $missing[$file][] = "$t.$c";
        }
    }
    if (!$missing) incidentCleared('database', 'health check', 'Database structure is behind the code (migration not run)');
    if (!$missing) return hlCheck('schema', 'Database', 'Database structure up to date', 'ok', count($need) . ' migration files checked');
    $text = implode('; ', array_map(fn($f, $items) => "$f: " . implode(', ', array_slice($items, 0, 6)) . (count($items) > 6 ? '…' : ''), array_keys($missing), $missing));
    incidentRecord(['category' => 'database', 'severity' => 'error', 'quiet' => true, 'title' => 'Database structure is behind the code (migration not run)',
        'detail' => "Run on the server: php tools/migrate_all_clients.php <file>\n$text", 'source' => 'health check']);
    return hlCheck('schema', 'Database', 'Database structure up to date', 'fail', 'Migrations not run: ' . implode(', ', array_keys($missing)), ['missing' => $missing]);
}

/**
 * Ready for 10+ years: no date column of the old TIMESTAMP type (it cannot hold a date after
 * 19 January 2038 — every new sale would then fail). Fixed by longevity-migration.sql.
 */
function hlLongevity(PDO $db): array {
    $title = 'Some dates cannot go past 2038 (longevity-migration.sql not run)';
    try {
        $tables = array_map(fn($t) => $db->tbl($t), BARMS_TENANT_TABLES);
        $in = implode(',', array_map(fn($t) => $db->quote($t), $tables));
        $old = $db->query("SELECT CONCAT(table_name, '.', column_name) FROM information_schema.columns
                           WHERE table_schema = DATABASE() AND data_type = 'timestamp' AND table_name IN ($in)")->fetchAll(PDO::FETCH_COLUMN);
    } catch (Throwable $e) { return hlCheck('longevity', 'Database', 'Dates ready beyond 2038', 'warn', 'Could not be checked'); }
    if (!$old) { incidentCleared('database', 'health check', $title); return hlCheck('longevity', 'Database', 'Dates ready beyond 2038', 'ok', 'Every date column holds dates up to the year 9999'); }
    incidentRecord(['category' => 'database', 'severity' => 'error', 'quiet' => true, 'title' => $title,
        'detail' => "Run on the server: php tools/migrate_all_clients.php longevity-migration.sql\n" . implode(', ', array_slice($old, 0, 20)), 'source' => 'health check']);
    return hlCheck('longevity', 'Database', 'Dates ready beyond 2038', 'fail', count($old) . ' date column(s) stop on 19 Jan 2038 — run longevity-migration.sql', ['columns' => $old]);
}

/** Records that contradict each other (technical problems — not business discrepancies). */
function hlIntegrity(PDO $db): array {
    $q = function (string $sql) use ($db) { try { return (int)$db->query($sql)->fetchColumn(); } catch (Throwable $e) { return null; } };
    // orders of the last 90 days: these checks run every day, so every order is checked many times while it is recent,
    // without reading years of history on each visit (measured: 39 s → under 1 s on 10 years of orders)
    // order lines are found from the first order of the period (order ids grow with time; if not, more is checked, never less)
    $firstId = (int)($db->query("SELECT COALESCE(MIN(id), 0) FROM orders WHERE created_at >= NOW() - INTERVAL 90 DAY")->fetchColumn() ?: PHP_INT_MAX);
    if ($firstId === PHP_INT_MAX) $firstId = (int)$db->query('SELECT COALESCE(MAX(id), 0) + 1 FROM orders')->fetchColumn();   // no order in 90 days
    $recent = "o.created_at >= NOW() - INTERVAL 90 DAY";
    $defs = [
        ['paid_no_items', 'Orders validated or paid with no items',
         "SELECT COUNT(*) FROM orders o WHERE $recent AND o.status IN ('validated','paid') AND o.voided = 0 AND (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) = 0"],
        ['orphan_items', 'Order lines whose order no longer exists',
         "SELECT COUNT(*) FROM order_items oi WHERE oi.order_id >= $firstId AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = oi.order_id)"],
        ['sale_missing', 'Validated or paid orders whose drinks were never recorded as sold',
         "SELECT COUNT(*) FROM orders o WHERE $recent AND o.status IN ('validated','paid') AND o.voided = 0
            AND (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.source_type = 'bar' AND oi.category <> 'Kitchen') > 0
            AND (SELECT COUNT(*) FROM bar_sales bs WHERE bs.order_id = o.id) = 0"],
        ['sale_duplicated', 'Orders with drinks recorded as sold more times than they were ordered',
         "SELECT COUNT(*) FROM orders o WHERE $recent AND o.voided = 0 AND
            (SELECT COUNT(*) FROM bar_sales bs WHERE bs.order_id = o.id) > (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.source_type = 'bar' AND oi.category <> 'Kitchen')"],
        ['kitchen_duplicated', 'Orders with food recorded as sold more times than it was ordered',
         "SELECT COUNT(*) FROM orders o WHERE $recent AND o.voided = 0 AND
            (SELECT COUNT(*) FROM kitchen_sales ks WHERE ks.order_id = o.id) > (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND (oi.source_type = 'kitchen' OR oi.category = 'Kitchen'))"],
        ['stock_not_deducted', 'Drink sales (since 2 Oct 2026) with no stock deduction',
         "SELECT COUNT(*) FROM bar_sales bs JOIN bar_items bi ON bi.id = bs.product_id AND bi.type = 'direct'
            LEFT JOIN bar_movements bm ON bm.order_number = bs.order_number AND bm.item_id = bs.product_id AND bm.type = 'sale'
            WHERE bs.order_number IS NOT NULL AND bs.sale_date >= GREATEST('2026-10-02', CURDATE() - INTERVAL 90 DAY) AND bm.id IS NULL"],
        ['bad_amounts', 'Paid orders where the discount is larger than the total',
         "SELECT COUNT(*) FROM orders o WHERE $recent AND o.status = 'paid' AND o.discount > o.total"],
        ['recipe_missing_ingredient', 'Recipes using an ingredient that no longer exists',
         "SELECT (SELECT COUNT(*) FROM recipe_ingredients ri WHERE NOT EXISTS (SELECT 1 FROM kitchen_ingredients k WHERE k.id = ri.ingredient_id))
               + (SELECT COUNT(*) FROM bar_recipe_ingredients bri WHERE NOT EXISTS (SELECT 1 FROM bar_ingredients b WHERE b.id = bri.ingredient_id))"],
        ['bad_expense', 'Expenses with a zero or negative amount',
         "SELECT COUNT(*) FROM expenses WHERE voided = 0 AND amount <= 0"],
    ];
    $out = [];
    foreach ($defs as [$key, $label, $sql]) {
        $n = $q($sql);
        if ($n === null) { $out[] = hlCheck("int_$key", 'Records', $label, 'warn', 'Could not be checked'); continue; }
        if ($n === 0) incidentCleared('integrity', 'integrity check', $label);
        if ($n > 0) incidentRecord(['category' => 'integrity', 'severity' => 'error', 'quiet' => true, 'title' => $label,
            'detail' => "$n record(s). Investigate before changing anything — BarMS never edits sales, payments or stock to make records agree.", 'source' => 'integrity check']);
        $out[] = hlCheck("int_$key", 'Records', $label, $n > 0 ? 'fail' : 'ok', $n > 0 ? "$n found" : 'None', ['count' => $n]);
    }
    return $out;
}

/** Business discrepancies: shown so the Owner can act; never corrected automatically. */
function hlBusiness(PDO $db): array {
    $q = function (string $sql) use ($db) { try { return $db->query($sql)->fetch(PDO::FETCH_NUM); } catch (Throwable $e) { return null; } };
    $out = [];
    $neg = $q("SELECT (SELECT COUNT(*) FROM bar_items WHERE type = 'direct' AND stock < 0) + (SELECT COUNT(*) FROM bar_ingredients WHERE quantity < 0) + (SELECT COUNT(*) FROM kitchen_ingredients WHERE quantity < 0)");
    $out[] = hlCheck('biz_negative_stock', 'Business', 'Stock below zero', $neg && $neg[0] > 0 ? 'warn' : 'ok',
        $neg && $neg[0] > 0 ? "{$neg[0]} item(s) — more was sold than the records say was in stock. Do a stock count; it is not changed automatically." : 'None');
    $cash = $q("SELECT COUNT(*), COALESCE(SUM(difference),0) FROM shifts WHERE status = 'closed' AND difference <> 0 AND closed_at > NOW() - INTERVAL 30 DAY");
    $out[] = hlCheck('biz_cash', 'Business', 'Cash drawer differences (30 days)', $cash && $cash[0] > 0 ? 'warn' : 'ok',
        $cash && $cash[0] > 0 ? "{$cash[0]} shift(s), total " . number_format((float)$cash[1]) . " RWF. Reported as counted — never adjusted." : 'Every closed shift matched');
    return $out;
}

/** Writes that started but never confirmed (the server stopped in the middle). */
function hlUnconfirmed(PDO $db): array {
    try { $n = (int)$db->query("SELECT COUNT(*) FROM request_keys WHERE status = 'processing' AND created_at < NOW() - INTERVAL 5 MINUTE")->fetchColumn(); }
    catch (Throwable $e) { return hlCheck('unconfirmed', 'Transactions', 'Unfinished saves', 'warn', 'Not available (run reliability-migration.sql)'); }
    if (!$n) incidentCleared('server', 'health check', 'Saves that started but never finished');
    if ($n) incidentRecord(['category' => 'server', 'severity' => 'warning', 'quiet' => true, 'title' => 'Saves that started but never finished',
        'detail' => "$n request(s) never confirmed. Each was either fully saved or fully undone (transactions); check the related lists.", 'source' => 'health check']);
    return hlCheck('unconfirmed', 'Transactions', 'Unfinished saves', $n ? 'warn' : 'ok', $n ? "$n save(s) never confirmed — check the related lists" : 'None');
}

/** Code version on the server compared with the one this browser runs. */
function hlVersion(?string $clientVersion): array {
    $server = barmsAppVersion();
    if (!$clientVersion) return hlCheck('version', 'Application', 'App version', 'ok', "Server $server");
    return $clientVersion === $server
        ? hlCheck('version', 'Application', 'App version', 'ok', "$server on server and this device", ['server' => $server])
        : hlCheck('version', 'Application', 'App version', 'warn', "This device runs $clientVersion, the server has $server — reload to update", ['server' => $server]);
}

function hlIncidentSummary(PDO $db): array {
    try {
        $rows = $db->query("SELECT severity, COUNT(*) n FROM system_incidents WHERE status IN ('open','recovering') GROUP BY severity")->fetchAll(PDO::FETCH_KEY_PAIR);
    } catch (Throwable $e) { return ['available' => false]; }
    return ['available' => true, 'critical' => (int)($rows['critical'] ?? 0), 'error' => (int)($rows['error'] ?? 0), 'warning' => (int)($rows['warning'] ?? 0), 'info' => (int)($rows['info'] ?? 0)];
}

/** Everything together, plus the overall status. */
function hlStatus(PDO $db, ?string $clientVersion, bool $full = true): array {
    $checks = [hlDatabase($db)];
    if ($checks[0]['status'] !== 'fail') {
        $checks[] = hlTables($db);
        $checks[] = hlSchema($db);
        $checks[] = hlUnconfirmed($db);
        $checks[] = hlVersion($clientVersion);
        if (function_exists('hlBackup')) $checks[] = hlBackup($db);
        if ($full) { $checks = array_merge($checks, [hlLongevity($db)], hlIntegrity($db), hlBusiness($db)); }
    }
    $inc = hlIncidentSummary($db);
    $fail = fn($k) => count(array_filter($checks, fn($c) => $c['key'] === $k && $c['status'] === 'fail')) > 0;
    $technical = array_filter($checks, fn($c) => $c['group'] !== 'Business');
    if ($fail('db') || $fail('tables')) $overall = 'critical';
    elseif (array_filter($technical, fn($c) => $c['status'] === 'fail') || ($inc['critical'] ?? 0) || ($inc['error'] ?? 0)) $overall = 'action_required';
    elseif (array_filter($checks, fn($c) => $c['status'] === 'warn') || ($inc['warning'] ?? 0)) $overall = 'degraded';
    else $overall = 'healthy';
    return ['overall' => $overall, 'checks' => $checks, 'incidents' => $inc, 'serverVersion' => barmsAppVersion(), 'checkedAt' => date('Y-m-d H:i:s')];
}
