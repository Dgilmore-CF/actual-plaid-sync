const columns = (database, table) => new Set(
  database.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name),
);

function ensureColumn(database, table, name, declaration) {
  if (!columns(database, table).has(name)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`);
  }
}

export function migrateDatabase(database) {
  const migrations = [
    ['mappings', 'persistent_account_id', 'TEXT'],
    ['mappings', 'actual_balance_cents', 'INTEGER'],
    ['mappings', 'reconciliation_difference_cents', 'INTEGER'],
    ['mappings', 'reconciliation_status', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['mappings', 'balance_checked_at', 'TEXT'],
    ['review_queue', 'actual_transaction_id', 'TEXT'],
    ['review_queue', 'actual_account_id', 'TEXT'],
    ['review_queue', 'resolution', 'TEXT'],
    ['sync_runs', 'reconciliation_mismatches', 'INTEGER DEFAULT 0'],
    ['mappings', 'plaid_current_balance_cents', 'INTEGER'],
    ['mappings', 'plaid_available_balance_cents', 'INTEGER'],
    ['mappings', 'actual_cleared_balance_cents', 'INTEGER'],
    ['mappings', 'actual_pending_balance_cents', 'INTEGER'],
    ['mappings', 'actual_projected_balance_cents', 'INTEGER'],
    ['mappings', 'posted_reconciliation_difference_cents', 'INTEGER'],
    ['mappings', 'reconciliation_checked_at', 'TEXT'],
    ['mappings', 'reconciliation_error', 'TEXT'],
    ['mappings', 'reconciliation_explanation', 'TEXT'],
    ['review_queue', 'environment', 'TEXT'],
    ['review_queue', 'source_item_status', 'TEXT'],
    ['review_queue', 'archived_at', 'TEXT'],
    ['review_queue', 'archive_reason', 'TEXT'],
    ['sync_runs', 'last_progress_at', 'TEXT'],
    ['sync_runs', 'phase', 'TEXT'],
  ];
  for (const [table, name, declaration] of migrations) {
    ensureColumn(database, table, name, declaration);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS item_reconnect_events(
      reconnect_id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('started','completed','cancelled','failed')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      failure_code TEXT
    );
    CREATE TABLE IF NOT EXISTS review_resolutions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id INTEGER NOT NULL REFERENCES review_queue(id),
      action TEXT NOT NULL,
      details TEXT,
      resolved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS starting_balance_adjustments(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actual_account_id TEXT NOT NULL,
      current_cents INTEGER NOT NULL,
      proposed_cents INTEGER NOT NULL,
      adjustment_cents INTEGER NOT NULL,
      balance_before_cents INTEGER NOT NULL,
      balance_after_cents INTEGER NOT NULL,
      backup_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_review_queue_classification
      ON review_queue(environment, resolved_at, archived_at, reason);
    CREATE INDEX IF NOT EXISTS idx_item_reconnect_events_item_created
      ON item_reconnect_events(item_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sync_runs_unfinished
      ON sync_runs(finished_at, item_id);
    UPDATE review_queue
      SET environment = 'legacy_unknown', source_item_status = 'unknown'
      WHERE environment IS NULL OR source_item_status IS NULL;
    UPDATE sync_runs SET phase = 'complete'
      WHERE phase IS NULL AND finished_at IS NOT NULL;
  `);

  repairInterruptedRuns(database);
}

export function repairInterruptedRuns(database, now = new Date().toISOString()) {
  return database.prepare(`
    UPDATE sync_runs
    SET finished_at = ?,
        last_progress_at = ?,
        phase = 'interrupted',
        error = 'Interrupted by restart or shutdown'
    WHERE finished_at IS NULL
  `).run(now, now).changes;
}
