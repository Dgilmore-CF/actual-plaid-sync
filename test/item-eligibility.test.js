import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { eligibleItemIds, runEligibleItems } from '../src/item-eligibility.js';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE mappings(item_id TEXT,plaid_account_id TEXT,enabled INTEGER,
    initial_import_complete INTEGER,actual_account_id TEXT);`);
  const insert = db.prepare('INSERT INTO mappings VALUES(?,?,?,?,?)');
  insert.run('item-disabled', 'a1', 0, 1, 'actual-1');
  insert.run('item-unapproved', 'a2', 1, 0, 'actual-2');
  insert.run('item-no-account', 'a3', 1, 1, null);
  insert.run('item-active', 'a4', 1, 1, 'actual-4');
  insert.run('item-active', 'a5', 0, 1, null);
  return db;
}

test('eligible Item filtering requires enabled, approved, mapped accounts and includes each Item once', () => {
  const db = database();
  try { assert.deepEqual(eligibleItemIds(db), ['item-active']); }
  finally { db.close(); }
});

test('scheduled all-Item sync creates no work for inactive Items', async () => {
  const db = database();
  const calls = [];
  const runs = [];
  try {
    const result = await runEligibleItems(db, async itemId => {
      calls.push(itemId);
      runs.push(itemId);
      return { status: 'complete' };
    });
    assert.deepEqual(calls, ['item-active']);
    assert.deepEqual(runs, ['item-active']);
    assert.equal(result.length, 1);
    assert.equal(result[0].ok, true);
  } finally { db.close(); }
});
