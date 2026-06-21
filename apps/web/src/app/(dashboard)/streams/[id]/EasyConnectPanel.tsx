'use client';

import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import { type StreamId } from '@openrelay/core';
import { EasyConnectSettings } from '@/components/EasyConnectSettings';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ApiRequestError } from '@/lib/api';
import { useConnection } from '@/lib/queries';

/**
 * Easy-connect panel for an existing stream: copy-paste encoder settings + QR for
 * the stream's primary ingest. Renders nothing intrusive when the stream has no
 * ingest yet (the ingests manager guides the user to add one).
 */
export function EasyConnectPanel({ streamId }: { streamId: StreamId }) {
  const connection = useConnection(streamId);

  return (
    <Card>
      <CardHeader
        title="Easy connect"
        description="Point any encoder at your primary ingest, or scan to set up your phone."
      />
      <CardBody>
        {connection.isLoading ? (
          <Skeleton variant="rounded" height={176} />
        ) : connection.isError ? (
          <Typography variant="body2" color="text.secondary">
            {connection.error instanceof ApiRequestError && connection.error.status === 404
              ? 'No ingest yet — add one below to get copy-paste connect settings.'
              : 'Could not load connection details.'}
          </Typography>
        ) : connection.data ? (
          <EasyConnectSettings connection={connection.data} />
        ) : null}
      </CardBody>
    </Card>
  );
}
