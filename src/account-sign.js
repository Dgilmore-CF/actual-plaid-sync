export function isDebtAccount(type, subtype) {
  return type === 'credit' || type === 'loan' || subtype === 'credit card';
}
export function normalizePlaidBalanceCents(type, subtype, value) {
  const cents = Math.round(Number(value || 0) * 100);
  return isDebtAccount(type, subtype) ? -Math.abs(cents) : cents;
}
export function balanceLabel(type, subtype) {
  return isDebtAccount(type, subtype) ? 'Amount owed' : 'Current balance';
}