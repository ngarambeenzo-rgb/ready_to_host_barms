<?php
// ============================================================
//  api/kitchen.php — Kitchen Revenue & Expenses
//  GET  action=revenue_list / expense_list
//  POST action=revenue_save  { amount, date, note }
//  POST action=revenue_delete { id }  Owner only
//  POST action=expense_save  { desc, category, amount, date }
//  POST action=expense_delete { id }
// ============================================================
require_once __DIR__ . '/../config/db.php';
if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();

$action = $_REQUEST['action'] ?? '';
$db     = getDB();

if ($action === 'revenue_list') {
    requireAuth();
    $stmt = $db->query('SELECT * FROM kitchen_revenue ORDER BY id DESC');
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']     = (int)$r['id'];
        $r['amount'] = (float)$r['amount'];
        $r['date']   = $r['revenue_date'];
        $r['by']     = $r['recorded_by'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

if ($action === 'expense_list') {
    requireAuth();
    // the last 12 months (whole months); older ones are in Reports
    $stmt = $db->query("SELECT * FROM kitchen_expenses WHERE expense_date >= DATE_FORMAT(CURDATE() - INTERVAL 12 MONTH, '%Y-%m-01') ORDER BY id DESC");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']     = (int)$r['id'];
        $r['amount'] = (float)$r['amount'];
        $r['desc']   = $r['description'];
        $r['date']   = $r['expense_date'];
        $r['by']     = $r['recorded_by'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

if ($action === 'revenue_save') {
    requireRole(['Owner', 'Manager']);
    $sess = $_SESSION;
    $body = json_decode(file_get_contents('php://input'), true);
    $amount = (float)($body['amount'] ?? 0);
    $note   = trim($body['note'] ?? 'Daily revenue');
    $date   = $body['date'] ?? date('Y-m-d');
    if ($amount <= 0) jsonOut(['ok' => false, 'error' => 'Enter amount'], 400);
    $db->prepare('INSERT INTO kitchen_revenue (amount, note, revenue_date, recorded_by) VALUES (?,?,?,?)')
       ->execute([$amount, $note, $date, $sess['full_name']]);
    jsonOut(['ok' => true, 'id' => (int)$db->lastInsertId()]);
}

if ($action === 'revenue_delete') {
    requirePerm('canDeleteRecords');
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    if (!$id) jsonOut(['ok' => false, 'error' => 'Invalid id'], 400);
    $db->prepare('DELETE FROM kitchen_revenue WHERE id = ?')->execute([$id]);
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['KITCHEN', "Deleted kitchen revenue #$id", $_SESSION['full_name']]);
    jsonOut(['ok' => true]);
}

if ($action === 'expense_save') {
    requirePerm('canRecordExpenses');
    $sess = $_SESSION;
    $body = json_decode(file_get_contents('php://input'), true);
    $desc     = trim($body['desc'] ?? '');
    $category = trim($body['category'] ?? 'General');
    $amount   = (float)($body['amount'] ?? 0);
    $date     = $body['date'] ?? date('Y-m-d');
    if (!$desc || $amount <= 0) jsonOut(['ok' => false, 'error' => 'Fill required fields'], 400);
    $db->prepare('INSERT INTO kitchen_expenses (description, category, amount, payment_method, shift_id, expense_date, recorded_by) VALUES (?,?,?,?,?,?,?)')
       ->execute([$desc, $category, $amount, cleanMethod($body['paymentMethod'] ?? 'Cash'), currentShiftId(), $date, $sess['full_name']]);
    jsonOut(['ok' => true, 'id' => (int)$db->lastInsertId()]);
}

if ($action === 'expense_delete') {
    requirePerm('canRecordExpenses');
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    if (!$id) jsonOut(['ok' => false, 'error' => 'Invalid id'], 400);
    $db->prepare('DELETE FROM kitchen_expenses WHERE id = ?')->execute([$id]);
    jsonOut(['ok' => true]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
