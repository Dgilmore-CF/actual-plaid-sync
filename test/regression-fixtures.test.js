import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateActualBalanceModel, determineStatus, explainStatus } from '../src/balance-model.js';

test('Chase Saffire zero-balance regression fixture remains reconciled', () => {
  const transactions = [{
    id: 'starting-balance-fixture', amount: 0, cleared: true,
    payee_name: 'Starting Balance', imported_id: 'plaid:opening:fixture',
  }];
  const model = calculateActualBalanceModel(transactions, 0);
  assert.equal(model.actualClearedBalanceCents, 0);
  assert.equal(model.actualPendingBalanceCents, 0);
  assert.equal(model.actualProjectedBalanceCents, 0);
  assert.equal(model.startingBalanceCount, 1);
  assert.equal(determineStatus({ postedDifferenceCents: 0, actualPendingBalanceCents: 0, internalDifferenceCents: 0, startingBalanceCount: 1, currency: 'USD' }), 'reconciled');
  assert.equal(explainStatus({ postedDifferenceCents: 0, remainingAfterPendingCents: 0, actualPendingBalanceCents: 0, internalDifferenceCents: 0, startingBalanceCount: 1, historyReady: true }), 'Reconciled');
});
