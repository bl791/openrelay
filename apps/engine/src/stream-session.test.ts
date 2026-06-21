import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimulatedDriver } from './driver/index.js';
import { createLogger } from './logger.js';
import { StreamSession } from './stream-session.js';
import { destination, scene, streamSpec } from './fixtures.js';
import type { EngineEvent } from '@openrelay/core';

const logger = createLogger('silent');

function makeSession(spec = streamSpec()): {
  session: StreamSession;
  driver: SimulatedDriver;
  events: EngineEvent[];
} {
  const driver = new SimulatedDriver({ warmupMs: 0 });
  const session = new StreamSession({
    spec,
    driver,
    logger,
    ingestHost: '127.0.0.1',
    rtmpPort: 1935,
    srtPort: 8890,
  });
  const events: EngineEvent[] = [];
  session.on('event', (e) => events.push(e));
  return { session, driver, events };
}

function failoverEvents(events: EngineEvent[]): { active: boolean }[] {
  return events.filter(
    (e): e is Extract<EngineEvent, { type: 'failover' }> => e.type === 'failover',
  );
}

describe('StreamSession failover state machine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts live and is not on failover', async () => {
    const { session } = makeSession();
    await session.start();
    await session.onIngestStatus('ing-main', 'live', 6000);

    expect(session.status).toBe('live');
    expect(session.onFailover).toBe(false);
    const runtime = session.runtime();
    expect(runtime.status).toBe('live');
    expect(runtime.onFailover).toBe(false);
  });

  it('does NOT enter failover when the drop recovers within the grace window', async () => {
    const { session, events } = makeSession(streamSpec({ failover: { graceSeconds: 8 } }));
    await session.start();
    await session.onIngestStatus('ing-main', 'live');

    // Drop, then recover after 5s (< 8s grace).
    await session.onIngestStatus('ing-main', 'stale');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(session.onFailover).toBe(false);

    await session.onIngestStatus('ing-main', 'live');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(session.onFailover).toBe(false);
    expect(session.status).toBe('live');
    expect(failoverEvents(events)).toHaveLength(0);
  });

  it('enters failover when the drop exceeds the grace window', async () => {
    const switchSpy = vi.spyOn(SimulatedDriver.prototype, 'switchSource');
    const { session, events } = makeSession(streamSpec({ failover: { graceSeconds: 8 } }));
    await session.start();
    await session.onIngestStatus('ing-main', 'live');

    await session.onIngestStatus('ing-main', 'stale');
    await vi.advanceTimersByTimeAsync(8_001);

    expect(session.onFailover).toBe(true);
    expect(session.status).toBe('failover');
    const fos = failoverEvents(events);
    expect(fos).toHaveLength(1);
    expect(fos[0]?.active).toBe(true);

    // The output source was switched to a scene (failover), not torn down.
    expect(switchSpy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'scene' }));
    switchSpy.mockRestore();
  });

  it('exits failover and cuts back to live when the source recovers', async () => {
    const { session, events } = makeSession(streamSpec({ failover: { graceSeconds: 3 } }));
    await session.start();
    await session.onIngestStatus('ing-main', 'live');

    await session.onIngestStatus('ing-main', 'offline');
    await vi.advanceTimersByTimeAsync(3_001);
    expect(session.onFailover).toBe(true);

    await session.onIngestStatus('ing-main', 'live');
    expect(session.onFailover).toBe(false);
    expect(session.status).toBe('live');

    const fos = failoverEvents(events);
    expect(fos.map((f) => f.active)).toEqual([true, false]);
  });

  it('cuts to failover immediately when graceSeconds is 0', async () => {
    const { session } = makeSession(streamSpec({ failover: { graceSeconds: 0 } }));
    await session.start();
    await session.onIngestStatus('ing-main', 'live');

    await session.onIngestStatus('ing-main', 'stale');
    // No real delay needed, but flush the queued microtask/timer.
    await vi.advanceTimersByTimeAsync(1);
    expect(session.onFailover).toBe(true);
  });

  it('ignores drops on a NON-active ingest', async () => {
    const { session } = makeSession();
    await session.start();
    await session.onIngestStatus('ing-main', 'live');

    // Backup ingest drops; active (main) is fine.
    await session.onIngestStatus('ing-backup', 'offline');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(session.onFailover).toBe(false);
    expect(session.status).toBe('live');
  });

  it('cancels a pending grace timer when the source recovers before it fires', async () => {
    const { session, events } = makeSession(streamSpec({ failover: { graceSeconds: 8 } }));
    await session.start();
    await session.onIngestStatus('ing-main', 'live');

    await session.onIngestStatus('ing-main', 'stale');
    await vi.advanceTimersByTimeAsync(7_000);
    await session.onIngestStatus('ing-main', 'live'); // recover before 8s

    // Advance well past the original deadline; timer must not fire.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(session.onFailover).toBe(false);
    expect(failoverEvents(events)).toHaveLength(0);
  });

  it('does not stack failovers on repeated stale reports', async () => {
    const { session, events } = makeSession(streamSpec({ failover: { graceSeconds: 2 } }));
    await session.start();
    await session.onIngestStatus('ing-main', 'live');

    await session.onIngestStatus('ing-main', 'stale');
    await vi.advanceTimersByTimeAsync(2_001);
    await session.onIngestStatus('ing-main', 'stale');
    await session.onIngestStatus('ing-main', 'offline');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(failoverEvents(events).filter((f) => f.active)).toHaveLength(1);
  });
});

