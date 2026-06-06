---
title: Redeploy Problem & Fixes
tags: [poolpilot/pump, poolpilot/history]
created: 2026-06-06
---

# Redeploy Problem & Fixes

Back to [[PoolPilot]]. Related: [[Pump Control & Keep-Alive]], [[Pump Guardian]].

## The original symptom
> On every app update (merge → redeploy), the pump motor would **shut off and flash `SEr`** for ~20 s, then come back on **`Auto`**.

## Root cause
During a redeploy there's a window with **no keep-alive** reaching the pump. The pump's external-control watchdog (~15 s) expires → it shows `SEr` (lost serial master) → reverts to its onboard schedule (`Auto`). Two contributors:
1. The old pool-api's shutdown **explicitly released** the pump (`remoteControl(false)`) — an immediate handoff that stopped the pump if the onboard schedule wasn't in a run window at that moment.
2. On boot, pool-api briefly **released** again before the scheduler loaded (a "release blip").
3. The rebuild/swap gap could exceed the pump's ~15 s tolerance.

## The fixes (in order they were shipped)
> [!note] Each is independent and additive.

### 1. Don't force a handoff on shutdown — `RELEASE_ON_SHUTDOWN`
`apps/api/src/server.ts` shutdown no longer sends the release by default. It just stops the keep-alive; the pump holds its speed and reverts on its own ~15 s timeout if pool-api doesn't return. A quick redeploy is then seamless. `RELEASE_ON_SHUTDOWN=true` restores the old immediate-handoff behavior. *(Default `false`.)*

### 2. Prime the scheduler before the engine — kill the boot "release blip"
`server.ts` now `await scheduler.refresh()` **before** `engine.start()`, so the first command on boot asserts the real RPM directly instead of briefly releasing while schedules load. (`scheduler.start()` no longer does its own initial refresh.)

### 3. The real solution — [[Pump Guardian]]
Fixes 1–2 only help when the gap is **< ~15 s**. A full rebuild can be longer. The guardian removes the dependency on gap length entirely: it holds the pump's last setpoint across **any** pool-api downtime up to 5 min, invisible to the pump.

## What "good" looks like now
| Scenario | Behavior |
|---|---|
| `docker restart` / quick redeploy | Guardian holds the speed; pump never moves. Seamless. |
| Full merge→rebuild (tens of seconds) | Guardian holds; pump never moves. **Proven: 38 s gap, held at 1500 rpm.** |
| App down > 5 min, or guardian dies | Pump safely reverts to its **onboard schedule** (the failsafe). |

## Why the pump's own fallback is still essential
Even with the guardian, the **onboard keypad schedule must cover your run hours** — it's the net under everything (failed deploy, host reboot, guardian crash, power blip). Confirmed working by unplugging the data cable and watching the pump return to `Auto`.
