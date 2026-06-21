import type { FriendRole } from '@openrelay/core';
import type { Database, StreamRow } from '@openrelay/db';
import { friendConnections, streams } from '@openrelay/db';
import { and, eq } from 'drizzle-orm';
import { AppError } from './errors.js';
import type { AuthUser } from './types.js';

/**
 * Effective permission level a user holds on a stream. Owners get full control;
 * friends get exactly their granted {@link FriendRole}.
 */
export type AccessLevel = FriendRole | 'owner';

const CONTROL_LEVELS: ReadonlySet<AccessLevel> = new Set<AccessLevel>([
  'owner',
  'manager',
  'operator',
]);

const MANAGE_LEVELS: ReadonlySet<AccessLevel> = new Set<AccessLevel>(['owner', 'manager']);

export interface StreamAccess {
  stream: StreamRow;
  level: AccessLevel;
}

/**
 * Load a stream and resolve the caller's access level, or throw. A user may
 * access a stream they own or are a friend of; anything else is a 404 (we do not
 * disclose existence of streams the caller cannot see).
 */
export async function loadStreamForUser(
  db: Database,
  streamId: string,
  user: AuthUser,
): Promise<StreamAccess> {
  const stream = await db.query.streams.findFirst({ where: eq(streams.id, streamId) });
  if (!stream) {
    throw AppError.notFound('stream not found');
  }
  if (stream.ownerId === user.id) {
    return { stream, level: 'owner' };
  }
  const friend = await db.query.friendConnections.findFirst({
    where: and(eq(friendConnections.streamId, streamId), eq(friendConnections.userId, user.id)),
  });
  if (!friend) {
    throw AppError.notFound('stream not found');
  }
  return { stream, level: friend.role };
}

/** Assert the access level permits control actions (start/stop/scene/mutations). */
export function requireControl(access: StreamAccess): void {
  if (!CONTROL_LEVELS.has(access.level)) {
    throw AppError.forbidden('viewer access is read-only');
  }
}

/** Assert the caller owns the stream (required for destructive/admin actions). */
export function requireOwner(access: StreamAccess): void {
  if (access.level !== 'owner') {
    throw AppError.forbidden('only the stream owner can perform this action');
  }
}

/**
 * Assert the access level permits management actions (owner or `manager`).
 * Required for provisioning/removing collaborator-owned shared ingests.
 */
export function requireManage(access: StreamAccess): void {
  if (!MANAGE_LEVELS.has(access.level)) {
    throw AppError.forbidden('only the stream owner or a manager can perform this action');
  }
}
