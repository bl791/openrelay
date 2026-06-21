# syntax=docker/dockerfile:1

# ── Builder ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /repo

# Manifests first for a cached install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Sources and build (api + its workspace deps).
COPY packages/config packages/config
COPY packages/core packages/core
COPY packages/db packages/db
COPY apps/api apps/api
RUN pnpm --filter @openrelay/core --filter @openrelay/db --filter @openrelay/api build

# Prune dev dependencies for a lean runtime node_modules.
RUN pnpm --filter @openrelay/api --prod deploy /app

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

USER node
EXPOSE 4000

CMD ["node", "dist/index.js"]
