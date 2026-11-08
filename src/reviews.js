import { db } from './db.js';
import {
  backupBudget, deleteTransaction, findByImportedId, getTransactions,
  importTransactions, syncActual, updateTransaction,
} from './actual.js';
import { categorizeForImport } from './categories.js';
import { replacePendingActual, replaceTransactionMapping } from './lifecycle-actions.js';
import { archiveLegacyReviewsInDatabase, recordReviewResolution } from './review-classification.js';
import { extractPostedTransaction, findPendingCandidates, selectPendingMatch } from './lifecycle-matching.js';
import { toActual } from './transform.js';
import { importPlaidTransactionOnce } from './transaction-identity.js';

const VALID_ENVIRONMENTS = new Set(['production', 'sandbox', 'legacy_unknown']);
const VALID_ITEM_STATUSES = new Set(['active', 'excluded', 'removed', 'unknown']);

function parsePayload(payload) {
  try { return JSON.parse(payload || '{}'); } catch { return {}; }
}

function safePosted(tx, row, account) {
  if (!tx) return null;
  return {
    merchant: tx.merchant_name || tx.name || 'Unknown',
    date: tx.date || null,
    amountCents: Math.round(-Number(tx.amount || 0) * 100),
    plaidIdSuffix: String(tx.transaction_id || row.plaid_transaction_id || '').slice(-6),
    account: account || row.account_name || '',
    category: tx.personal_finance_category?.primary || null,
    pending: Boolean(tx.pending),
    cleared: !tx.pending,
  };
}

function publicPayload(row, accountName = row.account_name || '') {
  const payload = parsePayload(row.payload);
  const posted = extractPostedTransaction(payload);
  if (posted) {
    payload.posted = safePosted(posted, row, payload.account || accountName);
  }
  if (payload.transaction && typeof payload.transaction === 'object') {
    payload.transaction = safePosted(payload.transaction, row, payload.account || '');
  }
  for (const key of ['transaction_id', 'account_id', 'pending_transaction_id', 'access_token']) delete payload[key];
  if (Array.isArray(payload.candidates)) {
    payload.candidates = payload.candidates.map(candidate => ({
      actualIdSuffix: candidate.actualIdSuffix || null,
      importedIdSuffix: candidate.importedIdSuffix || null,
      payee: candidate.payee || null,
      date: candidate.date || null,
      amountCents: Number(candidate.amountCents || 0),
      cleared: Boolean(candidate.cleared),
      category: candidate.category || null,
      score: Number(candidate.score || 0),
      confidence: candidate.confidence || 'low',
      dateDifferenceDays: candidate.dateDifferenceDays ?? null,
      amountDifferenceCents: candidate.amountDifferenceCents ?? null,
      merchantSimilarity: candidate.merchantSimilarity || 'none',
    }));
  }
  return payload;
}

export function serializeReview(row) {
  const rawPayload = parsePayload(row.payload);
  const plaidAccountId = extractPostedTransaction(rawPayload)?.account_id || rawPayload.account_id;
  const mapped = !row.account_name && plaidAccountId
    ? db.prepare('SELECT actual_account_name,plaid_name FROM mappings WHERE plaid_account_id=?').get(plaidAccountId)
    : null;
  const accountName = row.account_name || mapped?.actual_account_name || mapped?.plaid_name || '';
  return {
    id: row.id,
    reason: row.reason,
    payload: publicPayload(row, accountName),
    environment: row.environment || 'legacy_unknown',
    source_item_status: row.source_item_status || 'unknown',
    archived_at: row.archived_at,
    archive_reason: row.archive_reason,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
    resolution: row.resolution,
    account: accountName,
  };
}

const REVIEW_FILTERS = {
  'production-open': `environment='production' AND resolved_at IS NULL AND archived_at IS NULL`,
  'needs-match': `reason='pending_to_posted_unmatched' AND resolved_at IS NULL AND archived_at IS NULL`,
  'removed-posted': `reason='removed_posted' AND resolved_at IS NULL AND archived_at IS NULL`,
  'legacy-test': `(environment IS NULL OR environment<>'production')`,
  resolved: 'resolved_at IS NOT NULL',
  all: '1=1',
};

export function listReviews(filter = 'production-open') {
  const where = REVIEW_FILTERS[filter];
  if (!where) throw new Error('Invalid review filter');
  return db.prepare(`SELECT r.*,COALESCE(m.actual_account_name,m.plaid_name,'') AS account_name
    FROM review_queue r LEFT JOIN mappings m ON m.actual_account_id=r.actual_account_id
    WHERE ${where} ORDER BY r.id DESC LIMIT 500`).all().map(serializeReview);
}

