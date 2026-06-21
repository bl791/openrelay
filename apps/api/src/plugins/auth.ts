import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../errors.js';
import type { AuthUser } from '../types.js';

export interface AuthPluginOptions {
  jwtSecret: string;
  jwtExpiresIn: string;
}

/**
 * Register JWT signing/verification and expose the `authenticate` preHandler that
 * verifies the bearer token and populates `request.user`. Password hashing lives
 * in {@link ../password.js}; this plugin only handles session tokens.
 */
async function authPlugin(app: FastifyInstance, options: AuthPluginOptions): Promise<void> {
  await app.register(fastifyJwt, {
    secret: options.jwtSecret,
    sign: { expiresIn: options.jwtExpiresIn },
  });

  app.decorate(
    'authenticate',
    async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
      try {
        await request.jwtVerify();
      } catch {
        throw AppError.unauthorized('invalid or missing session token');
      }
    },
  );
}

/** Sign a session token for an authenticated user. */
export function signSession(app: FastifyInstance, user: AuthUser): string {
  return app.jwt.sign(user);
}

export default fp(authPlugin, { name: 'openrelay-auth' });
