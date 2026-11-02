<?php
// ============================================================
//  api/shifts.php — cash shifts
//  GET  action=current               my open shift + live expected cash
//  POST action=open  { openingFloat, device }
//  POST action=close { countedCash, note }
//  GET  action=list                  recent shifts (reports permission)
//  Offline devices send open/close later with their real time (and the shift's clientUuid);
//  the payments made in between land in the shift that was open at their time.
// ============================================================
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/report_lib.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();

$action = $_REQUEST['action'] ?? 'current';
$sess   = requireRole(['Owner', 'Manager', 'Bartender']);
$db     = getDB();

$myOpen = function () use ($db, $sess) {
    $st = $db->prepare("SELECT * FROM shifts WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1");
    $st->execute([(int)$sess['user_id']]);
    return $st->fetch() ?: null;
};

if ($action === 'current') {
    $s = $myOpen();
    // other people's open shifts: with none of their own, a Bartender or Manager takes payments in
    // the latest of these (the payment is counted there and marked), so the screen can say whose
    $others = [];
    $st = $db->prepare("SELECT id, user_name, opened_at FROM shifts WHERE status = 'open' AND user_id <> ? ORDER BY id DESC");
    $st->execute([(int)$sess['user_id']]);
    foreach ($st->fetchAll() as $o) $others[] = ['id' => (int)$o['id'], 'userName' => $o['user_name'], 'openedAt' => $o['opened_at']];
    jsonOut(['ok' => true, 'shift' => $s ? [
        'id' => (int)$s['id'], 'openedAt' => $s['opened_at'], 'openingFloat' => (float)$s['opening_float'],
        'device' => $s['device'], 'userName' => $s['user_name'], 'cash' => rpShiftCash($db, $s),
    ] : null, 'others' => $others]);
}

$offAt = !empty($_SESSION['offline']) ? barmsActionTime() : null;   // original time of an offline record

if ($action === 'open') {
    $body  = json_decode(file_get_contents('php://input'), true) ?? [];
    $uuid  = trim((string)($body['clientUuid'] ?? ''));
    if ($offAt) {
        // sent again after a lost answer, or the person already had a shift open on the server
        if ($uuid !== '') {
            $st = $db->prepare('SELECT id FROM shifts WHERE client_uuid = ? LIMIT 1');
            $st->execute([$uuid]);
            if ($id = $st->fetchColumn()) jsonOut(['ok' => true, 'id' => (int)$id, 'alreadyDone' => true]);
        }
        if ($open = $myOpen()) {
            if ($uuid !== '') $db->prepare('UPDATE shifts SET client_uuid = COALESCE(client_uuid, ?) WHERE id = ?')->execute([$uuid, $open['id']]);
            $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
               ->execute(['SHIFT', 'Opened a shift offline at ' . substr($offAt, 0, 16) . " while shift #{$open['id']} was still open: the offline work goes into #{$open['id']}", $sess['full_name']]);
            jsonOut(['ok' => true, 'id' => (int)$open['id'], 'merged' => true]);
        }
    }
    if ($myOpen()) jsonOut(['ok' => false, 'error' => 'You already have an open shift. Close it first.'], 409);
    $float = round((float)($body['openingFloat'] ?? 0), 2);
    if ($float < 0) jsonOut(['ok' => false, 'error' => 'Opening cash cannot be negative'], 400);
    $device = mb_substr(trim($body['device'] ?? ''), 0, 120) ?: null;
    $db->prepare("INSERT INTO shifts (user_id, user_name, device, opening_float, opened_at, status, client_uuid) VALUES (?,?,?,?," . ($offAt ? '?' : 'NOW()') . ",'open',?)")
       ->execute(array_merge([(int)$sess['user_id'], $sess['full_name'], $device, $float], $offAt ? [$offAt] : [], [$uuid !== '' ? $uuid : null]));
    $newId = (int)$db->lastInsertId();
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['SHIFT', "Opened shift with RWF $float in the drawer" . ($offAt ? ' (offline, ' . substr($offAt, 0, 16) . ')' : ''), $sess['full_name']]);
    jsonOut(['ok' => true, 'id' => $newId]);
}

if ($action === 'close') {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $s = $myOpen();
    if ($offAt && !empty($body['shiftUuid'])) {   // the shift opened offline on the device
        $st = $db->prepare('SELECT * FROM shifts WHERE client_uuid = ? AND user_id = ? LIMIT 1');
        $st->execute([(string)$body['shiftUuid'], (int)$sess['user_id']]);
        $s = $st->fetch() ?: $s;
    }
    if ($s && $s['status'] === 'closed') jsonOut(['ok' => true, 'alreadyDone' => true, 'expected' => (float)$s['expected_cash'], 'counted' => (float)$s['counted_cash'], 'difference' => (float)$s['difference']]);
    if (!$s) jsonOut(['ok' => false, 'error' => 'You have no open shift'], 400);
    if (!isset($body['countedCash']) || $body['countedCash'] === '' || (float)$body['countedCash'] < 0) {
        jsonOut(['ok' => false, 'error' => 'Count the cash in the drawer and enter the amount'], 400);
    }
    $counted = round((float)$body['countedCash'], 2);
    $note = mb_substr(trim($body['note'] ?? ''), 0, 255);
    $cash = rpShiftCash($db, $s);
    $diff = round($counted - $cash['expected'], 2);
    if (abs($diff) >= 0.01 && $note === '' && $offAt) {
        // counted offline: the drawer was already closed, so the count is kept and explained
        $devExp = isset($body['expectedOffline']) ? round((float)$body['expectedOffline'], 2) : null;
        $note = 'Closed offline' . ($devExp !== null ? " — the device expected RWF $devExp" : '');
        $db->prepare('INSERT INTO notifications (message, type) VALUES (?,?)')
           ->execute(["{$sess['full_name']} closed shift #{$s['id']} offline: counted RWF $counted, the records expect RWF {$cash['expected']} (difference RWF $diff).", 'warning']);
    }
    if (abs($diff) >= 0.01 && $note === '') {
        jsonOut(['ok' => false, 'error' => 'The count differs from what is expected — add a note explaining it', 'expected' => $cash['expected'], 'difference' => $diff], 400);
    }
    $db->prepare("UPDATE shifts SET status = 'closed', closed_at = " . ($offAt ? '?' : 'NOW()') . ", expected_cash = ?, counted_cash = ?, difference = ?, close_note = ? WHERE id = ? AND status = 'open'")
       ->execute(array_merge($offAt ? [$offAt] : [], [$cash['expected'], $counted, $diff, $note ?: null, $s['id']]));
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['SHIFT', "Closed shift #{$s['id']}: expected RWF {$cash['expected']}, counted RWF $counted, difference RWF $diff" . ($note ? " — $note" : ''), $sess['full_name']]);
    jsonOut(['ok' => true, 'expected' => $cash['expected'], 'counted' => $counted, 'difference' => $diff]);
}

if ($action === 'list') {
    requirePerm('canViewReports');
    $P = rpPeriod($_GET['preset'] ?? 'this_week', $_GET['from'] ?? null, $_GET['to'] ?? null);
    jsonOut(['ok' => true, 'data' => rpShifts($db, $P)]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
