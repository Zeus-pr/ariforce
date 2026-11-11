-- System Admin may view and edit outlet GPS locks (field:read, field:write).
-- 0061 was meant to set the full role list including these two. This only adds them
-- when they are missing, and leaves every other permission on the role as it is.
UPDATE roles
SET permissions = (
  SELECT coalesce(array_agg(x ORDER BY x), '{}')
  FROM (
    SELECT DISTINCT unnest(
      permissions || ARRAY['field:read', 'field:write']::text[]
    ) AS x
  ) s
)
WHERE key::text = 'system_admin'
  AND deleted_at IS NULL
  AND NOT (
    permissions @> ARRAY['field:read']::text[]
    AND permissions @> ARRAY['field:write']::text[]
  );
