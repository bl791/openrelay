import { type ChildProcessByStdio, spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { Logger } from '../logger.js';
import { TypedEmitter } from './emitter.js';
import { buildFfmpegArgs } from './ffmpeg-args.js';
import type {
  DriverStatus,
  EncoderDriver,
  EncoderDriverEvents,
  EncoderPlan,
  EncoderSource,
} from './types.js';

export interface FfmpegDriverOptions {
  readonly binary?: string;
  readonly logger: Logger;
  /** Base backoff applied between crash restarts; grows linearly, capped. */
  readonly restartBaseMs?: number;
  readonly restartMaxMs?: number;
  /** Spawn hook, injectable for testing without a real ffmpeg binary. */
  readonly spawnFn?: typeof spawn;
}

const DEFAULT_RESTART_BASE_MS = 1_000;
const DEFAULT_RESTART_MAX_MS = 15_000;

/**
 * Real encoder backend: supervises a long-lived FFmpeg process that maintains the
 * viewer-facing output and fans it out to every destination via the `tee` muxer.
 *
 * On crash it restarts with linear backoff, preserving the current source so the
 * broadcast self-heals. Switching source (e.g. cutting to failover) restarts the
 * process with a new input; the destination connections are re-established within
 * FFmpeg's reconnect window so viewers see a brief cut rather than the stream
 * ending.
 */
export class FfmpegDriver extends TypedEmitter<EncoderDriverEvents> implements EncoderDriver {
  readonly #binary: string;
  readonly #logger: Logger;
  readonly #restartBaseMs: number;
  readonly #restartMaxMs: number;
  readonly #spawnFn: typeof spawn;

  #plan: EncoderPlan | null = null;
  #child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  #status: DriverStatus = 'idle';
  #bitrateKbps = 0;
  #restartAttempts = 0;
  #restartTimer: NodeJS.Timeout | null = null;
  #stopping = false;

  constructor(options: FfmpegDriverOptions) {
    super();
    this.#binary = options.binary ?? 'ffmpeg';
    this.#logger = options.logger.child({ component: 'ffmpeg-driver' });
    this.#restartBaseMs = options.restartBaseMs ?? DEFAULT_RESTART_BASE_MS;
    this.#restartMaxMs = options.restartMaxMs ?? DEFAULT_RESTART_MAX_MS;
    this.#spawnFn = options.spawnFn ?? spawn;
  }

  start(plan: EncoderPlan): Promise<void> {
    this.#plan = plan;
    this.#stopping = false;
    this.#restartAttempts = 0;
    this.#spawn();
    return Promise.resolve();
  }

  switchSource(source: EncoderSource): Promise<void> {
    if (this.#plan === null) {
      return Promise.reject(new Error('FfmpegDriver.switchSource called before start'));
    }
    this.#plan = { ...this.#plan, source };
    this.#restartAttempts = 0;
    // Tear down the current process; respawn synchronously with the new source.
    this.#killChild();
    this.#spawn();
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.#stopping = true;
    if (this.#restartTimer !== null) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }
    this.#killChild();
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

  #spawn(): void {
    const plan = this.#plan;
    if (plan === null || this.#stopping) {
      return;
    }

    let args: string[];
    try {
      args = buildFfmpegArgs(plan);
    } catch (error) {
      this.#status = 'error';
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      return;
    }

    this.#logger.info({ args }, 'spawning ffmpeg');
    const child = this.#spawnFn(this.#binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.#child = child;
    this.#status = 'running';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.#parseProgress(chunk);
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.#logger.debug({ ffmpeg: chunk.trimEnd() }, 'ffmpeg stderr');
    });

    child.on('error', (error: Error) => {
      this.#logger.error({ err: error }, 'ffmpeg spawn error');
      this.#status = 'error';
      this.emit('error', error);
    });

    child.on('exit', (code: number | null) => {
      this.#child = null;
      const restarting = !this.#stopping;
      this.#logger.warn({ code, restarting }, 'ffmpeg exited');
      this.emit('exit', { code, restarting });
      if (restarting) {
        this.#scheduleRestart();
      }
    });
  }

  #scheduleRestart(): void {
    this.#restartAttempts += 1;
    this.#status = 'reconnecting';
    const delay = Math.min(this.#restartBaseMs * this.#restartAttempts, this.#restartMaxMs);
    this.#logger.info({ attempt: this.#restartAttempts, delay }, 'scheduling ffmpeg restart');
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      this.#spawn();
    }, delay);
  }

  #killChild(): void {
    const child = this.#child;
    if (child === null) {
      return;
    }
    this.#child = null;
    child.removeAllListeners('exit');
    child.kill('SIGTERM');
    // Escalate if FFmpeg ignores the polite signal.
    const sigkill = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }, 3_000);
    sigkill.unref();
  }

  /**
   * Parse FFmpeg's `-progress` key=value stream. The `bitrate` field reports the
   * combined output throughput; a fresh sample also confirms the encoder is live.
   */
  #parseProgress(chunk: string): void {
    for (const line of chunk.split('\n')) {
      const eq = line.indexOf('=');
      if (eq === -1) {
        continue;
      }
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (key === 'bitrate') {
        const kbps = Number.parseFloat(value.replace(/kbits\/s$/i, ''));
        if (Number.isFinite(kbps) && kbps >= 0) {
          this.#bitrateKbps = Math.round(kbps);
        }
      } else if (key === 'progress') {
        this.#status = 'running';
        this.#restartAttempts = 0;
        this.emit('progress', { status: 'running', outputBitrateKbps: this.#bitrateKbps });
      }
    }
  }
}
