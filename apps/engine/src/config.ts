import { z } from 'zod';

/**
 * Environment-driven configuration for the relay engine.
 *
 * All values are validated once at process start; the rest of the codebase only
 * ever consumes the parsed, typed {@link Config} and never reads `process.env`
 * directly.
 */
const EnvSchema = z.object({
  ENGINE_PORT: z.coerce.number().int().min(1).max(65_535).default(8090),
  ENGINE_HOST: z.string().min(1).default('0.0.0.0'),
  /** Shared secret required as a bearer token on every control endpoint. */
  ENGINE_TOKEN: z.string().min(1),
  /**
   * Host of the ingest media server (MediaMTX) the engine reads source feeds back
   * out of. `127.0.0.1` for a co-located server; the service name (e.g.
   * `mediamtx`) when the media server runs as a separate container.
   */
  INGEST_HOST: z.string().min(1).default('127.0.0.1'),
  /** Port the RTMP ingest listener (MediaMTX) is published on. */
  RTMP_PORT: z.coerce.number().int().min(1).max(65_535).default(1935),
  /** Port the SRT ingest listener (MediaMTX) is published on. */
  SRT_PORT: z.coerce.number().int().min(1).max(65_535).default(8890),
  /**
   * When `1`, use the {@link SimulatedDriver} instead of spawning real FFmpeg
   * processes. Lets the whole engine run in CI / on machines without FFmpeg.
   */
  ENGINE_SIMULATE: z
    .enum(['0', '1'])
    .default('0')
    .transform((v) => v === '1'),
  /** Directory holding failover media assets (BRB images, clip reels, fonts). */
  MEDIA_DIR: z.string().min(1).default('/var/lib/openrelay/media'),
  /**
   * Base URL of the control-plane API. When set, the engine POSTs status
   * reconciliation callbacks (`/internal/engine/status`) so persisted DB state
   * tracks reality. Empty disables callbacks (e.g. in unit tests).
   */
  API_CALLBACK_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' || v === undefined ? null : v.replace(/\/$/, ''))),
  /** Pino log level. */
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = Readonly<{
  port: number;
  host: string;
  token: string;
  ingestHost: string;
  rtmpPort: number;
  srtPort: number;
  simulate: boolean;
  mediaDir: string;
  apiCallbackUrl: string | null;
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
}>;

/**
 * Parse and validate configuration from an environment-like record.
 *
 * @throws {z.ZodError} when required variables are missing or malformed.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  return {
    port: parsed.ENGINE_PORT,
    host: parsed.ENGINE_HOST,
    token: parsed.ENGINE_TOKEN,
    ingestHost: parsed.INGEST_HOST,
    rtmpPort: parsed.RTMP_PORT,
    srtPort: parsed.SRT_PORT,
    simulate: parsed.ENGINE_SIMULATE,
    mediaDir: parsed.MEDIA_DIR,
    apiCallbackUrl: parsed.API_CALLBACK_URL,
    logLevel: parsed.LOG_LEVEL,
  };
}
