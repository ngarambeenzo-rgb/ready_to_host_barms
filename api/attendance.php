<?php
// ============================================================
//  api/attendance.php — work attendance ("Start work" / "End work")
//  Not tied to signing in: the app signs people out after 10 idle minutes,
//  their work goes on until THEY end it.
//
//  Manager / Bartender / Kitchen:
//    GET  action=current                my open attendance (+ my expected start time)
//    POST action=start { device, note, clientUuid }
//    POST action=end   { note, attendanceUuid }
//  Owner, or a Manager with "view employees":
//    GET  action=on_duty                who is working now, and who has not started
//    GET  action=list  { preset, from, to, userId }   history + totals per person
//    GET  action=staff                  people with their expected start time
//  Owner only:
//    POST action=set_expected { userId, time }   expected start (HH:MM, empty = none)
//    POST action=force_end { id, endedAt? }      end someone's forgotten work
//  Offline devices send start/end later with their real time (clientUuid makes it safe to repeat).
// ============================================================
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/report_lib.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();

const ATT_WORKERS     = ['Manager', 'Bartender', 'Kitchen'];
const ATT_GRACE_MIN   = 5;    // minutes after the expected start that still count as on time
const ATT_STALE_HOURS = 18;   // work still "open" after this long was forgotten, not worked

$action = $_REQUEST['action'] ?? 'current';
$sess   = requireAuth();
$db     = getDB();
$body   = $_SERVER['REQUEST_METHOD'] === 'POST' ? (json_decode(file_get_contents('php://input'), true) ?? []) : [];

