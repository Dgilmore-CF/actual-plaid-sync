import {plaid} from './plaid.js';
import {db} from './db.js';
import {decrypt} from './crypto.js';
import {getAccountBalance,getTransactions} from './actual.js';
import {dollarsToCents,reconciliationDifference} from './money.js';
import {calculateActualBalanceModel,determineStatus} from './balance-model.js';

export async function refreshItemBalances(itemId){
  const item=db.prepare('SELECT access_token_enc FROM items WHERE item_id=?').get(itemId);
  if(!item)throw new Error('Unknown Plaid Item');
  const response=await plaid.accountsBalanceGet({access_token:decrypt(item.access_token_enc)});
  const results=[];
  for(const account of response.data.accounts){
    const mapping=db.prepare('SELECT * FROM mappings WHERE plaid_account_id=?').get(account.account_id);
    if(!mapping||!mapping.enabled||!mapping.initial_import_complete||!mapping.actual_account_id)continue;
    const currency=account.balances.iso_currency_code||account.balances.unofficial_currency_code||'UNKNOWN';
    const plaidCurrentBalanceCents=dollarsToCents(account.balances.current);
    const plaidAvailableBalanceCents=account.balances.available==null?null:dollarsToCents(account.balances.available);
    const transactions=await getTransactions(mapping.actual_account_id);
    const actualApiBalanceCents=await getAccountBalance(mapping.actual_account_id);
    const model=calculateActualBalanceModel(transactions,actualApiBalanceCents);
    const postedReconciliationDifferenceCents=reconciliationDifference(plaidCurrentBalanceCents,model.actualClearedBalanceCents);
    const status=determineStatus({postedDifferenceCents:postedReconciliationDifferenceCents,actualPendingBalanceCents:model.actualPendingBalanceCents,internalDifferenceCents:model.internalDifferenceCents,startingBalanceCount:model.startingBalanceCount,currency});
    const error=status==='error'?'Actual projected balance or Starting Balance invariant failed':status==='unsupported-currency'?`Unsupported currency: ${currency}`:null;
    db.prepare(`UPDATE mappings SET current_balance=?,available_balance=?,actual_balance_cents=?,reconciliation_difference_cents=?,reconciliation_status=?,balance_checked_at=CURRENT_TIMESTAMP,
      plaid_current_balance_cents=?,plaid_available_balance_cents=?,actual_cleared_balance_cents=?,actual_pending_balance_cents=?,actual_projected_balance_cents=?,posted_reconciliation_difference_cents=?,reconciliation_checked_at=CURRENT_TIMESTAMP,reconciliation_error=? WHERE plaid_account_id=?`)
      .run(Number(account.balances.current||0),account.balances.available==null?null:Number(account.balances.available),model.actualProjectedBalanceCents,postedReconciliationDifferenceCents,status,plaidCurrentBalanceCents,plaidAvailableBalanceCents,model.actualClearedBalanceCents,model.actualPendingBalanceCents,model.actualProjectedBalanceCents,postedReconciliationDifferenceCents,error,account.account_id);
    results.push({plaidAccountId:account.account_id,currency,plaidCurrentBalanceCents,plaidAvailableBalanceCents,...model,postedReconciliationDifferenceCents,reconciliationStatus:status,reconciliationError:error,checkedAt:new Date().toISOString()});
  }
  return results;
}
