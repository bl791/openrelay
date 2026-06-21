import { TypedEmitter } from './emitter.js';
import type {
  DriverStatus,
  EncoderDriver,
  EncoderDriverEvents,
  EncoderPlan,
  EncoderSource,
} from './types.js';

export interface SimulatedDriverOptions {
  /** Delay before the simulated encoder reports a steady output bitrate. */
  readonly warmupMs?: number;
  /** Simulated steady-state output bitrate. */
  readonly steadyBitrateKbps?: number;
}

const DEFAULT_WARMUP_MS = 250;

/**
 * Fake encoder backend used when `ENGINE_SIMULATE=1`. Spawns no processes and
 * drives status purely on timers, so the full engine — routing, the failover
 * state machine, SSE — runs end-to-end in CI without FFmpeg installed.
 */
export class SimulatedDriver extends TypedEmitter<EncoderDriverEvents> implements EncoderDriver {
  readonly #warmupMs: number;
  readonly #steadyBitrateKbps: number;

  #plan: EncoderPlan | null = null;
  #status: DriverStatus = 'idle';
  #bitrateKbps = 0;
  #warmupTimer: NodeJS.Timeout | null = null;

  constructor(options: SimulatedDriverOptions = {}) {
    super();
    this.#warmupMs = options.warmupMs ?? DEFAULT_WARMUP_MS;
    this.#steadyBitrateKbps = options.steadyBitrateKbps ?? 0;
  }

  start(plan: EncoderPlan): Promise<void> {
    this.#plan = plan;
    this.#beginWarmup();
    return Promise.resolve();
  }

  switchSource(source: EncoderSource): Promise<void> {
    if (this.#plan === null) {
      return Promise.reject(new Error('SimulatedDriver.switchSource called before start'));
    }
    this.#plan = { ...this.#plan, source };
    // A real cut briefly drops throughput; model it then warm back up.
    this.#bitrateKbps = 0;
    this.#beginWarmup();
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.#clearWarmup();
    this.#status = 'idle';
    this.#bitrateKbps = 0;
    this.#plan = null;
    return Promise.resolve();
  }

  status(): DriverStatus {
    return this.#status;
  }

  outputBitrateKbps(): number {
    return this.#bitrateKbps;
  }

  #beginWarmup(): void {
    this.#clearWarmup();
    this.#status = 'running';
    const target =
      this.#steadyBitrateKbps > 0
        ? this.#steadyBitrateKbps
        : (this.#plan?.output.videoBitrateKbps ?? 0) + (this.#plan?.output.audioBitrateKbps ?? 0);
    this.#warmupTimer = setTimeout(() => {
      this.#warmupTimer = null;
      this.#bitrateKbps = target;
      this.emit('progress', { status: 'running', outputBitrateKbps: target });
    }, this.#warmupMs);
  }

  #clearWarmup(): void {
    if (this.#warmupTimer !== null) {
      clearTimeout(this.#warmupTimer);
      this.#warmupTimer = null;
    }
  }
}
