<?php
// ============================================================
//  api/shifts.php — cash shifts
//  GET  action=current               my open shift + live expected cash
//  POST action=open  { openingFloat, device }
//  POST action=close { countedCash, note }
//  GET  action=list                  recent shifts (reports permission)
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
    jsonOut(['ok' => true, 'shift' => $s ? [
        'id' => (int)$s['id'], 'openedAt' => $s['opened_at'], 'openingFloat' => (float)$s['opening_float'],
        'device' => $s['device'], 'cash' => rpShiftCash($db, $s),
    ] : null]);
}

if ($action === 'open') {
    if ($myOpen()) jsonOut(['ok' => false, 'error' => 'You already have an open shift. Close it first.'], 409);
    $body  = json_decode(file_get_contents('php://input'), true) ?? [];
    $float = round((float)($body['openingFloat'] ?? 0), 2);
    if ($float < 0) jsonOut(['ok' => false, 'error' => 'Opening cash cannot be negative'], 400);
    $device = mb_substr(trim($body['device'] ?? ''), 0, 120) ?: null;
    $db->prepare("INSERT INTO shifts (user_id, user_name, device, opening_float, opened_at, status) VALUES (?,?,?,?,NOW(),'open')")
       ->execute([(int)$sess['user_id'], $sess['full_name'], $device, $float]);
    $newId = (int)$db->lastInsertId();
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['SHIFT', "Opened shift with RWF $float in the drawer", $sess['full_name']]);
    jsonOut(['ok' => true, 'id' => $newId]);
}

if ($action === 'close') {
    $s = $myOpen();
    if (!$s) jsonOut(['ok' => false, 'error' => 'You have no open shift'], 400);
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    if (!isset($body['countedCash']) || $body['countedCash'] === '' || (float)$body['countedCash'] < 0) {
        jsonOut(['ok' => false, 'error' => 'Count the cash in the drawer and enter the amount'], 400);
    }
    $counted = round((float)$body['countedCash'], 2);
    $note = mb_substr(trim($body['note'] ?? ''), 0, 255);
    $cash = rpShiftCash($db, $s);
    $diff = round($counted - $cash['expected'], 2);
    if (abs($diff) >= 0.01 && $note === '') {
        jsonOut(['ok' => false, 'error' => 'The count differs from what is expected — add a note explaining it', 'expected' => $cash['expected'], 'difference' => $diff], 400);
    }
    $db->prepare("UPDATE shifts SET status = 'closed', closed_at = NOW(), expected_cash = ?, counted_cash = ?, difference = ?, close_note = ? WHERE id = ? AND status = 'open'")
       ->execute([$cash['expected'], $counted, $diff, $note ?: null, $s['id']]);
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
