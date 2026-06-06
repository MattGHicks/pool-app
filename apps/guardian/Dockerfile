# pool-guardian — build context MUST be the repo root (pool-app/).
# A tiny failover proxy between pool-api and the ESP32 RS-485 bridge. Deploy this
# as a SEPARATE, long-lived resource so app redeploys never restart it.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production
COPY . .
RUN pnpm install --frozen-lockfile --prod=false
RUN pnpm --filter @pool/protocol build \
 && pnpm --filter @pool/guardian build
RUN pnpm --filter @pool/guardian deploy --prod /app

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8899
COPY --from=build /app ./
EXPOSE 8899
CMD ["node", "dist/server.js"]
