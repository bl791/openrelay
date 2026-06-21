'use client';

import Box from '@mui/material/Box';
import { alpha, keyframes } from '@mui/material/styles';
import { type ReactNode } from 'react';
import type { DestinationStatus, IngestStatus, StreamStatus } from '@openrelay/core';

type Tone = 'neutral' | 'live' | 'failover' | 'danger' | 'warn' | 'info';

/** Resolve a tone to a theme palette color (or undefined for the neutral tone). */
const TONE_COLOR: Record<Tone, string | null> = {
  neutral: null,
  live: '#1fd286',
  failover: '#ff8a1f',
  danger: '#f0476d',
  warn: '#fbbf24',
  info: '#5e6bff',
};

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
`;

export interface BadgeProps {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  children: ReactNode;
}

export function Badge({
  tone = 'neutral',
  dot = false,
  pulse: doPulse = false,
  children,
}: BadgeProps) {
  const color = TONE_COLOR[tone];
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        borderRadius: 999,
        px: 1.25,
        py: 0.25,
        fontSize: '0.7rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        lineHeight: 1.6,
        color: color ?? 'text.secondary',
        bgcolor: color ? alpha(color, 0.15) : 'action.selected',
        boxShadow: (t) => `inset 0 0 0 1px ${color ? alpha(color, 0.4) : t.palette.divider}`,
      }}
    >
      {dot ? (
        <Box
          component="span"
          sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            bgcolor: 'currentColor',
            animation: doPulse ? `${pulse} 1.1s ease-in-out infinite` : 'none',
          }}
        />
      ) : null}
      {children}
    </Box>
  );
}

const STREAM_TONE: Record<StreamStatus, Tone> = {
  offline: 'neutral',
  starting: 'info',
  live: 'live',
  failover: 'failover',
  stopping: 'warn',
};

export function StreamStatusBadge({ status }: { status: StreamStatus }) {
  const live = status === 'live' || status === 'failover';
  return (
    <Badge tone={STREAM_TONE[status]} dot pulse={live}>
      {status}
    </Badge>
  );
}

const INGEST_TONE: Record<IngestStatus, Tone> = {
  offline: 'neutral',
  connecting: 'info',
  live: 'live',
  stale: 'failover',
};

export function IngestStatusBadge({ status }: { status: IngestStatus }) {
  return (
    <Badge tone={INGEST_TONE[status]} dot pulse={status === 'live'}>
      {status}
    </Badge>
  );
}

const DEST_TONE: Record<DestinationStatus, Tone> = {
  idle: 'neutral',
  connecting: 'info',
  live: 'live',
  reconnecting: 'warn',
  error: 'danger',
};

export function DestinationStatusBadge({ status }: { status: DestinationStatus }) {
  return (
    <Badge tone={DEST_TONE[status]} dot pulse={status === 'live'}>
      {status}
    </Badge>
  );
}
