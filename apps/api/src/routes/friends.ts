import { AddFriendRequest, FriendConnection } from '@openrelay/core';
import { friendConnections, users } from '@openrelay/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { loadStreamForUser, requireOwner } from '../access.js';
import { AppError } from '../errors.js';
import { newFriendConnectionId } from '../ids.js';
import { toFriend } from '../mappers.js';
import { provisionSharedIngest } from '../repository.js';
import { FriendParams, StreamIdParams } from './schemas.js';

/** Friend/teammate access grants. Only the stream owner may manage these. */
export function registerFriendRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  r.post(
    '/streams/:id/friends',
    {
      ...auth,
      schema: {
        params: StreamIdParams,
        body: AddFriendRequest,
        response: { 201: FriendConnection },
      },
    },
    async (request, reply) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      requireOwner(access);
      const friendUser = await app.db.query.users.findFirst({
        where: eq(users.email, request.body.email),
      });
      if (!friendUser) {
        throw AppError.notFound('no user with that email');
      }
      if (friendUser.id === access.stream.ownerId) {
        throw AppError.conflict('the owner already has full access');
      }
      const existing = await app.db.query.friendConnections.findFirst({
        where: and(
          eq(friendConnections.streamId, access.stream.id),
          eq(friendConnections.userId, friendUser.id),
        ),
      });
      if (existing) {
        throw AppError.conflict('that user already has access to this stream');
      }
      const id = newFriendConnectionId();
      const [row] = await app.db
        .insert(friendConnections)
        .values({
          id,
          streamId: access.stream.id,
          userId: friendUser.id,
          role: request.body.role,
        })
        .returning();
      if (!row) {
        throw new AppError('internal_error', 'failed to add friend');
      }
      // Optionally hand the collaborator a dedicated guest ingest to push into.
      if (request.body.provisionIngest) {
        await provisionSharedIngest(app.db, {
          streamId: access.stream.id,
          label: `${friendUser.displayName}'s feed`,
          protocol: 'rtmp',
          ownerUserId: friendUser.id,
        });
      }
      return reply.code(201).send(toFriend(row));
    },
  );

  r.delete(
    '/streams/:id/friends/:userId',
    { ...auth, schema: { params: FriendParams, response: { 204: z.null() } } },
    async (request, reply) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      requireOwner(access);
      await app.db
        .delete(friendConnections)
        .where(
          and(
            eq(friendConnections.streamId, access.stream.id),
            eq(friendConnections.userId, request.params.userId),
          ),
        );
      return reply.code(204).send(null);
    },
  );
}
