---
title: Known Issues
tags: [poolpilot/ops, poolpilot/open]
status: open
created: 2026-06-06
---

# Known Issues / Open Threads

Back to [[PoolPilot]]. Related: [[Operations Runbook]], [[Pump Guardian]], [[Pump Control & Keep-Alive]].

---

## 🟠 ROOT-CAUSED 2026-07-30 — silent bridge stalls made the pump really revert (audible ramp down → up)

> [!important] This supersedes the old "the 15-min reset is cosmetic" theory (now below).
> Matt reported hearing the pump ramp down and back up at random. It was real: the pump was losing its keep-alive, reverting toward its onboard schedule, and snapping back. The 15-min reset is **not** the cause.

### Symptom
Audible — pump spins down and back up over ~10–25 s, then runs normally. On the dashboard it looks like a brief RPM dip. **Nothing was logged**: no fault, no disconnect, `statusWord` stayed `0` throughout.

### Evidence (`telemetry_raw`, 3.4 M rows since 2026-06-06)
30 confirmed dip events, all in daytime hours; ~6/week in early July tapering to ~1/week. Example, 2026-07-22 13:45 ET:

| Time | RPM | Watts | Note |
|---|---|---|---|
| 13:43:13 | 1500 | 138 | steady |
| 13:45:06 | 1500 | 138 | **after a 97 s stall** |
| 13:45:08–11 | 1169 → **507** | 123 → 40 | ramping down |
| 13:45:12–13 | 827 → 1147 | 31 | ramping back up |
| 13:45:32 | 1500 | 137 | recovered |

Watts track RPM on the cube law throughout (137 W @1500 ≈ 1076 W @3000), so this is a real mechanical event, not a decode artifact. Same signature on 2026-07-29 10:35 (127 s stall), 2026-07-29 17:22 (193 s stall), 2026-07-24 15:33 (from 2400 rpm).

**The tell:** every dip immediately follows a multi-minute stall in the bridge stream where **no disconnect was ever logged** — the TCP socket stayed open while carrying nothing. Exposure was large: stalls >15 s *while running* ran 35–370 per week, worst observed 619 s.

### Diagnosis
A stalled WiFi link leaves the TCP connection open, so nothing in the stack noticed:
- `BridgeConnection` only reconnected on socket `close`/`error`. `lastRxAt` was recorded and **never read**.
- `Watchdog` computed `lastPollAgeMs` but only **reported** it — no dead-man's switch despite the name.
- Guardian's `upstream.write()` returned early when the link was down, **silently discarding the app's keep-alive**.
- Guardian failover only triggers when the **app** disconnects, so it could never engage for an **ESP32-side** stall.
- `CommandQueue` was unbounded: the wedged write blocked the drain loop while ~300 stale frames piled up, then flooded a half-duplex bus on recovery.
- Reconnect backoff climbed to 15 s and reset only on success, stretching short absences into long command gaps.

### Fix shipped 2026-07-30
- **Liveness check on both links** — `BRIDGE_IDLE_MS` / `UPSTREAM_IDLE_MS` (default 12 s, inside the ~15 s revert window): a quiet-but-open socket is torn down and redialed instead of trusted.
- **TCP keepalive + connect timeouts** on both sockets, so a blackholed connect can't hang for the OS SYN timeout (~2 min).
- **Guardian logs discarded writes** (rate-limited) instead of dropping them silently.
- **Queue bounded and deliberately lossy** — frames older than 2 s discarded, depth capped at 64. The engine re-asserts intent every tick, so nothing is lost and there's no flood on recovery.
- **Backoff ceiling cut to 5 s**, reset on a clean close.
- **New `bus_stall` event** in `event_log` records the idle duration, so this failure mode is no longer invisible.

Regression tests: `apps/api/test/link.test.ts`, `apps/guardian/test/upstream.test.ts` — a silent peer must be redialed, a talkative one must not be, and a stale backlog must be dropped rather than sent.

