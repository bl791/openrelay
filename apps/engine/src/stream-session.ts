import type {
  Destination,
  DestinationRuntime,
  EngineEvent,
  EngineIngest,
  EngineStreamSpec,
  IngestRuntime,
  IngestStatus,
  Scene,
  StreamRuntime,
  StreamStatus,
} from '@openrelay/core';
import type { EncoderDriver, EncoderSource } from './driver/index.js';
import { TypedEmitter } from './driver/emitter.js';
import type { Logger } from './logger.js';

export interface StreamSessionEvents {
  event: (event: EngineEvent) => void;
}

export interface StreamSessionDeps {
  readonly spec: EngineStreamSpec;
  readonly driver: EncoderDriver;
  readonly logger: Logger;
  readonly ingestHost: string;
  readonly rtmpPort: number;
  readonly srtPort: number;
  /** Clock injection so tests can advance time deterministically. */
  readonly now?: () => number;
}

/**
 * Per-stream finite state machine. It is the authority on the drop-protection
 * guarantee: while the active ingest is healthy the output follows it; when the
 * ingest drops it starts a grace timer, and only if recovery does not happen
 * within `failover.graceSeconds` does it cut the output to the failover scene.
 * The output itself (and thus the destination connections) is never torn down.
 */
export class StreamSession extends TypedEmitter<StreamSessionEvents> {
  readonly #spec: EngineStreamSpec;
  readonly #driver: EncoderDriver;
  readonly #logger: Logger;
  readonly #ingestHost: string;
  readonly #rtmpPort: number;
  readonly #srtPort: number;
  readonly #now: () => number;

  #status: StreamStatus = 'offline';
  #activeIngestId: string | null;
  #activeSceneId: string | null;
  #onFailover = false;
  #startedAt: number | null = null;
  #graceTimer: NodeJS.Timeout | null = null;

  /** Last observed status per ingest id. */
  readonly #ingestStatus = new Map<string, IngestStatus>();
  /** Last observed throughput per ingest id (informational). */
  readonly #ingestBitrate = new Map<string, number>();
  /** Last reported status per destination id. */
  readonly #destinationStatus = new Map<string, DestinationRuntime>();

