import { describe, expect, it } from 'vitest';
import {
  buildDestinationUrl,
  buildFfmpegArgs,
  buildIngestInputUrl,
  buildSceneInputArgs,
  buildTeeTarget,
} from './ffmpeg-args.js';
import type { EncoderPlan } from './types.js';
import { OUTPUT, destination, ingest, scene } from '../fixtures.js';

function planWith(overrides: Partial<EncoderPlan> = {}): EncoderPlan {
  return {
    streamId: 'stream-1',
    output: OUTPUT,
    source: { kind: 'ingest', ingest: ingest('ing-main') },
    destinations: [destination('dst-twitch')],
    ingestHost: '127.0.0.1',
    rtmpPort: 1935,
    srtPort: 8890,
    ...overrides,
  };
}

/** Read the value following the first occurrence of `flag` in argv. */
function valueAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

describe('buildIngestInputUrl', () => {
  it('builds an rtmp media-server url on the live app path', () => {
    expect(
      buildIngestInputUrl(
        { kind: 'ingest', ingest: ingest('a', { protocol: 'rtmp', streamKey: 'k' }) },
        'mediamtx',
        1935,
        8890,
      ),
    ).toBe('rtmp://mediamtx:1935/live/k');
  });

  it('builds an rtmps url', () => {
    expect(
      buildIngestInputUrl(
        { kind: 'ingest', ingest: ingest('a', { protocol: 'rtmps', streamKey: 'k' }) },
        '127.0.0.1',
        1935,
        8890,
      ),
    ).toBe('rtmps://127.0.0.1:1935/live/k');
  });

  it('builds an srt caller url with an encoded read streamid on the live path', () => {
    const url = buildIngestInputUrl(
      { kind: 'ingest', ingest: ingest('a', { protocol: 'srt', streamKey: 'pubkey' }) },
      '127.0.0.1',
      1935,
      8890,
    );
    expect(url).toBe('srt://127.0.0.1:8890?streamid=read%3Alive%2Fpubkey&mode=caller');
  });
});

describe('buildDestinationUrl', () => {
  it('joins url and key, trimming a trailing slash', () => {
    expect(buildDestinationUrl(destination('d', { url: 'rtmp://x/app/', streamKey: 'k' }))).toBe(
      'rtmp://x/app/k',
    );
    expect(buildDestinationUrl(destination('d', { url: 'rtmp://x/app', streamKey: 'k' }))).toBe(
      'rtmp://x/app/k',
    );
  });
});

describe('buildTeeTarget', () => {
  it('fans out to multiple destinations with flv + onfail=ignore', () => {
    const target = buildTeeTarget([
      destination('a', { url: 'rtmp://x/app', streamKey: 'k1' }),
      destination('b', { url: 'rtmp://y/app', streamKey: 'k2' }),
    ]);
    const parts = target.split('|');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('[f=flv:onfail=ignore]');
    expect(parts[0]).toContain('k1');
    expect(parts[1]).toContain('k2');
  });

  it('escapes tee-special characters in destination urls', () => {
    const target = buildTeeTarget([destination('a', { url: 'rtmp://x:1935/app', streamKey: 'k' })]);
    // The colon in the host:port must be backslash-escaped inside the tee spec.
    expect(target).toContain('rtmp\\://x\\:1935/app/k');
  });
});

describe('buildSceneInputArgs', () => {
  it('uses lavfi color + anullsrc for a color scene', () => {
    const args = buildSceneInputArgs(scene('s', { kind: 'color', color: '#ff0000' }), OUTPUT);
    expect(args).toContain('lavfi');
    expect(args.join(' ')).toContain('color=c=#ff0000:s=1920x1080:r=60');
    expect(args.join(' ')).toContain('anullsrc');
  });

  it('loops a still image for a brb scene with an asset', () => {
    const args = buildSceneInputArgs(
      scene('s', { kind: 'brb', assetUrl: 'https://cdn/brb.png' }),
      OUTPUT,
    );
    expect(args).toContain('-loop');
    expect(args).toContain('https://cdn/brb.png');
    expect(args.join(' ')).toContain('anullsrc');
  });

  it('falls back to a color slate when a brb scene has no asset', () => {
    const args = buildSceneInputArgs(scene('s', { kind: 'brb', assetUrl: null }), OUTPUT);
    expect(args.join(' ')).toContain('color=c=');
  });

  it('stream-loops a clips reel (no separate silent audio)', () => {
    const args = buildSceneInputArgs(
      scene('s', { kind: 'clips', assetUrl: 'https://cdn/clips.mp4' }),
      OUTPUT,
    );
    expect(args).toContain('-stream_loop');
    expect(args).toContain('-1');
    expect(args.join(' ')).not.toContain('anullsrc');
  });
});

describe('buildFfmpegArgs', () => {
  it('throws when there are no enabled destinations', () => {
    expect(() =>
      buildFfmpegArgs(planWith({ destinations: [destination('d', { enabled: false })] })),
    ).toThrow(/at least one enabled destination/);
  });

  it('builds a complete pipeline for a live ingest', () => {
    const args = buildFfmpegArgs(planWith());
    expect(args).toContain('-i');
    expect(args).toContain('rtmp://127.0.0.1:1935/live/key-ing-main');
    expect(valueAfter(args, '-c:v')).toBe('libx264');
    expect(valueAfter(args, '-preset')).toBe('veryfast');
    expect(valueAfter(args, '-c:a')).toBe('aac');
    expect(valueAfter(args, '-b:v')).toBe('6000k');
    expect(valueAfter(args, '-b:a')).toBe('160k');
    expect(valueAfter(args, '-f')).toBe('tee');
    // The tee muxer requires global headers, else all outputs fail at runtime.
    expect(valueAfter(args, '-flags')).toBe('+global_header');
    // No HTTP-only reconnect flags leak onto the RTMP input (FFmpeg rejects them).
    expect(args).not.toContain('-reconnect');
    // progress reporting wired up
    expect(valueAfter(args, '-progress')).toBe('pipe:1');
  });

  it('computes the GOP from keyframe interval * framerate', () => {
    const args = buildFfmpegArgs(planWith());
    // 2s * 60fps = 120
    expect(valueAfter(args, '-g')).toBe('120');
    expect(valueAfter(args, '-keyint_min')).toBe('120');
  });

  it('maps source audio for a live ingest', () => {
    const args = buildFfmpegArgs(planWith());
    expect(args.join(' ')).toContain('-map 0:v:0 -map 0:a:0');
  });

  it('maps a silent audio track for a color failover scene', () => {
    const args = buildFfmpegArgs(
      planWith({ source: { kind: 'scene', scene: scene('s', { kind: 'color' }) } }),
    );
    // video from input 0, audio from the anullsrc input 1
    expect(args.join(' ')).toContain('-map 0:v:0 -map 1:a:0');
  });

  it('maps the clip reel as a single av source', () => {
    const args = buildFfmpegArgs(
      planWith({
        source: {
          kind: 'scene',
          scene: scene('s', { kind: 'clips', assetUrl: 'https://cdn/c.mp4' }),
        },
      }),
    );
    expect(args.join(' ')).toContain('-map 0:v:0 -map 0:a:0');
  });

  it('only fans out to enabled destinations', () => {
    const args = buildFfmpegArgs(
      planWith({
        destinations: [
          destination('on', { streamKey: 'live_on', enabled: true }),
          destination('off', { streamKey: 'live_off', enabled: false }),
        ],
      }),
    );
    const tee = args[args.length - 1] ?? '';
    expect(tee).toContain('live_on');
    expect(tee).not.toContain('live_off');
  });
});
