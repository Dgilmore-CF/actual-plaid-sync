# Actual Plaid Sync 0.2.0 RC4

RC4 reconciles Plaid's real-time current balance against Actual's cleared balance and reports pending net and projected balance separately. It preserves all RC3 lifecycle, review, duplicate prevention, OAuth state, webhook, and persistence safeguards.

Keep `PLAID_ENV=sandbox` until the RC4 qualification gates in `docs/RC4-PRODUCTION-PATH.md` pass.

Target image: `ghcr.io/dgilmore-cf/actual-plaid-sync:0.2.0-rc.4`
