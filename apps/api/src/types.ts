import type { UserRole } from '@openrelay/core';
import type { Database } from '@openrelay/db';
import type { FastifyReply as Reply, FastifyRequest as Request } from 'fastify';
import type { Config } from './config.js';
import type { TokenCipher } from './crypto.js';
import type { EngineClient } from './engine-client.js';
import type { MediaStorage } from './s3.js';
import type { ClipDownloader } from './twitch-download.js';
import type { TwitchClient } from './twitch-client.js';

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
    /** Typed Twitch OAuth/Helix client, or `null` when not configured. */
    twitch: TwitchClient | null;
    /** Cipher for encrypting/decrypting stored Twitch OAuth tokens. */
    twitchCipher: TokenCipher;
    /** Server-side Twitch clip MP4 downloader. */
    clipDownloader: ClipDownloader;
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
