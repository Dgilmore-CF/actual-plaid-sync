# Actual Plaid Sync

Self-hosted Plaid transaction synchronization for the unmodified official Actual Budget server using `@actual-app/api`.

> Version 0.1.0 is a release candidate. Validate with Plaid Sandbox and a disposable budget before connecting a Production Item.

## Target

- Raspberry Pi 4, ARM64
- Actual: `actualbudget/actual-server:latest`
- Companion: `ghcr.io/dgilmore-cf/actual-plaid-sync:0.1.0`
- Portainer CE Stack
- `https://plaid.dtg-lab.net`

Read `docs/RUNBOOK.md` before deployment.
