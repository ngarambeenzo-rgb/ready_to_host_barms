<?php
// ============================================================
//  tests/discount_test.php — the Owner's discounts reach the Bartender
//  Run:  php tests/discount_test.php
//  Uses a throwaway copy of barms_db (barms_disctest), dropped at the end.
// ============================================================
$BIN = getenv('MYSQL_BIN') ?: 'C:/xampp/mysql/bin'; $CGI = getenv('PHP_CGI') ?: 'C:/xampp/php/php-cgi.exe';
$DB = 'barms_disctest'; $ROOT = realpath(__DIR__ . '/..'); $TMP = sys_get_temp_dir() . '/barms_disctest_' . getmypid();
@mkdir($TMP . '/sess', 0700, true); @mkdir($TMP . '/backups', 0700, true);
$pass = 0; $fail = 0;
function check(string $n, bool $ok, string $i = ''): void { global $pass, $fail; if ($ok) { $pass++; echo "  ok   $n\n"; } else { $fail++; echo "  FAIL $n" . ($i !== '' ? " — $i" : '') . "\n"; } }
function sh(string $c): string { return (string)shell_exec($c . ' 2>&1'); }
sh("\"$BIN/mysql\" -uroot -e \"DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB CHARACTER SET utf8mb4\"");
sh("\"$BIN/mysqldump\" -uroot --single-transaction barms_db > \"$TMP/src.sql\"");
sh("\"$BIN/mysql\" -uroot $DB < \"$TMP/src.sql\"");
foreach (glob("$ROOT/*-migration.sql") as $m) sh("\"$BIN/mysql\" -uroot $DB < \"$m\"");
$pdo = new PDO("mysql:host=localhost;dbname=$DB;charset=utf8mb4", 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$v = function (string $s, array $p = []) use ($pdo) { $q = $pdo->prepare($s); $q->execute($p); return $q->fetchColumn(); };
$x = fn(string $s, array $p = []) => $pdo->prepare($s)->execute($p);
function call(string $script, string $method, string $action, array $body = [], array $o = []): array {
    global $CGI, $ROOT, $DB, $TMP;
    $json = json_encode($body);
    $env = ['BARMS_QA_RUN' => '1', 'QA_DB' => $DB, 'QA_SID' => $o['sid'] ?? '1', 'QA_ROLE' => $o['role'] ?? 'Owner', 'QA_UID' => $o['uid'] ?? 1, 'QA_BACKUP_DIR' => "$TMP/backups",
            'REDIRECT_STATUS' => '1', 'REQUEST_METHOD' => $method, 'QUERY_STRING' => 'action=' . $action . (isset($o['query']) ? '&' . $o['query'] : ''),
            'SCRIPT_FILENAME' => "$ROOT/api/$script", 'SCRIPT_NAME' => "/barms/api/$script", 'CONTENT_TYPE' => 'application/json',
            'CONTENT_LENGTH' => (string)strlen($json), 'SystemRoot' => getenv('SystemRoot'), 'TEMP' => getenv('TEMP'), 'PATH' => getenv('PATH')];
    $cmd = "\"$CGI\" -d auto_prepend_file=\"$ROOT/tests/qa_prepend.php\" -d session.save_path=\"$TMP/sess\" -d display_errors=0";
    $p = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, $ROOT, $env);
    fwrite($pipes[0], $method === 'POST' ? $json : ''); fclose($pipes[0]);
    $out = stream_get_contents($pipes[1]); fclose($pipes[1]); fclose($pipes[2]); proc_close($p);
    [$head, $b] = array_pad(preg_split("/\r?\n\r?\n/", $out, 2), 2, '');
    return ['code' => preg_match('/^Status:\s*(\d+)/mi', $head, $m) ? (int)$m[1] : 200, 'json' => json_decode(trim($b), true), 'raw' => $b];
}
function newOrder(int $itemId, string $name, int $qty, float $price): int {
    global $pdo, $v, $x;
    $no = 'DSC-' . substr(uniqid(), -6);
    $x("INSERT INTO orders (order_number, type, status, total, created_by) VALUES (?, 'takeaway', 'draft', ?, 'QA')", [$no, $qty * $price]);
    $oid = (int)$v('SELECT id FROM orders WHERE order_number = ?', [$no]);
    $x("INSERT INTO order_items (order_id, product_id, product_name, qty, unit_price, total, source_type, source_id, category, added_by) VALUES (?,?,?,?,?,?,'bar',?,'Drink','QA')", [$oid, $itemId, $name, $qty, $price, $qty * $price, $itemId]);
    return $oid;
}

$item  = $pdo->query("SELECT id, name, price FROM bar_items WHERE type = 'direct' AND active = 1 AND price > 100 ORDER BY id LIMIT 1")->fetch();
$other = $pdo->query("SELECT id, name, price FROM bar_items WHERE type = 'direct' AND active = 1 AND id <> {$item['id']} ORDER BY id LIMIT 1")->fetch();
$B = ['role' => 'Bartender', 'uid' => 2, 'sid' => 'b'];

echo "== Owner sets up a discount\n";
$r = call('discounts.php', 'POST', 'save', ['name' => 'Happy hour 10%', 'sourceType' => 'bar', 'sourceId' => (int)$item['id'], 'kind' => 'percent', 'value' => 10, 'active' => 1]);
check('Owner saves a 10% discount', $r['json']['ok'] ?? false, $r['raw']);
$r = call('discounts.php', 'POST', 'save', ['name' => 'Bad', 'sourceType' => 'bar', 'sourceId' => (int)$item['id'], 'kind' => 'percent', 'value' => 150, 'active' => 1]);
check('over 100% is refused', $r['code'] === 400);
$r = call('discounts.php', 'POST', 'save', ['name' => 'Nope', 'sourceType' => 'bar', 'sourceId' => (int)$item['id'], 'kind' => 'percent', 'value' => 5, 'active' => 1], $B);
check('a Bartender cannot create a discount', $r['code'] === 403, $r['raw']);

