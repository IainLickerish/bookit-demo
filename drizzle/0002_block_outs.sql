CREATE TABLE "block_out" (
	"id" uuid PRIMARY KEY NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "block_out_ends_after_start" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
ALTER TABLE "block_out" ADD CONSTRAINT "block_out_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "block_out_practitioner_end_idx" ON "block_out" USING btree ("practitioner_id","ends_at");