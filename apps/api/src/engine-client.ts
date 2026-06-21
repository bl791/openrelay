import {
  SetActiveIngestRequest,
  StartStreamRequest,
  StopStreamRequest,
  StreamRuntime,
  SwitchSceneRequest,
  type EngineStreamSpec,
  type IngestId,
  type SceneId,
  type StreamId,
} from '@openrelay/core';
import { AppError, EngineRequestError } from './errors.js';

export interface EngineClientOptions {
  /** Base URL of the engine control API, without a trailing slash. */
  baseUrl: string;
  /** Shared secret sent as a bearer token on every request. */
  token: string;
  /** Injectable fetch implementation (defaults to the global `fetch`). */
  fetch?: typeof fetch;
}

/**
 * Typed wrapper around the relay engine's HTTP control API. Request bodies are
 * built from `@openrelay/core` protocol schemas and responses are validated with
 * the same schemas, so a malformed engine response surfaces as an
 * {@link AppError} rather than leaking an untyped value into route handlers.
 */
export class EngineClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: EngineClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetch ?? fetch;
  }

  public async startStream(spec: EngineStreamSpec): Promise<StreamRuntime> {
    const body = StartStreamRequest.parse({ spec });
    const json = await this.send('POST', '/streams/start', body);
    return StreamRuntime.parse(json);
  }

  /**
   * Stop a running broadcast. A 404 from the engine means the session is already
   * gone (e.g. the engine restarted), which for a stop request is success — the
   * caller still reconciles its own persisted state to `offline`.
   */
  public async stopStream(streamId: StreamId): Promise<void> {
    const body = StopStreamRequest.parse({ streamId });
    try {
      await this.send('POST', '/streams/stop', body);
    } catch (error) {
      if (error instanceof EngineRequestError && error.engineStatus === 404) {
        return;
      }
      throw error;
    }
  }

  public async switchScene(streamId: StreamId, sceneId: SceneId): Promise<StreamRuntime> {
    const body = SwitchSceneRequest.parse({ streamId, sceneId });
    const json = await this.send('POST', '/streams/scene', body);
    return StreamRuntime.parse(json);
  }

  public async setActiveIngest(streamId: StreamId, ingestId: IngestId): Promise<StreamRuntime> {
    const body = SetActiveIngestRequest.parse({ streamId, ingestId });
    const json = await this.send('POST', '/streams/ingest', body);
    return StreamRuntime.parse(json);
  }

  public async getRuntime(streamId: StreamId): Promise<StreamRuntime> {
    const json = await this.send('GET', `/streams/${streamId}/runtime`);
    return StreamRuntime.parse(json);
  }

  /**
   * Open the engine's Server-Sent Events stream for a running broadcast. The raw
   * `Response` is returned so callers can pipe the body straight to a browser.
   */
  public async openEventStream(streamId: StreamId, signal?: AbortSignal): Promise<Response> {
    const response = await this.rawFetch('GET', `/streams/${streamId}/events`, undefined, {
      accept: 'text/event-stream',
      signal,
    });
    if (!response.ok || response.body === null) {
      throw new AppError('engine_error', `engine event stream failed (${String(response.status)})`);
    }
    return response;
  }

  private async send(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.rawFetch(method, path, body, { accept: 'application/json' });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new EngineRequestError(response.status, detail.length > 0 ? detail : undefined);
    }
    if (response.status === 204) {
      return undefined;
    }
    return await response.json();
  }

  private async rawFetch(
    method: string,
    path: string,
    body: unknown,
    options: { accept: string; signal?: AbortSignal | undefined },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      accept: options.accept,
    };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    if (options.signal) {
      init.signal = options.signal;
    }
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new AppError('engine_error', `could not reach engine: ${message}`);
    }
  }
}
