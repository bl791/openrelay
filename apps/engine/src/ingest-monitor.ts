import type { IngestStatus } from '@openrelay/core';
import type { Logger } from './logger.js';
import type { SessionManager } from './session-manager.js';

export interface IngestMonitorOptions {
  readonly sessions: SessionManager;
  readonly logger: Logger;
  /**
   * How long after the last heartbeat an ingest is considered `stale`. The
   * upstream RTMP/SRT listener is expected to heartbeat more frequently than this.
   */
  readonly heartbeatTimeoutMs?: number;
  /** How often the monitor sweeps for missed heartbeats. */
  readonly sweepIntervalMs?: number;
  readonly now?: () => number;
}

interface IngestRecord {
  readonly streamId: string;
  status: IngestStatus;
  lastSeenAt: number;
  bitrateKbps: number;
  /**
   * Whether this ingest reports periodic heartbeats. When false, liveness is
   * driven purely by explicit connect/disconnect events (e.g. MediaMTX
   * ready/notready) and the heartbeat-timeout sweep must NOT expire it — the
   * disconnect event is the authoritative "source gone" signal.
   */
  heartbeating: boolean;
}

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 6_000;
const DEFAULT_SWEEP_INTERVAL_MS = 2_000;

/**
 * Tracks ingest connectivity via control hooks invoked by the ingest media server.
 *
 * Wiring: the bundled MediaMTX sidecar calls the engine's `/mediamtx/auth` hook to
 * authorize a publisher, then `runOnReady` / `runOnNotReady` POST to
 * `/internal/ingest/:ingestId/{connect,disconnect}` and a periodic FFmpeg-derived
 * read POSTs `/internal/ingest/:ingestId/heartbeat`. Those routes call
 * {@link connect}, {@link disconnect} and {@link heartbeat} here. The monitor
 * promotes missed heartbeats to `stale` and forwards every transition to the
 * owning {@link StreamSession}, which runs the failover state machine.
 */
export class IngestMonitor {
  readonly #sessions: SessionManager;
  readonly #logger: Logger;
  readonly #heartbeatTimeoutMs: number;
  readonly #sweepIntervalMs: number;
  readonly #now: () => number;
  readonly #records = new Map<string, IngestRecord>();
  #sweepTimer: NodeJS.Timeout | null = null;

  constructor(options: IngestMonitorOptions) {
    this.#sessions = options.sessions;
    this.#logger = options.logger.child({ component: 'ingest-monitor' });
    this.#heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.#sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.#now = options.now ?? Date.now;
  }

  /** Begin the background sweep that detects missed heartbeats. */
  start(): void {
    if (this.#sweepTimer !== null) {
      return;
    }
    this.#sweepTimer = setInterval(() => {
      void this.#sweep();
    }, this.#sweepIntervalMs);
    this.#sweepTimer.unref();
  }

  stop(): void {
    if (this.#sweepTimer !== null) {
      clearInterval(this.#sweepTimer);
      this.#sweepTimer = null;
    }
  }

  /**
   * Source connected and is pushing into ingest `ingestId` of `streamId`. Liveness
   * is then held until an explicit {@link disconnect}; the heartbeat sweep does not
   * apply unless a {@link heartbeat} is subsequently received.
   */
  async connect(streamId: string, ingestId: string, bitrateKbps = 0): Promise<void> {
    this.#records.set(ingestId, {
      streamId,
      status: 'live',
      lastSeenAt: this.#now(),
      bitrateKbps,
      heartbeating: false,
    });
    await this.#report(streamId, ingestId, 'live', bitrateKbps);
  }

  /** Source explicitly disconnected from ingest `ingestId`. */
  async disconnect(streamId: string, ingestId: string): Promise<void> {
    const record = this.#records.get(ingestId);
    if (record !== undefined) {
      record.status = 'offline';
      record.bitrateKbps = 0;
    }
    await this.#report(streamId, ingestId, 'offline', 0);
  }

  /** Periodic liveness ping from an actively-publishing source. */
  async heartbeat(streamId: string, ingestId: string, bitrateKbps = 0): Promise<void> {
    this.#records.set(ingestId, {
      streamId,
      status: 'live',
      lastSeenAt: this.#now(),
      bitrateKbps,
      heartbeating: true,
    });
    // Always refresh liveness + telemetry. A heartbeat for an ingest that had
    // gone stale also re-promotes it to live, which the session uses to leave
    // failover and cut back to the recovered source.
    await this.#report(streamId, ingestId, 'live', bitrateKbps);
  }

  async #sweep(): Promise<void> {
    const now = this.#now();
    const work: Promise<void>[] = [];
    for (const [ingestId, record] of this.#records) {
      if (record.status !== 'live' || !record.heartbeating) {
        // Connect/disconnect-driven ingests (e.g. MediaMTX) are expired only by an
        // explicit disconnect, never by the heartbeat sweep.
        continue;
      }
      if (now - record.lastSeenAt > this.#heartbeatTimeoutMs) {
        record.status = 'stale';
        record.bitrateKbps = 0;
        this.#logger.warn({ ingestId, streamId: record.streamId }, 'ingest heartbeat timed out');
        work.push(this.#report(record.streamId, ingestId, 'stale', 0));
      }
    }
    await Promise.all(work);
  }

  async #report(
    streamId: string,
    ingestId: string,
    status: IngestStatus,
    bitrateKbps: number,
  ): Promise<void> {
    if (!this.#sessions.has(streamId)) {
      this.#logger.debug({ streamId, ingestId }, 'ingest signal for inactive stream ignored');
      return;
    }
    try {
      await this.#sessions.reportIngestStatus(streamId, ingestId, status, bitrateKbps);
    } catch (error) {
      this.#logger.error({ err: error, streamId, ingestId }, 'failed to report ingest status');
    }
  }
}
