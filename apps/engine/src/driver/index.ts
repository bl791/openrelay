import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import { FfmpegDriver } from './ffmpeg-driver.js';
import { SimulatedDriver } from './simulated-driver.js';
import type { EncoderDriver } from './types.js';

export * from './types.js';
export { buildFfmpegArgs, buildDestinationUrl, buildTeeTarget } from './ffmpeg-args.js';
export { FfmpegDriver } from './ffmpeg-driver.js';
export { SimulatedDriver } from './simulated-driver.js';

/** Factory that produces a fresh driver per stream session, chosen by config. */
export type DriverFactory = () => EncoderDriver;

/** Build the driver factory the engine uses, selecting real vs simulated. */
export function createDriverFactory(config: Config, logger: Logger): DriverFactory {
  if (config.simulate) {
    logger.warn('ENGINE_SIMULATE=1: using simulated encoder driver (no ffmpeg processes)');
    return () => new SimulatedDriver();
  }
  return () => new FfmpegDriver({ logger });
}
