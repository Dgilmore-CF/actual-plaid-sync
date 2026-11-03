import { plaid } from './plaid.js';
import { db } from './db.js';
import { decrypt } from './crypto.js';
import { importTransactions, syncActual, backupBudget, findByImportedId, updateTransaction, deleteTransaction, getTransactions } from './actual.js';
import { toActual, openingBalance, reconcile } from './transform.js';
import { refreshItemBalances } from './reconciliation.js';
import { removalAction } from './transaction-policy.js';

let busy=false;
async function pages(item,cursorOverride){
  const original=cursorOverride??item.cursor??undefined;
  let cursor=original,all={added:[],modified:[],removed:[]},more=true;
  while(more){
    try{
      const r=(await plaid.transactionsSync({access_token:decrypt(item.access_token_enc),cursor,count:500})).data;
      all.added.push(...r.added);all.modified.push(...r.modified);all.removed.push(...r.removed);cursor=r.next_cursor;more=r.has_more;
    }catch(e){
      if(e?.response?.data?.error_code==='TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'){cursor=original;all={added:[],modified:[],removed:[]};more=true;continue;}
      throw e;
    }
  }
  return {...all,cursor};
}
function queueReview(itemId,txId,reason,payload,map={}){
  const exists=db.prepare('SELECT 1 FROM review_queue WHERE plaid_transaction_id=? AND reason=? AND resolved_at IS NULL').get(txId,reason);
  if(!exists)db.prepare('INSERT INTO review_queue(item_id,plaid_transaction_id,actual_transaction_id,actual_account_id,reason,payload) VALUES(?,?,?,?,?,?)').run(itemId,txId,map.actual_transaction_id||null,map.actual_account_id||null,reason,JSON.stringify(payload));
}
async function mapImported(tx,mapping){
  const actual=await findByImportedId(mapping.actual_account_id,`plaid:${tx.transaction_id}`);
  db.prepare(`INSERT INTO tx_map(plaid_transaction_id,plaid_account_id,actual_account_id,actual_transaction_id,pending,user_review,updated_at)
    VALUES(?,?,?,?,?,0,CURRENT_TIMESTAMP)
    ON CONFLICT(plaid_transaction_id) DO UPDATE SET actual_transaction_id=excluded.actual_transaction_id,pending=excluded.pending,updated_at=CURRENT_TIMESTAMP`).run(tx.transaction_id,tx.account_id,mapping.actual_account_id,actual?.id||null,tx.pending?1:0);
}
async function importNew(tx,mapping){await importTransactions(mapping.actual_account_id,[toActual(tx)]);await mapImported(tx,mapping);}
async function backfillTransactionMap(mappings){
  for(const mapping of mappings.values()){
    const existing=db.prepare('SELECT COUNT(*) AS n FROM tx_map WHERE actual_account_id=?').get(mapping.actual_account_id).n;
    if(existing>0)continue;
    const rows=await getTransactions(mapping.actual_account_id);
    const insert=db.prepare('INSERT OR IGNORE INTO tx_map(plaid_transaction_id,plaid_account_id,actual_account_id,actual_transaction_id,pending,user_review,updated_at) VALUES(?,?,?,?,?,0,CURRENT_TIMESTAMP)');
    for(const row of rows){
      if(!row.imported_id?.startsWith('plaid:')||row.imported_id.startsWith('plaid:opening:'))continue;
      const plaidId=row.imported_id.slice(6);
      insert.run(plaidId,mapping.plaid_account_id,mapping.actual_account_id,row.id,row.cleared?0:1);
    }
  }
}
async function replacePending(tx,mapping,itemId){
  const old=db.prepare('SELECT * FROM tx_map WHERE plaid_transaction_id=?').get(tx.pending_transaction_id);
  if(!old?.actual_transaction_id){await importNew(tx,mapping);queueReview(itemId,tx.transaction_id,'pending_to_posted_unmatched',tx);return;}
  const transformed=toActual(tx);
  await updateTransaction(old.actual_transaction_id,{date:transformed.date,amount:transformed.amount,payee_name:transformed.payee_name,notes:transformed.notes,cleared:true,imported_id:transformed.imported_id});
  db.prepare('DELETE FROM tx_map WHERE plaid_transaction_id=?').run(tx.pending_transaction_id);
  db.prepare('INSERT OR REPLACE INTO tx_map(plaid_transaction_id,plaid_account_id,actual_account_id,actual_transaction_id,pending,user_review,updated_at) VALUES(?,?,?,?,0,0,CURRENT_TIMESTAMP)').run(tx.transaction_id,tx.account_id,mapping.actual_account_id,old.actual_transaction_id);
  db.prepare('UPDATE review_queue SET resolved_at=CURRENT_TIMESTAMP,resolution=? WHERE plaid_transaction_id=? AND resolved_at IS NULL').run('replaced_pending',tx.pending_transaction_id);
}
async function applyModified(tx,mapping){
  const row=db.prepare('SELECT * FROM tx_map WHERE plaid_transaction_id=?').get(tx.transaction_id);
  if(!row?.actual_transaction_id){await importNew(tx,mapping);return;}
  const transformed=toActual(tx);
  await updateTransaction(row.actual_transaction_id,{date:transformed.date,amount:transformed.amount,payee_name:transformed.payee_name,notes:transformed.notes,cleared:transformed.cleared});
  db.prepare('UPDATE tx_map SET pending=?,updated_at=CURRENT_TIMESTAMP WHERE plaid_transaction_id=?').run(tx.pending?1:0,tx.transaction_id);
}
async function applyRemoved(removed,itemId){
  const row=db.prepare('SELECT * FROM tx_map WHERE plaid_transaction_id=?').get(removed.transaction_id);
  const action=removalAction(row);
  if(action==='ignore')return;
  if(action==='delete-pending'){await deleteTransaction(row.actual_transaction_id);db.prepare('DELETE FROM tx_map WHERE plaid_transaction_id=?').run(removed.transaction_id);return;}
  db.prepare('UPDATE tx_map SET user_review=1,updated_at=CURRENT_TIMESTAMP WHERE plaid_transaction_id=?').run(removed.transaction_id);
  queueReview(itemId,removed.transaction_id,'removed_posted',removed,row);
}
export async function previewInitial(plaidAccountId){
  const m=db.prepare('SELECT m.*,i.access_token_enc FROM mappings m JOIN items i ON i.item_id=m.item_id WHERE m.plaid_account_id=?').get(plaidAccountId);
  if(!m)throw new Error('Unknown Plaid account');
  const data=await pages({access_token_enc:m.access_token_enc,cursor:null},null);
  const txs=[...data.added,...data.modified].filter(x=>x.account_id===plaidAccountId);
  const opening=openingBalance(m.current_balance,txs);
  return{plaidAccountId,transactionCount:txs.length,pendingCount:txs.filter(x=>x.pending).length,earliest:txs.map(x=>x.date).sort()[0]||null,latest:txs.map(x=>x.date).sort().at(-1)||null,currentBalanceCents:Math.round(Number(m.current_balance)*100),openingBalanceCents:opening,reconciliationDifferenceCents:reconcile(m.current_balance,opening,txs)};
}
export async function approveInitial(plaidAccountId){
  const m=db.prepare('SELECT m.*,i.* FROM mappings m JOIN items i ON i.item_id=m.item_id WHERE m.plaid_account_id=?').get(plaidAccountId);
  if(!m?.actual_account_id||!m.enabled)throw new Error('Account mapping must be enabled');
  if(m.initial_import_complete)throw new Error('Initial import already completed');
  const data=await pages(m,null);const txs=[...data.added,...data.modified].filter(x=>x.account_id===plaidAccountId);const opening=openingBalance(m.current_balance,txs);
  if(reconcile(m.current_balance,opening,txs)!==0)throw new Error('Initial reconciliation is non-zero');
  const backup=await backupBudget();
  const openingTx={date:txs.map(x=>x.date).sort()[0]||new Date().toISOString().slice(0,10),amount:opening,payee_name:'Starting Balance',notes:'Calculated from Plaid current balance and imported history',imported_id:`plaid:opening:${plaidAccountId}`,cleared:true};
  await importTransactions(m.actual_account_id,[openingTx,...txs.map(toActual)]);await syncActual();
  for(const tx of txs)await mapImported(tx,m);
  db.prepare('UPDATE mappings SET initial_import_complete=1 WHERE plaid_account_id=?').run(plaidAccountId);
  db.prepare('INSERT INTO imports(plaid_account_id,actual_account_id,backup_path,approved_at,opening_balance,transaction_count) VALUES(?,?,?,CURRENT_TIMESTAMP,?,?)').run(plaidAccountId,m.actual_account_id,backup,opening,txs.length);
  db.prepare('UPDATE items SET cursor=?,last_sync_at=CURRENT_TIMESTAMP,last_error=NULL WHERE item_id=?').run(data.cursor,m.item_id);
  const reconciliation=await refreshItemBalances(m.item_id);
  return{backup,openingBalanceCents:opening,transactionCount:txs.length,reconciliation};
}
export async function syncItem(itemId){
  if(busy)throw new Error('Synchronization already running');busy=true;
  const run=db.prepare('INSERT INTO sync_runs(item_id) VALUES(?)').run(itemId);
  try{
    const item=db.prepare('SELECT * FROM items WHERE item_id=?').get(itemId);if(!item)throw new Error('Unknown Plaid Item');
    const data=await pages(item);const maps=new Map(db.prepare('SELECT * FROM mappings WHERE item_id=? AND enabled=1 AND initial_import_complete=1').all(itemId).map(x=>[x.plaid_account_id,x]));await backfillTransactionMap(maps);
    for(const tx of data.added){const m=maps.get(tx.account_id);if(!m)continue;if(tx.pending_transaction_id)await replacePending(tx,m,itemId);else await importNew(tx,m);}
    for(const tx of data.modified){const m=maps.get(tx.account_id);if(m)await applyModified(tx,m);}
    for(const tx of data.removed)await applyRemoved(tx,itemId);
    await syncActual();
    const reconciliation=await refreshItemBalances(itemId);const mismatches=reconciliation.filter(x=>x.reconciliationDifferenceCents!==0);
    db.prepare('UPDATE items SET cursor=?,last_sync_at=CURRENT_TIMESTAMP,last_error=? WHERE item_id=?').run(data.cursor,mismatches.length?`Reconciliation mismatch on ${mismatches.length} account(s)`:null,itemId);
    db.prepare('UPDATE sync_runs SET finished_at=CURRENT_TIMESTAMP,added=?,modified=?,removed=?,reconciliation_mismatches=? WHERE id=?').run(data.added.length,data.modified.length,data.removed.length,mismatches.length,run.lastInsertRowid);
    return{added:data.added.length,modified:data.modified.length,removed:data.removed.length,reconciliation,ok:mismatches.length===0};
  }catch(e){db.prepare('UPDATE items SET last_error=? WHERE item_id=?').run(String(e.message||e),itemId);db.prepare('UPDATE sync_runs SET finished_at=CURRENT_TIMESTAMP,error=? WHERE id=?').run(String(e.message||e),run.lastInsertRowid);throw e;}finally{busy=false;}
}
export async function syncAll(){const out=[];for(const x of db.prepare('SELECT item_id FROM items').all()){try{out.push({itemId:x.item_id,ok:true,result:await syncItem(x.item_id)})}catch(e){out.push({itemId:x.item_id,ok:false,error:String(e.message||e)})}}return out;}