  constructor(deps: StreamSessionDeps) {
    super();
    this.#spec = deps.spec;
    this.#driver = deps.driver;
    this.#logger = deps.logger.child({ component: 'stream-session', streamId: deps.spec.streamId });
    this.#ingestHost = deps.ingestHost;
    this.#rtmpPort = deps.rtmpPort;
    this.#srtPort = deps.srtPort;
    this.#now = deps.now ?? Date.now;

    this.#activeSceneId = deps.spec.activeSceneId;
    this.#activeIngestId = deps.spec.ingests[0]?.id ?? null;

    for (const ingest of deps.spec.ingests) {
      this.#ingestStatus.set(ingest.id, 'offline');
      this.#ingestBitrate.set(ingest.id, 0);
    }
    for (const destination of deps.spec.destinations) {
      this.#destinationStatus.set(destination.id, {
        id: destination.id,
        status: destination.enabled ? 'connecting' : 'idle',
        bitrateKbps: 0,
        error: null,
      });
    }

    this.#driver.on('progress', this.#onDriverProgress);
    this.#driver.on('error', this.#onDriverError);
  }

  /** The immutable broadcast spec this session was started with. */
  get spec(): EngineStreamSpec {
    return this.#spec;
  }

  // --- lifecycle -----------------------------------------------------------

  async start(): Promise<void> {
    this.#status = 'starting';
    this.#startedAt = this.#now();
    await this.#driver.start({
      streamId: this.#spec.streamId,
      output: this.#spec.output,
      source: this.#resolveSource(),
      destinations: this.#spec.destinations,
      ingestHost: this.#ingestHost,
      rtmpPort: this.#rtmpPort,
      srtPort: this.#srtPort,
    });
    this.#status = 'live';
    this.#markEnabledDestinationsLive();
    this.#emitRuntime();
  }

  async stop(): Promise<void> {
    this.#status = 'stopping';
    this.#clearGraceTimer();
    this.#driver.off('progress', this.#onDriverProgress);
    this.#driver.off('error', this.#onDriverError);
    await this.#driver.stop();
    this.#status = 'offline';
    this.#emitRuntime();
  }

  // --- manual control ------------------------------------------------------

  /** Operator manually selects which ingest drives the broadcast. */
  async setActiveIngest(ingestId: string): Promise<void> {
    const ingest = this.#spec.ingests.find((i) => i.id === ingestId);
    if (ingest === undefined) {
      throw new Error(`unknown ingest: ${ingestId}`);
    }
    this.#activeIngestId = ingestId;
    this.#clearGraceTimer();

    const status = this.#ingestStatus.get(ingestId) ?? 'offline';
    if (status === 'live') {
      await this.#leaveFailover(ingest);
    } else {
      // Switching to a dead ingest immediately protects the broadcast.
      await this.#enterFailover();
    }
    this.#emitRuntime();
  }

  /** Operator manually switches the displayed scene. */
  async switchScene(sceneId: string): Promise<void> {
    const scene = this.#spec.scenes.find((s) => s.id === sceneId);
    if (scene === undefined) {
      throw new Error(`unknown scene: ${sceneId}`);
    }
    this.#activeSceneId = sceneId;
    this.#clearGraceTimer();

    if (scene.kind === 'ingest' && scene.ingestId !== null) {
      this.#activeIngestId = scene.ingestId;
      const status = this.#ingestStatus.get(scene.ingestId) ?? 'offline';
      if (status === 'live') {
        this.#onFailover = false;
        await this.#driver.switchSource(this.#resolveSource());
      } else {
        await this.#enterFailover();
      }
    } else {
      // A non-ingest scene is an explicit operator-chosen source.
      this.#onFailover = false;
      await this.#driver.switchSource({ kind: 'scene', scene });
    }

    this.#emit({
      type: 'scene_changed',
      streamId: this.#sid(),
      sceneId: this.#castSceneId(sceneId),
    });
    this.#emitRuntime();
  }

  // --- ingest health -------------------------------------------------------

  /**
   * Report an observed ingest status transition (from the ingest monitor). Drives
   * the failover state machine for the *active* ingest.
   */
  async onIngestStatus(ingestId: string, status: IngestStatus, bitrateKbps = 0): Promise<void> {
    if (!this.#ingestStatus.has(ingestId)) {
      this.#logger.warn({ ingestId }, 'status for unknown ingest ignored');
      return;
    }
    const previous = this.#ingestStatus.get(ingestId);
    this.#ingestStatus.set(ingestId, status);
    this.#ingestBitrate.set(ingestId, status === 'live' ? bitrateKbps : 0);

    if (previous !== status) {
      this.#emit({
        type: 'ingest_status',
        streamId: this.#sid(),
        ingestId: this.#castIngestId(ingestId),
        status,
      });
    }

    if (ingestId !== this.#activeIngestId) {
      // Non-active ingests only update telemetry; they never move the FSM.
      this.#emitRuntime();
      return;
    }

    if (status === 'live') {
      const ingest = this.#spec.ingests.find((i) => i.id === ingestId);
      if (ingest !== undefined) {
        await this.#recover(ingest);
      }
    } else if (status === 'offline' || status === 'stale') {
      this.#armGraceTimer();
    }

    this.#emitRuntime();
  }

  // --- failover internals --------------------------------------------------

  #armGraceTimer(): void {
    if (this.#onFailover || this.#graceTimer !== null) {
      return;
    }
    const graceMs = this.#spec.failover.graceSeconds * 1_000;
    this.#logger.info({ graceMs }, 'active ingest unhealthy; arming failover grace timer');
    if (graceMs === 0) {
      // Zero grace means cut immediately.
      void this.#enterFailover().then(() => {
        this.#emitRuntime();
      });
      return;
    }
    this.#graceTimer = setTimeout(() => {
      this.#graceTimer = null;
      // Re-check: the ingest may have recovered before the timer's microtask runs.
      const current =
        this.#activeIngestId === null ? undefined : this.#ingestStatus.get(this.#activeIngestId);
      if (current === 'live') {
        return;
      }
      void this.#enterFailover().then(() => {
        this.#emitRuntime();
      });
    }, graceMs);
  }

  #clearGraceTimer(): void {
    if (this.#graceTimer !== null) {
      clearTimeout(this.#graceTimer);
      this.#graceTimer = null;
    }
  }

  async #enterFailover(): Promise<void> {
    this.#clearGraceTimer();
    if (this.#onFailover) {
      return;
    }
    this.#onFailover = true;
    this.#status = 'failover';
    const scene = this.#failoverScene();
    this.#logger.warn({ sceneId: scene.id, mode: this.#spec.failover.mode }, 'entering failover');
    await this.#driver.switchSource({ kind: 'scene', scene });
    this.#emit({ type: 'failover', streamId: this.#sid(), active: true });
  }

  async #recover(ingest: EngineIngest): Promise<void> {
    this.#clearGraceTimer();
    if (!this.#onFailover) {
      return;
    }
    await this.#leaveFailover(ingest);
  }

  async #leaveFailover(ingest: EngineIngest): Promise<void> {
    this.#onFailover = false;
    this.#status = 'live';
    this.#logger.info({ ingestId: ingest.id }, 'leaving failover; cutting back to live source');
    await this.#driver.switchSource({ kind: 'ingest', ingest });
    this.#emit({ type: 'failover', streamId: this.#sid(), active: false });
  }

  /**
   * Resolve the scene to display during failover: the configured fallback scene,
   * else the first scene matching the failover mode, else any non-ingest scene,
   * else a synthesized black slate.
   */
  #failoverScene(): Scene {
    const { fallbackSceneId, mode } = this.#spec.failover;
    const byId =
      fallbackSceneId === null
        ? undefined
        : this.#spec.scenes.find((s) => s.id === fallbackSceneId);
    if (byId !== undefined) {
      return byId;
    }
    const byMode = this.#spec.scenes.find((s) => s.kind === mode);
    if (byMode !== undefined) {
      return byMode;
    }
    const anyNonIngest = this.#spec.scenes.find((s) => s.kind !== 'ingest');
    if (anyNonIngest !== undefined) {
      return anyNonIngest;
    }
    return this.#syntheticSlate();
  }

  #syntheticSlate(): Scene {
    return {
      id: this.#castSceneId(`${this.#spec.streamId}-failover`),
      streamId: this.#spec.streamId,
      label: 'Failover',
      kind: this.#spec.failover.mode === 'freeze' ? 'image' : 'color',
      ingestId: null,
      assetUrl: null,
      clipId: null,
      color: '#000000',
      position: 0,
    };
  }

  /** Resolve the source for the current active scene/ingest selection. */
  #resolveSource(): EncoderSource {
    if (this.#onFailover) {
      return { kind: 'scene', scene: this.#failoverScene() };
    }
    const scene =
      this.#activeSceneId === null
        ? undefined
        : this.#spec.scenes.find((s) => s.id === this.#activeSceneId);
    if (scene !== undefined && scene.kind !== 'ingest') {
      return { kind: 'scene', scene };
    }
    const ingest =
      this.#activeIngestId === null
        ? undefined
        : this.#spec.ingests.find((i) => i.id === this.#activeIngestId);
    if (ingest !== undefined) {
      return { kind: 'ingest', ingest };
    }
    return { kind: 'scene', scene: this.#failoverScene() };
  }

  // --- telemetry -----------------------------------------------------------

  #markEnabledDestinationsLive(): void {
    for (const destination of this.#spec.destinations) {
      if (destination.enabled) {
        this.#setDestinationStatus(destination, 'live', null);
      }
    }
  }

  #setDestinationStatus(
    destination: Destination,
    status: DestinationRuntime['status'],
    error: string | null,
  ): void {
    this.#destinationStatus.set(destination.id, {
      id: destination.id,
      status,
      bitrateKbps: status === 'live' ? this.#driver.outputBitrateKbps() : 0,
      error,
    });
    this.#emit({
      type: 'destination_status',
      streamId: this.#sid(),
      destinationId: destination.id,
      status,
      error,
    });
  }

  readonly #onDriverProgress = (): void => {
    // A progress tick means the shared encode is flowing; reflect it onto every
    // enabled destination's bitrate snapshot.
    const bitrate = this.#driver.outputBitrateKbps();
    for (const destination of this.#spec.destinations) {
      if (!destination.enabled) {
        continue;
      }
      const current = this.#destinationStatus.get(destination.id);
      this.#destinationStatus.set(destination.id, {
        id: destination.id,
        status: 'live',
        bitrateKbps: bitrate,
        error: current?.error ?? null,
      });
    }
    this.#emitRuntime();
  };

  readonly #onDriverError = (error: Error): void => {
    this.#logger.error({ err: error }, 'encoder driver error');
    for (const destination of this.#spec.destinations) {
      if (destination.enabled) {
        this.#setDestinationStatus(destination, 'error', error.message);
      }
    }
    this.#emitRuntime();
  };

  runtime(): StreamRuntime {
    const ingests: IngestRuntime[] = this.#spec.ingests.map((ingest) => ({
      id: ingest.id,
      status: this.#ingestStatus.get(ingest.id) ?? 'offline',
      bitrateKbps: this.#ingestBitrate.get(ingest.id) ?? 0,
      isActive: ingest.id === this.#activeIngestId,
    }));
    const destinations: DestinationRuntime[] = this.#spec.destinations.map(
      (destination) =>
        this.#destinationStatus.get(destination.id) ?? {
          id: destination.id,
          status: 'idle',
          bitrateKbps: 0,
          error: null,
        },
    );
    return {
      streamId: this.#sid(),
      status: this.#status,
      activeSceneId: this.#activeSceneId === null ? null : this.#castSceneId(this.#activeSceneId),
      uptimeSeconds:
        this.#startedAt === null
          ? 0
          : Math.max(0, Math.floor((this.#now() - this.#startedAt) / 1_000)),
      onFailover: this.#onFailover,
      ingests,
      destinations,
    };
  }

  get status(): StreamStatus {
    return this.#status;
  }

  get onFailover(): boolean {
    return this.#onFailover;
  }

  get activeIngestId(): string | null {
    return this.#activeIngestId;
  }

  #emitRuntime(): void {
    this.#emit({ type: 'runtime', runtime: this.runtime() });
  }

  #emit(event: EngineEvent): void {
    this.emit('event', event);
  }

  // --- branded-id helpers --------------------------------------------------
  // The core schemas brand ids; ids flowing through the session originate from
  // already-validated specs, so re-applying the brand here is a safe cast.

  #sid(): StreamRuntime['streamId'] {
    return this.#spec.streamId;
  }

  #castSceneId(id: string): NonNullable<StreamRuntime['activeSceneId']> {
    return id as NonNullable<StreamRuntime['activeSceneId']>;
  }

  #castIngestId(id: string): IngestRuntime['id'] {
    return id as IngestRuntime['id'];
  }
}
