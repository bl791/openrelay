import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IngestStatus } from '@openrelay/core';
import { IngestMonitor } from './ingest-monitor.js';
import { createLogger } from './logger.js';
import type { SessionManager } from './session-manager.js';

/** Minimal SessionManager stub recording reported ingest statuses. */
function stubSessions(): {
  sessions: SessionManager;
  reports: { ingestId: string; status: IngestStatus }[];
} {
  const reports: { ingestId: string; status: IngestStatus }[] = [];
  const sessions = {
    has: () => true,
    reportIngestStatus: (_streamId: string, ingestId: string, status: IngestStatus) => {
      reports.push({ ingestId, status });
      return Promise.resolve();
    },
  } as unknown as SessionManager;
  return { sessions, reports };
}

describe('IngestMonitor sweep semantics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does NOT expire a connect-driven ingest that never heartbeats', async () => {
    const { sessions, reports } = stubSessions();
    const monitor = new IngestMonitor({
      sessions,
      logger: createLogger('silent'),
      heartbeatTimeoutMs: 100,
      sweepIntervalMs: 50,
    });
    monitor.start();
    await monitor.connect('s1', 'i1');
    // Advance well past the heartbeat timeout; a MediaMTX-style ingest stays live
    // until an explicit disconnect.
    await vi.advanceTimersByTimeAsync(500);
    monitor.stop();
    expect(reports.some((r) => r.ingestId === 'i1' && r.status === 'stale')).toBe(false);
  });

  it('expires a heartbeating ingest once heartbeats stop', async () => {
    const { sessions, reports } = stubSessions();
    const monitor = new IngestMonitor({
      sessions,
      logger: createLogger('silent'),
      heartbeatTimeoutMs: 100,
      sweepIntervalMs: 50,
    });
    monitor.start();
    await monitor.heartbeat('s1', 'i2');
    await vi.advanceTimersByTimeAsync(500);
    monitor.stop();
    expect(reports.some((r) => r.ingestId === 'i2' && r.status === 'stale')).toBe(true);
  });

  it('an explicit disconnect always marks the ingest offline', async () => {
    const { sessions, reports } = stubSessions();
    const monitor = new IngestMonitor({ sessions, logger: createLogger('silent') });
    await monitor.connect('s1', 'i3');
    await monitor.disconnect('s1', 'i3');
    expect(reports.at(-1)).toEqual({ ingestId: 'i3', status: 'offline' });
  });
});
