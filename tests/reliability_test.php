<?php
// ============================================================
//  tests/reliability_test.php — failure-scenario tests for BarMS
//
//  Run (developer machine with XAMPP):   php tests/reliability_test.php
//
//  Each run copies barms_db into a throwaway database (barms_reltest), runs
//  the REAL endpoints against it through php-cgi (two requests at the same
//  moment where a race is tested), checks money, stock and incidents, and
//  drops the copy at the end. The real database is only read (to copy it).
//
//  Covers: double validate, double pay, lost answer + retry, key reused,
//  double approval, failure in the middle of a sale (rollback), incident
//  grouping and calm messages, integrity detection + automatic clear,
//  missing migration, permissions, missing security token, unfinished saves,
//  backup → verify → tamper → restore.
// ============================================================

$BIN    = getenv('MYSQL_BIN') ?: 'C:/xampp/mysql/bin';
$CGI    = getenv('PHP_CGI') ?: 'C:/xampp/php/php-cgi.exe';
$SRC_DB = 'barms_db';
$DB     = 'barms_reltest';
$ROOT   = realpath(__DIR__ . '/..');
$TMP    = sys_get_temp_dir() . '/barms_reltest_' . getmypid();
@mkdir($TMP . '/sess', 0700, true); @mkdir($TMP . '/backups', 0700, true);

$pass = 0; $fail = 0;
function check(string $name, bool $ok, string $info = ''): void {
    global $pass, $fail;
    if ($ok) { $pass++; echo "  ok   $name\n"; } else { $fail++; echo "  FAIL $name" . ($info !== '' ? " — $info" : '') . "\n"; }
}
function sh(string $cmd): string { return (string)shell_exec($cmd . ' 2>&1'); }

// ── throwaway database ───────────────────────────
echo "== Preparing $DB (copy of $SRC_DB)\n";
sh("\"$BIN/mysql\" -uroot -e \"DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB CHARACTER SET utf8mb4\"");
sh("\"$BIN/mysqldump\" -uroot --single-transaction $SRC_DB > \"$TMP/src.sql\"");
sh("\"$BIN/mysql\" -uroot $DB < \"$TMP/src.sql\"");
foreach (glob("$ROOT/*-migration.sql") as $m) sh("\"$BIN/mysql\" -uroot $DB < \"$m\"");
$pdo = new PDO("mysql:host=localhost;dbname=$DB;charset=utf8mb4", 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$v = fn(string $sql, array $p = []) => (function () use ($pdo, $sql, $p) { $s = $pdo->prepare($sql); $s->execute($p); return $s->fetchColumn(); })();
$x = fn(string $sql, array $p = []) => $pdo->prepare($sql)->execute($p);
$x('DELETE FROM system_incident_events'); $x('DELETE FROM system_incidents'); $x('DELETE FROM request_keys');

// ── calling a real endpoint (php-cgi), one or several at the same moment ──
function start(string $script, string $method, string $action, array $body = [], array $o = []) {
    global $CGI, $ROOT, $DB, $TMP;
    $json = json_encode($body);
    $env = ['BARMS_QA_RUN' => '1', 'QA_DB' => $DB, 'QA_SID' => $o['sid'] ?? '1', 'QA_ROLE' => $o['role'] ?? 'Owner', 'QA_BACKUP_DIR' => "$TMP/backups",
            'REDIRECT_STATUS' => '1', 'REQUEST_METHOD' => $method, 'QUERY_STRING' => 'action=' . $action . (isset($o['query']) ? '&' . $o['query'] : ''),
            'SCRIPT_FILENAME' => "$ROOT/api/$script", 'SCRIPT_NAME' => "/barms/api/$script", 'CONTENT_TYPE' => 'application/json',
            'CONTENT_LENGTH' => (string)strlen($json), 'SystemRoot' => getenv('SystemRoot'), 'TEMP' => getenv('TEMP'), 'PATH' => getenv('PATH')];
    if (!empty($o['key'])) $env['HTTP_X_IDEMPOTENCY_KEY'] = $o['key'];
    if (!empty($o['nocsrf'])) $env['QA_NO_CSRF'] = '1';
    $cmd = "\"$CGI\" -d auto_prepend_file=\"$ROOT/tests/qa_prepend.php\" -d session.save_path=\"$TMP/sess\" -d display_errors=0";
    $p = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, $ROOT, $env);
    fwrite($pipes[0], $method === 'POST' ? $json : ''); fclose($pipes[0]);
    return [$p, $pipes];
}
function finish(array $h): array {
    [$p, $pipes] = $h;
    $out = stream_get_contents($pipes[1]); fclose($pipes[1]); fclose($pipes[2]); proc_close($p);
    [$head, $bodyTxt] = array_pad(preg_split("/\r?\n\r?\n/", $out, 2), 2, '');
    $code = preg_match('/^Status:\s*(\d+)/mi', $head, $m) ? (int)$m[1] : 200;
    return ['code' => $code, 'json' => json_decode(trim($bodyTxt), true), 'raw' => $bodyTxt, 'replay' => stripos($head, 'X-Idempotent-Replay') !== false];
}
function call(...$a): array { return finish(start(...$a)); }
function together(array $calls): array { $h = array_map(fn($c) => start(...$c), $calls); return array_map('finish', $h); }

