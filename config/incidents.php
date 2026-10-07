<?php
// ============================================================
//  config/incidents.php — BarMS incident log (loaded by config/db.php)
//
//  An incident = one distinct problem. The same problem happening again is
//  counted on the same incident (occurrences, devices, users), never stored
//  as a new alert. Severity rises when it keeps happening.
//  Every incident has a reference (BRMS-YYYYMMDD-NNNN) shown to the user, so
//  support can find the technical detail, which only the Owner sees.
//
//  Writes use their own connection (barmsSideDB), so an incident is kept even
//  when the request that failed rolls its transaction back. If the database
//  itself is unavailable, the incident goes to the PHP error log instead.
// ============================================================

const INCIDENT_CATEGORIES = ['server', 'database', 'network', 'sync', 'frontend', 'integrity', 'performance', 'security', 'device', 'backup'];
const INCIDENT_SEVERITIES = ['info' => 0, 'warning' => 1, 'error' => 2, 'critical' => 3];

function barmsAppVersion(): string {
    static $v = null;
    if ($v === null) $v = trim((string)@file_get_contents(__DIR__ . '/../version.txt')) ?: '1.0.0';
    return $v;
}

// A second connection to the same client's tables, outside the request's transaction
function barmsSideDB(): ?PDO {
    static $db = false;
    if ($db !== false) return $db;
    try {
        $db = new TenantPDO('mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4', DB_USER, DB_PASS,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
        $db->tenantPrefix = getDB()->tenantPrefix;
    } catch (Throwable $e) { error_log('[BarMS] side connection failed: ' . $e->getMessage()); $db = null; }
    return $db;
}

// Remove anything secret before storing (passwords, tokens, keys, cookies)
function incidentClean(string $s, int $max = 2000): string {
    $s = preg_replace('/(password|passwd|pass|token|api[_-]?key|secret|csrf|cookie|authorization)(["\']?\s*[:=]\s*)("?)[^"\s,&}]+/i', '$1$2$3***', $s);
    $s = preg_replace('/\b[a-f0-9]{32,}\b/i', '***', $s);   // long hex strings (session ids, hashes)
    return mb_substr($s, 0, $max);
}
// Same problem → same fingerprint: numbers and quoted values are ignored
function incidentFingerprint(string $category, string $source, string $title): string {
    $norm = preg_replace(['/\d+/', "/'[^']*'/", '/"[^"]*"/'], ['#', "'?'", '"?"'], strtolower($title));
    return sha1("$category|" . strtolower($source) . "|$norm");
}

/**
 * Record a problem. Returns the incident reference (or null if nothing could be stored).
 * $i: category, severity, title, detail?, source?, device?, autoAction?
 */
function incidentRecord(array $i): ?string {
    $cat   = in_array($i['category'] ?? '', INCIDENT_CATEGORIES, true) ? $i['category'] : 'server';
    $sev   = isset(INCIDENT_SEVERITIES[$i['severity'] ?? '']) ? $i['severity'] : 'error';
    $title = mb_substr(incidentClean((string)($i['title'] ?? 'Problem'), 200), 0, 200);
    $src   = mb_substr((string)($i['source'] ?? ''), 0, 120);
    $detail = incidentClean((string)($i['detail'] ?? ''));
    $device = mb_substr((string)($i['device'] ?? ($_SERVER['HTTP_X_BARMS_DEVICE'] ?? '')), 0, 40);
    $user  = mb_substr((string)($_SESSION['full_name'] ?? ''), 0, 60);
    $fp    = incidentFingerprint($cat, $src, $title);
    $db = barmsSideDB();
    if (!$db) { error_log("[BarMS incident] $cat/$sev $title — $detail"); return null; }
    try {
        $st = $db->prepare("SELECT * FROM system_incidents WHERE fingerprint = ? AND status <> 'resolved' ORDER BY id DESC LIMIT 1");
        $st->execute([$fp]);
        $row = $st->fetch();
        if ($row && !empty($i['quiet'])) {   // a check seeing the same problem again: not a new occurrence
            $db->prepare('UPDATE system_incidents SET last_seen = NOW() WHERE id = ?')->execute([$row['id']]);
            return $row['ref'];
        }
        if ($row) {
            $n = (int)$row['occurrences'] + 1;
            $newSev = incidentEscalate($row['severity'], $sev, $n);
            $db->prepare('UPDATE system_incidents SET occurrences = ?, last_seen = NOW(), severity = ?, detail = ?, devices = ?, users = ?,
                          status = IF(status IN (\'recovered\'), \'open\', status) WHERE id = ?')
               ->execute([$n, $newSev, $detail ?: $row['detail'], incidentAddTo($row['devices'], $device), incidentAddTo($row['users'], $user), $row['id']]);
            if ($row['status'] === 'recovered') incidentEvent((int)$row['id'], 'occurred', 'Happened again after it had recovered');
            if (INCIDENT_SEVERITIES[$newSev] > INCIDENT_SEVERITIES[$row['severity']]) {
                incidentEvent((int)$row['id'], 'escalated', "Severity raised to $newSev after $n occurrences");
                incidentNotifyOwner($row['ref'], $title, $newSev, $n);
            } elseif ($n % 25 === 0) {
                incidentEvent((int)$row['id'], 'occurred', "$n occurrences so far");
            }
            return $row['ref'];
        }
        $db->prepare('INSERT INTO system_incidents (fingerprint, category, severity, title, detail, source, devices, users, auto_action, first_seen, last_seen, app_version)
                      VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW(),?)')
           ->execute([$fp, $cat, $sev, $title, $detail, $src, $device ?: null, $user ?: null, $i['autoAction'] ?? null, barmsAppVersion()]);
        $id = (int)$db->lastInsertId();
        $ref = 'BRMS-' . date('Ymd') . '-' . str_pad((string)$id, 4, '0', STR_PAD_LEFT);
        $db->prepare('UPDATE system_incidents SET ref = ? WHERE id = ?')->execute([$ref, $id]);
        incidentEvent($id, 'occurred', $src ? "First seen at $src" : 'First seen');
        if (INCIDENT_SEVERITIES[$sev] >= INCIDENT_SEVERITIES['error']) incidentNotifyOwner($ref, $title, $sev, 1);
        return $ref;
    } catch (Throwable $e) {
        error_log("[BarMS incident] could not store ($cat/$sev $title — $detail): " . $e->getMessage());
        return null;
    }
}
// keeps happening → more serious (never lowered automatically)
function incidentEscalate(string $current, string $reported, int $n): string {
    $lvl = max(INCIDENT_SEVERITIES[$current], INCIDENT_SEVERITIES[$reported]);
    if ($n >= 10 && $lvl < 2) $lvl = 2;
    if ($n >= 50 && $lvl < 3 && $current !== 'info') $lvl = 3;
    return array_search($lvl, INCIDENT_SEVERITIES, true);
}
function incidentAddTo(?string $list, string $v): ?string {
    if ($v === '') return $list;
    $items = $list ? explode(',', $list) : [];
    if (!in_array($v, $items, true) && count($items) < 20) $items[] = $v;
    return mb_substr(implode(',', $items), 0, 500);
}
function incidentEvent(int $id, string $kind, string $note = ''): void {
    $db = barmsSideDB(); if (!$db) return;
    try { $db->prepare('INSERT INTO system_incident_events (incident_id, kind, note) VALUES (?,?,?)')->execute([$id, $kind, mb_substr(incidentClean($note, 500), 0, 500)]); }
    catch (Throwable $e) { error_log('[BarMS] incident event: ' . $e->getMessage()); }
}
// The Owner sees serious problems in the notification bell (no technical detail there)
function incidentNotifyOwner(?string $ref, string $title, string $sev, int $n): void {
    $db = barmsSideDB(); if (!$db) return;
    // the bell is seen by staff too: a plain sentence and the reference, never technical text
    $plain = preg_match('/Exception|SQLSTATE|Error:|\.php|Browser:/i', $title) ? 'A technical problem was recorded' : $title;
    $msg = ($sev === 'critical' ? 'Critical: ' : 'Needs attention: ') . $plain . ($n > 1 ? " ($n times)" : '') . ($ref ? " — reference $ref. The Owner can see the details in System Health." : '');
    try { $db->prepare('INSERT INTO notifications (message, type) VALUES (?,?)')->execute([mb_substr($msg, 0, 250), 'error']); } catch (Throwable $e) {}
}

/**
 * An automatic recovery was tried for a problem: record whether it worked.
 * Recovered incidents stay visible (history) but stop being "open".
 */
function incidentRecovery(string $category, string $source, string $title, bool $worked, string $what): ?string {
    $ref = incidentRecord(['category' => $category, 'severity' => $worked ? 'info' : 'error', 'title' => $title, 'source' => $source, 'autoAction' => $what]);
    $db = barmsSideDB(); if (!$db) return $ref;
    try {
        $st = $db->prepare("SELECT id FROM system_incidents WHERE fingerprint = ? AND status <> 'resolved' ORDER BY id DESC LIMIT 1");
        $st->execute([incidentFingerprint($category, $source, $title)]);
        if ($id = (int)$st->fetchColumn()) {
            incidentEvent($id, $worked ? 'recovered' : 'recovery_failed', $what);
            if ($worked) $db->prepare("UPDATE system_incidents SET status = 'recovered', auto_action = ? WHERE id = ?")->execute([$what, $id]);
        }
    } catch (Throwable $e) {}
    return $ref;
}

// A failed request inside an endpoint: record it and answer with a calm message + reference
function serverFail(Throwable $e, string $what = 'This action'): void {
    $undone = getDB()->inTransaction();   // inside a transaction: everything is undone
    if ($undone) { try { getDB()->rollBack(); } catch (Throwable $x) {} }
    $ref = incidentRecord([
        'category' => $e instanceof PDOException ? 'database' : 'server', 'severity' => 'error',
        'title' => get_class($e) . ': ' . $e->getMessage(), 'detail' => $e->getFile() . ':' . $e->getLine() . "\n" . $e->getTraceAsString(),
        'source' => basename($_SERVER['SCRIPT_NAME'] ?? '') . '?' . ($_REQUEST['action'] ?? ''),
    ]);
    jsonOut(['ok' => false, 'error' => "$what could not be completed" . ($undone ? ' and nothing was saved' : '') . '. Please try again; if it keeps happening, contact support' . ($ref ? " with reference $ref" : '') . '.', 'ref' => $ref], 500);
}

// A check passes again: close its open incident (with a history line saying why)
function incidentCleared(string $category, string $source, string $title): void {
    $db = barmsSideDB(); if (!$db) return;
    try {
        $st = $db->prepare("SELECT id FROM system_incidents WHERE fingerprint = ? AND status <> 'resolved' ORDER BY id DESC LIMIT 1");
        $st->execute([incidentFingerprint($category, $source, $title)]);
        if ($id = (int)$st->fetchColumn()) {
            $db->prepare("UPDATE system_incidents SET status = 'resolved', resolved_at = NOW(), resolved_by = 'Automatic check', resolved_note = 'The check passes again' WHERE id = ?")->execute([$id]);
            incidentEvent($id, 'resolved', 'The check passes again');
        }
    } catch (Throwable $e) {}
}