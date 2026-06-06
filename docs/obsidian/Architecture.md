---
title: Architecture
tags: [poolpilot/architecture]
created: 2026-06-06
---

# Architecture

Back to [[PoolPilot]].

## Data path
```
Browser ──HTTPS──▶ pool-web (Next.js)
                      │ (REST + socket.io)
                      ▼
                   pool-api (Fastify) ──TCP──▶ pool-guardian ──TCP──▶ ESP32 bridge ──RS-485──▶ SuperFlo VST pump
                      │                         (192.168.4.60:8899)
                      ▼
                   pool-db (TimescaleDB)
```

> [!note] The guardian hop is new
> Before the cutover, `pool-api` connected **directly** to `192.168.4.60:8899`. Now it connects to `pool-guardian` (same `:8899`), and the guardian relays to the ESP32. See [[Pump Guardian]] and [[Deployment & Cutover]].

## Repo layout (pnpm monorepo, `apps/*` + `packages/*`)
- `apps/web` — Next.js 16 + React 19, Tailwind v4, Zustand, socket.io-client. Mobile-first dashboard.
- `apps/api` — Fastify + socket.io. **Owns the bus / pump control loop.** Postgres for telemetry/schedules/settings.
- `apps/guardian` — `@pool/guardian`, the failover proxy. See [[Pump Guardian]].
- `packages/protocol` — Pentair RS‑485 codec (framing, checksum, command factories, status decode). Shared by api + guardian.
- `packages/types` — shared DTOs.

## Key backend pieces (`apps/api/src`)
- `bridge/connection.ts` — the single TCP connection to the bridge; parses frames, reconnects with backoff.
- `core/engine.ts` — the **control loop / keep-alive**. Re-asserts remote+run+setRpm every `KEEP_ALIVE_MS`.
- `core/scheduler.ts` — computes the scheduled RPM from enabled schedules; ticks every 30 s.
- `core/controlState.ts` — in-memory source of truth (mode: `schedule` | `manual` | `off`).
- `core/poller.ts` — periodic status requests (`POLL_MS`, default 1 s).
- `db/repos/telemetry.ts` — buffered batch writes to `telemetry_raw` (TimescaleDB hypertable). Energy stats query off this.
- `api/rest.ts` — REST routes incl. `/healthz`, `/api/energy/*`, `/api/control/*`.

## Hosting
- **Coolify** on the T630 orchestrates everything via Docker Compose, behind Traefik (Let's Encrypt TLS).
- Containers share the external Docker network **`coolify`**; Coolify names containers with a resource-UUID suffix (e.g. `pool-api-wocw…-191430…`).
- Cookie domain `.mght630.com` so the session cookie is shared between `pool.` and `poolapi.`.
- `pool-db` is a separate service (`restart: unless-stopped`) and is **not** rebuilt on app deploys.

## Env knobs (api)
| Var | Default | Notes |
|---|---|---|
| `BRIDGE_HOST` | `192.168.4.60` → **now `pool-guardian`** | env-flippable: `${BRIDGE_HOST:-192.168.4.60}` |
| `BRIDGE_PORT` | `8899` | |
| `PUMP_ADDRESS` | `96` (0x60) | |
| `POLL_MS` | `1000` | status poll cadence |
| `KEEP_ALIVE_MS` | `5000` | keep-alive cadence (≈ revert/3) |
| `RELEASE_ON_SHUTDOWN` | `false` | see [[Redeploy Problem & Fixes]] |
| `POOL_TZ` | `America/New_York` | schedules evaluated in local wall clock |
