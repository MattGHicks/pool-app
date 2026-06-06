---
title: Known Issues
tags: [poolpilot/ops, poolpilot/open]
status: open
created: 2026-06-06
---

# Known Issues / Open Threads

Back to [[PoolPilot]]. Related: [[Operations Runbook]], [[Pump Guardian]], [[Pump Control & Keep-Alive]].

---

## 🟡 OPEN — ESP32 bridge resets its connection every ~15 minutes

> [!warning] Status: outstanding, low priority (cosmetic today). Pick up later.
> The pump does **not** stop and there is **no bus contention**. It's a periodic, deliberate-looking link reset on the ESP32 side that causes a brief dashboard flicker.

### Symptom
On the web dashboard, RPM briefly flickers and the **Status** card flashes a fault for ~1–2 s, then recovers. Observed 2026-06-06.

### Evidence
Guardian (`pool-guardian`) logs show its **upstream (ESP32) connection** dropping and reconnecting at a near-exact cadence:
```
19:21:22 → 19:36:23 → 19:51:24 → 20:06:25   (every 15 min 01 s, reconnect ~8–9 s later)
```
- Container check confirmed **only one** of each: `pool-web`, `pool-api`, `pool-db`, `pool-guardian` → **no second bus master**, no leftover njsPC. Contention ruled out.
- `/healthz` showed `lastPollAgeMs` occasionally elevated (~1.7 s vs the usual <1 s) — consistent with the brief relay gap.

### Diagnosis
- The **900 s (15 min 01 s) precision** means it's a **timer on the ESP32 side**, not random instability. Candidates: a scheduled WiFi/MQTT reconnect, **DHCP lease renewal**, an OTA/maintenance check, or a periodic **firmware reboot/watchdog**.
- The guardian (and previously pool-api directly) faithfully reconnects; the ~8 s gap is bounded by **how long the ESP32 is away**, so tightening our reconnect backoff wouldn't help.
- During the ~8 s gap the pump is briefly without keep-alive but **8 s < ~15 s revert window**, so it keeps running. The post-reconnect frame can momentarily report a comms-related `statusWord` (likely code 16 "Comm failure") and a dipped RPM → the flicker.
- Almost certainly **pre-existing** and independent of the [[Pump Guardian]] (same ESP32 when pool-api connected directly).

### Risk
Low today. The one real risk: if a drop ever **exceeds ~15 s**, the pump would briefly revert to its onboard schedule and flash a real `SEr`. Killing the 15-min reset removes that margin entirely.

### Mitigation shipped (cosmetic)
Homepage **Status** card now debounces the fault: a non-zero `statusWord` must persist for **3 consecutive polls** before it shows red, and clears on the first healthy frame (`useStablePumpStatus` in `apps/web/src/app/page.tsx`). So the transient no longer flashes. The momentary RPM wiggle is left honest (debouncing a live gauge would make real speed changes feel laggy).

### Watch after the 2026-06-06 relocation
The bridge was moved into a 3D-printed box on 2026-06-06. Early signs are fine (a post-move reset recovered in ~1 s). Keep a loose eye on whether the new position changes the reset frequency or recovery time (WiFi signal). If it gets worse, that's a strong hint the root is WiFi/signal rather than a firmware timer.

### Next steps (when picked up)
- [ ] Identify what's on the ESP32's 15-min timer. **Need to know the firmware** (ESPHome? custom Arduino sketch? esp-link/ser2net?).
- [ ] Check the router for a ~15-min DHCP lease on `192.168.4.60`; consider a static lease.
- [ ] Check ESP32 power/WiFi signal and any scheduled-reboot/OTA setting.
- [ ] Optionally, confirm by tailing guardian logs over an hour: drops should remain ~every 15 min and recover in <15 s.

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
