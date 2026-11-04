# Actual Plaid Sync 0.2.1 RC1

## User experience redesign

- New responsive application shell with persistent navigation
- Overview dashboard with connection, mapping, reconciliation, and review summaries
- Dedicated Accounts, Review Queue, Activity, and Maintenance views
- Clear posted, pending, and projected balance language
- Accessible status badges, confirmation dialogs, error notices, empty states, and dark mode
- Safer explanations around imports, review actions, and Plaid refresh behavior

## Sandbox cleanup

- Adds a guarded Maintenance action that creates an Actual budget backup first
- Permanently deletes only the exact Actual account names `Plaid Sandbox Checking` and `Plaid Dynamic Checking`
- Requires the exact typed confirmation `REMOVE SANDBOX ACCOUNTS`
- Disables any matching companion mappings after removal
- Does not select or delete Production accounts

The cleanup action is intentionally narrow. Rename a Sandbox account back to its exact expected name before cleanup if it was renamed.
