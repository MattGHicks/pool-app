---
title: Pump Control & Keep-Alive
tags: [poolpilot/pump, poolpilot/protocol]
created: 2026-06-06
---

# Pump Control & Keep-Alive

Back to [[PoolPilot]]. Related: [[Architecture]], [[Pump Guardian]].

## The failsafe principle
The pump's **onboard keypad schedule is the safe baseline**. The app's overrides are *transient* — sustained only by a keep-alive loop. The app never enters External‑Control‑Only mode (which would disable the onboard schedule), so if the app/bridge/server dies, the pump times out and **reverts to its onboard schedule**. The physical Start/Stop button is the ultimate hardware gate.

## How the app drives the pump (`apps/api/src/core/engine.ts`)
Every `KEEP_ALIVE_MS` (5 s), and immediately on any state change, the engine `apply()`:
- If **running** (target RPM > 0): send `remoteControl(true)` → `runStop(true)` → `setRpm(target)`.
- If **off** / mode `off` / schedule‑mode with no enabled schedule: send `remoteControl(false)` (**release** → onboard schedule).

> [!important] Why all three frames every cycle
> `remoteControl(true)` is the keep-alive that holds the pump in override. `runStop(true)` actually starts a stopped drive (e.g. during the pump's onboard off-period). `setRpm` only sets the speed setpoint.

## RS‑485 protocol (`packages/protocol`)
Frame: `FF 00 FF  A5 00 {dst} {src} {action} {len} [data…] {ck_hi ck_lo}`. Pump address `0x60`, our virtual controller `0x21`.

| Command | Action | Data |
|---|---|---|
| `statusRequest` | `0x07` | none → 15‑byte status reply |
| `setRpm` | `0x01` (SetRegister) | reg `0x02C4` + RPM (16‑bit BE) |
| `runStop` | `0x06` | `0x0A` run / `0x04` stop |
| `remoteControl` | `0x04` | `0xFF` enable / `0x00` release |

RPM range clamped `0..3450`.

## The ~15 s revert timeout
Measured by `apps/api/src/scripts/calibrate-revert.ts`: command a speed, stop sending, watch how long until the pump reverts. Result feeds the rule **`KEEP_ALIVE_MS = min(revert) / 3`** → 5000 implies a ~15 s revert window. This number is the whole reason the [[Pump Guardian]] exists: a redeploy gap longer than ~15 s used to trip it.

## Display codes (SuperFlo VST)
> [!warning] `SEr` is NOT an official fault code
> It's the pump indicating it's in **serial/external‑control mode but receiving no valid commands** — i.e. the external‑control watchdog counting down during a no‑command gap. After ~timeout it reverts to **`Auto`** (its onboard schedule). Seeing `Auto` come back = the failsafe working.

Official alarm/fault codes (for reference): `21` comms link (keypad↔motor), `02` over-current, `0F` AC under-voltage, `19` motor start failure, `0b` AC over-voltage, plus internal-error codes. None of these is `SEr`.

## Control state & persistence
- `controlMode`: `schedule` | `manual` | `off`. `targetRpm` = manual RPM, scheduled RPM, or 0.
- Intent (mode + manual setpoint) is persisted and **restored on boot**, so a restart resumes the App Schedule / last manual speed rather than handing back to the pump.
