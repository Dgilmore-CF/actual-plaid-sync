import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPlaidItemStatus, plaidItemStatus } from '../src/plaid-item-status.js';

test('a Plaid Item without an Item error is healthy', () => {
  assert.equal(plaidItemStatus({ item_id: 'private-item-id', error: null }), 'healthy');
});

test('known Plaid authentication errors require reconnecting', () => {
  for (const error_code of [
    'ITEM_LOGIN_REQUIRED',
    'INVALID_ACCESS_TOKEN',
    'INVALID_CREDENTIALS',
    'USER_PERMISSION_REVOKED',
    'USER_SETUP_REQUIRED',
  ]) {
    assert.equal(plaidItemStatus({ error: { error_code } }), 'reauth_required');
  }
});

test('unknown Item errors and missing Item responses are unavailable', () => {
  assert.equal(plaidItemStatus({ error: { error_code: 'INSTITUTION_DOWN' } }), 'unavailable');
  assert.equal(plaidItemStatus(null), 'unavailable');
});

test('a failed Plaid check returns unavailable without exposing the error', async () => {
  const status = await checkPlaidItemStatus(async () => {
    throw new Error('private access token must not escape');
  });
  assert.equal(status, 'unavailable');
});
