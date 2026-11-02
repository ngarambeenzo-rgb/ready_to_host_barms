<?php
// ============================================================
//  tests/attendance_test.php — work attendance (Start work / End work)
//
//  Run (developer machine with XAMPP, MySQL running):   php tests/attendance_test.php
//
//  Copies barms_db into a throwaway database (barms_atttest), runs the REAL
//  api/attendance.php (and misc.php notifications) through php-cgi as different
//  people, and drops the copy at the end. The real database is only read.
// ============================================================

$BIN    = getenv('MYSQL_BIN') ?: 'C:/xampp/mysql/bin';
$CGI    = getenv('PHP_CGI') ?: 'C:/xampp/php/php-cgi.exe';
$SRC_DB = 'barms_db';
$DB     = 'barms_atttest';
$ROOT   = realpath(__DIR__ . '/..');
$TMP    = sys_get_temp_dir() . '/barms_atttest_' . getmypid();
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
// the migration must be safe to run twice
$again = sh("\"$BIN/mysql\" -uroot $DB < \"$ROOT/attendance-migration.sql\"");
check('the migration can be run twice without errors', stripos($again, 'error') === false, $again);
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
function together(array $calls): array { $h = array_map(fn($c) => start(...$c), $calls); return array_map('finish', $h); }

// people
$x("DELETE FROM attendance");
$x("DELETE FROM notifications");
foreach ([[101, 'Alice Bartender', 'alice', 'Bartender'], [102, 'Chef Kitchen', 'chef', 'Kitchen'], [103, 'Mary Manager', 'mary', 'Manager'], [104, 'Late Larry', 'larry', 'Bartender'], [105, 'Early Eve', 'eve', 'Bartender']] as [$id, $nm, $un, $rl]) {
    $x("DELETE FROM users WHERE id = ? OR username = ?", [$id, $un]);
    $x("INSERT INTO users (id, full_name, username, password, role, active) VALUES (?,?,?, 'x', ?, 1)", [$id, $nm, $un, $rl]);
}
$A = ['uid' => 101, 'name' => 'Alice Bartender', 'role' => 'Bartender', 'sid' => 'alice'];
$K = ['uid' => 102, 'name' => 'Chef Kitchen',    'role' => 'Kitchen',   'sid' => 'chef'];
$M = ['uid' => 103, 'name' => 'Mary Manager',    'role' => 'Manager',   'sid' => 'mary'];
$L = ['uid' => 104, 'name' => 'Late Larry',      'role' => 'Bartender', 'sid' => 'larry'];
$E = ['uid' => 105, 'name' => 'Early Eve',       'role' => 'Bartender', 'sid' => 'eve'];
$O = ['uid' => 1, 'role' => 'Owner', 'sid' => 'owner'];

echo "== Starting and ending work\n";
$r = call('attendance.php', 'GET', 'current', [], $A);
check('before starting: nothing open, and Alice can clock', ($r['json']['ok'] ?? false) && $r['json']['attendance'] === null && $r['json']['canClock'] === true, $r['raw']);
$r = call('attendance.php', 'POST', 'start', ['device' => 'Android · Chrome'], $A + ['key' => 'att-start-1-aaaaaaaaaaaa']);
check('Alice starts work', ($r['json']['ok'] ?? false) && ($r['json']['id'] ?? 0) > 0, $r['raw']);
check('one open row, in her name and role', (int)$v("SELECT COUNT(*) FROM attendance WHERE user_id = 101 AND status = 'open' AND role = 'Bartender' AND user_name = 'Alice Bartender'") === 1);
check('the start is written to the audit log', (int)$v("SELECT COUNT(*) FROM audit_log WHERE action_type = 'ATTENDANCE' AND done_by = 'Alice Bartender' AND details LIKE 'Alice Bartender (Bartender) started work at %'") === 1);
$r = call('attendance.php', 'POST', 'start', [], $A + ['key' => 'att-start-2-aaaaaaaaaaaa']);
check('starting again is refused (409), nothing added', $r['code'] === 409 && (int)$v('SELECT COUNT(*) FROM attendance WHERE user_id = 101') === 1, $r['raw']);
$r = call('attendance.php', 'GET', 'current', [], $A);
check('current shows the open work', ($r['json']['attendance']['status'] ?? '') === 'open' && ($r['json']['attendance']['device'] ?? '') === 'Android · Chrome', $r['raw']);
$r = call('attendance.php', 'POST', 'start', [], $O + ['key' => 'att-start-3-aaaaaaaaaaaa']);
check('the Owner has no clock (refused)', $r['code'] === 403, $r['raw']);

