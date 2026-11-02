import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'state.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS items(item_id TEXT PRIMARY KEY,institution_id TEXT,institution_name TEXT NOT NULL,access_token_enc TEXT NOT NULL,cursor TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,last_sync_at TEXT,last_error TEXT);
CREATE TABLE IF NOT EXISTS mappings(plaid_account_id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,plaid_name TEXT NOT NULL,plaid_type TEXT,plaid_subtype TEXT,actual_account_id TEXT,actual_account_name TEXT,enabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sync_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,item_id TEXT,started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,finished_at TEXT,added INTEGER DEFAULT 0,modified INTEGER DEFAULT 0,removed INTEGER DEFAULT 0,error TEXT);
CREATE TABLE IF NOT EXISTS webhook_events(event_key TEXT PRIMARY KEY,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);
