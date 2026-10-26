-- Expense claims (#52): monthly claim per user, lines, R2 receipts. Idempotent (IF NOT EXISTS /
-- DROP ... IF EXISTS); the generated wrapper runs it in one transaction and records it in
-- ariforce_migrations. RLS by company_id; grants only to ariforce_app.
CREATE TABLE IF NOT EXISTS expense_claims (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL REFERENCES companies(id),
	"user_id" uuid NOT NULL REFERENCES users(id),
	"month" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"approval_request_id" uuid,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid REFERENCES users(id),
	"decision_comment" text,
	"paid_at" timestamp with time zone,
	"paid_by" uuid REFERENCES users(id),
	"payment_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT expense_claims_month_first CHECK (extract(day from month) = 1),
	CONSTRAINT expense_claims_status_ck CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'paid')),
	CONSTRAINT expense_claims_total_ck CHECK (total >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS expense_claims_user_month_uq ON expense_claims USING btree (company_id, user_id, month);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS expense_claims_month_idx ON expense_claims USING btree (company_id, month, status);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS expense_lines (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL REFERENCES companies(id),
	"claim_id" uuid NOT NULL REFERENCES expense_claims(id),
	"date" date NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"notes" text,
	"mileage_km" numeric(8, 2),
	"dcr_id" uuid REFERENCES dcrs(id),
	"tour_plan_id" uuid REFERENCES tour_plans(id),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT expense_lines_category_ck CHECK (category IN ('travel', 'hotel', 'food', 'mileage', 'other')),
	CONSTRAINT expense_lines_amount_ck CHECK (amount > 0),
	CONSTRAINT expense_lines_mileage_ck CHECK ((category = 'mileage') = (mileage_km IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS expense_lines_claim_idx ON expense_lines USING btree (claim_id);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS expense_attachments (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL REFERENCES companies(id),
	"line_id" uuid NOT NULL REFERENCES expense_lines(id),
	"file_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"uploaded_by" uuid NOT NULL REFERENCES users(id),
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT expense_attachments_status_ck CHECK (status IN ('pending', 'confirmed')),
	CONSTRAINT expense_attachments_size_ck CHECK (size_bytes > 0 AND size_bytes <= 10485760),
	CONSTRAINT expense_attachments_key_ck CHECK (file_key LIKE company_id::text || '/expense_receipt/%')
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS expense_attachments_key_uq ON expense_attachments USING btree (file_key);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS expense_attachments_line_idx ON expense_attachments USING btree (line_id);--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expense_claims', 'expense_lines', 'expense_attachments'] LOOP
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
