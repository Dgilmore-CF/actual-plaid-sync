import { db } from './db.js';
export function duplicateAccounts(institutionId,accounts){
  const duplicates=[];
  for(const account of accounts){
    let row=null;
    if(account.persistent_account_id){row=db.prepare('SELECT m.plaid_name,i.institution_name FROM mappings m JOIN items i ON i.item_id=m.item_id WHERE m.persistent_account_id=?').get(account.persistent_account_id);}
    if(!row){row=db.prepare('SELECT m.plaid_name,i.institution_name FROM mappings m JOIN items i ON i.item_id=m.item_id WHERE i.institution_id=? AND COALESCE(m.plaid_mask,\'\')=COALESCE(?,\'\') AND m.plaid_type=? AND m.plaid_subtype=?').get(institutionId,account.mask,account.type,account.subtype);}
    if(row)duplicates.push({account:account.name,existingInstitution:row.institution_name,existingAccount:row.plaid_name});
  }
  return duplicates;
}
