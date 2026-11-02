<?php
// ============================================================
//  tests/item_cost_test.php — every item must have a cost
//
//  Run (developer machine with XAMPP, MySQL running):   php tests/shift_sharing_test.php
//
//  Rule: an ingredient with stock on hand needs a cost per unit (bar and kitchen), a direct bar item
//  needs a buy cost, and System Health lists active items that have no cost.
//  Uses a throwaway copy of barms_db (barms_costtest); the real database is only read.
// ============================================================

$BIN    = getenv('MYSQL_BIN') ?: 'C:/xampp/mysql/bin';
$CGI    = getenv('PHP_CGI') ?: 'C:/xampp/php/php-cgi.exe';
$SRC_DB = 'barms_db';
$DB     = 'barms_costtest';
$ROOT   = realpath(__DIR__ . '/..');
$TMP    = sys_get_temp_dir() . '/barms_costtest_' . getmypid();
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
$post = fn($s, $a, $b) => call($s, 'POST', $a, $b, $O + ['key' => 'cost-' . uniqid() . '-aaaaaaaaaaaa']);

echo "== Bar ingredients
";
$r = $post('bar-inventory.php', 'ingredient_add', ['name' => 'QA Syrup', 'quantity' => 5, 'unit' => 'L', 'costPerUnit' => 0]);
check('stock with no cost is refused', $r['code'] === 400, $r['raw']);
check('…and nothing was saved', (int)$v("SELECT COUNT(*) FROM bar_ingredients WHERE name = 'QA Syrup'") === 0);
$r = $post('bar-inventory.php', 'ingredient_add', ['name' => 'QA Syrup', 'quantity' => 5, 'unit' => 'L', 'costPerUnit' => -3]);
check('a negative cost is refused', $r['code'] === 400);
$r = $post('bar-inventory.php', 'ingredient_add', ['name' => 'QA Syrup', 'quantity' => 5, 'unit' => 'L', 'costPerUnit' => 1200]);
check('stock with a cost is saved', ($r['json']['ok'] ?? 0) == 1, $r['raw']);
$id = (int)$v("SELECT id FROM bar_ingredients WHERE name = 'QA Syrup'");
$r = $post('bar-inventory.php', 'ingredient_update', ['id' => $id, 'name' => 'QA Syrup', 'quantity' => 5, 'unit' => 'L', 'costPerUnit' => 0]);
check('removing the cost from stocked ingredient is refused', $r['code'] === 400, $r['raw']);
check('…cost unchanged', (float)$v('SELECT cost_per_unit FROM bar_ingredients WHERE id = ?', [$id]) == 1200);
$r = $post('bar-inventory.php', 'ingredient_add', ['name' => 'QA Empty', 'quantity' => 0, 'unit' => 'L', 'costPerUnit' => 0]);
check('an empty ingredient without cost is allowed (cost comes with the first delivery)', ($r['json']['ok'] ?? 0) == 1, $r['raw']);

echo "== Kitchen ingredients
";
$r = $post('kitchen2.php', 'ingredient_add', ['name' => 'QA Flour', 'quantity' => 10, 'unit' => 'kg', 'costPerUnit' => 0]);
check('stock with no cost is refused', $r['code'] === 400, $r['raw']);
$r = $post('kitchen2.php', 'ingredient_add', ['name' => 'QA Flour', 'quantity' => 10, 'unit' => 'kg', 'costPerUnit' => -1]);
check('a negative cost is refused', $r['code'] === 400);
check('…and nothing was saved', (int)$v("SELECT COUNT(*) FROM kitchen_ingredients WHERE name = 'QA Flour'") === 0);
$r = $post('kitchen2.php', 'ingredient_add', ['name' => 'QA Flour', 'quantity' => 10, 'unit' => 'kg', 'costPerUnit' => 800]);
check('stock with a cost is saved', ($r['json']['ok'] ?? 0) == 1, $r['raw']);
$kid = (int)$v("SELECT id FROM kitchen_ingredients WHERE name = 'QA Flour'");
$r = $post('kitchen2.php', 'ingredient_update', ['id' => $kid, 'name' => 'QA Flour', 'quantity' => 10, 'unit' => 'kg', 'costPerUnit' => 0]);
check('removing the cost from stocked ingredient is refused', $r['code'] === 400, $r['raw']);
check('…cost unchanged', (float)$v('SELECT cost_per_unit FROM kitchen_ingredients WHERE id = ?', [$kid]) == 800);

echo "== Bar items
";
$r = $post('bar-inventory.php', 'item_add', ['name' => 'QA Beer', 'price' => 1500, 'costPrice' => 0, 'type' => 'direct', 'stock' => 5, 'minStock' => 2]);
check('a direct item without a buy cost is refused', $r['code'] === 400, $r['raw']);

echo "== System Health lists items without a cost
";
$x('DELETE FROM bar_recipe_ingredients'); $x('DELETE FROM recipe_ingredients');
$x("UPDATE bar_items SET active = 0"); $x("UPDATE kitchen_menu SET status = 'inactive'");
$h = fn() => (function () use ($O) { $r = call('health.php', 'GET', 'status', [], $O + ['query' => 'full=1']); foreach (($r['json']['data']['checks'] ?? []) as $c) if ($c['key'] === 'biz_missing_cost') return $c; return null; })();
$c = $h();
check('with nothing wrong the check is ok', $c && $c['status'] === 'ok', json_encode($c));
$x("INSERT INTO bar_items (name, price, cost_price, type, stock, min_stock, active) VALUES ('QA Free Beer', 1000, 0, 'direct', 5, 1, 1)");
$c = $h();
check('an active drink with no cost is flagged', $c && $c['status'] === 'warn' && strpos($c['detail'], 'QA Free Beer') !== false, json_encode($c));
$x("UPDATE bar_items SET cost_price = 600 WHERE name = 'QA Free Beer'");
$c = $h();
check('once it has a cost the flag goes', $c && $c['status'] === 'ok', json_encode($c));
$x("INSERT INTO kitchen_menu (name, category, price, status) VALUES ('QA Dish', 'Food', 3000, 'active')");
$c = $h();
check('an active dish with no recipe cost is flagged', $c && $c['status'] === 'warn' && strpos($c['detail'], 'QA Dish') !== false, json_encode($c));
$x("UPDATE kitchen_menu SET status = 'inactive' WHERE name = 'QA Dish'");
$c = $h();
check('an inactive dish is not flagged', $c && $c['status'] === 'ok', json_encode($c));

echo "
$pass passed, $fail failed
";
sh("\"$BIN/mysql\" -uroot -e \"DROP DATABASE IF EXISTS $DB\"");
exit($fail ? 1 : 0);
