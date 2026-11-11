# Actual Plaid Sync

Actual Plaid Sync imports Plaid transaction activity into an Actual Budget, keeps account mappings and Plaid cursors in a persistent companion database, and explains reconciliation differences without silently adjusting the ledger.

## Release status

Production remains configured for immutable release `0.2.4` (`ghcr.io/dgilmore-cf/actual-plaid-sync:0.2.4`); the companion is temporarily stopped while sync failures are investigated. Release `0.2.5` adds Plaid status checks and sanitized sync-failure diagnostics, but is not deployed to Production. Failed-run records include SQLite parameter-binding errors, but the exact statement and ledger effects are not yet established. Do not treat Plaid Item health as proof that transaction sync or reconciliation is healthy.

## Product and architecture

The application consists of:

- A Node.js 24 service with an Express API and static management dashboard.
- Plaid Link, Transactions Sync, account-balance lookups, and signed webhook validation.
- A local SQLite state database for Items, account mappings, cursors, imported-ID mappings, reviews, run history, and audit records.
- The official Actual API client, which connects to the configured Actual server and budget. Actual API calls are serialized to protect the client session.
- A Docker image built for Linux ARM64 and AMD64.

### Data flow

1. An administrator starts Plaid Link and exchanges the temporary public token.
2. Plaid accounts are stored as mappings. An operator maps each selected account to an Actual account and approves the initial import.
3. A scheduled run or verified webhook fetches Plaid transaction changes using the Item cursor.
4. Eligible added, modified, and removed transactions are processed using stable Plaid transaction identity. Risky lifecycle events go to review.
5. Actual is synchronized, Plaid balances are refreshed, and reconciliation details are recorded for the dashboard.

Webhook requests are signature-verified and deduplicated. A webhook during an active Item sync queues one follow-up; repeated requests collapse into that follow-up. Items without at least one enabled, approved mapping to an Actual account are excluded from automatic synchronization.

## Balance semantics

All calculations use integer cents. Plaid transaction amounts are converted to Actual's sign convention: a positive Plaid purchase is an outflow (negative Actual amount); a negative Plaid deposit is an inflow (positive Actual amount).

- **Depository accounts:** balances retain their positive/negative sign.
- **Credit cards and loans:** debt is represented as a negative amount owed. Do not reverse this sign when reconciling.
- **Plaid current/posted balance:** compared with Actual cleared transactions.
- **Actual pending:** the net of uncleared Actual transactions.
- **Actual projected:** cleared plus pending. It is diagnostic and is not interchangeable with the cleared balance.
- **Posted difference:** Plaid current balance minus Actual cleared balance.
- **Remaining difference after pending:** Plaid current balance minus Actual projected balance.

The dashboard distinguishes Reconciled, Reconciled with pending activity, Timing difference, Review required, History incomplete, Ledger inconsistency, and External API unavailable. A mismatch is reported, not repaired automatically. Starting Balance changes require a guarded preview, an explicit phrase, and an Actual backup.

## Transaction identity and lifecycle

Imported transactions use `plaid:<transaction_id>` as their Actual imported ID; the SQLite `tx_map` connects Plaid identity to the Actual transaction. Repeated syncs must not create duplicates.

When Plaid supplies a pending predecessor ID, the service updates that Actual row in place. If that ID is unavailable, it scores eligible pending transactions in the same account by amount, normalized merchant, date, and pending state. Only a uniquely high-confidence match is automatic. An ambiguous match is held for review; the posted transaction is not imported until the operator chooses an action.

Replacing a pending transaction preserves its existing Actual category and notes, updates its amount/date/payee/cleared state/imported ID, repairs the mapping, and records an audit. Review actions are audited. Posted Plaid removals are never deleted automatically. Explicit deletion actions show the account, payee, date, and amount and create a backup first.

## Initial import and missing-history recovery

Map an account, preview the Plaid history and calculated Starting Balance, verify zero initial reconciliation difference, then explicitly approve. Approval creates an Actual backup before adding the Starting Balance and imported transactions.

