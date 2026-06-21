'use client';

import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  CreateDestinationRequest,
  DestinationPlatform,
  type Destination,
  type StreamId,
  type StreamWithChildren,
} from '@openrelay/core';
import { useState, type SyntheticEvent } from 'react';
import { DestinationStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ApiRequestError } from '@/lib/api';
import { useCreateDestination, useDeleteDestination, useUpdateDestination } from '@/lib/queries';

const PLATFORMS = DestinationPlatform.options;
const REDACTED = '__redacted__';

const PLATFORM_LABEL: Record<DestinationPlatform, string> = {
  twitch: 'Twitch',
  kick: 'Kick',
  youtube: 'YouTube',
  custom_rtmp: 'Custom RTMP',
};

export function DestinationsManager({
  streamId,
  stream,
  canControl,
}: {
  streamId: StreamId;
  stream: StreamWithChildren;
  canControl: boolean;
}) {
  const { toast } = useToast();
  const createDest = useCreateDestination(streamId);
  const updateDest = useUpdateDestination(streamId);
  const deleteDest = useDeleteDestination(streamId);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [platform, setPlatform] = useState<DestinationPlatform>('twitch');
  const [url, setUrl] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setLabel('');
    setPlatform('twitch');
    setUrl('');
    setStreamKey('');
    setError(null);
  };

  const onCreate = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    const parsed = CreateDestinationRequest.safeParse({
      label,
      platform,
      url,
      streamKey,
      enabled: true,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    createDest.mutate(parsed.data, {
      onSuccess: () => {
        setOpen(false);
        reset();
        toast('Destination added', 'success');
      },
      onError: (err) => {
        setError(err instanceof ApiRequestError ? err.message : 'Failed to add destination');
      },
    });
  };

  const onToggle = (dest: Destination): void => {
    updateDest.mutate(
      { destinationId: dest.id, input: { enabled: !dest.enabled } },
      {
        onError: (err) => {
          toast(err instanceof ApiRequestError ? err.message : 'Update failed', 'error');
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader
        title="Destinations"
        description="Platforms the relay multistreams to."
        action={
          canControl ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                reset();
                setOpen(true);
              }}
            >
              Add destination
            </Button>
          ) : null
        }
      />
      <CardBody>
        <Stack spacing={1.5}>
          {stream.destinations.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No destinations yet.
            </Typography>
          ) : (
            stream.destinations.map((dest) => (
              <Box
                key={dest.id}
                sx={{
                  borderRadius: 1.5,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'background.default',
                  p: 1.5,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary' }}>
                      {dest.label}
                    </Typography>
                    <Box
                      component="span"
                      sx={{
                        borderRadius: 0.75,
                        px: 0.75,
                        py: 0.25,
                        fontSize: '10px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        color: 'text.primary',
                        bgcolor: 'action.selected',
                      }}
                    >
                      {PLATFORM_LABEL[dest.platform]}
                    </Box>
                  </Box>
                  <DestinationStatusBadge status={dest.status} />
                </Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    mt: 1,
                    display: 'block',
                    fontFamily: 'monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {dest.url}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 0.5, display: 'block' }}
                >
                  Key:{' '}
                  <Box component="span" sx={{ fontFamily: 'monospace' }}>
                    {dest.streamKey === REDACTED ? '•••••••• (hidden)' : dest.streamKey}
                  </Box>
                </Typography>
                {canControl ? (
                  <Box
                    sx={{
                      mt: 1.5,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <FormControlLabel
                      sx={{
                        m: 0,
                        gap: 1,
                        '& .MuiFormControlLabel-label': {
                          fontSize: '0.75rem',
                          color: 'text.primary',
                        },
                      }}
                      control={
                        <Checkbox
                          size="small"
                          checked={dest.enabled}
                          onChange={() => {
                            onToggle(dest);
                          }}
                          sx={{ p: 0 }}
                        />
                      }
                      label="Enabled"
                    />
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        deleteDest.mutate(dest.id, {
                          onSuccess: () => {
                            toast('Destination removed', 'success');
                          },
                          onError: (err) => {
                            toast(
                              err instanceof ApiRequestError ? err.message : 'Delete failed',
                              'error',
                            );
                          },
                        });
                      }}
                    >
                      Delete
                    </Button>
                  </Box>
                ) : (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mt: 1.5, display: 'block' }}
                  >
                    {dest.enabled ? 'Enabled' : 'Disabled'}
                  </Typography>
                )}
              </Box>
            ))
          )}
        </Stack>
      </CardBody>

      <Modal
        open={open}
        title="Add destination"
        description="Stream keys are stored write-only and redacted in responses."
        onClose={() => {
          setOpen(false);
        }}
      >
        <Box component="form" onSubmit={onCreate}>
          <Stack spacing={2}>
            <Field label="Label" htmlFor="destLabel" error={error ?? undefined}>
              <Input
                id="destLabel"
                value={label}
                autoFocus
                onChange={(e) => {
                  setLabel(e.target.value);
                }}
                placeholder="Twitch main"
              />
            </Field>
            <Field label="Platform" htmlFor="destPlatform">
              <Select
                id="destPlatform"
                value={platform}
                onChange={(e) => {
                  setPlatform(e.target.value as DestinationPlatform);
                }}
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABEL[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ingest URL" htmlFor="destUrl" hint="RTMP(S) URL of the destination.">
              <Input
                id="destUrl"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                }}
                placeholder="rtmp://live.twitch.tv/app"
              />
            </Field>
            <Field label="Stream key" htmlFor="destKey">
              <Input
                id="destKey"
                type="password"
                value={streamKey}
                onChange={(e) => {
                  setStreamKey(e.target.value);
                }}
                placeholder="live_xxxxxxxx"
              />
            </Field>
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={createDest.isPending}>
                Add
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Modal>
    </Card>
  );
}
