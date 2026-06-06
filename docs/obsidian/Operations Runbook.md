---
title: Operations Runbook
tags: [poolpilot/ops]
created: 2026-06-06
---

# Operations Runbook

Back to [[PoolPilot]]. Related: [[Deployment & Cutover]], [[Pump Guardian]].

> Host: `ssh matt@100.85.179.110` (Tailscale). Docker runs under Coolify; container names carry a UUID suffix, so look them up dynamically.

## Health check (public, no auth)
```bash
curl -s "https://poolapi.mght630.com/healthz?cb=$(date +%s)"
```
Fields: `busConnected` (pool-api↔bridge up), `lastPollAgeMs` (status freshness, ~1 s healthy), `controlMode`, `uptimeS` (resets on redeploy), `dbConnected`, `keepAliveMs`.

## Find containers
```bash
ssh matt@100.85.179.110 'sudo docker ps --format "{{.Names}}\t{{.Image}}" | grep -i pool'
```

## Guardian logs
```bash
ssh matt@100.85.179.110 'sudo docker logs --tail 30 pool-guardian-<id>'
```
Look for: `listening`, `upstream (ESP32) connected`, `app connected — relaying`, `app gone mid-run — holding pump speed`.

## pool-api logs / env / networks (diagnostics)
```bash
ssh matt@100.85.179.110 'P=$(sudo docker ps --format "{{.Names}}" | grep -i pool-api | head -1);
  echo "api=$P";
  sudo docker inspect -f "{{range .Config.Env}}{{println .}}{{end}}" "$P" | grep -i bridge;
  sudo docker logs --tail 20 "$P"'
```
- `getaddrinfo ENOTFOUND pool-guardian` → DNS/typo (must be `pool-guardian`) or pool-api not on the `coolify` network.
- `ECONNREFUSED` → name resolves but nothing listening on `:8899`.

## Restart pool-api (drill — guardian should hold the pump)
```bash
ssh matt@100.85.179.110 'P=$(sudo docker ps --format "{{.Names}}" | grep -i pool-api | head -1);
  sudo docker restart "$P" >/dev/null; sleep 10;
  sudo docker logs --tail 12 pool-guardian-<id>'
```
Expect `holding pump speed { rpm: … }` then `app connected — relaying`. Pump should not move.

## Failsafe drills (prove the safety net)
- **Restart/redeploy pool-api** → guardian holds; pump steady. ✅ (verified)
- **Kill the guardian > ~15 s** → pump reverts to its **onboard schedule** (pump's own watchdog).
- **Unplug the bridge cable** → after the timeout the pump comes back on its onboard schedule. (Verified by Matt.)

## Calibrate the revert timeout (rarely)
With pool-api stopped (so the script owns the bus):
```bash
BRIDGE_HOST=192.168.4.60 pnpm --filter @pool/api calibrate   # prints recommended KEEP_ALIVE_MS = revert/3
```
> [!tip] Point `calibrate` at the **ESP32 directly** (`192.168.4.60`), not the guardian, and only run it while pool-api is stopped.

## Energy stats reset
Energy page has a **Reset energy stats** button (coral, with a confirmation card). It calls `POST /api/energy/reset`, which wipes `telemetry_raw` (all recorded telemetry) and logs an `energy_reset` event. Charts repopulate from scratch.

## Open threads
See [[Known Issues]] for the full list, including the **~15‑min ESP32 link reset** (diagnosed 2026-06-06; cosmetic dashboard fix shipped, root cause on the ESP32 side still open).
