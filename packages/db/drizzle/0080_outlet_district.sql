ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "district" text;
--> statement-breakpoint
ALTER TABLE "chemists" ADD COLUMN IF NOT EXISTS "district" text;
--> statement-breakpoint
ALTER TABLE "stockists" ADD COLUMN IF NOT EXISTS "district" text;