// a fresh draft order with 2 of a direct bar item
function draftOrder(): array {
    global $pdo, $v, $x;
    $item = $pdo->query("SELECT id, name, stock FROM bar_items WHERE type = 'direct' AND active = 1 ORDER BY id LIMIT 1")->fetch();
    $no = 'REL-' . substr(uniqid(), -6);
    $x("INSERT INTO orders (order_number, type, status, total, created_by) VALUES (?, 'takeaway', 'draft', 2400, 'QA')", [$no]);
    $oid = (int)$v('SELECT id FROM orders WHERE order_number = ?', [$no]);
    $x("INSERT INTO order_items (order_id, product_id, product_name, qty, unit_price, total, source_type, source_id, category, added_by) VALUES (?,?,?,2,1200,2400,'bar',?,'Drink','QA')",
       [$oid, $item['id'], $item['name'], $item['id']]);
    return ['id' => $oid, 'no' => $no, 'item' => (int)$item['id'], 'stock' => (float)$item['stock']];
}

// ════════════════════════════════════════════════
echo "== Duplicate protection (money and stock)\n";
$o = draftOrder();
[$a, $b] = together([['orders.php', 'POST', 'validate', ['orderId' => $o['id']], ['sid' => 'a', 'key' => 'rel-v1-aaaaaaaaaaaaaaaa']],
                     ['orders.php', 'POST', 'validate', ['orderId' => $o['id']], ['sid' => 'b', 'key' => 'rel-v2-bbbbbbbbbbbbbbbb']]]);
check('two validates at once: both answer ok', ($a['json']['ok'] ?? 0) && ($b['json']['ok'] ?? 0), $a['raw'] . ' | ' . $b['raw']);
check('two validates at once: sale recorded once', (int)$v('SELECT COUNT(*) FROM bar_sales WHERE order_id = ?', [$o['id']]) === 1);
check('two validates at once: stock deducted once (−2)', abs((float)$v('SELECT stock FROM bar_items WHERE id = ?', [$o['item']]) - ($o['stock'] - 2)) < 0.001);
check('two validates at once: one stock movement', (int)$v("SELECT COUNT(*) FROM bar_movements WHERE order_number = ? AND type = 'sale'", [$o['no']]) === 1);
$r = call('orders.php', 'POST', 'validate', ['orderId' => $o['id']], ['key' => 'rel-v3-cccccccccccccccc']);
check('validating a validated order again changes nothing', ($r['json']['alreadyDone'] ?? false) && (int)$v('SELECT COUNT(*) FROM bar_sales WHERE order_id = ?', [$o['id']]) === 1);

[$a, $b] = together([['orders.php', 'POST', 'pay', ['orderId' => $o['id'], 'paymentMethod' => 'Cash'], ['sid' => 'a', 'key' => 'rel-p1-aaaaaaaaaaaaaaaa']],
                     ['orders.php', 'POST', 'pay', ['orderId' => $o['id'], 'paymentMethod' => 'Cash'], ['sid' => 'b', 'key' => 'rel-p2-bbbbbbbbbbbbbbbb']]]);
