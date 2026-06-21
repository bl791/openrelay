'use client';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  CreateSceneRequest,
  SceneKind,
  type SceneId,
  type StreamId,
  type StreamWithChildren,
} from '@openrelay/core';
import { useState, type SyntheticEvent } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ApiRequestError } from '@/lib/api';
import { useCreateScene, useDeleteScene, useSwitchScene } from '@/lib/queries';
import { palette } from '@/theme';

const KINDS = SceneKind.options;

export function ScenesManager({
  streamId,
  stream,
  canControl,
  live,
}: {
  streamId: StreamId;
  stream: StreamWithChildren;
  canControl: boolean;
  live: boolean;
}) {
  const { toast } = useToast();
  const switchScene = useSwitchScene(streamId);
  const createScene = useCreateScene(streamId);
  const deleteScene = useDeleteScene(streamId);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<SceneKind>('ingest');
  const [ingestId, setIngestId] = useState<string>('');
  const [assetUrl, setAssetUrl] = useState('');
  const [clipId, setClipId] = useState<string>('');
  const [color, setColor] = useState('#101522');
  const [error, setError] = useState<string | null>(null);

  const usesMedia = kind === 'image' || kind === 'brb' || kind === 'clips';

  const onCreate = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    const parsed = CreateSceneRequest.safeParse({
      label,
      kind,
      ingestId: kind === 'ingest' && ingestId ? ingestId : null,
      // A media scene may reference a library clip (preferred) or a direct URL.
      clipId: usesMedia && clipId ? clipId : null,
      assetUrl: usesMedia && !clipId && assetUrl ? assetUrl : null,
      color: kind === 'color' ? color : null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    createScene.mutate(parsed.data, {
      onSuccess: () => {
        setOpen(false);
        setLabel('');
        setAssetUrl('');
        setClipId('');
        toast('Scene created', 'success');
      },
      onError: (err) => {
        setError(err instanceof ApiRequestError ? err.message : 'Failed to create scene');
      },
    });
  };

  const onSwitch = (sceneId: SceneId): void => {
    switchScene.mutate(sceneId, {
      onSuccess: () => {
        toast('Scene switched', 'success');
      },
      onError: (err) => {
        toast(err instanceof ApiRequestError ? err.message : 'Switch failed', 'error');
      },
    });
  };

  return (
    <Card>
      <CardHeader
        title="Scenes"
        description="What viewers see — switch live or set the failover fallback."
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
              Add scene
            </Button>
          ) : null
        }
      />
      <CardBody>
        <Stack spacing={1}>
          {stream.scenes.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No scenes yet.
            </Typography>
          ) : (
            [...stream.scenes]
              .sort((a, b) => a.position - b.position)
              .map((scene) => {
                const isLive = scene.id === stream.activeSceneId;
                return (
                  <Box
                    key={scene.id}
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
                    <Stack direction="row" spacing={1} alignItems="center">
                      {scene.kind === 'color' && scene.color ? (
                        <Box
                          sx={{
                            width: 16,
                            height: 16,
                            borderRadius: 0.5,
                            border: 1,
                            borderColor: 'divider',
                            backgroundColor: scene.color,
                          }}
                        />
                      ) : null}
                      <Typography sx={{ fontSize: '0.875rem', color: 'text.primary' }}>
                        {scene.label}
                      </Typography>
                      <Box
                        component="span"
                        sx={{
                          borderRadius: 0.5,
                          bgcolor: palette.surface[700],
                          px: 0.75,
                          py: 0.25,
                          fontSize: '0.625rem',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          color: 'text.secondary',
                        }}
                      >
                        {scene.kind}
                      </Box>
                      {isLive ? (
                        <Badge tone="live" dot pulse={live}>
                          On air
                        </Badge>
                      ) : null}
                    </Stack>
                    {canControl ? (
                      <Stack direction="row" spacing={1}>
                        {!isLive && live ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              onSwitch(scene.id);
                            }}
                          >
                            Switch
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            deleteScene.mutate(scene.id, {
                              onSuccess: () => {
                                toast('Scene deleted', 'success');
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
                      </Stack>
                    ) : null}
                  </Box>
                );
              })
          )}
        </Stack>
      </CardBody>

      <Modal
        open={open}
        title="Add scene"
        onClose={() => {
          setOpen(false);
        }}
      >
        <Box
          component="form"
          onSubmit={onCreate}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Field label="Label" htmlFor="sceneLabel" error={error ?? undefined}>
            <Input
              id="sceneLabel"
              value={label}
              autoFocus
              onChange={(e) => {
                setLabel(e.target.value);
              }}
              placeholder="BRB"
            />
          </Field>
          <Field label="Kind" htmlFor="sceneKind">
            <Select
              id="sceneKind"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as SceneKind);
              }}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </Field>

          {kind === 'ingest' ? (
            <Field label="Ingest" htmlFor="sceneIngest">
              <Select
                id="sceneIngest"
                value={ingestId}
                onChange={(e) => {
                  setIngestId(e.target.value);
                }}
              >
                <option value="">Select an ingest…</option>
                {stream.ingests.map((ingest) => (
                  <option key={ingest.id} value={ingest.id}>
                    {ingest.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {usesMedia ? (
            <>
              <Field label="Clip from library" htmlFor="sceneClip">
                <Select
                  id="sceneClip"
                  value={clipId}
                  onChange={(e) => {
                    setClipId(e.target.value);
                  }}
                >
                  <option value="">Use a direct URL…</option>
                  {stream.clips.map((clip) => (
                    <option key={clip.id} value={clip.id}>
                      {clip.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {!clipId ? (
                <Field label="Asset URL" htmlFor="sceneAsset">
                  <Input
                    id="sceneAsset"
                    value={assetUrl}
                    onChange={(e) => {
                      setAssetUrl(e.target.value);
                    }}
                    placeholder="https://cdn.example.com/brb.mp4"
                  />
                </Field>
              ) : null}
            </>
          ) : null}

          {kind === 'color' ? (
            <Field label="Color" htmlFor="sceneColor">
              <Box
                component="input"
                id="sceneColor"
                type="color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                }}
                sx={{
                  height: 40,
                  width: '100%',
                  cursor: 'pointer',
                  borderRadius: 1.5,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'background.default',
                }}
              />
            </Field>
          ) : null}

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
            <Button type="submit" variant="primary" loading={createScene.isPending}>
              Create
            </Button>
          </Stack>
        </Box>
      </Modal>
    </Card>
  );
}
