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
});
