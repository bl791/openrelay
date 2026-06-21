import { describe, expect, it, vi } from 'vitest';
import { EngineEvent } from '@openrelay/core';
import { createLogger } from './logger.js';
import { StatusReporter } from './status-reporter.js';

const event = EngineEvent.parse({ type: 'failover', streamId: 'stream-1', active: true });

describe('StatusReporter', () => {
  it('is disabled and never fetches when no callback URL is set', () => {
    const fetchFn = vi.fn();
    const reporter = new StatusReporter({
      apiCallbackUrl: null,
      token: 't',
      logger: createLogger('silent'),
      fetchFn,
    });
    expect(reporter.enabled).toBe(false);
    reporter.report(event);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('POSTs the event to the API callback with a bearer token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const reporter = new StatusReporter({
      apiCallbackUrl: 'http://api:4000',
      token: 'secret',
      logger: createLogger('silent'),
      fetchFn,
    });
    expect(reporter.enabled).toBe(true);
    reporter.report(event);
    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api:4000/internal/engine/status');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body as string)).toEqual({ event });
  });

  it('swallows fetch failures so the broadcast is never disrupted', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network down'));
    const reporter = new StatusReporter({
      apiCallbackUrl: 'http://api:4000',
      token: 'secret',
      logger: createLogger('silent'),
      fetchFn,
    });
    expect(() => {
      reporter.report(event);
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalled();
    });
  });
});
