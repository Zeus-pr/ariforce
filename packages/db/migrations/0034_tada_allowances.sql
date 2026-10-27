-- GENERATED from packages/db/drizzle/0034_tada_allowances.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0034_tada_allowances') THEN
    RAISE NOTICE 'skip 0034_tada_allowances (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$CREATE TABLE IF NOT EXISTS "allowance_places" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"hq_territory_id" uuid NOT NULL,
	"name" text NOT NULL,
	"band" text NOT NULL,
	"one_way_km" numeric(8, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "allowance_places_band_ck" CHECK ("allowance_places"."band" in ('ex_hq','outstation')),
	CONSTRAINT "allowance_places_km_ck" CHECK ("allowance_places"."one_way_km" > 0 and "allowance_places"."one_way_km" <= 2500),
	CONSTRAINT "allowance_places_name_ck" CHECK (length("allowance_places"."name") between 1 and 120)
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE IF NOT EXISTS "allowance_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"band" text NOT NULL,
	"role_id" uuid,
	"effective_from" date NOT NULL,
	"da_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"ta_per_km" numeric(8, 2) DEFAULT '0' NOT NULL,
	"ta_fixed" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "allowance_rates_band_ck" CHECK ("allowance_rates"."band" in ('hq','ex_hq','outstation')),
	CONSTRAINT "allowance_rates_amounts_ck" CHECK ("allowance_rates"."da_amount" >= 0 and "allowance_rates"."ta_per_km" >= 0 and "allowance_rates"."ta_fixed" >= 0)
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "expense_lines" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'manual' NOT NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "expense_lines" ADD COLUMN IF NOT EXISTS "calc" jsonb;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "expense_lines" ADD COLUMN IF NOT EXISTS "allowance_place_id" uuid;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "allowance_places" ADD CONSTRAINT "allowance_places_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "allowance_places" ADD CONSTRAINT "allowance_places_hq_territory_id_territories_id_fk" FOREIGN KEY ("hq_territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "allowance_rates" ADD CONSTRAINT "allowance_rates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "allowance_rates" ADD CONSTRAINT "allowance_rates_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX IF NOT EXISTS "allowance_places_uq" ON "allowance_places" USING btree ("company_id","hq_territory_id",lower("name")) WHERE "allowance_places"."deleted_at" is null;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS "allowance_places_hq_idx" ON "allowance_places" USING btree ("company_id","hq_territory_id");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX IF NOT EXISTS "allowance_rates_uq" ON "allowance_rates" USING btree ("company_id","band",coalesce("role_id", '00000000-0000-0000-0000-000000000000'::uuid),"effective_from") WHERE "allowance_rates"."deleted_at" is null;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_allowance_place_id_allowance_places_id_fk" FOREIGN KEY ("allowance_place_id") REFERENCES "public"."allowance_places"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_source_ck" CHECK ("expense_lines"."source" in ('manual','auto')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- Category list widened with 'allowance' (TA/DA daily allowance lines, #39).
ALTER TABLE expense_lines DROP CONSTRAINT IF EXISTS expense_lines_category_ck;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE expense_lines ADD CONSTRAINT expense_lines_category_ck CHECK (category IN ('travel', 'hotel', 'food', 'mileage', 'allowance', 'other'));$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE allowance_rates ENABLE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE allowance_rates FORCE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP POLICY IF EXISTS tenant_isolation ON allowance_rates;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY tenant_isolation ON allowance_rates TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP TRIGGER IF EXISTS allowance_rates_row_meta ON allowance_rates;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER allowance_rates_row_meta BEFORE UPDATE ON allowance_rates FOR EACH ROW EXECUTE FUNCTION set_row_meta();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT, UPDATE ON allowance_rates TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE allowance_places ENABLE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE allowance_places FORCE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP POLICY IF EXISTS tenant_isolation ON allowance_places;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY tenant_isolation ON allowance_places TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP TRIGGER IF EXISTS allowance_places_row_meta ON allowance_places;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER allowance_places_row_meta BEFORE UPDATE ON allowance_places FOR EACH ROW EXECUTE FUNCTION set_row_meta();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT, UPDATE ON allowance_places TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON allowance_rates, allowance_places FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON allowance_rates, allowance_places FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0034_tada_allowances');
END
$ariforce_migration$;
COMMIT;
