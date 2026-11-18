-- HR sits outside the sales hierarchy. Postgres cannot use a new enum value in the transaction
-- that adds it, so the role rows are in 0078. Safe to re-run.
ALTER TYPE "public"."role_key" ADD VALUE IF NOT EXISTS 'hr';
