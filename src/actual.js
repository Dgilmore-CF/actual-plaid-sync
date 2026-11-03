import * as api from '@actual-app/api';
import { config } from './config.js';
import { ensureActualDataDir } from './paths.js';

let initialized = false;
let queue = Promise.resolve();

async function initialize() {
  if (initialized) {
    return;
  }

  const actualDataDir = ensureActualDataDir(config.dataDir);

  await api.init({
    dataDir: actualDataDir,
    serverURL: config.actualUrl,
    password: config.actualPassword,
  });

  await api.downloadBudget(
    config.budgetId,
    config.budgetPassword
      ? { password: config.budgetPassword }
      : undefined,
  );

  initialized = true;
}

export function serialized(fn) {
  const run = queue.then(async () => {
    await initialize();
    return fn(api);
  });

  queue = run.catch(() => {});

  return run;
}

export const listAccounts = () =>
  serialized(actual => actual.getAccounts());

export const createAccount = account =>
  serialized(actual => actual.createAccount(account));

export const importTransactions = (accountId, transactions) =>
  serialized(actual =>
    actual.importTransactions(accountId, transactions, {
      defaultCleared: true,
      payeeNameNormalization: false,
    }),
  );

export const syncActual = () =>
  serialized(actual => actual.sync());

export async function closeActual() {
  if (!initialized) {
    return;
  }

  await queue;
  await api.shutdown();
  initialized = false;
}