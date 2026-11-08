import { plaid } from './plaid.js';
import { db } from './db.js';
import { decrypt } from './crypto.js';
import { getAccountBalance, getTransactions } from './actual.js';
import { dollarsToCents, reconciliationDifference } from './money.js';
import { calculateActualBalanceModel, determineStatus, explainStatus } from './balance-model.js';
import { normalizePlaidBalanceCents } from './account-sign.js';
import { sanitizeDiagnostic } from './diagnostics.js';

const LIFECYCLE_REASONS = ['pending_to_posted_unmatched', 'removed_posted', 'posted_transaction_missing'];
const safeItemError = value => !value ? null
  : /^Reconciliation exception on \d+ account\(s\)$/.test(value) ? value
    : 'Item sync reported an error';

function lifecycleReviewCount(accountId) {
  const placeholders = LIFECYCLE_REASONS.map(() => '?').join(',');
  return db.prepare(`SELECT COUNT(*) AS count FROM review_queue
    WHERE actual_account_id=? AND reason IN (${placeholders}) AND resolved_at IS NULL AND archived_at IS NULL`)
    .get(accountId, ...LIFECYCLE_REASONS).count;
}

function recentCounts(itemId) {
  return db.prepare(`SELECT COALESCE(SUM(added),0) AS added,COALESCE(SUM(modified),0) AS modified,
    COALESCE(SUM(removed),0) AS removed FROM sync_runs
    WHERE item_id=? AND started_at>=datetime('now','-7 days')`).get(itemId);
}

function detailsFor(mapping, item, plaidAccount, transactions, actualApiBalanceCents) {
  const model = calculateActualBalanceModel(transactions, actualApiBalanceCents);
  const plaidCurrentBalanceCents = normalizePlaidBalanceCents(mapping.plaid_type, mapping.plaid_subtype, plaidAccount.balances.current);
  const plaidAvailableBalanceCents = plaidAccount.balances.available == null
    ? null : dollarsToCents(plaidAccount.balances.available);
  const postedReconciliationDifferenceCents = reconciliationDifference(plaidCurrentBalanceCents, model.actualClearedBalanceCents);
  const remainingAfterPendingCents = plaidCurrentBalanceCents - model.actualProjectedBalanceCents;
  const currency = plaidAccount.balances.iso_currency_code || plaidAccount.balances.unofficial_currency_code || 'UNKNOWN';
  const internalStatus = determineStatus({
    postedDifferenceCents: postedReconciliationDifferenceCents,
    actualPendingBalanceCents: model.actualPendingBalanceCents,
    internalDifferenceCents: model.internalDifferenceCents,
    startingBalanceCount: model.startingBalanceCount,
    currency,
  });
  const history = db.prepare('SELECT transaction_count FROM imports WHERE plaid_account_id=? ORDER BY id DESC LIMIT 1').get(mapping.plaid_account_id);
  const historyReady = Boolean(mapping.initial_import_complete && history);
  const openLifecycleReviewCount = lifecycleReviewCount(mapping.actual_account_id);
  const counts = recentCounts(item.item_id);
  const explanationStatus = explainStatus({
    postedDifferenceCents: postedReconciliationDifferenceCents,
    remainingAfterPendingCents,
    actualPendingBalanceCents: model.actualPendingBalanceCents,
    internalDifferenceCents: model.internalDifferenceCents,
    startingBalanceCount: model.startingBalanceCount,
    duplicateImportedIdCount: model.duplicateImportedIdCount,
    openLifecycleReviewCount,
    historyReady,
  });
  const reconciliationError = internalStatus === 'error'
    ? 'Actual projected balance or Starting Balance invariant failed'
    : internalStatus === 'unsupported-currency' ? `Unsupported currency: ${currency}` : null;

  return {
    plaidAccountIdSuffix: String(mapping.plaid_account_id).slice(-6),
    account: mapping.actual_account_name || mapping.plaid_name,
    currency,
    plaidCurrentBalanceCents,
    plaidAvailableBalanceCents,
    actualClearedBalanceCents: model.actualClearedBalanceCents,
    actualPendingBalanceCents: model.actualPendingBalanceCents,
    actualProjectedBalanceCents: model.actualProjectedBalanceCents,
    actualApiBalanceCents: model.actualApiBalanceCents,
    postedReconciliationDifferenceCents,
    remainingAfterPendingCents,
    transactionCount: model.transactionCount,
    startingBalanceCount: model.startingBalanceCount,
    duplicateImportedIdCount: model.duplicateImportedIdCount,
    openLifecycleReviewCount,
    recentAddedCount: counts.added,
    recentModifiedCount: counts.modified,
    recentRemovedCount: counts.removed,
    historyReady,
    historyTransactionCount: history?.transaction_count ?? null,
    lastItemError: safeItemError(item.last_error),
    internalDifferenceCents: model.internalDifferenceCents,
    reconciliationStatus: internalStatus,
    explanationStatus,
    reconciliationError,
    checkedAt: new Date().toISOString(),
  };
}

