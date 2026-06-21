'use client';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { type StreamId, type StreamWithChildren } from '@openrelay/core';
import { useRef, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ApiRequestError } from '@/lib/api';
import { useDeleteClip, useUploadClip } from '@/lib/queries';
import { palette } from '@/theme';

/** Format a byte count for compact display. */
function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '—';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit] ?? 'B'}`;
}

export function ClipsManager({
  streamId,
  stream,
  canControl,
}: {
  streamId: StreamId;
  stream: StreamWithChildren;
  canControl: boolean;
}) {
  const { toast } = useToast();
  const uploadClip = useUploadClip(streamId);
  const deleteClip = useDeleteClip(streamId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onUpload = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    const finalLabel = label.trim().length > 0 ? label.trim() : file.name;
    uploadClip.mutate(
      { file, label: finalLabel },
      {
        onSuccess: () => {
          setOpen(false);
          setLabel('');
          setFile(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          toast('Clip uploaded', 'success');
        },
        onError: (err) => {
          setError(err instanceof ApiRequestError ? err.message : 'Upload failed');
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader
        title="Media library"
        description="Clips & BRB media the engine loops during failover or clips scenes."
        action={
          canControl ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setError(null);
                setOpen(true);
              }}
            >
              Upload clip
            </Button>
          ) : null
        }
      />
      <CardBody>
        <Stack spacing={1}>
          {stream.clips.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No clips yet. Upload BRB media or a clips reel.
            </Typography>
          ) : (
            stream.clips.map((clip) => (
              <Box
                key={clip.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1,
                  borderRadius: 1.5,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'background.default',
                  px: 1.5,
                  py: 1,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Link
                    href={clip.url}
                    target="_blank"
                    rel="noreferrer"
                    sx={{
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: '0.875rem',
                      color: 'text.primary',
                      textDecoration: 'none',
                      '&:hover': { color: 'primary.light' },
                    }}
                  >
                    {clip.label}
                  </Link>
                  <Typography
                    sx={{
                      fontSize: '0.625rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'text.secondary',
                    }}
                  >
                    {clip.contentType} · {formatBytes(clip.sizeBytes)}
                  </Typography>
                </Box>
                {canControl ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      deleteClip.mutate(clip.id, {
                        onSuccess: () => {
                          toast('Clip deleted', 'success');
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
                ) : null}
              </Box>
            ))
          )}
        </Stack>
      </CardBody>

      <Modal
        open={open}
        title="Upload clip"
        description="The file uploads directly to object storage; only metadata is stored here."
        onClose={() => {
          setOpen(false);
        }}
      >
        <Box
          component="form"
          onSubmit={onUpload}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Field label="Label" htmlFor="clipLabel">
            <Input
              id="clipLabel"
              value={label}
              autoFocus
              onChange={(e) => {
                setLabel(e.target.value);
              }}
              placeholder="BRB loop"
            />
          </Field>
          <Field label="File" htmlFor="clipFile" error={error ?? undefined}>
            <Box
              component="input"
              id="clipFile"
              ref={fileInputRef}
              type="file"
              accept="video/*,image/*"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
              }}
              sx={{
                width: '100%',
                borderRadius: 1.5,
                border: 1,
                borderColor: 'divider',
                bgcolor: 'background.default',
                px: 1.5,
                py: 1,
                fontSize: '0.875rem',
                color: 'text.primary',
                '&::file-selector-button': {
                  mr: 1.5,
                  borderRadius: 1,
                  border: 0,
                  bgcolor: palette.surface[700],
                  px: 1,
                  py: 0.5,
                  fontSize: '0.75rem',
                  color: 'text.primary',
                  cursor: 'pointer',
                },
              }}
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
            <Button type="submit" variant="primary" loading={uploadClip.isPending}>
              Upload
            </Button>
          </Stack>
        </Box>
      </Modal>
    </Card>
  );
}