export async function reviewDetails(id) {
  const row = db.prepare(`SELECT r.*,COALESCE(m.actual_account_name,m.plaid_name,'') AS account_name
    FROM review_queue r LEFT JOIN mappings m ON m.actual_account_id=r.actual_account_id WHERE r.id=?`).get(id);
  if (!row) return null;
  const payload = parsePayload(row.payload);
  const posted = extractPostedTransaction(payload);
  if (row.reason !== 'pending_to_posted_unmatched' || !posted) return serializeReview(row);
  const mapping = db.prepare('SELECT * FROM mappings WHERE plaid_account_id=?').get(posted.account_id);
  if (!mapping?.actual_account_id) return serializeReview(row);
  const transactions = await getTransactions(mapping.actual_account_id);
  const linked = new Set(db.prepare(`SELECT actual_transaction_id FROM tx_map
    WHERE actual_account_id=? AND pending=0 AND actual_transaction_id IS NOT NULL`).all(mapping.actual_account_id)
    .map(entry => entry.actual_transaction_id));
  const candidates = findPendingCandidates({
    merchant: posted.merchant_name || posted.name || 'Unknown',
    date: posted.date,
    actualAmountCents: toActual(posted).amount,
  }, transactions.map(transaction => ({
    ...transaction,
    actual_account_id: mapping.actual_account_id,
    pending: !transaction.cleared,
    linkedToPosted: linked.has(transaction.id),
  })), mapping.actual_account_id);
  const selected = selectPendingMatch(candidates);
  const alreadyImported = transactions.find(transaction => transaction.imported_id === `plaid:${posted.transaction_id}`);
  const accountName = mapping.actual_account_name || mapping.plaid_name;
  const review = serializeReview({
    ...row,
    actual_account_id: mapping.actual_account_id,
    account_name: accountName,
    payload: JSON.stringify({
      ...payload,
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
    }),
  });
  return review;
}

export function productionOpenReviewCount() {
  return db.prepare(`SELECT COUNT(*) AS count FROM review_queue
    WHERE environment='production' AND resolved_at IS NULL AND archived_at IS NULL`).get().count;
}

function writeAudit(reviewId, action, details) {
  recordReviewResolution(db, reviewId, action, details || {});
}

function closeReviewInTransaction(reviewId, action, details, actualAccountId = null) {
  const result = db.prepare(`UPDATE review_queue SET actual_account_id=COALESCE(actual_account_id,?),
    resolved_at=CURRENT_TIMESTAMP,resolution=? WHERE id=? AND resolved_at IS NULL`).run(actualAccountId, action, reviewId);
  if (!result.changes) throw new Error('Review item was already resolved');
  writeAudit(reviewId, action, details);
}

