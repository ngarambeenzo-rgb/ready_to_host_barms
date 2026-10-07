<?php
// ============================================================
//  api/cashbook.php — money that is neither a sale nor an expense
//  (owner withdrawals, capital, loans, repayments, transfers,
//  starting balances), and the equipment the business owns.
//  These change cash or what the business owns, never profit. Owner only.
//  GET  action=list          { from, to }
//  POST action=add           { type, amount, method, toMethod, note, date }
//  POST action=void          { id, reason }
//  GET  action=assets_list
//  POST action=asset_add     { name, category, value, date, fundedBy: owner|business, method, note }
//  POST action=asset_update  { id, name, category, value, note }       (value = what it is worth now)
//  POST action=asset_dispose { id, date, reason }                      (sold, broken, thrown away)
//  POST action=asset_void    { id, reason }                            (entered by mistake)
// ============================================================
require_once __DIR__ . '/../config/db.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();
$action = $_REQUEST['action'] ?? 'list';
$sess   = requireRole(['Owner']);
$db     = getDB();

const CASHBOOK_TYPES = [
    'owner_withdrawal' => 'Owner withdrawal', 'capital' => 'Capital put in', 'loan_in' => 'Loan received',
    'loan_repayment' => 'Loan repayment', 'transfer' => 'Transfer between accounts', 'other_in' => 'Other money in', 'other_out' => 'Other money out',
    'opening_balance' => 'Starting balance',
];
// written only through the equipment actions below
const CASHBOOK_SYSTEM_TYPES = ['asset_purchase' => 'Equipment bought'];
const ASSET_CATEGORIES = ['Equipment', 'Furniture', 'Electronics', 'Vehicle', 'Building / renovation', 'Other'];

function cbBody(): array { return json_decode(file_get_contents('php://input'), true) ?? []; }
function cbDate($d): string {
    $d = trim((string)$d);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) jsonOut(['ok' => false, 'error' => 'Enter a valid date'], 400);
    return $d;
}
function cbAudit(PDO $db, string $text, string $by): void {
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')->execute(['CASHBOOK', $text, $by]);
}

if ($action === 'list') {
    $from = $_GET['from'] ?? date('Y-m-01');
    $to   = $_GET['to'] ?? date('Y-m-d');
    $st = $db->prepare('SELECT * FROM cash_movements WHERE movement_date BETWEEN ? AND ? ORDER BY movement_date DESC, id DESC');
    $st->execute([$from, $to]);
    jsonOut(['ok' => true, 'data' => $st->fetchAll(), 'types' => CASHBOOK_TYPES + CASHBOOK_SYSTEM_TYPES]);
}

if ($action === 'add') {
    $body = cbBody();
    $type = $body['type'] ?? '';
    $amount = round((float)($body['amount'] ?? 0), 2);
    $date = cbDate($body['date'] ?? date('Y-m-d'));
    $note = mb_substr(trim($body['note'] ?? ''), 0, 255);
    if (!isset(CASHBOOK_TYPES[$type])) jsonOut(['ok' => false, 'error' => 'Choose what kind of money movement this is'], 400);
    if ($amount <= 0) jsonOut(['ok' => false, 'error' => 'Enter an amount'], 400);
    if ($note === '') jsonOut(['ok' => false, 'error' => 'Add a note (who, why)'], 400);
    $method = cleanMethod($body['method'] ?? 'Cash');
    if ($method === 'Mixed') jsonOut(['ok' => false, 'error' => 'Choose one account (Cash, MoMo, Card or Bank)'], 400);
    $toMethod = null;
    if ($type === 'transfer') {
        $toMethod = cleanMethod($body['toMethod'] ?? '', '');
        if ($toMethod === '' || $toMethod === $method || $toMethod === 'Mixed') jsonOut(['ok' => false, 'error' => 'Choose where the money was moved to'], 400);
    }
    if ($type === 'opening_balance') {
        $dup = $db->prepare("SELECT COUNT(*) FROM cash_movements WHERE type = 'opening_balance' AND method = ? AND voided = 0");
        $dup->execute([$method]);
        if ((int)$dup->fetchColumn()) jsonOut(['ok' => false, 'error' => "$method already has a starting balance. Void it first if it was wrong."], 400);
    }
    // a starting balance is not money moving during a shift, so it never touches the drawer
    $shiftId = $type === 'opening_balance' ? null : currentShiftId();
    $db->prepare('INSERT INTO cash_movements (type, amount, method, to_method, note, movement_date, shift_id, recorded_by) VALUES (?,?,?,?,?,?,?,?)')
       ->execute([$type, $amount, $method, $toMethod, $note, $date, $shiftId, $sess['full_name']]);
    $newId = (int)$db->lastInsertId();
    cbAudit($db, CASHBOOK_TYPES[$type] . ": RWF $amount via $method" . ($toMethod ? " to $toMethod" : '') . " — $note", $sess['full_name']);
    jsonOut(['ok' => true, 'id' => $newId]);
}

if ($action === 'void') {
    $body = cbBody();
    $id = (int)($body['id'] ?? 0);
    $reason = trim($body['reason'] ?? '');
    if (!$id || $reason === '') jsonOut(['ok' => false, 'error' => 'A reason is required'], 400);
    $t = $db->prepare('SELECT type FROM cash_movements WHERE id = ?');
    $t->execute([$id]);
    if ($t->fetchColumn() === 'asset_purchase') jsonOut(['ok' => false, 'error' => 'This money paid for equipment. Void the equipment instead (Cash Book → Equipment).'], 400);
    $db->prepare('UPDATE cash_movements SET voided = 1 WHERE id = ?')->execute([$id]);
    cbAudit($db, "Voided cash book entry #$id — $reason", $sess['full_name']);
    jsonOut(['ok' => true]);
}

