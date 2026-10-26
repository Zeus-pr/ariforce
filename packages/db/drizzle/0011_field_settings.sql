ALTER TABLE "companies" ADD COLUMN "geofence_max_accuracy_m" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "geofence_block_out_of_fence" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "geofence_block_mock" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "geo_captures" ADD COLUMN "territory_id" uuid;--> statement-breakpoint
ALTER TABLE "geo_captures" ADD COLUMN "selfie_file_key" text;--> statement-breakpoint
CREATE INDEX "geo_captures_territory_idx" ON "geo_captures" USING btree ("company_id","territory_id","captured_at");