function closeReview(reviewId, action, details, actualAccountId = null) {
  db.exec('BEGIN IMMEDIATE');
  try {
    closeReviewInTransaction(reviewId, action, details, actualAccountId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function exactCandidate(rows, suffix) {
  if (!suffix) throw new Error('Choose the pending candidate to act on');
  const matches = rows.filter(row => String(row.id).endsWith(String(suffix)));
  if (matches.length !== 1) throw new Error('The pending candidate is missing or ambiguous; refresh the review');
  return matches[0];
}

function assertPostedPayload(payload) {
  const posted = payload.posted;
  if (!posted?.transaction_id || !posted?.account_id) throw new Error('Posted transaction details are unavailable');
  return posted;
}

function assertDeletionConfirmation(candidate, mapping, options) {
  if (options.confirmation !== 'DELETE STALE PENDING') throw new Error('Deletion confirmation phrase does not match');
  const expected = {
    account: mapping.actual_account_name || mapping.plaid_name,
    payee: candidate.payee_name || '',
    date: candidate.date || '',
    amountCents: Number(candidate.amount),
  };
  for (const key of Object.keys(expected)) {
    if (String(options.confirmedDetails?.[key] ?? '') !== String(expected[key])) {
      throw new Error('Deletion details changed; review the exact account, payee, date, and amount again');
    }
  }
  return expected;
}

async function importPosted(posted, accountId) {
  const { transaction: actual } = await importPlaidTransactionOnce(accountId, `plaid:${posted.transaction_id}`, findByImportedId,
    async () => importTransactions(accountId, await categorizeForImport([posted])));
  db.prepare(`
    INSERT INTO tx_map(plaid_transaction_id,plaid_account_id,actual_account_id,actual_transaction_id,pending,user_review,updated_at)
    VALUES(?,?,?,?,0,0,CURRENT_TIMESTAMP)
    ON CONFLICT(plaid_transaction_id) DO UPDATE SET actual_transaction_id=excluded.actual_transaction_id,
      pending=0,user_review=0,updated_at=CURRENT_TIMESTAMP
  `).run(posted.transaction_id, posted.account_id, accountId, actual.id);
  return actual;
}

async function resolveLifecycleReview(row, action, options, payload, mapping) {
  const posted = assertPostedPayload(payload);
  const actualRows = await getTransactions(mapping.actual_account_id);
  if (action === 'replace_pending') {
    const alreadyPosted = actualRows.find(transaction => transaction.imported_id === `plaid:${posted.transaction_id}`);
    if (alreadyPosted && options.candidateActualIdSuffix && String(alreadyPosted.id).endsWith(String(options.candidateActualIdSuffix))
      && alreadyPosted.cleared) {
      const predecessor = db.prepare(`SELECT plaid_transaction_id FROM tx_map
        WHERE actual_transaction_id=? AND pending=1 LIMIT 1`).get(alreadyPosted.id);
      replaceTransactionMapping(db, predecessor?.plaid_transaction_id || null, posted,
        mapping.actual_account_id, alreadyPosted.id,
         () => closeReviewInTransaction(row.id, action, { actualTransactionIdSuffix: String(alreadyPosted.id).slice(-6), action, recovered: true }, mapping.actual_account_id));
      await syncActual();
      return { id: row.id, action, recovered: true };
    }
  }
  const candidates = actualRows.filter(transaction =>
    payload.candidates?.some(candidate => candidate.actualIdSuffix === String(transaction.id).slice(-6)));

  if (action === 'replace_pending' || action === 'delete_stale_pending') {
    const candidate = exactCandidate(candidates, options.candidateActualIdSuffix);
    if (candidate.cleared || !candidate.imported_id?.startsWith('plaid:') || candidate.imported_id.startsWith('plaid:opening:')) {
      throw new Error('The selected transaction is no longer an eligible pending Plaid transaction');
    }
    const linked = db.prepare(`SELECT 1 FROM tx_map WHERE actual_transaction_id=? AND pending=0`).get(candidate.id);
    if (linked) throw new Error('The pending transaction is already linked to a posted replacement');

    if (action === 'replace_pending') {
      const alreadyPosted = await findByImportedId(mapping.actual_account_id, `plaid:${posted.transaction_id}`);
      let deletedPostedSuffix = null;
      if (alreadyPosted && alreadyPosted.id !== candidate.id) {
        if (options.confirmation !== 'REPLACE EXISTING POSTED') throw new Error('The posted transaction is already imported; explicit replacement confirmation is required');
        const expected = {
          account: mapping.actual_account_name || mapping.plaid_name,
          payee: alreadyPosted.payee_name || '',
          date: alreadyPosted.date || '',
          amountCents: Number(alreadyPosted.amount),
        };
        for (const key of Object.keys(expected)) {
          if (String(options.confirmedPostedDetails?.[key] ?? '') !== String(expected[key])) {
            throw new Error('Posted transaction details changed; refresh and confirm the exact transaction again');
          }
        }
        const backup = await backupBudget();
        await deleteTransaction(alreadyPosted.id);
        db.prepare('DELETE FROM tx_map WHERE actual_transaction_id=?').run(alreadyPosted.id);
        deletedPostedSuffix = String(alreadyPosted.id).slice(-6);
        const notes = [...new Set([candidate.notes, alreadyPosted.notes].filter(value => typeof value === 'string' && value.trim()))].join('\n');
        const preserve = {};
        const category = candidate.category || alreadyPosted.category;
        if (category) preserve.category = category;
        if (notes) preserve.notes = notes;
        const replaced = await replacePendingActual({ transaction: candidate, posted, createBackup: async () => backup, update: updateTransaction, preserve });
        replaceTransactionMapping(db, candidate.imported_id.slice(6), posted, mapping.actual_account_id, candidate.id,
          () => closeReviewInTransaction(row.id, action, { backup: replaced.backup, deletedPostedSuffix, action }, mapping.actual_account_id));
        await syncActual();
        return { id: row.id, action, backup: replaced.backup, deletedPostedSuffix };
      }

      const { backup } = await replacePendingActual({
        transaction: candidate,
        posted,
        createBackup: backupBudget,
        update: updateTransaction,
      });
      replaceTransactionMapping(db, candidate.imported_id.slice(6), posted, mapping.actual_account_id, candidate.id,
        () => closeReviewInTransaction(row.id, action, { backup, actualTransactionIdSuffix: String(candidate.id).slice(-6), action }, mapping.actual_account_id));
      await syncActual();
      return { id: row.id, action, backup };
    }

    const confirmed = assertDeletionConfirmation(candidate, mapping, options);
    const backup = await backupBudget();
    await deleteTransaction(candidate.id);
    db.prepare('DELETE FROM tx_map WHERE actual_transaction_id=?').run(candidate.id);
    const imported = await importPosted(posted, mapping.actual_account_id);
    await syncActual();
    const details = { backup, deletedActualIdSuffix: String(candidate.id).slice(-6), postedActualIdSuffix: String(imported.id).slice(-6), confirmed };
    closeReview(row.id, action, details, mapping.actual_account_id);
    return { id: row.id, action, backup };
  }

  if (!['keep_both', 'no_match', 'keep', 'resolve'].includes(action)) throw new Error('Invalid review action');
  const imported = await importPosted(posted, mapping.actual_account_id);
  await syncActual();
  closeReview(row.id, action, { postedActualIdSuffix: String(imported.id).slice(-6) }, mapping.actual_account_id);
  return { id: row.id, action };
}

export async function resolveReview(id, action, options = {}) {
  const row = db.prepare('SELECT * FROM review_queue WHERE id=? AND resolved_at IS NULL AND archived_at IS NULL').get(id);
  if (!row) throw new Error('Open review item not found');
  const payload = parsePayload(row.payload);

  if (row.reason === 'pending_to_posted_unmatched') {
    const posted = extractPostedTransaction(payload);
    if (!posted?.account_id || !posted?.transaction_id) throw new Error('Posted transaction details are unavailable');
    if (posted && !payload.posted) payload.posted = posted;
    const mapping = db.prepare(`SELECT * FROM mappings WHERE plaid_account_id=?
      AND (? IS NULL OR actual_account_id=?)`).get(posted?.account_id, row.actual_account_id, row.actual_account_id);
    if (!mapping) throw new Error('The mapped account for this review is unavailable');
    const details = await reviewDetails(id);
    payload.candidates = details?.payload?.candidates || [];
    return resolveLifecycleReview(row, action, options, payload, mapping);
  }

  if (action === 'delete') {
    const transactionId = row.actual_transaction_id;
    if (!transactionId) throw new Error('Review item has no Actual transaction to delete');
    const mapping = db.prepare('SELECT * FROM mappings WHERE actual_account_id=?').get(row.actual_account_id);
    const transaction = (await getTransactions(row.actual_account_id)).find(item => item.id === transactionId);
    if (!transaction || options.confirmation !== 'DELETE REVIEWED TRANSACTION') throw new Error('Explicit deletion confirmation is required');
    const expected = {
      account: mapping?.actual_account_name || mapping?.plaid_name || '',
      payee: transaction.payee_name || '',
      date: transaction.date || '',
      amountCents: Number(transaction.amount),
    };
    for (const key of Object.keys(expected)) {
      if (String(options.confirmedDetails?.[key] ?? '') !== String(expected[key])) {
        throw new Error('Deletion details changed; review the exact account, payee, date, and amount again');
      }
    }
    const backup = await backupBudget();
    await deleteTransaction(transactionId);
    await syncActual();
    db.prepare('DELETE FROM tx_map WHERE actual_transaction_id=?').run(transactionId);
    closeReview(row.id, action, { backup, deletedActualIdSuffix: String(transactionId).slice(-6), expected });
    return { id: row.id, action, backup };
  }

  if (!['keep', 'resolve'].includes(action)) throw new Error('Invalid review action');
  if (row.plaid_transaction_id) {
    db.prepare('UPDATE tx_map SET user_review=0,updated_at=CURRENT_TIMESTAMP WHERE plaid_transaction_id=?').run(row.plaid_transaction_id);
  }
  closeReview(row.id, action, {});
  return { id: row.id, action };
}

export function classifyReview(id, classification) {
  if (!VALID_ENVIRONMENTS.has(classification.environment)) throw new Error('Invalid review environment');
  if (!VALID_ITEM_STATUSES.has(classification.sourceItemStatus)) throw new Error('Invalid source Item status');
  const row = db.prepare('SELECT id FROM review_queue WHERE id=?').get(id);
  if (!row) throw new Error('Review item not found');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE review_queue SET environment=?,source_item_status=? WHERE id=?')
      .run(classification.environment, classification.sourceItemStatus, id);
    writeAudit(id, 'classified', classification);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { id, ...classification };
}

export function archiveLegacyReviews(confirmation) {
  return archiveLegacyReviewsInDatabase(db, confirmation);
}
