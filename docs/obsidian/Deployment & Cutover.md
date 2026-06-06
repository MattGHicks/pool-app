---
title: Deployment & Cutover
tags: [poolpilot/deploy, poolpilot/guardian]
created: 2026-06-06
---

# Deployment & Cutover

Back to [[PoolPilot]]. Related: [[Pump Guardian]], [[Operations Runbook]].

## How deploys work
- Coolify watches `main`. A merge triggers a rebuild + redeploy of the app stack (build-then-swap). A full pool-api rebuild can leave it down for tens of seconds → why the [[Pump Guardian]] matters.
- `pool-db` is separate and untouched by app deploys.

## Compose files
- `docker-compose.yml` — pool-db + pool-api + pool-web. pool-api's bridge is **env-flippable**: `BRIDGE_HOST: ${BRIDGE_HOST:-192.168.4.60}` / `BRIDGE_PORT: ${BRIDGE_PORT:-8899}`.
- `docker-compose.guardian.yml` — **deploy as its own Coolify resource** (separate from the app stack). Joins the external `coolify` network with alias **`pool-guardian`**, publishes `8899` on the host.

## The guardian image (CI)
- Workflow `.github/workflows/guardian-image.yml` builds `apps/guardian/Dockerfile` and pushes **`ghcr.io/mattghicks/pool-app-guardian:latest`** (on guardian/protocol changes or manual dispatch).
- The image is **private** (private repo). Coolify pulls it because the host's Docker is logged into GHCR — see below.

### Private-image auth (one-time on the host)
1. GitHub → Settings → Developer settings → **Tokens (classic)** → new token, scope **`read:packages`** only.
2. Log the host's Docker into GHCR (token via stdin avoids the prompt):
   ```bash
   ssh matt@100.85.179.110 'printf %s "ghp_YOURTOKEN" | sudo docker login "$(printf ghcr.%s io)" -u MattGHicks --password-stdin'
   ```
   Want `Login Succeeded`. (`sudo` so the cred lands in root's Docker config, which Coolify uses.) Re-run if you ever rotate the token.

## How the guardian was actually deployed (Coolify UI)
New Resource → **Docker Compose** (raw) → paste an **image-based** compose (the raw editor can't `build:`):
```yaml
services:
  pool-guardian:
    image: ghcr.io/mattghicks/pool-app-guardian:latest
    restart: unless-stopped
    environment:
      UPSTREAM_HOST: 192.168.4.60
      UPSTREAM_PORT: 8899
      PUMP_ADDRESS: 96
      KEEP_ALIVE_MS: 5000
      FAILOVER_MAX_MS: 300000
    ports:
      - "8899:8899"
    networks:
      coolify:
        aliases:
          - pool-guardian
networks:
  coolify:
    external: true
```

## The cutover (ordered)
1. **Deploy the guardian** (above). Confirm logs: `pump-guardian listening` + `upstream (ESP32) connected`.
2. **Flip pool-api**: set env `BRIDGE_HOST=pool-guardian` (leave `BRIDGE_PORT=8899`), redeploy pool-api.
3. **Verify**: `/healthz` → `busConnected:true`; guardian log shows `app connected — relaying`.

> [!warning] The cutover redeploy is the LAST one covered only by the ~15 s hold
> The guardian can't bridge a gap it never observed. Every redeploy *after* cutover is fully guardian-protected.

## Gremlins we hit (so you don't relearn them)
> [!bug] Lessons learned
> - **Terminal auto-linking** wrapped URLs/domains in `< >` on paste (`<ghcr.io/…>`, `<github.com>`) → `invalid reference format` / shell redirect errors. Fix: **type** URL/domain values by hand, or assemble them at runtime (`$(printf ghcr.%s io)`).
> - **Typo** `BRIDGE_HOST=pool-gaurdian` → `getaddrinfo ENOTFOUND`. It's `pool-guardian` (g-u-a-r-d-i-a-n).
> - **Container names change every deploy** (UUID suffix), so `docker restart pool-api` fails — look it up dynamically (`docker ps | grep pool-api`).
> - Coolify keeps **no persistent repo checkout** in normal paths (builds in throwaway dirs) → can't build the guardian from a host clone; use the CI image instead.
> - `/healthz` via cached fetchers can read stale — append a cache-buster (`?cb=…`).
