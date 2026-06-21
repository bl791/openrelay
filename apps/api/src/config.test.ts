import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = {
  DATABASE_URL: 'postgres://localhost/openrelay',
  JWT_SECRET: 'a-sufficiently-long-secret-value-1234',
  ENGINE_URL: 'http://localhost:5000',
  ENGINE_TOKEN: 'token',
  PUBLIC_INGEST_HOST: 'localhost',
};

describe('loadConfig', () => {
  it('applies defaults for optional values', () => {
    const config = loadConfig(base);
    expect(config.port).toBe(4000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.rtmpPort).toBe(1935);
    expect(config.srtPort).toBe(9000);
    expect(config.jwtExpiresIn).toBe('7d');
  });

  it('strips a trailing slash from ENGINE_URL', () => {
    const config = loadConfig({ ...base, ENGINE_URL: 'http://localhost:5000/' });
    expect(config.engineUrl).toBe('http://localhost:5000');
  });

  it('rejects a short JWT secret', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'tooshort' })).toThrow();
  });

  it('rejects a missing required variable', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = base;
    expect(() => loadConfig(withoutDb)).toThrow();
  });

  it('coerces numeric ports from strings', () => {
    const config = loadConfig({ ...base, RTMP_PORT: '1936', SRT_PORT: '9001' });
    expect(config.rtmpPort).toBe(1936);
    expect(config.srtPort).toBe(9001);
  });

  it('treats blank Twitch credentials as disabled (compose passes empty strings)', () => {
    const config = loadConfig({
      ...base,
      TWITCH_CLIENT_ID: '',
      TWITCH_CLIENT_SECRET: '   ',
      TWITCH_REDIRECT_URI: '',
      TOKEN_ENCRYPTION_KEY: '',
    });
    expect(config.twitch.isConfigured).toBe(false);
    expect(config.twitch.clientId).toBeNull();
    // Token key falls back to the JWT secret when blank.
    expect(config.twitch.tokenEncryptionKey).toBe(base.JWT_SECRET);
  });

  it('enables Twitch when both id and secret are provided', () => {
    const config = loadConfig({
      ...base,
      TWITCH_CLIENT_ID: 'cid',
      TWITCH_CLIENT_SECRET: 'csecret',
    });
    expect(config.twitch.isConfigured).toBe(true);
    expect(config.twitch.clientId).toBe('cid');
    expect(config.twitch.redirectUri).toContain('/api/twitch/callback');
  });
});
