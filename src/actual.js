import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as api from '@actual-app/api';
import { config } from './config.js';
import { ensureActualDataDir, ensureBackupDir } from './paths.js';

let ready=false;
let queue=Promise.resolve();
async function init(){
  if(ready)return;
  await api.init({dataDir:ensureActualDataDir(config.dataDir),serverURL:config.actualUrl,password:config.actualPassword});
  await api.downloadBudget(config.budgetId,config.budgetPassword?{password:config.budgetPassword}:undefined);
  ready=true;
}
export function serialized(fn){const run=queue.then(async()=>{await init();return fn(api)});queue=run.catch(()=>{});return run;}
export const listAccounts=()=>serialized(a=>a.getAccounts());
export const createAccount=x=>serialized(a=>a.createAccount(x));
export const updateAccount=(id,x)=>serialized(a=>a.updateAccount(id,x));
export const getAccountBalance=id=>serialized(a=>a.getAccountBalance(id));
export const getTransactions=(id,start='1970-01-01',end='2999-12-31')=>serialized(a=>a.getTransactions(id,start,end));
export const importTransactions=(id,txs)=>serialized(a=>a.importTransactions(id,txs,{defaultCleared:true,payeeNameNormalization:'original'}));
export const updateTransaction=(id,x)=>serialized(a=>a.updateTransaction(id,x));
export const deleteTransaction=id=>serialized(a=>a.deleteTransaction(id));
export const deleteAccount=id=>serialized(a=>a.deleteAccount(id));
export const syncActual=()=>serialized(a=>a.sync());
export function plannedBackupPath(){return path.join(ensureBackupDir(config.dataDir),`actual-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomBytes(4).toString('hex')}.zip`);}
export const backupBudget=(requestedPath)=>serialized(async a=>{const directory=path.resolve(ensureBackupDir(config.dataDir));const file=path.resolve(requestedPath||plannedBackupPath());if(path.dirname(file)!==directory)throw new Error('Backup path must remain in the configured backup directory');if(fs.existsSync(file))throw new Error('Backup path already exists; create a new preview');await a.exportBudget(file);return file;});
export async function findByImportedId(accountId,importedId){const rows=await getTransactions(accountId);return rows.find(x=>x.imported_id===importedId)||null;}
export async function shutdown(){if(ready){await queue;await api.shutdown();ready=false;}}
