import type { EngineEvent } from '@openrelay/core';
import type { Logger } from './logger.js';

export interface StatusReporterOptions {
  /** Base URL of the control-plane API, or `null` to disable reporting. */
  readonly apiCallbackUrl: string | null;
  /** Shared bearer token presented to the API callback endpoint. */
  readonly token: string;
  readonly logger: Logger;
  /** Injectable fetch (defaults to global fetch); enables testing. */
  readonly fetchFn?: typeof fetch;
}

/**
 * Forwards {@link EngineEvent}s to the control-plane API so that persisted DB
 * state (stream / ingest / destination status, failover, active scene) reflects
 * the engine's in-memory reality instead of write-once defaults.
 *
 * Failures are logged and swallowed: a missed status callback must never disrupt
 * the live broadcast.
 */
export class StatusReporter {
  readonly #url: string | null;
  readonly #token: string;
  readonly #logger: Logger;
  readonly #fetch: typeof fetch;

  constructor(options: StatusReporterOptions) {
    this.#url = options.apiCallbackUrl;
    this.#token = options.token;
    this.#logger = options.logger.child({ component: 'status-reporter' });
    this.#fetch = options.fetchFn ?? fetch;
  }

  get enabled(): boolean {
    return this.#url !== null;
  }

  /** Fire-and-forget delivery of a single engine event to the API. */
  report(event: EngineEvent): void {
    if (this.#url === null) {
      return;
    }
    void this.#post(event);
  }

  async #post(event: EngineEvent): Promise<void> {
    try {
      const response = await this.#fetch(`${this.#url ?? ''}/internal/engine/status`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.#token}`,
        },
        body: JSON.stringify({ event }),
      });
      if (!response.ok) {
        this.#logger.warn(
          { status: response.status, type: event.type },
          'status callback rejected by API',
        );
      }
    } catch (error) {
      this.#logger.warn({ err: error, type: event.type }, 'status callback delivery failed');
    }
  }
}
