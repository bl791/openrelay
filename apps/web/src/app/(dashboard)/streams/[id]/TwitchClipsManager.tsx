'use client';

import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid2';
import {
  type ListTwitchClipsRequest,
  type StreamId,
  type TwitchClipSummary,
} from '@openrelay/core';
import { useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { api, ApiRequestError } from '@/lib/api';
import {
  useDisconnectTwitch,
  useImportTwitchClips,
  useListTwitchClips,
  useTwitchConnection,
} from '@/lib/queries';

type Period = ListTwitchClipsRequest['period'];

const PERIODS: { value: Period; label: string }[] = [
  { value: 'day', label: 'Last 24 hours' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

/** Render a clip's duration (e.g. 72s -> "1:12"). */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins)}:${secs.toString().padStart(2, '0')}`;
}

/** Compact view-count formatting (1500 -> "1.5K"). */
function formatViews(views: number): string {
  if (views >= 1000) {
    return `${(views / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(views);
}

/**
 * The server has no Twitch credentials at all (vs. the user simply not having
 * linked an account). The API surfaces this as a 400 `validation_error` with a
 * distinctive message, so match on both rather than relying on a unique code.
 */
function isNotConfigured(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    error.status === 400 &&
    /not configured/i.test(error.message)
  );
}

/**
 * Twitch import surface for the media library: shows the connect/disconnect state
 * and an "Import from Twitch" picker that lists a channel's clips and imports the
 * selected ones into the stream (stored as `source: 'twitch'` clips).
 */
export function TwitchClipsManager({
  streamId,
  canControl,
}: {
  streamId: StreamId;
  canControl: boolean;
}) {
  const { toast } = useToast();
  const connectionQuery = useTwitchConnection();
  const disconnect = useDisconnectTwitch();
  const listClips = useListTwitchClips(streamId);
  const importClips = useImportTwitchClips(streamId);

  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState('');
  const [period, setPeriod] = useState<Period>('week');
  const [limit, setLimit] = useState(20);
  const [results, setResults] = useState<TwitchClipSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [connecting, setConnecting] = useState(false);

  if (connectionQuery.isLoading) {
    return <CircularProgress size={16} color="inherit" />;
  }

  if (notConfigured) {
    return (
      <Typography variant="caption" color="text.secondary">
        Twitch integration isn&apos;t configured on this server
      </Typography>
    );
  }

  const connection = connectionQuery.data ?? null;

  const onConnect = (): void => {
    setConnecting(true);
    void (async (): Promise<void> => {
      try {
        const result = await api.getTwitchConnectUrl();
        window.location.href = result.authorizeUrl;
      } catch (err) {
        setConnecting(false);
        if (isNotConfigured(err)) {
          setNotConfigured(true);
          return;
        }
        toast(
          err instanceof ApiRequestError ? err.message : 'Failed to start Twitch connect',
          'error',
        );
      }
    })();
  };

  const onDisconnect = (): void => {
    disconnect.mutate(undefined, {
      onSuccess: () => {
        toast('Twitch disconnected', 'success');
      },
      onError: (err) => {
        toast(err instanceof ApiRequestError ? err.message : 'Failed to disconnect', 'error');
      },
    });
  };

  const openImport = (): void => {
    setError(null);
    setResults([]);
    setSelected(new Set());
    setChannel(connection?.twitchLogin ?? '');
    setPeriod('week');
    setLimit(20);
    setOpen(true);
  };

  const onSearch = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    const trimmed = channel.trim();
    if (trimmed.length === 0) {
      setError('Enter a Twitch channel login.');
      return;
    }
    setSelected(new Set());
    listClips.mutate(
      { channel: trimmed, period, limit },
      {
        onSuccess: (clips) => {
          setResults(clips);
          if (clips.length === 0) {
            setError('No clips found for that channel and period.');
          }
        },
        onError: (err) => {
          setResults([]);
          if (isNotConfigured(err)) {
            setOpen(false);
            setNotConfigured(true);
            return;
          }
          setError(err instanceof ApiRequestError ? err.message : 'Failed to list clips');
        },
      },
    );
  };

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const onImport = (): void => {
    const clipIds = [...selected];
    if (clipIds.length === 0) {
      return;
    }
    importClips.mutate(
      { clipIds },
      {
        onSuccess: (imported) => {
          setOpen(false);
          toast(
            `Imported ${String(imported.length)} clip${imported.length === 1 ? '' : 's'} from Twitch`,
            'success',
          );
        },
        onError: (err) => {
          setError(err instanceof ApiRequestError ? err.message : 'Failed to import clips');
        },
      },
    );
  };

  return (
    <>
      {connection ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="caption" color="text.secondary">
            {connection.twitchLogin}
          </Typography>
          <Button size="sm" variant="secondary" disabled={!canControl} onClick={openImport}>
            Import from Twitch
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!canControl}
            loading={disconnect.isPending}
            onClick={onDisconnect}
          >
            Disconnect
          </Button>
        </Stack>
      ) : (
        <Button
          size="sm"
          variant="primary"
          disabled={!canControl}
          loading={connecting}
          onClick={onConnect}
        >
          Connect Twitch
        </Button>
      )}

      <Modal
        open={open}
        title="Import from Twitch"
        description="List a channel's clips, then select which to import into this library."
        onClose={() => {
          setOpen(false);
        }}
      >
        <Stack spacing={2}>
          <Box
            component="form"
            onSubmit={onSearch}
            sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <Field label="Channel" htmlFor="twitchChannel">
              <Input
                id="twitchChannel"
                value={channel}
                autoFocus
                onChange={(e) => {
                  setChannel(e.target.value);
                }}
                placeholder="shroud"
              />
            </Field>
            <Grid container spacing={2}>
              <Grid size={{ xs: 8 }}>
                <Field label="Period" htmlFor="twitchPeriod">
                  <Select
                    id="twitchPeriod"
                    value={period}
                    onChange={(e) => {
                      setPeriod(e.target.value as Period);
                    }}
                  >
                    {PERIODS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </Grid>
              <Grid size={{ xs: 4 }}>
                <Field label="Count" htmlFor="twitchLimit">
                  <Input
                    id="twitchLimit"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={50}
                    value={String(limit)}
                    onChange={(e) => {
                      const parsed = Number.parseInt(e.target.value, 10);
                      setLimit(Number.isNaN(parsed) ? 1 : Math.min(50, Math.max(1, parsed)));
                    }}
                  />
                </Field>
              </Grid>
            </Grid>
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button type="submit" variant="secondary" loading={listClips.isPending}>
                List clips
              </Button>
            </Stack>
          </Box>

          {error ? (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          ) : null}

          {results.length > 0 ? (
            <Grid container spacing={1.5}>
              {results.map((clip) => {
                const isSelected = selected.has(clip.id);
                return (
                  <Grid key={clip.id} size={{ xs: 12, sm: 6 }}>
                    <Box
                      onClick={() => {
                        toggle(clip.id);
                      }}
                      sx={{
                        cursor: 'pointer',
                        display: 'flex',
                        gap: 1,
                        borderRadius: 1.5,
                        border: 1,
                        borderColor: isSelected ? 'primary.main' : 'divider',
                        bgcolor: 'background.default',
                        p: 1,
                        transition: 'border-color 120ms',
                      }}
                    >
                      <Box sx={{ position: 'relative', flexShrink: 0 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={clip.thumbnailUrl}
                          alt={clip.title}
                          width={96}
                          height={54}
                          style={{ borderRadius: 4, display: 'block', objectFit: 'cover' }}
                        />
                        <Checkbox
                          checked={isSelected}
                          size="small"
                          sx={{ position: 'absolute', top: -6, left: -6, p: 0.5 }}
                          slotProps={{ input: { 'aria-label': `Select ${clip.title}` } }}
                        />
                      </Box>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                          variant="body2"
                          sx={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: 'text.primary',
                          }}
                        >
                          {clip.title}
                        </Typography>
                        <Typography
                          sx={{
                            fontSize: '0.625rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            color: 'text.secondary',
                          }}
                        >
                          {clip.creatorName} · {formatDuration(clip.durationSeconds)} ·{' '}
                          {formatViews(clip.viewCount)} views
                        </Typography>
                      </Box>
                    </Box>
                  </Grid>
                );
              })}
            </Grid>
          ) : null}

          <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
            <Typography variant="caption" color="text.secondary">
              {selected.size} selected
            </Typography>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={selected.size === 0}
              loading={importClips.isPending}
              onClick={onImport}
            >
              Import selected
            </Button>
          </Stack>
        </Stack>
      </Modal>
    </>
  );
}
