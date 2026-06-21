# OpenRelay

> A self-hosted cloud production and reliability layer for livestreamers — an open-source [Streamable](https://streamable.video) alternative.

OpenRelay is **Cloud Hosted OBS**: instead of pushing your phone, Moblin, IRL Pro,
desktop OBS, RTMP, or SRT feed _directly_ to Twitch / Kick / YouTube, you push it
into OpenRelay's cloud engine. That engine becomes the stable encoder that stays
connected to your destinations — so when your phone signal, Wi-Fi, or local encoder
drops, **your viewer-facing broadcast does not die.**

The fragile camera/source connection is separated from the stable viewer-facing
broadcast connection. When the active source drops, the relay keeps outputting a
valid stream and cuts to a **BRB / offline / clips** failover scene until the
source reconnects — viewers stay in the same live session rather than being kicked
to an "ended stream" page.

## Features

| Capability                                                           | Status |
| -------------------------------------------------------------------- | ------ |
| **Real RTMP/SRT ingest** — push from OBS, Moblin, IRL Pro (MediaMTX) | ✅     |
| **Stream drop protection** — output stays live when the source drops | ✅     |
| **Failover scenes** — BRB image, clips reel, or freeze-frame on drop | ✅     |
| **Multiple ingests** — RTMP, RTMPS, SRT; switch sources while live   | ✅     |
| **Multistreaming** — fan out to many destinations from one encode    | ✅     |
| **Scene switching** — ingest / BRB / clips / image / color scenes    | ✅     |
| **Clips & BRB media library** — upload to S3/MinIO, loop on failover | ✅     |
| **Shared/guest ingests** — collaborators push their own feed in      | ✅     |
| **Quickstart / easy-connect** — go live in seconds, copy-paste + QR  | ✅     |
| **Remote management** — invite friends/mods to operate your stream   | ✅     |
| **Configurable output ladder** — resolution, fps, bitrate, preset    | ✅     |
| **Self-hosted multi-user accounts** — email + password, JWT sessions | ✅     |
| **Live telemetry** — per-ingest & per-destination status and bitrate | ✅     |

## Architecture

OpenRelay is a TypeScript monorepo (pnpm workspaces + Turborepo).

```
┌──────────────┐    HTTP/SSE     ┌──────────────┐   control proto   ┌───────────────┐
│   apps/web   │ ───────────────▶│   apps/api   │ ─────────────────▶│  apps/engine  │
│  Next.js 15  │◀─────────────── │  Fastify v5  │◀──────────────────│  Fastify +    │
│  dashboard   │   REST + JWT    │ control plane│  status callbacks │  FFmpeg relay │
└──────────────┘                 └──┬────────┬──┘                   └───┬───────▲───┘
                                    │ Drizzle │ S3                  pull│  hooks │
                              ┌─────▼────┐ ┌──▼────┐                ┌───▼────────┴──┐
                              │ Postgres │ │ MinIO │   RTMP/SRT     │   MediaMTX    │
                              └──────────┘ └───────┘  ◀──publish─── │ ingest server │
                                                                    └───────▲───────┘
                                                                            │ RTMP/SRT
                              streamer's encoder (phone / OBS / Moblin) ─────┘
```

The streamer pushes into **MediaMTX** (the real RTMP/SRT ingest server). MediaMTX
authorizes the publish against the engine and notifies it on source ready/loss,
which arms the failover state machine. The engine pulls the source back out of
MediaMTX, transcodes once, and `tee`-fans-out to every destination. It POSTs status
callbacks to the API so the dashboard reflects reality. Clip/BRB media lives in
**MinIO** (S3-compatible) and is looped during failover.

### Packages

| Package                              | Description                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| [`apps/web`](apps/web)               | Next.js 15 operator dashboard (App Router, React 19, Tailwind v4, TanStack Query) |
| [`apps/api`](apps/api)               | Fastify control-plane REST API: auth, persistence, engine orchestration           |
| [`apps/engine`](apps/engine)         | FFmpeg-based relay engine: ingest, multistream fan-out, failover state machine    |
| [`packages/core`](packages/core)     | Shared domain types, Zod schemas, and the engine control protocol                 |
| [`packages/db`](packages/db)         | Drizzle ORM schema + Postgres client and migrations                               |
| [`packages/config`](packages/config) | Shared ESLint / Prettier / TypeScript configuration                               |

### How drop protection works

The engine runs a per-stream **state machine**. It monitors the active ingest via
heartbeats. When the active ingest goes stale or offline:

1. A **failover grace timer** starts (`FailoverConfig.graceSeconds`).
2. If the source recovers within the window, nothing visible happens.
3. If the window elapses, the engine switches the output source to the configured
   failover scene (BRB / clips / freeze) — **the output to destinations never
   stops**, so platforms never see the broadcast end.
4. When the source returns, the engine cuts back to the live scene.

A single FFmpeg encode is fanned out to every enabled destination via the `tee`
muxer (one transcode, N outputs), which is how multistreaming stays cheap.

See [`apps/engine/README.md`](apps/engine/README.md) for the full engine design.

## Quick start (Docker)

```bash
cp .env.example .env
# Edit .env — at minimum change JWT_SECRET and ENGINE_TOKEN.
docker compose up --build
```

Then open the dashboard at <http://localhost:3000>, register an account, and create
your first stream. Point your encoder at the RTMP/SRT push URL shown for each
ingest.

| Service            | URL                   |
| ------------------ | --------------------- |
| Web dashboard      | http://localhost:3000 |
| API                | http://localhost:4000 |
| Engine control API | http://localhost:8090 |
| RTMP ingest        | rtmp://localhost:1935 |
| SRT ingest         | srt://localhost:9999  |

## Local development

Requirements: **Node 22+**, **pnpm 9** (via Corepack), **FFmpeg**, and a Postgres
database (or `docker compose up postgres`).

```bash
corepack enable
pnpm install
cp .env.example .env

# Apply database migrations
pnpm --filter @openrelay/db db:migrate

# Run everything in watch mode
pnpm dev
```

You can run the engine without FFmpeg by setting `ENGINE_SIMULATE=1`, which uses a
simulated encoder driver that drives the same state machine — handy for UI work
and CI.

## Quality gates

Every package adheres to the same standards. The full CI suite runs on every push:

```bash
pnpm format:check   # Prettier
pnpm build          # Turborepo build (tsc / next build)
pnpm lint           # ESLint (typescript-eslint strict + stylistic, type-checked)
pnpm typecheck      # tsc --noEmit, strict everywhere
pnpm test           # Vitest (engine failover state machine, API integration, …)
```

TypeScript runs in maximal-strict mode (`strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`, …). There
are no `any`s and no blanket lint suppressions.

## Database migrations

Migrations are managed with Drizzle Kit from [`packages/db`](packages/db):

```bash
pnpm --filter @openrelay/db db:generate   # create SQL from schema changes
pnpm --filter @openrelay/db db:migrate    # apply pending migrations
```

## License

[AGPL-3.0-or-later](LICENSE). If you run a modified version as a network service,
you must offer your users the corresponding source.