check('two payments at once: both answer ok with the same amount', ($a['json']['paid'] ?? null) === ($b['json']['paid'] ?? -1), $a['raw'] . ' | ' . $b['raw']);
check('two payments at once: one payment recorded', (int)$v("SELECT COUNT(*) FROM audit_log WHERE action_type = 'PAYMENT' AND details LIKE ?", ["%{$o['no']}%"]) === 1);
$r = call('orders.php', 'POST', 'pay', ['orderId' => $o['id'], 'paymentMethod' => 'Cash'], ['sid' => 'a', 'key' => 'rel-p1-aaaaaaaaaaaaaaaa']);
check('lost answer, same key retried: stored answer replayed', $r['replay'] && ($r['json']['ok'] ?? false));
check('lost answer, same key retried: still one payment', (int)$v("SELECT COUNT(*) FROM audit_log WHERE action_type = 'PAYMENT' AND details LIKE ?", ["%{$o['no']}%"]) === 1);
$r = call('cashbook.php', 'POST', 'add', ['type' => 'capital', 'amount' => 1, 'note' => 'x'], ['key' => 'rel-p1-aaaaaaaaaaaaaaaa']);
check('a key cannot be reused for another action', $r['code'] === 409);
$x("INSERT INTO request_keys (idem_key, endpoint, status, created_at) VALUES ('rel-stuck-dddddddddddddd', 'cashbook.php?add', 'processing', NOW() - INTERVAL 10 MINUTE)");
$r = call('cashbook.php', 'POST', 'add', ['type' => 'capital', 'amount' => 1, 'note' => 'x'], ['key' => 'rel-stuck-dddddddddddddd']);
check('a save that never finished is not run again blindly (asks to check)', $r['code'] === 409 && ($r['json']['unconfirmed'] ?? false));

echo "== Old item list (retired): nothing new is sold from it, its last bill and offline sales stay safe\n";
$x("INSERT INTO tables (name, status, active) VALUES ('REL table', 'free', 1)");
$tid = (int)$pdo->lastInsertId();
$prod = $pdo->query('SELECT id, name, stock FROM products ORDER BY stock DESC LIMIT 1')->fetch();
$r = call('sessions.php', 'POST', 'open_session', ['tableId' => $tid], ['key' => 'rel-os1-aaaaaaaaaaaaaaa']);
check('opening an old-style table session is refused', $r['code'] === 410 && (int)$v("SELECT COUNT(*) FROM table_sessions WHERE table_id = ?", [$tid]) === 0, $r['raw']);
$r = call('sales.php', 'POST', 'quick', ['items' => [['id' => (int)$prod['id'], 'qty' => 1]]], ['key' => 'rel-qs1-aaaaaaaaaaaaaaa']);
check('the old Quick Sale is refused', $r['code'] === 410);
// an old bill opened before the retirement can still be paid — and only once
$x("INSERT INTO table_sessions (table_id, table_name, opened_by, status, total) VALUES (?, 'REL table', 'QA', 'open', 3000)", [$tid]);
$sid = (int)$pdo->lastInsertId();
$x("INSERT INTO table_session_items (session_id, product_id, product_name, qty, unit_price, total, added_by) VALUES (?,?,?,2,1500,3000,'QA')", [$sid, $prod['id'], $prod['name']]);
$r = call('sessions.php', 'POST', 'add_item', ['sessionId' => $sid, 'productId' => (int)$prod['id'], 'qty' => 1], ['key' => 'rel-ai1-aaaaaaaaaaaaaaa']);
check('nothing can be added to the old bill', $r['code'] === 410 && (int)$v('SELECT COUNT(*) FROM table_session_items WHERE session_id = ?', [$sid]) === 1);
[$a, $b] = together([['sessions.php', 'POST', 'close_session', ['sessionId' => $sid, 'paymentMethod' => 'Cash'], ['sid' => 'a', 'key' => 'rel-cs1-aaaaaaaaaaaaaaa']],
                     ['sessions.php', 'POST', 'close_session', ['sessionId' => $sid, 'paymentMethod' => 'Cash'], ['sid' => 'b', 'key' => 'rel-cs2-bbbbbbbbbbbbbbb']]]);
