import type { IngestProtocol } from '@openrelay/core';

/**
 * Compact, deep-link-friendly payload a mobile encoder app (Moblin, IRL Pro,
 * etc.) or a QR scanner can consume to configure itself in one tap. Versioned so
 * future shape changes stay backwards-compatible.
 */
export interface ConnectPayload {
  /** Payload schema version. */
  v: 1;
  streamId: string;
  protocol: IngestProtocol;
  /** Encoder `server` field (URL with the stream key omitted). */
  server: string;
  /** Encoder stream key. */
  streamKey: string;
}

/** Encode a string to URL-safe base64 without padding (works in Node and browsers). */
function toBase64Url(input: string): string {
  const base64 = Buffer.from(input, 'utf8').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode a URL-safe base64 (unpadded) string back to UTF-8. */
function fromBase64Url(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Encode a {@link ConnectPayload} into a compact base64url token. Pure function —
 * deterministic and side-effect free — so it round-trips with {@link decodeConnectToken}.
 */
export function encodeConnectToken(payload: ConnectPayload): string {
  return toBase64Url(JSON.stringify(payload));
}

/**
 * Decode a connect token produced by {@link encodeConnectToken}. Returns `null`
 * when the token is malformed or does not match the expected v1 shape, so callers
 * never throw on attacker-controlled input.
 */
export function decodeConnectToken(token: string): ConnectPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(token));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.v !== 1 ||
    typeof record.streamId !== 'string' ||
    typeof record.protocol !== 'string' ||
    typeof record.server !== 'string' ||
    typeof record.streamKey !== 'string'
  ) {
    return null;
  }
  return {
    v: 1,
    streamId: record.streamId,
    protocol: record.protocol as IngestProtocol,
    server: record.server,
    streamKey: record.streamKey,
  };
}
