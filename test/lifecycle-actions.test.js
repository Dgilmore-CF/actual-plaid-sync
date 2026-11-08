import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { replacePendingActual, replaceTransactionMapping } from '../src/lifecycle-actions.js';

test('pending-to-posted replacement updates one Actual row and preserves category and user notes', async () => {
  const rows = [{
    id: 'actual-row-000001', date: '2026-11-04', amount: -823,
    payee_name: 'Walgreens Store 1234', category: 'user-category',
    notes: 'User note must survive', cleared: false, imported_id: 'plaid:pending-old',
  }];
  const calls = [];
  const posted = {
    transaction_id: 'posted-new', account_id: 'plaid-account-test', date: '2026-11-05',
    amount: 8.23, merchant_name: 'Walgreens', pending: false,
  };
  const outcome = await replacePendingActual({
    transaction: rows[0],
    posted,
    createBackup: async () => { calls.push('backup'); return 'backup.zip'; },
    update: async (id, changes) => {
      calls.push('update');
      Object.assign(rows.find(row => row.id === id), changes);
    },
  });
  assert.deepEqual(calls, ['backup', 'update']);
  assert.equal(outcome.backup, 'backup.zip');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, 'user-category');
  assert.equal(rows[0].notes, 'User note must survive');
  assert.equal(rows[0].amount, -823);
  assert.equal(rows[0].date, '2026-11-05');
  assert.equal(rows[0].payee_name, 'Walgreens');
  assert.equal(rows[0].cleared, true);
  assert.equal(rows[0].imported_id, 'plaid:posted-new');
});

test('replacement repairs tx_map and leaves exactly one mapping for the Actual row', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE tx_map(
    plaid_transaction_id TEXT PRIMARY KEY,plaid_account_id TEXT,actual_account_id TEXT,
    actual_transaction_id TEXT,pending INTEGER,user_review INTEGER,updated_at TEXT
  )`);
  db.prepare('INSERT INTO tx_map VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)')
    .run('pending-old', 'plaid-account-test', 'actual-account-test', 'actual-row-1', 1, 0);
  replaceTransactionMapping(db, 'pending-old', {
    transaction_id: 'posted-new', account_id: 'plaid-account-test',
  }, 'actual-account-test', 'actual-row-1');
  const rows = db.prepare('SELECT * FROM tx_map').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].plaid_transaction_id, 'posted-new');
  assert.equal(rows[0].actual_transaction_id, 'actual-row-1');
  assert.equal(rows[0].pending, 0);
  db.close();
});