[$a, $b] = together([['attendance.php', 'POST', 'start', [], $K + ['sid' => 'chef1', 'key' => 'att-chef-1-aaaaaaaaaaaa']],
                     ['attendance.php', 'POST', 'start', [], $K + ['sid' => 'chef2', 'key' => 'att-chef-2-bbbbbbbbbbbb']]]);
check('two taps at the same moment make one start', (int)$v("SELECT COUNT(*) FROM attendance WHERE user_id = 102 AND status = 'open'") === 1, $a['raw'] . ' | ' . $b['raw']);
check('…one of them was told it already started', in_array(409, [$a['code'], $b['code']], true) && (($a['json']['ok'] ?? 0) + ($b['json']['ok'] ?? 0)) === 1);

$r = call('attendance.php', 'POST', 'start', [], $M + ['key' => 'att-mary-1-aaaaaaaaaaaa']);
check('a Manager can start work too', ($r['json']['ok'] ?? false));
$r = call('attendance.php', 'POST', 'start', ['clientUuid' => 'att-offline-uuid-1'], $E + ['key' => 'att-eve-1-aaaaaaaaaaaaa']);
$r2 = call('attendance.php', 'POST', 'start', ['clientUuid' => 'att-offline-uuid-1'], $E + ['sid' => 'eve2', 'key' => 'att-eve-2-aaaaaaaaaaaaa']);
check('a start sent twice with the same device id is saved once', (int)$v("SELECT COUNT(*) FROM attendance WHERE client_uuid = 'att-offline-uuid-1'") === 1 && ($r2['json']['alreadyDone'] ?? false), $r2['raw']);

$r = call('attendance.php', 'POST', 'end', ['note' => 'closing time'], $A + ['key' => 'att-end-1-aaaaaaaaaaaaa']);
check('Alice ends work', ($r['json']['ok'] ?? false), $r['raw']);
check('the row is closed with an end time and her note', $v("SELECT status FROM attendance WHERE user_id = 101") === 'closed' && $v("SELECT ended_at IS NOT NULL FROM attendance WHERE user_id = 101") == 1 && $v("SELECT end_note FROM attendance WHERE user_id = 101") === 'closing time');
check('the end is written to the audit log with the hours', (int)$v("SELECT COUNT(*) FROM audit_log WHERE action_type = 'ATTENDANCE' AND done_by = 'Alice Bartender' AND details LIKE 'Ended work (started %worked 0h %closing time'") === 1);
$r = call('attendance.php', 'POST', 'end', [], $A + ['key' => 'att-end-2-aaaaaaaaaaaaa']);
check('ending with nothing open is refused (400)', $r['code'] === 400, $r['raw']);
$r = call('attendance.php', 'POST', 'start', [], $A + ['key' => 'att-start-4-aaaaaaaaaaaa']);
check('after ending she can start a new work period', ($r['json']['ok'] ?? false) && (int)$v('SELECT COUNT(*) FROM attendance WHERE user_id = 101') === 2);

echo "== Lateness (expected start time)\n";
$now = $v('SELECT NOW()');
$mins = fn(int $d) => date('H:i:00', strtotime($now) + $d * 60);
$x('UPDATE users SET expected_start = ? WHERE id = 104', [$mins(-30)]);
$x('UPDATE users SET expected_start = ? WHERE id = 105', [$mins(+120)]);
$r = call('attendance.php', 'POST', 'start', [], $L + ['key' => 'att-larry-1-aaaaaaaaaaa']);
$late = $v('SELECT late_minutes FROM attendance WHERE user_id = 104');
check('starting 30 minutes after the expected time = about 30 minutes late', $late >= 29 && $late <= 31, "late=$late");
check('the late start is remembered with the expected time', $v('SELECT expected_start FROM attendance WHERE user_id = 104') === $mins(-30));
$x('DELETE FROM attendance WHERE user_id = 105');
$r = call('attendance.php', 'POST', 'start', [], $E + ['sid' => 'eve3', 'key' => 'att-eve-3-aaaaaaaaaaaaa']);
check('starting before the expected time = on time (0)', (string)$v('SELECT late_minutes FROM attendance WHERE user_id = 105') === '0');
check('no expected time = not checked (NULL)', $v('SELECT late_minutes FROM attendance WHERE user_id = 101 ORDER BY id DESC LIMIT 1') === null);
$n = $pdo->query("SELECT message, type, for_roles FROM notifications WHERE message LIKE 'Late Larry%'")->fetch();
check('the Owner gets a warning notice that says how late', $n && $n['type'] === 'warning' && $n['for_roles'] === 'Owner' && str_contains($n['message'], 'min late'), json_encode($n));

