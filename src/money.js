export function dollarsToCents(value) { return Math.round(Number(value || 0) * 100); }
export function reconciliationDifference(plaidCents, actualCents) { return plaidCents - actualCents; }
