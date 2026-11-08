import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDiagnostic } from '../src/diagnostics.js';

test('mismatch diagnostics remove full account IDs, transaction IDs, and secret-bearing fields', () => {
  const source = {
    account: 'Checking',
    plaidAccountId: 'plaid-account-private-full',
    actualAccountId: 'actual-account-private-full',
    actualAccountIdSuffix: '123456',
    plaidCurrentBalanceCents: 1000,
    plaidSecret: 'private-plaid-secret',
    actualServerPassword: 'private-actual-password',
    nested: { access_token: 'private-token', password: 'private-password', transaction_id: 'private-transaction', plaidAccessToken: 'private-access-token' },
  };
  const output = sanitizeDiagnostic(source);
  const serialized = JSON.stringify(output);
  assert.equal(output.account, 'Checking');
  assert.equal(output.actualAccountIdSuffix, '123456');
  assert.equal(output.plaidCurrentBalanceCents, 1000);
  assert.doesNotMatch(serialized, /private-account|private-token|private-password|private-transaction|private-plaid-secret|private-actual-password|private-access-token/);
});
