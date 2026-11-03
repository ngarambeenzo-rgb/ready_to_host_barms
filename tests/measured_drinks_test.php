<?php
// ============================================================
//  tests/measured_drinks_test.php — bottles sold by shot or glass
//
//  Run (developer machine with XAMPP, MySQL running):   php tests/shift_sharing_test.php
//
//  Rule: an ingredient with stock on hand needs a cost per unit (bar and kitchen), a direct bar item
//  needs a buy cost, and System Health lists active items that have no cost.
//  Uses a throwaway copy of barms_db (barms_measuretest); the real database is only read.
// ============================================================

$BIN    = getenv('MYSQL_BIN') ?: 'C:/xampp/mysql/bin';
$CGI    = getenv('PHP_CGI') ?: 'C:/xampp/php/php-cgi.exe';
$SRC_DB = 'barms_db';
$DB     = 'barms_measuretest';
$ROOT   = realpath(__DIR__ . '/..');
$TMP    = sys_get_temp_dir() . '/barms_measuretest_' . getmypid();
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

$O = ['uid' => 1, 'name' => 'The Owner', 'role' => 'Owner', 'sid' => 'owner'];
$post = fn($s, $a, $b) => call($s, 'POST', $a, $b, $O + ['key' => 'ms-' . uniqid() . '-aaaaaaaaaaaa']);
$get  = fn($s, $a, $q = '') => call($s, 'GET', $a, [], $O + ['query' => $q]);
$one  = fn(string $sql, array $p = []) => (function () use ($pdo, $sql, $p) { $s = $pdo->prepare($sql); $s->execute($p); return $s->fetch(); })();

// a draft order, add one line through the real API, then validate it
function sellLine(int $itemId, int $qty, bool $validate = true): array {
    global $post, $one;
    $r = $post('orders.php', 'create', ['type' => 'takeaway']);
    $oid = (int)($r['json']['orderId'] ?? $r['json']['id'] ?? $r['json']['order']['id'] ?? 0);
    $it = $one('SELECT name, price FROM bar_items WHERE id = ?', [$itemId]);
    $a = $post('orders.php', 'add_item', ['orderId' => $oid, 'sourceType' => 'bar', 'sourceId' => $itemId, 'name' => $it['name'], 'price' => $it['price'], 'qty' => $qty, 'clientUuid' => 'u' . uniqid()]);
    $v = $validate && ($a['json']['ok'] ?? 0) ? $post('orders.php', 'validate', ['orderId' => $oid]) : null;
    return ['add' => $a, 'validate' => $v, 'orderId' => $oid];
}

echo "== Set up a bottle sold by the shot and glass\n";
$r = $post('bar-inventory.php', 'item_add', ['name' => 'QA Whisky', 'price' => 30000, 'costPrice' => 15000, 'type' => 'direct', 'stock' => 4, 'minStock' => 1,
    'measure' => ['enabled' => true, 'unit' => 'ml', 'bottleSize' => 750, 'emptyWeight' => 500, 'density' => 0.94, 'openAmount' => 375,
                  'portions' => [['name' => 'Shot', 'size' => 50, 'price' => 3000], ['name' => 'Glass', 'size' => 150, 'price' => 8000]]]]);
check('item with shot and glass is saved', ($r['json']['ok'] ?? 0) == 1, $r['raw']);
$bid = (int)$v("SELECT id FROM bar_items WHERE name = 'QA Whisky'");
$shot = (int)$v("SELECT id FROM bar_items WHERE parent_id = ? AND pack_name = 'Shot'", [$bid]);
$glass = (int)$v("SELECT id FROM bar_items WHERE parent_id = ? AND pack_name = 'Glass'", [$bid]);
check('shot and glass are their own sellable rows', $shot > 0 && $glass > 0 && $v('SELECT type FROM bar_items WHERE id = ?', [$shot]) === 'portion');
check('names are bottle + size', $v('SELECT name FROM bar_items WHERE id = ?', [$shot]) === 'QA Whisky – Shot');
check('shot cost = 50/750 of the bottle cost (1000)', abs((float)$v('SELECT cost_price FROM bar_items WHERE id = ?', [$shot]) - 1000) < 0.01);
check('open bottle starts with 375 ml', abs((float)$v('SELECT open_amount FROM bar_items WHERE id = ?', [$bid]) - 375) < 0.001);
$l = $get('bar-inventory.php', 'items_list');
$row = array_values(array_filter($l['json']['data'], fn($i) => $i['id'] == $shot))[0] ?? null;
check('list says (375 + 4 x 750) / 50 = 67 shots left', $row && $row['portions_left'] === 67, json_encode($row['portions_left'] ?? null));
$r = $post('bar-inventory.php', 'item_add', ['name' => 'QA Bad', 'price' => 1000, 'costPrice' => 500, 'type' => 'direct', 'stock' => 1, 'measure' => ['enabled' => true, 'unit' => 'ml', 'bottleSize' => 750, 'portions' => []]]);
check('measuring with no shot or glass size is refused', $r['code'] === 400, $r['raw']);
$r = $post('bar-inventory.php', 'item_add', ['name' => 'QA Bad2', 'price' => 1000, 'costPrice' => 500, 'type' => 'direct', 'stock' => 1, 'measure' => ['enabled' => true, 'unit' => 'ml', 'bottleSize' => 100, 'portions' => [['name' => 'Big', 'size' => 200, 'price' => 500]]]]);
check('a glass bigger than the bottle is refused', $r['code'] === 400, $r['raw']);
check('…and nothing was saved', (int)$v("SELECT COUNT(*) FROM bar_items WHERE name LIKE 'QA Bad%'") === 0);

