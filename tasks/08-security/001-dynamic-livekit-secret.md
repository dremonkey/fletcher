---
status: pending
---

# Task: Generate LiveKit API secret at setup time

## Problem
The LiveKit API secret is currently hardcoded in `livekit.yaml` and committed to the repo. This is a security concern — even for dev environments, shared secrets in version control are bad practice. LiveKit now enforces a 32-character minimum, which already forced a manual secret rotation.

## Goal
Generate a unique, random API secret during initial project setup (e.g., `nix develop`, bootstrap script, or first `docker compose up`) so that:
- No secret is committed to `livekit.yaml`
- Each developer gets their own secret automatically
- The secret is consistent between `livekit.yaml` and `.env`

## Checklist
- [ ] Add `livekit.yaml` to `.gitignore` (or just the `keys:` section via a template)
- [ ] Create `livekit.yaml.template` with a placeholder (e.g., `__LIVEKIT_API_SECRET__`)
- [ ] Add a setup script (or extend `scripts/bootstrap.sh`) that:
  - Generates a random 32+ char secret if one doesn't exist
  - Renders `livekit.yaml` from the template
  - Writes matching `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` into `.env`
  - Is idempotent — skips generation if secret already exists
- [ ] Update `ensure-backend-ready.sh` to run the setup script if `livekit.yaml` is missing or has the placeholder
- [ ] Update any documentation referencing the old hardcoded secret
- [ ] Verify `docker compose up livekit` still works after the change

## Notes
- The API key (`devkey`) can stay hardcoded — it's just an identifier, not a secret.
- Consider using `head -c 32 /dev/urandom | base64` for generation (no openssl dependency).
- `scripts/generate-token.ts` already reads `LIVEKIT_API_SECRET` from `.env`, so token generation will work automatically once `.env` is correct.
