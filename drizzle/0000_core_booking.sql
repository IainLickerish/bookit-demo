CREATE TYPE "public"."booking_status" AS ENUM('confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('patient', 'admin');--> statement-breakpoint
CREATE TABLE "booking" (
	"id" uuid PRIMARY KEY NOT NULL,
	"patient_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"status" "booking_status" NOT NULL,
	"late_cancellation" boolean NOT NULL,
	"phone" text,
	"reschedule_count" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "booking_cancelled_at_matches_status" CHECK (("status" = 'cancelled') = ("cancelled_at" is not null)),
	CONSTRAINT "booking_late_only_when_cancelled" CHECK (not "late_cancellation" or "status" = 'cancelled'),
	CONSTRAINT "booking_reschedule_count_nonnegative" CHECK ("reschedule_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "clinic_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"clinic_name" text NOT NULL,
	"time_zone" text NOT NULL,
	"late_cancellation_hours" integer NOT NULL,
	"include_contact_in_confirmation" boolean NOT NULL,
	"slot_horizon_days" integer NOT NULL,
	"session_minutes" integer NOT NULL,
	"max_reschedules_per_booking" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "clinic_settings_single_row" CHECK ("id" = 1),
	CONSTRAINT "clinic_settings_ranges" CHECK ("late_cancellation_hours" between 0 and 336 and "slot_horizon_days" between 1 and 366 and "session_minutes" between 5 and 480 and "max_reschedules_per_booking" between 0 and 20)
);
--> statement-breakpoint
CREATE TABLE "practitioner" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bio" text NOT NULL,
	"working_days" smallint[] NOT NULL,
	"workday_start" text NOT NULL,
	"workday_end" text NOT NULL,
	"active" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "practitioner_workday_format" CHECK ("workday_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "workday_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "practitioner_workday_order" CHECK ("workday_end" > "workday_start"),
	CONSTRAINT "practitioner_working_days_valid" CHECK ("working_days" <@ array[1,2,3,4,5,6,7]::smallint[])
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slot" (
	"id" uuid PRIMARY KEY NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "slot_ends_after_start" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_lowercase" CHECK ("email" = lower("email"))
);
--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_patient_id_user_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_slot_id_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot" ADD CONSTRAINT "slot_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_one_confirmed_per_slot" ON "booking" USING btree ("slot_id") WHERE "status" = 'confirmed';--> statement-breakpoint
CREATE INDEX "booking_patient_idx" ON "booking" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "practitioner_active_idx" ON "practitioner" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_hash_key" ON "session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slot_practitioner_start_key" ON "slot" USING btree ("practitioner_id","starts_at");--> statement-breakpoint
CREATE INDEX "slot_starts_at_idx" ON "slot" USING btree ("starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_key" ON "user" USING btree ("email");