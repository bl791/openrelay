# syntax=docker/dockerfile:1

# One-shot migration runner image. Applies the generated Drizzle SQL migrations
# in ./drizzle against DATABASE_URL, then exits.
FROM node:22-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY packages/config packages/config
COPY packages/core packages/core
COPY packages/db packages/db
RUN pnpm --filter @openrelay/core build && pnpm --filter @openrelay/db build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN corepack enable

# Copy the whole workspace install + built db package (tsx is a dev dep, so we
# run the compiled migrate entrypoint instead).
COPY --from=builder /repo /repo

WORKDIR /repo/packages/db
CMD ["node", "dist/migrate.js"]