echo "== Who sees what\n";
$r = call('attendance.php', 'GET', 'on_duty', [], $O);
$names = array_column($r['json']['working'] ?? [], 'user');
check('Owner sees who is working now', in_array('Alice Bartender', $names, true) && in_array('Chef Kitchen', $names, true) && in_array('Late Larry', $names, true), $r['raw']);
$r = call('attendance.php', 'GET', 'on_duty', [], $A);
check('a Bartender cannot see it (403)', $r['code'] === 403);
$r = call('attendance.php', 'GET', 'list', [], $K);
check('Kitchen cannot see the history (403)', $r['code'] === 403);
$x('UPDATE mgr_permissions SET can_view_employees = 0 WHERE id = 1');
$r = call('attendance.php', 'GET', 'on_duty', [], $M);
check('a Manager without "view employees" is refused (403)', $r['code'] === 403);
$x('UPDATE mgr_permissions SET can_view_employees = 1 WHERE id = 1');
$r = call('attendance.php', 'GET', 'on_duty', [], $M);
check('a Manager with "view employees" can see it', ($r['json']['ok'] ?? false));

$n = call('misc.php', 'GET', 'notif_list', [], $A);
check('a Bartender does not see "started work" notices', !str_contains($n['raw'], 'started work'), $n['raw']);
$n = call('misc.php', 'GET', 'notif_list', [], $O);
check('the Owner sees them', str_contains($n['raw'], 'Alice Bartender (Bartender) started work'), $n['raw']);
$x("INSERT INTO notifications (message, type) VALUES ('Low stock: x', 'warning')");
$n = call('misc.php', 'GET', 'notif_list', [], $A);
check('ordinary notices (no roles) still reach everyone', str_contains($n['raw'], 'Low stock: x'));

echo "== Not started yet\n";
$x('UPDATE users SET expected_start = ? WHERE id = 101', [$mins(-20)]);
$x('DELETE FROM attendance WHERE user_id = 101');
$r = call('attendance.php', 'GET', 'on_duty', [], $O);
$ns = array_column($r['json']['notStarted'] ?? [], null, 'user');
check('someone past their expected start who has not started is listed', isset($ns['Alice Bartender']) && $ns['Alice Bartender']['minutesLate'] >= 19, $r['raw']);
call('attendance.php', 'POST', 'start', [], $A + ['key' => 'att-start-5-aaaaaaaaaaaa']);
$r = call('attendance.php', 'GET', 'on_duty', [], $O);
check('…and is gone from that list once she starts', !in_array('Alice Bartender', array_column($r['json']['notStarted'] ?? [], 'user'), true));
call('attendance.php', 'POST', 'end', [], $A + ['key' => 'att-end-5-aaaaaaaaaaaaa']);
$r = call('attendance.php', 'GET', 'on_duty', [], $O);
check('…and stays off it after she ends work (she did start)', !in_array('Alice Bartender', array_column($r['json']['notStarted'] ?? [], 'user'), true));
$x('UPDATE users SET expected_start = NULL WHERE id IN (101,104,105)');

