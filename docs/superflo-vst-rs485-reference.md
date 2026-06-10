# Pentair SuperFlo VST — RS-485 Protocol Reference

Complete map of **what we can read from** and **command on** the Hicks pool's Pentair SuperFlo VST
(model 342002) over RS-485, via the ESP32 bridge (`192.168.4.60:8899`) → MAX485 → pump (address 1 / 0x60).

**The one foundational fact:** the RS-485-capable SuperFlo VST (built after 10/15/20) does **not** have
its own protocol — it **impersonates an IntelliFlo VS** on the wire. So everything that's true of the
IntelliFlo VS *command set* applies, but only the *hardware* the VST actually has (no flow/pressure
sensors) limits what's meaningful. Configure as "IntelliFlo VS" in any controller.

Legend: ✅ confirmed on our pump · ⚠️ works but limited/untested on VST · ❌ not supported on VST.

---

## Packet framing

```
FF 00 FF  A5 00  {dst} {src} {action} {len}  [data...]  {ck_hi ck_lo}
```
- 9600 baud, 8N1.
- `FF 00 FF` preamble, `A5` start, `00` = protocol/version byte.
- `dst` = pump (0x60 = pump 1), `src` = controller (0x21).
- `ck` = 16-bit big-endian sum of every byte from `A5` through the last data byte.
- Example (our set-1500-RPM): `FF 00 FF A5 00 60 21 01 04 02 C4 05 DC 02 D2`.

---

## (A) TELEMETRY — what we can READ

Send a **status request** — action `0x07`, no data: `A5 00 60 21 07 00` → pump replies action `0x07`,
15-byte payload. Our real capture decoded (`0a 00 02 00 87 05 dc 00 00 00 00 00 00 11 1f`):

| Byte | Field | Our value | Meaning / units | VST? |
|---|---|---|---|---|
| 0 | **command / run** | 0x0a | Run flag: **10 = running**, 4 = stopped | ✅ |
| 1 | **mode** | 0x00 | Operating mode (manual/filter/ext-program); 0 = manual/idle | ✅ |
| 2 | **driveState** | 0x02 | Motor-drive state: 0 = idle, **2 = energized/regulating** | ✅ |
| 3–4 | **watts** | 135 | Power, 16-bit big-endian | ✅ |
| 5–6 | **rpm** | 1500 | Speed, 16-bit big-endian | ✅ |
| 7 | **flow** | 0 | GPM — needs a flow sensor | ❌ (no sensor, always 0) |
| 8 | **ppc** | 0 | VF-filter percent | ❌ (always 0) |
| 9–10 | (reserved/err) | 0 | byte 10 sometimes = error flag (0 = ok) | — |
| 11–12 | **status** | 0 | 16-bit status/alarm word (see codes below) | ✅ |
| 13–14 | **time** | 17:31 | Pump clock, `HH MM` (byte13=hr, byte14=min) | ✅ |

**Status/alarm word codes** (bytes 11–12): `0`=Off · `1`=Ok · `2`=Filter warning · `3`=Overcurrent ·
`4`=Priming · `5`=System blocked · … · `16`=Comm failure.

**Useful telemetry on the VST:** watts, rpm, run/drive state, status/error word, pump clock.
**Not available** (no hardware): flow/GPM, pressure/PSI, water temp.

Alternate single-value reads (action `0x02 {reg}`): `0x0206` = RPM, `0x020A` = watts. (The status reply
already carries everything, so we just poll action 7.)

