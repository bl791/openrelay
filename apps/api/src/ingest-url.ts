import type { IngestConnectionInfo, IngestId, IngestProtocol } from '@openrelay/core';
import type { Config } from './config.js';

/**
 * Build the publish URL a streamer points their encoder at for a given ingest.
 * RTMP(S) endpoints expose the stream key as a path segment; SRT carries it as a
 * `streamid` query parameter, which is the convention the relay listens for.
 */
export function buildPushUrl(config: Config, protocol: IngestProtocol, streamKey: string): string {
  const host = config.publicIngestHost;
  switch (protocol) {
    case 'rtmp':
      return `rtmp://${host}:${String(config.rtmpPort)}/live/${streamKey}`;
    case 'rtmps':
      return `rtmps://${host}:${String(config.rtmpPort)}/live/${streamKey}`;
    case 'srt':
      // MediaMTX selects the publish path from the SRT streamid `publish:<path>`.
      return `srt://${host}:${String(config.srtPort)}?streamid=${encodeURIComponent(`publish:live/${streamKey}`)}`;
  }
}

/**
 * Build the encoder `server` field (the URL with the stream key omitted) that
 * sits alongside the stream key in OBS/Moblin-style setups. RTMP(S) servers carry
 * the `live` application path; SRT exposes the bare host:port endpoint.
 */
function buildPushServer(config: Config, protocol: IngestProtocol): string {
  const host = config.publicIngestHost;
  switch (protocol) {
    case 'rtmp':
      return `rtmp://${host}:${String(config.rtmpPort)}/live`;
    case 'rtmps':
      return `rtmps://${host}:${String(config.rtmpPort)}/live`;
    case 'srt':
      return `srt://${host}:${String(config.srtPort)}`;
  }
}

/**
 * Assemble the full copy-paste {@link IngestConnectionInfo} for an ingest: the
 * split server/key fields plus a single-line URL convenient for SRT or quick paste.
 */
export function buildIngestConnectionInfo(
  config: Config,
  ingest: { id: IngestId; label: string; protocol: IngestProtocol; streamKey: string },
): IngestConnectionInfo {
  return {
    ingestId: ingest.id,
    label: ingest.label,
    protocol: ingest.protocol,
    server: buildPushServer(config, ingest.protocol),
    streamKey: ingest.streamKey,
    url: buildPushUrl(config, ingest.protocol, ingest.streamKey),
  };
}