// ── equipment and other things the business owns ─────────────
if ($action === 'assets_list') {
    $rows = $db->query('SELECT * FROM business_assets ORDER BY disposed_date IS NOT NULL, acquired_date DESC, id DESC')->fetchAll();
    jsonOut(['ok' => true, 'data' => $rows, 'categories' => ASSET_CATEGORIES]);
}

if ($action === 'asset_add') {
    $body = cbBody();
    $name = mb_substr(trim($body['name'] ?? ''), 0, 150);
    $category = in_array($body['category'] ?? '', ASSET_CATEGORIES, true) ? $body['category'] : 'Equipment';
    $value = round((float)($body['value'] ?? 0), 2);
    $date = cbDate($body['date'] ?? date('Y-m-d'));
    $fundedBy = ($body['fundedBy'] ?? '') === 'owner' ? 'owner' : 'business';
    $note = mb_substr(trim($body['note'] ?? ''), 0, 255);
    if ($name === '') jsonOut(['ok' => false, 'error' => 'Name the item (for example: Fridge — Samsung 400 L)'], 400);
    if ($value <= 0) jsonOut(['ok' => false, 'error' => 'Enter what it is worth'], 400);
    $method = null;
    if ($fundedBy === 'business') {
        $method = cleanMethod($body['method'] ?? 'Cash');
        if ($method === 'Mixed') jsonOut(['ok' => false, 'error' => 'Choose the account that paid (Cash, MoMo, Card or Bank)'], 400);
    }
    $db->beginTransaction();
    try {
        $cmId = null;
        if ($fundedBy === 'business') {
            // the money left an account: it is not an expense, it became equipment
            $db->prepare('INSERT INTO cash_movements (type, amount, method, note, movement_date, shift_id, recorded_by) VALUES (?,?,?,?,?,?,?)')
               ->execute(['asset_purchase', $value, $method, mb_substr("Bought: $name" . ($note ? " — $note" : ''), 0, 255), $date, currentShiftId(), $sess['full_name']]);
            $cmId = (int)$db->lastInsertId();
        }
        $db->prepare('INSERT INTO business_assets (name, category, value, acquired_date, funded_by, method, cash_movement_id, note, recorded_by) VALUES (?,?,?,?,?,?,?,?,?)')
           ->execute([$name, $category, $value, $date, $fundedBy, $method, $cmId, $note ?: null, $sess['full_name']]);
        $id = (int)$db->lastInsertId();
        cbAudit($db, "Equipment added: $name, RWF $value, " . ($fundedBy === 'owner' ? 'brought in by the owner' : "paid from $method"), $sess['full_name']);
        $db->commit();
    } catch (Exception $e) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Could not save the equipment'], 500); }
    jsonOut(['ok' => true, 'id' => $id]);
}

if (in_array($action, ['asset_update', 'asset_dispose', 'asset_void'], true)) {
    $body = cbBody();
    $id = (int)($body['id'] ?? 0);
    $st = $db->prepare('SELECT * FROM business_assets WHERE id = ?');
    $st->execute([$id]);
    $a = $st->fetch();
    if (!$a) jsonOut(['ok' => false, 'error' => 'Equipment not found'], 404);

    if ($action === 'asset_update') {
        $name = mb_substr(trim($body['name'] ?? $a['name']), 0, 150);
        $category = in_array($body['category'] ?? '', ASSET_CATEGORIES, true) ? $body['category'] : $a['category'];
        $value = round((float)($body['value'] ?? $a['value']), 2);
        $note = mb_substr(trim($body['note'] ?? (string)$a['note']), 0, 255);
        if ($name === '' || $value <= 0) jsonOut(['ok' => false, 'error' => 'Enter a name and what it is worth now'], 400);
        $db->prepare('UPDATE business_assets SET name = ?, category = ?, value = ?, note = ? WHERE id = ?')->execute([$name, $category, $value, $note ?: null, $id]);
        if ((float)$a['value'] != $value) cbAudit($db, "Equipment value changed: {$a['name']} from RWF {$a['value']} to RWF $value", $sess['full_name']);
        jsonOut(['ok' => true]);
    }
    $reason = mb_substr(trim($body['reason'] ?? ''), 0, 255);
    if ($reason === '') jsonOut(['ok' => false, 'error' => 'A reason is required'], 400);
    if ($action === 'asset_dispose') {
        if ($a['disposed_date']) jsonOut(['ok' => false, 'error' => 'Already removed'], 400);
        $date = cbDate($body['date'] ?? date('Y-m-d'));
        if ($date < $a['acquired_date']) jsonOut(['ok' => false, 'error' => 'It cannot leave before it arrived'], 400);
        $db->prepare('UPDATE business_assets SET disposed_date = ?, disposed_reason = ? WHERE id = ?')->execute([$date, $reason, $id]);
        cbAudit($db, "Equipment removed: {$a['name']} (RWF {$a['value']}) on $date — $reason", $sess['full_name']);
        jsonOut(['ok' => true]);
    }
    // asset_void: entered by mistake — remove it and give the money back to the account it came from
    $db->beginTransaction();
    try {
        if ($a['cash_movement_id']) $db->prepare('UPDATE cash_movements SET voided = 1 WHERE id = ?')->execute([(int)$a['cash_movement_id']]);
        $db->prepare('DELETE FROM business_assets WHERE id = ?')->execute([$id]);
        cbAudit($db, "Equipment entry voided: {$a['name']} (RWF {$a['value']}) — $reason", $sess['full_name']);
        $db->commit();
    } catch (Exception $e) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'Could not void'], 500); }
    jsonOut(['ok' => true]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
