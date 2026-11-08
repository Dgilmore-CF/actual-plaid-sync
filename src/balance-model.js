export function sumAmounts(rows){return rows.reduce((sum,row)=>sum+Math.round(Number(row.amount||0)),0);}
export function calculateActualBalanceModel(transactions,apiBalanceCents){
  const cleared=transactions.filter(t=>t.cleared===true);
  const pending=transactions.filter(t=>t.cleared!==true);
  const importedCounts=new Map();
  for(const transaction of transactions){if(transaction.imported_id?.startsWith('plaid:'))importedCounts.set(transaction.imported_id,(importedCounts.get(transaction.imported_id)||0)+1)}
  const duplicateImportedIdCount=[...importedCounts.values()].reduce((count,n)=>count+Math.max(0,n-1),0);
  const actualClearedBalanceCents=sumAmounts(cleared);
  const actualPendingBalanceCents=sumAmounts(pending);
  const actualProjectedBalanceCents=actualClearedBalanceCents+actualPendingBalanceCents;
  const startingBalanceCount=transactions.filter(t=>t.imported_id?.startsWith('plaid:opening:')||t.payee_name==='Starting Balance').length;
  const internalDifferenceCents=actualProjectedBalanceCents-Number(apiBalanceCents||0);
  return{actualClearedBalanceCents,actualPendingBalanceCents,actualProjectedBalanceCents,actualApiBalanceCents:Number(apiBalanceCents||0),internalDifferenceCents,startingBalanceCount,transactionCount:transactions.length,duplicateImportedIdCount,clearedCount:cleared.length,pendingCount:pending.length};
}
export function determineStatus({postedDifferenceCents,actualPendingBalanceCents,internalDifferenceCents,startingBalanceCount,currency}){
  if(currency!=='USD')return'unsupported-currency';
  if(internalDifferenceCents!==0||startingBalanceCount!==1)return'error';
  if(postedDifferenceCents!==0)return'mismatch';
  return actualPendingBalanceCents!==0?'reconciled-pending':'reconciled';
}

export function explainStatus({postedDifferenceCents,remainingAfterPendingCents,actualPendingBalanceCents,internalDifferenceCents,startingBalanceCount,duplicateImportedIdCount=0,openLifecycleReviewCount=0,historyReady=true,externalApiAvailable=true}){
  if(!externalApiAvailable)return'External API unavailable';
  if(!historyReady)return'History incomplete';
  if(internalDifferenceCents!==0||startingBalanceCount!==1||duplicateImportedIdCount!==0)return'Ledger inconsistency';
  if(openLifecycleReviewCount>0)return'Review required';
  if(postedDifferenceCents===0)return actualPendingBalanceCents===0?'Reconciled':'Reconciled with pending activity';
  if(remainingAfterPendingCents===0)return'Timing difference';
  return'Review required';
}
