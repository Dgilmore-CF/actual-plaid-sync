# Deployment runbook

## 1. Push from Windows

Extract the archive, enter the repository, and run:

```powershell
git remote remove origin 2>$null
git remote add origin "https://github.com/Dgilmore-CF/actual-plaid-sync.git"
git branch -M main
git push -u origin main
git push origin v0.1.0
```

Wait for CI, Security, and Container workflows. Make the GHCR package public.

## 2. Verify ARM64 image

```powershell
ssh pi01 "docker pull ghcr.io/dgilmore-cf/actual-plaid-sync:0.1.0"
ssh pi01 "docker image inspect ghcr.io/dgilmore-cf/actual-plaid-sync:0.1.0 --format '{{.Architecture}} {{.Os}}'"
```

Expected: `arm64 linux`.

## 3. Create an Actual budget

Open `https://actual.dtg-lab.net`, create a USD budget, and record its Sync ID. Keep budget encryption disabled during initial validation.

## 4. Generate secrets on pi01

```powershell
ssh pi01 "openssl rand -hex 32"
ssh pi01 "openssl rand -base64 48"
ssh pi01 "openssl rand -base64 48"
```

Store the outputs as token encryption key, administrator token, and session secret.

## 5. Configure Cloudflare

Add `plaid.dtg-lab.net` to the existing Tunnel with origin `http://10.0.10.196:3000`. Protect the hostname with Access. Bypass Access only for `/webhooks/plaid` and `/oauth-return`.

## 6. Configure Plaid

Register `https://plaid.dtg-lab.net/oauth-return`. Start in Sandbox.

## 7. Portainer

Open the existing Actual Stack, save its current YAML, then replace it with `compose.portainer.yml`. Add these Stack variables:

- `ACTUAL_SERVER_PASSWORD`
- `ACTUAL_BUDGET_ID`
- `ACTUAL_BUDGET_PASSWORD` (empty initially)
- `PLAID_ENV` = `sandbox`
- `PLAID_CLIENT_ID`
- `PLAID_SECRET` = Sandbox Secret
- `PLAID_ADMIN_TOKEN`
- `PLAID_SESSION_SECRET`
- `PLAID_TOKEN_ENCRYPTION_KEY`

Update the Stack with image re-pull enabled.

## 8. Validate

```powershell
ssh pi01 "curl -fsS http://10.0.10.196:3000/health"
ssh pi01 "curl -fsS http://10.0.10.196:3000/ready"
```

Open `https://plaid.dtg-lab.net`, connect a Sandbox institution, map an account, and sync twice. Confirm no duplicates in Actual.

## 9. Promote to Production

In Portainer change `PLAID_ENV` to `production` and provide the Production Secret. Connect one institution and one account first.
