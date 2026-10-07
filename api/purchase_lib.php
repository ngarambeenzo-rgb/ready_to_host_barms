<?php
// ============================================================
//  api/purchase_lib.php — shared rules for receiving stock
//  Used by every "receive stock" action so supplier payments
//  and crate/carton conversions work the same everywhere.
// ============================================================

/**
 * How much of a purchase was paid now. Defaults to the full amount.
 * Anything left unpaid becomes a debt to the supplier, so a supplier is required.
 * @return array [amountPaid, method]
 */
function purchasePayment(array $body, float $totalCost, string $supplier): array {
    $paid = array_key_exists('amountPaid', $body) && $body['amountPaid'] !== '' && $body['amountPaid'] !== null
        ? round((float)$body['amountPaid'], 2) : $totalCost;
    if ($paid < 0) jsonOut(['ok' => false, 'error' => 'Amount paid cannot be negative'], 400);
    if ($paid > $totalCost + 0.001) jsonOut(['ok' => false, 'error' => 'Amount paid cannot be more than the purchase total (RWF ' . number_format($totalCost) . ')'], 400);
    if ($paid < $totalCost - 0.001 && trim($supplier) === '') jsonOut(['ok' => false, 'error' => 'Enter the supplier — the unpaid part is recorded as money owed to them'], 400);
    return [$paid, cleanMethod($body['paymentMethod'] ?? 'Cash')];
}

/**
 * Crates/cartons: when stock arrives in packs, the quantity in single units
 * must equal packs × units per pack for that product.
 * @return array [packQty|null, packName|null, unitsPerPack|null]
 */
function purchasePacks(array $body, float $qtyUnits): array {
    $packQty = (float)($body['packQty'] ?? 0);
    $per     = (int)($body['unitsPerPack'] ?? 0);
    if ($packQty <= 0 || $per <= 0) return [null, null, null];
    if (abs($packQty * $per - $qtyUnits) > 0.001) jsonOut(['ok' => false, 'error' => "Quantity does not match $packQty packs × $per per pack"], 400);
    return [$packQty, mb_substr(trim($body['packName'] ?? 'pack') ?: 'pack', 0, 30), $per];
}
