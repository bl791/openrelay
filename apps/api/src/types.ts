import type { UserRole } from '@openrelay/core';
import type { Database } from '@openrelay/db';
import type { FastifyReply as Reply, FastifyRequest as Request } from 'fastify';
import type { Config } from './config.js';
import type { EngineClient } from './engine-client.js';
import type { MediaStorage } from './s3.js';

/** Identity payload encoded into the JWT and attached to authenticated requests. */
export interface AuthUser {
  id: string;
  role: UserRole;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Database;
    engine: EngineClient;
    /** S3/MinIO media storage for the clips & BRB library. */
    s3: MediaStorage;
    /** preHandler that verifies the JWT and populates `request.user`. */
    authenticate: (request: Request, reply: Reply) => Promise<void>;
  }

  interface FastifyRequest {
    /** Set by the {@link FastifyInstance.authenticate} preHandler. */
    user: AuthUser;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}
