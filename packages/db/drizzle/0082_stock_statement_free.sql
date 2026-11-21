ALTER TABLE "stock_statement_lines" ADD COLUMN IF NOT EXISTS "free_qty" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_statements" ADD COLUMN IF NOT EXISTS "free_qty" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_statements" ADD COLUMN IF NOT EXISTS "free_value" numeric(14, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_statement_lines" DROP CONSTRAINT IF EXISTS "stock_statement_lines_qty_ck";
--> statement-breakpoint
ALTER TABLE "stock_statement_lines" ADD CONSTRAINT "stock_statement_lines_qty_ck" CHECK (("stock_statement_lines"."opening_qty" is null or "stock_statement_lines"."opening_qty" >= 0) and "stock_statement_lines"."purchase_qty" >= 0 and "stock_statement_lines"."free_qty" >= 0 and "stock_statement_lines"."secondary_qty" >= 0 and "stock_statement_lines"."frs_qty" >= 0);
