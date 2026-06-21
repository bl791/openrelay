import { describe, expect, it } from 'vitest';
import { DEFAULT_FAILOVER_CONFIG, DEFAULT_OUTPUT_PROFILE, OutputProfile } from './entities.js';
import { CreateDestinationRequest } from './dto.js';
import { EngineEvent } from './engine-protocol.js';

describe('OutputProfile', () => {
  it('accepts the default profile', () => {
    expect(OutputProfile.parse(DEFAULT_OUTPUT_PROFILE)).toEqual(DEFAULT_OUTPUT_PROFILE);
  });

  it('rejects an out-of-range bitrate', () => {
    expect(() =>
      OutputProfile.parse({ ...DEFAULT_OUTPUT_PROFILE, videoBitrateKbps: 10 }),
    ).toThrow();
  });
});

describe('defaults', () => {
  it('exposes a sane failover grace window', () => {
    expect(DEFAULT_FAILOVER_CONFIG.graceSeconds).toBeGreaterThan(0);
    expect(DEFAULT_FAILOVER_CONFIG.mode).toBe('brb');
  });
});

describe('CreateDestinationRequest', () => {
  it('defaults enabled to true', () => {
    const parsed = CreateDestinationRequest.parse({
      label: 'Twitch',
      platform: 'twitch',
      url: 'rtmp://live.twitch.tv/app',
      streamKey: 'live_123',
    });
    expect(parsed.enabled).toBe(true);
  });
});

describe('EngineEvent', () => {
  it('discriminates on type', () => {
    const event = EngineEvent.parse({
      type: 'failover',
      streamId: 'stream_123',
      active: true,
    });
    expect(event.type).toBe('failover');
  });
});
