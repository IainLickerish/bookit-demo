CREATE TABLE "booking_reminder" (
	"booking_id" uuid PRIMARY KEY NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_reminder" ADD CONSTRAINT "booking_reminder_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE cascade ON UPDATE no action;