# Actual Plaid Sync 0.2.0 RC3

RC3 adds post-sync reconciliation, balance refresh, transaction identity backfill, pending-to-posted replacement, safe removed-transaction review controls, duplicate connection prevention, single-use OAuth callback state, signed webhook verification, and on-demand Plaid refresh.

Keep `PLAID_ENV=sandbox` until every gate in `docs/RC3-DEPLOYMENT.md` passes.

Target image: `ghcr.io/dgilmore-cf/actual-plaid-sync:0.2.0-rc.3`
