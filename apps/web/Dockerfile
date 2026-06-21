# syntax=docker/dockerfile:1

# ── Builder ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Copy workspace manifests first for cached dependency installs.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/core/package.json ./packages/core/
COPY apps/web/package.json ./apps/web/

RUN corepack pnpm install --frozen-lockfile=false

# Copy sources needed to build the web app and its workspace deps.
COPY packages/config ./packages/config
COPY packages/core ./packages/core
COPY apps/web ./apps/web

# Browser-visible API base URL is inlined into the client bundle at build time,
# so it must be provided as a build arg (NOT just a runtime env var).
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Build the shared core package (web transpiles it but consumes its dist types),
# then the Next.js standalone bundle.
RUN corepack pnpm --filter @openrelay/core build
RUN corepack pnpm --filter @openrelay/web build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Next.js standalone output bundles a minimal server and only the needed deps.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
