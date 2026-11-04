# UI deployment and Sandbox cleanup

1. Back up Actual and the companion Docker volume.
2. Deploy `0.2.1-rc.1` without changing Production Plaid variables or volumes.
3. Confirm health, readiness, current mappings, and a no-change sync.
4. Open Maintenance.
5. Select Remove Sandbox accounts.
6. Type `REMOVE SANDBOX ACCOUNTS` exactly.
7. Confirm the output includes a backup path and the two removed account names.
8. Refresh Actual and confirm the two test accounts are absent.
9. Confirm Production accounts and balances are unchanged.
10. Run one Production sync and require zero duplicates and expected reconciliation status.
