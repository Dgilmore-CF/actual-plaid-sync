# Actual Plaid Sync 0.2.4

Release 0.2.4 adds a safe way to reauthorize an existing Plaid Item.

## Changes

- Add a per-institution Reconnect action that launches Plaid Link in Update mode.
- Verify Plaid returns the same healthy Item before clearing its sync error.
- Preserve the existing Item ID, encrypted access token, account mappings, and Actual transactions.
- Keep new-institution linking separate from reconnecting an existing Item.

## Validation

Reconnect does not create a new Plaid Item or modify Actual transactions. After the user completes Link, run **Sync Item** and review the sanitized sync result before relying on the connection.
