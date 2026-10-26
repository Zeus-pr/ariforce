-- Security: app role, grants, RLS (tenant isolation), row-meta triggers, append-only audit log.
-- Hand-written; drizzle-kit does not generate these. Review changes carefully.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ariforce_app') THEN
    CREATE ROLE ariforce_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO ariforce_app;
--> statement-breakpoint

-- Current tenant from the per-transaction setting (see withTenant()). NULL when unset -> no rows.
CREATE OR REPLACE FUNCTION app_company_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.current_company_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.current_user_id', true), '')::uuid $$;
--> statement-breakpoint

-- updated_at + version bump on every UPDATE (optimistic concurrency + delta sync).
CREATE OR REPLACE FUNCTION set_row_meta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  NEW.company_id := OLD.company_id; -- tenant is immutable
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_row_meta_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  -- Tenant tables: company_id NOT NULL + RLS forced + isolation policy.
  FOREACH t IN ARRAY ARRAY['roles','users','user_roles','territories','user_territories','specialties',
    'doctor_categories','work_types','doctors','chemists','stockists','approval_requests','approval_steps',
    'plan_sessions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO ariforce_app', t);
  END LOOP;
  -- Row-meta trigger on tables with version/updated_at.
  FOREACH t IN ARRAY ARRAY['companies','roles','users','territories','specialties','doctor_categories',
    'work_types','doctors','chemists','stockists','approval_requests','approval_steps','plan_sessions'] LOOP
    IF t = 'companies' THEN
      EXECUTE 'CREATE TRIGGER companies_row_meta BEFORE UPDATE ON companies FOR EACH ROW
               EXECUTE FUNCTION set_row_meta_company()';
    ELSE
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_row_meta()', t || '_row_meta', t);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

-- companies: the tenant row itself. App may read/update only its own company; provisioning is owner-only.
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_self ON companies USING (id = app_company_id()) WITH CHECK (id = app_company_id());
--> statement-breakpoint
GRANT SELECT, UPDATE ON companies TO ariforce_app;
--> statement-breakpoint

-- audit_log: append-only. No UPDATE/DELETE/TRUNCATE for anyone (trigger) and not granted to the app.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_read ON audit_log FOR SELECT USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY audit_append ON audit_log FOR INSERT WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log TO ariforce_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM ariforce_app, PUBLIC;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_mutation();
