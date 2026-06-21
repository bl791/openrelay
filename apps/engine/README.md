# @openrelay/engine

The FFmpeg-based relay engine for OpenRelay. It is an HTTP control service that
spawns and supervises FFmpeg processes to maintain stable, viewer-facing
broadcasts that fan out to multiple destinations (Twitch / Kick / YouTube /
custom RTMP) at once — and, crucially, that **keep running when the streamer's
source ingest drops**.

## The drop-protection guarantee

OpenRelay's core promise is _stream drop protection_. The viewer-facing output to
the destination platforms is a single, continuously-running FFmpeg pipeline. The
streamer's source feed is merely the _input_ to that pipeline. When the source
disconnects, the engine does **not** stop the output — it swaps the input to a
failover scene (BRB image, clip reel, or a frozen/black slate) and keeps pushing
to every destination. To viewers, the broadcast never ends; they just see a "be
right back" screen until the streamer reconnects.

### Failover flow

```
source live ──drop──▶ grace timer (FailoverConfig.graceSeconds)
                          │
            recovers ◀────┤ before grace expires  ──▶ stays live, no cut
                          │
                          └─ grace expires ──▶ FAILOVER
                                                 cut output source to BRB/clips/freeze
                                                 (destinations stay connected)
                                                 │
                                 source live ────┘──▶ cut back to live source
```

A short drop within the grace window is invisible — no failover. Only a drop that
outlasts `graceSeconds` triggers a cut to the failover scene. Recovery cuts back
to the live source automatically. This logic lives in
[`stream-session.ts`](./src/stream-session.ts) and is exhaustively unit-tested
with fake timers.

## Architecture

| File                         | Responsibility                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `config.ts`                  | Zod-validated environment configuration.                                           |
| `logger.ts`                  | The single Pino logger instance (shared with Fastify).                             |
| `driver/`                    | Pluggable encoder backends behind the `EncoderDriver` interface.                   |
| `driver/ffmpeg-args.ts`      | **Pure** FFmpeg argv builder (heavily unit-tested).                                |
| `driver/ffmpeg-driver.ts`    | Real driver: spawns/supervises FFmpeg, parses progress, restarts with backoff.     |
| `driver/simulated-driver.ts` | Process-free driver for CI (`ENGINE_SIMULATE=1`).                                  |
| `stream-session.ts`          | Per-stream failover state machine.                                                 |
| `session-manager.ts`         | Registry of running sessions; produces `StreamRuntime` snapshots; SSE fan-out.     |
| `ingest-monitor.ts`          | Tracks ingest connect/disconnect/heartbeat; promotes missed heartbeats to `stale`. |
| `server.ts` / `routes.ts`    | Fastify v5 control API (bearer-token auth, Zod validation, SSE).                   |
| `index.ts`                   | Bootstrap + graceful shutdown (SIGTERM/SIGINT kills all FFmpeg).                   |

### The FFmpeg pipeline

`buildFfmpegArgs` assembles a single command that:

1. Takes the active **ingest** (`rtmp`/`rtmps`/`srt`, read back from the relay's
   own local listener) **or** a **failover scene** synthesized via `lavfi`
   (`color` slate, looped image, or looped clip reel).
2. Transcodes once with `libx264` (configurable preset, bitrate, GOP from the
   keyframe interval) plus AAC audio — per the `OutputProfile`.
3. Fans the single encode out to **all enabled destinations simultaneously** with
   the `tee` muxer (`[f=flv:onfail=ignore]`), so multistream costs one encode.

Transcoding once and `tee`-ing keeps CPU flat regardless of destination count and
ensures every platform receives an identical, stable feed.

## Encoder drivers

Selected at startup by `ENGINE_SIMULATE`:

- **`FfmpegDriver`** (default): real `node:child_process` supervision. Parses
  FFmpeg's `-progress pipe:1` stream for bitrate/liveness and restarts the
  process with linear backoff on crash. `switchSource` restarts with a new input
  (the destination connections re-establish within FFmpeg's reconnect window).
- **`SimulatedDriver`** (`ENGINE_SIMULATE=1`): no processes; drives status on
  timers so the entire engine — routing, the failover FSM, SSE — runs in CI and
  on machines without FFmpeg installed.

## Ingest monitoring

Real RTMP/SRT listeners are heavy and out of scope for this service. Instead the
engine exposes **control hooks** that the ingest layer calls:

- `POST /internal/ingest/:ingestId/connect`
- `POST /internal/ingest/:ingestId/disconnect`
- `POST /internal/ingest/:ingestId/heartbeat`

**Production wiring:** an `nginx-rtmp` (or FFmpeg-based) listener invokes these
via its `on_publish` / `on_publish_done` callbacks plus a periodic publisher
heartbeat. The `IngestMonitor` promotes a missed heartbeat to `stale` and forwards
every transition to the owning `StreamSession`, which runs the failover FSM.

## HTTP API

All routes except `/healthz` require `Authorization: Bearer ${ENGINE_TOKEN}` and
validate bodies against the `@openrelay/core` control schemas.

| Method | Path                                    | Body / Result                              |
| ------ | --------------------------------------- | ------------------------------------------ |
| GET    | `/healthz`                              | liveness (public)                          |
| POST   | `/streams/start`                        | `StartStreamRequest` → `StreamRuntime`     |
| POST   | `/streams/stop`                         | `StopStreamRequest`                        |
| POST   | `/streams/scene`                        | `SwitchSceneRequest` → `StreamRuntime`     |
| POST   | `/streams/ingest`                       | `SetActiveIngestRequest` → `StreamRuntime` |
| GET    | `/streams/:streamId/runtime`            | `StreamRuntime`                            |
| GET    | `/streams/:streamId/events`             | SSE stream of `EngineEvent`                |
| POST   | `/internal/ingest/:ingestId/connect`    | `{ streamId, bitrateKbps? }`               |
| POST   | `/internal/ingest/:ingestId/disconnect` | `{ streamId }`                             |
| POST   | `/internal/ingest/:ingestId/heartbeat`  | `{ streamId, bitrateKbps? }`               |

## Configuration

| Variable          | Default                    | Description                         |
| ----------------- | -------------------------- | ----------------------------------- |
| `ENGINE_TOKEN`    | _(required)_               | Bearer token for the control API.   |
| `ENGINE_HOST`     | `0.0.0.0`                  | Bind host.                          |
| `ENGINE_PORT`     | `8090`                     | Control API port.                   |
| `RTMP_PORT`       | `1935`                     | RTMP ingest listener port.          |
| `SRT_PORT`        | `9999`                     | SRT ingest listener port.           |
| `ENGINE_SIMULATE` | `0`                        | `1` = simulated driver (no FFmpeg). |
| `MEDIA_DIR`       | `/var/lib/openrelay/media` | Failover media assets directory.    |
| `LOG_LEVEL`       | `info`                     | Pino log level.                     |

## Development

```bash
pnpm --filter @openrelay/engine dev        # tsx watch
pnpm --filter @openrelay/engine build
pnpm --filter @openrelay/engine typecheck
pnpm --filter @openrelay/engine lint
pnpm --filter @openrelay/engine test
ENGINE_SIMULATE=1 ENGINE_TOKEN=dev node dist/index.js
```

## Docker

The image is multi-stage: build on `node:22`, run on `node:22-bookworm-slim` with
`ffmpeg` installed. Exposes the control, RTMP and SRT ports.

```bash
docker build -f apps/engine/Dockerfile -t openrelay-engine .
```
