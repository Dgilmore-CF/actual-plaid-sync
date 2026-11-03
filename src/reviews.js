import { db } from './db.js';
import { deleteTransaction, syncActual } from './actual.js';

export async function resolveReview(id,action){
  const row=db.prepare('SELECT * FROM review_queue WHERE id=? AND resolved_at IS NULL').get(id);
  if(!row)throw new Error('Open review item not found');
  if(!['keep','delete','resolve'].includes(action))throw new Error('Invalid review action');
  if(action==='delete'){
    if(!row.actual_transaction_id)throw new Error('Review item has no Actual transaction to delete');
    await deleteTransaction(row.actual_transaction_id);
    await syncActual();
    db.prepare('DELETE FROM tx_map WHERE actual_transaction_id=?').run(row.actual_transaction_id);
  }
  if(row.plaid_transaction_id)db.prepare('UPDATE tx_map SET user_review=0,updated_at=CURRENT_TIMESTAMP WHERE plaid_transaction_id=?').run(row.plaid_transaction_id);
  db.prepare('UPDATE review_queue SET resolved_at=CURRENT_TIMESTAMP,resolution=? WHERE id=?').run(action,id);
  return{id,action};
}
