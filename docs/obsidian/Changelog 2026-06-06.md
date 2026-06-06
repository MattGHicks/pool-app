---
title: Changelog 2026-06-06
tags: [poolpilot/history, changelog]
created: 2026-06-06
---

# Changelog — 2026-06-06

Back to [[PoolPilot]]. Branch: `claude/energy-reset-button-Y2E1A`. All PRs merged to `main`.

## Shipped
| PR | What |
|---|---|
| #1 | **Energy reset button** — coral "Reset energy stats" on the Energy page with a confirmation card; `POST /api/energy/reset` wipes `telemetry_raw` (+ in-memory buffer) and logs an `energy_reset` event. |
| #2 | **OG share images** (`opengraph-image.tsx` + `twitter-image.tsx` via `next/og`; `openGraph`/`twitter` metadata + `metadataBase`, default `https://pool.mght630.com`, override `NEXT_PUBLIC_SITE_URL`). **iOS notch fix** — `TopBar` top padding `max(0.75rem, env(safe-area-inset-top))`. **Seamless shutdown** — `RELEASE_ON_SHUTDOWN` (default false). |
| #3 | **Prime scheduler before engine start** — removes the boot release blip. |
| #4 | **pump-guardian** service (`apps/guardian`, `@pool/guardian`) — failover keep-alive proxy + unit + socket-level tests. |
| #5 | **Cutover prep** — `BRIDGE_HOST`/`BRIDGE_PORT` env-flippable; guardian gets stable `pool-guardian` alias on the `coolify` network. |
| #6 | **CI image** — `.github/workflows/guardian-image.yml` publishes `ghcr.io/mattghicks/pool-app-guardian:latest`. |
| #7 | **Homepage Recent Power chart** — `Sparkline` now has a gradient area fill + faint baseline + glow, default height 44→64. (Used as the live merge→redeploy guardian test.) |

See [[Redeploy Problem & Fixes]] for the why behind #2/#3/#4, and [[Deployment & Cutover]] for #4–#6.

## Cutover timeline (prod)
1. Guardian image built by CI (PR #6) → `ghcr.io/mattghicks/pool-app-guardian:latest`.
2. Host Docker logged into GHCR (classic PAT, `read:packages`).
3. Guardian deployed via Coolify (raw Docker Compose, image-based) → on `coolify` net, alias `pool-guardian`, `upstream (ESP32) connected`.
4. pool-api flipped: `BRIDGE_HOST=pool-guardian` (after fixing a `pool-gaurdian` typo) → `/healthz busConnected:true`, guardian `app connected — relaying`.
5. **Drill** (`docker restart pool-api`): guardian held at 1500 rpm, handed back in ~11 s. Pump steady.
6. **Real merge→redeploy** (PR #7): pool-api down **38 s**, guardian held at 1500 rpm. Pump never hiccuped. ✅

## Notes / decisions
- Model identity etc. kept out of commits/PRs.
- Energy reset wipes **all** history (not range-scoped) — matched the plain reading of "reset the stats."
- `FAILOVER_MAX_MS` left at 5 min — comfortably covers a merge + rebuild.

## Post-launch observation (2026-06-06)
- Dashboard RPM/fault **flicker** noticed → diagnosed as the **ESP32 link resetting every ~15 min** for ~8 s (not contention; pump never stops). Logged as outstanding in [[Known Issues]].
- **Cosmetic fix shipped:** homepage Status card debounces the fault (`useStablePumpStatus`) so the transient post-reconnect "Comm failure" frame no longer flashes red.

## Loose threads → see [[Known Issues]]
- ESP32 ~15‑min reset (root cause on the bridge side — open).
- GHCR token rotation (re-run `docker login` if rotated).
