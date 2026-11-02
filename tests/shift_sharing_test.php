<?php
// ============================================================
//  tests/shift_sharing_test.php — selling inside someone else's open cash shift
//
//  Run (developer machine with XAMPP, MySQL running):   php tests/shift_sharing_test.php
//
//  Rule: a Bartender or Manager with no shift of their own may take payments while someone
//  else's shift is open; the money is counted in that shift and the order, the audit log and
//  the shift say so. With no shift open at all a Bartender cannot take payments. The Owner
//  never lands in someone else's drawer.
//  Uses a throwaway copy of barms_db (barms_sharetest); the real database is only read.
// ============================================================

$BIN    = getenv('MYSQL_BIN') ?: 'C:/xampp/mysql/bin';
$CGI    = getenv('PHP_CGI') ?: 'C:/xampp/php/php-cgi.exe';
$SRC_DB = 'barms_db';
$DB     = 'barms_sharetest';
$ROOT   = realpath(__DIR__ . '/..');
$TMP    = sys_get_temp_dir() . '/barms_sharetest_' . getmypid();
@mkdir($TMP . '/sess', 0700, true);

$pass = 0; $fail = 0;
function check(string $name, bool $ok, string $info = ''): void {
    global $pass, $fail;
    if ($ok) { $pass++; echo "  ok   $name\n"; } else { $fail++; echo "  FAIL $name" . ($info !== '' ? " — $info" : '') . "\n"; }
}
function sh(string $cmd): string { return (string)shell_exec($cmd . ' 2>&1'); }

