CREATE TYPE "public"."clip_source" AS ENUM('upload', 'twitch');--> statement-breakpoint
CREATE TABLE "twitch_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"twitch_user_id" text NOT NULL,
	"twitch_login" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scope" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "twitch_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "source" "clip_source" DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "twitch_connections" ADD CONSTRAINT "twitch_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;