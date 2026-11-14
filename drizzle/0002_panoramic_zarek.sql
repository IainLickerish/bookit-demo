CREATE TABLE "booking_reminder" (
	"booking_id" uuid PRIMARY KEY NOT NULL,
	"slot_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"reserved_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "booking_reminder_sent_after_reserved" CHECK ("sent_at" is null or "sent_at" >= "reserved_at")
);
--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "reminders_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_reminder" ADD CONSTRAINT "booking_reminder_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reminder" ADD CONSTRAINT "booking_reminder_slot_id_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slot"("id") ON DELETE no action ON UPDATE no action;