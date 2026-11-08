import { toActual } from './transform.js';

export async function replacePendingActual({ transaction, posted, createBackup, update, preserve = null }) {
  const backup = await createBackup();
  const transformed = toActual(posted);
  const changes = {
    date: posted.date || transformed.date,
    amount: transformed.amount,
    payee_name: transformed.payee_name,
    cleared: true,
    imported_id: transformed.imported_id,
  };
  if (preserve && Object.hasOwn(preserve, 'category')) changes.category = preserve.category;
  if (preserve && Object.hasOwn(preserve, 'notes')) changes.notes = preserve.notes;
  await update(transaction.id, changes);
  return { backup, changes };
}

export function replaceTransactionMapping(database, previousPlaidId, posted, actualAccountId, actualTransactionId, after = () => {}) {
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('DELETE FROM tx_map WHERE plaid_transaction_id=?').run(previousPlaidId);
    database.prepare(`INSERT INTO tx_map(
      plaid_transaction_id,plaid_account_id,actual_account_id,actual_transaction_id,pending,user_review,updated_at
    ) VALUES(?,?,?,?,0,0,CURRENT_TIMESTAMP)
    ON CONFLICT(plaid_transaction_id) DO UPDATE SET
      actual_transaction_id=excluded.actual_transaction_id,pending=0,user_review=0,updated_at=CURRENT_TIMESTAMP`)
      .run(posted.transaction_id, posted.account_id, actualAccountId, actualTransactionId);
    after();
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
