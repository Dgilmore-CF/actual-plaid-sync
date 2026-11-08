import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase } from '../src/schema.js';
import {
  archiveLegacyReviewsInDatabase, isProductionOpenReview,
  recordReviewResolution, reviewMatchesFilter,
} from '../src/review-classification.js';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE mappings(plaid_account_id TEXT PRIMARY KEY,item_id TEXT,plaid_name TEXT);
    CREATE TABLE review_queue(id INTEGER PRIMARY KEY AUTOINCREMENT,item_id TEXT,plaid_transaction_id TEXT,
      reason TEXT NOT NULL,payload TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,resolved_at TEXT);
    CREATE TABLE sync_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,item_id TEXT,started_at TEXT DEFAULT CURRENT_TIMESTAMP,finished_at TEXT,error TEXT);`);
  migrateDatabase(db);
  return db;
}

test('review filters classify Production open, match, removed, legacy, resolved, and all records', () => {
  const production = { environment: 'production', reason: 'pending_to_posted_unmatched', resolved_at: null, archived_at: null };
  assert.equal(isProductionOpenReview(production), true);
  assert.equal(reviewMatchesFilter(production, 'production-open'), true);
  assert.equal(reviewMatchesFilter(production, 'needs-match'), true);
  assert.equal(reviewMatchesFilter({ ...production, reason: 'removed_posted' }, 'removed-posted'), true);
  assert.equal(reviewMatchesFilter({ ...production, environment: 'legacy_unknown' }, 'legacy-test'), true);
  assert.equal(reviewMatchesFilter({ ...production, resolved_at: '2026-11-08' }, 'resolved'), true);
  assert.equal(reviewMatchesFilter(production, 'all'), true);
  assert.equal(reviewMatchesFilter({ ...production, environment: 'sandbox' }, 'production-open'), false);
});

test('legacy archival preserves rows and Production reviews and audits every archived record', () => {
  const db = database();
  db.prepare(`INSERT INTO review_queue(reason,environment) VALUES('pending_to_posted_unmatched','production')`).run();
  db.prepare(`INSERT INTO review_queue(reason,environment) VALUES('removed_posted','sandbox')`).run();
  db.prepare(`INSERT INTO review_queue(reason,environment) VALUES('pending_to_posted_unmatched','legacy_unknown')`).run();
  assert.throws(() => archiveLegacyReviewsInDatabase(db, 'wrong phrase'), /confirmation phrase/i);
  const result = archiveLegacyReviewsInDatabase(db, 'ARCHIVE LEGACY REVIEWS');
  assert.deepEqual(result, { archived: 2, deleted: 0 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM review_queue').get().n, 3);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM review_queue WHERE environment='production' AND archived_at IS NULL`).get().n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM review_queue WHERE archived_at IS NOT NULL`).get().n, 2);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM review_resolutions WHERE action='archived'`).get().n, 2);
  db.close();
});

test('review resolution audit records action and details', () => {
  const db = database();
  const id = Number(db.prepare(`INSERT INTO review_queue(reason,environment) VALUES('removed_posted','production')`).run().lastInsertRowid);
  recordReviewResolution(db, id, 'keep', { note: 'operator retained transaction' });
  const audit = db.prepare('SELECT review_id,action,details FROM review_resolutions').get();
  assert.equal(audit.review_id, id);
  assert.equal(audit.action, 'keep');
  assert.deepEqual(JSON.parse(audit.details), { note: 'operator retained transaction' });
  db.close();
});
