'use client';

import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid2';
import { alpha } from '@mui/material/styles';
import {
  CreateStreamRequest,
  IngestProtocol,
  type QuickstartResponse,
  type Stream,
} from '@openrelay/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { EasyConnectSettings } from '@/components/EasyConnectSettings';
import { StreamStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ApiRequestError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useCreateStream, useQuickstart, useStreams } from '@/lib/queries';

const PROTOCOLS = IngestProtocol.options;

export function DashboardClient() {
  const { toast } = useToast();
  const router = useRouter();
  const streams = useStreams();
  const createStream = useCreateStream();
  const quickstart = useQuickstart();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Quickstart / easy-connect flow.
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickTitle, setQuickTitle] = useState('My Stream');
  const [quickProtocol, setQuickProtocol] = useState<IngestProtocol>('rtmp');
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickResult, setQuickResult] = useState<QuickstartResponse | null>(null);

  const onQuickstart = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setQuickError(null);
    quickstart.mutate(
      { title: quickTitle.trim() || 'My Stream', protocol: quickProtocol },
      {
        onSuccess: (result) => {
          setQuickResult(result);
          toast('Stream ready — go live!', 'success');
        },
        onError: (err) => {
          setQuickError(err instanceof ApiRequestError ? err.message : 'Quickstart failed');
        },
      },
    );
  };

  const openQuickstart = (): void => {
    setQuickResult(null);
    setQuickError(null);
    setQuickTitle('My Stream');
    setQuickProtocol('rtmp');
    setQuickOpen(true);
  };

  const onCreate = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    const parsed = CreateStreamRequest.safeParse({ title });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid title');
      return;
    }
    createStream.mutate(parsed.data, {
      onSuccess: () => {
        setOpen(false);
        setTitle('');
        toast('Stream created', 'success');
      },
      onError: (err) => {
        setError(err instanceof ApiRequestError ? err.message : 'Failed to create stream');
      },
    });
  };

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h1" sx={{ fontSize: '1.25rem', fontWeight: 600 }}>
            Streams
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Your broadcasts and the channels they fan out to.
          </Typography>
        </Box>
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true);
          }}
        >
          New stream
        </Button>
      </Box>

      <Card
        sx={{
          borderColor: (t) => alpha(t.palette.primary.main, 0.4),
          background: (t) =>
            `linear-gradient(135deg, ${alpha(t.palette.primary.main, 0.1)}, ${alpha(
              t.palette.background.paper,
              0.6,
            )})`,
        }}
      >
        <CardBody
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { xs: 'flex-start', sm: 'center' },
            justifyContent: 'space-between',
            gap: 2,
            p: 3,
          }}
        >
          <Box>
            <Typography variant="h2" sx={{ fontSize: '1.125rem', fontWeight: 600 }}>
              Go live in seconds
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 448 }}>
              Quickstart provisions a stream, a primary ingest and default scenes, then hands you
              copy-paste encoder settings and a QR code for your phone.
            </Typography>
          </Box>
          <Button variant="primary" size="md" onClick={openQuickstart} sx={{ flexShrink: 0 }}>
            Quickstart
          </Button>
        </CardBody>
      </Card>

      {streams.isLoading ? (
        <SkeletonGrid />
      ) : streams.isError ? (
        <Card>
          <CardBody sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="body2" color="error">
              {streams.error instanceof ApiRequestError
                ? streams.error.message
                : 'Failed to load streams.'}
            </Typography>
          </CardBody>
        </Card>
      ) : streams.data && streams.data.length > 0 ? (
        <Grid container spacing={2}>
          {streams.data.map((stream) => (
            <Grid key={stream.id} size={{ xs: 12, sm: 6, lg: 4 }}>
              <StreamCard stream={stream} />
            </Grid>
          ))}
        </Grid>
      ) : (
        <Card>
          <CardBody
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1.5,
              p: 6,
              textAlign: 'center',
            }}
          >
            <Typography variant="body2" sx={{ color: 'text.primary' }}>
              No streams yet.
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 384 }}>
              Create your first stream to get an ingest endpoint and start multistreaming with
              drop-protection.
            </Typography>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setOpen(true);
              }}
            >
              Create a stream
            </Button>
          </CardBody>
        </Card>
      )}

      <Modal
        open={open}
        title="New stream"
        description="A stream owns its ingests, destinations, scenes and failover policy."
        onClose={() => {
          setOpen(false);
        }}
      >
        <Box component="form" onSubmit={onCreate}>
          <Stack spacing={2}>
            <Field label="Title" htmlFor="streamTitle" error={error ?? undefined}>
              <Input
                id="streamTitle"
                value={title}
                autoFocus
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
                placeholder="Friday IRL ride"
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
              <Button type="submit" variant="primary" loading={createStream.isPending}>
                Create
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Modal>

      <Modal
        open={quickOpen}
        title={quickResult ? 'You are ready to stream' : 'Quickstart'}
        description={
          quickResult
            ? 'Copy these into your encoder, or scan the QR with a mobile app.'
            : 'Spin up a stream with a primary ingest and default scenes in one step.'
        }
        onClose={() => {
          setQuickOpen(false);
        }}
      >
        {quickResult ? (
          <Stack spacing={2.5}>
            <EasyConnectSettings
              connection={quickResult.ingest}
              connectToken={quickResult.connectToken}
            />
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button
                variant="ghost"
                onClick={() => {
                  setQuickOpen(false);
                }}
              >
                Close
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  router.push(`/streams/${quickResult.streamId}`);
                }}
              >
                Open stream
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Box component="form" onSubmit={onQuickstart}>
            <Stack spacing={2}>
              <Field label="Title" htmlFor="quickTitle" error={quickError ?? undefined}>
                <Input
                  id="quickTitle"
                  value={quickTitle}
                  autoFocus
                  onChange={(e) => {
                    setQuickTitle(e.target.value);
                  }}
                  placeholder="Friday IRL ride"
                />
              </Field>
              <Field label="Ingest protocol" htmlFor="quickProtocol">
                <Select
                  id="quickProtocol"
                  value={quickProtocol}
                  onChange={(e) => {
                    setQuickProtocol(e.target.value as IngestProtocol);
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
                    setQuickOpen(false);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={quickstart.isPending}>
                  Go live in seconds
                </Button>
              </Stack>
            </Stack>
          </Box>
        )}
      </Modal>
    </Stack>
  );
}

