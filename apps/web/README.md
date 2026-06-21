# @openrelay/web

The OpenRelay operator dashboard — a Next.js 15 (App Router) control plane for the
self-hosted cloud-OBS / IRL drop-protection stack.

## What it does

A polished, dark, responsive ops console for streamers and their teams:

- **Auth** (`/login`, `/register`) — JWT issued by the API; stored in `localStorage`
  and mirrored to a readable cookie so the edge `middleware.ts` can guard routes.
- **Dashboard** (`/dashboard`) — lists your streams with live status badges and a
  "New stream" action.
- **Stream control surface** (`/streams/[id]`):
  - Start / Stop broadcast, status badge, output summary.
  - **Live status panel** — subscribes to the API's SSE event feed
    (`GET /api/streams/:id/events`) with a polling fallback
    (`GET /api/streams/:id/runtime`). Per-ingest and per-destination status and
    bitrate, plus a prominent **FAILOVER** banner driven by `runtime.onFailover`.
  - **Ingests** — push URL + stream key with copy buttons, set active, delete.
  - **Destinations** — multistream targets with enable toggle; stream keys are
    write-only and shown redacted.
  - **Scenes** — switch the live scene, manage BRB / clips / image / color scenes.
  - **Failover policy** — edit mode / grace window / fallback scene.
  - **Team** — invite friends by email + role; remove them.

All domain types and request validation reuse `@openrelay/core` (Zod schemas).
Data fetching, caching and mutations use TanStack Query.

## Develop

```bash
corepack pnpm install
corepack pnpm --filter @openrelay/web dev   # http://localhost:3000
```

Set `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`) to point at the API.

## Scripts

| Script      | Description                      |
| ----------- | -------------------------------- |
| `dev`       | `next dev -p 3000`               |
| `build`     | `next build` (standalone output) |
| `start`     | `next start -p 3000`             |
| `lint`      | `eslint .`                       |
| `typecheck` | `tsc --noEmit`                   |
| `clean`     | remove `.next` / `.turbo`        |

## Docker

```bash
# from the repo root (build context = monorepo root)
docker build -f apps/web/Dockerfile -t openrelay-web .
docker run -p 3000:3000 -e NEXT_PUBLIC_API_URL=http://localhost:4000 openrelay-web
```
