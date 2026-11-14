-- GENERATED from packages/db/drizzle/0070_drop_inactive_locks.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0070_drop_inactive_locks') THEN
    RAISE NOTICE 'skip 0070_drop_inactive_locks (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- A deactivated pin is deleted. Lock history may drop its coordinates so the pin row can go.
CREATE OR REPLACE FUNCTION geo_lock_events_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.location_id IS NULL
     AND OLD.location_id IS NOT NULL
     AND NEW.before IS NULL
     AND NEW.after IS NULL
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
     AND NEW.outlet_kind IS NOT DISTINCT FROM OLD.outlet_kind
     AND NEW.outlet_id IS NOT DISTINCT FROM OLD.outlet_id
     AND NEW.action IS NOT DISTINCT FROM OLD.action
     AND NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id
     AND NEW.at IS NOT DISTINCT FROM OLD.at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'geo_lock_events is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS geo_lock_events_no_update ON geo_lock_events;
CREATE TRIGGER geo_lock_events_no_update
  BEFORE UPDATE OR DELETE ON geo_lock_events
  FOR EACH ROW EXECUTE FUNCTION geo_lock_events_guard();

GRANT UPDATE (location_id, before, after) ON geo_lock_events TO ariforce_app;
GRANT DELETE ON outlet_locations TO ariforce_app;

UPDATE geo_lock_events e
SET location_id = NULL, before = NULL, after = NULL
FROM outlet_locations l
WHERE e.location_id = l.id AND NOT l.active;

DELETE FROM outlet_locations WHERE NOT active;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0070_drop_inactive_locks');
END
$ariforce_migration$;
COMMIT;
