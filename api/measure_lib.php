<?php
// ============================================================
//  api/measure_lib.php — selling a bottle by the shot, glass or tot
//
//  bottle item  (bar_items.type = 'direct', measure_unit set)
//      stock        = sealed bottles on the shelf (the only ones that can be sold whole)
//      open_amount  = what is left in the bottle that is already open, in measure_unit
//      bottle_size  = what one sealed bottle holds, in measure_unit
//  portion item (bar_items.type = 'portion', parent_id = the bottle)
//      portion_size = how much one sale takes out of the bottle
//
//  A portion sale pours from the open bottle. When it cannot cover the sale,
//  a sealed bottle is opened automatically. With no sealed bottle left and not
//  enough in the open one, the portion cannot be sold.
// ============================================================

const MEASURE_UNITS = ['ml' => 'millilitres (ml)', 'cl' => 'centilitres (cl)', 'oz' => 'fluid ounces (oz)', 'g' => 'grams (g)'];

/** Net weight in grams → amount in the bottle's unit (liquids: grams ÷ density) */
function measureFromGrams(float $grams, string $unit, float $density): float {
    if ($unit === 'g') return $grams;
    $ml = $grams / ($density > 0 ? $density : 0.94);
    if ($unit === 'cl') return $ml / 10;
    if ($unit === 'oz') return $ml / 29.5735;
    return $ml;
}

function measureCostPerUnit(array $bottle): float {
    $size = (float)($bottle['bottle_size'] ?? 0);
    return $size > 0 ? (float)$bottle['cost_price'] / $size : 0.0;
}

/** Cost of one portion (what the drink poured costs us) */
function measurePortionCost(array $bottle, float $portionSize): float {
    return round(measureCostPerUnit($bottle) * $portionSize, 2);
}

/** How many portions can still be sold: open bottle + everything sealed */
function measurePortionsLeft(array $bottle, float $portionSize): int {
    if ($portionSize <= 0) return 0;
    $total = max(0.0, (float)$bottle['open_amount']) + max(0.0, (float)$bottle['stock']) * (float)$bottle['bottle_size'];
    return (int)floor($total / $portionSize + 1e-9);
}

function measureLoadBottle(PDO $db, int $id, bool $lock = false): ?array {
    $st = $db->prepare('SELECT * FROM bar_items WHERE id = ? LIMIT 1' . ($lock ? ' FOR UPDATE' : ''));
    $st->execute([$id]);
    $r = $st->fetch();
    return $r ?: null;
}

/**
 * Pour $amount out of the bottle, opening sealed bottles when the open one runs short.
 * Returns how many sealed bottles were opened.
 */
function measureTake(PDO $db, int $bottleId, float $amount, string $who, string $ref, ?string $at = null): int {
    $b = measureLoadBottle($db, $bottleId, true);
    if (!$b || $amount <= 0) return 0;
    $open = (float)$b['open_amount']; $stock = (float)$b['stock']; $size = (float)$b['bottle_size']; $opened = 0;
    while ($open + 1e-9 < $amount && $stock >= 1 && $size > 0) { $stock -= 1; $open += $size; $opened++; }
    $open -= $amount;
    $db->prepare('UPDATE bar_items SET stock = ?, open_amount = ? WHERE id = ?')->execute([$stock, $open, $bottleId]);
    if ($opened) {
        $cost = (float)$b['cost_price'];
        $cols = 'item_name, item_id, qty_change, type, reason, unit, unit_cost, total_cost, done_by' . ($at ? ', created_at' : '');
        $vals = [$b['name'], $bottleId, -$opened, 'open_bottle', "Opened for shots and glasses ($ref)", 'pcs', $cost, round($opened * $cost, 2), $who];
        if ($at) $vals[] = $at;
        $db->prepare("INSERT INTO bar_movements ($cols) VALUES (" . implode(',', array_fill(0, count($vals), '?')) . ')')->execute($vals);
    }
    return $opened;
}

/** Put a poured amount back (a voided order). A whole bottle's worth goes back to the sealed shelf. */
function measurePutBack(PDO $db, int $bottleId, float $amount, string $who, string $ref): void {
    $b = measureLoadBottle($db, $bottleId, true);
    if (!$b || $amount <= 0) return;
    $open = (float)$b['open_amount'] + $amount; $stock = (float)$b['stock']; $size = (float)$b['bottle_size'];
    $back = 0;
    while ($size > 0 && $open > $size + 1e-9) { $open -= $size; $stock += 1; $back++; }
    $db->prepare('UPDATE bar_items SET stock = ?, open_amount = ? WHERE id = ?')->execute([$stock, $open, $bottleId]);
    if ($back) {
        $cost = (float)$b['cost_price'];
        $db->prepare('INSERT INTO bar_movements (item_name, item_id, qty_change, type, reason, unit, unit_cost, total_cost, done_by) VALUES (?,?,?,?,?,?,?,?,?)')
           ->execute([$b['name'], $bottleId, $back, 'void_restore', "Back on the shelf ($ref)", 'pcs', $cost, round($back * $cost, 2), $who]);
    }
}

