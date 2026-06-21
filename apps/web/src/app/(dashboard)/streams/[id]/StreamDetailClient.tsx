'use client';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid2';
import { type StreamId } from '@openrelay/core';
import NextLink from 'next/link';
import { useEffect, useState } from 'react';
import { StreamStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { ApiRequestError } from '@/lib/api';
import { getStoredUser } from '@/lib/auth';
import { useStartStream, useStopStream, useStream } from '@/lib/queries';
import { ClipsManager } from './ClipsManager';
import { DestinationsManager } from './DestinationsManager';
import { EasyConnectPanel } from './EasyConnectPanel';
import { FailoverSettings } from './FailoverSettings';
import { FriendsManager } from './FriendsManager';
import { IngestsManager } from './IngestsManager';
import { LiveStatusPanel } from './LiveStatusPanel';
import { ScenesManager } from './ScenesManager';

export function StreamDetailClient({ streamId }: { streamId: StreamId }) {
  const { toast } = useToast();
  const streamQuery = useStream(streamId);
  const startStream = useStartStream(streamId);
  const stopStream = useStopStream(streamId);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    setUserId(getStoredUser()?.id ?? null);
  }, []);

  if (streamQuery.isLoading) {
    return <Skeleton variant="rounded" height={160} sx={{ bgcolor: 'action.hover' }} />;
  }

  if (streamQuery.isError || !streamQuery.data) {
    const message =
      streamQuery.error instanceof ApiRequestError
        ? streamQuery.error.message
        : 'Failed to load this stream.';
    return (
      <Card>
        <CardBody sx={{ p: 4, textAlign: 'center' }}>
          <Stack spacing={1.5} alignItems="center">
            <Typography variant="body2" color="error">
              {message}
            </Typography>
            <Link
              component={NextLink}
              href="/dashboard"
              variant="body2"
              sx={{ color: 'primary.light' }}
            >
              Back to dashboard
            </Link>
          </Stack>
        </CardBody>
      </Card>
    );
  }

  const stream = streamQuery.data;
  const isOwner = userId !== null && stream.ownerId === userId;
  // The API authorizes control actions; the UI optimistically allows owners and
  // assumes shared users may have control (viewers get a 403 surfaced as a toast).
  const canControl = true;
  const live =
    stream.status === 'live' || stream.status === 'failover' || stream.status === 'starting';

  const onStart = (): void => {
    startStream.mutate(undefined, {
      onSuccess: () => {
        toast('Broadcast starting', 'success');
      },
      onError: (err) => {
        toast(err instanceof ApiRequestError ? err.message : 'Failed to start', 'error');
      },
    });
  };

  const onStop = (): void => {
    stopStream.mutate(undefined, {
      onSuccess: () => {
        toast('Broadcast stopped', 'success');
      },
      onError: (err) => {
        toast(err instanceof ApiRequestError ? err.message : 'Failed to stop', 'error');
      },
    });
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Link
          component={NextLink}
          href="/dashboard"
          sx={{ fontSize: '0.75rem', color: 'text.secondary', textDecoration: 'none' }}
        >
          ← All streams
        </Link>
        <Box
          sx={{
            mt: 1,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h1" sx={{ fontSize: '1.5rem', fontWeight: 600 }}>
              {stream.title}
            </Typography>
            <StreamStatusBadge status={stream.status} />
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {live ? (
              <Button variant="danger" loading={stopStream.isPending} onClick={onStop}>
                Stop broadcast
              </Button>
            ) : (
              <Button variant="success" loading={startStream.isPending} onClick={onStart}>
                Start broadcast
              </Button>
            )}
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          {stream.output.resolution.width}×{stream.output.resolution.height} @{' '}
          {stream.output.framerate}fps · {stream.output.videoBitrateKbps} kbps ·{' '}
          {stream.output.preset}
        </Typography>
      </Box>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Stack spacing={3}>
            <LiveStatusPanel streamId={streamId} stream={stream} live={live} />
            <EasyConnectPanel streamId={streamId} />
            <IngestsManager
              streamId={streamId}
              stream={stream}
              canControl={canControl}
              isOwner={isOwner}
            />
            <DestinationsManager streamId={streamId} stream={stream} canControl={canControl} />
            <ScenesManager
              streamId={streamId}
              stream={stream}
              canControl={canControl}
              live={live}
            />
            <ClipsManager streamId={streamId} stream={stream} canControl={canControl} />
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <Stack spacing={3}>
            <FailoverSettings streamId={streamId} stream={stream} canControl={canControl} />
            <FriendsManager streamId={streamId} stream={stream} isOwner={isOwner} />
          </Stack>
        </Grid>
      </Grid>
    </Stack>
  );
}
