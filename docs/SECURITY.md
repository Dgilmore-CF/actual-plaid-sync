# Security

The README contains the full security model and deployment guidance.

- Never commit `.env`, credentials, access tokens, budget data, logs containing financial data, or production SQLite files.
- Supply secrets through protected Portainer settings. Do not print or copy secret values into issue reports, Actions logs, screenshots, or chat.
- Plaid access tokens are encrypted at rest using AES-256-GCM and the configured encryption key.
- The administrator API must remain behind an authenticated management path. Use HTTPS and a strong administrator token.
- Plaid webhooks are accepted only after ES256 JWT and body-hash verification. Do not disable verification to troubleshoot proxy failures.
- OAuth state is short-lived, single-use, hashed in SQLite, and bound to an HttpOnly, Secure, SameSite cookie.
- The container runs as a non-root user with a read-only root filesystem, no added capabilities, and a dedicated persistent data volume.
- Actual backups and volume backups contain sensitive financial information. Restrict access and test restores in a disposable budget.
- Diagnostic JSON uses identifier suffixes. Treat even sanitized financial data as confidential.
- Report vulnerabilities privately to the repository owner; do not publish exploitable secrets or account identifiers in an issue.
