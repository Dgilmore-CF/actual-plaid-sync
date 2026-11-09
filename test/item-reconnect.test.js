import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmItemReconnect } from '../src/item-reconnect.js';

function dependencies(overrides = {}) {
  const calls = { load: [], verify: [], clear: [] };
  return {
    calls,
    loadItem: async itemId => {
      calls.load.push(itemId);
      return { item_id: itemId, access_token_enc: 'old-encrypted-token', last_error: 'reauthentication required' };
    },
    verifyItem: async item => {
      calls.verify.push(item.item_id);
      return { item_id: item.item_id, error: null };
    },
    clearLastError: async (...args) => {
      calls.clear.push(args);
      return true;
    },
    ...overrides,
  };
}

test('successful update-mode reconnect verifies the same Item and clears its error only', async () => {
  const deps = dependencies();

  const result = await confirmItemReconnect({ itemId: 'item-1', ...deps });

  assert.deepEqual(result, { reconnected: true });
  assert.deepEqual(deps.calls.load, ['item-1']);
  assert.deepEqual(deps.calls.verify, ['item-1']);
  assert.deepEqual(deps.calls.clear, [['item-1', 'old-encrypted-token']]);
});

test('unknown Item is rejected before checking Plaid status', async () => {
  const deps = dependencies({ loadItem: async () => null });

  await assert.rejects(
    confirmItemReconnect({ itemId: 'missing-item', ...deps }),
    /Unknown Plaid Item/,
  );
  assert.deepEqual(deps.calls.verify, []);
  assert.deepEqual(deps.calls.clear, []);
});

test('a Plaid response for a different Item does not clear the existing error', async () => {
  const deps = dependencies({
    verifyItem: async () => ({ item_id: 'different-item', error: null }),
  });

  await assert.rejects(
    confirmItemReconnect({ itemId: 'item-1', ...deps }),
    /still requires attention/,
  );
  assert.deepEqual(deps.calls.clear, []);
});

test('a missing Plaid Item response is not treated as a successful reconnect', async () => {
  const deps = dependencies({ verifyItem: async () => null });

  await assert.rejects(
    confirmItemReconnect({ itemId: 'item-1', ...deps }),
    /still requires attention/,
  );
  assert.deepEqual(deps.calls.clear, []);
});

test('an Item that still has a Plaid error is not marked reconnected', async () => {
  const deps = dependencies({ verifyItem: async () => ({ item_id: 'item-1', error: { error_code: 'ITEM_LOGIN_REQUIRED' } }) });

  await assert.rejects(
    confirmItemReconnect({ itemId: 'item-1', ...deps }),
    /still requires attention/,
  );
  assert.deepEqual(deps.calls.clear, []);
});

test('a concurrent Item update prevents clearing a newer error state', async () => {
  const deps = dependencies({ clearLastError: async () => false });

  await assert.rejects(
    confirmItemReconnect({ itemId: 'item-1', ...deps }),
    /changed during reconnect/,
  );
});
