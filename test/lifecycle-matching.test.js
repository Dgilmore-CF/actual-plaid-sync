import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPostedTransaction, findPendingCandidates, normalizeMerchant, scorePendingCandidate, selectPendingMatch } from '../src/lifecycle-matching.js';

const posted = { merchant: 'WALGREENS #1234 Pending', date: '2026-11-05', actualAmountCents: -823 };
const candidate = (overrides = {}) => ({
  id: 'actual-row-123456', actual_account_id: 'actual-account-a', cleared: false,
  imported_id: 'plaid:pending-123456', payee_name: 'Walgreens Store 1234',
  date: '2026-11-05', amount: -823, ...overrides,
});

test('merchant normalization removes case, punctuation, store numbers and lifecycle/card suffixes', () => {
  assert.equal(normalizeMerchant('Walgreens, STORE #1234  PENDING card ending in 1294'), 'walgreens');
  assert.equal(normalizeMerchant('  ALLIANT   ENERGY - POSTED  '), 'alliant energy');
});

test('legacy raw pending review payloads remain readable alongside the current wrapped payload', () => {
  const raw = { transaction_id: 'posted-1', account_id: 'account-1', amount: 1 };
  assert.equal(extractPostedTransaction(raw), raw);
  assert.equal(extractPostedTransaction({ posted: raw }), raw);
  assert.equal(extractPostedTransaction({ transaction: raw }), raw);
  assert.equal(extractPostedTransaction({ reason: 'removed_posted' }), null);
});

test('candidate score is deterministic and includes exact amount, merchant, date, and pending bonuses', () => {
  const result = scorePendingCandidate(posted, candidate());
  assert.equal(result.score, 120);
  assert.equal(result.confidence, 'high');
  assert.equal(result.amountDifferenceCents, 0);
  assert.equal(result.dateDifferenceDays, 0);
  assert.equal(result.merchantSimilarity, 'exact');
});

test('candidate search enforces account, cleared, imported ID, date, amount, merchant, and posted-link constraints', () => {
  const candidates = findPendingCandidates(posted, [
    candidate(),
    candidate({ id: 'wrong-account', actual_account_id: 'other-account' }),
    candidate({ id: 'cleared', cleared: true }),
    candidate({ id: 'not-imported', imported_id: null }),
    candidate({ id: 'too-old', date: '2026-10-20' }),
    candidate({ id: 'wrong-amount', amount: -5000 }),
    candidate({ id: 'wrong-merchant', payee_name: 'Unrelated Store' }),
    candidate({ id: 'already-linked', linkedToPosted: true }),
  ], 'actual-account-a');
  assert.deepEqual(candidates.map(item => item.candidate.id), ['actual-row-123456']);
});

test('a unique high-confidence candidate is selected for automatic replacement', () => {
  const result = selectPendingMatch(findPendingCandidates(posted, [candidate()], 'actual-account-a'));
  assert.equal(result.automatic, true);
  assert.equal(result.candidate.id, 'actual-row-123456');
});

test('ambiguous equally scored candidates require a review instead of automatic replacement', () => {
  const candidates = findPendingCandidates(posted, [candidate({ id: 'pending-a' }), candidate({ id: 'pending-b' })], 'actual-account-a');
  const result = selectPendingMatch(candidates);
  assert.equal(result.analysis.score, 120);
  assert.equal(result.margin, 0);
  assert.equal(result.automatic, false);
});

test('strong merchant token overlap scores without requiring an exact merchant string', () => {
  const result = scorePendingCandidate({ ...posted, merchant: 'Alliant Energy Bill Pay' }, candidate({ payee_name: 'Alliant Energy' }));
  assert.equal(result.merchantSimilarity, 'strong');
  assert.ok(result.score >= 80);
});