### The 135 W (RS-485) vs 160 W (Emporia) question — answered
RS-485 watts is the **drive's internal estimate of motor input power**; the Emporia clamp measures
**true line power upstream of the drive** (includes drive switching/standby losses, and a non-true-RMS
clamp reads a VFD's chopped waveform high). Both are "right" for different points. **For energy billing,
trust Emporia (160 W).** Treat RS-485 watts as the motor-side number. The % gap shrinks at higher RPM.

---

## (B) CONTROL — what we can COMMAND

### Take / release control — action `0x04`
- `A5 00 60 21 04 01 FF` = **take remote control** (must send before speed commands are obeyed).
- `A5 00 60 21 04 01 00` = release back to the keypad.

### Set speed directly — action `0x01`, register `0x02C4` ✅ (our primary control)
- `A5 00 60 21 01 04 02 C4 {rpm_hi} {rpm_lo}` — e.g. `…02 C4 05 DC` = 1500 RPM.
- Range **0–3450 RPM**, 1-RPM steps. Pump **clamps** out-of-range (VST usable band ~1100–3450).
- This is what we proved (commanded 2500, obeyed).

### Run / stop the drive — action `0x06`
- njsPC sends `[10]` = run, `[4]` = stop. (Speed is still set via action 1.)

### External programs (the 4 keypad presets) — action `0x01`, register `0x0321`
- `…03 21 08`=Prog1, `10`=Prog2, `18`=Prog3, `20`=Prog4, `00`=stop. ⚠️ Works but pointless on the VST —
  just push the exact RPM you want via `0x02C4` instead.

### Store a program's speed — registers `0x0327–0x032A` (mirror `0x03BB–0x03BE`)
- IntelliFlo can persist each program's RPM here. ⚠️ **On the VST you can't rewrite the keypad's stored
  Speed 1/2/3/Quick-Clean presets over RS-485** — those are keypad-only. Untested on our pump; don't rely on it.

### Flow/GPM control — register `0x02E4`
- ❌ VSF (flow model) only. The VST has no flow sensor.

### Set mode — action `0x05`
- Selects filter/manual/ext-program mode. njsPC **skips this for VS pumps** (drives by explicit RPM). Mode-value
  table is poorly documented — ⚠️ leave alone.

---

## (C) VST-specific rules & gotchas (the stuff that bites)

1. **Configure as "IntelliFlo VS"** everywhere — there is no "SuperFlo RS-485" pump type.
2. **Physical Start/Stop is a hard gate.** If the pump is stopped at the keypad (LED off), *no* RS-485
   command can start it. The button overrides software.
3. **Keep-alive required.** If commands stop, the pump times out and reverts to its onboard schedule.
   Send a speed/keep-alive command on an interval (every few–45 s).
4. **External-Control-Only mode** (hold Start/Stop ~10 s until that LED lights) **disables the onboard
   schedule** so it doesn't fight RS-485. The manual also has you set keypad **Speed 1 = 0 RPM / 24 h** as a
   belt-and-suspenders so a fallback to schedule does nothing.
5. **Address = 1** (matches our njsPC config). Wiring **Yellow = RS-485 A, Green = RS-485 B**; swap if no comms.
6. **🚨 Bricking risk:** do **not** fuzz unknown registers/actions on the live pump — the njsPC maintainer
   warns it has bricked IntelliValves. Stick to the validated command set above.
7. **Benign noise:** njsPC's `Error sending setPumpManual … 5,1,6,1,50` (an action-5 poll) is spurious for VS
   pumps and doesn't mean control failed.

---

## (D) What this means for the app

We can build a UI/scheduler that:
- **Reads:** live RPM, watts, run state, drive state, fault/status, pump clock — poll action 7 every ~1–2 s.
- **Controls:** any RPM 0–3450 on demand (action 1 / 0x02C4), with a keep-alive loop; start/stop (action 6);
  take/release control (action 4).
- **Cannot:** read flow/pressure/temp (no sensors), rewrite keypad presets, or override the physical Start/Stop.
- **Watts for energy math** comes from Emporia, not RS-485 (use RS-485 watts only as a secondary/relative signal).

njsPC already implements all of this (it's the reference IntelliFlo VS driver) — so the app can either drive
njsPC's REST/socket API, or talk the protocol directly through the bridge. Decide in the app-planning phase.

---

### Sources
- njsPC source — [PumpStateMessage.ts](https://raw.githubusercontent.com/tagyoureit/nodejs-poolController/master/controller/comms/messages/status/PumpStateMessage.ts), [Pump.ts](https://raw.githubusercontent.com/tagyoureit/nodejs-poolController/master/controller/nixie/pumps/Pump.ts), [Pumps wiki](https://github.com/tagyoureit/nodejs-poolController/wiki/Pumps)
- Protocol — michaelusner [PACKET_SPEC.txt](https://github.com/michaelusner/pentair-pool-controler/blob/master/PACKET_SPEC.txt); wolfteck [set-RPM](http://www.wolfteck.com/2019/02/05/pentair_pump_rs-485_api/), [external programs](http://www.wolfteck.com/2019/02/05/pentair_rs-485_external_programs/)
- VST specifics — njsPC [#457](https://github.com/tagyoureit/nodejs-poolController/issues/457), [#453](https://github.com/tagyoureit/nodejs-poolController/discussions/453); [SuperFlo VST manual P/N 356292](https://www.pentair.com/content/dam/extranet/aquatics/pool-pad-pro-assets/pumps/inground-pumps/superflo-vs-variable-speed-pump/356292-superflovs-superflovst-supermaxvs-owners-manual.pdf); [TFP SuperFlo VS/VST thread](https://www.troublefreepool.com/threads/the-new-pentair-superflo-vs-or-vst.236244/)
