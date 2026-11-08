import test from 'node:test';
import assert from 'node:assert/strict';
import { importPlaidTransactionOnce } from '../src/transaction-identity.js';

test('two no-change import attempts reuse one Actual row by stable Plaid imported ID', async () => {
  const rows = [];
  let importCalls = 0;
  const findByImportedId = async (accountId, importedId) => rows.find(row => row.accountId === accountId && row.importedId === importedId) || null;
  const importTransaction = async () => {
    importCalls += 1;
    rows.push({ id: 'actual-row-one', accountId: 'account-fixture', importedId: 'plaid:transaction-fixture' });
  };
  const first = await importPlaidTransactionOnce('account-fixture', 'plaid:transaction-fixture', findByImportedId, importTransaction);
  const second = await importPlaidTransactionOnce('account-fixture', 'plaid:transaction-fixture', findByImportedId, importTransaction);
  assert.equal(first.imported, true);
  assert.equal(second.imported, false);
  assert.equal(first.transaction.id, second.transaction.id);
  assert.equal(rows.length, 1);
  assert.equal(importCalls, 1);
});
