# Security

Never commit `.env` or credentials. Protect the management hostname with Cloudflare Access. Store secrets in Portainer. Plaid access tokens are encrypted with AES-256-GCM. The container runs as an unprivileged user with a read-only root filesystem.
