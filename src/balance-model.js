export function sumAmounts(rows){return rows.reduce((sum,row)=>sum+Number(row.amount||0),0);}
export function calculateActualBalanceModel(transactions,apiBalanceCents){
  const cleared=transactions.filter(t=>t.cleared===true);
  const pending=transactions.filter(t=>t.cleared!==true);
  const actualClearedBalanceCents=sumAmounts(cleared);
  const actualPendingBalanceCents=sumAmounts(pending);
  const actualProjectedBalanceCents=actualClearedBalanceCents+actualPendingBalanceCents;
  const startingBalanceCount=transactions.filter(t=>t.imported_id?.startsWith('plaid:opening:')||t.payee_name==='Starting Balance').length;
  const internalDifferenceCents=actualProjectedBalanceCents-Number(apiBalanceCents||0);
  return{actualClearedBalanceCents,actualPendingBalanceCents,actualProjectedBalanceCents,actualApiBalanceCents:Number(apiBalanceCents||0),internalDifferenceCents,startingBalanceCount,clearedCount:cleared.length,pendingCount:pending.length};
}
export function determineStatus({postedDifferenceCents,actualPendingBalanceCents,internalDifferenceCents,startingBalanceCount,currency}){
  if(currency!=='USD')return'unsupported-currency';
  if(internalDifferenceCents!==0||startingBalanceCount!==1)return'error';
  if(postedDifferenceCents!==0)return'mismatch';
  return actualPendingBalanceCents!==0?'reconciled-pending':'reconciled';
}