function attAudit(PDO $db, string $details, string $by): void {
    try { $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')->execute(['ATTENDANCE', $details, $by]); } catch (Exception $e) {}
}

// minutes late for a start at $at (null = nothing to compare with, or a different shift of the day)
function attLate(?string $expected, string $at): ?int {
    if (!$expected) return null;
    $diff = (int)round((strtotime($at) - strtotime(substr($at, 0, 10) . ' ' . $expected)) / 60);
    if ($diff < -12 * 60) $diff += 24 * 60;      // expected 22:00, started 01:00 → 3 hours late
    if ($diff > 12 * 60) return null;            // hours after the expected time: another shift, not lateness
    return $diff > ATT_GRACE_MIN ? $diff : 0;
}

function attRow(array $r): array {
    return [
        'id' => (int)$r['id'], 'userId' => (int)$r['user_id'], 'user' => $r['user_name'], 'role' => $r['role'],
        'startedAt' => $r['started_at'], 'endedAt' => $r['ended_at'], 'status' => $r['status'],
        'expectedStart' => $r['expected_start'] ? substr($r['expected_start'], 0, 5) : null,
        'lateMinutes' => $r['late_minutes'] === null ? null : (int)$r['late_minutes'],
        'device' => $r['device'], 'startNote' => $r['start_note'], 'endNote' => $r['end_note'], 'endedBy' => $r['ended_by'],
        // minutes worked so far (open) or in total (closed); work that was never ended has no hours
        'minutes' => $r['status'] === 'forgot' ? null : max(0, (int)$r['mins']),
        'stale' => $r['status'] === 'open' && (int)$r['mins'] >= ATT_STALE_HOURS * 60,
    ];
}
const ATT_SELECT = 'SELECT a.*, TIMESTAMPDIFF(MINUTE, a.started_at, COALESCE(a.ended_at, NOW())) AS mins FROM attendance a';

$myOpen = function () use ($db, $sess) {
    $st = $db->prepare(ATT_SELECT . " WHERE a.user_id = ? AND a.status = 'open' ORDER BY a.id DESC LIMIT 1");
    $st->execute([(int)$sess['user_id']]);
    return $st->fetch() ?: null;
};
$canSee = fn() => hasPerm('canViewEmployees');

try {

if ($action === 'current') {
    $open = $myOpen();
    $exp = null;
    if (in_array($sess['role'], ATT_WORKERS, true)) {
        $st = $db->prepare('SELECT expected_start FROM users WHERE id = ?');
        $st->execute([(int)$sess['user_id']]);
        $e = $st->fetchColumn();
        $exp = $e ? substr($e, 0, 5) : null;
    }
    jsonOut(['ok' => true, 'canClock' => in_array($sess['role'], ATT_WORKERS, true), 'expectedStart' => $exp, 'attendance' => $open ? attRow($open) : null]);
}

if ($action === 'start') {
    requireRole(ATT_WORKERS);
    $uuid   = trim((string)($body['clientUuid'] ?? ''));
    $note   = mb_substr(trim((string)($body['note'] ?? '')), 0, 255);
    $device = mb_substr(trim((string)($body['device'] ?? '')), 0, 120) ?: null;
    $offline = !empty($_SESSION['offline']);
    $at = barmsActionTime();

    if ($uuid !== '') {   // sent again after a lost answer
        $st = $db->prepare('SELECT id FROM attendance WHERE client_uuid = ? LIMIT 1');
        $st->execute([$uuid]);
        if ($id = $st->fetchColumn()) jsonOut(['ok' => true, 'id' => (int)$id, 'alreadyDone' => true]);
    }
    $db->beginTransaction();
    // two taps at once must not make two starts
    $st = $db->prepare("SELECT id, started_at FROM attendance WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1 FOR UPDATE");
    $st->execute([(int)$sess['user_id']]);
    if ($open = $st->fetch()) {
        $hours = (strtotime($at) - strtotime($open['started_at'])) / 3600;
        if ($hours < ATT_STALE_HOURS) {
            $db->rollBack();
            if ($offline) {   // the work was already started on the server: the offline start is the same work
                if ($uuid !== '') $db->prepare('UPDATE attendance SET client_uuid = COALESCE(client_uuid, ?) WHERE id = ?')->execute([$uuid, $open['id']]);
                jsonOut(['ok' => true, 'id' => (int)$open['id'], 'merged' => true]);
            }
            jsonOut(['ok' => false, 'error' => 'You already started work at ' . substr($open['started_at'], 11, 5) . '. End it first.', 'alreadyStarted' => true], 409);
        }
        // never ended, long ago: it was forgotten, so its hours are not counted
        $db->prepare("UPDATE attendance SET status = 'forgot', end_note = ? WHERE id = ?")->execute(['Work was never ended', $open['id']]);
        attAudit($db, "Work started on {$open['started_at']} was never ended", $sess['full_name']);
    }
    $st = $db->prepare('SELECT expected_start FROM users WHERE id = ?');
    $st->execute([(int)$sess['user_id']]);
    $exp = $st->fetchColumn() ?: null;
    $late = attLate($exp, $at);
    $db->prepare('INSERT INTO attendance (user_id, user_name, role, started_at, status, expected_start, late_minutes, device, start_note, client_uuid) VALUES (?,?,?,?,?,?,?,?,?,?)')
       ->execute([(int)$sess['user_id'], $sess['full_name'], $sess['role'], $at, 'open', $exp, $late, $device, $note ?: null, $uuid !== '' ? $uuid : null]);
    $newId = (int)$db->lastInsertId();
    $hhmm = substr($at, 11, 5);
    $msg = "{$sess['full_name']} ({$sess['role']}) started work at $hhmm" . ($late ? " — $late min late" : '') . ($offline ? ' (recorded offline)' : '');
    attAudit($db, $msg . ($note ? " — $note" : ''), $sess['full_name']);
    $db->commit();
    // the Owner's notice: only the Owner sees it (for_roles); an old database without the column still gets the plain notice
    try { $db->prepare('INSERT INTO notifications (message, type, for_roles) VALUES (?,?,?)')->execute([$msg, $late ? 'warning' : 'info', 'Owner']); }
    catch (Exception $e) {}
    jsonOut(['ok' => true, 'id' => $newId, 'lateMinutes' => $late, 'startedAt' => $at]);
}

if ($action === 'end') {
    requireRole(ATT_WORKERS);
    $note = mb_substr(trim((string)($body['note'] ?? '')), 0, 255);
    $at = barmsActionTime();
    $s = $myOpen();
    $uuid = trim((string)($body['attendanceUuid'] ?? ''));
    if (!empty($_SESSION['offline']) && $uuid !== '') {   // the work started offline on the device
        $st = $db->prepare(ATT_SELECT . ' WHERE a.client_uuid = ? AND a.user_id = ? LIMIT 1');
        $st->execute([$uuid, (int)$sess['user_id']]);
        $found = $st->fetch();
        if ($found && $found['status'] !== 'open') jsonOut(['ok' => true, 'alreadyDone' => true]);
        $s = $found ?: $s;
    }
    if (!$s) {
        // an offline end that finds nothing open: it was already ended (for example by the Owner), not a problem to report
        if (!empty($_SESSION['offline'])) jsonOut(['ok' => true, 'alreadyDone' => true]);
        jsonOut(['ok' => false, 'error' => 'You have not started work'], 400);
    }
    if ((strtotime($at) - strtotime($s['started_at'])) / 3600 >= ATT_STALE_HOURS) {
        // too long to be real work: say so instead of counting a day and a half of hours
        $db->prepare("UPDATE attendance SET status = 'forgot', end_note = ? WHERE id = ? AND status = 'open'")->execute(['Work was never ended', $s['id']]);
        attAudit($db, "Work started on {$s['started_at']} was never ended", $sess['full_name']);
        jsonOut(['ok' => true, 'forgotten' => true, 'message' => 'That work started more than ' . ATT_STALE_HOURS . ' hours ago and was not ended in time, so its hours are not counted. Start work again for today.']);
    }
    $db->prepare("UPDATE attendance SET status = 'closed', ended_at = ?, end_note = ? WHERE id = ? AND status = 'open'")->execute([$at, $note ?: null, $s['id']]);
    $mins = max(0, (int)round((strtotime($at) - strtotime($s['started_at'])) / 60));
    attAudit($db, "Ended work (started " . substr($s['started_at'], 11, 5) . ", worked " . intdiv($mins, 60) . 'h ' . ($mins % 60) . 'm)' . ($note ? " — $note" : ''), $sess['full_name']);
    jsonOut(['ok' => true, 'minutes' => $mins]);
}

if ($action === 'on_duty') {
    if (!$canSee()) jsonOut(['ok' => false, 'error' => 'You do not have permission for this. Ask the Owner.'], 403);
    $working = array_map('attRow', $db->query(ATT_SELECT . " WHERE a.status = 'open' ORDER BY a.started_at")->fetchAll());
    // people with an expected start time that has passed and who have not started
    $not = [];
    $now = (string)$db->query('SELECT NOW()')->fetchColumn();
    $day = substr($now, 0, 10);
    $workingIds = array_column($working, 'userId');
    $users = $db->query("SELECT id, full_name, role, expected_start FROM users WHERE active = 1 AND expected_start IS NOT NULL AND role IN ('Manager','Bartender','Kitchen')")->fetchAll();
    $had = $db->prepare('SELECT COUNT(*) FROM attendance WHERE user_id = ? AND started_at >= ?');
    foreach ($users as $u) {
        if (in_array((int)$u['id'], $workingIds, true)) continue;
        $due = $day . ' ' . $u['expected_start'];
        $late = (int)floor((strtotime($now) - strtotime($due)) / 60);
        if ($late <= ATT_GRACE_MIN || $late > 12 * 60) continue;
        $had->execute([(int)$u['id'], date('Y-m-d H:i:s', strtotime($due) - 3 * 3600)]);
        if ((int)$had->fetchColumn() > 0) continue;   // already started (and ended) for this shift
        $not[] = ['userId' => (int)$u['id'], 'user' => $u['full_name'], 'role' => $u['role'], 'expectedStart' => substr($u['expected_start'], 0, 5), 'minutesLate' => $late];
    }
    jsonOut(['ok' => true, 'working' => $working, 'notStarted' => $not, 'now' => $now]);
}

if ($action === 'list') {
    if (!$canSee()) jsonOut(['ok' => false, 'error' => 'You do not have permission for this. Ask the Owner.'], 403);
    $P = rpPeriod($_GET['preset'] ?? 'this_week', $_GET['from'] ?? null, $_GET['to'] ?? null);
    $uid = (int)($_GET['userId'] ?? 0);
    $st = $db->prepare(ATT_SELECT . ' WHERE a.started_at >= ? AND a.started_at < DATE_ADD(?, INTERVAL 1 DAY)' . ($uid ? ' AND a.user_id = ?' : '') . ' ORDER BY a.started_at DESC LIMIT 1000');
    $st->execute(array_merge([$P['from'], $P['to']], $uid ? [$uid] : []));
    $rows = array_map('attRow', $st->fetchAll());
    $per = [];
    foreach ($rows as $r) {
        $p = &$per[$r['userId']];
        if (!$p) $p = ['userId' => $r['userId'], 'user' => $r['user'], 'role' => $r['role'], 'starts' => 0, 'days' => [], 'minutes' => 0, 'late' => 0, 'lateMinutes' => 0, 'forgot' => 0];
        $p['starts']++;
        $p['days'][substr($r['startedAt'], 0, 10)] = 1;
        if ($r['status'] === 'closed') $p['minutes'] += (int)$r['minutes'];
        if ($r['status'] === 'forgot' || $r['stale']) $p['forgot']++;
        if ($r['lateMinutes']) { $p['late']++; $p['lateMinutes'] += $r['lateMinutes']; }
        unset($p);
    }
    foreach ($per as &$p) { $p['days'] = count($p['days']); }
    unset($p);
    usort($per, fn($a, $b) => strcmp($a['user'], $b['user']));
    jsonOut(['ok' => true, 'period' => $P, 'rows' => $rows, 'people' => array_values($per)]);
}

if ($action === 'staff') {
    if (!$canSee()) jsonOut(['ok' => false, 'error' => 'You do not have permission for this. Ask the Owner.'], 403);
    $out = [];
    foreach ($db->query("SELECT id, full_name, role, expected_start FROM users WHERE active = 1 AND role IN ('Manager','Bartender','Kitchen') ORDER BY full_name")->fetchAll() as $u) {
        $out[] = ['userId' => (int)$u['id'], 'user' => $u['full_name'], 'role' => $u['role'], 'expectedStart' => $u['expected_start'] ? substr($u['expected_start'], 0, 5) : null];
    }
    jsonOut(['ok' => true, 'staff' => $out]);
}

if ($action === 'set_expected') {
    requireRole(['Owner']);
    $id = (int)($body['userId'] ?? 0);
    $t = trim((string)($body['time'] ?? ''));
    if ($t !== '' && !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $t)) jsonOut(['ok' => false, 'error' => 'Enter the time like 08:00'], 400);
    $st = $db->prepare("SELECT full_name FROM users WHERE id = ? AND active = 1 AND role IN ('Manager','Bartender','Kitchen')");
    $st->execute([$id]);
    $name = $st->fetchColumn();
    if (!$name) jsonOut(['ok' => false, 'error' => 'Person not found'], 404);
    $db->prepare('UPDATE users SET expected_start = ? WHERE id = ?')->execute([$t === '' ? null : $t . ':00', $id]);
    attAudit($db, $t === '' ? "Removed the expected start time of $name" : "Expected start time of $name set to $t", $sess['full_name']);
    jsonOut(['ok' => true]);
}

if ($action === 'force_end') {
    requireRole(['Owner']);
    $id = (int)($body['id'] ?? 0);
    $st = $db->prepare(ATT_SELECT . " WHERE a.id = ? AND a.status = 'open'");
    $st->execute([$id]);
    $a = $st->fetch();
    if (!$a) jsonOut(['ok' => false, 'error' => 'This work is not open any more'], 404);
    $now = (string)$db->query('SELECT NOW()')->fetchColumn();
    $end = $now;
    $given = trim((string)($body['endedAt'] ?? ''));
    if ($given !== '') {
        $ts = strtotime($given);
        if (!$ts) jsonOut(['ok' => false, 'error' => 'Enter a valid end time'], 400);
        $end = date('Y-m-d H:i:s', $ts);
        if ($end < $a['started_at'] || $end > $now) jsonOut(['ok' => false, 'error' => 'The end time must be after the start and not in the future'], 400);
    }
    $note = mb_substr(trim((string)($body['note'] ?? '')), 0, 255);
    $db->prepare("UPDATE attendance SET status = 'closed', ended_at = ?, ended_by = ?, end_note = ? WHERE id = ? AND status = 'open'")->execute([$end, $sess['full_name'], $note ?: 'Ended by the Owner', $id]);
    attAudit($db, "Ended {$a['user_name']}'s work (started " . substr($a['started_at'], 0, 16) . ") at " . substr($end, 0, 16), $sess['full_name']);
    jsonOut(['ok' => true]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);

} catch (Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    serverFail($e);
}
