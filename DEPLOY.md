# Deploying PoolPilot to the T630

Three services behind Traefik on the shared `coolify` network:
`pool-web` → `pool.mght630.com`, `pool-api` → `poolapi.mght630.com`, `pool-db` (internal TimescaleDB).
This **replaces** nodejs-poolController — only one thing can own the RS-485 bridge at a time.

## 0. Generate secrets (on the Mac)

```bash
openssl rand -base64 24          # DB_PASSWORD
openssl rand -base64 48          # SESSION_SECRET
pnpm --filter @pool/api hash-password 'YOUR-LOGIN-PASSWORD'   # POOL_PASSWORD_HASH
```

Keep these for the next step. The login password is what you'll type into the app.

## 1. Free the bus — retire njsPC AND dashPanel (on the T630)

The new `pool-api` must be the only writer on `192.168.4.60:8899`. Both old containers
(`njspc` → `pool.mght630.com`, `njspc-dash` → `dash.mght630.com`) live in the same compose
file, so one `down` retires both — Traefik then drops both routes automatically.

```bash
ssh matt@100.85.179.110 'cd ~/pool-controller/njspc && docker compose down'
# confirm both are gone:
ssh matt@100.85.179.110 'docker ps --format "{{.Names}}" | grep -i njspc || echo "njspc + dashPanel removed"'
```

After this, `dash.mght630.com` stops responding (retired for good). `pool.mght630.com` is freed
for the new web app, and the RS-485 bus is free. (Leave the bridge powered.)

To also delete the old njsPC config volume later (optional, after you're happy with PoolPilot):
`docker volume rm njspc_njspc-data` and `rm -rf ~/pool-controller/njspc`.

## 2A. Deploy via Coolify (recommended)

1. Coolify → New Resource → **Docker Compose** → connect the `MattGHicks/pool-app` repo, branch `main`,
   compose path `docker-compose.yml`.
2. Set environment variables: `DB_PASSWORD`, `SESSION_SECRET`, `POOL_PASSWORD_HASH`, `KEEP_ALIVE_MS=5000`.
3. Deploy. Coolify builds all three images and starts them on the `coolify` network with the Traefik labels
   already in the compose file. SSL auto-provisions on first HTTPS hit.

## 2B. Deploy via SSH (alternative)

```bash
ssh matt@100.85.179.110
git clone git@github.com:MattGHicks/pool-app.git ~/pool-app && cd ~/pool-app
cp .env.deploy.example .env && nano .env       # paste the secrets from step 0
docker compose up -d --build
```

## 3. Verify

```bash
curl -s https://poolapi.mght630.com/healthz        # {"busConnected":true,...} once the bridge connects
```

Open `https://pool.mght630.com` on your phone, log in, and confirm the gauges show live RPM/watts.

## 4. Calibrate the keep-alive (one-time, on the Mac)

With pool-api running it owns the bus, so stop it briefly to run the calibration script, then restore:

```bash
ssh matt@100.85.179.110 'docker stop pool-api'
BRIDGE_HOST=192.168.4.60 pnpm --filter @pool/api calibrate     # prints recommended KEEP_ALIVE_MS
ssh matt@100.85.179.110 'docker start pool-api'
```

Set `KEEP_ALIVE_MS` to the recommended value in Coolify (or `.env`) and redeploy/restart pool-api.

## 5. Failsafe drills (prove the safety net)

- `docker stop pool-api` → within the revert window the pump returns to its **onboard keypad schedule**.
- Redeploy pool-api → it sends a graceful release first (clean handoff), then resumes control.
- Unplug the bridge briefly → pool-api auto-reconnects and resumes the override.

## Notes
- DNS: `pool.mght630.com` + `poolapi.mght630.com` resolve via the existing `*.mght630.com` wildcard — no new records.
- The session cookie uses `Domain=.mght630.com` so login on `pool.` is honored by `poolapi.`.
- Never scale `pool-api` beyond 1 replica — it is the single bus owner.
