<?php
// ============================================================
//  tools/migrate_all_clients.php
//  Runs one migration .sql file for EVERY BarMS client:
//  the original tables and each client's own (t7_orders, …).
//
//  Command line:  php tools/migrate_all_clients.php stage2-migration.sql
//  Browser:       /tools/migrate_all_clients.php?file=stage2-migration.sql&key=<MIGRATE_KEY>
//                 (only if MIGRATE_KEY is defined in config/db.php — keep it secret)
//  The file should be "safe to run more than once" (IF NOT EXISTS …),
//  like every BarMS migration.
// ============================================================
require_once __DIR__ . '/../config/db.php';

$cli  = PHP_SAPI === 'cli';
$file = $cli ? ($argv[1] ?? '') : ($_GET['file'] ?? '');
if (!$cli) {
    header('Content-Type: text/plain; charset=utf-8');
    if (!defined('MIGRATE_KEY') || MIGRATE_KEY === '' || !hash_equals(MIGRATE_KEY, (string)($_GET['key'] ?? ''))) { http_response_code(403); exit("Forbidden\n"); }
}
$path = realpath(__DIR__ . '/../' . basename($file));
if (!$file || !$path || !is_file($path) || substr($path, -4) !== '.sql') exit("Give the name of a .sql file in the BarMS folder\n");

$db = getDB();
tenantRegistry($db);
$prefixes = array_unique(array_merge([''], $db->query('SELECT prefix FROM barms_tenants')->fetchAll(PDO::FETCH_COLUMN)));

// split on ; at line ends (BarMS migrations have no procedures)
$sql = preg_replace('/^\s*--.*$/m', '', file_get_contents($path));
$stmts = array_filter(array_map('trim', preg_split('/;\s*$/m', $sql)));

foreach ($prefixes as $p) {
    $db->tenantPrefix = $p;
    $ok = 0; $err = 0;
    foreach ($stmts as $s) {
        try { $db->exec($s); $ok++; }
        catch (Exception $e) { $err++; echo "  [" . ($p ?: 'original') . "] " . mb_substr($e->getMessage(), 0, 160) . "\n"; }
    }
    echo ($p ?: 'original tables') . ": $ok statement(s) ok, $err error(s)\n";
}
