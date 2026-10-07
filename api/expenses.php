<?php
// ============================================================
//  api/expenses.php
//  GET  action=list
//  POST action=save   { desc, category, amount, date }
//  POST action=void   { id }  Owner only
// ============================================================
require_once __DIR__ . '/../config/db.php';

// Task 11: Validate CSRF token on all POST requests
if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();


$action = $_REQUEST['action'] ?? 'list';
$db     = getDB();

if ($action === 'list') {
    requireAuth();
    // the last 12 months (whole months); older expenses are in Reports
    $stmt = $db->query("SELECT * FROM expenses WHERE expense_date >= DATE_FORMAT(CURDATE() - INTERVAL 12 MONTH, '%Y-%m-01') ORDER BY id DESC");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']     = (int)$r['id'];
        $r['amount'] = (float)$r['amount'];
        $r['voided'] = (bool)$r['voided'];
        $r['desc']   = $r['description'];
        $r['date']   = $r['expense_date'];
        $r['by']     = $r['recorded_by'];
        $r['method'] = $r['payment_method'] ?: 'Not recorded';
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

if ($action === 'save') {
    requirePerm('canRecordExpenses');
    $sess = $_SESSION;
    $body = json_decode(file_get_contents('php://input'), true);

    $desc       = trim($body['desc'] ?? '');
    $category   = trim($body['category'] ?? 'General');
    $amount     = (float)($body['amount'] ?? 0);
    $date       = $body['date'] ?? date('Y-m-d');
    $clientUuid = trim($body['clientUuid'] ?? '');
    $method     = cleanMethod($body['paymentMethod'] ?? 'Cash');

    if (!$desc || $amount <= 0) jsonOut(['ok' => false, 'error' => 'Description and amount required'], 400);

    // Task 93: Idempotency — check if this clientUuid already exists
    if ($clientUuid) {
        $chk = $db->prepare('SELECT id FROM expenses WHERE client_uuid = ? LIMIT 1');
        $chk->execute([$clientUuid]);
        $existing = $chk->fetch();
        if ($existing) {
            jsonOut(['ok' => true, 'id' => (int)$existing['id'], 'duplicate' => true]);
        }
    }

    $db->prepare('INSERT INTO expenses (client_uuid, description, category, amount, payment_method, shift_id, expense_date, recorded_by) VALUES (?,?,?,?,?,?,?,?)')
       ->execute([$clientUuid ?: null, $desc, $category, $amount, $method, currentShiftId(), $date, $sess['full_name']]);
    $id = (int)$db->lastInsertId();

    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['EXPENSE', "Recorded expense: $desc — RWF $amount ($category)", $sess['full_name']]);

    jsonOut(['ok' => true, 'id' => $id]);
}

if ($action === 'void') {
    requirePerm('canVoidExpenses');
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    if (!$id) jsonOut(['ok' => false, 'error' => 'Invalid id'], 400);
    $db->prepare('UPDATE expenses SET voided = 1 WHERE id = ?')->execute([$id]);
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['VOID', "Voided expense #$id", $_SESSION['full_name']]);
    jsonOut(['ok' => true]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
