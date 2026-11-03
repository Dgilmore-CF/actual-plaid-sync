export function removalAction(mapping){
  if(!mapping)return 'ignore';
  return mapping.pending&&mapping.actual_transaction_id?'delete-pending':'review-posted';
}
export function isPendingReplacement(transaction){return Boolean(transaction?.pending_transaction_id)&&transaction?.pending===false;}
