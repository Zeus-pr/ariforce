-- Functional roles outside the sales hierarchy (rank 0). Enum values only: Postgres cannot use a new
-- enum value in the transaction that adds it, so role rows are in 0015. Safe to re-run.
ALTER TYPE "public"."role_key" ADD VALUE IF NOT EXISTS 'distribution_head';--> statement-breakpoint
ALTER TYPE "public"."role_key" ADD VALUE IF NOT EXISTS 'accountant';
