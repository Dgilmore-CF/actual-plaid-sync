# Actual Plaid Sync 0.2.0

Release-candidate implementation for mapping Plaid accounts to Actual Budget accounts, previewing and approving initial imports, backing up the budget, persisting sync cursors, queuing risky removals for review, and verifying Plaid webhook JWT signatures.

**Do not connect real accounts until every gate in `docs/PRODUCTION-RUNBOOK.md` passes in Sandbox.**

Target image: `ghcr.io/dgilmore-cf/actual-plaid-sync:0.2.0`
