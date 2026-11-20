CREATE TABLE "practitioner_time_block" (
	"id" uuid PRIMARY KEY NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "practitioner_time_block_ends_after_start" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
ALTER TABLE "practitioner_time_block" ADD CONSTRAINT "practitioner_time_block_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "practitioner_time_block_range_idx" ON "practitioner_time_block" USING btree ("practitioner_id","ends_at","starts_at");