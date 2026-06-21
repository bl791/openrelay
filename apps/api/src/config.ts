import { z } from 'zod';

/**
 * Environment-driven configuration for the control-plane API.
 *
 * Every value is validated once at process start; the rest of the codebase only
 * ever consumes the parsed, typed {@link Config} and never reads `process.env`
 * directly.
 */
const EnvSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  /** Postgres connection string consumed by `@openrelay/db`. */
  DATABASE_URL: z.string().min(1),
  /** Secret used to sign JWT session tokens. Must be long enough to be safe. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /** JWT lifetime, expressed as an `@fastify/jwt` / `ms`-style duration. */
  JWT_EXPIRES_IN: z.string().min(1).default('7d'),
  /** Base URL the relay engine control API is reachable at. */
  ENGINE_URL: z.string().url(),
  /** Shared secret the API presents as a bearer token to the engine. */
  ENGINE_TOKEN: z.string().min(1),
  /**
   * Publicly reachable base URL of this API, used to build browser-facing media
   * URLs that proxy clip content through the API (so the browser never needs to
   * reach the internal object store directly).
   */
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  /** Public host streamers point their encoders at (shown in the dashboard). */
  PUBLIC_INGEST_HOST: z.string().min(1),
  /** RTMP ingest listen port advertised in push URLs. */
  RTMP_PORT: z.coerce.number().int().min(1).max(65_535).default(1935),
  /** SRT ingest listen port advertised in push URLs. */
  SRT_PORT: z.coerce.number().int().min(1).max(65_535).default(9000),
  /** Pino log level. */
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** S3/MinIO endpoint the API talks to for media uploads (server-side). */
  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  /** Publicly reachable base URL objects are served from (used to build URLs). */
  S3_PUBLIC_URL: z.string().url().default('http://localhost:9000'),
  /** AWS-style region; MinIO ignores it but the SDK requires one. */
  S3_REGION: z.string().min(1).default('us-east-1'),
  /** Bucket clips/BRB media are stored in. */
  S3_BUCKET: z.string().min(1).default('openrelay-media'),
  /** Access key for the media bucket. */
  S3_ACCESS_KEY: z.string().min(1).default('minioadmin'),
  /** Secret key for the media bucket. */
  S3_SECRET_KEY: z.string().min(1).default('minioadmin'),
});

export type Config = Readonly<{
  port: number;
  host: string;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  engineUrl: string;
  engineToken: string;
  apiPublicUrl: string;
  publicIngestHost: string;
  rtmpPort: number;
  srtPort: number;
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
  s3: Readonly<{
    endpoint: string;
    publicUrl: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    /** Derived public base URL for objects: `${publicUrl}/${bucket}`. */
    mediaBaseUrl: string;
  }>;
}>;

/**
 * Parse and validate configuration from an environment-like record.
 *
 * @throws {z.ZodError} when required variables are missing or malformed.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  return {
    port: parsed.API_PORT,
    host: parsed.API_HOST,
    databaseUrl: parsed.DATABASE_URL,
    jwtSecret: parsed.JWT_SECRET,
    jwtExpiresIn: parsed.JWT_EXPIRES_IN,
    engineUrl: parsed.ENGINE_URL.replace(/\/$/, ''),
    engineToken: parsed.ENGINE_TOKEN,
    apiPublicUrl: parsed.API_PUBLIC_URL.replace(/\/$/, ''),
    publicIngestHost: parsed.PUBLIC_INGEST_HOST,
    rtmpPort: parsed.RTMP_PORT,
    srtPort: parsed.SRT_PORT,
    logLevel: parsed.LOG_LEVEL,
    s3: {
      endpoint: parsed.S3_ENDPOINT.replace(/\/$/, ''),
      publicUrl: parsed.S3_PUBLIC_URL.replace(/\/$/, ''),
      region: parsed.S3_REGION,
      bucket: parsed.S3_BUCKET,
      accessKey: parsed.S3_ACCESS_KEY,
      secretKey: parsed.S3_SECRET_KEY,
      mediaBaseUrl: `${parsed.S3_PUBLIC_URL.replace(/\/$/, '')}/${parsed.S3_BUCKET}`,
    },
  };
}