check('paying the old bill twice at once: both answer with the receipt', ($a['json']['ok'] ?? 0) && ($b['json']['ok'] ?? 0) && ($a['json']['total'] ?? 1) == ($b['json']['total'] ?? 2), $a['raw'] . ' | ' . $b['raw']);
check('…and the sale is recorded once', (int)$v("SELECT COUNT(*) FROM audit_log WHERE action_type = 'SALE' AND details LIKE '%REL table%'") === 1);
$stock0 = (int)$v('SELECT stock FROM products WHERE id = ?', [$prod['id']]);
[$a, $b] = together([['sales.php', 'POST', 'record', ['productId' => (int)$prod['id'], 'qty' => 1, 'clientUuid' => 'rel-offline-sale-1'], ['sid' => 'a', 'key' => 'rel-sr1-aaaaaaaaaaaaaaa']],
                     ['sales.php', 'POST', 'record', ['productId' => (int)$prod['id'], 'qty' => 1, 'clientUuid' => 'rel-offline-sale-1'], ['sid' => 'b', 'key' => 'rel-sr2-bbbbbbbbbbbbbbb']]]);
check('an offline sale saved before the retirement still syncs (twice at once: both ok)', ($a['json']['ok'] ?? 0) && ($b['json']['ok'] ?? 0), $a['raw'] . ' | ' . $b['raw']);
check('…and it is stored once, stock −1 once', (int)$v("SELECT COUNT(*) FROM sales WHERE client_uuid = 'rel-offline-sale-1'") === 1 && (int)$v('SELECT stock FROM products WHERE id = ?', [$prod['id']]) === $stock0 - 1);
$saleId = (int)$v("SELECT id FROM sales WHERE client_uuid = 'rel-offline-sale-1'");
[$a, $b] = together([['sales.php', 'POST', 'void', ['id' => $saleId], ['sid' => 'a', 'key' => 'rel-sv1-aaaaaaaaaaaaaaa']],
                     ['sales.php', 'POST', 'void', ['id' => $saleId], ['sid' => 'b', 'key' => 'rel-sv2-bbbbbbbbbbbbbbb']]]);
check('voiding a Quick Sale twice at once gives the stock back once', (int)$v('SELECT stock FROM products WHERE id = ?', [$prod['id']]) === $stock0, $a['raw'] . ' | ' . $b['raw']);

echo "== Version\n";
$page = @file_get_contents('http://localhost/barms/index.php');
check('the page carries the version from version.txt', $page !== false && preg_match('/name="barms-version" content="([^"]+)"/', $page, $vm) && $vm[1] === trim(file_get_contents("$ROOT/version.txt")));
check('no other file hard-codes the app version', !preg_match("/(BARMS_CLIENT_VERSION|BARMS_VERSION)\s*=\s*'\d/", file_get_contents("$ROOT/assets/js/health.js") . file_get_contents("$ROOT/assets/js/sync.js")));

echo "== Approvals\n";
$x("INSERT INTO expenses (description, category, amount, expense_date, recorded_by) VALUES ('REL expense', 'General', 5000, CURDATE(), 'QA')");
$eid = (int)$pdo->lastInsertId();
$x("INSERT INTO void_requests (type, ref_id, label, amount, reason, requested_by, status) VALUES ('expense', ?, 'REL void', 5000, 'test', 'Someone', 'Pending')", [$eid]);
$vid = (int)$pdo->lastInsertId();
[$a, $b] = together([['misc.php', 'POST', 'void_request_approve', ['id' => $vid], ['sid' => 'a', 'key' => 'rel-va-aaaaaaaaaaaaaaaa']],
                     ['misc.php', 'POST', 'void_request_approve', ['id' => $vid], ['sid' => 'b', 'key' => 'rel-vb-bbbbbbbbbbbbbbbb']]]);
check('two approvals at once: exactly one goes through', (int)(($a['json']['ok'] ?? 0) xor ($b['json']['ok'] ?? 0)) === 1, $a['raw'] . ' | ' . $b['raw']);
check('two approvals at once: one approval recorded', (int)$v("SELECT COUNT(*) FROM audit_log WHERE action_type = 'VOID' AND details LIKE '%REL void%'") === 1);

