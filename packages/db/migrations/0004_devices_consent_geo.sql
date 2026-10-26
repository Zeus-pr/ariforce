-- GENERATED from packages/db/drizzle/0004_devices_consent_geo.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0004_devices_consent_geo') THEN
    RAISE NOTICE 'skip 0004_devices_consent_geo (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."consent_purpose" AS ENUM('personal_device_enrolment', 'location_checkin');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."device_ownership" AS ENUM('company', 'personal');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."device_platform" AS ENUM('android', 'ios');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."device_status" AS ENUM('pending_consent', 'active', 'revoked');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."geo_capture_kind" AS ENUM('punch_in', 'visit', 'punch_out', 'geo_tag');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."geo_source" AS ENUM('gps', 'network', 'fused', 'manual');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"purpose" "consent_purpose" NOT NULL,
	"notice_version" text NOT NULL,
	"granted" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet",
	"user_agent" text
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"ownership" "device_ownership" NOT NULL,
	"platform" "device_platform" NOT NULL,
	"install_id" text NOT NULL,
	"model" text,
	"os_version" text,
	"app_version" text,
	"asset_tag" text,
	"status" "device_status" DEFAULT 'pending_consent' NOT NULL,
	"enrolled_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "geo_captures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"kind" "geo_capture_kind" NOT NULL,
	"location" geometry(point) NOT NULL,
	"accuracy_m" real,
	"source" "geo_source" NOT NULL,
	"is_mock" boolean DEFAULT false NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"distance_m" bigint,
	"captured_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "devices" ADD CONSTRAINT "devices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "geo_captures" ADD CONSTRAINT "geo_captures_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "geo_captures" ADD CONSTRAINT "geo_captures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "geo_captures" ADD CONSTRAINT "geo_captures_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "consent_user_purpose_idx" ON "consent_records" USING btree ("company_id","user_id","purpose","at");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "devices_company_install_uq" ON "devices" USING btree ("company_id","install_id");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "devices_user_idx" ON "devices" USING btree ("company_id","user_id");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "geo_captures_user_at_idx" ON "geo_captures" USING btree ("company_id","user_id","captured_at");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "geo_captures_entity_idx" ON "geo_captures" USING btree ("company_id","entity_type","entity_id");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- Security for devices / consent / geo captures (same pattern as 0002).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['devices','consent_records','geo_captures'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
  END LOOP;
END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT, UPDATE ON devices TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER devices_row_meta BEFORE UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION set_row_meta();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- consent_records and geo_captures are append-only evidence (DPDP): insert + read only.
GRANT SELECT, INSERT ON consent_records, geo_captures TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$REVOKE UPDATE, DELETE, TRUNCATE ON consent_records, geo_captures FROM ariforce_app, PUBLIC;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER consent_records_no_update BEFORE UPDATE OR DELETE ON consent_records FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER geo_captures_no_update BEFORE UPDATE OR DELETE ON geo_captures FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON devices, consent_records, geo_captures FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON devices, consent_records, geo_captures FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0004_devices_consent_geo');
END
$ariforce_migration$;
COMMIT;
