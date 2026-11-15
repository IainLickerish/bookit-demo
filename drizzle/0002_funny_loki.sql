CREATE TABLE "practitioner_block" (
	"id" uuid PRIMARY KEY NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "practitioner_block_ends_after_start" CHECK ("ends_at" > "starts_at"),
	CONSTRAINT "practitioner_block_reason_length" CHECK ("reason" is null or length("reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "practitioner_block" ADD CONSTRAINT "practitioner_block_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "practitioner_block_period_idx" ON "practitioner_block" USING btree ("practitioner_id","starts_at","ends_at");