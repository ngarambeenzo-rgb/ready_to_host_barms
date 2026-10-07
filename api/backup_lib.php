<?php
// ============================================================
//  api/backup_lib.php — database backups of one BarMS client
//
//  • every table of the client (the same tables the app uses), as SQL, gzip-compressed
//  • a backup is only "verified" after it is read back: every table's row count in the
//    file must equal the count taken while writing, and the checksum must match
//  • retention: the newest BACKUP_KEEP backups of each client are kept, older ones removed
//  • restore is never automatic: import the .sql.gz with phpMyAdmin / mysql when needed
//  • folder backups/db/ is closed to the web (.htaccess); downloads go through
//    api/health.php?action=backup_download (Owner only)
// ============================================================

const BACKUP_KEEP = 14;
const BACKUP_MAX_AGE_HOURS = 26;   // older than this = a daily backup was missed

function backupDir(): string {
    // the reliability tests write their backups elsewhere, never next to the real ones
    $dir = (getenv('BARMS_QA_RUN') === '1' && getenv('QA_BACKUP_DIR')) ? getenv('QA_BACKUP_DIR') : __DIR__ . '/../backups/db';
    if (!is_dir($dir)) @mkdir($dir, 0750, true);
    $guard = __DIR__ . '/../backups/.htaccess';
    if (!is_file($guard)) @file_put_contents($guard, "Require all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
    if (!is_file($dir . '/index.html')) @file_put_contents($dir . '/index.html', '');
    return $dir;
}
// files of this client only (clients never see each other's backups)
function backupPrefixTag(PDO $db): string { return $db->tenantPrefix === '' ? 'main' : rtrim($db->tenantPrefix, '_'); }
function backupList(PDO $db): array {
    $tag = backupPrefixTag($db);
    $out = [];
    foreach (glob(backupDir() . "/barms_{$tag}_*.json") ?: [] as $m) {
        $j = json_decode((string)file_get_contents($m), true);
        if ($j && is_file(backupDir() . '/' . $j['file'])) $out[] = $j;
    }
    usort($out, fn($a, $b) => strcmp($b['createdAt'], $a['createdAt']));
    return $out;
}

/** Make and verify a backup. Returns the manifest. Never touches business data. */
function backupCreate(PDO $db, string $by): array {
    @set_time_limit(300);
    $tag = backupPrefixTag($db);
    $stamp = date('Ymd_His');
    $name = "barms_{$tag}_{$stamp}_" . bin2hex(random_bytes(4));
    $path = backupDir() . "/$name.sql.gz";
    $gz = gzopen($path, 'wb6');
    if (!$gz) throw new RuntimeException('Cannot write to the backups folder');
    $counts = [];
    gzwrite($gz, "-- BarMS backup · client $tag · " . date('Y-m-d H:i:s') . " · version " . barmsAppVersion() . "\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n");
    // one consistent moment for every table: a sale saved during the backup is either fully in it or not at all
    $own = !$db->inTransaction();
    if ($own) { $db->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); $db->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT'); }
    try {
        foreach (array_unique(array_merge(BARMS_TENANT_TABLES, ['counters'])) as $t) {
            $real = $db->tbl($t);
            try { $create = $db->query("SHOW CREATE TABLE `$real`")->fetch(PDO::FETCH_NUM)[1]; }
            catch (Throwable $e) {
                if ($t === 'counters') continue;   // exists only after longevity-migration.sql
                $counts[$t] = null; gzwrite($gz, "\n-- table $real could not be read: " . str_replace("\n", ' ', $e->getMessage()) . "\n"); continue;
            }
            gzwrite($gz, "\nDROP TABLE IF EXISTS `$real`;\n$create;\n");
            $n = 0;
            // read in pages of 2000 rows by the numeric primary key, so memory stays small with years of records
            $pk = $db->query("SHOW KEYS FROM `$real` WHERE Key_name = 'PRIMARY'")->fetchAll(PDO::FETCH_ASSOC);
            $pkCol = count($pk) === 1 ? $pk[0]['Column_name'] : null;
            if ($pkCol !== null) {
                $type = (string)$db->query("SHOW COLUMNS FROM `$real` LIKE " . $db->quote($pkCol))->fetch(PDO::FETCH_ASSOC)['Type'];
                if (!preg_match('/int/i', $type)) $pkCol = null;
            }
            $last = null;
            do {
                if ($pkCol === null) { $rows = $db->query("SELECT * FROM `$real`")->fetchAll(PDO::FETCH_ASSOC); }   // small tables without a numeric key
                else {
                    $st = $db->prepare("SELECT * FROM `$real`" . ($last === null ? '' : " WHERE `$pkCol` > ?") . " ORDER BY `$pkCol` LIMIT 2000");
                    $st->execute($last === null ? [] : [$last]);
                    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
                }
                foreach ($rows as $row) {
                    $vals = array_map(fn($v) => $v === null ? 'NULL' : $db->quote((string)$v), array_values($row));
                    gzwrite($gz, "INSERT INTO `$real` VALUES (" . implode(',', $vals) . ");\n");
                    $n++;
                }
                if ($pkCol !== null && $rows) $last = end($rows)[$pkCol];
            } while ($pkCol !== null && count($rows) === 2000);
            $counts[$t] = $n;
        }
    } finally {
        if ($own) $db->exec('COMMIT');
    }
    gzwrite($gz, "\nSET FOREIGN_KEY_CHECKS=1;\n-- end of backup\n");
    gzclose($gz);

    $manifest = ['file' => "$name.sql.gz", 'createdAt' => date('Y-m-d H:i:s'), 'by' => $by, 'client' => $tag, 'version' => barmsAppVersion(),
                 'size' => filesize($path), 'sha256' => hash_file('sha256', $path), 'counts' => $counts,
                 'unreadable' => array_keys(array_filter($counts, fn($c) => $c === null))];
    $manifest['verify'] = backupVerify($path, $manifest);
    file_put_contents(backupDir() . "/$name.json", json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    backupPrune($db);
    return $manifest;
}

/** Read the file back: complete, checksum unchanged, and the same rows per table. */
function backupVerify(string $path, array $m): array {
    if (!is_file($path)) return ['ok' => false, 'reason' => 'File missing'];
    if (hash_file('sha256', $path) !== $m['sha256']) return ['ok' => false, 'reason' => 'Checksum differs (file changed or damaged)'];
    $gz = gzopen($path, 'rb');
    if (!$gz) return ['ok' => false, 'reason' => 'Cannot open the file'];
    $found = []; $end = false;
    while (($line = gzgets($gz)) !== false) {
        if (strncmp($line, 'INSERT INTO `', 13) === 0) { $t = substr($line, 13, strpos($line, '`', 13) - 13); $found[$t] = ($found[$t] ?? 0) + 1; }
        elseif (strncmp($line, '-- end of backup', 16) === 0) $end = true;
    }
    gzclose($gz);
    if (!$end) return ['ok' => false, 'reason' => 'The file is incomplete'];
    $wrong = [];
    foreach ($m['counts'] as $t => $n) {
        if ($n === null) continue;
        $real = $m['client'] === 'main' ? $t : $m['client'] . '_' . $t;
        if (($found[$real] ?? 0) !== $n) $wrong[] = "$t (" . ($found[$real] ?? 0) . " of $n rows)";
    }
    if ($wrong) return ['ok' => false, 'reason' => 'Rows missing: ' . implode(', ', $wrong)];
    if ($m['unreadable']) return ['ok' => false, 'reason' => 'Could not include: ' . implode(', ', $m['unreadable'])];
    return ['ok' => true, 'rows' => array_sum(array_filter($m['counts'], 'is_int')), 'checkedAt' => date('Y-m-d H:i:s')];
}

// keep the newest BACKUP_KEEP of this client
function backupPrune(PDO $db): void {
    foreach (array_slice(backupList($db), BACKUP_KEEP) as $old) {
        @unlink(backupDir() . '/' . $old['file']);
        @unlink(backupDir() . '/' . preg_replace('/\.sql\.gz$/', '.json', $old['file']));
    }
}

/** Health check for backups: recent and verified. */
function hlBackup(PDO $db): array {
    $list = backupList($db);
    if (!$list) return hlCheck('backup', 'Backups', 'Database backup', 'warn', 'No backup yet — press "Back up now"', ['action' => 'shBackupNow()', 'actionLabel' => 'Back up now']);
    $last = $list[0];
    $hours = (int)floor((time() - strtotime($last['createdAt'])) / 3600);
    if (empty($last['verify']['ok'])) {
        incidentRecord(['category' => 'backup', 'severity' => 'error', 'quiet' => true, 'title' => 'The latest backup failed its check', 'detail' => $last['file'] . ': ' . ($last['verify']['reason'] ?? ''), 'source' => 'backup check']);
        return hlCheck('backup', 'Backups', 'Database backup', 'fail', 'Latest backup failed its check: ' . ($last['verify']['reason'] ?? ''), ['action' => 'shBackupNow()', 'actionLabel' => 'Back up again']);
    }
    incidentCleared('backup', 'backup check', 'The latest backup failed its check');
    $detail = "Last: {$last['createdAt']} ({$hours} h ago), verified — " . number_format($last['verify']['rows']) . ' rows, ' . round($last['size'] / 1024) . ' KB · ' . count($list) . ' kept';
    return hlCheck('backup', 'Backups', 'Database backup', $hours > BACKUP_MAX_AGE_HOURS ? 'warn' : 'ok', $detail,
        ['action' => 'shBackupNow()', 'actionLabel' => 'Back up now', 'download' => $last['file'], 'due' => $hours >= 24]);
}
