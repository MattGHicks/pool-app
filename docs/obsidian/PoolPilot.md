---
title: PoolPilot
tags: [poolpilot, moc]
created: 2026-06-06
---

# 🏊 PoolPilot — Home

Control + monitoring for the **Pentair SuperFlo VST** pool pump over RS‑485.
Replaces nodejs‑poolController. Mobile‑first dashboard, scheduling, energy analytics.

> [!info] The one-line mental model
> The app holds the pump under remote control with a **keep-alive every 5 s**. If the keep-alive stops for more than ~15 s, the pump reverts to its **onboard keypad schedule** (the safety baseline). The [[Pump Guardian]] bridges app downtime so redeploys never reach that timeout.

## Map of content
- [[Architecture]] — services, repo layout, hosts, domains
- [[Pump Control & Keep-Alive]] — RS‑485 protocol, keep-alive, revert timeout, `SEr`/`Auto`
- [[Pump Guardian]] — the failover proxy that makes app downtime invisible to the pump
- [[Deployment & Cutover]] — Coolify, compose files, GHCR image, the env-flip cutover
- [[Operations Runbook]] — commands, `/healthz`, failsafe drills, troubleshooting
- [[Redeploy Problem & Fixes]] — the original "motor shuts off on deploy" issue and how it was solved
- [[Known Issues]] — outstanding threads (incl. the ~15‑min ESP32 link reset)
- [[Changelog 2026-06-06]] — everything shipped in this session

## Quick facts
| Thing | Value |
|---|---|
| Repo | `MattGHicks/pool-app` (private, pnpm monorepo) |
| Dev branch (this session) | `claude/energy-reset-button-Y2E1A` |
| Web | https://pool.mght630.com |
| API | https://poolapi.mght630.com (health: `/healthz`) |
| Pump | Pentair SuperFlo VST, bus address `0x60` (96) — speaks IntelliFlo VS |
| ESP32 bridge | `192.168.4.60:8899` (transparent serial‑over‑TCP) |
| Host (T630) | `ssh matt@100.85.179.110` (Tailscale), runs Coolify |
| Keep-alive | 5 s (`KEEP_ALIVE_MS`) |
| Pump revert timeout | ~15 s (≈ 3 × keep-alive) |
| Guardian failover ceiling | 5 min (`FAILOVER_MAX_MS=300000`) |

> [!success] Status as of 2026-06-06
> Guardian is live in front of the ESP32 and **proven in production**: a real merge→redeploy took pool-api down **38 s** and the pump held steady at 1500 rpm — no stop, no `SEr`.
