---
title: Pump Guardian
tags: [poolpilot/guardian]
created: 2026-06-06
---

# Pump Guardian

Back to [[PoolPilot]]. Related: [[Pump Control & Keep-Alive]], [[Deployment & Cutover]], [[Redeploy Problem & Fixes]].

A tiny TS service (`apps/guardian`, `@pool/guardian`) that sits **between pool-api and the ESP32**:
```
pool-api ──TCP──▶ pool-guardian ──TCP──▶ ESP32 bridge ──RS-485──▶ pump
```
It holds the **single persistent connection to the ESP32**, so the ESP32 never sees pool-api's redeploy churn. While pool-api is connected it just relays bytes and **observes** the command stream to learn the last intent. The instant pool-api disconnects **mid-run**, the guardian takes over the keep-alive — re-asserting that exact setpoint — making a redeploy/crash invisible to the pump.

## State machine (`apps/guardian/src/guardian.ts`)
- **relaying** — app connected; app owns the bus; guardian writes nothing, only sniffs frames (`remoteControl`/`runStop`/`setRpm`) to track `remoteEnabled`, `running`, `rpm`.
- **holding** — app gone mid-run; re-sends `remote-enable → run → set-rpm(lastRpm)` every `KEEP_ALIVE_MS`, up to `FAILOVER_MAX_MS`.
  - App **reconnects** → instantly back to *relaying* (hands the bus back).
  - **Ceiling** reached → sends one `remoteControl(false)` release → *idle* (pump falls to onboard schedule).
- **idle** — no app and nothing to hold (released, timed out, or the last intent was a release/stop).

## Safety invariants
> [!danger] These keep it safe to autonomously drive a motor
> - **Single bus writer at all times** — the guardian writes *only* when no app is connected.
> - **Only holds a *running* setpoint** — a release/stop/off intent is left to the pump's own timeout (→ onboard schedule).
> - **Hard `FAILOVER_MAX_MS` ceiling** (5 min), RPM **clamped** to range and never raised on its own.
> - **No writes when the upstream ESP32 link is down.**

## Config (env)
| Var | Default | Meaning |
|---|---|---|
| `PORT` | `8899` | port the app connects to (point pool-api's `BRIDGE_HOST/PORT` here) |
| `UPSTREAM_HOST` | `192.168.4.60` | the real ESP32 bridge |
| `UPSTREAM_PORT` | `8899` | |
| `PUMP_ADDRESS` | `96` | 0x60 |
| `KEEP_ALIVE_MS` | `5000` | hold cadence (match pool-api) |
| `FAILOVER_MAX_MS` | `300000` | 5 min, then release to onboard. Min allowed 10 000. |

## Tests
- Unit (`apps/guardian/test/guardian.test.ts`): relay/hold/handback/timeout, "released" + "stopped" intents are NOT held, split-frame sniffing, upstream-down → no writes.
- Verified end‑to‑end over real sockets (fake ESP32 + built guardian + fake app): relay → hold → handback → release → silence.

## Log lines to recognize
```
pump-guardian listening { port: 8899, upstream: '192.168.4.60:8899' }
upstream (ESP32) connected { host: '192.168.4.60', port: 8899 }
app connected — relaying, app owns the bus          ← pool-api attached (cutover OK)
app gone mid-run — holding pump speed { rpm: 1500 } ← failover engaged
```

> [!success] Production proof (2026-06-06)
> Merge→redeploy took pool-api down **38 s**; guardian logged `holding pump speed { rpm: 1500 }` then `app connected — relaying` 38 s later. Pump never flinched.

## Trade-off to remember
The guardian is now the single point of contact for the bus. If **it** dies (or the host reboots), you fall back to the pump's own ~15 s watchdog → onboard schedule — same net as before, just gated on the guardian. That's why it's a tiny, rarely-touched, independently-deployed service.
