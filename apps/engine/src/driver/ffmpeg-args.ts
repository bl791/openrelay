import type { Destination, OutputProfile, Scene } from '@openrelay/core';
import type { EncoderPlan, EncoderSource } from './types.js';

/**
 * Build the RTMP(S)/SRT URL of one of the relay's own ingest listeners. FFmpeg
 * reads the source feed back out of the local listener the streamer pushes into.
 */
export function buildIngestInputUrl(
  source: Extract<EncoderSource, { kind: 'ingest' }>,
  ingestHost: string,
  rtmpPort: number,
  srtPort: number,
): string {
  const { protocol, streamKey } = source.ingest;
  switch (protocol) {
    case 'rtmp':
      // Must match the `live` application path the streamer publishes to.
      return `rtmp://${ingestHost}:${rtmpPort}/live/${streamKey}`;
    case 'rtmps':
      return `rtmps://${ingestHost}:${rtmpPort}/live/${streamKey}`;
    case 'srt':
      // Pull mode: the engine connects as an SRT caller to the media server,
      // selecting the publisher's resource by streamid. MediaMTX maps the publish
      // streamid `publish:live/<key>` to path `live/<key>`; we read it back with
      // the matching `read:live/<key>` streamid.
      return `srt://${ingestHost}:${srtPort}?streamid=${encodeURIComponent(`read:live/${streamKey}`)}&mode=caller`;
  }
}

/** Concatenate destination push URL and stream key into a single RTMP target. */
export function buildDestinationUrl(destination: Destination): string {
  const base = destination.url.replace(/\/+$/, '');
  return `${base}/${destination.streamKey}`;
}

/**
 * Escape a value for use inside an FFmpeg `tee` muxer target list. Within a tee
 * spec, `:` separates options, `|` separates outputs and `[` `]` wrap per-output
 * options, so those must be backslash-escaped in URLs.
 */
function escapeTeeUrl(url: string): string {
  return url.replace(/[\\[\]:|]/g, (ch) => `\\${ch}`);
}

/**
 * Build the input-side arguments for a failover scene. Scenes are synthesized
 * with FFmpeg's `lavfi` virtual input so the output never has to stop for lack
 * of a real source.
 */
export function buildSceneInputArgs(scene: Scene, output: OutputProfile): string[] {
  const { width, height } = output.resolution;
  const fps = output.framerate;
  const size = `${width}x${height}`;

  switch (scene.kind) {
    case 'color': {
      const color = scene.color ?? '#000000';
      return [
        '-re',
        '-f',
        'lavfi',
        '-i',
        `color=c=${color}:s=${size}:r=${fps}`,
        '-f',
        'lavfi',
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=48000',
      ];
    }
    case 'image':
    case 'brb': {
      if (scene.assetUrl === null) {
        // No asset configured: degrade to a neutral color slate.
        return buildSceneInputArgs({ ...scene, kind: 'color' }, output);
      }
      return [
        '-re',
        '-loop',
        '1',
        '-i',
        scene.assetUrl,
        '-f',
        'lavfi',
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=48000',
      ];
    }
    case 'clips': {
      if (scene.assetUrl === null) {
        return buildSceneInputArgs({ ...scene, kind: 'color' }, output);
      }
      // Loop the clip reel video (which carries its own audio) indefinitely.
      return ['-re', '-stream_loop', '-1', '-i', scene.assetUrl];
    }
    case 'ingest': {
      // An `ingest`-kind scene with no live source still needs *something* to
      // emit; fall back to a black slate until a real ingest is selected.
      return buildSceneInputArgs(
        { ...scene, kind: 'color', color: scene.color ?? '#000000' },
        output,
      );
    }
  }
}

/** Whether the chosen source carries its own audio track or needs a silent one. */
function sourceProvidesAudio(source: EncoderSource): boolean {
  if (source.kind === 'ingest') {
    return true;
  }
  return source.scene.kind === 'clips' && source.scene.assetUrl !== null;
}

