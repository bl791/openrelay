import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('parses a minimal valid environment with defaults', () => {
    const config = loadConfig({ ENGINE_TOKEN: 'secret' });
    expect(config.token).toBe('secret');
    expect(config.port).toBe(8090);
    expect(config.host).toBe('0.0.0.0');
    expect(config.ingestHost).toBe('127.0.0.1');
    expect(config.rtmpPort).toBe(1935);
    expect(config.srtPort).toBe(8890);
    expect(config.simulate).toBe(false);
    expect(config.apiCallbackUrl).toBeNull();
  });

  it('parses the API callback URL and ingest host', () => {
    const config = loadConfig({
      ENGINE_TOKEN: 'secret',
      INGEST_HOST: 'mediamtx',
      API_CALLBACK_URL: 'http://api:4000/',
    });
    expect(config.ingestHost).toBe('mediamtx');
    expect(config.apiCallbackUrl).toBe('http://api:4000');
  });

  it('coerces numeric ports and the simulate flag', () => {
    const config = loadConfig({
      ENGINE_TOKEN: 'secret',
      ENGINE_PORT: '9000',
      RTMP_PORT: '1936',
      ENGINE_SIMULATE: '1',
    });
    expect(config.port).toBe(9000);
    expect(config.rtmpPort).toBe(1936);
    expect(config.simulate).toBe(true);
  });

  it('rejects a missing token', () => {
    expect(() => loadConfig({})).toThrow();
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig({ ENGINE_TOKEN: 's', ENGINE_PORT: '70000' })).toThrow();
  });
});
