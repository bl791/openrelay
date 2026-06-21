'use client';

import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  AddFriendRequest,
  FriendRole,
  type StreamId,
  type StreamWithChildren,
} from '@openrelay/core';
import { useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ApiRequestError } from '@/lib/api';
import { useAddFriend, useRemoveFriend } from '@/lib/queries';

const ROLES = FriendRole.options;

const ROLE_HINT: Record<FriendRole, string> = {
  viewer: 'Read-only access to status.',
  operator: 'Can run scenes, ingests and start/stop.',
  manager: 'Full control short of ownership.',
};

export function FriendsManager({
  streamId,
  stream,
  isOwner,
}: {
  streamId: StreamId;
  stream: StreamWithChildren;
  isOwner: boolean;
}) {
  const { toast } = useToast();
  const addFriend = useAddFriend(streamId);
  const removeFriend = useRemoveFriend(streamId);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<FriendRole>('operator');
  const [provisionIngest, setProvisionIngest] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Index each collaborator's guest ingest (if one has been provisioned) by owner.
  const guestIngestByOwner = new Map(
    stream.ingests
      .filter((ingest) => ingest.ownerUserId !== null)
      .map((ingest) => [ingest.ownerUserId, ingest] as const),
  );

  const onAdd = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    const parsed = AddFriendRequest.safeParse({ email, role, provisionIngest });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    addFriend.mutate(parsed.data, {
      onSuccess: () => {
        setOpen(false);
        setEmail('');
        setProvisionIngest(false);
        toast('Teammate added', 'success');
      },
      onError: (err) => {
        setError(err instanceof ApiRequestError ? err.message : 'Failed to add teammate');
      },
    });
  };

  return (
    <Card>
      <CardHeader
        title="Team"
        description="Friends who can remotely manage this stream."
        action={
          isOwner ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setError(null);
                setOpen(true);
              }}
            >
              Invite
            </Button>
          ) : null
        }
      />
      <CardBody>
        <Stack spacing={1}>
          {stream.friends.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No teammates yet.
            </Typography>
          ) : (
            stream.friends.map((friend) => (
              <Box
                key={friend.id}
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
                <Box>
                  <Typography
                    sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.primary' }}
                  >
                    {friend.userId}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: '0.625rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'text.secondary',
                    }}
                  >
                    {friend.role}
                  </Typography>
                  {guestIngestByOwner.has(friend.userId) ? (
                    <Typography sx={{ mt: 0.25, fontSize: '0.625rem', color: 'warning.main' }}>
                      Guest ingest: {guestIngestByOwner.get(friend.userId)?.label}
                    </Typography>
                  ) : null}
                </Box>
                {isOwner ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      removeFriend.mutate(friend.userId, {
                        onSuccess: () => {
                          toast('Teammate removed', 'success');
                        },
                        onError: (err) => {
                          toast(
                            err instanceof ApiRequestError ? err.message : 'Remove failed',
                            'error',
                          );
                        },
                      });
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </Box>
            ))
          )}
        </Stack>
      </CardBody>

      <Modal
        open={open}
        title="Invite teammate"
        description="The user must already have an OpenRelay account."
        onClose={() => {
          setOpen(false);
        }}
      >
        <Box
          component="form"
          onSubmit={onAdd}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Field label="Email" htmlFor="friendEmail" error={error ?? undefined}>
            <Input
              id="friendEmail"
              type="email"
              value={email}
              autoFocus
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              placeholder="teammate@example.com"
            />
          </Field>
          <Field label="Role" htmlFor="friendRole" hint={ROLE_HINT[role]}>
            <Select
              id="friendRole"
              value={role}
              onChange={(e) => {
                setRole(e.target.value as FriendRole);
              }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={provisionIngest}
                onChange={(e) => {
                  setProvisionIngest(e.target.checked);
                }}
              />
            }
            label="Provision a dedicated guest ingest for them"
            slotProps={{ typography: { sx: { fontSize: '0.75rem', color: 'text.secondary' } } }}
          />
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
            <Button type="submit" variant="primary" loading={addFriend.isPending}>
              Invite
            </Button>
          </Stack>
        </Box>
      </Modal>
    </Card>
  );
}
