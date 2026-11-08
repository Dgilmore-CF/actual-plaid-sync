# Troubleshooting

See the README for the complete diagnostics and safe reconciliation procedure.

## Health and readiness

- `/health` checks the web process and reports the application version.
- `/ready` checks connectivity to the configured Actual server and budget.
- A healthy process with failed readiness usually indicates Actual server, network, budget, or credential configuration. Do not print credentials while diagnosing.

## Synchronization

- An Item without an enabled, approved mapping to an Actual account is intentionally excluded. The dashboard says **Excluded from automatic synchronization**; such an Item must not create a run or call Plaid.
- Inspect the run phase and sanitized Item error. An unfinished historical run is marked finished at startup with `Interrupted by restart or shutdown`.
- Webhooks are deduplicated and signature-verified. Check the registered path, HTTPS proxy, preserved request body, and signature headers; do not turn verification off.
- Repeated no-change syncs must not create transactions. If a transaction appears twice, stop corrective edits and inspect imported IDs and review records first.

## Reconciliation and reviews

- Compare Plaid current with Actual cleared, then inspect pending and projected amounts separately.
- Check history readiness, Starting Balance count, duplicate imported IDs, lifecycle reviews, and recent added/modified/removed totals.
- A timing difference is not a reason to edit Starting Balance. Recalculation is available only when every guard passes and an explicit preview/confirmation succeeds.
- Posted transaction removals remain in review. Never delete a posted transaction automatically.
- The default review count includes only open Production reviews. Historical environment-unknown records are available under Legacy and test until explicitly classified or archived.
- Archival requires `ARCHIVE LEGACY REVIEWS` and retains records.

## ARM64 and container

On `pi01`, verify the pulled release image reports `arm64 linux`. If a pull fails, verify the immutable tag and GHCR package access. Do not replace named volumes or use a Windows `node_modules` directory in the Linux image.

If an Actual backup or Docker volume restore is needed, stop and follow the approved backup/restore procedure. Never delete `actual-budget-data` or `actual-plaid-data` as a troubleshooting shortcut.
