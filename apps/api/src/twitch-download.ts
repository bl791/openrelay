import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { AppError } from './errors.js';

/**
 * Server-side Twitch clip download adapter. Clips are fetched with `yt-dlp`
 * (installed in the API container image) and captured to an in-memory buffer.
 * The whole concern is isolated behind {@link ClipDownloader} so it can be
 * swapped for a stub in tests and replaced wholesale later if needed — nothing
 * else in the app shells out.
 */

export interface DownloadedClip {
  body: Buffer;
  contentType: string;
}

export interface ClipDownloader {
  /** Download a clip by its Twitch clip id, returning the MP4 bytes. */
  downloadClip(clipId: string): Promise<DownloadedClip>;
}

/** Minimal signature of `child_process.spawn` we depend on, for injection. */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options?: SpawnOptionsWithoutStdio,
) => ReturnType<typeof spawn>;

export interface YtDlpDownloaderOptions {
  /** Path/name of the yt-dlp binary (default `yt-dlp`). */
  binary?: string;
  /** Injectable spawn (default `node:child_process` spawn). */
  spawnFn?: SpawnFn;
  /** Hard cap on download size in bytes (default 256 MiB). */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

/** Build the public clip page URL yt-dlp resolves the media from. */
export function clipPageUrl(clipId: string): string {
  return `https://clips.twitch.tv/${encodeURIComponent(clipId)}`;
}

/**
 * Create a {@link ClipDownloader} backed by `yt-dlp -o - <url>`, streaming the
 * MP4 to stdout and accumulating it into a buffer.
 */
export function createYtDlpDownloader(options: YtDlpDownloaderOptions = {}): ClipDownloader {
  const binary = options.binary ?? 'yt-dlp';
  const spawnFn: SpawnFn = options.spawnFn ?? spawn;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  return {
    downloadClip(clipId: string): Promise<DownloadedClip> {
      const url = clipPageUrl(clipId);
      return new Promise<DownloadedClip>((resolve, reject) => {
        // `-o -` writes the media to stdout; `--no-warnings`/`-q` keep stderr clean.
        const child = spawnFn(binary, ['-q', '--no-warnings', '-o', '-', url]);
        const chunks: Buffer[] = [];
        let total = 0;
        let settled = false;

        const fail = (error: AppError): void => {
          if (settled) {
            return;
          }
          settled = true;
          child.kill('SIGKILL');
          reject(error);
        };

        if (child.stdout === null) {
          fail(new AppError('internal_error', 'clip download produced no output stream'));
          return;
        }

        child.stdout.on('data', (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > maxBytes) {
            fail(new AppError('validation_error', 'clip exceeds the maximum import size'));
            return;
          }
          chunks.push(chunk);
        });

        child.on('error', (error: Error) => {
          fail(new AppError('internal_error', `clip download failed: ${error.message}`));
        });

        child.on('close', (code: number | null) => {
          if (settled) {
            return;
          }
          if (code !== 0) {
            fail(new AppError('engine_error', `yt-dlp exited with code ${String(code)}`));
            return;
          }
          const body = Buffer.concat(chunks);
          if (body.byteLength === 0) {
            fail(new AppError('engine_error', 'clip download was empty'));
            return;
          }
          settled = true;
          resolve({ body, contentType: 'video/mp4' });
        });
      });
    },
  };
}
