# syntax=docker/dockerfile:1

# --- Build stage: compile the engine and its workspace dependency. ----------
FROM node:22-bookworm-slim AS build
WORKDIR /repo

RUN corepack enable

# Copy workspace manifests first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY apps/engine/package.json apps/engine/

RUN pnpm install --frozen-lockfile

# Copy sources and build core (dependency) then the engine.
COPY packages/config packages/config
COPY packages/core packages/core
COPY apps/engine apps/engine

RUN pnpm --filter @openrelay/core build \
  && pnpm --filter @openrelay/engine build

# Prune to production dependencies for a lean runtime node_modules.
RUN pnpm --filter @openrelay/engine --prod deploy /app

# --- Runtime stage: Debian slim with FFmpeg installed. ----------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    ENGINE_HOST=0.0.0.0 \
    ENGINE_PORT=8090 \
    INGEST_HOST=mediamtx \
    RTMP_PORT=1935 \
    SRT_PORT=8890 \
    MEDIA_DIR=/var/lib/openrelay/media

COPY --from=build /app /app

RUN mkdir -p "$MEDIA_DIR" && chown -R node:node "$MEDIA_DIR"

# Engine control API. RTMP/SRT ingest is served by the MediaMTX sidecar.
EXPOSE 8090

USER node

CMD ["node", "dist/index.js"]
