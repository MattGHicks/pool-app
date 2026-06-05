# pool-api — build context MUST be the repo root (pool-app/).
# Builds the pnpm monorepo, then produces a slim prod image via `pnpm deploy`.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
# NODE_ENV=production keeps tooling happy; --prod=false forces devDeps for the build.
ENV NODE_ENV=production
COPY . .
RUN pnpm install --frozen-lockfile --prod=false
RUN pnpm --filter @pool/protocol build \
 && pnpm --filter @pool/types build \
 && pnpm --filter @pool/api build
RUN pnpm --filter @pool/api deploy --prod --legacy /app

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=build /app ./
EXPOSE 3001
CMD ["node", "dist/server.js"]
