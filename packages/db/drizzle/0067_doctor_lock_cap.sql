-- How many active GPS pins a doctor may have. Default 1. ABM and above set 1–5.
-- A deactivated pin does not count. Chemists and stockists stay at one active pin.
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS max_active_locks integer NOT NULL DEFAULT 1;
DO $lockcap$
BEGIN
  ALTER TABLE doctors ADD CONSTRAINT doctors_lock_cap_ck CHECK (max_active_locks BETWEEN 1 AND 5);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$lockcap$;