export async function refreshItemBalances(itemId) {
  const item = db.prepare('SELECT access_token_enc,last_error FROM items WHERE item_id=?').get(itemId);
  if (!item) throw new Error('Unknown Plaid Item');
  const eligible = db.prepare(`SELECT 1 FROM mappings WHERE item_id=?
    AND enabled=1 AND initial_import_complete=1 AND actual_account_id IS NOT NULL LIMIT 1`).get(itemId);
  if (!eligible) return [];
  const response = await plaid.accountsBalanceGet({ access_token: decrypt(item.access_token_enc) });
  const results = [];
  for (const account of response.data.accounts) {
    const mapping = db.prepare('SELECT * FROM mappings WHERE plaid_account_id=?').get(account.account_id);
    if (!mapping || !mapping.enabled || !mapping.initial_import_complete || !mapping.actual_account_id) continue;
    const transactions = await getTransactions(mapping.actual_account_id);
    const actualApiBalanceCents = await getAccountBalance(mapping.actual_account_id);
    const result = detailsFor(mapping, item, account, transactions, actualApiBalanceCents);
    db.prepare(`UPDATE mappings SET current_balance=?,available_balance=?,actual_balance_cents=?,
      reconciliation_difference_cents=?,reconciliation_status=?,balance_checked_at=CURRENT_TIMESTAMP,
      plaid_current_balance_cents=?,plaid_available_balance_cents=?,actual_cleared_balance_cents=?,
      actual_pending_balance_cents=?,actual_projected_balance_cents=?,posted_reconciliation_difference_cents=?,
      reconciliation_checked_at=CURRENT_TIMESTAMP,reconciliation_error=?,reconciliation_explanation=? WHERE plaid_account_id=?`)
      .run(Number(account.balances.current || 0), account.balances.available == null ? null : Number(account.balances.available),
        result.actualProjectedBalanceCents, result.postedReconciliationDifferenceCents, result.reconciliationStatus,
        result.plaidCurrentBalanceCents, result.plaidAvailableBalanceCents, result.actualClearedBalanceCents,
        result.actualPendingBalanceCents, result.actualProjectedBalanceCents,
        result.postedReconciliationDifferenceCents, result.reconciliationError, result.explanationStatus, account.account_id);
    results.push(result);
  }
  return results;
}

export async function investigateAccount(plaidAccountId) {
  const mapping = db.prepare(`SELECT m.*,i.item_id,i.access_token_enc,i.last_error FROM mappings m
    JOIN items i ON i.item_id=m.item_id WHERE m.plaid_account_id=?`).get(plaidAccountId);
  if (!mapping?.actual_account_id) throw new Error('Account is not mapped to Actual');
  try {
    const plaidResponse = await plaid.accountsBalanceGet({ access_token: decrypt(mapping.access_token_enc) });
    const plaidAccount = plaidResponse.data.accounts.find(account => account.account_id === plaidAccountId);
    if (!plaidAccount) throw new Error('Plaid did not return the mapped account');
    const transactions = await getTransactions(mapping.actual_account_id);
    const actualApiBalanceCents = await getAccountBalance(mapping.actual_account_id);
    const details = detailsFor(mapping, mapping, plaidAccount, transactions, actualApiBalanceCents);
    return sanitizeDiagnostic({
      ...details,
      plaidAccountIdSuffix: String(plaidAccountId).slice(-6),
      actualAccountIdSuffix: String(mapping.actual_account_id).slice(-6),
    });
  } catch (error) {
    return sanitizeDiagnostic({
      account: mapping.actual_account_name || mapping.plaid_name,
      plaidAccountIdSuffix: String(plaidAccountId).slice(-6),
      actualAccountIdSuffix: String(mapping.actual_account_id).slice(-6),
      explanationStatus: 'External API unavailable',
      externalError: 'Plaid or Actual could not return the required account data',
      externalErrorCode: /^[A-Z0-9_]{1,80}$/.test(error?.response?.data?.error_code || '') ? error.response.data.error_code : null,
      lastItemError: safeItemError(mapping.last_error),
    });
  }
}
