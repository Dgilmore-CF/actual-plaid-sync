import { plaid } from './plaid.js';
import { db } from './db.js';
import { decrypt } from './crypto.js';
import { importTransactions, syncActual } from './actual.js';
import { toActual } from './transform.js';
let syncing = false;
export async function syncItem(itemId) {
  if (syncing) throw new Error('A synchronization is already running'); syncing = true;
  const run = db.prepare('INSERT INTO sync_runs(item_id) VALUES(?)').run(itemId);
  try {
    const item = db.prepare('SELECT * FROM items WHERE item_id=?').get(itemId); if (!item) throw new Error('Unknown Plaid Item');
    let start = item.cursor || undefined, cursor = start, all = { added: [], modified: [], removed: [] }, more = true;
    while (more) { try { const response = (await plaid.transactionsSync({ access_token: decrypt(item.access_token_enc), cursor, count: 500 })).data; all.added.push(...response.added); all.modified.push(...response.modified); all.removed.push(...response.removed); cursor = response.next_cursor; more = response.has_more; } catch (error) { if (error?.response?.data?.error_code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION') { cursor = start; all = { added: [], modified: [], removed: [] }; more = true; continue; } throw error; } }
    const mappings = new Map(db.prepare('SELECT * FROM mappings WHERE item_id=? AND enabled=1').all(itemId).map(x => [x.plaid_account_id, x]));
    const groups = new Map(); for (const tx of [...all.added, ...all.modified]) { const mapping = mappings.get(tx.account_id); if (!mapping?.actual_account_id) continue; if (!groups.has(mapping.actual_account_id)) groups.set(mapping.actual_account_id, []); groups.get(mapping.actual_account_id).push(toActual(tx)); }
    for (const [accountId, transactions] of groups) await importTransactions(accountId, transactions);
    await syncActual();
    db.prepare('UPDATE items SET cursor=?,last_sync_at=CURRENT_TIMESTAMP,last_error=NULL WHERE item_id=?').run(cursor, itemId);
    db.prepare('UPDATE sync_runs SET finished_at=CURRENT_TIMESTAMP,added=?,modified=?,removed=? WHERE id=?').run(all.added.length, all.modified.length, all.removed.length, run.lastInsertRowid);
    return { added: all.added.length, modified: all.modified.length, removed: all.removed.length };
  } catch (error) { db.prepare('UPDATE items SET last_error=? WHERE item_id=?').run(String(error.message || error), itemId); db.prepare('UPDATE sync_runs SET finished_at=CURRENT_TIMESTAMP,error=? WHERE id=?').run(String(error.message || error), run.lastInsertRowid); throw error; } finally { syncing = false; }
}
export async function syncAll() { const output = []; for (const item of db.prepare('SELECT item_id FROM items').all()) { try { output.push({ itemId: item.item_id, ok: true, result: await syncItem(item.item_id) }); } catch (error) { output.push({ itemId: item.item_id, ok: false, error: String(error.message || error) }); } } return output; }