echo "== Selling shots\n";
$s = sellLine($shot, 3);
check('3 shots added and validated', ($s['add']['json']['ok'] ?? 0) && ($s['validate']['json']['ok'] ?? 0), json_encode([$s['add']['raw'], $s['validate']['raw'] ?? '']));
check('open bottle 375 -> 225 ml', abs((float)$v('SELECT open_amount FROM bar_items WHERE id = ?', [$bid]) - 225) < 0.001);
check('sealed bottles unchanged (4)', (float)$v('SELECT stock FROM bar_items WHERE id = ?', [$bid]) == 4);
check('sale recorded at cost 1000 per shot', abs((float)$v('SELECT unit_cost FROM bar_sales WHERE product_id = ? ORDER BY id DESC LIMIT 1', [$shot]) - 1000) < 0.01);

echo "== A glass bigger than what is open opens a sealed bottle\n";
$x('UPDATE bar_items SET open_amount = 100 WHERE id = ?', [$bid]);
$s = sellLine($glass, 1);
check('glass sold', ($s['validate']['json']['ok'] ?? 0), json_encode($s['validate']['raw'] ?? ''));
check('a sealed bottle was opened (4 -> 3)', (float)$v('SELECT stock FROM bar_items WHERE id = ?', [$bid]) == 3);
check('open amount 100 + 750 - 150 = 700 ml', abs((float)$v('SELECT open_amount FROM bar_items WHERE id = ?', [$bid]) - 700) < 0.001);
check('the opening is written in the stock history', (int)$v("SELECT COUNT(*) FROM bar_movements WHERE item_id = ? AND type = 'open_bottle'", [$bid]) === 1);

echo "== Whole bottle only from sealed stock\n";
$s = sellLine($bid, 1);
check('whole bottle sold from sealed', ($s['validate']['json']['ok'] ?? 0));
check('sealed 3 -> 2, open bottle untouched at 700 ml', (float)$v('SELECT stock FROM bar_items WHERE id = ?', [$bid]) == 2 && abs((float)$v('SELECT open_amount FROM bar_items WHERE id = ?', [$bid]) - 700) < 0.001);
$x('UPDATE bar_items SET stock = 0 WHERE id = ?', [$bid]);
$s = sellLine($bid, 1, false);
check('with no sealed bottle, whole sale is refused even though 700 ml is open', ($s['add']['code'] ?? 0) === 400 && strpos($s['add']['raw'], 'sealed') !== false, $s['add']['raw']);
$s = sellLine($shot, 2);
check('...but shots still sell from the open bottle', ($s['validate']['json']['ok'] ?? 0));
check('open 700 -> 600', abs((float)$v('SELECT open_amount FROM bar_items WHERE id = ?', [$bid]) - 600) < 0.001);
$x('UPDATE bar_items SET open_amount = 20 WHERE id = ?', [$bid]);
$s = sellLine($shot, 1, false);
check('no sealed bottle and too little open: shot refused', ($s['add']['code'] ?? 0) === 400, $s['add']['raw']);

