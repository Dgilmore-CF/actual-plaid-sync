## Summary

Describe the user-visible and operational changes.

## Tracking issues

Closes/fixes: #23
Additional issues:

## Financial-data safety review

- [ ] Uses integer cents for balance math.
- [ ] Does not automatically edit a Starting Balance.
- [ ] Does not automatically delete a posted transaction.
- [ ] Preserves user categories and notes during lifecycle replacement.
- [ ] Creates backups before corrective Actual ledger changes.
- [ ] Does not include secrets, full account IDs, or production data in code, tests, or logs.

## Database and migration

Describe additive schema changes, startup repair behavior, and rollback compatibility.

## Tests and security

- [ ] `npm ci`
- [ ] `npm run ci`
- [ ] `npm audit --omit=dev --audit-level=high`
- [ ] Security scan reviewed
- [ ] ARM64 container build reviewed

## Production validation plan

List read-only checks and explicit operator-confirmed changes. Do not claim deployment validation before it occurs.

## Release assets

- [ ] ZIP excludes `.env` and `node_modules`.
- [ ] SHA-256 verified.
- [ ] Git bundle verified.
