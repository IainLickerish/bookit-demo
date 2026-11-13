CREATE TABLE "blocked_cancellation" (
	"booking_id" uuid PRIMARY KEY NOT NULL,
	"block_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocked_period" (
	"id" uuid PRIMARY KEY NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "blocked_period_ends_after_start" CHECK ("ends_at" > "starts_at"),
	CONSTRAINT "blocked_period_reason_length" CHECK (length("reason") <= 300)
);
--> statement-breakpoint
ALTER TABLE "blocked_cancellation" ADD CONSTRAINT "blocked_cancellation_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_cancellation" ADD CONSTRAINT "blocked_cancellation_block_id_blocked_period_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocked_period"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_period" ADD CONSTRAINT "blocked_period_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_period" ADD CONSTRAINT "blocked_period_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocked_period_practitioner_idx" ON "blocked_period" USING btree ("practitioner_id","starts_at");