### Still open — why the ESP32 link stalls at all
The app now recovers in ~12 s instead of minutes, but the stalls themselves are upstream of us. Two unverified suspects in `docs/firmware/poolbridge.yaml` — **confirm against what's actually flashed** before changing:
- [ ] **No `power_save_mode` under `wifi:`** → ESPHome's ESP32 default (`LIGHT`) applies. The radio sleeps between beacons; a classic source of multi-second stalls on a latency-sensitive stream bridge. Try `power_save_mode: none`.
- [ ] **Byte-level UART debug logging left enabled** — `logger: level: DEBUG` plus `uart: debug: direction: BOTH`, marked "TEMP DEBUG". Formats a log line per 64 bytes/40 ms over USB *and* the API; can starve the stream server's loop.
- [ ] Check WiFi signal at the pad since the 2026-06-06 move into the 3D-printed box.
- [ ] Stale comments in that file: it claims `RO left unwired` (can't be true — telemetry flows) and still names njsPC as the consumer.

---

## 🟢 CHARACTERIZED — ESP32 bridge resets its connection every ~15 minutes

> [!note] Real, but benign — and **not** the cause of the ramping above.
> Kept for history. This was previously the prime suspect for the RPM flicker.

### Symptom
On the web dashboard, RPM briefly flickers and the **Status** card flashes a fault for ~1–2 s, then recovers. Observed 2026-06-06.

### Evidence (re-measured 2026-07-30 across 54 days of guardian logs)
3,675 upstream drops, strongly bimodal, and — apart from a handful of outliers — **all well inside the ~15 s revert window**:

| Gap | Count |
|---|---|
| <2 s (`ECONNRESET`) | 2,524 |
| 2–5 s | 1 |
| 5–9 s | 1,145 |
| 9–15 s | 0 |
| >15 s | 5 (four during the 2026-06-06/06-10 relocation and power events; one 39 s on 2026-07-10) |

Median 1.23 s; worst routine case 8.76 s. The **900 s (15 min 01 s) precision** still points at a timer on the ESP32 side — a scheduled WiFi reconnect, DHCP renewal, OTA check, or firmware watchdog. Container check confirmed only one of each service → no second bus master, no leftover njsPC; contention ruled out.

All four investigated dip events fell **between** reset times, so the two phenomena are unrelated. The tightened backoff also keeps the >15 s tail (like that 39 s event) from recurring.

### Mitigation shipped (cosmetic)
Homepage **Status** card now debounces the fault: a non-zero `statusWord` must persist for **3 consecutive polls** before it shows red, and clears on the first healthy frame (`useStablePumpStatus` in `apps/web/src/app/page.tsx`). So the transient no longer flashes. The momentary RPM wiggle is left honest (debouncing a live gauge would make real speed changes feel laggy).

### If it's ever worth chasing
Low value now that the app tolerates it, but the remaining leads: check the router for a ~15-min DHCP lease on `192.168.4.60` (consider a static lease), and any scheduled-reboot/OTA setting in the firmware. The firmware is ESPHome + `oxan/esphome-stream-server` — see the checklist in the section above, which matters considerably more.

---

## ✅ RESOLVED — Schedule appeared stuck until a manual "Save"
**Symptom (2026-06-06):** in Schedule mode the gauge showed target/actual **0** while the Live card said "Running now 1500 rpm". Going to the preset and hitting **Save** (without changing anything) made it start working.

**Cause:** the backend `Scheduler` only **reloaded the schedule list from the DB at startup and on edits**; its 30 s tick merely recomputed the time-of-day RPM from the *cached* list. If that cached list ever went stale/empty (most likely a transient `listSchedules` read swallowed by its `catch` during one of the day's many redeploys), the pump stayed off until something forced a reload. Saving a preset hits `updateSchedule → refreshSchedules → scheduler.refresh()`, which reloaded the DB and fixed it.

**Fix:** `Scheduler.start()` now **reloads from the DB every 30 s** (`void this.refresh()` instead of `this.tick()`), so a stale/failed boot load self-heals within 30 s — no manual save needed. `refresh()` still keeps the cached set if the DB read fails, so it degrades gracefully.

**Also fixed (UI):** `ActiveScheduleCard` ignored `daysOfWeek` and would show "Running now X rpm" even on days the schedule doesn't run; it now respects the day and shows **"Off today"**. (This was a red herring during diagnosis — the real cause was the stale cache above.)

## ✅ RESOLVED — Dashboard clock / RPM / fault flicker (corrupted frames)
**Symptom:** the header clock (and occasionally RPM/status) briefly flickered to a wrong value, then corrected — e.g. the clock jumping to a "totally different time" for one update.

**Cause:** the header clock is the **pump's own onboard clock** decoded from `data[13:14]` of the RS-485 status frame (it is *display-only* — schedules run off the server clock, so this never affects timing). `scanFrames` did **not validate checksums**, so an occasional corrupted / byte-misaligned read (common right after a bridge reconnect) decoded into garbage telemetry for one update.

**Not a control risk:** the engine commands the pump from its *control state*, never from decoded telemetry — a bad frame can't change what's commanded. Worst case was one odd dashboard update + one noisy `telemetry_raw` row.

**Fix:** `scanFrames` gained an opt-in `verifyChecksum`, and the bridge read path (`apps/api/src/bridge/connection.ts`) now enables it — corrupted frames are dropped and we resync, so garbage never reaches the UI or the DB. The checksum is proven correct (matches a real captured frame + every built command in tests). This is the root-cause fix for the flickers the per-field debounce was papering over.

> [!note] Pump clock after a power-cycle
> The bridge/pump lost power during the 2026-06-06 move. The pump keeps its own RTC (nothing syncs it), so if the header clock looks off by more than the usual <1 min, set it on the pump keypad — it keeps the **onboard fallback schedule** aligned. Doesn't affect app schedules.

## 🟢 Minor — GHCR token is long-lived
The host's Docker is logged into GHCR with a classic `read:packages` PAT (for pulling the private guardian image). Rotate whenever; if rotated, re-run the `docker login` (see [[Deployment & Cutover]]).

## 💡 Future option — move failover onto the ESP32 firmware
The [[Pump Guardian]] currently runs as a container on the host. The "ultimate" form is putting the failover keep-alive on the ESP32 itself (fully host-independent). Bigger lift (custom firmware), not needed now.
