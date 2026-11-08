import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchTransactionChanges } from '../src/plaid-pagination.js';

const page = (added, next_cursor = 'cursor-next', has_more = false) => ({
  added, modified: [], removed: [], next_cursor, has_more,
});

test('each mapped account initial import starts at full history despite a saved Item cursor', async () => {
  const seen = [];
  const fetchPage = async ({ cursor }) => {
    seen.push(cursor);
    return page([{ transaction_id: `account-${seen.length}` }]);
  };
  const firstAccount = await fetchTransactionChanges(fetchPage, { cursor: 'saved-item-cursor', fromBeginning: true });
  const secondAccount = await fetchTransactionChanges(fetchPage, { cursor: 'saved-item-cursor', fromBeginning: true });
  assert.deepEqual(seen, [undefined, undefined]);
  assert.equal(firstAccount.added.length, 1);
  assert.equal(secondAccount.added.length, 1);
  assert.equal(firstAccount.cursor, 'cursor-next');
});

test('incremental sync continues from its saved cursor', async () => {
  let seen;
  const result = await fetchTransactionChanges(async request => {
    seen = request.cursor;
    return page([]);
  }, { cursor: 'saved-item-cursor' });
  assert.equal(seen, 'saved-item-cursor');
  assert.equal(result.cursor, 'cursor-next');
});

test('pagination mutation restarts from the original cursor and discards partial changes', async () => {
  const seen = [];
  let call = 0;
  const result = await fetchTransactionChanges(async ({ cursor }) => {
    seen.push(cursor);
    call += 1;
    if (call === 1) return page([{ transaction_id: 'discarded' }], 'partial-cursor', true);
    if (call === 2) throw { response: { data: { error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' } } };
    return page([{ transaction_id: 'kept' }], 'final-cursor', false);
  }, { cursor: 'saved-item-cursor' });
  assert.deepEqual(seen, ['saved-item-cursor', 'partial-cursor', 'saved-item-cursor']);
  assert.deepEqual(result.added.map(transaction => transaction.transaction_id), ['kept']);
  assert.equal(result.cursor, 'final-cursor');
});