echo "== Expected start time (Owner only)\n";
$r = call('attendance.php', 'POST', 'set_expected', ['userId' => 101, 'time' => '08:00'], $O + ['key' => 'att-exp-1-aaaaaaaaaaaaa']);
check('the Owner sets an expected start', ($r['json']['ok'] ?? false) && $v('SELECT expected_start FROM users WHERE id = 101') === '08:00:00', $r['raw']);
$r = call('attendance.php', 'POST', 'set_expected', ['userId' => 101, 'time' => '09:00'], $M + ['key' => 'att-exp-2-aaaaaaaaaaaaa']);
check('a Manager cannot (403)', $r['code'] === 403 && $v('SELECT expected_start FROM users WHERE id = 101') === '08:00:00');
$r = call('attendance.php', 'POST', 'set_expected', ['userId' => 101, 'time' => '8am'], $O + ['key' => 'att-exp-3-aaaaaaaaaaaaa']);
check('a bad time is refused (400)', $r['code'] === 400);
$r = call('attendance.php', 'POST', 'set_expected', ['userId' => 1, 'time' => '08:00'], $O + ['key' => 'att-exp-4-aaaaaaaaaaaaa']);
check('the Owner account itself cannot be given one (404)', $r['code'] === 404);
$r = call('attendance.php', 'POST', 'set_expected', ['userId' => 101, 'time' => ''], $O + ['key' => 'att-exp-5-aaaaaaaaaaaaa']);
check('an empty time removes it', ($r['json']['ok'] ?? false) && $v('SELECT expected_start FROM users WHERE id = 101') === null);

echo "== Forgotten work\n";
$x("DELETE FROM attendance WHERE user_id = 102");
$x("INSERT INTO attendance (user_id, user_name, role, started_at, status) VALUES (102, 'Chef Kitchen', 'Kitchen', NOW() - INTERVAL 30 HOUR, 'open')");
$r = call('attendance.php', 'GET', 'current', [], $K);
check('work open for 30 hours is flagged as stale', ($r['json']['attendance']['stale'] ?? false) === true, $r['raw']);
$r = call('attendance.php', 'POST', 'start', [], $K + ['key' => 'att-chef-3-aaaaaaaaaaaa']);
check('starting again closes the forgotten one as "forgot" and opens a new one', ($r['json']['ok'] ?? false) && $v("SELECT status FROM attendance WHERE user_id = 102 ORDER BY id ASC LIMIT 1") === 'forgot' && (int)$v("SELECT COUNT(*) FROM attendance WHERE user_id = 102 AND status = 'open'") === 1, $r['raw']);
$x("UPDATE attendance SET status = 'forgot' WHERE user_id = 102");
$x("INSERT INTO attendance (user_id, user_name, role, started_at, status) VALUES (102, 'Chef Kitchen', 'Kitchen', NOW() - INTERVAL 40 HOUR, 'open')");
$r = call('attendance.php', 'POST', 'end', [], $K + ['key' => 'att-chef-4-aaaaaaaaaaaa']);
check('ending work that is 40 hours old does not count 40 hours', ($r['json']['forgotten'] ?? false) && $v("SELECT status FROM attendance WHERE user_id = 102 ORDER BY id DESC LIMIT 1") === 'forgot' && $v("SELECT ended_at FROM attendance WHERE user_id = 102 ORDER BY id DESC LIMIT 1") === null, $r['raw']);

$id = (int)$v("SELECT id FROM attendance WHERE user_id = 103 AND status = 'open'");
$r = call('attendance.php', 'POST', 'force_end', ['id' => $id], $M + ['key' => 'att-fe-1-aaaaaaaaaaaaaa']);
check('a Manager cannot end someone else\'s work (403)', $r['code'] === 403);
$r = call('attendance.php', 'POST', 'force_end', ['id' => $id, 'endedAt' => date('Y-m-d H:i:s', strtotime($v('SELECT NOW()')) + 3600)], $O + ['key' => 'att-fe-2-aaaaaaaaaaaaaa']);
check('the Owner cannot give an end time in the future (400)', $r['code'] === 400);
$r = call('attendance.php', 'POST', 'force_end', ['id' => $id], $O + ['key' => 'att-fe-3-aaaaaaaaaaaaaa']);
check('the Owner ends Mary\'s forgotten work', ($r['json']['ok'] ?? false) && $v('SELECT status FROM attendance WHERE id = ?', [$id]) === 'closed' && $v('SELECT ended_by FROM attendance WHERE id = ?', [$id]) === 'QA Owner');
$r = call('attendance.php', 'POST', 'force_end', ['id' => $id], $O + ['key' => 'att-fe-4-aaaaaaaaaaaaaa']);
check('…and it cannot be ended twice (404)', $r['code'] === 404);

