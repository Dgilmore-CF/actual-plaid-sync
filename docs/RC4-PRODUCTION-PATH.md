# RC4 to Production

1. Verify package checksum.
2. Copy the complete package to one branch `release/0.2.0-rc.4`.
3. Run `npm ci`, `npm run ci`, and `npm audit --omit=dev --audit-level=high`.
4. Make one consolidated commit, one PR, and require CI and Security.
5. Tag `v0.2.0-rc.4`, build ARM64, and back up both Docker volumes.
6. Deploy RC4 in Sandbox without changing variables or volumes.
7. Run one no-change sync. Require Plaid current 50000, Actual cleared 50000, pending -90881, projected -40881, posted difference 0, status reconciled-pending.
8. Run a second sync and require no duplicates.
9. Complete pending-to-posted, review, duplicate Item, OAuth state, webhook, and restart tests inherited from RC3.
10. Tag final `v0.2.0` only after all Sandbox gates pass.
11. Deploy final `0.2.0` in Sandbox for one final no-change sync.
12. Export Actual and back up both Docker volumes.
13. Change only `PLAID_ENV=production` and `PLAID_SECRET=<Production Secret>`.
14. Connect one institution and one checking account.
15. Preview and require zero posted reconciliation difference before approval.
16. Approve, audit every transaction, run two no-change syncs, then observe one scheduled and one webhook-driven sync before expanding.
