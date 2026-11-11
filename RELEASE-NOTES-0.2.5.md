# Actual Plaid Sync 0.2.5

This release adds a manual Plaid connection-health check, a polished responsive dashboard, and safer sync-failure diagnostics. It does not claim that the observed Production sync failure has been fixed.

## Changes

- Add per-Item **Healthy**, **Reconnect needed**, and **Status unavailable** states on Connections.
- Show **Reconnect with Plaid** only after Plaid reports a known reauthentication error; keep Plaid health separate from transaction-sync and reconciliation health.
- Record the sync stage, sanitized error category/code/status, and allowlisted application source location for future failed runs. Do not persist raw exception messages.
- Preserve the last sync stage when startup repair marks a run interrupted, and record fetched Plaid change counts before processing begins.
- Add an uncaught-exception monitor that logs only sanitized error metadata.

The startup migration adds diagnostic columns to the companion SQLite database. It does not modify the Actual budget or ledger. A verified backup and explicit Production deployment approvals are required before applying this migration.

## Validation

Local CI passes with 93 tests. Production acceptance remains blocked: failed-run records show SQLite parameter-binding errors, but the exact failing statement and Actual-ledger effects are not established. Keep the companion stopped and do not run a sync until the cause and ledger state are understood.
