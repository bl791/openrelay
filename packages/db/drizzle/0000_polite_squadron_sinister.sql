CREATE TYPE "public"."destination_platform" AS ENUM('twitch', 'kick', 'youtube', 'custom_rtmp');--> statement-breakpoint
CREATE TYPE "public"."destination_status" AS ENUM('idle', 'connecting', 'live', 'reconnecting', 'error');--> statement-breakpoint
CREATE TYPE "public"."friend_role" AS ENUM('viewer', 'operator', 'manager');--> statement-breakpoint
CREATE TYPE "public"."ingest_protocol" AS ENUM('rtmp', 'rtmps', 'srt');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('offline', 'connecting', 'live', 'stale');--> statement-breakpoint
CREATE TYPE "public"."scene_kind" AS ENUM('ingest', 'brb', 'clips', 'image', 'color');--> statement-breakpoint
CREATE TYPE "public"."stream_status" AS ENUM('offline', 'starting', 'live', 'failover', 'stopping');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TABLE "destinations" (
	"id" text PRIMARY KEY NOT NULL,
	"stream_id" text NOT NULL,
	"label" text NOT NULL,
	"platform" "destination_platform" NOT NULL,
	"url" text NOT NULL,
	"stream_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" "destination_status" DEFAULT 'idle' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friend_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"stream_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "friend_role" DEFAULT 'operator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingests" (
	"id" text PRIMARY KEY NOT NULL,
	"stream_id" text NOT NULL,
	"label" text NOT NULL,
	"protocol" "ingest_protocol" NOT NULL,
	"stream_key" text NOT NULL,
	"status" "ingest_status" DEFAULT 'offline' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" text PRIMARY KEY NOT NULL,
	"stream_id" text NOT NULL,
	"label" text NOT NULL,
	"kind" "scene_kind" NOT NULL,
	"ingest_id" text,
	"asset_url" text,
	"color" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "streams" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"status" "stream_status" DEFAULT 'offline' NOT NULL,
	"output" jsonb NOT NULL,
	"failover" jsonb NOT NULL,
	"active_scene_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_stream_id_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_connections" ADD CONSTRAINT "friend_connections_stream_id_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_connections" ADD CONSTRAINT "friend_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingests" ADD CONSTRAINT "ingests_stream_id_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_stream_id_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streams" ADD CONSTRAINT "streams_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friend_connections_stream_user_idx" ON "friend_connections" USING btree ("stream_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingests_stream_key_idx" ON "ingests" USING btree ("stream_key");