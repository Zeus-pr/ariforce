-- GENERATED from packages/db/drizzle/0076_employee_profile.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0076_employee_profile') THEN
    RAISE NOTICE 'skip 0076_employee_profile (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- HR profile on the employee. Each field is optional so existing rows and the current API keep working.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS series text,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS salutation text,
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS middle_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS hr_user_id text,
  ADD COLUMN IF NOT EXISTS create_user boolean,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS branch text,
  ADD COLUMN IF NOT EXISTS grade text,
  ADD COLUMN IF NOT EXISTS employee_group text,
  ADD COLUMN IF NOT EXISTS employment_type text,
  ADD COLUMN IF NOT EXISTS hr_status text,
  ADD COLUMN IF NOT EXISTS personal_email text,
  ADD COLUMN IF NOT EXISTS current_address text,
  ADD COLUMN IF NOT EXISTS permanent_address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS pincode text,
  ADD COLUMN IF NOT EXISTS emergency_name text,
  ADD COLUMN IF NOT EXISTS emergency_phone text,
  ADD COLUMN IF NOT EXISTS attendance_device_id text,
  ADD COLUMN IF NOT EXISTS holiday_list text,
  ADD COLUMN IF NOT EXISTS default_shift text,
  ADD COLUMN IF NOT EXISTS leave_approver text,
  ADD COLUMN IF NOT EXISTS ctc integer,
  ADD COLUMN IF NOT EXISTS salary_mode text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_account text,
  ADD COLUMN IF NOT EXISTS ifsc text,
  ADD COLUMN IF NOT EXISTS pan text,
  ADD COLUMN IF NOT EXISTS pf_account text,
  ADD COLUMN IF NOT EXISTS esi_number text,
  ADD COLUMN IF NOT EXISTS marital_status text,
  ADD COLUMN IF NOT EXISTS blood_group text,
  ADD COLUMN IF NOT EXISTS passport text,
  ADD COLUMN IF NOT EXISTS family text,
  ADD COLUMN IF NOT EXISTS confirmation_date date,
  ADD COLUMN IF NOT EXISTS contract_end date,
  ADD COLUMN IF NOT EXISTS notice_days integer,
  ADD COLUMN IF NOT EXISTS retirement_date date,
  ADD COLUMN IF NOT EXISTS resignation_date date,
  ADD COLUMN IF NOT EXISTS relieving_date date,
  ADD COLUMN IF NOT EXISTS leave_encashed text,
  ADD COLUMN IF NOT EXISTS reason_for_leaving text,
  ADD COLUMN IF NOT EXISTS feedback text;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0076_employee_profile');
END
$ariforce_migration$;
COMMIT;
