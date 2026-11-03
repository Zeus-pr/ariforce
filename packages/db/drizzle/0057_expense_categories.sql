-- Expense categories widened for the monthly statement: courier, mobile, team_meeting,
-- additional_ta_da. Additive and re-runnable (the check is dropped and re-added).
ALTER TABLE "expense_lines" DROP CONSTRAINT IF EXISTS "expense_lines_category_ck";
--> statement-breakpoint
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_category_ck" CHECK ("category" IN ('travel', 'hotel', 'food', 'mileage', 'allowance', 'courier', 'mobile', 'team_meeting', 'additional_ta_da', 'other'));
