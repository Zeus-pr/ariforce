-- Leave management (#51): per-company settings and leave-type policies (data, not code), leave
-- requests through the approval engine, and balance grants (opening, carry-forward, comp-off,
-- adjustment). Idempotent (IF NOT EXISTS / DROP ... IF EXISTS / ON CONFLICT DO NOTHING); the
-- generated wrapper runs it in one transaction and records it in ariforce_migrations.
-- RLS by company_id; grants only to ariforce_app; soft delete via deleted_at; row-meta trigger.
CREATE TABLE IF NOT EXISTS leave_settings (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL REFERENCES companies(id),
	"approval_levels" integer DEFAULT 2 NOT NULL,
	"backdate_days" integer DEFAULT 7 NOT NULL,
	"weekly_off_days" integer[] DEFAULT '{0}'::int[] NOT NULL,
	"max_future_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT leave_settings_levels_ck CHECK (approval_levels BETWEEN 1 AND 5),
	CONSTRAINT leave_settings_backdate_ck CHECK (backdate_days BETWEEN 0 AND 366),
	CONSTRAINT leave_settings_future_ck CHECK (max_future_days IS NULL OR max_future_days BETWEEN 0 AND 731),
	CONSTRAINT leave_settings_off_ck CHECK (weekly_off_days <@ ARRAY[0,1,2,3,4,5,6])
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS leave_settings_company_uq ON leave_settings USING btree (company_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS leave_policies (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL REFERENCES companies(id),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"paid" boolean DEFAULT true NOT NULL,
	"annual_quota" numeric(5, 1),
	"carry_forward" boolean DEFAULT false NOT NULL,
	"carry_forward_cap" numeric(5, 1),
	"half_day_allowed" boolean DEFAULT true NOT NULL,
	"grant_only" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT leave_policies_code_ck CHECK (code ~ '^[A-Z][A-Z0-9_]{0,15}$'),
	CONSTRAINT leave_policies_quota_ck CHECK (annual_quota IS NULL OR annual_quota >= 0),
	CONSTRAINT leave_policies_cap_ck CHECK (carry_forward_cap IS NULL OR carry_forward_cap >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS leave_policies_code_uq ON leave_policies USING btree (company_id, code);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS leave_requests (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL REFERENCES companies(id),
	"user_id" uuid NOT NULL REFERENCES users(id),
	"policy_id" uuid NOT NULL REFERENCES leave_policies(id),
	"year" integer NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"half" text,
	"days" numeric(5, 1) NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approval_request_id" uuid,
	"decided_at" timestamp with time zone,
	"decided_by" uuid REFERENCES users(id),
	"decision_comment" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid REFERENCES users(id),
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT leave_requests_range_ck CHECK (to_date >= from_date),
	CONSTRAINT leave_requests_year_ck CHECK (extract(year from from_date) = year AND extract(year from to_date) = year),
	CONSTRAINT leave_requests_half_ck CHECK (half IS NULL OR (half IN ('am', 'pm') AND from_date = to_date AND days = 0.5)),
	CONSTRAINT leave_requests_days_ck CHECK (days > 0),
	CONSTRAINT leave_requests_status_ck CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS leave_requests_user_idx ON leave_requests USING btree (company_id, user_id, from_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS leave_requests_status_idx ON leave_requests USING btree (company_id, status, from_date);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS leave_grants (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL REFERENCES companies(id),
	"user_id" uuid NOT NULL REFERENCES users(id),
	"policy_id" uuid NOT NULL REFERENCES leave_policies(id),
	"year" integer NOT NULL,
	"kind" text NOT NULL,
	"days" numeric(5, 1) NOT NULL,
	"worked_date" date,
	"reason" text,
	"granted_by" uuid REFERENCES users(id),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT leave_grants_kind_ck CHECK (kind IN ('opening', 'carry_forward', 'grant', 'adjustment')),
	CONSTRAINT leave_grants_days_ck CHECK (days <> 0 AND (kind = 'adjustment' OR days > 0))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS leave_grants_user_idx ON leave_grants USING btree (company_id, user_id, year);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS leave_grants_carry_uq ON leave_grants USING btree (company_id, user_id, policy_id, year) WHERE kind = 'carry_forward' AND deleted_at IS NULL;
--> statement-breakpoint
-- Defaults for existing companies (assumptions in docs/LEAVE.md; the API also creates them lazily).
INSERT INTO leave_settings (id, company_id) SELECT gen_random_uuid(), c.id FROM companies c
ON CONFLICT (company_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO leave_policies (id, company_id, code, name, paid, annual_quota, carry_forward, carry_forward_cap, half_day_allowed, grant_only, sort_order)
SELECT gen_random_uuid(), c.id, d.code, d.name, d.paid, d.quota, d.cf, d.cap, true, d.grant_only, d.sort
FROM companies c CROSS JOIN (VALUES
  ('CL', 'Casual leave', true, 12::numeric, false, NULL::numeric, false, 1),
  ('SL', 'Sick leave', true, 12::numeric, false, NULL::numeric, false, 2),
  ('EL', 'Earned leave', true, 15::numeric, true, 30::numeric, false, 3),
  ('LOP', 'Loss of pay (unpaid)', false, NULL::numeric, false, NULL::numeric, false, 4),
  ('COMP', 'Compensatory off', true, 0::numeric, false, NULL::numeric, true, 5)
) AS d(code, name, paid, quota, cf, cap, grant_only, sort)
ON CONFLICT (company_id, code) DO NOTHING;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leave_settings', 'leave_policies', 'leave_requests', 'leave_grants'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_row_meta', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_row_meta()', t || '_row_meta', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO ariforce_app', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
