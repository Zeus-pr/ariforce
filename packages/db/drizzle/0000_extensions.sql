-- Extensions live in schema `extensions` (Supabase convention; PostGIS + pgcrypto are pre-enabled there).
-- Idempotent: a no-op on Supabase, creates them locally/CI.
CREATE SCHEMA IF NOT EXISTS extensions;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
