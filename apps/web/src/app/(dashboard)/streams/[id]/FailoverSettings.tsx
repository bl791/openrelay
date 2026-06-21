'use client';

import Box from '@mui/material/Box';
import {
  FailoverMode,
  type SceneId,
  type StreamId,
  type StreamWithChildren,
} from '@openrelay/core';
import { useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { ApiRequestError } from '@/lib/api';
import { useUpdateStream } from '@/lib/queries';

const MODES = FailoverMode.options;

const MODE_HINT: Record<FailoverMode, string> = {
  brb: 'Cut to a configured BRB scene while the source reconnects.',
  clips: 'Play a clips reel until the source is back.',
  freeze: 'Hold the last good frame.',
};

export function FailoverSettings({
  streamId,
  stream,
  canControl,
}: {
  streamId: StreamId;
  stream: StreamWithChildren;
  canControl: boolean;
}) {
  const { toast } = useToast();
  const updateStream = useUpdateStream(streamId);
  const [mode, setMode] = useState<FailoverMode>(stream.failover.mode);
  const [graceSeconds, setGraceSeconds] = useState<number>(stream.failover.graceSeconds);
  const [fallbackSceneId, setFallbackSceneId] = useState<string>(
    stream.failover.fallbackSceneId ?? '',
  );

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    updateStream.mutate(
      {
        failover: {
          mode,
          graceSeconds,
          fallbackSceneId: fallbackSceneId ? (fallbackSceneId as SceneId) : null,
        },
      },
      {
        onSuccess: () => {
          toast('Failover settings saved', 'success');
        },
        onError: (err) => {
          toast(err instanceof ApiRequestError ? err.message : 'Save failed', 'error');
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader
        title="Failover policy"
        description="What viewers see when the active source drops."
      />
      <CardBody>
        <Box
          component="form"
          onSubmit={onSubmit}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Field label="Mode" htmlFor="failoverMode" hint={MODE_HINT[mode]}>
            <Select
              id="failoverMode"
              value={mode}
              disabled={!canControl}
              onChange={(e) => {
                setMode(e.target.value as FailoverMode);
              }}
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Grace window (seconds)"
            htmlFor="graceSeconds"
            hint="How long a dropped source can recover before failover engages. Viewers stay live throughout."
          >
            <Input
              id="graceSeconds"
              type="number"
              min={0}
              max={120}
              value={graceSeconds}
              disabled={!canControl}
              onChange={(e) => {
                setGraceSeconds(Number(e.target.value));
              }}
            />
          </Field>

          <Field
            label="Fallback scene"
            htmlFor="fallbackScene"
            hint="Defaults to engine behaviour if unset."
          >
            <Select
              id="fallbackScene"
              value={fallbackSceneId}
              disabled={!canControl}
              onChange={(e) => {
                setFallbackSceneId(e.target.value);
              }}
            >
              <option value="">Engine default</option>
              {stream.scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.label}
                </option>
              ))}
            </Select>
          </Field>

          {canControl ? (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit" variant="primary" loading={updateStream.isPending}>
                Save policy
              </Button>
            </Box>
          ) : null}
        </Box>
      </CardBody>
    </Card>
  );
}