echo "== Failure in the middle of a sale (rollback)\n";
$o = draftOrder();
$x('RENAME TABLE bar_movements TO bar_movements_off');
$r = call('orders.php', 'POST', 'validate', ['orderId' => $o['id']], ['key' => 'rel-fail-eeeeeeeeeeeeeee']);
$x('RENAME TABLE bar_movements_off TO bar_movements');
check('the failed sale answers with an error', $r['code'] === 500 && !($r['json']['ok'] ?? true));
check('the message is calm (no database text) and has a reference', !preg_match('/SQLSTATE|PDO|Table/i', $r['json']['error'] ?? 'SQLSTATE') && preg_match('/BRMS-\d{8}-\d+/', $r['json']['error'] ?? ''), $r['json']['error'] ?? $r['raw']);
check('nothing half-saved: order still a draft', $v('SELECT status FROM orders WHERE id = ?', [$o['id']]) === 'draft');
check('nothing half-saved: no sale line', (int)$v('SELECT COUNT(*) FROM bar_sales WHERE order_id = ?', [$o['id']]) === 0);
check('nothing half-saved: stock unchanged', abs((float)$v('SELECT stock FROM bar_items WHERE id = ?', [$o['item']]) - $o['stock']) < 0.001);
check('the failed key was released (a retry can run)', (int)$v("SELECT COUNT(*) FROM request_keys WHERE idem_key = 'rel-fail-eeeeeeeeeeeeeee'") === 0);
$r = call('orders.php', 'POST', 'validate', ['orderId' => $o['id']], ['key' => 'rel-fail-eeeeeeeeeeeeeee']);
check('after the problem is gone the same retry succeeds once', ($r['json']['ok'] ?? false) && (int)$v('SELECT COUNT(*) FROM bar_sales WHERE order_id = ?', [$o['id']]) === 1);

echo "== Incidents\n";
$x('RENAME TABLE kitchen_expenses TO kitchen_expenses_off');
$r1 = call('misc.php', 'GET', 'dashboard'); $r2 = call('misc.php', 'GET', 'dashboard'); $r3 = call('misc.php', 'GET', 'dashboard');
$x('RENAME TABLE kitchen_expenses_off TO kitchen_expenses');
$inc = $pdo->query("SELECT * FROM system_incidents WHERE source = 'misc.php?dashboard' AND category = 'database'")->fetchAll();
check('repeated failure → one incident', count($inc) === 1, count($inc) . ' incidents');
check('repeated failure → counted 3 times', (int)($inc[0]['occurrences'] ?? 0) === 3);
check('every answer carries the same reference', ($r1['json']['ref'] ?? 1) === ($r3['json']['ref'] ?? 2) && ($r1['json']['ref'] ?? '') === ($inc[0]['ref'] ?? '-'));
check('staff message names no table', strpos($r1['json']['error'] ?? 'kitchen_expenses', 'kitchen_expenses') === false);
check('the Owner was notified once', (int)$v("SELECT COUNT(*) FROM notifications WHERE message LIKE ?", ['%' . ($inc[0]['ref'] ?? 'none') . '%']) === 1);
check('dashboard works again when the table is back', call('misc.php', 'GET', 'dashboard')['json']['ok'] ?? false);

echo "== Health checks\n";
$st = call('health.php', 'GET', 'status', [], ['query' => 'full=1&clientVersion=1.0.0'])['json']['data'] ?? [];
$chk = fn($data, $k) => array_values(array_filter($data['checks'] ?? [], fn($c) => $c['key'] === $k))[0]['status'] ?? null;
check('status answers with an overall state', in_array($st['overall'] ?? '', ['healthy', 'degraded', 'action_required', 'critical'], true));
check('all tables readable', $chk($st, 'tables') === 'ok');
check('database structure up to date', $chk($st, 'schema') === 'ok');
$sale = $pdo->query("SELECT bs.* FROM bar_sales bs JOIN orders o ON o.id = bs.order_id WHERE o.status = 'paid' LIMIT 1")->fetch();
$x('INSERT INTO bar_sales (product_id, product_name, qty, unit_price, total, sold_by, order_id, order_number, sale_date, sale_time) VALUES (?,?,?,?,?,?,?,?,?,?)',
   [$sale['product_id'], $sale['product_name'], $sale['qty'], $sale['unit_price'], $sale['total'], 'QA', $sale['order_id'], $sale['order_number'], $sale['sale_date'], $sale['sale_time']]);
