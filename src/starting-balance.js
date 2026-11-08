import { db } from './db.js';
import { plaid } from './plaid.js';
import { decrypt } from './crypto.js';
import { backupBudget, getAccountBalance, getTransactions, plannedBackupPath, syncActual, updateTransaction } from './actual.js';
import { normalizePlaidBalanceCents } from './account-sign.js';
import { syncCoordinator } from './sync-coordinator.js';
import { startingBalanceGuards } from './starting-balance-guards.js';

const cents = value => Math.round(Number(value || 0));

async function calculatePreview(plaidAccountId, backupPath = plannedBackupPath()) {
  const mapping = db.prepare(`SELECT m.*,i.access_token_enc,i.last_error FROM mappings m
    JOIN items i ON i.item_id=m.item_id WHERE m.plaid_account_id=?`).get(plaidAccountId);
  if (!mapping?.actual_account_id || !mapping.enabled || !mapping.initial_import_complete) {
    throw new Error('Account must be mapped, enabled, and approved before Starting Balance recalculation');
  }
  const transactions = await getTransactions(mapping.actual_account_id);
  const actualBalance = cents(await getAccountBalance(mapping.actual_account_id));
  const plaidResponse = await plaid.accountsBalanceGet({ access_token: decrypt(mapping.access_token_enc) });
  const plaidAccount = plaidResponse.data.accounts.find(account => account.account_id === plaidAccountId);
  if (!plaidAccount) throw new Error('Plaid did not return the mapped account');

  const startingRows = transactions.filter(transaction => transaction.imported_id?.startsWith('plaid:opening:') || transaction.payee_name === 'Starting Balance');
  const importedCounts = new Map();
  for (const transaction of transactions) {
    if (transaction.imported_id?.startsWith('plaid:')) importedCounts.set(transaction.imported_id, (importedCounts.get(transaction.imported_id) || 0) + 1);
  }
  const duplicateImportedIdCount = [...importedCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const pendingCandidateCount = db.prepare(`SELECT COUNT(*) AS count FROM review_queue
    WHERE actual_account_id=? AND reason='pending_to_posted_unmatched' AND resolved_at IS NULL AND archived_at IS NULL`)
    .get(mapping.actual_account_id).count;
  const removedPostedCount = db.prepare(`SELECT COUNT(*) AS count FROM review_queue
    WHERE actual_account_id=? AND reason='removed_posted' AND resolved_at IS NULL AND archived_at IS NULL`)
    .get(mapping.actual_account_id).count;
  const history = db.prepare('SELECT transaction_count FROM imports WHERE plaid_account_id=? ORDER BY id DESC LIMIT 1').get(plaidAccountId);
  const historyReady = Boolean(mapping.initial_import_complete && history);
  const transactionSumCents = transactions.reduce((sum, transaction) => sum + cents(transaction.amount), 0);
  const currentStartingBalanceCents = startingRows.length === 1 ? cents(startingRows[0].amount) : null;
  const balanceBeforeCents = actualBalance;
  const plaidCurrentBalanceCents = normalizePlaidBalanceCents(mapping.plaid_type, mapping.plaid_subtype, plaidAccount.balances.current);
  const sumWithoutStartingBalance = startingRows.length === 1 ? transactionSumCents - currentStartingBalanceCents : null;
  const proposedStartingBalanceCents = sumWithoutStartingBalance == null ? null : plaidCurrentBalanceCents - sumWithoutStartingBalance;
  const adjustmentCents = proposedStartingBalanceCents == null ? null : proposedStartingBalanceCents - currentStartingBalanceCents;
  const guards = startingBalanceGuards({
    historyReady,
    startingBalanceCount: startingRows.length,
    duplicateImportedIdCount,
    pendingCandidateCount,
    removedPostedCount,
    transactionSumCents,
    actualBalanceCents: actualBalance,
    noSyncActive: syncCoordinator.activeItemIds().length === 0,
  });
  const allowed = Object.values(guards).every(Boolean);
  return {
    allowed,
    guards,
    account: mapping.actual_account_name || mapping.plaid_name,
    plaidAccountIdSuffix: String(plaidAccountId).slice(-6),
    actualAccountIdSuffix: String(mapping.actual_account_id).slice(-6),
    currentStartingBalanceCents,
    proposedStartingBalanceCents,
    adjustmentCents,
    balanceBeforeCents,
    balanceAfterCents: adjustmentCents == null ? null : balanceBeforeCents + adjustmentCents,
    actualSumCents: transactionSumCents,
    actualApiBalanceCents: actualBalance,
    plaidCurrentBalanceCents,
    transactionCount: transactions.length,
    duplicateImportedIdCount,
    pendingCandidateCount,
    removedPostedReviewCount: removedPostedCount,
    backupPath,
    startingBalanceTransactionSuffix: startingRows.length === 1 ? String(startingRows[0].id).slice(-6) : null,
  };
}

export function previewStartingBalance(plaidAccountId) {
  return calculatePreview(plaidAccountId);
}

export async function recalculateStartingBalance(plaidAccountId, confirmation, expected) {
  if (confirmation !== 'RECALCULATE STARTING BALANCE') throw new Error('Recalculation confirmation phrase does not match');
  return syncCoordinator.withNoSync(async () => {
    const preview = await calculatePreview(plaidAccountId, expected?.backupPath);
    if (!preview.allowed) throw new Error(`Starting Balance recalculation is blocked: ${Object.entries(preview.guards).filter(([, ok]) => !ok).map(([name]) => name).join(', ')}`);
    if (Number(expected?.adjustmentCents) !== preview.adjustmentCents || Number(expected?.proposedStartingBalanceCents) !== preview.proposedStartingBalanceCents) {
      throw new Error('Balances changed since preview; refresh the preview before continuing');
    }
    const mapping = db.prepare('SELECT actual_account_id FROM mappings WHERE plaid_account_id=?').get(plaidAccountId);
    const rows = await getTransactions(mapping.actual_account_id);
    const opening = rows.filter(transaction => transaction.imported_id?.startsWith('plaid:opening:') || transaction.payee_name === 'Starting Balance');
    if (opening.length !== 1 || String(opening[0].id).slice(-6) !== preview.startingBalanceTransactionSuffix) {
      throw new Error('Starting Balance changed since preview; refresh the preview before continuing');
    }
    const backup = await backupBudget(preview.backupPath);
    await updateTransaction(opening[0].id, { amount: preview.proposedStartingBalanceCents });
    await syncActual();
    db.prepare(`INSERT INTO starting_balance_adjustments(
      actual_account_id,current_cents,proposed_cents,adjustment_cents,balance_before_cents,balance_after_cents,backup_path
    ) VALUES(?,?,?,?,?,?,?)`).run(mapping.actual_account_id, preview.currentStartingBalanceCents,
      preview.proposedStartingBalanceCents, preview.adjustmentCents, preview.balanceBeforeCents,
      preview.balanceAfterCents, backup);
    return { ...preview, backupPath: backup, applied: true };
  });
}
