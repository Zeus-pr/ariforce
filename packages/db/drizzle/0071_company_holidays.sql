-- Company holiday labels. A date stays a working day: punch-in, DCR and tour plans are unchanged.
CREATE TABLE IF NOT EXISTS company_holidays (
  "id" uuid PRIMARY KEY NOT NULL,
  "company_id" uuid NOT NULL REFERENCES companies(id),
  "date" date NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT company_holidays_name_ck CHECK (char_length(btrim(name)) BETWEEN 1 AND 80)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS company_holidays_date_uq ON company_holidays (company_id, date) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS company_holidays_year_idx ON company_holidays (company_id, date);--> statement-breakpoint
ALTER TABLE company_holidays ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE company_holidays FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON company_holidays;--> statement-breakpoint
CREATE POLICY tenant_isolation ON company_holidays TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());--> statement-breakpoint
DROP TRIGGER IF EXISTS company_holidays_row_meta ON company_holidays;--> statement-breakpoint
CREATE TRIGGER company_holidays_row_meta BEFORE UPDATE ON company_holidays FOR EACH ROW EXECUTE FUNCTION set_row_meta();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON company_holidays TO ariforce_app;
