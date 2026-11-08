# Configuration

The README is the primary configuration and deployment reference. This page summarizes the environment consumed by the service; values must be supplied through protected Portainer settings, never committed or printed.

| Variable | Required | Description |
|---|---:|---|
| `APP_URL` | Yes | Public HTTPS URL for Plaid redirect and webhook URLs. |
| `PORT` | No | HTTP port, default `3000`. |
| `ADMIN_TOKEN` | Yes | Administrative API credential. |
| `SESSION_SECRET` | Yes | Session/OAuth-related secret. |
| `TOKEN_ENCRYPTION_KEY` | Yes | 64 hexadecimal characters for AES-256-GCM encryption of Plaid access tokens. |
| `PLAID_ENV` | Yes in deployment | `sandbox` or `production`. Any value other than `production` selects Sandbox. |
| `PLAID_CLIENT_ID` | Yes | Plaid application identifier. |
| `PLAID_SECRET` | Yes | Plaid credential; store its value only in protected secret storage. |
| `PLAID_COUNTRY_CODES` | No | Comma-separated country codes; defaults to `US`. |
| `ACTUAL_SERVER_URL` | Yes | Actual server URL reachable from the container. |
| `ACTUAL_SERVER_PASSWORD` | Yes | Actual server credential. |
| `ACTUAL_BUDGET_ID` | Yes | Actual Sync ID for the budget. |
| `ACTUAL_BUDGET_PASSWORD` | No | Budget encryption password, if configured. |
| `DATA_DIR` | No | Persistent data directory; defaults to `/data`. |
| `SYNC_INTERVAL_MINUTES` | No | Scheduled interval; default 240 and minimum 15. |
| `IMPORT_DAYS` | No | Requested initial history; default 90 and bounded from 1 to 730 days. |

`compose.portainer.yml` wires protected variables to the container and mounts the named `actual-plaid-data` volume at `/data`. Preserve the existing Actual and companion volume names during upgrades. See [README deployment guidance](../README.md#docker-and-portainer-deployment).
