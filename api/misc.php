<?php
// ============================================================
//  api/misc.php — Settings, Users, Void Requests,
//                 Audit Log, Customer Debts, Notifications,
//                 Manager Permissions, Dashboard stats
// ============================================================
require_once __DIR__ . '/../config/db.php';
// every write needs the security token (blocks requests forged by other websites)
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') requireCsrf();

$action = $_REQUEST['action'] ?? '';
$db     = getDB();

// ══════════════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════════════
if ($action === 'settings_get') {
    requireAuth();
    $stmt = $db->query('SELECT * FROM settings LIMIT 1');
    $row  = $stmt->fetch();
    jsonOut(['ok' => true, 'data' => [
        'barName'  => $row['bar_name'],
        'location' => $row['location'],
        'currency' => $row['currency'],
        'stockCountDays' => (int)($row['stock_count_days'] ?? 7),
    ]]);
}

if ($action === 'stock_count_interval_save') {
    $sess = requireRole(['Owner']);
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $days = (int)($body['days'] ?? 0);
    if ($days < 1 || $days > 90) jsonOut(['ok' => false, 'error' => 'Choose between 1 and 90 days'], 400);
    $db->prepare('UPDATE settings SET stock_count_days = ? WHERE id = 1')->execute([$days]);
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['SETTINGS', "Stock count due every $days day(s)", $sess['full_name']]);
    jsonOut(['ok' => true]);
}

if ($action === 'settings_save') {
    requirePerm('canEditSettings');
    $body    = json_decode(file_get_contents('php://input'), true);
    $barName = trim($body['barName'] ?? 'BarMS Pro');
    $location= trim($body['location'] ?? 'Kigali, Rwanda');
    $currency= trim($body['currency'] ?? 'RWF');
    $db->prepare('UPDATE settings SET bar_name=?, location=?, currency=? WHERE id=1')
       ->execute([$barName, $location, $currency]);
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['SETTINGS', 'Updated bar settings', $_SESSION['full_name']]);
    jsonOut(['ok' => true]);
}

// ══════════════════════════════════════════════════════════════
//  USERS (system login accounts)
// ══════════════════════════════════════════════════════════════
if ($action === 'users_list') {
    requirePerm('canManageUsers');
    $stmt = $db->query("SELECT id, full_name, username, role, active FROM users WHERE active=1 ORDER BY id ASC");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']       = (int)$r['id'];
        $r['active']   = (bool)$r['active'];
        $r['fullName'] = $r['full_name'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

if ($action === 'users_add') {
    $sess = requirePerm('canManageUsers');

    try {
        // Read JSON body
        $rawBody  = file_get_contents('php://input');
        $body     = json_decode($rawBody, true) ?? [];
        
        // Fallback to POST params if JSON empty
        if (empty($body)) {
            $body = $_POST;
        }
        
        $fullName = trim($body['fullName'] ?? $_POST['fullName'] ?? '');
        $username = strtolower(trim($body['username'] ?? $_POST['username'] ?? ''));
        $password = $body['password'] ?? $_POST['password'] ?? '';
        $role     = $body['role'] ?? $_POST['role'] ?? 'Bartender';

        if (!$fullName || !$username || !$password) {
            jsonOut(['ok' => false, 'error' => 'Fields empty. Body received: '.strlen($rawBody).' bytes. fullName='.($fullName?'yes':'no').', user='.($username?'yes':'no').', pass='.($password?'yes':'no')], 400);
        }
        $allowedRoles = $sess['role'] === 'Owner' ? ['Owner', 'Manager', 'Bartender', 'Kitchen'] : ['Bartender', 'Kitchen'];
        if (!in_array($role, $allowedRoles, true)) {
            jsonOut(['ok' => false, 'error' => 'You can only create these roles: ' . implode(', ', $allowedRoles)], 403);
        }

        $chk = $db->prepare('SELECT id FROM users WHERE username = ?');
        $chk->execute([$username]);
        if ($chk->fetch()) jsonOut(['ok' => false, 'error' => 'Username already exists'], 400);

        $db->prepare('INSERT INTO users (full_name, username, password, role, active) VALUES (?, ?, ?, ?, 1)')
           ->execute([$fullName, $username, password_hash($password, PASSWORD_BCRYPT), $role]);
        $newId = (int)$db->lastInsertId();

        try {
            $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?, ?, ?)')
               ->execute(['USER_ADD', "Added: $username ($role)", $_SESSION['full_name'] ?? 'system']);
        } catch (Exception $logErr) {}

        jsonOut(['ok' => true, 'id' => $newId]);
    } catch (Exception $e) {
        serverFail($e);
    }
}

if ($action === 'users_remove') {
    $sess = requirePerm('canManageUsers');
    try {
        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $id   = (int)($body['id'] ?? 0);
        if (!$id) jsonOut(['ok' => false, 'error' => 'Invalid user'], 400);
        if ($id === (int)$_SESSION['user_id']) jsonOut(['ok' => false, 'error' => "Cannot remove yourself"], 400);
        if ($sess['role'] !== 'Owner') {
            $target = $db->prepare('SELECT role FROM users WHERE id = ?');
            $target->execute([$id]);
            if (!in_array($target->fetchColumn(), ['Bartender', 'Kitchen'], true)) {
                jsonOut(['ok' => false, 'error' => 'Managers can only remove Bartender or Kitchen accounts'], 403);
            }
        }
        $db->prepare('UPDATE users SET active = 0 WHERE id = ?')->execute([$id]);
        try {
            $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?, ?, ?)')
               ->execute(['USER_REMOVE', "Removed user id: $id", $_SESSION['full_name'] ?? 'system']);
        } catch (Exception $logErr) { /* ignore */ }
        jsonOut(['ok' => true]);
    } catch (Exception $e) {
        serverFail($e);
    }
}

