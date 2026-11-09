import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelItemReconnect, confirmItemReconnect, failItemReconnect } from '../src/item-reconnect.js';

function dependencies(overrides = {}) {
  const calls = { attempt: [], load: [], verify: [], finalize: [], cancel: [], fail: [] };
  return {
    calls,
    loadAttempt: async reconnectId => {
      calls.attempt.push(reconnectId);
      return { reconnect_id: reconnectId, item_id: 'item-1', status: 'started' };
    },
    loadItem: async itemId => {
      calls.load.push(itemId);
      return { item_id: itemId, access_token_enc: 'encrypted-token', last_error: 'reauthentication required' };
    },
    verifyItem: async item => {
      calls.verify.push(item.item_id);
      return { item_id: item.item_id, error: null };
    },
    finalizeReconnect: async (...args) => {
      calls.finalize.push(args);
      return 'completed';
    },
    cancelAttempt: async (...args) => {
      calls.cancel.push(args);
      return 'cancelled';
    },
    failAttempt: async (...args) => {
      calls.fail.push(args);
      return true;
    },
    ...overrides,
  };
}

test('successful Update-mode reconnect verifies the same Item and finalizes its audit event', async () => {
  const deps = dependencies();

  const result = await confirmItemReconnect({ itemId: 'item-1', reconnectId: 'attempt-1', ...deps });

  assert.deepEqual(result, { reconnected: true, alreadyCompleted: false });
  assert.deepEqual(deps.calls.attempt, ['attempt-1']);
  assert.deepEqual(deps.calls.load, ['item-1']);
  assert.deepEqual(deps.calls.verify, ['item-1']);
  assert.deepEqual(deps.calls.finalize, [['item-1', 'attempt-1']]);
});

test('unknown reconnect attempt is rejected before reading or verifying an Item', async () => {
  const deps = dependencies({ loadAttempt: async () => null });

  await assert.rejects(
    confirmItemReconnect({ itemId: 'item-1', reconnectId: 'missing', ...deps }),
    /Unknown reconnect attempt/,
  );
  assert.deepEqual(deps.calls.load, []);
  assert.deepEqual(deps.calls.verify, []);
});

test('a completed callback is idempotent and does not recheck or rewrite the Item', async () => {
  const deps = dependencies({
    loadAttempt: async reconnectId => ({ reconnect_id: reconnectId, item_id: 'item-1', status: 'completed' }),
  });

  const result = await confirmItemReconnect({ itemId: 'item-1', reconnectId: 'attempt-1', ...deps });

  assert.deepEqual(result, { reconnected: true, alreadyCompleted: true });
  assert.deepEqual(deps.calls.load, []);
  assert.deepEqual(deps.calls.verify, []);
  assert.deepEqual(deps.calls.finalize, []);
});

test('a reconnect attempt cannot be used for another Item', async () => {
  const deps = dependencies({
    loadAttempt: async reconnectId => ({ reconnect_id: reconnectId, item_id: 'other-item', status: 'started' }),
  });

  await assert.rejects(
    confirmItemReconnect({ itemId: 'item-1', reconnectId: 'attempt-1', ...deps }),
    /Unknown reconnect attempt/,
  );
  assert.deepEqual(deps.calls.load, []);
});

test('a terminal unsuccessful attempt cannot be completed again', async () => {
  const deps = dependencies({
    loadAttempt: async reconnectId => ({ reconnect_id: reconnectId, item_id: 'item-1', status: 'failed' }),
  });

  await assert.rejects(
    confirmItemReconnect({ itemId: 'item-1', reconnectId: 'attempt-1', ...deps }),
    /not active/,
  );
  assert.deepEqual(deps.calls.verify, []);
});

test('a missing or unhealthy Plaid Item does not finalize the reconnect audit event', async () => {
  for (const verifyItem of [async () => null, async () => ({ item_id: 'item-1', error: { error_code: 'ITEM_LOGIN_REQUIRED' } })]) {
    const deps = dependencies({ verifyItem });
    await assert.rejects(
      confirmItemReconnect({ itemId: 'item-1', reconnectId: 'attempt-1', ...deps }),
      /still requires attention/,
    );
    assert.deepEqual(deps.calls.finalize, []);
  }
});

test('a concurrent change prevents marking the reconnect complete', async () => {
  const deps = dependencies({ finalizeReconnect: async () => 'conflict' });

  await assert.rejects(
    confirmItemReconnect({ itemId: 'item-1', reconnectId: 'attempt-1', ...deps }),
    /changed during verification/,
  );
});

test('cancel records a terminal state and repeated cancellation is idempotent', async () => {
  let status = 'started';
  let cancelCount = 0;
  const deps = dependencies({
    loadAttempt: async reconnectId => ({ reconnect_id: reconnectId, item_id: 'item-1', status }),
    cancelAttempt: async () => { cancelCount += 1; status = 'cancelled'; return 'cancelled'; },
  });

  assert.deepEqual(await cancelItemReconnect({ itemId: 'item-1', reconnectId: 'attempt-1', ...deps }), {
    cancelled: true,
    alreadyCancelled: false,
  });
  assert.deepEqual(await cancelItemReconnect({ itemId: 'item-1', reconnectId: 'attempt-1', ...deps }), {
    cancelled: true,
    alreadyCancelled: true,
  });
  assert.equal(cancelCount, 1);
});

test('a completed reconnect cannot be changed to cancelled', async () => {
  const deps = dependencies({
    loadAttempt: async reconnectId => ({ reconnect_id: reconnectId, item_id: 'item-1', status: 'completed' }),
  });

  assert.deepEqual(await cancelItemReconnect({ itemId: 'item-1', reconnectId: 'attempt-1', ...deps }), {
    cancelled: false,
    alreadyCompleted: true,
  });
  assert.deepEqual(deps.calls.cancel, []);
});

test('Link errors are recorded as failed without storing the raw error', async () => {
  const deps = dependencies();

  assert.deepEqual(await failItemReconnect({
    itemId: 'item-1',
    reconnectId: 'attempt-1',
    failureCode: 'link_exit_error',
    ...deps,
  }), { failed: true, alreadyFailed: false });
  assert.deepEqual(deps.calls.fail, [['item-1', 'attempt-1', 'link_exit_error']]);
});

test('a completed reconnect cannot be changed to failed', async () => {
  const deps = dependencies({
    loadAttempt: async reconnectId => ({ reconnect_id: reconnectId, item_id: 'item-1', status: 'completed' }),
  });

  assert.deepEqual(await failItemReconnect({
    itemId: 'item-1',
    reconnectId: 'attempt-1',
    failureCode: 'link_exit_error',
    ...deps,
  }), { failed: false, alreadyCompleted: true });
  assert.deepEqual(deps.calls.fail, []);
});