function buildInputArgs(plan: EncoderPlan): string[] {
  if (plan.source.kind === 'ingest') {
    // NOTE: the `-reconnect*` family is HTTP(S)-only — FFmpeg rejects it for RTMP
    // inputs ("Option reconnect not found"), which kills the process on startup.
    // A dropped RTMP source is instead handled by the failover state machine.
    return ['-i', buildIngestInputUrl(plan.source, plan.ingestHost, plan.rtmpPort, plan.srtPort)];
  }
  return buildSceneInputArgs(plan.source.scene, plan.output);
}

/** Map video + audio streams from the relevant inputs onto the output. */
function buildMapArgs(source: EncoderSource): string[] {
  if (sourceProvidesAudio(source)) {
    // Single input carries both tracks.
    return ['-map', '0:v:0', '-map', '0:a:0'];
  }
  // Video from input 0, silent audio from the anullsrc lavfi input 1.
  return ['-map', '0:v:0', '-map', '1:a:0'];
}

function buildVideoEncodeArgs(output: OutputProfile): string[] {
  const { width, height } = output.resolution;
  const gop = output.keyframeIntervalSeconds * output.framerate;
  const maxrate = Math.round(output.videoBitrateKbps * 1.1);
  const bufsize = output.videoBitrateKbps * 2;
  return [
    '-c:v',
    'libx264',
    '-preset',
    output.preset,
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    // Scale and pad to the exact output canvas, then normalize the frame rate so
    // failover scenes and live sources share identical timing for clean cuts.
    '-vf',
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${output.framerate},format=yuv420p`,
    '-b:v',
    `${output.videoBitrateKbps}k`,
    '-maxrate',
    `${maxrate}k`,
    '-bufsize',
    `${bufsize}k`,
    '-g',
    String(gop),
    '-keyint_min',
    String(gop),
    '-sc_threshold',
    '0',
    '-r',
    String(output.framerate),
  ];
}

function buildAudioEncodeArgs(output: OutputProfile): string[] {
  return ['-c:a', 'aac', '-b:a', `${output.audioBitrateKbps}k`, '-ar', '48000', '-ac', '2'];
}

/**
 * Build the `tee` muxer target string that fans the single encoded output out to
 * every enabled destination simultaneously (multistream). All destinations share
 * the same encode, so transcoding happens exactly once.
 */
export function buildTeeTarget(destinations: readonly Destination[]): string {
  // `onfail=ignore` keeps the other destinations alive if one platform errors;
  // the per-output FIFO (enabled globally via `-use_fifo 1`) buffers and retries a
  // dropped destination so it re-establishes instead of being permanently lost.
  return destinations
    .map((d) => `[f=flv:onfail=ignore]${escapeTeeUrl(buildDestinationUrl(d))}`)
    .join('|');
}

/**
 * Assemble the complete FFmpeg argv (excluding the `ffmpeg` binary itself) for a
 * plan. Pure and deterministic — this is the unit-tested core of the driver.
 *
 * @throws {Error} when no enabled destinations are present (nothing to push to).
 */
export function buildFfmpegArgs(plan: EncoderPlan): string[] {
  const enabled = plan.destinations.filter((d) => d.enabled);
  if (enabled.length === 0) {
    throw new Error('buildFfmpegArgs: at least one enabled destination is required');
  }

  const args: string[] = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'info',
    // Machine-readable progress on stdout for bitrate/status parsing.
    '-progress',
    'pipe:1',
    '-stats_period',
    '1',
  ];

  args.push(...buildInputArgs(plan));
  args.push(...buildMapArgs(plan.source));
  args.push(...buildVideoEncodeArgs(plan.output));
  args.push(...buildAudioEncodeArgs(plan.output));

  // The `tee` muxer requires global headers — without `+global_header` it fails
  // every output ("All tee outputs failed") because it cannot write per-output
  // codec extradata. Single shared encode, fanned out to all destinations.
  args.push('-flags', '+global_header');
  args.push('-f', 'tee', '-use_fifo', '1', buildTeeTarget(enabled));

  return args;
}