$dup = (int)$pdo->lastInsertId();
$st = call('health.php', 'GET', 'status')['json']['data'] ?? [];
check('a duplicated sale line is detected', $chk($st, 'int_sale_duplicated') === 'fail');
check('…and becomes an integrity incident', (int)$v("SELECT COUNT(*) FROM system_incidents WHERE category = 'integrity' AND status = 'open'") === 1);
check('…and the sale data is NOT changed by the check', (int)$v('SELECT COUNT(*) FROM bar_sales WHERE id = ?', [$dup]) === 1);
$x('DELETE FROM bar_sales WHERE id = ?', [$dup]);
$st = call('health.php', 'GET', 'status')['json']['data'] ?? [];
check('fixed by a person → the incident closes by itself', $chk($st, 'int_sale_duplicated') === 'ok' && (int)$v("SELECT COUNT(*) FROM system_incidents WHERE category = 'integrity' AND status = 'open'") === 0);
$x('ALTER TABLE orders DROP COLUMN discount_rules');
$st = call('health.php', 'GET', 'status', [], ['query' => 'full=0'])['json']['data'] ?? [];
check('a migration not run is detected', $chk($st, 'schema') === 'fail' && ($st['overall'] ?? '') !== 'healthy');
$x('ALTER TABLE orders ADD COLUMN discount_rules VARCHAR(255) NULL');

echo "== Permissions and security\n";
check('a bartender cannot see System Health', call('health.php', 'GET', 'status', [], ['role' => 'Bartender', 'sid' => 'bt'])['code'] === 403);
check('a manager cannot make or download backups', call('health.php', 'POST', 'backup', [], ['role' => 'Manager', 'sid' => 'mg'])['code'] === 403);
check('a write without the security token is refused', call('misc.php', 'POST', 'void_request_reject', ['id' => 1], ['nocsrf' => 1, 'sid' => 'nc'])['code'] === 403);

echo "== Long-term storage (10+ years)\n";
check('no date column stops in 2038 (no TIMESTAMP columns left)', (int)$v("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND data_type = 'timestamp'") === 0);
$x("INSERT INTO audit_log (action_type, details, done_by, time, done_at) VALUES ('REL2040', 'after 2038', 'QA', '2040-03-01 10:00:00', '2040-03-01 10:00:00')");
check('a record dated 2040 is stored and read back unchanged', $v("SELECT done_at FROM audit_log WHERE action_type = 'REL2040'") === '2040-03-01 10:00:00');
$x("DELETE FROM audit_log WHERE action_type = 'REL2040'");
$before = (int)$v('SELECT COUNT(*) FROM orders');
[$a, $b] = together([['orders.php', 'POST', 'create', ['type' => 'takeaway'], ['sid' => 'a', 'key' => 'rel-oc1-aaaaaaaaaaaaaaa']],
                     ['orders.php', 'POST', 'create', ['type' => 'takeaway'], ['sid' => 'b', 'key' => 'rel-oc2-bbbbbbbbbbbbbbb']]]);
$na = $a['json']['orderNumber'] ?? 'x'; $nb = $b['json']['orderNumber'] ?? 'x';
check('two orders created at the same moment: both saved, different numbers', ($a['json']['ok'] ?? 0) && ($b['json']['ok'] ?? 0) && $na !== $nb && (int)$v('SELECT COUNT(*) FROM orders') === $before + 2, $a['raw'] . ' | ' . $b['raw']);
$tk = $pdo->query("SELECT table_name FROM orders WHERE order_number IN ('$na', '$nb')")->fetchAll(PDO::FETCH_COLUMN);
check('…and different takeaway numbers', count(array_unique($tk)) === 2, implode(',', $tk));
$x("UPDATE counters SET value = value - 5 WHERE name = 'order'");   // as after restoring an older backup
$r = call('orders.php', 'POST', 'create', ['type' => 'takeaway'], ['key' => 'rel-oc3-ccccccccccccccc']);
check('order counter behind the records (restored backup): the next order still saves with a new number',
      ($r['json']['ok'] ?? 0) && (int)$v('SELECT COUNT(*) FROM orders WHERE order_number = ?', [$r['json']['orderNumber'] ?? '']) === 1, $r['raw']);