/** Keep each portion row's cost in step with the bottle's cost */
function measureSyncPortionCosts(PDO $db, int $bottleId): void {
    $b = measureLoadBottle($db, $bottleId);
    if (!$b || (float)$b['bottle_size'] <= 0) return;
    $st = $db->prepare("SELECT id, portion_size FROM bar_items WHERE parent_id = ? AND type = 'portion'");
    $st->execute([$bottleId]);
    foreach ($st->fetchAll() as $p) {
        $db->prepare('UPDATE bar_items SET cost_price = ? WHERE id = ?')->execute([measurePortionCost($b, (float)$p['portion_size']), $p['id']]);
    }
}

/**
 * Create, update and remove the shot/glass rows of a bottle from what the owner filled in.
 * $m = ['enabled'=>bool,'unit'=>'ml','bottleSize'=>750,'emptyWeight'=>?,'density'=>?,'portions'=>[['name','size','price'],…]]
 * Returns an error text, or null when saved.
 */
function measureSave(PDO $db, int $bottleId, ?array $m): ?string {
    $b = measureLoadBottle($db, $bottleId);
    if (!$b) return 'Item not found';
    $enabled = $m && !empty($m['enabled']) && $b['type'] === 'direct';

    $existing = $db->prepare("SELECT id FROM bar_items WHERE parent_id = ? AND type = 'portion'");
    $existing->execute([$bottleId]);
    $existingIds = array_map('intval', $existing->fetchAll(PDO::FETCH_COLUMN));

    if (!$enabled) {
        $db->prepare('UPDATE bar_items SET measure_unit = NULL, bottle_size = NULL, open_amount = 0, empty_weight = NULL, density = NULL WHERE id = ?')->execute([$bottleId]);
        foreach ($existingIds as $pid) measureRemovePortion($db, $pid);
        return null;
    }
    $unit = (string)($m['unit'] ?? 'ml');
    if (!isset(MEASURE_UNITS[$unit])) return 'Choose how the bottle is measured (ml, cl, oz or grams)';
    $size = (float)($m['bottleSize'] ?? 0);
    if ($size <= 0) return 'Enter how much one full bottle holds';
    $portions = is_array($m['portions'] ?? null) ? $m['portions'] : [];
    if (!$portions) return 'Add at least one shot or glass size, or switch "Sell by the shot or glass" off';
    $empty = isset($m['emptyWeight']) && $m['emptyWeight'] !== '' ? max(0.0, (float)$m['emptyWeight']) : null;
    $density = isset($m['density']) && $m['density'] !== '' ? (float)$m['density'] : null;
    if ($density !== null && ($density < 0.5 || $density > 1.5)) return 'Liquid weight per ml should be between 0.5 and 1.5 (spirits are about 0.94)';

    $keep = [];
    foreach ($portions as $p) {
        $label = mb_substr(trim((string)($p['name'] ?? '')), 0, 30);
        $psize = (float)($p['size'] ?? 0); $pprice = (float)($p['price'] ?? 0);
        if ($label === '' || $psize <= 0 || $pprice <= 0) return 'Each shot or glass needs a name, an amount and a price';
        if ($psize > $size) return "\"$label\" is bigger than the whole bottle";
        $full = mb_substr($b['name'] . ' – ' . $label, 0, 150);
        $cost = measurePortionCost(array_merge($b, ["bottle_size" => $size]), $psize);
        $pid = (int)($p['id'] ?? 0);
        if ($pid && in_array($pid, $existingIds, true)) {
            $db->prepare('UPDATE bar_items SET name=?, pack_name=?, price=?, cost_price=?, portion_size=?, measure_unit=?, active=?, product_type=? WHERE id=?')
               ->execute([$full, $label, $pprice, $cost, $psize, $unit, (int)$b['active'], $b['product_type'], $pid]);
            $keep[] = $pid;
        } else {
            $db->prepare("INSERT INTO bar_items (name, pack_name, price, cost_price, type, stock, min_stock, active, parent_id, portion_size, measure_unit, product_type) VALUES (?,?,?,?,'portion',0,0,?,?,?,?,?)")
               ->execute([$full, $label, $pprice, $cost, (int)$b['active'], $bottleId, $psize, $unit, $b['product_type']]);
            $keep[] = (int)$db->lastInsertId();
        }
    }
    foreach (array_diff($existingIds, $keep) as $pid) measureRemovePortion($db, (int)$pid);
    $db->prepare('UPDATE bar_items SET measure_unit=?, bottle_size=?, empty_weight=?, density=? WHERE id=?')->execute([$unit, $size, $empty, $density, $bottleId]);
    return null;
}

/** Remove a portion row; one that was already sold stays (switched off) so old sales keep their name */
function measureRemovePortion(PDO $db, int $pid): void {
    $sold = $db->prepare('SELECT COUNT(*) FROM bar_sales WHERE product_id = ?');
    $sold->execute([$pid]);
    if ((int)$sold->fetchColumn() > 0) $db->prepare('UPDATE bar_items SET active = 0 WHERE id = ?')->execute([$pid]);
    else $db->prepare('DELETE FROM bar_items WHERE id = ?')->execute([$pid]);
}
