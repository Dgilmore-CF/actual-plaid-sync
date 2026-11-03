# Actual Plaid Sync 0.2.0 RC4

RC4 corrects reconciliation by comparing Plaid's real-time current balance from `/accounts/balance/get` with Actual's cleared balance, while presenting pending net activity and projected balance separately.

The existing transaction history, Starting Balance, mappings, cursors, encrypted tokens, and review state are preserved. No reimport or financial-data repair is performed.

Observed Sandbox regression fixture:

- Plaid current: $500.00
- Actual cleared: $500.00
- Actual pending net: -$908.81
- Actual projected: -$408.81
- Posted reconciliation difference: $0.00
- Status: reconciled-pending
