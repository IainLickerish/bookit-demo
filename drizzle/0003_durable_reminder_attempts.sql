CREATE TABLE "booking_reminder_attempt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "booking_reminder_attempt_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
ALTER TABLE "booking_reminder_attempt" ADD CONSTRAINT "booking_reminder_attempt_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "booking_reminder_attempt" ("id", "booking_id", "attempted_at")
SELECT "id", "id", "reminder_claimed_at" FROM "booking" WHERE "reminder_claimed_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "booking" DROP COLUMN "reminder_claimed_at";
