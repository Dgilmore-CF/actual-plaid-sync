# Actual Plaid Sync 0.2.0 RC3

Single-package release candidate adding:

- Post-sync Plaid/Actual balance refresh and reconciliation status
- Actual transaction ID tracking via stable imported IDs
- Pending-to-posted in-place replacement where the pending transaction is known
- Safe automatic deletion of removed pending authorizations
- Review queue for removed posted and unmatched replacement events
- Keep, Delete, and Resolve review actions
- Duplicate Item/account prevention using persistent account identity and conservative fallback matching
- Single-use, expiring OAuth callback state stored server-side and bound to an HttpOnly cookie
- On-demand Transactions Refresh from the management UI
- Visible request errors and reconciliation status
- Database migrations preserving existing RC2 data

RC3 must remain in Sandbox until all validation steps in `docs/RC3-DEPLOYMENT.md` pass.
