CREATE TABLE "stock_statement_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"opening_qty" integer,
	"opening_source" text DEFAULT 'typed' NOT NULL,
	"purchase_qty" integer DEFAULT 0 NOT NULL,
	"secondary_qty" integer DEFAULT 0 NOT NULL,
	"frs_qty" integer DEFAULT 0 NOT NULL,
	"pts" numeric(12, 2),
	"product_name" text NOT NULL,
	"pack_size" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stock_statement_lines_qty_ck" CHECK (("stock_statement_lines"."opening_qty" is null or "stock_statement_lines"."opening_qty" >= 0) and "stock_statement_lines"."purchase_qty" >= 0 and "stock_statement_lines"."secondary_qty" >= 0 and "stock_statement_lines"."frs_qty" >= 0),
	CONSTRAINT "stock_statement_lines_source_ck" CHECK ("stock_statement_lines"."opening_source" in ('typed', 'carried'))
);
--> statement-breakpoint
CREATE TABLE "stock_statements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"stockist_id" uuid NOT NULL,
	"month" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approval_request_id" uuid,
	"decision_comment" text,
	"opening_qty" integer DEFAULT 0 NOT NULL,
	"opening_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"purchase_qty" integer DEFAULT 0 NOT NULL,
	"purchase_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"secondary_qty" integer DEFAULT 0 NOT NULL,
	"secondary_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"closing_qty" integer DEFAULT 0 NOT NULL,
	"closing_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"frs_qty" integer DEFAULT 0 NOT NULL,
	"frs_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"actual_secondary" numeric(14, 2) DEFAULT '0' NOT NULL,
	"aws_file_key" text,
	"aws_content_type" text,
	"aws_size_bytes" bigint,
	"aws_status" text,
	"ss_file_key" text,
	"ss_content_type" text,
	"ss_size_bytes" bigint,
	"ss_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stock_statements_month_ck" CHECK (extract(day from "stock_statements"."month") = 1),
	CONSTRAINT "stock_statements_status_ck" CHECK ("stock_statements"."status" in ('draft', 'pending', 'approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "stock_statement_lines" ADD CONSTRAINT "stock_statement_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_statement_lines" ADD CONSTRAINT "stock_statement_lines_statement_id_stock_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."stock_statements"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_statement_lines" ADD CONSTRAINT "stock_statement_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_statements" ADD CONSTRAINT "stock_statements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_statements" ADD CONSTRAINT "stock_statements_stockist_id_stockists_id_fk" FOREIGN KEY ("stockist_id") REFERENCES "public"."stockists"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_statements" ADD CONSTRAINT "stock_statements_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_statement_lines_product_uq" ON "stock_statement_lines" USING btree ("statement_id","product_id") WHERE "stock_statement_lines"."deleted_at" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_statements_stockist_month_uq" ON "stock_statements" USING btree ("company_id","stockist_id","month") WHERE "stock_statements"."deleted_at" is null;
--> statement-breakpoint
CREATE INDEX "stock_statements_status_idx" ON "stock_statements" USING btree ("company_id","status","month");
--> statement-breakpoint
ALTER TABLE stock_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_statements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stock_statements;
CREATE POLICY tenant_isolation ON stock_statements TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP TRIGGER IF EXISTS stock_statements_row_meta ON stock_statements;
CREATE TRIGGER stock_statements_row_meta BEFORE UPDATE ON stock_statements FOR EACH ROW EXECUTE FUNCTION set_row_meta();
GRANT SELECT, INSERT, UPDATE ON stock_statements TO ariforce_app;
ALTER TABLE stock_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_statement_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stock_statement_lines;
CREATE POLICY tenant_isolation ON stock_statement_lines TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP TRIGGER IF EXISTS stock_statement_lines_row_meta ON stock_statement_lines;
CREATE TRIGGER stock_statement_lines_row_meta BEFORE UPDATE ON stock_statement_lines FOR EACH ROW EXECUTE FUNCTION set_row_meta();
GRANT SELECT, INSERT, UPDATE ON stock_statement_lines TO ariforce_app;