echo "== Checking the open bottle\n";
$x('UPDATE bar_items SET stock = 2, open_amount = 400 WHERE id = ?', [$bid]);
$r = $post('bar-inventory.php', 'measure_check', ['id' => $bid, 'method' => 'gross', 'value' => 876]);   // 376 g liquid / 0.94 = 400 ml
check('weighing: 876 g gross = 400 ml, no difference', ($r['json']['ok'] ?? 0) && abs($r['json']['diff']) < 1, $r['raw']);
$r = $post('bar-inventory.php', 'measure_check', ['id' => $bid, 'method' => 'gross', 'value' => 782]);   // 282 g / 0.94 = 300 ml
check('weighing: 300 ml found, 100 ml short = 2 shots, RWF 2,000', ($r['json']['ok'] ?? 0) && abs($r['json']['diff'] + 100) < 1 && abs($r['json']['value'] + 2000) < 20 && abs($r['json']['portions'] + 2) < 0.2, $r['raw']);
check('system now holds what was found', abs((float)$v('SELECT open_amount FROM bar_items WHERE id = ?', [$bid]) - 300) < 1);
check('checks are in the history, not mixed into the bottle count', (int)$v("SELECT COUNT(*) FROM bar_movements WHERE type = 'measure_check' AND reference = ? AND item_id IS NULL", ['bottle:' . $bid]) === 2);
$r = $post('bar-inventory.php', 'measure_check', ['id' => $bid, 'method' => 'level', 'value' => 5]);
check('level 5/10 of 750 = 375 ml', abs(($r['json']['found'] ?? 0) - 375) < 0.01, $r['raw']);
$r = $post('bar-inventory.php', 'measure_check', ['id' => $bid, 'method' => 'amount', 'value' => 410]);
check('typing the amount works', abs(($r['json']['found'] ?? 0) - 410) < 0.01, $r['raw']);
$r = $post('bar-inventory.php', 'measure_check', ['id' => $bid, 'method' => 'gross', 'value' => 100]);
check('a weight below the empty bottle is refused', $r['code'] === 400, $r['raw']);

echo "== Selling again after a check\n";
$x('UPDATE bar_items SET stock = 2, open_amount = 400 WHERE id = ?', [$bid]);
$s = sellLine($shot, 2);
check('sold 2 shots (400 -> 300)', abs((float)$v('SELECT open_amount FROM bar_items WHERE id = ?', [$bid]) - 300) < 0.001);

echo "== Other units, editing\n";
$r = $post('bar-inventory.php', 'item_add', ['name' => 'QA Gin g', 'price' => 20000, 'costPrice' => 10000, 'type' => 'direct', 'stock' => 2,
    'measure' => ['enabled' => true, 'unit' => 'g', 'bottleSize' => 700, 'emptyWeight' => 450, 'portions' => [['name' => 'Tot', 'size' => 40, 'price' => 2500]]]]);
check('weight-based bottle is saved', ($r['json']['ok'] ?? 0) == 1, $r['raw']);
$gid = (int)$v("SELECT id FROM bar_items WHERE name = 'QA Gin g'");
$r = $post('bar-inventory.php', 'measure_check', ['id' => $gid, 'method' => 'gross', 'value' => 750]);
check('in grams: 750 g gross - 450 empty = 300 g left', abs(($r['json']['found'] ?? 0) - 300) < 0.01, $r['raw']);
$r = $post('bar-inventory.php', 'item_update', ['id' => $bid, 'name' => 'QA Whisky', 'price' => 30000, 'costPrice' => 15000, 'type' => 'direct', 'minStock' => 1, 'active' => 1,
    'measure' => ['enabled' => true, 'unit' => 'cl', 'bottleSize' => 75, 'portions' => [['id' => $shot, 'name' => 'Shot', 'size' => 5, 'price' => 3500]]]]);
check('editing: unit changed, glass removed, shot kept', ($r['json']['ok'] ?? 0) && (int)$v("SELECT COUNT(*) FROM bar_items WHERE parent_id = ? AND type = 'portion' AND active = 1", [$bid]) === 1, $r['raw']);
check('the glass that was already sold is switched off, not deleted', (int)$v('SELECT active FROM bar_items WHERE id = ?', [$glass]) === 0);
$r = $post('bar-inventory.php', 'item_update', ['id' => $bid, 'name' => 'QA Whisky', 'price' => 30000, 'costPrice' => 15000, 'type' => 'direct', 'minStock' => 1, 'active' => 1, 'measure' => ['enabled' => false]]);
check('turning measuring off clears it', ($r['json']['ok'] ?? 0) && $v('SELECT measure_unit FROM bar_items WHERE id = ?', [$bid]) === null, $r['raw']);

echo "\n$pass passed, $fail failed\n";
sh("\"$BIN/mysql\" -uroot -e \"DROP DATABASE IF EXISTS $DB\"");
exit($fail ? 1 : 0);
