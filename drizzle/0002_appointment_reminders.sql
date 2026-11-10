ALTER TABLE "booking" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "appointment_reminders" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "booking_reminder_pending_idx" ON "booking" USING btree ("slot_id") WHERE "status" = 'confirmed' and "reminder_sent_at" is null;