// ══════════════════════════════════════════════════════════════
//  VOID REQUESTS
// ══════════════════════════════════════════════════════════════
if ($action === 'void_requests_list') {
    $sess = requireRole(['Owner', 'Manager']);
    // every pending request, plus the decided ones of the last 90 days (older ones are in Reports and the audit log)
    $stmt = $db->query("SELECT * FROM void_requests WHERE status = 'Pending' OR created_at >= CURDATE() - INTERVAL 90 DAY ORDER BY id DESC");
    $rows = $stmt->fetchAll();
    if ($sess['role'] === 'Manager') {
        $refundsOk = hasPerm('canGiveRefunds');
        $voidsOk   = hasPerm('canApproveVoids');
        $rows = array_values(array_filter($rows, fn($r) => $r['type'] === 'refund' ? $refundsOk : $voidsOk));
    }
    foreach ($rows as &$r) {
        $r['id']     = (int)$r['id'];
        $r['ref_id'] = (int)$r['ref_id'];
        $r['amount'] = (float)$r['amount'];
        $r['refId']  = $r['ref_id'];
        $r['requestedBy'] = $r['requested_by'];
        $r['reviewedBy']  = $r['reviewed_by'];
        $r['createdAt']   = $r['created_at'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

if ($action === 'void_request_submit') {
    // Anyone can submit a request — only Owner can approve/apply it
    requireRole(['Manager', 'Bartender', 'Owner']);
    $sess = $_SESSION;
    $body = json_decode(file_get_contents('php://input'), true);
    $type   = $body['type']   ?? 'sale';
    $refId  = (int)($body['refId'] ?? 0);
    $label  = trim($body['label'] ?? '');
    $amount = (float)($body['amount'] ?? 0);
    $reason = trim($body['reason'] ?? '');
    if (!$refId || !$label) jsonOut(['ok' => false, 'error' => 'Invalid request'], 400);
    if ($reason === '') jsonOut(['ok' => false, 'error' => 'A reason is required'], 400);
    if ($type === 'order') {
        // Voiding cancels the whole order, so use its real number and total
        $oStmt = $db->prepare('SELECT order_number, total, voided FROM orders WHERE id = ? LIMIT 1');
        $oStmt->execute([$refId]);
        $o = $oStmt->fetch();
        if (!$o) jsonOut(['ok' => false, 'error' => 'Order not found'], 404);
        if ((int)$o['voided']) jsonOut(['ok' => false, 'error' => 'This order is already voided'], 409);
        $rf = $db->prepare('SELECT COUNT(*) FROM order_refunds WHERE order_id = ?');
        $rf->execute([$refId]);
        if ((int)$rf->fetchColumn() > 0) jsonOut(['ok' => false, 'error' => 'This order already has a refund, so it cannot also be voided'], 409);
        $label  = 'Order ' . $o['order_number'];
        $amount = (float)$o['total'];
    }
    $dup = $db->prepare("SELECT id FROM void_requests WHERE type = ? AND ref_id = ? AND status = 'Pending' LIMIT 1");
    $dup->execute([$type, $refId]);
    if ($dup->fetch()) jsonOut(['ok' => false, 'error' => 'A void request for this is already waiting for review'], 409);
    $db->prepare('INSERT INTO void_requests (type, ref_id, label, amount, reason, requested_by) VALUES (?,?,?,?,?,?)')
       ->execute([$type, $refId, $label, $amount, $reason, $sess['full_name']]);
    $newId = (int)$db->lastInsertId();
    try {
        $db->prepare('INSERT INTO notifications (message, type) VALUES (?,?)')
           ->execute([mb_substr("Void request from {$sess['full_name']}: {$label} (RWF " . number_format($amount) . ") — open Requests to approve or reject", 0, 255), 'warning']);
    } catch (Exception $e) {}
    jsonOut(['ok' => true, 'id' => $newId]);
}

if ($action === 'void_request_approve') {
    $sess = requireAuth();
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    if (!$id) jsonOut(['ok' => false, 'error' => 'Invalid id'], 400);

    $stmt = $db->prepare('SELECT * FROM void_requests WHERE id=? AND status="Pending"');
    $stmt->execute([$id]);
    $req = $stmt->fetch();
    if (!$req) jsonOut(['ok' => false, 'error' => 'Request not found or already processed'], 404);
    // Refund requests need the refund permission; everything else needs the void permission
    requirePerm($req['type'] === 'refund' ? 'canGiveRefunds' : 'canApproveVoids');
    if ($sess['role'] !== 'Owner' && $req['requested_by'] === $sess['full_name']) {
        jsonOut(['ok' => false, 'error' => 'You cannot approve your own request'], 403);
    }

    $db->beginTransaction();
    try {
        // claim the request: only one approval can move it out of Pending (two devices, a retry)
        $claim = $db->prepare("UPDATE void_requests SET status='Approved', reviewed_by=?, reviewed_at=NOW() WHERE id=? AND status='Pending'");
        $claim->execute([$sess['full_name'], $id]);
        if ($claim->rowCount() !== 1) { $db->rollBack(); jsonOut(['ok' => false, 'error' => 'This request was already processed'], 409); }

        // Apply the void / refund
        if ($req['type'] === 'refund') {
            require_once __DIR__ . '/refund_lib.php';
            $d = json_decode($req['details'] ?? '', true) ?: [];
            try {
                $plan = planRefund($db, (int)$req['ref_id'], $d['items'] ?? [], true);
            } catch (RuntimeException $e) {
                $db->rollBack();
                jsonOut(['ok' => false, 'error' => 'Cannot approve: ' . $e->getMessage()], 409);
            }
            performRefund($db, $plan, $req['reason'] . " (requested by {$req['requested_by']})", $d['method'] ?? 'Cash', $sess['full_name'], date('Y-m-d'));
        } elseif ($req['type'] === 'sale') {
            $sSt = $db->prepare('SELECT * FROM sales WHERE id=? AND voided=0');
            $sSt->execute([$req['ref_id']]);
            $sale = $sSt->fetch();
            if ($sale) {
                $db->prepare('UPDATE sales SET voided=1 WHERE id=?')->execute([$req['ref_id']]);
                $db->prepare('UPDATE products SET stock=stock+? WHERE id=?')->execute([$sale['qty'], $sale['product_id']]);
            }
        } elseif ($req['type'] === 'expense') {
            $db->prepare('UPDATE expenses SET voided=1 WHERE id=?')->execute([$req['ref_id']]);
        } elseif ($req['type'] === 'kitrev') {
            $db->prepare('DELETE FROM kitchen_revenue WHERE id=?')->execute([$req['ref_id']]);
        } elseif ($req['type'] === 'order') {
            // ── VOID AN ENTIRE ORDER (current order-based sales system) ──
            $oStmt = $db->prepare('SELECT * FROM orders WHERE id=? AND voided=0 FOR UPDATE');
            $oStmt->execute([$req['ref_id']]);
            $order = $oStmt->fetch();

            if ($order) {
                // A paid order is only voided when the Owner confirms the sale never really happened
                if ($order['status'] === 'paid') {
                    if ($sess['role'] !== 'Owner') {
                        $db->rollBack();
                        jsonOut(['ok' => false, 'error' => 'Only the Owner can approve voiding a paid order'], 403);
                    }
                    $rf = $db->prepare('SELECT COUNT(*) FROM order_refunds WHERE order_id = ?');
                    $rf->execute([$order['id']]);
                    if ((int)$rf->fetchColumn() > 0) {
                        $db->rollBack();
                        jsonOut(['ok' => false, 'error' => 'This order already has a refund, so it cannot also be voided'], 409);
                    }
                }
                // Mark the order itself as voided
                $db->prepare('UPDATE orders SET voided=1 WHERE id=?')->execute([$order['id']]);

                // Restore stock/ingredients for every item that was in this order
                $itStmt = $db->prepare('SELECT * FROM order_items WHERE order_id=?');
                $itStmt->execute([$order['id']]);
                foreach ($itStmt->fetchAll() as $oi) {
                    $sourceType = $oi['source_type'] ?? 'bar';
                    $sourceId   = (int)($oi['source_id'] ?? 0);
                    $qty        = (float)$oi['qty'];
                    if (!$sourceId) continue;

                    if ($sourceType === 'bar') {
                        $biStmt = $db->prepare('SELECT * FROM bar_items WHERE id=? LIMIT 1');
                        $biStmt->execute([$sourceId]);
                        $bi = $biStmt->fetch();
                        if ($bi) {
                            if ($bi['type'] === 'direct') {
                                $db->prepare('UPDATE bar_items SET stock = stock + ? WHERE id=?')->execute([$qty, $sourceId]);
                                $db->prepare('INSERT INTO bar_movements (item_name,item_id,qty_change,type,reason,unit,order_number,unit_cost,total_cost,done_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
                                   ->execute([$bi['name'], $sourceId, $qty, 'void', "Order {$order['order_number']} voided", 'pcs', $order['order_number'], $bi['cost_price'], round($qty * (float)$bi['cost_price'], 2), $sess['full_name']]);
                            } elseif ($bi['type'] === 'recipe' && $bi['recipe_id']) {
                                $riStmt = $db->prepare('SELECT bri.*, bing.name AS ing_name, bing.unit, bing.cost_per_unit FROM bar_recipe_ingredients bri JOIN bar_ingredients bing ON bing.id=bri.ingredient_id WHERE bri.recipe_id=?');
                                $riStmt->execute([$bi['recipe_id']]);
                                foreach ($riStmt->fetchAll() as $ri) {
                                    $totalQty = $ri['qty'] * $qty;
                                    $db->prepare('UPDATE bar_ingredients SET quantity = quantity + ? WHERE id=?')->execute([$totalQty, $ri['ingredient_id']]);
                                    $db->prepare('INSERT INTO bar_movements (item_name,ingredient_id,qty_change,type,reason,unit,order_number,unit_cost,total_cost,done_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
                                       ->execute([$ri['ing_name'], $ri['ingredient_id'], $totalQty, 'void', "Order {$order['order_number']} voided", $ri['unit'], $order['order_number'], $ri['cost_per_unit'], round($totalQty * (float)$ri['cost_per_unit'], 2), $sess['full_name']]);
                                }
                            }
                        }
                    } elseif ($sourceType === 'kitchen') {
                        $menuStmt = $db->prepare('SELECT recipe_id FROM kitchen_menu WHERE id=? LIMIT 1');
                        $menuStmt->execute([$sourceId]);
                        $menu = $menuStmt->fetch();
                        if ($menu && $menu['recipe_id']) {
                            $riStmt = $db->prepare('SELECT ri.*, ki.name AS ing_name, ki.unit, ki.cost_per_unit FROM recipe_ingredients ri JOIN kitchen_ingredients ki ON ki.id=ri.ingredient_id WHERE ri.recipe_id=?');
                            $riStmt->execute([$menu['recipe_id']]);
                            foreach ($riStmt->fetchAll() as $ri) {
                                $totalQty = $ri['qty'] * $qty;
                                $cost = round($totalQty * (float)$ri['cost_per_unit'], 2);
                                $db->prepare('UPDATE kitchen_ingredients SET quantity = quantity + ? WHERE id=?')->execute([$totalQty, $ri['ingredient_id']]);
                                $db->prepare('INSERT INTO kitchen_stock_movements (ingredient_id,qty,type,reason,amount,unit_cost,total_cost,done_by) VALUES (?,?,?,?,?,?,?,?)')
                                   ->execute([$ri['ingredient_id'], $totalQty, 'void_restore', "Order {$order['order_number']} voided", $cost, $ri['cost_per_unit'], $cost, $sess['full_name']]);
                            }
                        }
                    }
                }

                // Remove the revenue records so this order stops counting in sales/profit
                $db->prepare('DELETE FROM bar_sales WHERE order_id=?')->execute([$order['id']]);
                $db->prepare('DELETE FROM kitchen_sales WHERE order_id=?')->execute([$order['id']]);
                $db->prepare('DELETE FROM kitchen_revenue WHERE order_id=?')->execute([$order['id']]);

                // Cancel any kitchen ticket for this order that hasn't already been served
                $db->prepare("UPDATE kitchen_orders SET status='rejected', reject_reason='Order voided' WHERE order_id=? AND status NOT IN ('served')")
                   ->execute([$order['id']]);

                // Free the table if this was a dine-in order
                if ((int)$order['table_id'] > 0) {
                    $db->prepare('UPDATE tables SET status="free" WHERE id=?')->execute([$order['table_id']]);
                }
            }
        }

        $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
           ->execute(['VOID', "Approved void request #{$id}: {$req['label']}", $sess['full_name']]);

        $db->commit();
        jsonOut(['ok' => true]);
    } catch (Exception $e) {
        $db->rollBack();
        serverFail($e);
    }
}

if ($action === 'void_request_reject') {
    $sess = requireAuth();
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    $stmt = $db->prepare('SELECT type FROM void_requests WHERE id=? AND status="Pending"');
    $stmt->execute([$id]);
    $type = $stmt->fetchColumn();
    if ($type === false) jsonOut(['ok' => false, 'error' => 'Request not found or already processed'], 404);
    requirePerm($type === 'refund' ? 'canGiveRefunds' : 'canApproveVoids');
    $rj = $db->prepare("UPDATE void_requests SET status='Rejected', reviewed_by=?, reviewed_at=NOW() WHERE id=? AND status='Pending'");
    $rj->execute([$sess['full_name'], $id]);
    if ($rj->rowCount() !== 1) jsonOut(['ok' => false, 'error' => 'This request was already processed'], 409);
    jsonOut(['ok' => true]);
}

// ══════════════════════════════════════════════════════════════
//  AUDIT LOG
// ══════════════════════════════════════════════════════════════
if ($action === 'audit_list') {
    requirePerm('canViewAudit');
    $filter = $_GET['filter'] ?? '';
    $type   = $_GET['type']   ?? '';
    $sql    = 'SELECT * FROM audit_log';
    $params = [];
    if ($filter) {
        $sql .= ' WHERE (details LIKE ? OR done_by LIKE ? OR action_type LIKE ?)';
        $params = ["%$filter%", "%$filter%", "%$filter%"];
    } elseif ($type) {
        $sql .= ' WHERE action_type = ?';
        $params = [$type];
    }
    $sql .= ' ORDER BY id DESC LIMIT 500';
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']     = (int)$r['id'];
        $r['by']     = $r['done_by'];
        $r['type']   = $r['action_type'];
        $r['time']   = $r['done_at'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

if ($action === 'audit_add') {
    $sess = requireAuth();
    $body = json_decode(file_get_contents('php://input'), true);
    $type    = $body['type']    ?? 'ACTION';
    $details = $body['details'] ?? '';
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute([$type, $details, $sess['full_name']]);
    jsonOut(['ok' => true]);
}

// ══════════════════════════════════════════════════════════════
//  CUSTOMER DEBTS
// ══════════════════════════════════════════════════════════════
if ($action === 'cust_debts_list') {
    requireAuth();
    // every unpaid debt (however old), plus the debts paid in the last 90 days
    $stmt = $db->query("SELECT * FROM customer_debts WHERE status = 'Pending' OR paid_at >= CURDATE() - INTERVAL 90 DAY OR debt_date >= CURDATE() - INTERVAL 90 DAY ORDER BY id DESC");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']     = (int)$r['id'];
        $r['amount'] = (float)$r['amount'];
        $r['customerName'] = $r['customer_name'];
        $r['by']           = $r['recorded_by'];
        $r['date']         = $r['debt_date'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

if ($action === 'cust_debt_save') {
    requireAuth();
    $sess = $_SESSION;
    $body = json_decode(file_get_contents('php://input'), true);
    $name   = trim($body['customerName'] ?? '');
    $phone  = trim($body['phone'] ?? '');
    $amount = (float)($body['amount'] ?? 0);
    $note   = trim($body['note'] ?? '');
    $date   = $body['date'] ?? date('Y-m-d');
    if (!$name || $amount <= 0) jsonOut(['ok' => false, 'error' => 'Name and amount required'], 400);
    $db->prepare('INSERT INTO customer_debts (customer_name, phone, amount, note, debt_date, recorded_by) VALUES (?,?,?,?,?,?)')
       ->execute([$name, $phone, $amount, $note, $date, $sess['full_name']]);
    jsonOut(['ok' => true, 'id' => (int)$db->lastInsertId()]);
}

if ($action === 'cust_debt_paid') {
    requireAuth();
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    $method = cleanMethod($body['method'] ?? 'Cash');
    $db->prepare("UPDATE customer_debts SET status='Paid', paid_at=NOW(), paid_method=?, paid_by=?, shift_id=? WHERE id=? AND status='Pending'")
       ->execute([$method, $_SESSION['full_name'] ?? '', currentShiftId(), $id]);
    jsonOut(['ok' => true]);
}

if ($action === 'cust_debt_delete') {
    requirePerm('canDeleteRecords');
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    $db->prepare('DELETE FROM customer_debts WHERE id=?')->execute([$id]);
    jsonOut(['ok' => true]);
}

// ══════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ══════════════════════════════════════════════════════════════
if ($action === 'notif_list') {
    requireAuth();
    $stmt = $db->query('SELECT * FROM notifications ORDER BY id DESC LIMIT 50');
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']      = (int)$r['id'];
        $r['read']    = (bool)$r['is_read'];
        $r['text']    = $r['message'];
        $r['time']    = $r['created_at'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

if ($action === 'notif_mark_read') {
    requireAuth();
    $db->query('UPDATE notifications SET is_read=1');
    jsonOut(['ok' => true]);
}

if ($action === 'notif_add') {
    requireAuth();
    $body = json_decode(file_get_contents('php://input'), true);
    $msg  = trim($body['text'] ?? '');
    $type = $body['type'] ?? 'info';
    if ($msg) {
        try { $db->prepare('INSERT INTO notifications (message, type) VALUES (?,?)')->execute([$msg, $type]); } catch(Exception $e) {}
    }
    jsonOut(['ok' => true]);
}

// ══════════════════════════════════════════════════════════════
//  MANAGER PERMISSIONS
// ══════════════════════════════════════════════════════════════
if ($action === 'mgr_perms_get') {
    requireAuth();
    jsonOut(['ok' => true, 'data' => getMgrPermissions()]);
}

if ($action === 'mgr_perms_save') {
    $sess = requireRole(['Owner']);
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $current = getMgrPermissions();
    $sets = []; $vals = []; $changed = []; $saved = [];
    foreach (MGR_PERMISSIONS as $key => [$col, $default]) {
        $val = array_key_exists($key, $body) ? (bool)$body[$key] : $current[$key];
        $saved[$key] = $val;
        $sets[] = "$col = ?";
        $vals[] = (int)$val;
        if ($val !== $current[$key]) $changed[] = $key . '=' . ($val ? 'on' : 'off');
    }
    $db->prepare('UPDATE mgr_permissions SET ' . implode(', ', $sets) . ' WHERE id = 1')->execute($vals);
    if ($changed) {
        $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
           ->execute(['PERMISSIONS', 'Manager permissions: ' . implode(', ', $changed), $sess['full_name']]);
    }
    jsonOut(['ok' => true, 'data' => $saved]);
}

// ══════════════════════════════════════════════════════════════
//  DASHBOARD STATS (all-in-one for speed)
// ══════════════════════════════════════════════════════════════
if ($action === 'dashboard') {
    $sess = requireAuth();
   $today = (!empty($_GET['backdate'])) ? $_GET['backdate'] : date('Y-m-d');
$month = substr($today, 0, 7);

    // (no session cache: requests release the session early, and figures must be live after each sale)

    // Today's sales (original sales table)
    $stmt = $db->prepare("SELECT COALESCE(SUM(total),0) AS rev FROM sales WHERE sale_date=? AND voided=0");
    $stmt->execute([$today]);
    $todayRev = (float)$stmt->fetch()['rev'];

    // Today's transactions count
    $stmt = $db->prepare("SELECT COUNT(*) AS cnt FROM sales WHERE sale_date=? AND voided=0");
    $stmt->execute([$today]);
    $todayTx = (int)$stmt->fetch()['cnt'];

    // Month revenue (original sales table)
    $stmt = $db->prepare("SELECT COALESCE(SUM(total),0) AS rev FROM sales WHERE sale_date BETWEEN ? AND ? AND voided=0");
    $stmt->execute([$month . '-01', date('Y-m-t', strtotime($month . '-01'))]);
    $monthRev = (float)$stmt->fetch()['rev'];

    // Today expenses
    $stmt = $db->prepare("SELECT COALESCE(SUM(amount),0) AS exp FROM expenses WHERE expense_date=? AND voided=0");
    $stmt->execute([$today]);
    $todayExp = (float)$stmt->fetch()['exp'];

    // Low stock count + total products (original products table)
    // the old "products" list is retired: low stock and item counts come from the current lists below
    $lowStock = 0; $totalProducts = 0;

    // Pending void requests
    $pendingVoids = (int)$db->query("SELECT COUNT(*) AS cnt FROM void_requests WHERE status='Pending'")->fetch()['cnt'];

    // Kitchen revenue today (original kitchen_revenue table)
    $stmt = $db->prepare("SELECT COALESCE(SUM(amount),0) AS rev FROM kitchen_revenue WHERE revenue_date=?");
    $stmt->execute([$today]);
    $kitchenRevToday = (float)$stmt->fetch()['rev'];

    // Unread notifications
    try {
        $unreadNotifs = (int)$db->query("SELECT COUNT(*) AS cnt FROM notifications WHERE is_read=0")->fetch()['cnt'];
    } catch(Exception $e) {
        $unreadNotifs = 0;
    }

    // COGS today (legacy products table)
    $stmt = $db->prepare("SELECT COALESCE(SUM(p.cost_price * s.qty),0) AS cogs FROM sales s JOIN products p ON s.product_id=p.id WHERE s.sale_date=? AND s.voided=0");
    $stmt->execute([$today]);
    $cogsToday = (float)$stmt->fetch()['cogs'];

    // Kitchen expenses today
    $stmt = $db->prepare("SELECT COALESCE(SUM(amount),0) AS exp FROM kitchen_expenses WHERE expense_date=?");
    $stmt->execute([$today]);
    $kitchenExpToday = (float)$stmt->fetch()['exp'];

    // ── NEW SYSTEM: add bar_sales + kitchen_sales to totals (safe — returns 0 if tables missing) ──
    try {
        $s2 = $db->prepare("SELECT COALESCE(SUM(total),0) AS r, COUNT(*) AS c FROM bar_sales WHERE sale_date=?");
        $s2->execute([$today]); $r2 = $s2->fetch();
        $todayRev  += (float)$r2['r'];
        $todayTx   += (int)$r2['c'];

        $s3 = $db->prepare("SELECT COALESCE(SUM(total),0) AS r, COUNT(*) AS c FROM kitchen_sales WHERE sale_date=?");
        $s3->execute([$today]); $r3 = $s3->fetch();
        $todayRev      += (float)$r3['r'];
        $todayTx       += (int)$r3['c'];
        $kitchenRevToday += (float)$r3['r'];
        $kitchenSalesToday = (float)$r3['r'];

        $s4 = $db->prepare("SELECT COALESCE(SUM(total),0) AS r FROM bar_sales WHERE sale_date BETWEEN ? AND ?");
        $s4->execute([$month . '-01', date('Y-m-t', strtotime($month . '-01'))]); $monthRev += (float)$s4->fetch()['r'];

        $s5 = $db->prepare("SELECT COALESCE(SUM(total),0) AS r FROM kitchen_sales WHERE sale_date BETWEEN ? AND ?");
        $s5->execute([$month . '-01', date('Y-m-t', strtotime($month . '-01'))]); $monthRev += (float)$s5->fetch()['r'];

        $s6 = $db->prepare("SELECT COALESCE(SUM(cost),0) AS c FROM kitchen_deductions WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)");
        $s6->execute([$today, $today]); $kitchenCogsToday = (float)$s6->fetch()['c']; $cogsToday += $kitchenCogsToday;

        // Bar items now have a cost_price — count their COGS too
        $s7 = $db->prepare("SELECT COALESCE(SUM(COALESCE(bs.unit_cost, CASE WHEN bi.type = 'recipe' THEN COALESCE((SELECT SUM(bri.qty * bing.cost_per_unit) FROM bar_recipe_ingredients bri JOIN bar_ingredients bing ON bing.id = bri.ingredient_id WHERE bri.recipe_id = bi.recipe_id), 0) ELSE bi.cost_price END) * bs.qty),0) AS c FROM bar_sales bs JOIN bar_items bi ON bi.id = bs.product_id WHERE bs.sale_date=?");
        $s7->execute([$today]); $cogsToday += (float)$s7->fetch()['c'];

        $lowStock += (int)$db->query("SELECT COUNT(*) AS cnt FROM bar_items WHERE active=1 AND type='direct' AND stock <= min_stock")->fetch()['cnt'];
        $totalProducts += (int)$db->query('SELECT COUNT(*) AS cnt FROM bar_items WHERE active=1')->fetch()['cnt'];
    } catch(Exception $e) { /* new tables not yet created — use old data only */ }

    // Profit calculations — $todayRev/$cogsToday include kitchen sales/costs, so split them out
    $kitchenSalesToday = $kitchenSalesToday ?? 0.0;
    $kitchenCogsToday  = $kitchenCogsToday ?? 0.0;
    // Refunds given today: money handed back lowers revenue; restocked items lower cost of goods
    try {
        $rf = $db->prepare("SELECT COALESCE(SUM(ri.total),0) AS t,
                COALESCE(SUM(CASE WHEN ri.source_type = 'kitchen' THEN ri.total END),0) AS k,
                COALESCE(SUM(ri.restock_cost),0) AS rc
            FROM order_refunds r JOIN order_refund_items ri ON ri.refund_id = r.id WHERE r.refund_date = ?");
        $rf->execute([$today]);
        $rfRow = $rf->fetch();
        $todayRev          -= (float)$rfRow['t'];
        $kitchenRevToday   -= (float)$rfRow['k'];
        $kitchenSalesToday -= (float)$rfRow['k'];
        $cogsToday         -= (float)$rfRow['rc'];
    } catch (Exception $e) { /* refunds table not created yet */ }
    $barGrossProfit   = ($todayRev - $kitchenSalesToday) - ($cogsToday - $kitchenCogsToday);
    $barNetProfit     = $barGrossProfit - $todayExp;
    $kitchenNetProfit = $kitchenRevToday - $kitchenCogsToday - $kitchenExpToday;
    $totalNetProfit   = $barNetProfit + $kitchenNetProfit;
    $netCashFlow      = $totalNetProfit;

    // Recent sales (today, last 10) — include bar_sales + kitchen_sales safely
    $stmt = $db->prepare("SELECT * FROM sales WHERE sale_date=? AND voided=0 ORDER BY id DESC LIMIT 10");
    $stmt->execute([$today]);
    $recentSales = $stmt->fetchAll();
    try {
        $rs2 = $db->prepare("SELECT product_name, qty, unit_price, total, sold_by, sale_date, sale_time FROM bar_sales WHERE sale_date=? ORDER BY id DESC LIMIT 10");
        $rs2->execute([$today]);
        $recentSales = array_merge($recentSales, $rs2->fetchAll());
        $rs3 = $db->prepare("SELECT product_name, qty, unit_price, total, sold_by, sale_date, sale_time FROM kitchen_sales WHERE sale_date=? ORDER BY id DESC LIMIT 10");
        $rs3->execute([$today]);
        $recentSales = array_merge($recentSales, $rs3->fetchAll());
    } catch(Exception $e) { /* use old data only */ }

    foreach ($recentSales as &$r) {
        $r['total']       = (float)($r['total'] ?? 0);
        $r['qty']         = (int)($r['qty'] ?? 0);
        $r['productName'] = $r['product_name'] ?? '';
        $r['soldBy']      = $r['sold_by'] ?? '';
        $r['date']        = $r['sale_date'] ?? '';
        $r['time']        = substr($r['sale_time'] ?? '', 0, 5);
    }
    unset($r);
    // Sort by time desc, limit 10
    usort($recentSales, fn($a,$b) => strcmp($b['time'], $a['time']));
    $recentSales = array_slice($recentSales, 0, 10);

    // Monthly sales for chart
    // whole months: from 1 January of this year, or the 1st of the month 5 months back if that is earlier
    $chartFrom = min(date('Y-01-01'), date('Y-m-01', strtotime(date('Y-m-01') . ' -5 months')));
    $stmt = $db->prepare("SELECT DATE_FORMAT(sale_date,'%Y-%m') AS mo, SUM(total) AS rev FROM sales WHERE voided=0 AND sale_date >= ? GROUP BY mo ORDER BY mo ASC");
    $stmt->execute([$chartFrom]);
    $monthlySales = $stmt->fetchAll();
    try {
        $ms2 = $db->prepare("SELECT DATE_FORMAT(sale_date,'%Y-%m') AS mo, SUM(total) AS rev FROM bar_sales WHERE sale_date >= ? GROUP BY mo");
        $ms3 = $db->prepare("SELECT DATE_FORMAT(sale_date,'%Y-%m') AS mo, SUM(total) AS rev FROM kitchen_sales WHERE sale_date >= ? GROUP BY mo");
        $ms2->execute([$chartFrom]); $ms3->execute([$chartFrom]);
        $combined = array_merge($monthlySales, $ms2->fetchAll(), $ms3->fetchAll());
        $moMap = [];
        foreach ($combined as $row) { $moMap[$row['mo']] = ($moMap[$row['mo']] ?? 0) + (float)$row['rev']; }
        ksort($moMap);
        $monthlySales = array_map(fn($mo, $rev) => ['mo' => $mo, 'rev' => $rev], array_keys($moMap), array_values($moMap));
    } catch(Exception $e) { /* use old data only */ }

    $dashResponse = ['ok' => true, 'data' => [
        'todayRevenue'      => $todayRev,
        // all money taken today: sales (bar + kitchen) + manually recorded kitchen revenue
        'moneyInToday'      => $todayRev + ($kitchenRevToday - $kitchenSalesToday),
        'todayTx'           => $todayTx,
        'monthRevenue'      => $monthRev,
        'todayExpenses'     => $todayExp,
        'todayProfit'       => $totalNetProfit,
        'barGrossProfit'    => $barGrossProfit,
        'barNetProfit'      => $barNetProfit,
        'kitchenNetProfit'  => $kitchenNetProfit,
        'totalNetProfit'    => $totalNetProfit,
        'netCashFlow'       => $netCashFlow,
        'lowStockCount'     => $lowStock,
        'totalProducts'     => $totalProducts,
        'pendingVoids'      => $pendingVoids,
        'kitchenRevenue'    => $kitchenRevToday,
        'kitchenExpenses'   => $kitchenExpToday,
        'unreadNotifs'      => $unreadNotifs,
        'todayCogs'         => $cogsToday,
        'recentSales'       => $recentSales,
        'monthlySales'      => $monthlySales,
    ]];
    jsonOut($dashResponse);
}

// ══════════════════════════════════════════════════════════════
//  REPORTS (date-range aggregation)
// ══════════════════════════════════════════════════════════════
if ($action === 'report') {
    requirePerm('canViewReports');
    $type  = $_GET['type']  ?? 'daily';
    $date  = $_GET['date']  ?? date('Y-m-d');
    $month = $_GET['month'] ?? date('Y-m');
    $from  = $_GET['from']  ?? date('Y-m-01');
    $to    = $_GET['to']    ?? date('Y-m-d');

    // every report type is one period from–to (whole days), searched as a range so the date indexes are used
    $isDay = fn($d) => is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && checkdate((int)substr($d, 5, 2), (int)substr($d, 8, 2), (int)substr($d, 0, 4));
    if (!$isDay($date)) $date = date('Y-m-d');
    if (!preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $month)) $month = date('Y-m');
    if ($type === 'daily') {
        $from = $to = $date;
    } elseif ($type === 'monthly') {
        $from = $month . '-01';
        $to   = date('Y-m-t', strtotime($from));
    } elseif ($type === 'weekly') {
        $selectedDay = new DateTimeImmutable($date);
        $from = $selectedDay->modify('monday this week')->format('Y-m-d');
        $to = $selectedDay->modify('sunday this week')->format('Y-m-d');
    } else {
        if (!$isDay($from)) $from = date('Y-m-01');
        if (!$isDay($to))   $to   = date('Y-m-d');
        if ($to < $from) [$from, $to] = [$to, $from];
    }
    $sWhere = 'sale_date BETWEEN ? AND ?';
    $eWhere = 'expense_date BETWEEN ? AND ?';
    $sParam = $eParam = [$from, $to];
    $purchaseWhere = 'purchase_date BETWEEN ? AND ?';
    $purchaseParams = [$from, $to];

    // Original sales table
    $stmt = $db->prepare("SELECT * FROM sales WHERE $sWhere ORDER BY id DESC");
    $stmt->execute($sParam);
    $sales = $stmt->fetchAll();
    foreach ($sales as &$s) {
        $s['id'] = (int)$s['id']; $s['total'] = (float)$s['total'];
        $s['qty'] = (int)$s['qty']; $s['unit_price'] = (float)$s['unit_price'];
        $s['voided'] = (bool)$s['voided'];
        $s['productName'] = $s['product_name']; $s['soldBy'] = $s['sold_by'];
        $s['date'] = $s['sale_date']; $s['time'] = substr($s['sale_time'],0,5);
        $s['unitPrice'] = $s['unit_price']; $s['source'] = 'bar';
    }
    unset($s);

    // Add bar_sales + kitchen_sales safely
    try {
        $bs = $db->prepare("SELECT product_name, qty, unit_price, total, sold_by, sale_date, sale_time FROM bar_sales WHERE $sWhere ORDER BY id DESC");
        $bs->execute($sParam);
        foreach ($bs->fetchAll() as $s) {
            $sales[] = ['productName'=>$s['product_name'],'soldBy'=>$s['sold_by'],'qty'=>(int)$s['qty'],'unitPrice'=>(float)$s['unit_price'],'unit_price'=>(float)$s['unit_price'],'total'=>(float)$s['total'],'voided'=>false,'source'=>'bar','date'=>$s['sale_date'],'time'=>substr($s['sale_time'],0,5)];
        }
        $ksWhere = 'sale_date BETWEEN ? AND ?'; $ksParam = [$from, $to];
        $ks = $db->prepare("SELECT product_name, qty, unit_price, total, sold_by, sale_date, sale_time FROM kitchen_sales WHERE $ksWhere ORDER BY id DESC");
        $ks->execute($ksParam);
        foreach ($ks->fetchAll() as $s) {
            $sales[] = ['productName'=>$s['product_name'],'soldBy'=>$s['sold_by'],'qty'=>(int)$s['qty'],'unitPrice'=>(float)$s['unit_price'],'unit_price'=>(float)$s['unit_price'],'total'=>(float)$s['total'],'voided'=>false,'source'=>'kitchen','date'=>$s['sale_date'],'time'=>substr($s['sale_time'],0,5)];
        }
    } catch(Exception $e) { /* new tables not yet created */ }

    $stmt = $db->prepare("SELECT * FROM expenses WHERE $eWhere ORDER BY id DESC");
    $stmt->execute($eParam);
    $expenses = $stmt->fetchAll();
    foreach ($expenses as &$e) {
        $e['id'] = (int)$e['id']; $e['amount'] = (float)$e['amount'];
        $e['voided'] = (bool)$e['voided'];
        $e['desc'] = $e['description']; $e['date'] = $e['expense_date']; $e['by'] = $e['recorded_by'];
    }
    unset($e);

    $purchaseStmt = $db->prepare("SELECT * FROM inventory_purchases WHERE $purchaseWhere ORDER BY purchase_date DESC, id DESC");
    $purchaseStmt->execute($purchaseParams);
    $purchases = $purchaseStmt->fetchAll();
    foreach ($purchases as &$purchase) {
        $purchase['id'] = (int)$purchase['id'];
        $purchase['quantity'] = (float)$purchase['quantity'];
        $purchase['unit_cost'] = (float)$purchase['unit_cost'];
        $purchase['total_cost'] = (float)$purchase['total_cost'];
        $purchase['date'] = $purchase['purchase_date'];
    }
    unset($purchase);
    $totalPurchases = array_sum(array_column($purchases, 'total_cost'));

    // totalRev = ALL sales (bar + kitchen combined)
    $totalRev = array_sum(array_map(fn($s) => ($s['voided']??false) ? 0 : ($s['total']??0), $sales));
    $totalExp = array_sum(array_map(fn($e) => $e['voided'] ? 0 : $e['amount'], $expenses));

    // COGS for period (legacy products table)
    $stmt = $db->prepare("SELECT COALESCE(SUM(p.cost_price * s.qty),0) AS cogs FROM sales s JOIN products p ON s.product_id=p.id WHERE $sWhere AND s.voided=0");
    $stmt->execute($sParam);
    $totalCogs = (float)$stmt->fetch()['cogs'];
    try {
        $kdWhere = 'created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)'; $kdParam = [$from, $to];
        $kd = $db->prepare("SELECT COALESCE(SUM(cost),0) AS c FROM kitchen_deductions WHERE $kdWhere");
        $kd->execute($kdParam);
        $totalCogs += (float)$kd->fetch()['c'];
    } catch(Exception $e) {}
    try {
        // Bar items COGS for the period
        $bcWhere = 'bs.sale_date BETWEEN ? AND ?'; $bcParam = [$from, $to];
        $bc = $db->prepare("SELECT COALESCE(SUM(COALESCE(bs.unit_cost, CASE WHEN bi.type = 'recipe' THEN COALESCE((SELECT SUM(bri.qty * bing.cost_per_unit) FROM bar_recipe_ingredients bri JOIN bar_ingredients bing ON bing.id = bri.ingredient_id WHERE bri.recipe_id = bi.recipe_id), 0) ELSE bi.cost_price END) * bs.qty),0) AS c FROM bar_sales bs JOIN bar_items bi ON bi.id = bs.product_id WHERE $bcWhere");
        $bc->execute($bcParam);
        $totalCogs += (float)$bc->fetch()['c'];
    } catch(Exception $e) {}

    // Kitchen revenue = old kitchen_revenue + kitchen items already in $sales array
    $kWhere = 'revenue_date BETWEEN ? AND ?'; $kParam = [$from, $to];
    $stmt = $db->prepare("SELECT COALESCE(SUM(amount),0) AS rev FROM kitchen_revenue WHERE $kWhere");
    $stmt->execute($kParam);
    $kitRev = (float)$stmt->fetch()['rev'];
    // Add kitchen sales already fetched in $sales array (source='kitchen')
    foreach ($sales as $s) {
        if (($s['source'] ?? '') === 'kitchen' && !($s['voided'] ?? false)) {
            $kitRev += (float)($s['total'] ?? 0);
        }
    }

    // Kitchen expenses
    $keWhere = 'expense_date BETWEEN ? AND ?'; $keParam = [$from, $to];
    $stmt = $db->prepare("SELECT COALESCE(SUM(amount),0) AS exp FROM kitchen_expenses WHERE $keWhere");
    $stmt->execute($keParam);
    $kitExp = (float)$stmt->fetch()['exp'];

    // $totalRev and $totalCogs include kitchen sales/costs; split them so nothing is counted twice
    $kitchenSalesRev = 0.0;
    foreach ($sales as $s) {
        if (($s['source'] ?? '') === 'kitchen' && !($s['voided'] ?? false)) $kitchenSalesRev += (float)$s['total'];
    }
    $barRev      = $totalRev - $kitchenSalesRev;
    $kitchenCogs = 0.0;
    try {
        $kc = $db->prepare("SELECT COALESCE(SUM(cost),0) AS c FROM kitchen_deductions WHERE $kdWhere");
        $kc->execute($kdParam);
        $kitchenCogs = (float)$kc->fetch()['c'];
    } catch (Exception $e) {}
    $barCogs = $totalCogs - $kitchenCogs;

    // Refunds given in this period (by refund date) reduce revenue; restocked items reduce cost of goods
    $refunds = []; $barRefunds = 0.0; $kitchenRefunds = 0.0; $restockCost = 0.0;
    try {
        $rWhere = str_replace('purchase_date', 'r.refund_date', $purchaseWhere);
        $rStmt = $db->prepare("SELECT r.*,
                COALESCE(SUM(CASE WHEN ri.source_type = 'kitchen' THEN ri.total END),0) AS kitchen_part,
                COALESCE(SUM(ri.restock_cost),0) AS restock_cost,
                GROUP_CONCAT(CONCAT(ri.qty, 'x ', ri.product_name, IF(ri.restocked, ' (back in stock)', '')) SEPARATOR ', ') AS items_text
            FROM order_refunds r JOIN order_refund_items ri ON ri.refund_id = r.id
            WHERE $rWhere GROUP BY r.id ORDER BY r.refund_date DESC, r.id DESC");
        $rStmt->execute($purchaseParams);
        foreach ($rStmt->fetchAll() as $r) {
            $amt = (float)$r['amount']; $kp = (float)$r['kitchen_part'];
            $kitchenRefunds += $kp;
            $barRefunds     += $amt - $kp;
            $restockCost    += (float)$r['restock_cost'];
            $refunds[] = ['id' => (int)$r['id'], 'orderNumber' => $r['order_number'], 'amount' => $amt, 'reason' => $r['reason'],
                          'method' => $r['method'], 'date' => $r['refund_date'], 'by' => $r['refunded_by'], 'items' => $r['items_text']];
        }
    } catch (Exception $e) { /* refunds table not created yet */ }
    $barRev  -= $barRefunds;
    $kitRev  -= $kitchenRefunds;
    $barCogs -= $restockCost;

    $barGrossProfit   = $barRev - $barCogs;
    $barNetProfit     = $barGrossProfit - $totalExp;
    $kitchenNetProfit = $kitRev - $kitchenCogs - $kitExp;
    $totalNetProfit   = $barNetProfit + $kitchenNetProfit;

    // Current stock value (what stock on hand is worth now, at average purchase cost)
    $stockValue = ['barItems' => 0.0, 'barIngredients' => 0.0, 'kitchenIngredients' => 0.0, 'itemsWithoutCost' => 0];
    foreach ([
        'barItems'           => "SELECT COALESCE(SUM(GREATEST(stock,0) * cost_price),0) AS v, COALESCE(SUM(stock > 0 AND cost_price <= 0),0) AS nc FROM bar_items WHERE type = 'direct' AND active = 1",
        'barIngredients'     => "SELECT COALESCE(SUM(GREATEST(quantity,0) * cost_per_unit),0) AS v, COALESCE(SUM(quantity > 0 AND cost_per_unit <= 0),0) AS nc FROM bar_ingredients",
        'kitchenIngredients' => "SELECT COALESCE(SUM(GREATEST(quantity,0) * cost_per_unit),0) AS v, COALESCE(SUM(quantity > 0 AND cost_per_unit <= 0),0) AS nc FROM kitchen_ingredients",
    ] as $key => $sql) {
        try {
            $row = $db->query($sql)->fetch();
            $stockValue[$key] = round((float)$row['v'], 2);
            $stockValue['itemsWithoutCost'] += (int)$row['nc'];
        } catch (Exception $e) {}
    }
    $stockValue['total'] = round($stockValue['barItems'] + $stockValue['barIngredients'] + $stockValue['kitchenIngredients'], 2);

    // best sellers, staff and the number of sales, from every sale of the period (the screen gets only part of the log)
    $salesSummary = ['count' => 0, 'byProduct' => [], 'byStaff' => []];
    $kept = [];
    foreach ($sales as $s) {
        if ($s['voided'] ?? false) continue;
        $kept[] = $s;
        $salesSummary['count']++;
        $p = &$salesSummary['byProduct'][$s['productName']]; $p ??= ['qty' => 0, 'revenue' => 0]; $p['qty'] += $s['qty']; $p['revenue'] += $s['total']; unset($p);
        $w = &$salesSummary['byStaff'][$s['soldBy']]; $w ??= ['qty' => 0, 'revenue' => 0, 'transactions' => 0]; $w['qty'] += $s['qty']; $w['revenue'] += $s['total']; $w['transactions']++; unset($w);
    }
    $salesSummary['byProduct'] = (object)$salesSummary['byProduct'];
    $salesSummary['byStaff']   = (object)$salesSummary['byStaff'];
    $salesLimited = null;
    if (($_GET['full'] ?? '') !== '1' && count($kept) > 500) {
        usort($kept, fn($a, $b) => strcmp(($b['date'] ?? '') . ' ' . ($b['time'] ?? ''), ($a['date'] ?? '') . ' ' . ($a['time'] ?? '')));
        $salesLimited = ['shown' => 500, 'total' => count($kept)];
        $sales = array_slice($kept, 0, 500);   // the newest 500
    }

    jsonOut(['ok' => true, 'data' => [
        'from'              => $from,
        'to'                => $to,
        'stockValue'        => $stockValue,
        'sales'             => $sales,
        'salesSummary'      => $salesSummary,
        'salesLimited'      => $salesLimited,
        'expenses'          => $expenses,
        'purchases'         => $purchases,
        'totalPurchases'    => $totalPurchases,
        'totalRev'          => $totalRev,
        'totalExp'          => $totalExp,
        'totalCogs'         => $totalCogs,
        'refunds'           => $refunds,
        'totalRefunds'      => round($barRefunds + $kitchenRefunds, 2),
        'barRev'            => $barRev,
        'barCogs'           => $barCogs,
        'kitchenCogs'       => $kitchenCogs,
        'kitRev'            => $kitRev,
        'kitExp'            => $kitExp,
        'barGrossProfit'    => $barGrossProfit,
        'barNetProfit'      => $barNetProfit,
        'kitchenNetProfit'  => $kitchenNetProfit,
        'totalNetProfit'    => $totalNetProfit,
        'profit'            => $totalNetProfit,
    ]]);
}

// ── BAR INFO (used by tables.js) ─────────────────────────────
if ($action === 'bar_info') {
    requireAuth();
    $stmt = $db->query('SELECT bar_name FROM settings LIMIT 1');
    $row  = $stmt->fetch();
    jsonOut(['ok' => true, 'barName' => $row['bar_name'] ?? 'BarMS Pro']);
}

// ══════════════════════════════════════════════════════════════
//  BACKDATE MODE
if ($action === 'backdate_grant') {
    requireRole(['Owner']);
    $sess = $_SESSION;
    $body = json_decode(file_get_contents('php://input'), true);
    $userId = (int)($body['userId'] ?? 0);
    if (!$userId) jsonOut(['ok' => false, 'error' => 'Invalid user'], 400);
    $db->prepare('UPDATE users SET can_backdate = 1 WHERE id = ?')->execute([$userId]);
    $uStmt = $db->prepare('SELECT full_name FROM users WHERE id = ?');
    $uStmt->execute([$userId]);
    $u = $uStmt->fetch();
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['BACKDATE', "Granted backdate permission to {$u['full_name']}", $sess['full_name']]);
    jsonOut(['ok' => true]);
}

if ($action === 'backdate_revoke') {
    requireRole(['Owner']);
    $sess = $_SESSION;
    $body = json_decode(file_get_contents('php://input'), true);
    $userId = (int)($body['userId'] ?? 0);
    if (!$userId) jsonOut(['ok' => false, 'error' => 'Invalid user'], 400);
    $db->prepare('UPDATE users SET can_backdate = 0 WHERE id = ?')->execute([$userId]);
    $uStmt = $db->prepare('SELECT full_name FROM users WHERE id = ?');
    $uStmt->execute([$userId]);
    $u = $uStmt->fetch();
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['BACKDATE', "Revoked backdate permission from {$u['full_name']}", $sess['full_name']]);
    jsonOut(['ok' => true]);
}

if ($action === 'backdate_activate') {
    $sess = requireAuth();
    $body = json_decode(file_get_contents('php://input'), true);
    $targetDate = trim($body['date']   ?? '');
    $reason     = trim($body['reason'] ?? '');
    if (!$targetDate || !$reason) jsonOut(['ok' => false, 'error' => 'Date and reason are required'], 400);
    $d = DateTime::createFromFormat('Y-m-d', $targetDate);
    if (!$d || $d->format('Y-m-d') !== $targetDate) jsonOut(['ok' => false, 'error' => 'Invalid date format'], 400);
    if ($targetDate >= date('Y-m-d')) jsonOut(['ok' => false, 'error' => 'Backdate must be a past date'], 400);
    $pStmt = $db->prepare('SELECT can_backdate FROM users WHERE id = ?');
    $pStmt->execute([$sess['user_id']]);
    $user = $pStmt->fetch();
    if (!$user || (!$user['can_backdate'] && $sess['role'] !== 'Owner')) {
        jsonOut(['ok' => false, 'error' => 'You do not have backdate permission'], 403);
    }
    $_SESSION['backdate_active'] = true;
    $_SESSION['backdate_date']   = $targetDate;
    $_SESSION['backdate_reason'] = $reason;
    $db->prepare('INSERT INTO backdate_log (user_id, username, target_date, reason) VALUES (?,?,?,?)')
       ->execute([$sess['user_id'], $sess['full_name'], $targetDate, $reason]);
    $db->prepare('INSERT INTO notifications (message, type) VALUES (?,?)')
       ->execute(["{$sess['full_name']} activated backdate mode for $targetDate — Reason: $reason", 'warning']);
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['BACKDATE', "Activated backdate mode for $targetDate — Reason: $reason", $sess['full_name']]);
    jsonOut(['ok' => true, 'date' => $targetDate, 'reason' => $reason]);
}

if ($action === 'backdate_deactivate') {
    requireAuth();
    $_SESSION['backdate_active'] = false;
    $_SESSION['backdate_date']   = null;
    $_SESSION['backdate_reason'] = null;
    jsonOut(['ok' => true]);
}

if ($action === 'backdate_status') {
    requireAuth();
    $active = !empty($_SESSION['backdate_active']);
    jsonOut([
        'ok'     => true,
        'active' => $active,
        'date'   => $active ? $_SESSION['backdate_date']   : null,
        'reason' => $active ? $_SESSION['backdate_reason'] : null,
    ]);
}

if ($action === 'backdate_users_list') {
    requireRole(['Owner']);
    $stmt = $db->query("SELECT id, full_name, username, role, can_backdate FROM users WHERE active = 1 ORDER BY role, full_name");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']          = (int)$r['id'];
        $r['canBackdate'] = (bool)$r['can_backdate'];
        $r['fullName']    = $r['full_name'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

if ($action === 'backdate_log') {
    requireRole(['Owner']);
    $stmt = $db->query('SELECT * FROM backdate_log ORDER BY id DESC LIMIT 200');
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']          = (int)$r['id'];
        $r['userId']      = (int)$r['user_id'];
        $r['targetDate']  = $r['target_date'];
        $r['activatedAt'] = $r['activated_at'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
