# Actual Plaid Sync 0.2.3

Release 0.2.3 focuses on safe Item scheduling, per-Item sync coordination, lifecycle review, reconciliation diagnostics, interrupted-run repair, and release automation.

## Changes

- Schedule and manually sync only Items with an enabled, initially approved mapping to an Actual account.
- Start every account's initial preview/import from the beginning of available Item history, independent of a saved incremental cursor.
- Coalesce webhook sync requests per Item while permitting unrelated Items to progress independently.
- Match likely pending predecessors deterministically; hold ambiguous or already-imported posted transactions for review.
- Preserve Actual categories and notes on pending-to-posted replacement and repair Plaid-to-Actual identity mappings.
- Add review environment/source classification, non-destructive archival, and resolution audit history.
- Record sync progress phases and close interrupted runs on startup; wait for active runs before Actual API shutdown.
- Add structured reconciliation investigation, sanitized mismatch JSON, and guarded Starting Balance preview/apply.
- Expand the dashboard, documentation, issue templates, and release workflows.
- Produce source ZIP, SHA-256, Git bundle, and multi-architecture container from the immutable release tag.

## Data safety

Migrations are additive. Existing reviews with unknown historical environment are retained as legacy/unknown and are not counted as Production until explicitly classified. No Production transaction, credential, Item, or volume is changed by this release note or by development tests. Corrective actions require backup-first behavior and explicit confirmation. Posted transaction deletion is never automatic.

## Validation

See issue #23 and the release workflow for CI, security scan, package/version verification, asset verification, and container publication. Production deployment and validation results must be recorded after the operator-approved deployment; do not infer success from a merged PR or published tag.
