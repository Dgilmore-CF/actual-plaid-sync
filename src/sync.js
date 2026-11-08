import { plaid } from './plaid.js';
import { db } from './db.js';
import { config } from './config.js';
import { decrypt } from './crypto.js';
import {
  importTransactions, syncActual, backupBudget, findByImportedId,
  updateTransaction, deleteTransaction, getTransactions,
} from './actual.js';
import { toActual, openingBalance, reconcile } from './transform.js';
import { refreshItemBalances } from './reconciliation.js';
import { removalAction } from './transaction-policy.js';
import { normalizePlaidBalanceCents } from './account-sign.js';
import { categorizeForImport } from './categories.js';
import { findPendingCandidates, selectPendingMatch } from './lifecycle-matching.js';
import { syncCoordinator } from './sync-coordinator.js';
import { ACTIVE_MAPPING_SQL, eligibleItemIds as selectEligibleItemIds, runEligibleItems } from './item-eligibility.js';
import { replacePendingActual, replaceTransactionMapping } from './lifecycle-actions.js';
import { fetchTransactionChanges } from './plaid-pagination.js';
import { importPlaidTransactionOnce } from './transaction-identity.js';

const ACTIVE_MAPPING = ACTIVE_MAPPING_SQL;

export function itemHasApprovedMapping(itemId) {
  return Boolean(db.prepare(`SELECT 1 FROM mappings WHERE item_id = ? AND ${ACTIVE_MAPPING} LIMIT 1`).get(itemId));
}

export function eligibleItemIds() {
  return selectEligibleItemIds(db);
}

function recordReviewResolution(reviewId, action, details) {
  db.prepare(`UPDATE review_queue SET resolved_at=CURRENT_TIMESTAMP,resolution=? WHERE id=? AND resolved_at IS NULL`).run(action, reviewId);
  db.prepare(`INSERT INTO review_resolutions(review_id,action,details) VALUES(?,?,?)`).run(reviewId, action, JSON.stringify(details));
}

function queueReview(itemId, txId, reason, payload, mapping = {}) {
  const existing = db.prepare(`
    SELECT id FROM review_queue
    WHERE plaid_transaction_id = ? AND reason = ? AND resolved_at IS NULL
  `).get(txId, reason);
  if (existing) {
    db.prepare('UPDATE review_queue SET payload=? WHERE id=?').run(JSON.stringify(payload), existing.id);
    return existing.id;
  }
  const result = db.prepare(`
    INSERT INTO review_queue(
      item_id,plaid_transaction_id,actual_transaction_id,actual_account_id,
      reason,payload,environment,source_item_status
    ) VALUES(?,?,?,?,?,?,?,'active')
  `).run(itemId, txId, mapping.actual_transaction_id || null,
    mapping.actual_account_id || null, reason, JSON.stringify(payload), config.plaidEnv);
  return Number(result.lastInsertRowid);
}

async function mapImported(tx, mapping) {
  const actual = await findByImportedId(mapping.actual_account_id, `plaid:${tx.transaction_id}`);
  db.prepare(`
    INSERT INTO tx_map(plaid_transaction_id,plaid_account_id,actual_account_id,actual_transaction_id,pending,user_review,updated_at)
    VALUES(?,?,?,?,?,0,CURRENT_TIMESTAMP)
    ON CONFLICT(plaid_transaction_id) DO UPDATE SET
      actual_transaction_id=excluded.actual_transaction_id,
      pending=excluded.pending,updated_at=CURRENT_TIMESTAMP
  `).run(tx.transaction_id, tx.account_id, mapping.actual_account_id, actual?.id || null, tx.pending ? 1 : 0);
}

async function importNew(tx, mapping) {
  await importPlaidTransactionOnce(mapping.actual_account_id, `plaid:${tx.transaction_id}`, findByImportedId,
    async () => importTransactions(mapping.actual_account_id, await categorizeForImport([tx])));
  await mapImported(tx, mapping);
}