Use **Check history** to inspect availability. **Recover missing history** imports only Plaid transactions whose stable imported IDs are absent from Actual, creates a backup, and updates the existing Starting Balance. It is an operator-started corrective action; it is not run by the scheduler.

## Automatic categories

New imports use Plaid Personal Finance Category data to assign an Actual category in the `Plaid Auto Categories` group. Existing transactions can be backfilled from Plaid history. Backfill creates a backup first and updates only category assignments for transactions matched by imported ID. User category changes and notes are preserved by lifecycle replacement.

## Review queue

The default review count includes only open Production reviews. Filters provide Production open, Needs match, Removed posted, Legacy and test, Resolved, and All. Existing records whose environment cannot be established are classified as legacy/unknown; do not infer Production or Sandbox based only on merchant or amount.

Legacy/test archival requires the exact phrase `ARCHIVE LEGACY REVIEWS`. Archival preserves every row and records the action; it deletes nothing. Classify an unknown review as Production or Sandbox only after checking its source Item and transaction evidence.

## Reconciliation and investigation

For each mapped account, the diagnostic includes Plaid current/available amounts, Actual cleared/pending/projected amounts, posted and remaining differences, transaction and Starting Balance counts, duplicate imported-ID count, open lifecycle-review count, recent added/modified/removed counts, history readiness, and the last Item error. The **Investigate mismatch** action and `/api/investigation/<Plaid-account-ID>` provide sanitized JSON with identifier suffixes rather than full account IDs. Protect the authenticated API as sensitive financial data even when output is sanitized.

Reconciliation statuses explain evidence; they do not change Actual transactions. A Starting Balance recalculation is enabled only if history is ready, there is exactly one Starting Balance, imported IDs are unique, no unresolved pending-to-posted or removed-posted reviews remain, Actual's transaction sum matches its API balance, and no sync is active. Preview shows current/proposed amount, adjustment, before/after balance, and the backup path. Applying requires `RECALCULATE STARTING BALANCE`, creates the backup first, and changes only the existing Starting Balance.

## Synchronization schedule and webhooks

`SYNC_INTERVAL_MINUTES` sets the schedule; the service enforces a minimum of 15 minutes and defaults to 240. Only Items with an enabled mapping, completed initial import, and non-null Actual account ID are eligible. The connection dashboard labels all other Items **Excluded from automatic synchronization**.

Plaid must be configured with the public webhook URL ending in `/webhooks/plaid`. The endpoint validates Plaid's ES256 verification JWT and request-body hash before accepting an event. Webhooks are not a substitute for the scheduled reconciliation run.

## OAuth and security model

- The OAuth return uses short-lived, single-use state stored as a hash and bound to an HttpOnly, Secure, SameSite cookie.
- Plaid access tokens are encrypted at rest with AES-256-GCM using the configured token-encryption key.
- The administrative API requires the administrator token and is rate-limited. Protect the management hostname with an authenticated proxy or equivalent access control.
- Webhooks are public only because Plaid signs them; signature verification is mandatory.
- Secrets belong in Portainer's protected environment/secret settings. Never commit `.env`, print secret values, include them in logs, or put them in issue reports.
- The container uses a non-root user, a read-only root filesystem, dropped Linux capabilities, and a persistent data volume.
- Backups contain financial data. Restrict access and retention accordingly.

## Configuration

Provide configuration through the deployment environment; `.env.example` contains names and non-secret examples only.

| Variable | Purpose |
|---|---|
| `APP_URL` | Public application URL used for Plaid OAuth and webhooks. |
| `PORT` | HTTP listener port; defaults to 3000. |
| `ADMIN_TOKEN` | Administrator API credential. |
| `SESSION_SECRET` | Session/OAuth-related application secret. |
| `TOKEN_ENCRYPTION_KEY` | 64 hexadecimal characters used for AES-256-GCM token encryption. |
| `PLAID_ENV` | `sandbox` or `production`; defaults to Sandbox when not set to Production. |
| `PLAID_CLIENT_ID` and `PLAID_SECRET` | Plaid application credentials; store values only in protected deployment settings. |
| `PLAID_COUNTRY_CODES` | Comma-separated Plaid country codes; defaults to `US`. |
| `ACTUAL_SERVER_URL` | URL of the Actual server reachable from the container. |
| `ACTUAL_SERVER_PASSWORD` | Actual server credential. |
| `ACTUAL_BUDGET_ID` | Actual Sync ID for the selected budget. |
| `ACTUAL_BUDGET_PASSWORD` | Optional budget encryption password. |
| `DATA_DIR` | Persistent companion data path; defaults to `/data`. |
| `SYNC_INTERVAL_MINUTES` | Scheduled sync interval, minimum 15 minutes, default 240. |
| `IMPORT_DAYS` | Requested initial Plaid history, bounded to 1-730 days, default 90. |

