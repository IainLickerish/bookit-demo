# syntax=docker/dockerfile:1
FROM oven/bun:1.4.4 AS bun
FROM node:24.22.1-bookworm-slim AS dependencies
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
ARG GIT_COMMIT
ARG BUILD_ID=local-container
ARG BOOKIT_IMAGE=bookit-demo:local
ARG BUILT_AT
ARG BOOKIT_ALLOW_TEST_CLOCK=false
# A missing GIT_COMMIT fails here: .git is deliberately absent from the context.
RUN GIT_COMMIT="$GIT_COMMIT" BUILD_ID="$BUILD_ID" BOOKIT_IMAGE="$BOOKIT_IMAGE" BUILT_AT="$BUILT_AT" BOOKIT_ALLOW_TEST_CLOCK="$BOOKIT_ALLOW_TEST_CLOCK" bun run build
RUN printf '%s' "$BOOKIT_ALLOW_TEST_CLOCK" > /app/seed-clock-build-flag

FROM dependencies AS production-dependencies
RUN bun install --frozen-lockfile --production

FROM node:24.22.1-bookworm-slim AS runtime
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# Supply BOOKIT_PUBLIC_URL at runtime for this tenant's public origin; never
# bake a shared origin into the image (password-reset contract, PR #4).
COPY --from=production-dependencies /app/node_modules ./node_modules
# next start loads next.config.ts; provide its pinned compiler without a
# runtime install attempt on the isolated clinic network.
COPY --from=dependencies /app/node_modules/typescript ./node_modules/typescript
COPY --from=build /app/.next ./.next
COPY --from=build /app/seed-clock-build-flag ./seed-clock-build-flag
COPY package.json tsconfig.json next.config.ts ./
COPY src ./src
COPY scripts ./scripts
COPY drizzle ./drizzle
COPY tenants ./tenants
RUN mkdir -p /app/logs && chown node:node /app/logs
USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=12 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["bun", "scripts/container.ts"]
CMD ["server"]