async function backfillTransactionMap(mappings) {
  for (const mapping of mappings.values()) {
    const existing = db.prepare('SELECT COUNT(*) AS n FROM tx_map WHERE actual_account_id=?').get(mapping.actual_account_id).n;
    if (existing > 0) continue;
    const rows = await getTransactions(mapping.actual_account_id);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO tx_map(
        plaid_transaction_id,plaid_account_id,actual_account_id,actual_transaction_id,pending,user_review,updated_at
      ) VALUES(?,?,?,?,?,0,CURRENT_TIMESTAMP)
    `);
    for (const row of rows) {
      if (!row.imported_id?.startsWith('plaid:') || row.imported_id.startsWith('plaid:opening:')) continue;
      insert.run(row.imported_id.slice(6), mapping.plaid_account_id, mapping.actual_account_id, row.id, row.cleared ? 0 : 1);
    }
  }
}

function resolvePredecessorReviews(previousPlaidId, postedPlaidId, actualTransactionId, backup) {
  const reviews = db.prepare(`
    SELECT id FROM review_queue
    WHERE resolved_at IS NULL AND reason='pending_to_posted_unmatched'
      AND (plaid_transaction_id=? OR plaid_transaction_id=? OR actual_transaction_id=?)
  `).all(previousPlaidId, postedPlaidId, actualTransactionId);
  for (const review of reviews) {
    recordReviewResolution(review.id, 'pending_replaced', { backup, actualTransactionIdSuffix: String(actualTransactionId).slice(-6) });
  }
}

async function replacePendingInPlace(tx, mapping, actualTransaction, predecessorPlaidId) {
  const { backup } = await replacePendingActual({
    transaction: actualTransaction,
    posted: tx,
    createBackup: backupBudget,
    update: updateTransaction,
  });
  replaceTransactionMapping(db, predecessorPlaidId, tx, mapping.actual_account_id, actualTransaction.id,
    () => resolvePredecessorReviews(predecessorPlaidId, tx.transaction_id, actualTransaction.id, backup));
}

async function replacePending(tx, mapping, itemId) {
  const alreadyImported = await findByImportedId(mapping.actual_account_id, `plaid:${tx.transaction_id}`);
  const posted = {
    merchant: tx.merchant_name || tx.name || 'Unknown',
    date: tx.date,
    actualAmountCents: toActual(tx).amount,
  };
  const old = tx.pending_transaction_id
    ? db.prepare('SELECT * FROM tx_map WHERE plaid_transaction_id=?').get(tx.pending_transaction_id)
    : null;

  if (alreadyImported && old?.actual_transaction_id === alreadyImported.id) {
    replaceTransactionMapping(db, tx.pending_transaction_id, tx, mapping.actual_account_id, alreadyImported.id,
      () => resolvePredecessorReviews(tx.pending_transaction_id, tx.transaction_id, alreadyImported.id, null));
    return;
  }

  if (!alreadyImported && old?.actual_transaction_id) {
    const transaction = (await getTransactions(mapping.actual_account_id)).find(row => row.id === old.actual_transaction_id);
    if (transaction && !transaction.cleared) {
      await replacePendingInPlace(tx, mapping, transaction, tx.pending_transaction_id);
      return;
    }
  }

  const rows = await getTransactions(mapping.actual_account_id);
  const alreadyPosted = new Set(db.prepare(`
    SELECT actual_transaction_id FROM tx_map
    WHERE actual_account_id=? AND actual_transaction_id IS NOT NULL AND pending=0
  `).all(mapping.actual_account_id).map(row => row.actual_transaction_id));
  const candidates = findPendingCandidates(posted, rows.map(row => ({
    ...row,
    actual_account_id: mapping.actual_account_id,
    pending: !row.cleared,
    linkedToPosted: alreadyPosted.has(row.id),
  })), mapping.actual_account_id);
  const selected = selectPendingMatch(candidates);
  if (selected.automatic && !alreadyImported) {
    const predecessor = selected.candidate.imported_id.slice('plaid:'.length);
    await replacePendingInPlace(tx, mapping, selected.candidate, predecessor);
    return;
  }

  queueReview(itemId, tx.transaction_id, 'pending_to_posted_unmatched', {
    posted: tx,
    candidates: candidates.slice(0, 5).map(({ candidate, analysis }) => ({
      actualIdSuffix: String(candidate.id).slice(-6),
      importedIdSuffix: String(candidate.imported_id).slice(-6),
      payee: candidate.payee_name,
      date: candidate.date,
      amountCents: Number(candidate.amount),
      cleared: Boolean(candidate.cleared),
      category: candidate.category || null,
      ...analysis,
    })),
    topScore: selected.analysis?.score ?? 0,
    confidence: selected.analysis?.confidence || 'none',
    margin: selected.margin,
    postedAlreadyImported: alreadyImported ? {
      actualIdSuffix: String(alreadyImported.id).slice(-6),
      payee: alreadyImported.payee_name,
      date: alreadyImported.date,
      amountCents: Number(alreadyImported.amount),
      category: alreadyImported.category || null,
      cleared: Boolean(alreadyImported.cleared),
    } : null,
    reason: 'pending_to_posted_unmatched',
  }, old || { actual_account_id: mapping.actual_account_id });
}

async function applyModified(tx, mapping, itemId) {
  const row = db.prepare('SELECT * FROM tx_map WHERE plaid_transaction_id=?').get(tx.transaction_id);
  const actual = row?.actual_transaction_id
    ? (await getTransactions(mapping.actual_account_id)).find(transaction => transaction.id === row.actual_transaction_id)
    : await findByImportedId(mapping.actual_account_id, `plaid:${tx.transaction_id}`);
  if (!actual) {
    if (tx.pending_transaction_id) return replacePending(tx, mapping, itemId);
    await importNew(tx, mapping);
    return;
  }
  const transformed = toActual(tx);
  await updateTransaction(actual.id, {
    date: transformed.date,
    amount: transformed.amount,
    payee_name: transformed.payee_name,
    cleared: transformed.cleared,
    imported_id: transformed.imported_id,
  });
  db.prepare(`
    INSERT INTO tx_map(plaid_transaction_id,plaid_account_id,actual_account_id,actual_transaction_id,pending,user_review,updated_at)
    VALUES(?,?,?,?,?,0,CURRENT_TIMESTAMP)
    ON CONFLICT(plaid_transaction_id) DO UPDATE SET
      actual_transaction_id=excluded.actual_transaction_id,pending=excluded.pending,updated_at=CURRENT_TIMESTAMP
  `).run(tx.transaction_id, tx.account_id, mapping.actual_account_id, actual.id, tx.pending ? 1 : 0);
}

async function applyRemoved(removed, itemId, mapping) {
  if (!mapping) return;
  const row = db.prepare('SELECT * FROM tx_map WHERE plaid_transaction_id=?').get(removed.transaction_id);
  const action = removalAction(row);
  if (action === 'ignore') {
    const reason = removed.pending ? 'removed_pending' : 'posted_transaction_missing';
    queueReview(itemId, removed.transaction_id, reason, {
      plaidTransactionIdSuffix: String(removed.transaction_id).slice(-6),
      account: mapping?.actual_account_name || mapping?.plaid_name || 'Unknown account',
      payee: removed.merchant_name || removed.name || 'Unknown',
      date: removed.date || null,
      amountCents: Math.round(-Number(removed.amount || 0) * 100),
      pending: Boolean(removed.pending),
      cleared: !removed.pending,
      importedIdSuffix: String(removed.transaction_id).slice(-6),
      reason,
    }, mapping || {});
    return;
  }
  if (action === 'delete-pending') {
    const actualRows = await getTransactions(row.actual_account_id);
    const actual = actualRows.find(transaction => transaction.id === row.actual_transaction_id);
    const reviewId = queueReview(itemId, removed.transaction_id, 'removed_pending', {
      plaidTransactionIdSuffix: String(removed.transaction_id).slice(-6),
      actualTransactionIdSuffix: String(row.actual_transaction_id).slice(-6),
      account: mapping.actual_account_name || mapping.plaid_name,
      payee: actual?.payee_name || removed.merchant_name || removed.name || 'Unknown',
      date: actual?.date || removed.date || null,
      amountCents: Number(actual?.amount ?? Math.round(-Number(removed.amount || 0) * 100)),
      pending: true,
      cleared: Boolean(actual?.cleared),
      category: actual?.category || null,
      importedIdSuffix: String(actual?.imported_id || `plaid:${removed.transaction_id}`).slice(-6),
      reason: 'removed_pending',
    }, row);
    const backup = await backupBudget();
    await deleteTransaction(row.actual_transaction_id);
    db.prepare('DELETE FROM tx_map WHERE plaid_transaction_id=?').run(removed.transaction_id);
    db.exec('BEGIN IMMEDIATE');
    try {
      recordReviewResolution(reviewId, 'pending_removed', { backup });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return;
  }

  const actualRows = row?.actual_account_id ? await getTransactions(row.actual_account_id) : [];
  const actual = actualRows.find(transaction => transaction.id === row.actual_transaction_id);
  const payload = {
    plaidTransactionIdSuffix: String(removed.transaction_id).slice(-6),
    actualTransactionIdSuffix: row?.actual_transaction_id ? String(row.actual_transaction_id).slice(-6) : null,
    account: mapping?.actual_account_name || mapping?.plaid_name || 'Unknown account',
    payee: actual?.payee_name || removed.merchant_name || removed.name || 'Unknown',
    date: actual?.date || removed.date || null,
    amountCents: Number(actual?.amount ?? Math.round(-Number(removed.amount || 0) * 100)),
    pending: Boolean(removed.pending),
    cleared: Boolean(actual?.cleared ?? !removed.pending),
    category: actual?.category || null,
    importedIdSuffix: String(actual?.imported_id || `plaid:${removed.transaction_id}`).slice(-6),
    reason: 'removed_posted',
    posted: removed,
  };
  db.prepare('UPDATE tx_map SET user_review=1,updated_at=CURRENT_TIMESTAMP WHERE plaid_transaction_id=?').run(removed.transaction_id);
  queueReview(itemId, removed.transaction_id, 'removed_posted', payload, row || mapping || {});
}

export async function previewInitial(plaidAccountId) {
  const mapping = db.prepare('SELECT m.*,i.access_token_enc FROM mappings m JOIN items i ON i.item_id=m.item_id WHERE m.plaid_account_id=?').get(plaidAccountId);
  if (!mapping) throw new Error('Unknown Plaid account');
  const data = await pages({ access_token_enc: mapping.access_token_enc }, null, undefined, { fromBeginning: true });
  const transactions = [...data.added, ...data.modified].filter(tx => tx.account_id === plaidAccountId);
  const opening = openingBalance(mapping.current_balance, transactions, mapping.plaid_type, mapping.plaid_subtype);
  return {
    transactionCount: transactions.length,
    pendingCount: transactions.filter(tx => tx.pending).length,
    earliest: transactions.map(tx => tx.date).sort()[0] || null,
    latest: transactions.map(tx => tx.date).sort().at(-1) || null,
    currentBalanceCents: normalizePlaidBalanceCents(mapping.plaid_type, mapping.plaid_subtype, mapping.current_balance),
    openingBalanceCents: opening,
    reconciliationDifferenceCents: reconcile(mapping.current_balance, opening, transactions, mapping.plaid_type, mapping.plaid_subtype),
  };
}

export async function approveInitial(plaidAccountId) {
  const mapping = db.prepare('SELECT m.*,i.* FROM mappings m JOIN items i ON i.item_id=m.item_id WHERE m.plaid_account_id=?').get(plaidAccountId);
  if (!mapping?.actual_account_id || !mapping.enabled) throw new Error('Account mapping must be enabled');
  if (mapping.initial_import_complete) throw new Error('Initial import already completed');
  const data = await pages(mapping, null, undefined, { fromBeginning: true });
  const transactions = [...data.added, ...data.modified].filter(tx => tx.account_id === plaidAccountId);
  const opening = openingBalance(mapping.current_balance, transactions, mapping.plaid_type, mapping.plaid_subtype);
  if (reconcile(mapping.current_balance, opening, transactions, mapping.plaid_type, mapping.plaid_subtype) !== 0) {
    throw new Error('Initial reconciliation is non-zero');
  }
  const backup = await backupBudget();
  const openingTransaction = {
    date: transactions.map(tx => tx.date).sort()[0] || new Date().toISOString().slice(0, 10),
    amount: opening,
    payee_name: 'Starting Balance',
    notes: 'Calculated from Plaid current balance and imported history',
    imported_id: `plaid:opening:${plaidAccountId}`,
    cleared: true,
  };
  await importTransactions(mapping.actual_account_id, [openingTransaction, ...await categorizeForImport(transactions)]);
  await syncActual();
  for (const tx of transactions) await mapImported(tx, mapping);
  db.prepare('UPDATE mappings SET initial_import_complete=1 WHERE plaid_account_id=?').run(plaidAccountId);
  db.prepare('INSERT INTO imports(plaid_account_id,actual_account_id,backup_path,approved_at,opening_balance,transaction_count) VALUES(?,?,?,CURRENT_TIMESTAMP,?,?)')
    .run(plaidAccountId, mapping.actual_account_id, backup, opening, transactions.length);
  db.prepare('UPDATE items SET cursor=?,last_sync_at=CURRENT_TIMESTAMP,last_error=NULL WHERE item_id=?').run(data.cursor, mapping.item_id);
  const reconciliation = await refreshItemBalances(mapping.item_id);
  return { backup, openingBalanceCents: opening, transactionCount: transactions.length, reconciliation };
}

async function pages(item, cursorOverride, onPage, { fromBeginning = false } = {}) {
  return fetchTransactionChanges(
    async ({ cursor, count }) => (await plaid.transactionsSync({
      access_token: decrypt(item.access_token_enc), cursor, count,
    })).data,
    { cursor: cursorOverride ?? item.cursor, fromBeginning, onPage },
  );
}

function progress(runId, phase) {
  db.prepare('UPDATE sync_runs SET phase=?,last_progress_at=CURRENT_TIMESTAMP WHERE id=?').run(phase, runId);
}

async function performSync(itemId) {
  const item = db.prepare('SELECT * FROM items WHERE item_id=?').get(itemId);
  if (!item) return { itemId, status: 'unknown' };
  const mappings = new Map(db.prepare(`SELECT * FROM mappings WHERE item_id=? AND ${ACTIVE_MAPPING}`).all(itemId)
    .map(mapping => [mapping.plaid_account_id, mapping]));
  if (!mappings.size) return { itemId, status: 'excluded', message: 'Excluded from automatic synchronization' };

  const run = db.prepare(`INSERT INTO sync_runs(item_id,phase,last_progress_at) VALUES(?,'fetching',CURRENT_TIMESTAMP)`).run(itemId);
  const runId = Number(run.lastInsertRowid);
  try {
    const data = await pages(item, undefined, () => progress(runId, 'fetching'));
    await backfillTransactionMap(mappings);
    progress(runId, 'processing_added');
    for (const tx of data.added) {
      progress(runId, 'processing_added');
      const mapping = mappings.get(tx.account_id);
      if (!mapping) continue;
      if (tx.pending_transaction_id) await replacePending(tx, mapping, itemId);
      else await importNew(tx, mapping);
    }
    progress(runId, 'processing_modified');
    for (const tx of data.modified) {
      progress(runId, 'processing_modified');
      const mapping = mappings.get(tx.account_id);
      if (mapping) await applyModified(tx, mapping, itemId);
    }
    progress(runId, 'processing_removed');
    for (const tx of data.removed) {
      progress(runId, 'processing_removed');
      await applyRemoved(tx, itemId, mappings.get(tx.account_id));
    }
    progress(runId, 'syncing_actual');
    await syncActual();
    db.prepare('UPDATE items SET cursor=? WHERE item_id=?').run(data.cursor, itemId);
    progress(runId, 'reconciling');
    const reconciliation = await refreshItemBalances(itemId);
    const mismatches = reconciliation.filter(result => ![
      'Reconciled', 'Reconciled with pending activity', 'Timing difference',
    ].includes(result.explanationStatus));
    const itemError = mismatches.length ? `Reconciliation exception on ${mismatches.length} account(s)` : null;
    db.prepare('UPDATE items SET last_sync_at=CURRENT_TIMESTAMP,last_error=? WHERE item_id=?').run(itemError, itemId);
    for (const result of reconciliation) result.lastItemError = itemError;
    db.prepare(`UPDATE sync_runs SET finished_at=CURRENT_TIMESTAMP,last_progress_at=CURRENT_TIMESTAMP,phase='complete',
      added=?,modified=?,removed=?,reconciliation_mismatches=? WHERE id=?`)
      .run(data.added.length, data.modified.length, data.removed.length, mismatches.length, runId);
    return {
      itemId,
      status: 'complete',
      added: data.added.length,
      modified: data.modified.length,
      removed: data.removed.length,
      reconciliation,
      ok: mismatches.length === 0,
    };
  } catch (error) {
    const message = String(error?.message || error);
    db.prepare('UPDATE items SET last_error=? WHERE item_id=?').run(message, itemId);
    db.prepare(`UPDATE sync_runs SET finished_at=CURRENT_TIMESTAMP,last_progress_at=CURRENT_TIMESTAMP,phase='failed',error=? WHERE id=?`).run(message, runId);
    throw error;
  }
}

export async function syncItem(itemId, { source = 'manual' } = {}) {
  if (!itemHasApprovedMapping(itemId)) {
    return { itemId, status: 'excluded', message: 'Excluded from automatic synchronization' };
  }
  return syncCoordinator.request(itemId, () => performSync(itemId), { queueIfActive: source === 'webhook' });
}

export async function syncAll({ source = 'manual' } = {}) {
  return runEligibleItems(db, itemId => syncItem(itemId, { source }));
}

export async function waitForSyncs() {
  await syncCoordinator.drain();
}