## Reconnecting an existing Plaid Item

In **Connections**, use **Reconnect with Plaid** on the existing institution when Plaid reports that its credentials need attention. This opens Plaid Link in Update mode for that Item. Complete the bank's sign-in and any MFA steps in Plaid Link; do not enter bank credentials in chat or support logs. The app verifies that Plaid reports the same Item as healthy before marking the reconnect complete. Update mode keeps the existing Item ID, encrypted access token, account mappings, and Actual transactions; it does not create a new Item or exchange a new access token. Non-secret started/completed/cancelled/failed reconnect states and timestamps are audited. After Link reports success, use **Sync Item** to verify access; only a successful sync clears the prior sync error.

**Add institution** is only for a genuinely new connection. Do not use it to reconnect an existing institution; duplicate Items are blocked.

## Docker and Portainer deployment

The production Compose file is `compose.portainer.yml`. It keeps Actual and the companion as separate services and uses the named volumes `actual-budget-data` and `actual-plaid-data`. Preserve both volume names and all existing protected environment values when upgrading. The companion listens on container port 3000; the Actual API is reached over the Compose network.

In Portainer:

1. Export the current Stack configuration and create verified backups of the Actual budget and both named Docker volumes.
2. Review the release PR, tag workflow, container architecture, and release assets.
3. Change only the companion image tag to the approved immutable release tag; do not alter Plaid credentials, budget IDs, or volume names.
4. Deploy only after the explicit Production deployment approval and verify `/health`, `/ready`, dashboard status, scheduled sync, and signed webhook behavior.

### ARM64 notes

The release container is built for `linux/arm64` (and `linux/amd64`). On the Raspberry Pi, verify the pulled image reports `arm64 linux` before deployment. Native SQLite/Actual dependencies are installed in the image build; do not copy a Windows `node_modules` directory into the container.

## Backup and restore

Before deployment or any corrective financial-data operation:

1. Export an Actual budget backup and verify it can be opened/restored in a disposable budget.
2. Back up `actual-budget-data` and `actual-plaid-data` to protected storage. Do not overwrite the only known-good backup.
3. Record the release image and Stack configuration separately from the data backup.
4. Verify backup timestamps, file sizes, and restore procedure before proceeding.

The application creates an Actual backup before initial import, category backfill, missing-history recovery, pending replacement, pending deletion, manual review deletion, and Starting Balance recalculation. Application-generated backups reside under the companion data directory's `backups` folder.

## Upgrade and rollback

Upgrades use immutable Git tags and container tags. Review the release notes, asset checksum, Git bundle, and migration diff first. Additive SQLite migrations run at application startup and repair unfinished sync runs; therefore deploying a new image is a Production database operation and must be explicitly approved after backups are verified.

Rollback means restoring the prior immutable image tag and, only if necessary, restoring verified volume backups under an approved recovery plan. Do not roll back by rewriting a Git tag or deleting volumes. A database migration may leave the schema at a newer additive version; confirm backward compatibility before rolling back the application image.

## Diagnostics and troubleshooting

