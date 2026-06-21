import { pino, type Logger, type LoggerOptions } from 'pino';

/**
 * Create the single root logger for the API. Fastify reuses this instance so that
 * request logs and application-internal logs share formatting and level.
 */
export type LogLevel = NonNullable<LoggerOptions['level']>;

export function createLogger(level: LogLevel): Logger {
  return pino({
    level,
    base: { service: 'openrelay-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type { Logger };