echo "== Fresh install: bartenders are allowed by default\n";
check('database default for bartender_can_discount is 1', (string)$pdo->query("SHOW COLUMNS FROM settings LIKE 'bartender_can_discount'")->fetch()['Default'] === '1');
$x('DELETE FROM settings');
$r = call('discounts.php', 'GET', 'policy', [], $B);
check('with no settings row, bartenders are still allowed', ($r['json']['bartenderCanDiscount'] ?? false) === true, $r['raw']);
call('discounts.php', 'POST', 'policy', ['bartenderCanDiscount' => 0]);
$r = call('discounts.php', 'GET', 'policy', [], $B);
check('switching it off with no settings row sticks', ($r['json']['bartenderCanDiscount'] ?? true) === false, $r['raw']);
call('discounts.php', 'POST', 'policy', ['bartenderCanDiscount' => 1]);

echo "== Bartender sees the discount\n";
$oid = newOrder((int)$item['id'], $item['name'], 2, (float)$item['price']);
$r = call('discounts.php', 'GET', 'options', [], $B + ['query' => "orderId=$oid"]);
$j = $r['json'];
check('Bartender: canApply true', ($j['canApply'] ?? false) === true, $r['raw']);
check("Bartender: the Owner's discount is listed for this order", count($j['data'] ?? []) === 1 && ($j['data'][0]['name'] ?? '') === 'Happy hour 10%', $r['raw']);
$want = round(2 * $item['price'] * 0.10, 2);
check('Bartender: amount off is 10% of the line', abs(($j['data'][0]['amount'] ?? 0) - $want) < 0.01, 'got ' . ($j['data'][0]['amount'] ?? 'none') . " want $want");
check('Bartender cannot type their own amount (canFree false)', ($j['canFree'] ?? true) === false);
$rid = $j['data'][0]['id'] ?? 0;
$oid2 = newOrder((int)$other['id'], $other['name'], 1, (float)$other['price']);
$r = call('discounts.php', 'GET', 'options', [], $B + ['query' => "orderId=$oid2"]);
check('an order without that item shows no discount', count($r['json']['data'] ?? []) === 0);

echo "== Bartender pays with the discount\n";
$x("INSERT INTO shifts (user_id, user_name, opened_at, status) VALUES (2, 'QA Bartender', NOW(), 'open')");
call('orders.php', 'POST', 'validate', ['orderId' => $oid], $B);
$r = call('orders.php', 'POST', 'pay', ['orderId' => $oid, 'paymentMethod' => 'Cash', 'discount' => 0, 'discountRules' => [$rid]], $B);
check('payment accepted', $r['json']['ok'] ?? false, $r['raw']);
check("discount applied = $want", abs((float)($r['json']['discount'] ?? 0) - $want) < 0.01, $r['raw']);
check('amount paid = total − discount', abs((float)($r['json']['paid'] ?? -1) - (2 * $item['price'] - $want)) < 0.01, $r['raw']);

echo "== Safety\n";
$oid3 = newOrder((int)$item['id'], $item['name'], 1, (float)$item['price']);
call('orders.php', 'POST', 'validate', ['orderId' => $oid3], $B);
$r = call('orders.php', 'POST', 'pay', ['orderId' => $oid3, 'paymentMethod' => 'Cash', 'discount' => 5000, 'discountReason' => 'x'], $B);
check('Bartender cannot sneak in a free-typed amount', !($r['json']['ok'] ?? false) || (float)($r['json']['discount'] ?? 0) == 0, $r['raw']);
call('discounts.php', 'POST', 'toggle', ['id' => $rid, 'active' => 0]);
$oid4 = newOrder((int)$item['id'], $item['name'], 1, (float)$item['price']);
$r = call('discounts.php', 'GET', 'options', [], $B + ['query' => "orderId=$oid4"]);
check('switching the discount off removes it from the Bartender', count($r['json']['data'] ?? []) === 0);
call('discounts.php', 'POST', 'toggle', ['id' => $rid, 'active' => 1]);
call('discounts.php', 'POST', 'policy', ['bartenderCanDiscount' => 0]);
$r = call('discounts.php', 'GET', 'options', [], $B + ['query' => "orderId=$oid4"]);
check('Owner switches bartenders off: canApply false but the rule is listed (screen shows a message)', ($r['json']['canApply'] ?? true) === false && count($r['json']['data'] ?? []) === 1, $r['raw']);
call('orders.php', 'POST', 'validate', ['orderId' => $oid4], $B);
$r = call('orders.php', 'POST', 'pay', ['orderId' => $oid4, 'paymentMethod' => 'Cash', 'discountRules' => [$rid]], $B);
check('…and the server refuses the discount when paying', !($r['json']['ok'] ?? false) || (float)($r['json']['discount'] ?? 0) == 0, $r['raw']);
call('discounts.php', 'POST', 'policy', ['bartenderCanDiscount' => 1]);
$r = call('discounts.php', 'GET', 'offline_rules', [], $B);
check('offline devices receive the rule and the bartender policy', ($r['json']['policy']['bartender'] ?? false) === true && count($r['json']['data'] ?? []) === 1, $r['raw']);

sh("\"$BIN/mysql\" -uroot -e \"DROP DATABASE IF EXISTS $DB\"");
echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
