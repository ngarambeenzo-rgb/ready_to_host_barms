<?php
// ============================================================
//  api/health.php — BarMS health and incidents
//  POST action=client_error  {message, source, page, version, kind}   any signed-in user (and the sign-in screen)
//       A browser problem becomes an incident (grouped with its repeats).
//  Owner only:
//    GET  action=status    {full=1, clientVersion}   checks + overall status (healthy | degraded | action_required | critical)
//    GET  action=incidents {range=today|24h|7d|30d, status=active|all}
//    GET  action=incident  {id}                       one incident with its history
//    POST action=resolve   {id, note}
//    POST action=backup                      make + verify a database backup of this client
//    GET  action=backup_download {file}      download one of this client's backups
// ============================================================
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/health_lib.php';
require_once __DIR__ . '/backup_lib.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();
$action = $_REQUEST['action'] ?? '';
$body   = $_SERVER['REQUEST_METHOD'] === 'POST' ? (json_decode(file_get_contents('php://input'), true) ?: []) : [];

// public: which version the server runs (the browser compares it with its own files)
if ($action === 'version') {
    header('Cache-Control: no-store');
    jsonOut(['ok' => true, 'version' => barmsAppVersion()]);
}

if ($action === 'client_error') {
    // at most 30 reports per session per hour, so a looping error cannot flood the log
    $now = time();
    $_SESSION['client_err'] = array_values(array_filter($_SESSION['client_err'] ?? [], fn($t) => $t > $now - 3600));
    if (count($_SESSION['client_err']) >= 30) jsonOut(['ok' => true, 'skipped' => true]);
    $_SESSION['client_err'][] = $now;

    $kinds = ['js' => 'frontend', 'sync' => 'sync', 'device' => 'device', 'network' => 'network', 'version' => 'device'];
    $kind = $body['kind'] ?? 'js';
    $msg = trim((string)($body['message'] ?? ''));
    if ($msg === '') jsonOut(['ok' => false, 'error' => 'message required'], 400);
    // the browser tried a safe recovery: record whether it worked (same incident as the problem)
    if (in_array($body['recovery'] ?? '', ['worked', 'failed'], true)) {
        $ref = incidentRecovery($kinds[$kind] ?? 'frontend', mb_substr((string)($body['source'] ?? ''), 0, 120), 'Browser: ' . mb_substr($msg, 0, 180),
                                $body['recovery'] === 'worked', mb_substr((string)($body['autoAction'] ?? 'Automatic recovery'), 0, 200));
        jsonOut(['ok' => true, 'ref' => $ref]);
    }
    $ref = incidentRecord([
        'category' => $kinds[$kind] ?? 'frontend',
        'severity' => in_array($body['severity'] ?? '', ['info', 'warning', 'error'], true) ? $body['severity'] : 'warning',
        'title'    => 'Browser: ' . mb_substr($msg, 0, 180),
        'detail'   => mb_substr("Page: " . ($body['page'] ?? '') . "\nApp version: " . ($body['version'] ?? '') . "\nBrowser: " . ($_SERVER['HTTP_USER_AGENT'] ?? '') . "\n" . ($body['stack'] ?? ''), 0, 2000),
        'source'   => mb_substr((string)($body['source'] ?? ''), 0, 120),
        'autoAction' => mb_substr((string)($body['autoAction'] ?? ''), 0, 200) ?: null,
    ]);
    jsonOut(['ok' => true, 'ref' => $ref]);
}

// ── Owner: health and incidents ──────────────────
$sess = requireRole(['Owner']);
$db   = getDB();

if ($action === 'status') {
    $cv = preg_match('/^[\w.\-]{1,20}$/', $_GET['clientVersion'] ?? '') ? $_GET['clientVersion'] : null;
    jsonOut(['ok' => true, 'data' => hlStatus($db, $cv, ($_GET['full'] ?? '1') === '1')]);
}

