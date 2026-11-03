import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { ensureDir } from './paths.js';

ensureDir(config.dataDir);
export const db = new DatabaseSync(path.join(config.dataDir, 'state.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS items(
  item_id TEXT PRIMARY KEY,
  institution_id TEXT,
  institution_name TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  cursor TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sync_at TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS mappings(
  plaid_account_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  persistent_account_id TEXT,
  plaid_name TEXT NOT NULL,
  plaid_mask TEXT,
  plaid_type TEXT,
  plaid_subtype TEXT,
  current_balance REAL,
  available_balance REAL,
  actual_account_id TEXT,
  actual_account_name TEXT,
  offbudget INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 0,
  initial_import_complete INTEGER NOT NULL DEFAULT 0,
  actual_balance_cents INTEGER,
  reconciliation_difference_cents INTEGER,
  reconciliation_status TEXT NOT NULL DEFAULT 'unknown',
  balance_checked_at TEXT
);
CREATE TABLE IF NOT EXISTS tx_map(
  plaid_transaction_id TEXT PRIMARY KEY,
  plaid_account_id TEXT NOT NULL,
  actual_account_id TEXT NOT NULL,
  actual_transaction_id TEXT,
  pending INTEGER NOT NULL DEFAULT 0,
  user_review INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS review_queue(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT,
  plaid_transaction_id TEXT,
  actual_transaction_id TEXT,
  actual_account_id TEXT,
  reason TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolution TEXT
);
CREATE TABLE IF NOT EXISTS sync_runs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  added INTEGER DEFAULT 0,
  modified INTEGER DEFAULT 0,
  removed INTEGER DEFAULT 0,
  reconciliation_mismatches INTEGER DEFAULT 0,
  error TEXT
);
CREATE TABLE IF NOT EXISTS webhook_events(event_key TEXT PRIMARY KEY,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS imports(id INTEGER PRIMARY KEY AUTOINCREMENT,plaid_account_id TEXT,actual_account_id TEXT,backup_path TEXT,approved_at TEXT,opening_balance INTEGER,transaction_count INTEGER);
CREATE TABLE IF NOT EXISTS oauth_states(
  state_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
`);

const migrations = [
  "ALTER TABLE mappings ADD COLUMN persistent_account_id TEXT",
  "ALTER TABLE mappings ADD COLUMN actual_balance_cents INTEGER",
  "ALTER TABLE mappings ADD COLUMN reconciliation_difference_cents INTEGER",
  "ALTER TABLE mappings ADD COLUMN reconciliation_status TEXT NOT NULL DEFAULT 'unknown'",
  "ALTER TABLE mappings ADD COLUMN balance_checked_at TEXT",
  "ALTER TABLE review_queue ADD COLUMN actual_transaction_id TEXT",
  "ALTER TABLE review_queue ADD COLUMN actual_account_id TEXT",
  "ALTER TABLE review_queue ADD COLUMN resolution TEXT",
  "ALTER TABLE sync_runs ADD COLUMN reconciliation_mismatches INTEGER DEFAULT 0"
];
for (const sql of migrations) { try { db.exec(sql); } catch {} }