echo "== Preparing $DB (copy of $SRC_DB)\n";
sh("\"$BIN/mysql\" -uroot -e \"DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB CHARACTER SET utf8mb4\"");
sh("\"$BIN/mysqldump\" -uroot --single-transaction $SRC_DB > \"$TMP/src.sql\"");
sh("\"$BIN/mysql\" -uroot $DB < \"$TMP/src.sql\"");
foreach (glob("$ROOT/*-migration.sql") as $m) sh("\"$BIN/mysql\" -uroot $DB < \"$m\"");
$pdo = new PDO("mysql:host=localhost;dbname=$DB;charset=utf8mb4", 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$v = fn(string $sql, array $p = []) => (function () use ($pdo, $sql, $p) { $s = $pdo->prepare($sql); $s->execute($p); return $s->fetchColumn(); })();
$x = fn(string $sql, array $p = []) => $pdo->prepare($sql)->execute($p);

function start(string $script, string $method, string $action, array $body = [], array $o = []) {
    global $CGI, $ROOT, $DB, $TMP;
    $json = json_encode($body);
    $env = ['BARMS_QA_RUN' => '1', 'QA_DB' => $DB, 'QA_SID' => $o['sid'] ?? '1', 'QA_ROLE' => $o['role'] ?? 'Owner', 'QA_UID' => (string)($o['uid'] ?? 1), 'QA_NAME' => $o['name'] ?? '', 'QA_OFFLINE_AT' => isset($o['offlineAt']) ? (string)$o['offlineAt'] : '',
            'REDIRECT_STATUS' => '1', 'REQUEST_METHOD' => $method, 'QUERY_STRING' => 'action=' . $action . (isset($o['query']) ? '&' . $o['query'] : ''),
            'SCRIPT_FILENAME' => "$ROOT/api/$script", 'SCRIPT_NAME' => "/barms/api/$script", 'CONTENT_TYPE' => 'application/json',
            'CONTENT_LENGTH' => (string)strlen($json), 'SystemRoot' => getenv('SystemRoot'), 'TEMP' => getenv('TEMP'), 'PATH' => getenv('PATH')];
    if (!empty($o['key'])) $env['HTTP_X_IDEMPOTENCY_KEY'] = $o['key'];
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
    return ['code' => $code, 'json' => json_decode(trim($bodyTxt), true), 'raw' => $bodyTxt];
}
function call(...$a): array { return finish(start(...$a)); }

$A = ['uid' => 101, 'name' => 'Alice Bartender', 'role' => 'Bartender', 'sid' => 'alice'];
$B = ['uid' => 102, 'name' => 'Bob Bartender',   'role' => 'Bartender', 'sid' => 'bob'];
$M = ['uid' => 103, 'name' => 'Mary Manager',    'role' => 'Manager',   'sid' => 'mary'];
$O = ['uid' => 1,   'name' => 'The Owner',       'role' => 'Owner',     'sid' => 'owner'];
$x('DELETE FROM shifts');
$n = 0;
// a validated order of 2,400 RWF, ready to be paid
function order(): int {
    global $x, $v; static $n = 0; $n++;
    $no = 'SHR-' . uniqid();
    $x("INSERT INTO orders (order_number, type, status, total, created_by) VALUES (?, 'takeaway', 'validated', 2400, 'QA')", [$no]);
    return (int)$v('SELECT id FROM orders WHERE order_number = ?', [$no]);
}
$k = 0; $key = function () use (&$k) { return 'shr-key-' . (++$k) . '-aaaaaaaaaaaaaaaa'; };

echo "== No shift open anywhere\n";
$o1 = order();
$r = call('orders.php', 'POST', 'pay', ['orderId' => $o1, 'paymentMethod' => 'Cash'], $B + ['key' => $key()]);
check('a Bartender cannot take payment when no shift is open (403, needShift)', $r['code'] === 403 && ($r['json']['needShift'] ?? false), $r['raw']);
check('…and the order is still unpaid', $v('SELECT status FROM orders WHERE id = ?', [$o1]) === 'validated');
$r = call('shifts.php', 'GET', 'current', [], $B);
check('current: no shift of his own, nobody else open (others is empty)', ($r['json']['ok'] ?? false) && $r['json']['shift'] === null && $r['json']['others'] === [], $r['raw']);

echo "== Alice opens a shift; Bob sells in it\n";
$r = call('shifts.php', 'POST', 'open', ['openingFloat' => 1000, 'device' => 'Android'], $A + ['key' => $key()]);
check('Alice opens a shift with RWF 1,000', ($r['json']['ok'] ?? false), $r['raw']);
$aliceShift = (int)$v("SELECT id FROM shifts WHERE user_id = 101 AND status = 'open'");
$r = call('shifts.php', 'GET', 'current', [], $B);
check('Bob sees Alice\'s open shift (others), and has none of his own', $r['json']['shift'] === null && count($r['json']['others']) === 1 && $r['json']['others'][0]['userName'] === 'Alice Bartender' && $r['json']['others'][0]['id'] === $aliceShift, $r['raw']);
$r = call('shifts.php', 'GET', 'current', [], $A);
check('Alice does not list her own shift under others', $r['json']['others'] === [] && $r['json']['shift']['id'] === $aliceShift);

$r = call('orders.php', 'POST', 'pay', ['orderId' => $o1, 'paymentMethod' => 'Cash'], $B + ['key' => $key()]);
check('Bob takes payment while Alice\'s shift is open', ($r['json']['ok'] ?? false) && ($r['json']['paid'] ?? 0) == 2400, $r['raw']);
check('the answer says it was in Alice\'s shift', ($r['json']['inShiftOf'] ?? null) === 'Alice Bartender');
check('the order is counted in Alice\'s shift, paid by Bob', (int)$v('SELECT shift_id FROM orders WHERE id = ?', [$o1]) === $aliceShift && $v('SELECT paid_by FROM orders WHERE id = ?', [$o1]) === 'Bob Bartender');
check('the audit log says so', (int)$v("SELECT COUNT(*) FROM audit_log WHERE action_type = 'PAYMENT' AND done_by = 'Bob Bartender' AND details LIKE '%counted in Alice Bartender%shift%'") === 1);

$o2 = order();
$r = call('orders.php', 'POST', 'pay', ['orderId' => $o2, 'paymentMethod' => 'Cash'], $A + ['key' => $key()]);
check('Alice paying in her own shift is not marked', ($r['json']['ok'] ?? false) && (array_key_exists('inShiftOf', $r['json']) && $r['json']['inShiftOf'] === null));
check('…and no "counted in" note in the audit log', (int)$v("SELECT COUNT(*) FROM audit_log WHERE action_type = 'PAYMENT' AND done_by = 'Alice Bartender' AND details LIKE '%counted in%'") === 0);

echo "== The order, the list and the shift show it\n";
$r = call('orders.php', 'GET', 'get', [], $O + ['query' => "orderId=$o1"]);
check('order details: paid by Bob, in Alice\'s shift', ($r['json']['order']['paidBy'] ?? '') === 'Bob Bartender' && ($r['json']['order']['shiftOwner'] ?? '') === 'Alice Bartender', $r['raw']);
$r = call('orders.php', 'GET', 'get', [], $O + ['query' => "orderId=$o2"]);
check('order details: own shift = not marked', (array_key_exists('shiftOwner', $r['json']['order']) && $r['json']['order']['shiftOwner'] === null));
$r = call('orders.php', 'GET', 'list', [], $O + ['query' => 'status=paid']);
$byId = array_column($r['json']['data'] ?? [], null, 'id');
check('paid list: marked for Bob\'s order, not for Alice\'s', ($byId[$o1]['shiftOwner'] ?? null) === 'Alice Bartender' && array_key_exists($o2, $byId) && $byId[$o2]['shiftOwner'] === null, $r['raw']);
$r = call('orders.php', 'GET', 'list', [], $O + ['query' => 'status=open']);
check('open list still works', ($r['json']['ok'] ?? false));
$r = call('shifts.php', 'GET', 'current', [], $A);
$c = $r['json']['shift']['cash'] ?? [];
check('Alice\'s shift: 2 orders, 1 of them paid by someone else (RWF 2,400 cash)', ($c['orders'] ?? 0) === 2 && ($c['othersOrders'] ?? 0) === 1 && ($c['othersCash'] ?? 0) == 2400, json_encode($c));
check('expected cash = 1,000 + 2,400 + 2,400 (the shared sale is in her drawer count)', ($c['expected'] ?? 0) == 5800, json_encode($c));

echo "== The Owner, Managers, and two shifts\n";
$o3 = order();
$r = call('orders.php', 'POST', 'pay', ['orderId' => $o3, 'paymentMethod' => 'Cash'], $O + ['key' => $key()]);
check('the Owner pays with no shift of their own: no shift (never in Alice\'s drawer)', ($r['json']['ok'] ?? false) && $v('SELECT shift_id FROM orders WHERE id = ?', [$o3]) === null && (array_key_exists('inShiftOf', $r['json']) && $r['json']['inShiftOf'] === null), $r['raw']);
$o4 = order();
$r = call('orders.php', 'POST', 'pay', ['orderId' => $o4, 'paymentMethod' => 'MoMo'], $M + ['key' => $key()]);
check('a Manager with no shift sells in Alice\'s shift', ($r['json']['ok'] ?? false) && (int)$v('SELECT shift_id FROM orders WHERE id = ?', [$o4]) === $aliceShift && ($r['json']['inShiftOf'] ?? '') === 'Alice Bartender', $r['raw']);
$r = call('shifts.php', 'GET', 'current', [], $A);
$c = $r['json']['shift']['cash'];
check('a MoMo sale by someone else is in the count but adds no cash', $c['othersOrders'] === 2 && $c['othersCash'] == 2400 && $c['expected'] == 5800, json_encode($c));

$r = call('shifts.php', 'POST', 'open', ['openingFloat' => 500, 'device' => 'iPhone'], $B + ['key' => $key()]);
$bobShift = (int)$v("SELECT id FROM shifts WHERE user_id = 102 AND status = 'open'");
check('Bob opens his own shift', $bobShift > 0 && $bobShift !== $aliceShift, $r['raw']);
$o5 = order();
call('orders.php', 'POST', 'pay', ['orderId' => $o5, 'paymentMethod' => 'Cash'], $B + ['key' => $key()]);
check('with a shift of his own, Bob sells in it (not in Alice\'s, who opened first)', (int)$v('SELECT shift_id FROM orders WHERE id = ?', [$o5]) === $bobShift);
$o6 = order();
call('orders.php', 'POST', 'pay', ['orderId' => $o6, 'paymentMethod' => 'Cash'], $M + ['key' => $key()]);
check('with two shifts open, a Manager without one sells in the latest (Bob\'s)', (int)$v('SELECT shift_id FROM orders WHERE id = ?', [$o6]) === $bobShift);

echo "== Closing shifts\n";
$r = call('shifts.php', 'POST', 'close', ['countedCash' => 5800, 'note' => ''], $A + ['key' => $key()]);
check('Alice closes: the shared sale was in her count, so it matches', ($r['json']['ok'] ?? false) && ($r['json']['difference'] ?? 1) == 0, $r['raw']);
$o7 = order();
$r = call('orders.php', 'POST', 'pay', ['orderId' => $o7, 'paymentMethod' => 'Cash'], $M + ['key' => $key()]);
check('after Alice closed, a Manager sells in Bob\'s shift (still open)', (int)$v('SELECT shift_id FROM orders WHERE id = ?', [$o7]) === $bobShift);
$r = call('shifts.php', 'POST', 'close', ['countedCash' => 500 + 2400 + 2400 + 2400, 'note' => ''], $B + ['key' => $key()]);
check('Bob closes: his own sale and both of the Manager\'s sales are in his count', ($r['json']['ok'] ?? false) && ($r['json']['difference'] ?? 1) == 0, $r['raw']);
$o8 = order();
$r = call('orders.php', 'POST', 'pay', ['orderId' => $o8, 'paymentMethod' => 'Cash'], $B + ['key' => $key()]);
check('with every shift closed, a Bartender cannot take payment again (403)', $r['code'] === 403 && ($r['json']['needShift'] ?? false));
$r = call('shifts.php', 'GET', 'list', [], $O + ['query' => 'preset=today']);
$rows = array_column($r['json']['data'] ?? [], null, 'id');
check('the shift report carries the "paid by others" figures', ($rows[$aliceShift]['breakdown']['othersOrders'] ?? -1) === 2 && ($rows[$bobShift]['breakdown']['othersOrders'] ?? -1) === 2, $r['raw']);

echo "== Offline payments (taken at a past time)\n";
// the function under test, as written in api/orders.php
preg_match('/function ordShiftAt\(.*?\n}\n/s', file_get_contents("$ROOT/api/orders.php"), $fm);
function currentShiftId(): ?int { return null; }
eval($fm[0]);
$x('DELETE FROM shifts');
$x("INSERT INTO shifts (id, user_id, user_name, opening_float, opened_at, closed_at, status) VALUES (901, 101, 'Alice Bartender', 0, '2026-11-01 08:00:00', '2026-11-01 16:00:00', 'closed')");
$x("INSERT INTO shifts (id, user_id, user_name, opening_float, opened_at, closed_at, status) VALUES (902, 102, 'Bob Bartender', 0, '2026-11-01 12:00:00', NULL, 'open')");
check('offline, Bob\'s own shift at that time wins', ordShiftAt($pdo, 102, '2026-11-01 13:00:00', 'Bartender') === 902);
check('offline, no own shift: the shift that was open then (Alice\'s at 09:00)', ordShiftAt($pdo, 103, '2026-11-01 09:00:00', 'Manager') === 901);
check('offline, two open at that time: the latest one (Bob\'s at 14:00)', ordShiftAt($pdo, 103, '2026-11-01 14:00:00', 'Bartender') === 902);
check('offline, before any shift: none', ordShiftAt($pdo, 103, '2026-11-01 07:00:00', 'Bartender') === null);
check('offline, the Owner never lands in a staff shift', ordShiftAt($pdo, 1, '2026-11-01 09:00:00', 'Owner') === null);
check('a Kitchen/unknown role never does either', ordShiftAt($pdo, 104, '2026-11-01 09:00:00', 'Kitchen') === null);


echo "== Offline payments reach the server later: the shift open at the time of the payment\n";
$x('DELETE FROM shifts'); $x('DELETE FROM notifications');
$yday = date('Y-m-d', strtotime($v('SELECT NOW()')) - 86400);
$ms = fn(string $hhmm) => (int)$v('SELECT UNIX_TIMESTAMP(?)', ["$yday $hhmm:00"]) * 1000;
$x("INSERT INTO shifts (id, user_id, user_name, opening_float, opened_at, closed_at, status) VALUES (950, 101, 'Alice Bartender', 0, '$yday 08:00:00', '$yday 16:00:00', 'closed')");
$p1 = order();
$r = call('orders.php', 'POST', 'pay', ['orderId' => $p1, 'paymentMethod' => 'Cash'], $B + ['offlineAt' => $ms('10:00'), 'key' => $key()]);
check('Bob (no shift of his own) paid offline at 10:00 while Alice\'s shift was open', ($r['json']['ok'] ?? false) && (int)$v('SELECT shift_id FROM orders WHERE id = ?', [$p1]) === 950, $r['raw']);
check('…the payment keeps its real time and is marked as counted in Alice\'s shift', $v('SELECT paid_at FROM orders WHERE id = ?', [$p1]) === "$yday 10:00:00" && (int)$v("SELECT COUNT(*) FROM audit_log WHERE action_type = 'PAYMENT' AND details LIKE '%(offline, $yday 10:00%counted in Alice Bartender%'") === 1);
check('…and no "without an open shift" warning was raised', (int)$v("SELECT COUNT(*) FROM notifications WHERE message LIKE '%without an open shift%'") === 0);
$p2 = order();
$r = call('orders.php', 'POST', 'pay', ['orderId' => $p2, 'paymentMethod' => 'Cash'], $B + ['offlineAt' => $ms('17:00'), 'key' => $key()]);
check('a payment at 17:00 (every shift closed) is recorded with no shift', ($r['json']['ok'] ?? false) && $v('SELECT shift_id FROM orders WHERE id = ?', [$p2]) === null, $r['raw']);
check('…and the Owner is told it had no shift', (int)$v("SELECT COUNT(*) FROM notifications WHERE message LIKE 'Bob Bartender took payment for % offline without an open shift%'") === 1);
// ── clean up ─────────────────────────────────────
sh("\"$BIN/mysql\" -uroot -e \"DROP DATABASE $DB\"");
foreach (array_merge(glob("$TMP/sess/*") ?: [], glob("$TMP/*.sql") ?: []) as $f) @unlink($f);
@rmdir("$TMP/sess"); @rmdir($TMP);
echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
