import * as api from '@actual-app/api';
import path from 'node:path';
import { config } from './config.js';
let initialized = false; let queue = Promise.resolve();
async function initialize() { if (initialized) return; await api.init({ dataDir: path.join(config.dataDir, 'actual-cache'), serverURL: config.actualUrl, password: config.actualPassword }); await api.downloadBudget(config.budgetId, config.budgetPassword ? { password: config.budgetPassword } : undefined); initialized = true; }
export function serialized(fn) { const run = queue.then(async () => { await initialize(); return fn(api); }); queue = run.catch(() => {}); return run; }
export const listAccounts = () => serialized(a => a.getAccounts());
export const createAccount = account => serialized(a => a.createAccount(account));
export const importTransactions = (id, transactions) => serialized(a => a.importTransactions(id, transactions, { defaultCleared: true, payeeNameNormalization: false }));
export const syncActual = () => serialized(a => a.sync());
export async function closeActual() { if (initialized) { await queue; await api.shutdown(); initialized = false; } }
