import { plaid } from './plaid.js';
import { db } from './db.js';
import { decrypt } from './crypto.js';
import { getAccountBalance } from './actual.js';
import { dollarsToCents, reconciliationDifference } from './money.js';

export async function refreshItemBalances(itemId){
  const item=db.prepare('SELECT access_token_enc FROM items WHERE item_id=?').get(itemId);
  if(!item)throw new Error('Unknown Plaid Item');
  const response=await plaid.accountsGet({access_token:decrypt(item.access_token_enc)});
  const results=[];
  for(const account of response.data.accounts){
    const current=Number(account.balances.current||0);
    const available=account.balances.available==null?null:Number(account.balances.available);
    const mapping=db.prepare('SELECT * FROM mappings WHERE plaid_account_id=?').get(account.account_id);
    if(!mapping)continue;
    if(!mapping.enabled||!mapping.initial_import_complete||!mapping.actual_account_id){
      db.prepare('UPDATE mappings SET current_balance=?,available_balance=?,balance_checked_at=CURRENT_TIMESTAMP WHERE plaid_account_id=?').run(current,available,account.account_id);
      continue;
    }
    const plaidCents=dollarsToCents(current);
    const actualCents=await getAccountBalance(mapping.actual_account_id);
    const difference=reconciliationDifference(plaidCents,actualCents);
    const status=difference===0?'reconciled':'mismatch';
    db.prepare('UPDATE mappings SET current_balance=?,available_balance=?,actual_balance_cents=?,reconciliation_difference_cents=?,reconciliation_status=?,balance_checked_at=CURRENT_TIMESTAMP WHERE plaid_account_id=?').run(current,available,actualCents,difference,status,account.account_id);
    results.push({plaidAccountId:account.account_id,plaidBalanceCents:plaidCents,actualBalanceCents:actualCents,reconciliationDifferenceCents:difference,reconciliationStatus:status});
  }
  return results;
}
