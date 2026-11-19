CREATE TABLE "blocked_period" (
	"id" uuid PRIMARY KEY NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "blocked_period_ends_after_start" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
ALTER TABLE "blocked_period" ADD CONSTRAINT "blocked_period_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocked_period_practitioner_start_idx" ON "blocked_period" USING btree ("practitioner_id","starts_at");