# PoolPilot

Custom, self-hosted control & monitoring app for the Hicks pool's **Pentair SuperFlo VST** pump.
Replaces nodejs-poolController. Talks the Pentair RS-485 protocol directly through the ESP32 bridge
(`192.168.4.60:8899`), serves a beautiful mobile-first dashboard, full scheduling, and power analytics.

## Monorepo layout

```
apps/
  api/        Node + TS service (Fastify + socket.io) — owns the bridge, runs the pump
  web/        Next.js 16 PWA — sleek dark mobile-first UI
packages/
  protocol/   Pentair RS-485 codec (framing, checksum, command factories, status decode) + tests
  types/      shared Zod schemas / DTOs
```

## Failsafe

The pump's **onboard keypad schedule is the safe baseline**. The app's overrides are transient,
sustained only by a keep-alive loop. If the app/bridge/server dies, the pump times out and reverts
to its onboard schedule. The app never enters External-Control-Only mode (which would disable that
schedule). The physical Start/Stop button is the ultimate hardware gate.

See the full design in the project plan and `pool-controller/docs/superflo-vst-rs485-reference.md`.

## Dev

```
pnpm install
pnpm -r test      # protocol unit tests
```

Deploy: Docker Compose on the T630 (Coolify/Traefik) — `pool.mght630.com` + `poolapi.mght630.com`.
