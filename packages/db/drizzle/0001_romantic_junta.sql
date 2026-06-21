CREATE TABLE "clips" (
	"id" text PRIMARY KEY NOT NULL,
	"stream_id" text NOT NULL,
	"label" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingests" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "ingests" ADD COLUMN "bitrate_kbps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "clip_id" text;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_stream_id_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingests" ADD CONSTRAINT "ingests_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_ingest_id_ingests_id_fk" FOREIGN KEY ("ingest_id") REFERENCES "public"."ingests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_clip_id_clips_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clips"("id") ON DELETE set null ON UPDATE no action;