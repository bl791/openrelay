# @openrelay/api

The Fastify HTTP **control plane** for OpenRelay. It is the system of record
(Postgres via [`@openrelay/db`](../../packages/db)) and orchestrates the relay
[`@openrelay/engine`](../engine) over HTTP using the protocol types from
[`@openrelay/core`](../../packages/core).

## Responsibilities

- **Auth** — email + password (argon2id hashing) with JWT sessions
  (`@fastify/jwt`).
- **Persistence** — users, streams, ingests, destinations, scenes and friend
  access grants.
- **Orchestration** — builds an `EngineStreamSpec` from DB rows and drives the
  engine (`start`/`stop`/`switchScene`/`setActiveIngest`), proxying runtime and
  the SSE event stream back to the browser.
- **Authorization** — a user may only access streams they own or are a friend of;
  `operator`/`manager` friends may control, `viewer` is read-only.

## Configuration

All config comes from the environment and is validated with zod at boot
(`src/config.ts`):

| Variable             | Required | Default   | Notes                                |
| -------------------- | -------- | --------- | ------------------------------------ |
| `API_PORT`           | no       | `4000`    | HTTP listen port                     |
| `API_HOST`           | no       | `0.0.0.0` | HTTP bind host                       |
| `DATABASE_URL`       | yes      | —         | Postgres connection string           |
| `JWT_SECRET`         | yes      | —         | Min 32 chars; signs session tokens   |
| `JWT_EXPIRES_IN`     | no       | `7d`      | Session lifetime                     |
| `ENGINE_URL`         | yes      | —         | Engine control API base URL          |
| `ENGINE_TOKEN`       | yes      | —         | Bearer token presented to the engine |
| `PUBLIC_INGEST_HOST` | yes      | —         | Host shown in encoder publish URLs   |
| `RTMP_PORT`          | no       | `1935`    | Advertised RTMP ingest port          |
| `SRT_PORT`           | no       | `9000`    | Advertised SRT ingest port           |
| `LOG_LEVEL`          | no       | `info`    | Pino level                           |

## HTTP API

All application routes are mounted under `/api`. `GET /healthz` is public.

- `POST /api/auth/register`, `POST /api/auth/login` → `AuthResponse`
- `GET /api/me`
- `GET|POST /api/streams`, `GET|PATCH|DELETE /api/streams/:id`
- `POST /api/streams/:id/start|stop|scene|ingest`
- `GET /api/streams/:id/runtime`, `GET /api/streams/:id/events` (SSE)
- `POST /api/streams/:id/ingests`, `DELETE /api/ingests/:id`
- `POST /api/streams/:id/destinations`, `PATCH|DELETE /api/destinations/:id`
- `POST /api/streams/:id/scenes`, `DELETE /api/scenes/:id`
- `POST /api/streams/:id/friends`, `DELETE /api/streams/:id/friends/:userId`

Errors are returned in the core `ApiError` envelope:
`{ "error": { "code", "message", "details?" } }`.

### Security notes

- Password hashes are never returned.
- Destination stream keys are write-only: they are echoed once on creation and
  otherwise replaced with a `__redacted__` sentinel in all responses.

## Development

```bash
pnpm --filter @openrelay/api dev        # tsx watch
pnpm --filter @openrelay/api build      # tsc -> dist
pnpm --filter @openrelay/api typecheck
pnpm --filter @openrelay/api lint
pnpm --filter @openrelay/api test       # vitest; no Postgres/engine needed
```

Tests inject an in-memory database (`src/testing.ts`) and a stubbed engine
client, so the suite runs with **no external services** — suitable for CI.

## Docker

```bash
docker build -f apps/api/Dockerfile -t openrelay-api .
docker run --rm -p 4000:4000 --env-file .env openrelay-api
```