if ($action === 'incidents') {
    $since = ['today' => date('Y-m-d 00:00:00'), '24h' => date('Y-m-d H:i:s', time() - 86400), '7d' => date('Y-m-d H:i:s', time() - 7 * 86400), '30d' => date('Y-m-d H:i:s', time() - 30 * 86400)][$_GET['range'] ?? '7d'] ?? date('Y-m-d H:i:s', time() - 7 * 86400);
    $active = ($_GET['status'] ?? 'active') === 'active';
    $st = $db->prepare('SELECT id, ref, category, severity, title, source, status, occurrences, devices, users, auto_action, first_seen, last_seen, resolved_at, resolved_by, resolved_note
                        FROM system_incidents WHERE last_seen >= ?' . ($active ? " AND status IN ('open','recovering')" : '') . "
                        ORDER BY FIELD(status,'open','recovering','recovered','resolved'), FIELD(severity,'critical','error','warning','info'), last_seen DESC LIMIT 200");
    $st->execute([$since]);
    $rows = $st->fetchAll();
    foreach ($rows as &$r) { $r['deviceCount'] = $r['devices'] ? count(explode(',', $r['devices'])) : 0; $r['userCount'] = $r['users'] ? count(explode(',', $r['users'])) : 0; }
    unset($r);
    $sum = $db->prepare("SELECT COUNT(*) total, SUM(status IN ('recovered')) recovered, SUM(auto_action IS NOT NULL) auto FROM system_incidents WHERE last_seen >= ?");
    $sum->execute([$since]);
    jsonOut(['ok' => true, 'data' => $rows, 'summary' => $sum->fetch()]);
}

if ($action === 'incident') {
    $st = $db->prepare('SELECT * FROM system_incidents WHERE id = ?');
    $st->execute([(int)($_GET['id'] ?? 0)]);
    $inc = $st->fetch();
    if (!$inc) jsonOut(['ok' => false, 'error' => 'Incident not found'], 404);
    $ev = $db->prepare('SELECT kind, note, created_at FROM system_incident_events WHERE incident_id = ? ORDER BY id');
    $ev->execute([$inc['id']]);
    jsonOut(['ok' => true, 'data' => $inc + ['events' => $ev->fetchAll()]]);
}

if ($action === 'backup') {
    try { $m = backupCreate($db, $sess['full_name']); }
    catch (Throwable $e) {
        $ref = incidentRecord(['category' => 'backup', 'severity' => 'error', 'title' => 'Database backup could not be made', 'detail' => $e->getMessage(), 'source' => 'backup']);
        jsonOut(['ok' => false, 'error' => 'The backup could not be made' . ($ref ? " (reference $ref)" : '') . '.'], 500);
    }
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['BACKUP', "Database backup {$m['file']} — " . ($m['verify']['ok'] ? 'verified' : 'FAILED check: ' . $m['verify']['reason']), $sess['full_name']]);
    if (!$m['verify']['ok']) jsonOut(['ok' => false, 'error' => 'A backup was written but failed its check: ' . $m['verify']['reason']], 500);
    jsonOut(['ok' => true, 'data' => ['file' => $m['file'], 'rows' => $m['verify']['rows'], 'size' => $m['size'], 'createdAt' => $m['createdAt']]]);
}

if ($action === 'backup_download') {
    $file = (string)($_GET['file'] ?? '');
    $mine = array_column(backupList($db), 'file');   // only this client's own backups
    if (!in_array($file, $mine, true)) jsonOut(['ok' => false, 'error' => 'Backup not found'], 404);
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')->execute(['BACKUP', "Downloaded backup $file", $sess['full_name']]);
    header('Content-Type: application/gzip');
    header('Content-Disposition: attachment; filename="' . $file . '"');
    header('Content-Length: ' . filesize(backupDir() . '/' . $file));
    readfile(backupDir() . '/' . $file);
    exit;
}

if ($action === 'resolve') {
    $id = (int)($body['id'] ?? 0);
    $note = mb_substr(trim($body['note'] ?? ''), 0, 255);
    if ($note === '') jsonOut(['ok' => false, 'error' => 'Write what was done to fix it'], 400);
    $st = $db->prepare("UPDATE system_incidents SET status = 'resolved', resolved_at = NOW(), resolved_by = ?, resolved_note = ? WHERE id = ? AND status <> 'resolved'");
    $st->execute([$sess['full_name'], $note, $id]);
    if ($st->rowCount() !== 1) jsonOut(['ok' => false, 'error' => 'Already resolved or not found'], 409);
    incidentEvent($id, 'resolved', "By {$sess['full_name']}: $note");
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')->execute(['HEALTH', "Resolved incident #$id: $note", $sess['full_name']]);
    jsonOut(['ok' => true]);
}
jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
