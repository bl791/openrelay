'use client';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha, keyframes } from '@mui/material/styles';
import {
  type Destination,
  type Ingest,
  type StreamId,
  type StreamRuntime,
  type StreamWithChildren,
} from '@openrelay/core';
import { useMemo } from 'react';
import { DestinationStatusBadge, IngestStatusBadge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { formatBitrate, formatUptime } from '@/lib/format';
import { useRuntime } from '@/lib/queries';
import { useStreamEvents, type EventStreamState } from '@/lib/useStreamEvents';

interface LiveStatusPanelProps {
  streamId: StreamId;
  stream: StreamWithChildren;
  live: boolean;
}

const CONNECTION_LABEL: Record<EventStreamState, string> = {
  connecting: 'Connecting…',
  open: 'Live telemetry',
  closed: 'Polling',
};

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
`;

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderRadius: 1.5,
  border: 1,
  borderColor: 'divider',
  bgcolor: 'background.default',
  px: 1.5,
  py: 1,
} as const;

const chipSx = {
  borderRadius: 0.75,
  px: 0.75,
  py: 0.25,
  fontSize: '10px',
  fontWeight: 600,
  textTransform: 'uppercase',
} as const;

export function LiveStatusPanel({ streamId, stream, live }: LiveStatusPanelProps) {
  // Prefer the pushed SSE feed; fall back to polling the runtime endpoint.
  const events = useStreamEvents(streamId, live);
  const polled = useRuntime(streamId, {
    enabled: live,
    refetchInterval: events.state === 'open' ? false : 3000,
  });

  const runtime: StreamRuntime | null = events.runtime ?? polled.data ?? null;

  const ingestById = useMemo(() => indexBy(stream.ingests), [stream.ingests]);
  const destById = useMemo(() => indexBy(stream.destinations), [stream.destinations]);

  if (!live) {
    return (
      <Card>
        <CardHeader
          title="Live status"
          description="Telemetry appears once the broadcast starts."
        />
        <CardBody>
          <Typography variant="body2" color="text.secondary">
            This stream is offline. Press{' '}
            <Box component="span" sx={{ fontWeight: 500, color: 'text.primary' }}>
              Start
            </Box>{' '}
            to begin broadcasting and watch real-time ingest and destination health here.
          </Typography>
        </CardBody>
      </Card>
    );
  }

  const onFailover = runtime?.onFailover ?? false;

  return (
    <Card sx={onFailover ? { borderColor: (t) => alpha(t.palette.warning.main, 0.7) } : undefined}>
      <CardHeader
        title="Live status"
        description={
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            <Box
              component="span"
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: events.state === 'open' ? 'success.main' : 'text.secondary',
                animation: events.state === 'open' ? `${pulse} 1.1s ease-in-out infinite` : 'none',
              }}
            />
            {CONNECTION_LABEL[events.state]}
          </Box>
        }
        action={
          runtime ? (
            <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary' }}>
              Uptime {formatUptime(runtime.uptimeSeconds)}
            </Typography>
          ) : null
        }
      />
      <CardBody>
        <Stack spacing={2.5}>
          {onFailover ? <FailoverBanner /> : null}

          <Box component="section">
            <Typography
              variant="overline"
              sx={{ display: 'block', mb: 1, color: 'text.secondary', fontWeight: 600 }}
            >
              Ingests
            </Typography>
            <Stack spacing={1}>
              {(runtime?.ingests ?? []).map((rt) => {
                const ingest = ingestById.get(rt.id);
                return (
                  <Box key={rt.id} sx={rowSx}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {rt.isActive ? (
                        <Box
                          component="span"
                          sx={{
                            ...chipSx,
                            color: 'primary.light',
                            bgcolor: (t) => alpha(t.palette.primary.main, 0.2),
                          }}
                        >
                          Active
                        </Box>
                      ) : null}
                      <Typography variant="body2" sx={{ color: 'text.primary' }}>
                        {ingest?.label ?? rt.id}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {formatBitrate(rt.bitrateKbps)}
                      </Typography>
                      <IngestStatusBadge status={rt.status} />
                    </Box>
                  </Box>
                );
              })}
              {runtime?.ingests.length === 0 ? <EmptyRow text="No ingest telemetry yet." /> : null}
            </Stack>
          </Box>

          <Box component="section">
            <Typography
              variant="overline"
              sx={{ display: 'block', mb: 1, color: 'text.secondary', fontWeight: 600 }}
            >
              Destinations
            </Typography>
            <Stack spacing={1}>
              {(runtime?.destinations ?? []).map((rt) => {
                const dest = destById.get(rt.id);
                return (
                  <Box key={rt.id} sx={rowSx}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ color: 'text.primary' }}>
                        {dest?.label ?? rt.id}
                      </Typography>
                      {dest ? (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            fontSize: '10px',
                          }}
                        >
                          {dest.platform.replace('_', ' ')}
                        </Typography>
                      ) : null}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {formatBitrate(rt.bitrateKbps)}
                      </Typography>
                      <DestinationStatusBadge status={rt.status} />
                    </Box>
                  </Box>
                );
              })}
              {runtime?.destinations.length === 0 ? (
                <EmptyRow text="No destination telemetry yet." />
              ) : null}
            </Stack>
          </Box>

          {!runtime ? <EmptyRow text="Waiting for the engine to report…" /> : null}
        </Stack>
      </CardBody>
    </Card>
  );
}

function FailoverBanner() {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        borderRadius: 1.5,
        border: 1,
        borderColor: (t) => alpha(t.palette.warning.main, 0.6),
        bgcolor: (t) => alpha(t.palette.warning.main, 0.1),
        px: 2,
        py: 1.5,
      }}
    >
      <Box
        component="span"
        sx={{
          width: 12,
          height: 12,
          flexShrink: 0,
          borderRadius: '50%',
          bgcolor: 'warning.main',
          animation: `${pulse} 1.1s ease-in-out infinite`,
        }}
      />
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 700, color: 'warning.main' }}>
          FAILOVER ACTIVE
        </Typography>
        <Typography variant="caption" sx={{ color: (t) => alpha(t.palette.warning.main, 0.8) }}>
          The source dropped — viewers are still live on the fallback scene while it reconnects.
        </Typography>
      </Box>
    </Box>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <Box
      sx={{
        borderRadius: 1.5,
        border: 1,
        borderStyle: 'dashed',
        borderColor: 'divider',
        px: 1.5,
        py: 1.5,
        textAlign: 'center',
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {text}
      </Typography>
    </Box>
  );
}

function indexBy<T extends Ingest | Destination>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}
