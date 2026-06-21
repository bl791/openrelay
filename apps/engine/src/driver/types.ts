import type { Destination, EngineIngest, OutputProfile, Scene } from '@openrelay/core';

/**
 * The video/audio source the output pipeline is currently pulling from. Either a
 * live ingest (the streamer's source feed) or a failover scene shown to viewers
 * while the source is gone. The output to destinations never stops — only the
 * source feeding it changes.
 */
export type EncoderSource =
  | { readonly kind: 'ingest'; readonly ingest: EngineIngest }
  | { readonly kind: 'scene'; readonly scene: Scene };

/** Everything an {@link EncoderDriver} needs to (re)build its output pipeline. */
export interface EncoderPlan {
  readonly streamId: string;
  readonly output: OutputProfile;
  readonly source: EncoderSource;
  /** Only enabled destinations are fanned out to. */
  readonly destinations: readonly Destination[];
  /** Host of the ingest media server the engine reads source feeds out of. */
  readonly ingestHost: string;
  /** Ports the ingest media server's listeners are bound to, for building input URLs. */
  readonly rtmpPort: number;
  readonly srtPort: number;
}

/** Status reported by a driver about its running encoder process. */
export type DriverStatus = 'idle' | 'running' | 'reconnecting' | 'error';

/** A measured throughput sample emitted by the driver as encoding proceeds. */
export interface DriverProgress {
  readonly status: DriverStatus;
  readonly outputBitrateKbps: number;
}

export interface EncoderDriverEvents {
  progress: (progress: DriverProgress) => void;
  /** Fired when the underlying process exits; `restarting` is true while backoff is pending. */
  exit: (info: { readonly code: number | null; readonly restarting: boolean }) => void;
  error: (error: Error) => void;
}

/**
 * Pluggable encoder backend. Implementations own the actual media pipeline; the
 * session state machine drives them by calling {@link start} and
 * {@link switchSource} and never touches FFmpeg (or its simulation) directly.
 */
export interface EncoderDriver {
  /** Begin producing the viewer-facing output for `plan`. Idempotent per session. */
  start(plan: EncoderPlan): Promise<void>;
  /**
   * Swap the source feeding the (still-running) output without tearing down the
   * destination connections — this is the heart of drop protection.
   */
  switchSource(source: EncoderSource): Promise<void>;
  /** Stop the encoder and release all resources. */
  stop(): Promise<void>;
  /** Current driver status. */
  status(): DriverStatus;
  /** Last measured output bitrate in kbps. */
  outputBitrateKbps(): number;
  on<E extends keyof EncoderDriverEvents>(event: E, listener: EncoderDriverEvents[E]): void;
  off<E extends keyof EncoderDriverEvents>(event: E, listener: EncoderDriverEvents[E]): void;
}
