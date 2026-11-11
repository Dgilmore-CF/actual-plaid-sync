import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase, repairInterruptedRuns } from '../src/schema.js';

test('additive migrations are repeatable and repair unfinished runs at startup', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE mappings(plaid_account_id TEXT PRIMARY KEY,item_id TEXT);
    CREATE TABLE review_queue(id INTEGER PRIMARY KEY AUTOINCREMENT,reason TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,resolved_at TEXT,resolution TEXT);
    CREATE TABLE sync_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,item_id TEXT,started_at TEXT DEFAULT CURRENT_TIMESTAMP,finished_at TEXT,error TEXT);
    INSERT INTO review_queue(reason) VALUES('removed_posted');
    INSERT INTO sync_runs(item_id,started_at) VALUES('item-a','2026-11-07 10:00:00');
    INSERT INTO sync_runs(item_id,started_at,finished_at) VALUES('item-b','2026-11-07 11:00:00','2026-11-07 11:05:00');`);
  migrateDatabase(db);
  migrateDatabase(db);
  const interrupted = db.prepare('SELECT finished_at,error,last_progress_at,phase FROM sync_runs WHERE item_id=?').get('item-a');
  const finished = db.prepare('SELECT finished_at,error,phase FROM sync_runs WHERE item_id=?').get('item-b');
  assert.ok(interrupted.finished_at);
  assert.equal(interrupted.error, 'Interrupted by restart or shutdown');
  assert.ok(interrupted.last_progress_at);
  assert.equal(interrupted.phase, 'interrupted');
  assert.equal(finished.finished_at, '2026-11-07 11:05:00');
  assert.equal(finished.phase, 'complete');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM review_queue WHERE environment='legacy_unknown'").get().n, 1);
  assert.ok(db.prepare('PRAGMA table_info(review_queue)').all().some(column => column.name === 'archived_at'));
  assert.ok(db.prepare('PRAGMA table_info(sync_runs)').all().some(column => column.name === 'last_progress_at'));
  for (const name of ['error_stage', 'error_category', 'error_code', 'error_http_status', 'error_name', 'error_source_file', 'error_source_line']) {
    assert.ok(db.prepare('PRAGMA table_info(sync_runs)').all().some(column => column.name === name));
  }
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='review_resolutions'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='item_reconnect_events'").get());
  assert.ok(db.prepare('PRAGMA table_info(item_reconnect_events)').all().some(column => column.name === 'failure_code'));
  const repaired = repairInterruptedRuns(db, '2026-11-08T00:00:00.000Z');
  assert.equal(repaired, 0);
  db.close();
});

test('restart repair retains the last in-progress sync stage', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sync_runs(
    id INTEGER PRIMARY KEY,
    phase TEXT,
    error_stage TEXT,
    finished_at TEXT,
    last_progress_at TEXT,
    error TEXT
  );
  INSERT INTO sync_runs(id,phase) VALUES(1,'processing_removed');`);
  assert.equal(repairInterruptedRuns(db, '2026-11-11T00:00:00.000Z'), 1);
  const row = db.prepare('SELECT phase,error_stage FROM sync_runs WHERE id=1').get();
  assert.equal(row.phase, 'interrupted');
  assert.equal(row.error_stage, 'processing_removed');
  db.close();
});
