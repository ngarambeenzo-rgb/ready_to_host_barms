<?php
// ============================================================
//  api/discounts.php
//  Discounts the Owner sets up on chosen items. Staff never type
//  an amount: they can only apply these, and only if allowed
//  (managers: canGiveDiscounts, bartenders: settings switch).
//
//  GET  action=list                     — all rules (anyone signed in; Owner manages)
//  POST action=save    {id?, name, sourceType, sourceId, kind, value, active}   Owner
//  POST action=toggle  {id, active}                                              Owner
//  POST action=delete  {id}                                                       Owner
//  GET  action=policy                   — who may apply discounts
//  POST action=policy  {bartenderCanDiscount}                                     Owner
//  GET  action=options&orderId=         — rules that apply to this order, with amounts
// ============================================================
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/discount_lib.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();
$action = $_REQUEST['action'] ?? '';
$sess   = requireAuth();
$db     = getDB();
$body   = $_SERVER['REQUEST_METHOD'] === 'POST' ? (json_decode(file_get_contents('php://input'), true) ?: []) : [];

function dsAudit($db, $sess, $text) {
    try { $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')->execute(['DISCOUNT', $text, $sess['full_name']]); } catch (Exception $e) {}
}

if ($action === 'list') {
    $rows = $db->query("
        SELECT d.*, COALESCE(bi.name, km.name) AS item_name, COALESCE(bi.price, km.price) AS item_price
        FROM discount_rules d
        LEFT JOIN bar_items bi    ON d.source_type = 'bar'     AND bi.id = d.source_id
        LEFT JOIN kitchen_menu km ON d.source_type = 'kitchen' AND km.id = d.source_id
        ORDER BY d.active DESC, d.name")->fetchAll();
    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id']; $r['source_id'] = (int)$r['source_id']; $r['value'] = (float)$r['value'];
        $r['active'] = (int)$r['active']; $r['item_price'] = (float)$r['item_price'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows, 'canApply' => canApplyDiscounts($db, $sess), 'canFree' => $sess['role'] === 'Owner']);
}

if ($action === 'save') {
    requireRole(['Owner']);
    $id    = (int)($body['id'] ?? 0);
    $name  = mb_substr(trim($body['name'] ?? ''), 0, 80);
    $type  = ($body['sourceType'] ?? '') === 'kitchen' ? 'kitchen' : 'bar';
    $src   = (int)($body['sourceId'] ?? 0);
    $kind  = ($body['kind'] ?? '') === 'amount' ? 'amount' : 'percent';
    $value = round((float)($body['value'] ?? 0), 2);
    $active = !empty($body['active']) ? 1 : 0;
    if ($name === '' || !$src) jsonOut(['ok' => false, 'error' => 'Give the discount a name and choose the item'], 400);
    if ($value <= 0 || ($kind === 'percent' && $value > 100)) jsonOut(['ok' => false, 'error' => $kind === 'percent' ? 'Percent must be between 1 and 100' : 'Enter the amount off per unit'], 400);
    $chk = $db->prepare($type === 'bar' ? 'SELECT price FROM bar_items WHERE id = ?' : 'SELECT price FROM kitchen_menu WHERE id = ?');
    $chk->execute([$src]);
    $price = $chk->fetchColumn();
    if ($price === false) jsonOut(['ok' => false, 'error' => 'Item not found'], 404);
    if ($kind === 'amount' && $value >= (float)$price) jsonOut(['ok' => false, 'error' => 'The amount off must be less than the item price'], 400);
    if ($id) {
        $db->prepare('UPDATE discount_rules SET name=?, source_type=?, source_id=?, kind=?, value=?, active=? WHERE id=?')
           ->execute([$name, $type, $src, $kind, $value, $active, $id]);
    } else {
        $db->prepare('INSERT INTO discount_rules (name, source_type, source_id, kind, value, active, created_by) VALUES (?,?,?,?,?,?,?)')
           ->execute([$name, $type, $src, $kind, $value, $active, $sess['full_name']]);
        $id = (int)$db->lastInsertId();
    }
    dsAudit($db, $sess, "Discount \"$name\": " . ($kind === 'percent' ? "$value%" : "RWF $value per unit") . " ($type #$src)" . ($active ? '' : ' — off'));
    jsonOut(['ok' => true, 'id' => $id]);
}

if ($action === 'toggle') {
    requireRole(['Owner']);
    $id = (int)($body['id'] ?? 0);
    $on = !empty($body['active']) ? 1 : 0;
    $db->prepare('UPDATE discount_rules SET active = ? WHERE id = ?')->execute([$on, $id]);
    dsAudit($db, $sess, "Discount #$id " . ($on ? 'switched on' : 'switched off'));
    jsonOut(['ok' => true]);
}

if ($action === 'delete') {
    requireRole(['Owner']);
    $id = (int)($body['id'] ?? 0);
    $db->prepare('DELETE FROM discount_rules WHERE id = ?')->execute([$id]);
    dsAudit($db, $sess, "Discount #$id deleted");
    jsonOut(['ok' => true]);
}

if ($action === 'policy') {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        requireRole(['Owner']);
        $on = !empty($body['bartenderCanDiscount']) ? 1 : 0;
        $db->prepare('UPDATE settings SET bartender_can_discount = ?')->execute([$on]);
        dsAudit($db, $sess, 'Bartenders ' . ($on ? 'may' : 'may not') . ' apply discounts');
        jsonOut(['ok' => true]);
    }
    jsonOut(['ok' => true, 'bartenderCanDiscount' => bartenderCanDiscount($db), 'managersCan' => getMgrPermissions()['canGiveDiscounts'] ?? false]);
}

if ($action === 'options') {
    $orderId = (int)($_GET['orderId'] ?? 0);
    $opts = discountOptionsForOrder($db, $orderId);
    jsonOut(['ok' => true, 'data' => $opts, 'canApply' => canApplyDiscounts($db, $sess), 'canFree' => $sess['role'] === 'Owner']);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
