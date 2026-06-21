import { z } from 'zod';

/**
 * Environment-driven configuration for the control-plane API.
 *
 * Every value is validated once at process start; the rest of the codebase only
 * ever consumes the parsed, typed {@link Config} and never reads `process.env`
 * directly.
 */
/**
 * Treat empty/whitespace-only env values as absent. Compose always sets keys
 * (e.g. `TWITCH_CLIENT_ID=`), so an unset optional arrives as `''`, which would
 * otherwise fail `.min(1)` and crash startup. This coerces those to `undefined`.
 */
const optionalNonEmpty = (schema: z.ZodString): z.ZodOptional<z.ZodString> =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    schema.optional(),
  ) as unknown as z.ZodOptional<z.ZodString>;

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
  /**
   * Twitch application client id. When this and {@link TWITCH_CLIENT_SECRET} are
   * absent the Twitch import feature is disabled (`config.twitch.isConfigured`
   * is false) and the routes return a clear 400.
   */
  TWITCH_CLIENT_ID: optionalNonEmpty(z.string().min(1)),
  /** Twitch application client secret (paired with {@link TWITCH_CLIENT_ID}). */
  TWITCH_CLIENT_SECRET: optionalNonEmpty(z.string().min(1)),
  /**
   * OAuth redirect URI registered with the Twitch app. Defaults to this API's
   * public callback under the `/api` prefix.
   */
  TWITCH_REDIRECT_URI: optionalNonEmpty(z.string().url()),
  /**
   * Key used to encrypt stored OAuth tokens at rest (AES-256-GCM). Any non-empty
   * string works; it is hashed to a 32-byte key. Defaults to deriving from
   * {@link JWT_SECRET} so local/test setups need no extra configuration.
   */
  TOKEN_ENCRYPTION_KEY: optionalNonEmpty(z.string().min(1)),
  /**
   * Base URL of the web dashboard the Twitch OAuth callback redirects back to
   * once an account is linked.
   */
  WEB_APP_URL: z.string().url().default('http://localhost:3000'),
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
  /** Per-user Twitch OAuth + clip import configuration. */
  twitch: Readonly<{
    /** Whether both client id and secret are present (feature enabled). */
    isConfigured: boolean;
    /** Twitch app client id, or `null` when the feature is disabled. */
    clientId: string | null;
    /** Twitch app client secret, or `null` when the feature is disabled. */
    clientSecret: string | null;
    /** OAuth redirect URI registered with the Twitch app. */
    redirectUri: string;
    /** Symmetric key material for encrypting stored OAuth tokens at rest. */
    tokenEncryptionKey: string;
    /** Web dashboard base URL the OAuth callback redirects back to. */
    webRedirect: string;
  }>;
}>;

/**
 * Parse and validate configuration from an environment-like record.
 *
 * @throws {z.ZodError} when required variables are missing or malformed.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  const apiPublicUrl = parsed.API_PUBLIC_URL.replace(/\/$/, '');
  const twitchConfigured =
    parsed.TWITCH_CLIENT_ID !== undefined && parsed.TWITCH_CLIENT_SECRET !== undefined;
  return {
    port: parsed.API_PORT,
    host: parsed.API_HOST,
    databaseUrl: parsed.DATABASE_URL,
    jwtSecret: parsed.JWT_SECRET,
    jwtExpiresIn: parsed.JWT_EXPIRES_IN,
    engineUrl: parsed.ENGINE_URL.replace(/\/$/, ''),
    engineToken: parsed.ENGINE_TOKEN,
    apiPublicUrl,
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
    twitch: {
      isConfigured: twitchConfigured,
      clientId: parsed.TWITCH_CLIENT_ID ?? null,
      clientSecret: parsed.TWITCH_CLIENT_SECRET ?? null,
      redirectUri: parsed.TWITCH_REDIRECT_URI ?? `${apiPublicUrl}/api/twitch/callback`,
      // Fall back to the JWT secret so local/dev/test never need an extra var;
      // the crypto helper hashes whatever it is given down to a 32-byte key.
      tokenEncryptionKey: parsed.TOKEN_ENCRYPTION_KEY ?? parsed.JWT_SECRET,
      webRedirect: parsed.WEB_APP_URL.replace(/\/$/, ''),
    },
  };
}