function StreamCard({ stream }: { stream: Stream }) {
  return (
    <Card
      sx={{
        height: '100%',
        transition: 'border-color 120ms',
        '&:hover': { borderColor: (t) => alpha(t.palette.primary.main, 0.6) },
      }}
    >
      <Box
        component={Link}
        href={`/streams/${stream.id}`}
        sx={{ display: 'block', color: 'inherit', textDecoration: 'none' }}
      >
        <CardBody sx={{ p: 2.5 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 1.5,
            }}
          >
            <Typography variant="h3" sx={{ fontWeight: 600 }}>
              {stream.title}
            </Typography>
            <StreamStatusBadge status={stream.status} />
          </Box>
          <Stack
            component="dl"
            spacing={0.5}
            sx={{ mt: 2, fontSize: '0.75rem', color: 'text.secondary' }}
          >
            <DetailRow label="Resolution">
              {stream.output.resolution.width}×{stream.output.resolution.height} @{' '}
              {stream.output.framerate}fps
            </DetailRow>
            <DetailRow label="Failover">
              <Box component="span" sx={{ textTransform: 'capitalize' }}>
                {stream.failover.mode} · {stream.failover.graceSeconds}s grace
              </Box>
            </DetailRow>
            <DetailRow label="Created">{formatDate(stream.createdAt)}</DetailRow>
          </Stack>
        </CardBody>
      </Box>
    </Card>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
      <Box component="dt">{label}</Box>
      <Box component="dd" sx={{ m: 0, color: 'text.primary' }}>
        {children}
      </Box>
    </Box>
  );
}

function SkeletonGrid() {
  return (
    <Grid container spacing={2}>
      {[0, 1, 2].map((i) => (
        <Grid key={i} size={{ xs: 12, sm: 6, lg: 4 }}>
          <Skeleton variant="rounded" height={144} sx={{ bgcolor: 'action.hover' }} />
        </Grid>
      ))}
    </Grid>
  );
}
