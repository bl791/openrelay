import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { FailoverConfig, OutputProfile } from '@openrelay/core';

/** Postgres enum definitions, mirroring the Zod enums in @openrelay/core. */
export const userRole = pgEnum('user_role', ['admin', 'user']);
export const ingestProtocol = pgEnum('ingest_protocol', ['rtmp', 'rtmps', 'srt']);
export const ingestStatus = pgEnum('ingest_status', ['offline', 'connecting', 'live', 'stale']);
export const destinationPlatform = pgEnum('destination_platform', [
  'twitch',
  'kick',
  'youtube',
  'custom_rtmp',
]);
export const destinationStatus = pgEnum('destination_status', [
  'idle',
  'connecting',
  'live',
  'reconnecting',
  'error',
]);
export const streamStatus = pgEnum('stream_status', [
  'offline',
  'starting',
  'live',
  'failover',
  'stopping',
]);
export const sceneKind = pgEnum('scene_kind', ['ingest', 'brb', 'clips', 'image', 'color']);
export const friendRole = pgEnum('friend_role', ['viewer', 'operator', 'manager']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
};

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default('user'),
  ...timestamps,
});

export const streams = pgTable('streams', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: streamStatus('status').notNull().default('offline'),
  output: jsonb('output').$type<OutputProfile>().notNull(),
  failover: jsonb('failover').$type<FailoverConfig>().notNull(),
  activeSceneId: text('active_scene_id'),
  ...timestamps,
});

export const ingests = pgTable(
  'ingests',
  {
    id: text('id').primaryKey(),
    streamId: text('stream_id')
      .notNull()
      .references(() => streams.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    protocol: ingestProtocol('protocol').notNull(),
    streamKey: text('stream_key').notNull(),
    status: ingestStatus('status').notNull().default('offline'),
    isActive: boolean('is_active').notNull().default(false),
    /**
     * Collaborator who owns this ingest, when it is a shared/guest ingest. `null`
     * means the ingest belongs to the stream owner. A guest pushes their own feed
     * into the host's broadcast using this ingest's key.
     */
    ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }),
    bitrateKbps: integer('bitrate_kbps').notNull().default(0),
    createdAt: timestamps.createdAt,
  },
  (table) => [uniqueIndex('ingests_stream_key_idx').on(table.streamKey)],
);

export const destinations = pgTable('destinations', {
  id: text('id').primaryKey(),
  streamId: text('stream_id')
    .notNull()
    .references(() => streams.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  platform: destinationPlatform('platform').notNull(),
  url: text('url').notNull(),
  streamKey: text('stream_key').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  status: destinationStatus('status').notNull().default('idle'),
  createdAt: timestamps.createdAt,
});

export const scenes = pgTable('scenes', {
  id: text('id').primaryKey(),
  streamId: text('stream_id')
    .notNull()
    .references(() => streams.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  kind: sceneKind('kind').notNull(),
  ingestId: text('ingest_id').references(() => ingests.id, { onDelete: 'set null' }),
  /** Direct media URL for image/brb scenes, or a clip for clips scenes. */
  assetUrl: text('asset_url'),
  /** For clips scenes, the clip whose object this scene loops. */
  clipId: text('clip_id').references(() => clips.id, { onDelete: 'set null' }),
  color: text('color'),
  position: integer('position').notNull().default(0),
});

/**
 * A media asset (BRB image/video or a clip reel) uploaded for a stream and stored
 * in S3-compatible object storage. Looped by the engine during failover or shown
 * by clips/image scenes.
 */
export const clips = pgTable('clips', {
  id: text('id').primaryKey(),
  streamId: text('stream_id')
    .notNull()
    .references(() => streams.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  /** Object key within the media bucket. */
  objectKey: text('object_key').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  durationSeconds: integer('duration_seconds'),
  createdAt: timestamps.createdAt,
});

export const friendConnections = pgTable(
  'friend_connections',
  {
    id: text('id').primaryKey(),
    streamId: text('stream_id')
      .notNull()
      .references(() => streams.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: friendRole('role').notNull().default('operator'),
    createdAt: timestamps.createdAt,
  },
  (table) => [uniqueIndex('friend_connections_stream_user_idx').on(table.streamId, table.userId)],
);

export const usersRelations = relations(users, ({ many }) => ({
  streams: many(streams),
  friendConnections: many(friendConnections),
  ownedIngests: many(ingests),
}));

export const streamsRelations = relations(streams, ({ one, many }) => ({
  owner: one(users, { fields: [streams.ownerId], references: [users.id] }),
  ingests: many(ingests),
  destinations: many(destinations),
  scenes: many(scenes),
  friends: many(friendConnections),
  clips: many(clips),
}));

export const ingestsRelations = relations(ingests, ({ one }) => ({
  stream: one(streams, { fields: [ingests.streamId], references: [streams.id] }),
  owner: one(users, { fields: [ingests.ownerUserId], references: [users.id] }),
}));

export const clipsRelations = relations(clips, ({ one }) => ({
  stream: one(streams, { fields: [clips.streamId], references: [streams.id] }),
}));

export const destinationsRelations = relations(destinations, ({ one }) => ({
  stream: one(streams, { fields: [destinations.streamId], references: [streams.id] }),
}));

export const scenesRelations = relations(scenes, ({ one }) => ({
  stream: one(streams, { fields: [scenes.streamId], references: [streams.id] }),
}));

export const friendConnectionsRelations = relations(friendConnections, ({ one }) => ({
  stream: one(streams, { fields: [friendConnections.streamId], references: [streams.id] }),
  user: one(users, { fields: [friendConnections.userId], references: [users.id] }),
}));

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type StreamRow = typeof streams.$inferSelect;
export type NewStreamRow = typeof streams.$inferInsert;
export type IngestRow = typeof ingests.$inferSelect;
export type NewIngestRow = typeof ingests.$inferInsert;
export type DestinationRow = typeof destinations.$inferSelect;
export type NewDestinationRow = typeof destinations.$inferInsert;
export type SceneRow = typeof scenes.$inferSelect;
export type NewSceneRow = typeof scenes.$inferInsert;
export type FriendConnectionRow = typeof friendConnections.$inferSelect;
export type NewFriendConnectionRow = typeof friendConnections.$inferInsert;
export type ClipRow = typeof clips.$inferSelect;
export type NewClipRow = typeof clips.$inferInsert;
