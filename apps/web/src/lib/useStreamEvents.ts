'use client';

import { EngineEvent, type StreamId, type StreamRuntime } from '@openrelay/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiUrl } from './api';
import { getToken } from './auth';
import { queryKeys } from './queries';

export type EventStreamState = 'connecting' | 'open' | 'closed';

interface StreamEventsResult {
  /** Latest runtime snapshot pushed over the event stream, if any. */
  runtime: StreamRuntime | null;
  state: EventStreamState;
}

/**
 * Subscribe to a stream's server-sent event feed. Because the endpoint requires a
 * bearer token (which `EventSource` cannot send), we read the stream with `fetch`
 * and parse SSE frames manually. Engine events are validated with the core schema
 * and folded into the React Query cache so dependent views stay in sync.
 */
export function useStreamEvents(id: StreamId, enabled: boolean): StreamEventsResult {
  const queryClient = useQueryClient();
  const [runtime, setRuntime] = useState<StreamRuntime | null>(null);
  const [state, setState] = useState<EventStreamState>('closed');
  const runtimeRef = useRef<StreamRuntime | null>(null);

  useEffect(() => {
    if (!enabled) {
      setState('closed');
      return;
    }
    const token = getToken();
    if (!token) {
      setState('closed');
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setState('connecting');

    const applyEvent = (event: EngineEvent): void => {
      if (event.type === 'runtime') {
        runtimeRef.current = event.runtime;
        setRuntime(event.runtime);
        queryClient.setQueryData(queryKeys.runtime(id), event.runtime);
        return;
      }
      if (event.type === 'failover') {
        const current = runtimeRef.current;
        if (current) {
          const next: StreamRuntime = {
            ...current,
            onFailover: event.active,
            status: event.active ? 'failover' : current.status,
          };
          runtimeRef.current = next;
          setRuntime(next);
          queryClient.setQueryData(queryKeys.runtime(id), next);
        }
      }
      // Other event types (ingest/destination/scene) refresh the detail view.
      void queryClient.invalidateQueries({ queryKey: queryKeys.stream(id) });
    };

    const run = async (): Promise<void> => {
      try {
        const response = await fetch(apiUrl(`/api/streams/${id}/events`), {
          headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok || !response.body) {
          if (!cancelled) {
            setState('closed');
          }
          return;
        }
        if (!cancelled) {
          setState('open');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }
          buffer += decoder.decode(chunk.value, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            handleFrame(frame, applyEvent);
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch {
        // Aborted or network error; mark closed below.
      } finally {
        if (!cancelled) {
          setState('closed');
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, id, queryClient]);

  return { runtime, state };
}

function handleFrame(frame: string, apply: (event: EngineEvent) => void): void {
  const dataLines = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) {
    return;
  }
  const payload = dataLines.join('\n');
  try {
    const parsed = EngineEvent.safeParse(JSON.parse(payload));
    if (parsed.success) {
      apply(parsed.data);
    }
  } catch {
    // Ignore keep-alive comments or malformed frames.
  }
}
