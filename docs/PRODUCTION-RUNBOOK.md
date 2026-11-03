# Actual Plaid Sync 0.2.0 production qualification runbook

This runbook is intentionally gated. Do not skip a gate. Use PowerShell 7 on Windows. Keep `PLAID_ENV=sandbox` until Section 36.

## 1. Create the development branch
`git switch -c release/0.2.0`

## 2. Copy the 0.2.0 package over the working tree
Extract the supplied ZIP to a temporary folder, then copy all files except `.git` into `C:\Users\Derek Gilmore\source\actual-plaid-sync`.

## 3. Verify package version
`npm pkg get version` must return `"0.2.0"`.

## 4. Install exact dependencies
Run `npm ci`.

## 5. Run syntax and unit tests
Run `npm run ci`. All tests must pass.

## 6. Run dependency audit
Run `npm audit --omit=dev --audit-level=high`. High and critical count must be zero.

## 7. Review source changes
Run `git status --short` and `git diff --stat`. Confirm no `.env`, tokens, passwords, or downloaded Stack files are present.

## 8. Commit the release candidate
Run `git add -A`, then `git commit -m "feat: add account mapping and secure Plaid sync workflow"`.

## 9. Push and open a pull request
Push `release/0.2.0`, open a PR to `main`, and wait for CI and Security.

## 10. Perform code review
Review `src/server.js`, `src/sync.js`, `src/webhook.js`, database migrations, and the Portainer Compose diff.

## 11. Merge only after checks pass
Squash merge, switch to `main`, and pull.

## 12. Tag the release candidate
Create and push `v0.2.0-rc.1` first. Do not create final `v0.2.0` yet.

## 13. Build and publish multi-architecture image
Wait for the Container workflow and make sure GHCR exposes `0.2.0-rc.1` for both `linux/amd64` and `linux/arm64`.

## 14. Pull the RC onto pi01
Pull `ghcr.io/dgilmore-cf/actual-plaid-sync:0.2.0-rc.1` and verify `arm64 linux`.

## 15. Back up the current Portainer Stack
Save the current YAML to `G:\Downloads\actual-stack-before-0.2.0.yml`.

## 16. Back up Docker volumes
Back up `actual-budget-data` and `actual-plaid-data` to a protected location before updating the Stack.

## 17. Deploy the RC in Sandbox
Change only the companion image tag. Keep all existing secrets and `PLAID_ENV=sandbox`.

## 18. Verify health and readiness
`/health` and `/ready` must return HTTP 200.

## 19. Verify the clean-cache fix
Stop the companion, remove only `/data/actual-cache`, restart, and require `/ready` to return 200.

## 20. Connect one Sandbox institution
Use Plaid Sandbox Link and select one checking account.

## 21. Verify discovered account details
Confirm institution, name, mask, type, subtype, current balance, and available balance.

## 22. Create an Actual test account
Use the UI to create an on-budget Actual account from the Plaid account.

## 23. Preview initial import
Require transaction count, pending count, date range, current balance, calculated opening balance, and zero reconciliation difference.

## 24. Approve initial import
The application must create a budget export first. Approval must be explicit.

## 25. Verify Actual after initial import
Confirm balance, transaction signs, payees, dates, cleared state, and starting balance.

## 26. Run duplicate test
Run sync twice with no new Plaid changes. Actual transaction count must not increase.

## 27. Run pending test
Create a Sandbox pending transaction, sync, and verify it is uncleared.

## 28. Run pending-to-posted test
Post the Sandbox transaction. Confirm the review queue identifies the relationship and no unexplained duplicate remains.

## 29. Run modified transaction test
Modify a Sandbox transaction and verify the change is imported or queued for review according to policy.

## 30. Run removed transaction test
Remove a pending transaction and a posted transaction. Posted removals must be review items, not silent deletions.

## 31. Test signed webhooks
A valid Plaid JWT and body hash must return 200. Missing, invalid, expired, or body-mismatched signatures must return 401.

## 32. Test webhook idempotency
Send the same valid webhook twice. Only one event may be recorded and no duplicate import may occur.

## 33. Test restart persistence
Restart the companion and confirm Items, mappings, cursors, reviews, and encrypted tokens persist.

## 34. Test backup recovery
Restore the pre-import Actual export into a disposable budget and verify recovery.

## 35. Publish final 0.2.0
Only after Sections 18 through 34 pass, tag `v0.2.0`, wait for Container success, and update Portainer from the RC tag to `0.2.0`.

## 36. Configure public Cloudflare paths
Keep the management hostname protected. Add path-specific Access bypasses only for `/webhooks/plaid` and `/oauth-return` after signature and callback tests pass.

## 37. Switch to Plaid Production
In Portainer change `PLAID_ENV` to `production` and replace only `PLAID_SECRET` with the Production Secret. Preserve all encryption, session, Actual, and volume settings.

## 38. Connect one real institution
Use only one Trial Item and select one checking account first.

## 39. Preview the real initial import
Require zero reconciliation difference. Review every summary value before approval.

## 40. Approve and audit the real import
Review every imported transaction in Actual. Verify signs, balances, pending state, dates, and no duplicates.

## 41. Observe before expanding
Wait for a scheduled sync and a webhook-driven sync. Confirm no duplicates and stable reconciliation. Only then add more accounts or institutions one at a time.
