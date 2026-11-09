# Operations runbook

`README.md` is the primary repository documentation. Use this checklist with the approved release issue and deployment plan.

## Pre-deployment

1. Confirm the release PR and immutable tag are correct and all required CI, security, container, and release-asset checks passed.
2. Verify the ARM64 image architecture on the target host without changing the running stack.
3. Export the Actual budget and back up both named Docker volumes. Verify the backups and save the current Portainer Stack definition.
4. Compare existing and proposed Stack configuration without printing secret values. Confirm the only intended application change is the image tag.
5. Obtain immediate Production deployment confirmation before applying a Stack update or allowing startup migrations to touch the live volume.

## Post-deployment validation

1. Check `/health` and `/ready`.
2. Confirm inactive Items show **Excluded from automatic synchronization** and generate no runs.
3. Confirm active sync runs complete with a phase, timestamp, and no unfinished row.
4. Review sanitized reconciliation diagnostics, lifecycle reviews, imported-ID duplicates, category assignments, and Starting Balance counts.
5. For an Item that needs credentials refreshed, use its **Reconnect with Plaid** action in Update mode. Confirm the Item ID and mappings remain unchanged, the audit event completes, then run that Item's sync.
6. Run two no-change syncs and check that no duplicate Actual transaction appears.
7. Validate the scheduled sync and a signed Plaid webhook.
8. Preserve the prior image tag and backups until validation is complete.
9. Comment on the release issue with root cause, modules, migration, tests, Production results, date, and remaining limitations. Close only after Production validation passes.

Never edit a posted transaction, delete ledger data, alter a Starting Balance, restore a volume, or change credentials as an unapproved troubleshooting step.
