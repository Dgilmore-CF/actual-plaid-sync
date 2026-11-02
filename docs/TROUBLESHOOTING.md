# Troubleshooting

- `/health` tests the web process.
- `/ready` tests connectivity to the configured Actual budget.
- If GHCR pull fails, verify package visibility and the image tag.
- If Cloudflare returns 502, test `http://10.0.10.196:3000/health` from the Windows Tunnel machine.
- Never delete `actual-budget-data`.
