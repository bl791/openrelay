import type { ApiError } from '@openrelay/core';

/**
 * Stable machine-readable error codes returned in the {@link ApiError} envelope.
 * The web client switches on these rather than on HTTP status alone.
 */
export type AppErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'engine_error'
  | 'internal_error';

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  engine_error: 502,
  internal_error: 500,
};

/**
 * Domain error carrying a stable {@link AppErrorCode}. Thrown anywhere in route
 * handlers and translated into the core {@link ApiError} shape by the central
 * error handler.
 */
export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly statusCode: number;
  public readonly details: unknown;

  public constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = details;
  }

  public toBody(): ApiError {
    const error: ApiError['error'] =
      this.details === undefined
        ? { code: this.code, message: this.message }
        : { code: this.code, message: this.message, details: this.details };
    return { error };
  }

  public static notFound(message = 'resource not found'): AppError {
    return new AppError('not_found', message);
  }

  public static forbidden(message = 'you do not have access to this resource'): AppError {
    return new AppError('forbidden', message);
  }

  public static unauthorized(message = 'authentication required'): AppError {
    return new AppError('unauthorized', message);
  }

  public static conflict(message: string): AppError {
    return new AppError('conflict', message);
  }
}

/**
 * Raised when an engine HTTP call returns a non-2xx response. Carries the engine's
 * own status code so callers can react to specific cases — e.g. treating a 404 on
 * stop (the session is already gone) as success rather than a hard failure.
 */
export class EngineRequestError extends AppError {
  public readonly engineStatus: number;

  public constructor(engineStatus: number, details?: unknown) {
    super('engine_error', `engine request failed (${String(engineStatus)})`, details);
    this.name = 'EngineRequestError';
    this.engineStatus = engineStatus;
  }
}
