import type { EngineEvent, EngineStreamSpec, IngestStatus, StreamRuntime } from '@openrelay/core';
import type { Config } from './config.js';
import type { DriverFactory } from './driver/index.js';
import type { Logger } from './logger.js';
import { StreamSession } from './stream-session.js';

export type EngineEventListener = (event: EngineEvent) => void;

/**
 * Registry of all live {@link StreamSession}s, keyed by stream id. The HTTP layer
 * talks only to this manager; it never touches sessions or drivers directly.
 */
export class SessionManager {
  readonly #sessions = new Map<string, StreamSession>();
  readonly #listeners = new Map<string, Set<EngineEventListener>>();
  readonly #globalListeners = new Set<EngineEventListener>();
  readonly #config: Config;
  readonly #driverFactory: DriverFactory;
  readonly #logger: Logger;

  constructor(config: Config, driverFactory: DriverFactory, logger: Logger) {
    this.#config = config;
    this.#driverFactory = driverFactory;
    this.#logger = logger.child({ component: 'session-manager' });
  }

  /**
   * Subscribe to events across all streams (used for status reconciliation to the
   * API). Returns an unsubscribe function.
   */
  onAnyEvent(listener: EngineEventListener): () => void {
    this.#globalListeners.add(listener);
    return () => this.#globalListeners.delete(listener);
  }

  has(streamId: string): boolean {
    return this.#sessions.has(streamId);
  }

  /**
   * Resolve an inbound publish path/stream-key (as presented by the ingest media
   * server) to the owning stream and ingest. Returns `null` when no live session
   * has an ingest with that key — i.e. the publish should be rejected.
   */
  resolveIngestKey(streamKey: string): { streamId: string; ingestId: string } | null {
    for (const [streamId, session] of this.#sessions) {
      const ingest = session.spec.ingests.find((candidate) => candidate.streamKey === streamKey);
      if (ingest !== undefined) {
        return { streamId, ingestId: ingest.id };
      }
    }
    return null;
  }

  /** Start a new session from a validated spec. Rejects if already running. */
  async start(spec: EngineStreamSpec): Promise<StreamRuntime> {
    if (this.#sessions.has(spec.streamId)) {
      throw new Error(`stream ${spec.streamId} is already running`);
    }
    const session = new StreamSession({
      spec,
      driver: this.#driverFactory(),
      logger: this.#logger,
      ingestHost: this.#config.ingestHost,
      rtmpPort: this.#config.rtmpPort,
      srtPort: this.#config.srtPort,
    });
    session.on('event', (event) => {
      this.#fanout(spec.streamId, event);
    });
    this.#sessions.set(spec.streamId, session);
    try {
      await session.start();
    } catch (error) {
      this.#sessions.delete(spec.streamId);
      throw error;
    }
    this.#logger.info({ streamId: spec.streamId }, 'stream started');
    return session.runtime();
  }

  async stop(streamId: string): Promise<void> {
    const session = this.#require(streamId);
    await session.stop();
    this.#sessions.delete(streamId);
    this.#listeners.delete(streamId);
    this.#logger.info({ streamId }, 'stream stopped');
  }

  async switchScene(streamId: string, sceneId: string): Promise<StreamRuntime> {
    const session = this.#require(streamId);
    await session.switchScene(sceneId);
    return session.runtime();
  }

  async setActiveIngest(streamId: string, ingestId: string): Promise<StreamRuntime> {
    const session = this.#require(streamId);
    await session.setActiveIngest(ingestId);
    return session.runtime();
  }

  async reportIngestStatus(
    streamId: string,
    ingestId: string,
    status: IngestStatus,
    bitrateKbps?: number,
  ): Promise<void> {
    const session = this.#require(streamId);
    await session.onIngestStatus(ingestId, status, bitrateKbps);
  }

  runtime(streamId: string): StreamRuntime {
    return this.#require(streamId).runtime();
  }

  list(): StreamRuntime[] {
    return [...this.#sessions.values()].map((session) => session.runtime());
  }

  /** Subscribe to a stream's events (used by the SSE endpoint). Returns an unsubscribe. */
  subscribe(streamId: string, listener: EngineEventListener): () => void {
    const set = this.#listeners.get(streamId) ?? new Set();
    set.add(listener);
    this.#listeners.set(streamId, set);
    return () => {
      this.#listeners.get(streamId)?.delete(listener);
    };
  }

  /** Stop every session (graceful shutdown). */
  async stopAll(): Promise<void> {
    const ids = [...this.#sessions.keys()];
    await Promise.all(
      ids.map(async (id) => {
        try {
          await this.stop(id);
        } catch (error) {
          this.#logger.error({ err: error, streamId: id }, 'error stopping stream during shutdown');
        }
      }),
    );
  }

  #fanout(streamId: string, event: EngineEvent): void {
    for (const listener of [...this.#globalListeners]) {
      listener(event);
    }
    const set = this.#listeners.get(streamId);
    if (set === undefined) {
      return;
    }
    for (const listener of [...set]) {
      listener(event);
    }
  }

  #require(streamId: string): StreamSession {
    const session = this.#sessions.get(streamId);
    if (session === undefined) {
      throw new Error(`stream ${streamId} is not running`);
    }
    return session;
  }
}
