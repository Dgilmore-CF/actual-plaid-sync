# Upgrading and rollback

The README is the primary source for upgrade and rollback procedures.

1. Review the release PR, immutable tag, test/security results, ARM64 image, migration diff, and verified release assets.
2. Export and verify an Actual budget backup. Back up both `actual-budget-data` and `actual-plaid-data` to protected storage and record the current Portainer Stack configuration.
3. Treat application startup migrations as a Production database change. Obtain explicit approval immediately before deployment.
4. In Portainer, update only the companion image tag. Keep the Actual image, secret values, budget selection, and volume names unchanged.
5. Verify `/health`, `/ready`, Item eligibility, run completion, review count, account reconciliation, a no-change sync, and signed webhook behavior.

Rollback uses the previous immutable image tag. Never rewrite or force-push a tag. SQLite migrations are additive; check backward compatibility before reverting an image. Restore a volume only under an approved recovery plan and only from a verified backup. Never remove the production volumes as part of rollback.
