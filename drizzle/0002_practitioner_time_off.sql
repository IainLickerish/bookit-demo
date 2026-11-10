CREATE TABLE "practitioner_time_off" (
	"id" uuid PRIMARY KEY NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "practitioner_time_off_ends_after_start" CHECK ("ends_at" > "starts_at"),
	CONSTRAINT "practitioner_time_off_reason_length" CHECK ("reason" is null or char_length("reason") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "practitioner_time_off" ADD CONSTRAINT "practitioner_time_off_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_time_off" ADD CONSTRAINT "practitioner_time_off_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "practitioner_time_off_practitioner_idx" ON "practitioner_time_off" USING btree ("practitioner_id","starts_at");--> statement-breakpoint
CREATE INDEX "practitioner_time_off_ends_at_idx" ON "practitioner_time_off" USING btree ("ends_at");