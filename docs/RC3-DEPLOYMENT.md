# RC3 deployment and qualification

1. Verify ZIP checksum.
2. Extract to a temporary folder.
3. Create branch `release/0.2.0-rc.3` from current `main`.
4. Copy all files except `.git` and `node_modules` over the clone.
5. Run `npm ci`, `npm run ci`, and `npm audit --omit=dev --audit-level=high`.
6. Review the diff and confirm no secrets are staged.
7. Make one consolidated commit: `feat: complete RC3 production safeguards`.
8. Push, open one PR, and require CI and Security to pass.
9. Merge, tag `v0.2.0-rc.3`, and require the Container workflow to pass.
10. Back up `actual-plaid-data` and `actual-budget-data`.
11. Deploy RC3 in Sandbox without changing variables or volumes.
12. Confirm health, readiness, current mappings, the $500 Dynamic account, and existing transactions.
13. Run two no-change syncs and require zero duplicates and reconciliation difference zero.
14. Use Refresh Plaid, wait, then Sync now. Require only new changes and zero reconciliation difference.
15. Verify pending-to-posted replacement, removed pending deletion, and posted removal review controls.
16. Attempt the same institution/account again and require duplicate rejection.
17. Require direct `/oauth-return` without a valid state cookie to return HTTP 400.
18. Complete one valid Sandbox Link flow and require the callback to succeed only once.
19. Require unsigned public webhooks to return 401 and valid Plaid webhooks to return 200.
20. Tag final `v0.2.0` only after every Sandbox gate passes.
