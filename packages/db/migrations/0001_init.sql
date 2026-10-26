-- GENERATED from packages/db/drizzle/0001_init.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0001_init') THEN
    RAISE NOTICE 'skip 0001_init (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."role_key" AS ENUM('rep', 'area_manager', 'regional_manager', 'zonal_manager', 'national_head', 'admin');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."territory_level" AS ENUM('national', 'zone', 'region', 'area', 'headquarter');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'suspended');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."approval_state" AS ENUM('draft', 'pending', 'approved', 'rejected', 'returned', 'cancelled');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."verification_state" AS ENUM('unverified', 'pending', 'verified', 'failed');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."work_type_kind" AS ENUM('field', 'non_field', 'leave', 'holiday');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"cycle_kind" text DEFAULT 'month' NOT NULL,
	"cycle_length_days" integer,
	"cycle_anchor_date" text,
	"default_geofence_m" integer DEFAULT 100 NOT NULL,
	"dcr_lock_after_hours" integer DEFAULT 24 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"key" "role_key" NOT NULL,
	"name" text NOT NULL,
	"rank" integer NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "territories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"parent_id" uuid,
	"level" "territory_level" NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"centroid" geometry(point),
	"boundary" geometry(MultiPolygon, 4326),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "user_roles" (
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "user_territories" (
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_territories_user_id_territory_id_pk" PRIMARY KEY("user_id","territory_id")
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"auth_user_id" text,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"employee_code" text,
	"manager_id" uuid,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "users_auth_user_id_unique" UNIQUE("auth_user_id")
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "chemists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"name" text NOT NULL,
	"gstin" text,
	"drug_license_no" text,
	"address_line" text,
	"city" text,
	"state" text,
	"pincode" text,
	"phone" text,
	"location" geometry(point),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "doctor_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"visits_per_cycle" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "doctor_categories_visits_ck" CHECK ("doctor_categories"."visits_per_cycle" between 0 and 31)
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "doctors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"name" text NOT NULL,
	"qualification" text,
	"specialty_id" uuid,
	"category_id" uuid,
	"visits_per_cycle_override" integer,
	"registration_no" text,
	"registration_council" text,
	"verification_status" "verification_state" DEFAULT 'unverified' NOT NULL,
	"approval_status" "approval_state" DEFAULT 'approved' NOT NULL,
	"geofence_radius_m" integer,
	"geo_tagged_at" timestamp with time zone,
	"geo_tagged_by" uuid,
	"date_of_birth" text,
	"anniversary" text,
	"address_line" text,
	"city" text,
	"state" text,
	"pincode" text,
	"phone" text,
	"location" geometry(point),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "doctors_geofence_ck" CHECK ("doctors"."geofence_radius_m" is null or "doctors"."geofence_radius_m" between 10 and 2000)
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "specialties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "stockists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"name" text NOT NULL,
	"gstin" text,
	"drug_license_no" text,
	"address_line" text,
	"city" text,
	"state" text,
	"pincode" text,
	"phone" text,
	"location" geometry(point),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "work_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "work_type_kind" NOT NULL,
	"counts_as_field_day" boolean DEFAULT false NOT NULL,
	"allowance_band" text DEFAULT 'none' NOT NULL,
	"requires_location" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"state" "approval_state" DEFAULT 'pending' NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"reason" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "approval_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"step_no" integer NOT NULL,
	"approver_role" "role_key",
	"approver_user_id" uuid,
	"decision" "approval_state" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"company_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"user_agent" text,
	"request_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "plan_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" text NOT NULL,
	"session_no" integer DEFAULT 1 NOT NULL,
	"work_type_id" uuid NOT NULL,
	"territory_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "territories" ADD CONSTRAINT "territories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "user_territories" ADD CONSTRAINT "user_territories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "user_territories" ADD CONSTRAINT "user_territories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "user_territories" ADD CONSTRAINT "user_territories_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "chemists" ADD CONSTRAINT "chemists_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "chemists" ADD CONSTRAINT "chemists_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "doctor_categories" ADD CONSTRAINT "doctor_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "doctors" ADD CONSTRAINT "doctors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "doctors" ADD CONSTRAINT "doctors_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "doctors" ADD CONSTRAINT "doctors_specialty_id_specialties_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."specialties"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "doctors" ADD CONSTRAINT "doctors_category_id_doctor_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."doctor_categories"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "doctors" ADD CONSTRAINT "doctors_geo_tagged_by_users_id_fk" FOREIGN KEY ("geo_tagged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "specialties" ADD CONSTRAINT "specialties_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "stockists" ADD CONSTRAINT "stockists_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "stockists" ADD CONSTRAINT "stockists_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "work_types" ADD CONSTRAINT "work_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "plan_sessions" ADD CONSTRAINT "plan_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "plan_sessions" ADD CONSTRAINT "plan_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "plan_sessions" ADD CONSTRAINT "plan_sessions_work_type_id_work_types_id_fk" FOREIGN KEY ("work_type_id") REFERENCES "public"."work_types"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "roles_company_key_uq" ON "roles" USING btree ("company_id","key");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "territories_company_code_uq" ON "territories" USING btree ("company_id","code");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "territories_path_idx" ON "territories" USING btree ("company_id","path" text_pattern_ops);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "territories_boundary_gix" ON "territories" USING gist ("boundary");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "users_company_email_uq" ON "users" USING btree ("company_id",lower("email"));$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "users_company_code_uq" ON "users" USING btree ("company_id","employee_code");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "users_manager_idx" ON "users" USING btree ("company_id","manager_id");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "chemists_territory_idx" ON "chemists" USING btree ("company_id","territory_id");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "chemists_updated_idx" ON "chemists" USING btree ("company_id","updated_at");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "doctor_categories_company_code_uq" ON "doctor_categories" USING btree ("company_id","code");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "doctors_territory_idx" ON "doctors" USING btree ("company_id","territory_id");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "doctors_updated_idx" ON "doctors" USING btree ("company_id","updated_at");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "doctors_location_gix" ON "doctors" USING gist ("location");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "specialties_company_code_uq" ON "specialties" USING btree ("company_id","code");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "stockists_territory_idx" ON "stockists" USING btree ("company_id","territory_id");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "stockists_updated_idx" ON "stockists" USING btree ("company_id","updated_at");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "work_types_company_code_uq" ON "work_types" USING btree ("company_id","code");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "approval_requests_entity_idx" ON "approval_requests" USING btree ("company_id","entity_type","entity_id");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "approval_requests_state_idx" ON "approval_requests" USING btree ("company_id","state");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "approval_steps_request_idx" ON "approval_steps" USING btree ("company_id","request_id","step_no");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "audit_log_company_at_idx" ON "audit_log" USING btree ("company_id","at");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("company_id","entity_type","entity_id");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "plan_sessions_user_date_idx" ON "plan_sessions" USING btree ("company_id","user_id","date");$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0001_init');
END
$ariforce_migration$;
COMMIT;
