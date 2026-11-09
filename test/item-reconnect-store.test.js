import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createItemReconnectStore } from '../src/item-reconnect-store.js';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE items(item_id TEXT PRIMARY KEY,access_token_enc TEXT NOT NULL,last_error TEXT);
    CREATE TABLE item_reconnect_events(
      reconnect_id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('started','completed','cancelled','failed')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      failure_code TEXT
    );
    INSERT INTO items VALUES('item-1','encrypted-token','reauthentication required');`);
  return db;
}

test('reconnect audit completes without changing the Item credential or sync error', () => {
  const db = database();
  const store = createItemReconnectStore(db);
  try {
    store.start('attempt-1', 'item-1');
    assert.equal(store.load('attempt-1').status, 'started');
    assert.equal(store.finalize('item-1', 'attempt-1'), 'completed');

    const item = db.prepare('SELECT access_token_enc,last_error FROM items WHERE item_id=?').get('item-1');
    const attempt = store.load('attempt-1');
    assert.equal(item.access_token_enc, 'encrypted-token');
    assert.equal(item.last_error, 'reauthentication required');
    assert.equal(attempt.status, 'completed');
    assert.ok(attempt.finished_at);
    assert.equal(attempt.failure_code, null);
  } finally { db.close(); }
});

test('repeated completion is idempotent', () => {
  const db = database();
  const store = createItemReconnectStore(db);
  try {
    store.start('attempt-1', 'item-1');
    assert.equal(store.finalize('item-1', 'attempt-1'), 'completed');
    assert.equal(store.finalize('item-1', 'attempt-1'), 'already-completed');
  } finally { db.close(); }
});

test('a removed Item cannot complete its reconnect audit event', () => {
  const db = database();
  const store = createItemReconnectStore(db);
  try {
    store.start('attempt-1', 'item-1');
    assert.equal(store.finalize('missing-item', 'attempt-1'), 'conflict');
    assert.equal(db.prepare('SELECT last_error FROM items WHERE item_id=?').get('item-1').last_error, 'reauthentication required');
    assert.equal(store.load('attempt-1').status, 'started');
  } finally { db.close(); }
});

test('a reconnect attempt cannot update a different Item', () => {
  const db = database();
  const store = createItemReconnectStore(db);
  try {
    store.start('attempt-1', 'item-1');
    assert.equal(store.finalize('other-item', 'attempt-1'), 'conflict');
    assert.equal(db.prepare('SELECT last_error FROM items WHERE item_id=?').get('item-1').last_error, 'reauthentication required');
  } finally { db.close(); }
});

test('cancel and failure states are terminal and store only sanitized codes', () => {
  const db = database();
  const store = createItemReconnectStore(db);
  try {
    store.start('cancelled-attempt', 'item-1');
    assert.equal(store.cancel('item-1', 'cancelled-attempt'), 'cancelled');
    assert.equal(store.cancel('item-1', 'cancelled-attempt'), 'already-cancelled');
    assert.equal(store.finalize('item-1', 'encrypted-token', 'cancelled-attempt'), 'conflict');

    store.start('failed-attempt', 'item-1');
    assert.equal(store.fail('failed-attempt', 'item-1', 'verification_failed'), true);
    assert.equal(store.fail('failed-attempt', 'item-1', 'verification_failed'), false);
    assert.equal(store.load('failed-attempt').status, 'failed');
    assert.equal(store.load('failed-attempt').failure_code, 'verification_failed');
    assert.equal(db.prepare('SELECT last_error FROM items WHERE item_id=?').get('item-1').last_error, 'reauthentication required');
  } finally { db.close(); }
});

test('a new reconnect expires abandoned attempts without retaining Link credentials', () => {
  const db = database();
  const store = createItemReconnectStore(db);
  try {
    db.prepare(`INSERT INTO item_reconnect_events(reconnect_id,item_id,status,created_at)
      VALUES('stale-attempt','item-1','started',datetime('now','-2 days'))`).run();
    store.start('new-attempt', 'item-1');
    const stale = store.load('stale-attempt');
    assert.equal(stale.status, 'failed');
    assert.equal(stale.failure_code, 'expired');
    assert.equal(store.load('new-attempt').status, 'started');
  } finally { db.close(); }
});
