import test from 'node:test';
import assert from 'node:assert/strict';
import { linkTokenRequest } from '../src/link-token-request.js';

const options = {
  clientName: 'Actual Plaid Sync',
  language: 'en',
  countryCodes: ['US'],
  userId: 'stable-user-id',
  redirectUri: 'https://sync.example/oauth-return',
  webhook: 'https://sync.example/webhooks/plaid',
  importDays: 90,
};

test('existing Item Link token uses update mode without requesting new products or webhook settings', () => {
  const request = linkTokenRequest(options, 'access-token');

  assert.equal(request.access_token, 'access-token');
  assert.equal(request.redirect_uri, options.redirectUri);
  assert.equal(request.products, undefined);
  assert.equal(request.transactions, undefined);
  assert.equal(request.webhook, undefined);
});

test('new Item Link token keeps the Transactions product and configured webhook', () => {
  const request = linkTokenRequest(options);

  assert.deepEqual(request.products, ['transactions']);
  assert.deepEqual(request.transactions, { days_requested: 90 });
  assert.equal(request.webhook, options.webhook);
  assert.equal(request.access_token, undefined);
});