echo "== History and totals\n";
$x('DELETE FROM attendance');
$x("INSERT INTO attendance (user_id, user_name, role, started_at, ended_at, status, expected_start, late_minutes) VALUES
    (101, 'Alice Bartender', 'Bartender', CONCAT(CURDATE(), ' 08:00:00'), CONCAT(CURDATE(), ' 16:00:00'), 'closed', '08:00:00', 0),
    (101, 'Alice Bartender', 'Bartender', CONCAT(CURDATE() - INTERVAL 1 DAY, ' 08:20:00'), CONCAT(CURDATE() - INTERVAL 1 DAY, ' 12:20:00'), 'closed', '08:00:00', 20),
    (101, 'Alice Bartender', 'Bartender', CONCAT(CURDATE() - INTERVAL 2 DAY, ' 08:00:00'), NULL, 'forgot', NULL, NULL),
    (104, 'Late Larry', 'Bartender', CONCAT(CURDATE(), ' 09:00:00'), CONCAT(CURDATE(), ' 10:00:00'), 'closed', NULL, NULL)");
$r = call('attendance.php', 'GET', 'list', [], $O + ['query' => 'preset=custom&from=' . date('Y-m-d', strtotime('-3 days')) . '&to=' . date('Y-m-d')]);
$people = array_column($r['json']['people'] ?? [], null, 'user');
check('history lists every start in the period', count($r['json']['rows'] ?? []) === 4, $r['raw']);
check('Alice: 3 starts, 3 days, 12 hours (720 min), 1 late, 20 late minutes, 1 forgotten', ($people['Alice Bartender']['starts'] ?? 0) === 3 && $people['Alice Bartender']['days'] === 3 && $people['Alice Bartender']['minutes'] === 720 && $people['Alice Bartender']['late'] === 1 && $people['Alice Bartender']['lateMinutes'] === 20 && $people['Alice Bartender']['forgot'] === 1, json_encode($people['Alice Bartender'] ?? null));
check('Larry: 1 start, 60 minutes', ($people['Late Larry']['minutes'] ?? 0) === 60);
$r = call('attendance.php', 'GET', 'list', [], $O + ['query' => 'preset=custom&from=' . date('Y-m-d', strtotime('-3 days')) . '&to=' . date('Y-m-d') . '&userId=104']);
check('history can be filtered to one person', count($r['json']['rows'] ?? []) === 1);
$r = call('attendance.php', 'GET', 'list', [], $O + ['query' => 'preset=today']);
check('"today" shows only today\'s starts', count($r['json']['rows'] ?? []) === 2);
$r = call('attendance.php', 'GET', 'staff', [], $O);
check('the staff list holds Manager, Bartender and Kitchen people (not the Owner)', ($r['json']['ok'] ?? false) && !in_array('Owner', array_column($r['json']['staff'] ?? [], 'role'), true) && in_array('Late Larry', array_column($r['json']['staff'] ?? [], 'user'), true));

echo "== Safety\n";
check('attendance is in the per-client table list (clients never see each other\'s)', str_contains(file_get_contents("$ROOT/config/tenant.php"), "'attendance'"));
check('offline devices may send start and end', (bool)preg_match("/'attendance\.php'\s*=>\s*\['start',\s*'end'\]/", file_get_contents("$ROOT/config/db.php")));
$r = call('attendance.php', 'GET', 'nonsense', [], $O);
check('an unknown action is refused (400)', $r['code'] === 400);


echo "== Offline: work started and ended without internet, sent later with its real time\n";
$x('DELETE FROM attendance'); $x('DELETE FROM notifications');
$x("UPDATE users SET expected_start = '08:00:00' WHERE id = 101");
$yday = date('Y-m-d', strtotime($v('SELECT NOW()')) - 86400);
$ms = fn(string $hhmm) => (int)$v('SELECT UNIX_TIMESTAMP(?)', ["$yday $hhmm:00"]) * 1000;
$r = call('attendance.php', 'POST', 'start', ['clientUuid' => 'off-att-1', 'device' => 'Android'], $A + ['offlineAt' => $ms('08:10'), 'key' => 'att-off-1-aaaaaaaaaaaaa']);
check('an offline start is accepted', ($r['json']['ok'] ?? false) && ($r['json']['startedAt'] ?? '') === "$yday 08:10:00", $r['raw']);
check('it is stamped with the time it was made (yesterday 08:10), not when it arrived', $v("SELECT started_at FROM attendance WHERE client_uuid = 'off-att-1'") === "$yday 08:10:00");
check('lateness is worked out from that time (10 minutes)', (int)$v("SELECT late_minutes FROM attendance WHERE client_uuid = 'off-att-1'") === 10);
check('the Owner\'s notice says it was recorded offline, with that time', (int)$v("SELECT COUNT(*) FROM notifications WHERE message LIKE '%started work at 08:10 — 10 min late (recorded offline)' AND for_roles = 'Owner'") === 1);
$r = call('attendance.php', 'POST', 'start', ['clientUuid' => 'off-att-1'], $A + ['offlineAt' => $ms('08:10'), 'sid' => 'alice-b', 'key' => 'att-off-2-aaaaaaaaaaaaa']);
check('the same start sent again changes nothing', ($r['json']['alreadyDone'] ?? false) && (int)$v('SELECT COUNT(*) FROM attendance WHERE user_id = 101') === 1, $r['raw']);
$r = call('attendance.php', 'POST', 'end', ['attendanceUuid' => 'off-att-1', 'note' => 'closed offline'], $A + ['offlineAt' => $ms('16:10'), 'key' => 'att-off-3-aaaaaaaaaaaaa']);
check('the offline end closes that work at the time it was made', ($r['json']['ok'] ?? false) && $v("SELECT ended_at FROM attendance WHERE client_uuid = 'off-att-1'") === "$yday 16:10:00" && $v("SELECT status FROM attendance WHERE client_uuid = 'off-att-1'") === 'closed', $r['raw']);
check('…and its hours are 8 (480 minutes)', (int)$v("SELECT TIMESTAMPDIFF(MINUTE, started_at, ended_at) FROM attendance WHERE client_uuid = 'off-att-1'") === 480);
$r = call('attendance.php', 'POST', 'end', ['attendanceUuid' => 'off-att-1'], $A + ['offlineAt' => $ms('16:10'), 'sid' => 'alice-b', 'key' => 'att-off-4-aaaaaaaaaaaaa']);
check('the same end sent again is accepted quietly (already done)', ($r['json']['ok'] ?? false) && ($r['json']['alreadyDone'] ?? false), $r['raw']);
$r = call('attendance.php', 'POST', 'end', [], $K + ['offlineAt' => $ms('16:10'), 'key' => 'att-off-5-aaaaaaaaaaaaa']);
check('an offline end when nothing is open is accepted quietly, not a refused record', ($r['json']['ok'] ?? false) && ($r['json']['alreadyDone'] ?? false), $r['raw']);
$r = call('attendance.php', 'POST', 'end', [], $K + ['key' => 'att-off-6-aaaaaaaaaaaaa']);
check('…but online, ending with nothing open is still refused (400)', $r['code'] === 400);

// started online first, then the same work arrives from the device
$x('DELETE FROM attendance');
call('attendance.php', 'POST', 'start', [], $A + ['key' => 'att-off-7-aaaaaaaaaaaaa']);
$r = call('attendance.php', 'POST', 'start', ['clientUuid' => 'off-att-2'], $A + ['offlineAt' => ((int)$v('SELECT UNIX_TIMESTAMP()') - 600) * 1000, 'sid' => 'alice-c', 'key' => 'att-off-8-aaaaaaaaaaaaa']);
check('an offline start for work already started on the server is merged, not doubled', ($r['json']['merged'] ?? false) && (int)$v('SELECT COUNT(*) FROM attendance WHERE user_id = 101') === 1 && $v("SELECT client_uuid FROM attendance WHERE user_id = 101") === 'off-att-2', $r['raw']);
$r = call('attendance.php', 'POST', 'end', ['attendanceUuid' => 'off-att-2'], $A + ['offlineAt' => ((int)$v('SELECT UNIX_TIMESTAMP()') - 60) * 1000, 'sid' => 'alice-c', 'key' => 'att-off-9-aaaaaaaaaaaaa']);
check('…and its end closes it', ($r['json']['ok'] ?? false) && $v("SELECT status FROM attendance WHERE user_id = 101") === 'closed');
$x('UPDATE users SET expected_start = NULL WHERE id = 101');
// ── clean up ─────────────────────────────────────
sh("\"$BIN/mysql\" -uroot -e \"DROP DATABASE $DB\"");
foreach (array_merge(glob("$TMP/sess/*") ?: [], glob("$TMP/*.sql") ?: []) as $f) @unlink($f);
@rmdir("$TMP/sess"); @rmdir($TMP);
echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
