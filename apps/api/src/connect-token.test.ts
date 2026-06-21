import { describe, expect, it } from 'vitest';
import { decodeConnectToken, encodeConnectToken, type ConnectPayload } from './connect-token.js';

describe('connect-token', () => {
  const payload: ConnectPayload = {
    v: 1,
    streamId: 'stream_abc123',
    protocol: 'rtmp',
    server: 'rtmp://ingest.example.com:1935/live',
    streamKey: 'sk_secret_key_value',
  };

  it('round-trips an encoded payload back to the original', () => {
    const token = encodeConnectToken(payload);
    expect(token).not.toContain('=');
    expect(token).not.toContain('+');
    expect(token).not.toContain('/');
    expect(decodeConnectToken(token)).toEqual(payload);
  });

  it('returns null for malformed tokens', () => {
    expect(decodeConnectToken('not a real token!!!')).toBeNull();
    expect(decodeConnectToken('')).toBeNull();
  });

  it('returns null when the decoded shape does not match v1', () => {
    const badVersion = Buffer.from(JSON.stringify({ ...payload, v: 2 }), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeConnectToken(badVersion)).toBeNull();
  });
});
