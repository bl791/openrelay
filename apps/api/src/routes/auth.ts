import { AuthResponse, LoginRequest, RegisterRequest, User } from '@openrelay/core';
import { users } from '@openrelay/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../errors.js';
import { newUserId } from '../ids.js';
import { toUser } from '../mappers.js';
import { hashPassword, verifyPassword } from '../password.js';
import { signSession } from '../plugins/auth.js';

/** Authentication routes: register, login and the current-user lookup. */
export function registerAuthRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/auth/register',
    { schema: { body: RegisterRequest, response: { 201: AuthResponse } } },
    async (request, reply) => {
      const { email, password, displayName } = request.body;
      const existing = await app.db.query.users.findFirst({ where: eq(users.email, email) });
      if (existing) {
        throw AppError.conflict('an account with that email already exists');
      }
      const passwordHash = await hashPassword(password);
      const id = newUserId();
      const [row] = await app.db
        .insert(users)
        .values({ id, email, displayName, passwordHash, role: 'user' })
        .returning();
      if (!row) {
        throw new AppError('internal_error', 'failed to create account');
      }
      const user = toUser(row);
      const token = signSession(app, { id: user.id, role: user.role });
      return reply.code(201).send({ token, user });
    },
  );

  r.post(
    '/auth/login',
    { schema: { body: LoginRequest, response: { 200: AuthResponse } } },
    async (request) => {
      const { email, password } = request.body;
      const row = await app.db.query.users.findFirst({ where: eq(users.email, email) });
      if (!row || !(await verifyPassword(row.passwordHash, password))) {
        throw AppError.unauthorized('invalid email or password');
      }
      const user = toUser(row);
      const token = signSession(app, { id: user.id, role: user.role });
      return { token, user };
    },
  );

  r.get(
    '/me',
    { preHandler: app.authenticate, schema: { response: { 200: User } } },
    async (request) => {
      const row = await app.db.query.users.findFirst({ where: eq(users.id, request.user.id) });
      if (!row) {
        throw AppError.notFound('user not found');
      }
      return toUser(row);
    },
  );
}
