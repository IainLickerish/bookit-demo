ALTER TABLE "booking" ADD COLUMN "reminder_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "reminders_enabled" boolean DEFAULT true NOT NULL;