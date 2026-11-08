# Repository instructions for coding assistants

- Treat the checked-out Git repository and GitHub remote as the authoritative source. Read the relevant current files before editing.
- Do not print or commit secrets, access tokens, passwords, full Plaid account IDs, or full Actual account UUIDs. Use sanitized fixtures.
- Never modify Production volumes, credentials, Items, mappings, or budget data during development.
- Use integer cents for all financial calculations.
- Do not automatically change a Starting Balance or delete a posted transaction.
- Preserve user categories and notes during pending-to-posted replacement.
- Create and verify an Actual backup before corrective financial-data changes.
- Add regression tests and update the primary README when behavior or operations change.
- Keep migrations additive, idempotent, and safe for existing SQLite state.
- Keep Actual API operations serialized; per-Item Plaid synchronization must not duplicate lifecycle work.
- Run `npm ci`, `npm run ci`, and `npm audit --omit=dev --audit-level=high` before proposing completion.
- Do not deploy or execute a destructive Production action without explaining the exact effect and obtaining immediate confirmation.
- Git tags and release assets are immutable. Never force-push or rewrite a published tag.