- `/health` reports process health and version; `/ready` checks Actual API availability.
- Review the dashboard's Item eligibility, run phase, last error, mismatch investigation, and review filters.
- On Connections, use **Check Plaid status** for an explicit per-Item check. **Healthy** means Plaid did not report an Item error at check time; it does not certify transaction sync or reconciliation. Use **Reconnect with Plaid** only when the check says **Reconnect needed**. **Status unavailable** is not a reason to reconnect.
- Inactive Items are expected to show **Excluded from automatic synchronization** and must not create runs or call Plaid.
- An unfinished run is repaired at startup with the interruption reason; inspect run phases if it recurs.
- If Actual is unavailable, check Actual container health and the Compose network before changing Plaid configuration.
- If Plaid webhooks are rejected, verify the registered URL, proxy path, request body preservation, and Plaid signature headers. Do not disable verification.
- If reconciliation differs, inspect posted, pending, projected, history readiness, duplicate IDs, lifecycle reviews, and recent run counts. Do not edit a Starting Balance or delete a posted transaction just to silence a mismatch.
- For all data anomalies, create an issue with sanitized diagnostics. Do not attach secrets, access tokens, or full account identifiers.

See [Configuration](docs/CONFIGURATION.md), [Security](docs/SECURITY.md), [Troubleshooting](docs/TROUBLESHOOTING.md), and [Upgrade guidance](docs/UPGRADING.md).

## GitHub issue policy

Every defect, enhancement, operational follow-up, and deferred roadmap item has a GitHub issue. Issue reports include observed/expected behavior, evidence, financial-data safety impact, acceptance criteria, and release target; they must never include secrets or full account identifiers. Resolve and close a release issue only after manual Production validation succeeds. The 0.2.3 work is tracked by [#23](https://github.com/Dgilmore-CF/actual-plaid-sync/issues/23); the stylesheet cleanup by [#25](https://github.com/Dgilmore-CF/actual-plaid-sync/issues/25); the multi-account initial-history fix by [#34](https://github.com/Dgilmore-CF/actual-plaid-sync/issues/34); the 0.2.3 release-workflow recovery by [#37](https://github.com/Dgilmore-CF/actual-plaid-sync/issues/37); and Plaid Item reconnection by [#20](https://github.com/Dgilmore-CF/actual-plaid-sync/issues/20).

## Development workflow

Requirements: Node.js 24 or later and npm. Work from the checked-out repository, use a release branch from current `main`, keep changes focused, add regression tests, inspect the complete diff, and do not commit secrets or production data.

```powershell
npm ci
npm run ci
npm audit --omit=dev --audit-level=high
git status --short
```

CI runs syntax checks, Node tests, and the production dependency audit. Security scanning and ARM64 container builds run through GitHub Actions. Do not deploy from an unreviewed local working tree.

## Release lifecycle

1. Verify the 0.2.5 release issue and related sync-diagnosis work; implement on a release branch from current `main`.
2. Run `npm ci`, `npm run ci`, and `npm audit --omit=dev --audit-level=high`; review the complete diff and security scan.
3. Open a PR referencing #20 and any additional issues. Require CI and Security checks.
4. Merge only after review. Create the new immutable `v0.2.5` tag only once; never force-push or rewrite published tags.
5. The tag workflow validates package/tag version, tests and scans source, creates and verifies the ZIP, SHA-256 file, and Git bundle, attaches them to the GitHub Release, and publishes ARM64/AMD64 images.
6. Verify backups and the ARM64 image. Request explicit Production deployment approval, then validate health, reconciliation, two no-change syncs, scheduler, and signed webhook behavior.
7. Record root cause, modules, migrations, tests, Production results, deployment date, and limitations on the issue. Close it only after Production validation.

## Roadmap

Each item has its own issue and is not promised for 0.2.5:

- Investment transaction support [#16]
- Optional posted-removal policies [#17]
- Mobile dashboard improvements [#18]
- Multi-currency conversion [#19]
- Expanded liability details [#21]
- Exportable audit reports [#22]
- Safe bulk review workflows [#24]
- Cross-account transfer pairing [#26]
- Merchant-learning rules [#27]
- Automated backup retention [#28]
- Advanced metrics and observability [#29]
- Historical reconciliation snapshots [#30]
- Multiple Actual budgets [#31]
- Split transactions [#32]
- Email, Teams, or generic webhook notifications [#33]

## License

This project is licensed under the [MIT License](LICENSE).
