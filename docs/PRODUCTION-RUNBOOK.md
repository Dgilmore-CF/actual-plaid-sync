# Production release qualification

This runbook supplements the README for release 0.2.3. Production remains on its current immutable image until the release checks and explicit deployment gate are satisfied.

## Release checks

- Confirm issue #23 and any related issue numbers are referenced in the release PR.
- Run `npm ci`, `npm run ci`, and `npm audit --omit=dev --audit-level=high`.
- Require CI and Security success. Verify the release workflow validates version/tag agreement and creates, tests, and publishes the complete ZIP, SHA-256 file, and Git bundle.
- Verify the container includes ARM64 and matches the release version. Do not rewrite an existing tag or overwrite existing release assets.

## Backup and deployment gate

- Export an Actual budget backup and test it in a disposable budget.
- Back up `actual-budget-data` and `actual-plaid-data` and save the current Portainer Stack configuration.
- Confirm volume names and all secret references remain unchanged. Do not display or copy secret values into logs or reports.
- Immediately before a Portainer Stack update, explain the exact image and migration effects and obtain explicit Production confirmation.

## Acceptance validation

- Health and readiness return success.
- Inactive Items are excluded without Plaid calls, run rows, or Item error changes.
- Startup repairs unfinished runs; phases advance and active runs finalize on SIGTERM/SIGINT.
- Legacy/test reviews do not count as Production reviews; archival retains rows and leaves Production reviews unchanged.
- Pending-to-posted fallback preserves category and note, repairs the mapping, and leaves one Actual row and one imported ID.
- Chase Saffire remains reconciled; mismatches for other accounts are zero or explicitly explained by sanitized diagnostics.
- Two no-change syncs, scheduled sync, and signed webhook sync complete without duplicates; automatic categories remain assigned.

Record the deployment date and all results on issue #23. Do not close it until manual Production validation is complete. See [README](../README.md) for the recovery, rollback, and financial-data safety procedures.
