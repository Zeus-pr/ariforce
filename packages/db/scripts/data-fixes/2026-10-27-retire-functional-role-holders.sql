-- ONE-OFF DATA FIX run by lead, not a migration.
-- Purpose: holders of the retired roles (distribution_head, accountant) who never got a login:
--   * revoke their open invites (user_invites.revoked_at = now(), same as the API's revoke), and
--   * set users.status = 'suspended' (the "deactivated" state the API already understands).
-- Keeps: users rows, user_roles rows, roles rows, user_territories, invite rows (only stamped), history.
-- Idempotent: only touches rows not already in the target state. Single transaction.
-- Run:  psql "$URL" -v slug=arighna -v ON_ERROR_STOP=1 -f 2026-10-27-retire-functional-role-holders.sql
-- Company arighna = 83584199-7043-46c0-b5cd-8ea938e8dce5 (reference only; the slug is used).
--
-- RECOMMENDATION: Option A (this script). Safe status value: 'suspended'.
--   'suspended' blocks sign-in (ACCOUNT_SUSPENDED), is excluded from approver routing and SFC/KPI
--   sales lists, still shows in GET /v1/users and People (filter status=suspended), and is reversible
--   via PATCH /v1/employees/{id} {status:'active'} after a role change. Do NOT use 'pending' or
--   'rejected': those are self-sign-up states with their own sign-in messages. There is no 'inactive'.
-- Option B (leave as is) is at the bottom, commented: since the API now refuses sign-in, invite
--   accept and invite resend for retired-role holders, leaving them 'invited' is also safe, just untidy
--   (they would show as "invite pending" forever).
\if :{?slug}
\else
  \set slug arighna
\endif
\set ON_ERROR_STOP 1
BEGIN;

CREATE TEMP TABLE _retire ON COMMIT DROP AS
SELECT u.id AS user_id, u.company_id, u.status AS old_status
FROM users u
JOIN companies c ON c.id = u.company_id AND c.slug = :'slug'
WHERE u.deleted_at IS NULL
  AND u.auth_user_id IS NULL                                   -- never signed in
  AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)
  AND NOT EXISTS (                                             -- holds ONLY retired roles
    SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = u.id AND r.key::text NOT IN ('distribution_head', 'accountant'));

-- BEFORE
SELECT 'before' AS phase, u.name, u.employee_code, u.status,
       (SELECT count(*) FROM user_invites i WHERE i.user_id = u.id
          AND i.used_at IS NULL AND i.revoked_at IS NULL) AS open_invites
FROM _retire x JOIN users u ON u.id = x.user_id ORDER BY u.name;
SELECT count(*) AS holders_to_retire FROM _retire;   -- expected 2

-- 1. Revoke open invites (idempotent: only unrevoked, unused).
UPDATE user_invites i SET revoked_at = now()
FROM _retire x
WHERE i.user_id = x.user_id AND i.used_at IS NULL AND i.revoked_at IS NULL;

-- 2. Suspend (idempotent: only those not already suspended).
UPDATE users u SET status = 'suspended', updated_at = now()
FROM _retire x
WHERE u.id = x.user_id AND u.status <> 'suspended';

-- 3. Audit (one row per person, only on the first run: skipped when one already exists).
INSERT INTO audit_log (company_id, actor_user_id, action, entity_type, entity_id, before, after)
SELECT x.company_id, NULL, 'employee.retired_role_deactivated', 'user', x.user_id::text,
       jsonb_build_object('status', x.old_status),
       jsonb_build_object('status', 'suspended', 'invitesRevoked', true,
                          'fix', '2026-10-27-retire-functional-role-holders')
FROM _retire x
WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = x.user_id::text
                  AND a.action = 'employee.retired_role_deactivated');

-- AFTER (expect status=suspended, open_invites=0)
SELECT 'after' AS phase, u.name, u.employee_code, u.status,
       (SELECT count(*) FROM user_invites i WHERE i.user_id = u.id
          AND i.used_at IS NULL AND i.revoked_at IS NULL) AS open_invites
FROM _retire x JOIN users u ON u.id = x.user_id ORDER BY u.name;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM _retire x JOIN users u ON u.id = x.user_id WHERE u.status <> 'suspended')
  THEN RAISE EXCEPTION 'post-check failed: not all suspended'; END IF;
END $$;

COMMIT;

-- ROLLBACK SQL (run separately if needed; restores status and re-opens the invites this fix revoked):
-- BEGIN;
-- UPDATE users u SET status = (a.before->>'status')::user_status, updated_at = now()
-- FROM audit_log a WHERE a.action = 'employee.retired_role_deactivated'
--   AND a.entity_id = u.id::text AND u.status = 'suspended';
-- UPDATE user_invites i SET revoked_at = NULL
-- FROM audit_log a WHERE a.action = 'employee.retired_role_deactivated'
--   AND a.entity_id = i.user_id::text AND i.used_at IS NULL
--   AND i.revoked_at >= a.at - interval '1 minute' AND i.revoked_at <= a.at + interval '1 minute';
-- INSERT INTO audit_log (company_id, actor_user_id, action, entity_type, entity_id)
-- SELECT company_id, NULL, 'employee.retired_role_deactivated_rollback', 'user', entity_id
-- FROM audit_log WHERE action = 'employee.retired_role_deactivated';
-- COMMIT;

-- OPTION B: leave as is (do not run the above). Nothing to execute; the API already blocks
-- sign-in, invite accept and invite resend for these two people. Re-run the read-only report
-- (2026-10-27-retired-role-holders-report.sql) to confirm they still have no login.
