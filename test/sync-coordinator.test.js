import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncCoordinator, queueWebhookSync } from '../src/sync-coordinator.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('one Item cannot overlap itself and manual sync reports active or queued', async () => {
  const coordinator = new SyncCoordinator();
  const gate = deferred();
  const started = deferred();
  const first = coordinator.request('item-a', async () => { started.resolve(); await gate.promise; return 'done'; });
  await started.promise;
  assert.deepEqual(await coordinator.request('item-a', async () => 'duplicate'), { itemId: 'item-a', status: 'active' });
  const webhook = await queueWebhookSync(coordinator, 'item-a', async () => 'follow-up');
  assert.deepEqual(webhook, { itemId: 'item-a', status: 'queued' });
  assert.equal(coordinator.status('item-a'), 'queued');
  gate.resolve();
  assert.equal(await first, 'done');
  assert.equal(coordinator.status('item-a'), 'idle');
});

test('multiple webhooks during an active sync collapse to one follow-up', async () => {
  const coordinator = new SyncCoordinator();
  const gate = deferred();
  const started = deferred();
  let runs = 0;
  const first = coordinator.request('item-a', async () => { runs += 1; if (runs === 1) { started.resolve(); await gate.promise; } });
  await started.promise;
  await Promise.all([
    queueWebhookSync(coordinator, 'item-a', async () => { runs += 1; }),
    queueWebhookSync(coordinator, 'item-a', async () => { runs += 1; }),
    queueWebhookSync(coordinator, 'item-a', async () => { runs += 1; }),
  ]);
  gate.resolve();
  await first;
  assert.equal(runs, 2);
});

test('different Items have independent locks and can run at the same time', async () => {
  const coordinator = new SyncCoordinator();
  const gate = deferred();
  const a = coordinator.request('item-a', () => gate.promise);
  const b = coordinator.request('item-b', async () => 'b');
  assert.deepEqual(coordinator.activeItemIds().sort(), ['item-a', 'item-b']);
  assert.equal(await b, 'b');
  gate.resolve('a');
  assert.equal(await a, 'a');
  assert.deepEqual(coordinator.activeItemIds(), []);
});

test('shutdown drain waits for active sync and maintenance rejects overlap', async () => {
  const coordinator = new SyncCoordinator();
  const gate = deferred();
  const started = deferred();
  const active = coordinator.request('item-a', async () => { started.resolve(); await gate.promise; });
  await started.promise;
  await assert.rejects(coordinator.withNoSync(async () => {}), /synchronization is active/i);
  const draining = coordinator.drain();
  gate.resolve();
  await Promise.all([active, draining]);
  assert.equal(coordinator.status('item-a'), 'idle');
});
