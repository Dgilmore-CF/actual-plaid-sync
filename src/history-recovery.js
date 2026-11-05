import { plaid } from './plaid.js';
import { db } from './db.js';
import { decrypt } from './crypto.js';
import { backupBudget, getTransactions, importTransactions, updateTransaction, syncActual } from './actual.js';
import { toActual } from './transform.js';
import { normalizePlaidBalanceCents } from './account-sign.js';
import { categorizeForImport } from './categories.js';

async function fetchAll(accessToken, accountId) {
  const endDate = new Date().toISOString().slice(0, 10);
  const start = new Date(); start.setFullYear(start.getFullYear() - 2);
  const startDate = start.toISOString().slice(0, 10);
  let offset = 0, total = Infinity, rows = [];
  while (offset < total) {
    const response = await plaid.transactionsGet({
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options: { account_ids: [accountId], count: 500, offset },
    });
    rows.push(...response.data.transactions);
    total = response.data.total_transactions;
    offset += response.data.transactions.length;
    if (!response.data.transactions.length) break;
  }
  return rows;
}

export async function historyStatus(plaidAccountId) {
  const row = db.prepare(`SELECT m.*, i.access_token_enc FROM mappings m JOIN items i ON i.item_id=m.item_id WHERE m.plaid_account_id=?`).get(plaidAccountId);
  if (!row) throw new Error('Unknown Plaid account');
  try {
    const transactions = await fetchAll(decrypt(row.access_token_enc), plaidAccountId);
    return { status: transactions.length ? 'ready' : 'empty', transactionCount: transactions.length };
  } catch (error) {
    const code = error?.response?.data?.error_code;
    if (code === 'PRODUCT_NOT_READY') return { status: 'preparing', transactionCount: 0 };
    return { status: 'error', transactionCount: 0, error: error?.response?.data?.error_message || error.message };
  }
}

export async function recoverMissingHistory(plaidAccountId) {
  const mapping = db.prepare(`SELECT m.*, i.access_token_enc FROM mappings m JOIN items i ON i.item_id=m.item_id WHERE m.plaid_account_id=?`).get(plaidAccountId);
  if (!mapping?.actual_account_id || !mapping.initial_import_complete) throw new Error('Account must already have an approved import');
  const plaidTransactions = await fetchAll(decrypt(mapping.access_token_enc), plaidAccountId);
  if (!plaidTransactions.length) throw new Error('Plaid has not returned historical transactions yet');
  const actualTransactions = await getTransactions(mapping.actual_account_id);
  const existingIds = new Set(actualTransactions.map(x => x.imported_id).filter(Boolean));
  const missing = plaidTransactions.filter(x => !existingIds.has(`plaid:${x.transaction_id}`));
  const opening = actualTransactions.find(x => x.imported_id === `plaid:opening:${plaidAccountId}`);
  if (!opening) throw new Error('The existing Starting Balance could not be found');
  const backup = await backupBudget();
  if (missing.length) await importTransactions(mapping.actual_account_id, await categorizeForImport(missing));
  const refreshed = await getTransactions(mapping.actual_account_id);
  const nonOpeningTotal = refreshed.filter(x => x.id !== opening.id).reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const target = normalizePlaidBalanceCents(mapping.plaid_type, mapping.plaid_subtype, mapping.current_balance);
  const correctedOpening = target - nonOpeningTotal;
  await updateTransaction(opening.id, { amount: correctedOpening });
  await syncActual();
  for (const tx of plaidTransactions) {
    const imported = (await getTransactions(mapping.actual_account_id)).find(x => x.imported_id === `plaid:${tx.transaction_id}`);
    db.prepare(`INSERT OR REPLACE INTO tx_map(plaid_transaction_id,plaid_account_id,actual_account_id,actual_transaction_id,pending,user_review,updated_at) VALUES(?,?,?,?,?,0,CURRENT_TIMESTAMP)`).run(tx.transaction_id, plaidAccountId, mapping.actual_account_id, imported?.id || null, tx.pending ? 1 : 0);
  }
  db.prepare(`UPDATE imports SET transaction_count=?, opening_balance=? WHERE plaid_account_id=?`).run(plaidTransactions.length, correctedOpening, plaidAccountId);
  return { backup, recoveredTransactions: missing.length, totalPlaidTransactions: plaidTransactions.length, correctedOpeningBalanceCents: correctedOpening };
}