CREATE TABLE "password_reset_token" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "password_reset_token_expires_after_created" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_token_hash_key" ON "password_reset_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_token_user_idx" ON "password_reset_token" USING btree ("user_id");