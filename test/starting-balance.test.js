import test from 'node:test';
import assert from 'node:assert/strict';
import { startingBalanceGuards } from '../src/starting-balance-guards.js';

const valid = {
  historyReady: true,
  startingBalanceCount: 1,
  duplicateImportedIdCount: 0,
  pendingCandidateCount: 0,
  removedPostedCount: 0,
  transactionSumCents: 12345,
  actualBalanceCents: 12345,
  noSyncActive: true,
};

test('Starting Balance recalculation is allowed only when every guard passes', () => {
  assert.equal(Object.values(startingBalanceGuards(valid)).every(Boolean), true);
});

for (const [guard, value] of [
  ['historyReady', false],
  ['startingBalanceCount', 2],
  ['duplicateImportedIdCount', 1],
  ['pendingCandidateCount', 1],
  ['removedPostedCount', 1],
  ['transactionSumCents', 12344],
  ['noSyncActive', false],
]) {
  test(`Starting Balance recalculation is blocked when ${guard} fails`, () => {
    const input = { ...valid, [guard]: value };
    assert.equal(Object.values(startingBalanceGuards(input)).every(Boolean), false);
  });
}