$x("INSERT INTO customer_debts (customer_name, amount, debt_date, status, recorded_by) VALUES ('REL old unpaid', 700, '2023-01-05', 'Pending', 'QA'), ('REL old paid', 800, '2023-01-05', 'Paid', 'QA')");
$names = array_column(call('misc.php', 'GET', 'cust_debts_list')['json']['data'] ?? [], 'customerName');
check('an unpaid debt from years ago is always listed; an old paid one is not', in_array('REL old unpaid', $names, true) && !in_array('REL old paid', $names, true));
$x("INSERT INTO expenses (description, category, amount, payment_method, expense_date, recorded_by) VALUES ('REL old expense', 'General', 900, 'Cash', '2023-02-10', 'QA')");
$exp = array_column(call('expenses.php', 'GET', 'list')['json']['data'] ?? [], 'desc');
$rep = call('misc.php', 'GET', 'report', [], ['query' => 'type=range&from=2023-02-01&to=2023-02-28'])['json']['data'] ?? [];
check('an expense from years ago leaves the Expenses list but stays in its report', !in_array('REL old expense', $exp, true) && in_array('REL old expense', array_column($rep['expenses'] ?? [], 'desc'), true));
$d = call('misc.php', 'GET', 'report', [], ['query' => 'type=daily&date=2026-10-03'])['json']['data'] ?? [];
$m = call('misc.php', 'GET', 'report', [], ['query' => 'type=monthly&month=2026-02'])['json']['data'] ?? [];
check('daily and monthly reports state their own period', ($d['from'] ?? '') === '2026-10-03' && ($d['to'] ?? '') === '2026-10-03' && ($m['from'] ?? '') === '2026-02-01' && ($m['to'] ?? '') === '2026-02-28');
$jan = date('Y') . '-01-15';
$x("INSERT INTO bar_sales (product_id, product_name, qty, unit_price, total, sold_by, order_id, order_number, sale_date, sale_time) VALUES (1, 'REL jan', 1, 1000, 1000, 'QA', 0, 'REL-JAN', ?, '12:00:00')", [$jan]);
$mo = array_column(call('misc.php', 'GET', 'dashboard')['json']['data']['monthlySales'] ?? [], 'mo');
check('Charts get every month of this year (January included)', in_array(date('Y') . '-01', $mo, true), implode(',', $mo));

echo "== Backups\n";
$r = call('health.php', 'POST', 'backup');
check('a backup is made and verified', ($r['json']['ok'] ?? false) && ($r['json']['data']['rows'] ?? 0) > 0, $r['raw']);
$file = "$TMP/backups/" . ($r['json']['data']['file'] ?? 'x');
check('the test backup is written outside the real backups folder', is_file($file) && !is_file("$ROOT/backups/db/" . basename($file)));
require_once "$ROOT/config/db.php"; require_once "$ROOT/api/health_lib.php"; require_once "$ROOT/api/backup_lib.php";
$manifest = json_decode(file_get_contents(preg_replace('/\.sql\.gz$/', '.json', $file)), true);
copy($file, "$file.keep"); file_put_contents($file, 'x', FILE_APPEND);
check('a damaged backup fails its check', !backupVerify($file, $manifest)['ok']);
rename("$file.keep", $file);
check('the undamaged backup passes its check', backupVerify($file, $manifest)['ok']);
sh("\"$BIN/mysql\" -uroot -e \"DROP DATABASE IF EXISTS {$DB}_restore; CREATE DATABASE {$DB}_restore CHARACTER SET utf8mb4\"");
$sql = gzdecode(file_get_contents($file)); file_put_contents("$TMP/restore.sql", $sql);
sh("\"$BIN/mysql\" -uroot {$DB}_restore < \"$TMP/restore.sql\"");
$restored = new PDO("mysql:host=localhost;dbname={$DB}_restore;charset=utf8mb4", 'root', '');
$diff = [];
foreach ($manifest['counts'] as $t => $n) { if ($n === null) continue; $got = (int)$restored->query("SELECT COUNT(*) FROM `$t`")->fetchColumn(); if ($got !== $n) $diff[] = "$t $got/$n"; }
check('the backup restores into an empty database with every row', !$diff, implode(', ', $diff));
sh("\"$BIN/mysql\" -uroot -e \"DROP DATABASE {$DB}_restore\"");

// ── clean up ─────────────────────────────────────
sh("\"$BIN/mysql\" -uroot -e \"DROP DATABASE $DB\"");
foreach (array_merge(glob("$TMP/sess/*") ?: [], glob("$TMP/backups/*") ?: [], glob("$TMP/*.sql") ?: []) as $f) @unlink($f);
@rmdir("$TMP/sess"); @rmdir("$TMP/backups"); @rmdir($TMP);
echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
