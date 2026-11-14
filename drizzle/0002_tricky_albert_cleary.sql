CREATE TABLE "time_block" (
	"id" uuid PRIMARY KEY NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "time_block_ends_after_start" CHECK ("ends_at" > "starts_at"),
	CONSTRAINT "time_block_reason_length" CHECK (length("reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "time_block" ADD CONSTRAINT "time_block_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_block_practitioner_range_idx" ON "time_block" USING btree ("practitioner_id","starts_at","ends_at");