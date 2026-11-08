import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAndRefreshReview } from '../src/review-resolution.js';

test('review resolution recalculates account status after applying the selected action', async () => {
  const events = [];
  const result = await resolveAndRefreshReview({
    withNoSync: async task => { events.push('lock'); return task(); },
    resolve: async (id, action, options) => { events.push(`resolve:${id}:${action}:${options.marker}`); return { id, action }; },
    refresh: async itemId => { events.push(`refresh:${itemId}`); return [{ explanationStatus: 'Reconciled' }]; },
    itemId: 'item-fixture', id: 7, action: 'keep', options: { marker: 'fixture' },
  });
  assert.deepEqual(events, ['lock', 'resolve:7:keep:fixture', 'refresh:item-fixture']);
  assert.equal(result.reconciliation[0].explanationStatus, 'Reconciled');
});

test('reconciliation refresh failure does not undo an already audited review action', async () => {
  const events = [];
  const result = await resolveAndRefreshReview({
    withNoSync: async task => task(),
    resolve: async () => { events.push('resolved'); return { id: 8, action: 'keep' }; },
    refresh: async () => { throw new Error('external outage'); },
    itemId: 'item-fixture', id: 8, action: 'keep', options: {},
  });
  assert.deepEqual(events, ['resolved']);
  assert.equal(result.reconciliationUnavailable, true);
});
