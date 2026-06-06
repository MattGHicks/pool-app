# pool-guardian

A tiny failover proxy that sits between `pool-api` and the ESP32 RS-485 bridge:

```
pool-api  ──TCP──▶  pool-guardian  ──TCP──▶  ESP32 bridge  ──RS-485──▶  pump
```

## Why

The pump only stays under app control while it receives a keep-alive every few
seconds; if commands stop for longer than its ~15 s tolerance it reverts to its
onboard schedule (and briefly flashes `SEr` while it times out). A redeploy of
`pool-api` can exceed that window, so the pump visibly stops/restarts.

The guardian removes that gap. It holds the **one** persistent connection to the
ESP32, so the ESP32 never sees the app churn. While `pool-api` is connected it
just relays bytes and **watches** the command stream to learn the last intent
(remote-control on/off, run/stop, RPM). The moment the app's connection drops
**mid-run**, the guardian takes over the keep-alive — re-asserting that exact
setpoint — making the outage invisible to the pump.

## Behaviour

- **Relaying** (app connected): pass-through only; the app owns the bus. The
  guardian writes nothing.
- **Holding** (app vanished mid-run): re-sends `remote-enable → run → set-rpm`
  every `KEEP_ALIVE_MS`, for up to `FAILOVER_MAX_MS` (default 5 min).
  - If the app **reconnects**, it instantly stops and hands the bus back.
  - At the **ceiling**, it sends one release and goes idle, so a permanently-dead
    app hands scheduling back to the pump's onboard program.
- It only holds a **running** setpoint. If the app's last word was a
  release/stop/off, the guardian does nothing and lets the pump revert on its own.

### Safety invariants
- Single bus writer at all times: the guardian writes **only** when no app is
  connected.
- Hard `FAILOVER_MAX_MS` ceiling; RPM is clamped to the pump's range and never
  raised on its own.
- If the upstream ESP32 link is down, it writes nothing.

## Config (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `8899` | Port the app connects to (point `pool-api`'s `BRIDGE_HOST/PORT` here). |
| `UPSTREAM_HOST` | `192.168.4.60` | The real ESP32 bridge. |
| `UPSTREAM_PORT` | `8899` | ESP32 bridge port. |
| `PUMP_ADDRESS` | `96` | Pump bus address (0x60). |
| `KEEP_ALIVE_MS` | `5000` | Keep-alive cadence while holding (match `pool-api`). |
| `FAILOVER_MAX_MS` | `300000` | Max hold before releasing to onboard schedule. |

## Deploy

**Deploy this as its own resource, separate from the app stack**, or app
redeploys will restart it and defeat the purpose. See `docker-compose.guardian.yml`
and the deploy notes in the repo root `DEPLOY.md`.
