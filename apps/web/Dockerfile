# pool-web — build context MUST be the repo root (pool-app/).
# Next.js standalone output → minimal runtime image.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production
# Baked into the client bundle at build time — point it at the API subdomain.
ARG NEXT_PUBLIC_API_URL=https://poolapi.mght630.com
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY . .
RUN pnpm install --frozen-lockfile --prod=false
RUN pnpm --filter @pool/types build \
 && pnpm --filter @pool/web build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