describe('StreamSession manual control', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('switching to an ingest scene with a live source stays live', async () => {
    const spec = streamSpec({
      scenes: [
        scene('scene-cam', { kind: 'ingest', ingestId: 'ing-backup' as never }),
        scene('scene-brb', { kind: 'brb' }),
      ],
    });
    const { session, events } = makeSession(spec);
    await session.start();
    await session.onIngestStatus('ing-backup', 'live');

    await session.switchScene('scene-cam');
    expect(session.activeIngestId).toBe('ing-backup');
    expect(session.onFailover).toBe(false);
    expect(events.some((e) => e.type === 'scene_changed')).toBe(true);
  });

  it('switching to a non-ingest scene sets it as the explicit source', async () => {
    const { session } = makeSession();
    await session.start();
    await session.onIngestStatus('ing-main', 'live');

    await session.switchScene('scene-brb');
    expect(session.onFailover).toBe(false);
    expect(session.runtime().activeSceneId).toBe('scene-brb');
  });

  it('selecting a dead active ingest immediately protects the broadcast', async () => {
    const { session } = makeSession();
    await session.start();
    await session.onIngestStatus('ing-main', 'live');

    // ing-backup never reported live -> offline.
    await session.setActiveIngest('ing-backup');
    expect(session.onFailover).toBe(true);
    expect(session.activeIngestId).toBe('ing-backup');
  });

  it('selecting a live active ingest leaves failover', async () => {
    const { session } = makeSession(streamSpec({ failover: { graceSeconds: 1 } }));
    await session.start();
    await session.onIngestStatus('ing-main', 'live');
    await session.onIngestStatus('ing-backup', 'live');

    await session.onIngestStatus('ing-main', 'offline');
    await vi.advanceTimersByTimeAsync(1_001);
    expect(session.onFailover).toBe(true);

    await session.setActiveIngest('ing-backup');
    expect(session.onFailover).toBe(false);
    expect(session.activeIngestId).toBe('ing-backup');
  });

  it('throws on unknown scene/ingest', async () => {
    const { session } = makeSession();
    await session.start();
    await expect(session.switchScene('nope')).rejects.toThrow(/unknown scene/);
    await expect(session.setActiveIngest('nope')).rejects.toThrow(/unknown ingest/);
  });
});

describe('StreamSession telemetry & lifecycle', () => {
  it('reports enabled destinations live after start', async () => {
    const spec = streamSpec({
      destinations: [destination('dst-1'), destination('dst-2', { enabled: false })],
    });
    const { session } = makeSession(spec);
    await session.start();
    const runtime = session.runtime();
    expect(runtime.destinations.find((d) => d.id === 'dst-1')?.status).toBe('live');
    expect(runtime.destinations.find((d) => d.id === 'dst-2')?.status).toBe('idle');
  });

  it('marks the active ingest in runtime', async () => {
    const { session } = makeSession();
    await session.start();
    const runtime = session.runtime();
    expect(runtime.ingests.find((i) => i.id === 'ing-main')?.isActive).toBe(true);
    expect(runtime.ingests.find((i) => i.id === 'ing-backup')?.isActive).toBe(false);
  });

  it('stop transitions to offline', async () => {
    const { session } = makeSession();
    await session.start();
    await session.stop();
    expect(session.status).toBe('offline');
  });
});
