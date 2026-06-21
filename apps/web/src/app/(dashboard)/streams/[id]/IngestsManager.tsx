'use client';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import {
  CreateIngestRequest,
  CreateSharedIngestRequest,
  IngestProtocol,
  type StreamId,
  type StreamWithChildren,
} from '@openrelay/core';
import { useState, type SyntheticEvent } from 'react';
import { IngestStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { CopyButton } from '@/components/ui/CopyButton';
import { Field, Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ApiRequestError, type CreatedIngest, type CreatedSharedIngest } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import {
  useCreateIngest,
  useCreateSharedIngest,
  useDeleteIngest,
  useSetActiveIngest,
} from '@/lib/queries';

const PROTOCOLS = IngestProtocol.options;

const chipSx = {
  borderRadius: 0.75,
  px: 0.75,
  py: 0.25,
  fontSize: '10px',
  fontWeight: 600,
  textTransform: 'uppercase',
} as const;

export function IngestsManager({
  streamId,
  stream,
  canControl,
  isOwner,
}: {
  streamId: StreamId;
  stream: StreamWithChildren;
  canControl: boolean;
  isOwner: boolean;
}) {
  const { toast } = useToast();
  const createIngest = useCreateIngest(streamId);
  const createShared = useCreateSharedIngest(streamId);
  const deleteIngest = useDeleteIngest(streamId);
  const setActive = useSetActiveIngest(streamId);
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<CreatedIngest | null>(null);
  const [label, setLabel] = useState('');
  const [protocol, setProtocol] = useState<IngestProtocol>('rtmp');
  const [error, setError] = useState<string | null>(null);

  // Shared / guest ingest provisioning.
  const [shareOpen, setShareOpen] = useState(false);
  const [sharedCreated, setSharedCreated] = useState<CreatedSharedIngest | null>(null);
  const [guestLabel, setGuestLabel] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestProtocol, setGuestProtocol] = useState<IngestProtocol>('rtmp');
  const [shareError, setShareError] = useState<string | null>(null);

  const onCreate = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    const parsed = CreateIngestRequest.safeParse({ label, protocol });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    createIngest.mutate(parsed.data, {
      onSuccess: (ingest) => {
        setCreated(ingest);
        setLabel('');
        toast('Ingest created', 'success');
      },
      onError: (err) => {
        setError(err instanceof ApiRequestError ? err.message : 'Failed to create ingest');
      },
    });
  };

  const onProvisionShared = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setShareError(null);
    const parsed = CreateSharedIngestRequest.safeParse({
      label: guestLabel,
      protocol: guestProtocol,
      ownerEmail: guestEmail,
    });
    if (!parsed.success) {
      setShareError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    createShared.mutate(parsed.data, {
      onSuccess: (ingest) => {
        setSharedCreated(ingest);
        setGuestLabel('');
        setGuestEmail('');
        toast('Guest ingest provisioned', 'success');
      },
      onError: (err) => {
        setShareError(
          err instanceof ApiRequestError ? err.message : 'Failed to provision guest ingest',
        );
      },
    });
  };

  return (
    <Card>
      <CardHeader
        title="Ingests"
        description="Where your encoder pushes the source feed."
        action={
          canControl ? (
            <Box sx={{ display: 'flex', gap: 1 }}>
              {isOwner ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSharedCreated(null);
                    setShareError(null);
                    setShareOpen(true);
                  }}
                >
                  Provision guest
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setCreated(null);
                  setError(null);
                  setOpen(true);
                }}
              >
                Add ingest
              </Button>
            </Box>
          ) : null
        }
      />
      <CardBody>
        <Stack spacing={1.5}>
          {stream.ingests.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No ingests yet. Add one to get a publish URL.
            </Typography>
          ) : (
            stream.ingests.map((ingest) => (
              <Box
                key={ingest.id}
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
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary' }}>
                      {ingest.label}
                    </Typography>
                    <Box
                      component="span"
                      sx={{ ...chipSx, color: 'text.primary', bgcolor: 'action.selected' }}
                    >
                      {ingest.protocol}
                    </Box>
                    {ingest.ownerUserId !== null ? (
                      <Box
                        component="span"
                        sx={{
                          ...chipSx,
                          color: 'warning.main',
                          bgcolor: (t) => alpha(t.palette.warning.main, 0.2),
                        }}
                      >
                        Guest
                      </Box>
                    ) : null}
                    {ingest.isActive ? (
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
                  </Box>
                  <IngestStatusBadge status={ingest.status} />
                </Box>

                {ingest.ownerUserId !== null ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mt: 0.5, display: 'block', fontFamily: 'monospace', fontSize: '10px' }}
                  >
                    owned by {ingest.ownerUserId}
                  </Typography>
                ) : null}

                <Box sx={{ mt: 1.5 }}>
                  <KeyRow label="Stream key" value={ingest.streamKey} mono />
                </Box>

                <Box
                  sx={{
                    mt: 1.5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Last seen {formatRelativeTime(ingest.lastSeenAt)}
                  </Typography>
                  {canControl ? (
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      {!ingest.isActive ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={setActive.isPending}
                          onClick={() => {
                            setActive.mutate(ingest.id, {
                              onSuccess: () => {
                                toast('Active ingest switched', 'success');
                              },
                              onError: (err) => {
                                toast(
                                  err instanceof ApiRequestError ? err.message : 'Switch failed',
                                  'error',
                                );
                              },
                            });
                          }}
                        >
                          Set active
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          deleteIngest.mutate(ingest.id, {
                            onSuccess: () => {
                              toast('Ingest deleted', 'success');
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
                  ) : null}
                </Box>
              </Box>
            ))
          )}
        </Stack>
      </CardBody>

      <Modal
        open={open}
        title={created ? 'Ingest created' : 'Add ingest'}
        description={
          created
            ? 'Point your encoder at the publish URL below.'
            : 'A unique stream key is generated for this ingest.'
        }
        onClose={() => {
          setOpen(false);
        }}
      >
        {created ? (
          <Stack spacing={1.5}>
            <KeyRow label="Publish URL" value={created.pushUrl} mono />
            <KeyRow label="Stream key" value={created.streamKey} mono />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="primary"
                onClick={() => {
                  setOpen(false);
                }}
              >
                Done
              </Button>
            </Box>
          </Stack>
        ) : (
          <Box component="form" onSubmit={onCreate}>
            <Stack spacing={2}>
              <Field label="Label" htmlFor="ingestLabel" error={error ?? undefined}>
                <Input
                  id="ingestLabel"
                  value={label}
                  autoFocus
                  onChange={(e) => {
                    setLabel(e.target.value);
                  }}
                  placeholder="Backpack encoder"
                />
              </Field>
              <Field label="Protocol" htmlFor="ingestProtocol">
                <Select
                  id="ingestProtocol"
                  value={protocol}
                  onChange={(e) => {
                    setProtocol(e.target.value as IngestProtocol);
                  }}
                >
                  {PROTOCOLS.map((p) => (
                    <option key={p} value={p}>
                      {p.toUpperCase()}
                    </option>
                  ))}
                </Select>
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
                <Button type="submit" variant="primary" loading={createIngest.isPending}>
                  Create
                </Button>
              </Stack>
            </Stack>
          </Box>
        )}
      </Modal>

      <Modal
        open={shareOpen}
        title={sharedCreated ? 'Guest ingest ready' : 'Provision guest ingest'}
        description={
          sharedCreated
            ? 'Share these connection details with your collaborator.'
            : 'Create a dedicated ingest owned by an existing collaborator.'
        }
        onClose={() => {
          setShareOpen(false);
        }}
      >
        {sharedCreated ? (
          <Stack spacing={1.5}>
            <KeyRow label="Server / URL" value={sharedCreated.connection.server} mono />
            <KeyRow label="Stream key" value={sharedCreated.connection.streamKey} mono />
            <KeyRow label="Single-line URL" value={sharedCreated.connection.url} mono />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="primary"
                onClick={() => {
                  setShareOpen(false);
                }}
              >
                Done
              </Button>
            </Box>
          </Stack>
        ) : (
          <Box component="form" onSubmit={onProvisionShared}>
            <Stack spacing={2}>
              <Field
                label="Collaborator email"
                htmlFor="guestEmail"
                error={shareError ?? undefined}
                hint="Must already be a teammate on this stream."
              >
                <Input
                  id="guestEmail"
                  type="email"
                  value={guestEmail}
                  autoFocus
                  onChange={(e) => {
                    setGuestEmail(e.target.value);
                  }}
                  placeholder="guest@example.com"
                />
              </Field>
              <Field label="Label" htmlFor="guestLabel">
                <Input
                  id="guestLabel"
                  value={guestLabel}
                  onChange={(e) => {
                    setGuestLabel(e.target.value);
                  }}
                  placeholder="Guest backpack"
                />
              </Field>
              <Field label="Protocol" htmlFor="guestProtocol">
                <Select
                  id="guestProtocol"
                  value={guestProtocol}
                  onChange={(e) => {
                    setGuestProtocol(e.target.value as IngestProtocol);
                  }}
                >
                  {PROTOCOLS.map((p) => (
                    <option key={p} value={p}>
                      {p.toUpperCase()}
                    </option>
                  ))}
                </Select>
              </Field>
              <Stack direction="row" spacing={1} justifyContent="flex-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShareOpen(false);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={createShared.isPending}>
                  Provision
                </Button>
              </Stack>
            </Stack>
          </Box>
        )}
      </Modal>
    </Card>
  );
}

function KeyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            display: 'block',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            fontSize: '10px',
          }}
        >
          {label}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            color: 'text.primary',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            ...(mono ? { fontFamily: 'monospace' } : {}),
          }}
        >
          {value}
        </Typography>
      </Box>
      <CopyButton value={value} />
    </Box>
  );
}
