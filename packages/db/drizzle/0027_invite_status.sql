-- Invite accept error codes (#26): tell an unusable invite apart (used / expired / revoked) without a
-- tenant context. Called only after invite_resolve() found no usable invite. SECURITY DEFINER, returns
-- a single status word, nothing else. NULL = unknown token.
--   'used'    : redeemed, or the user is no longer 'invited' (already active/suspended)
--   'revoked' : replaced by a newer invite (API reports it as INVITE_INVALID)
--   'expired' : past expires_at
--   'valid'   : usable (race: the caller retries resolve)
CREATE OR REPLACE FUNCTION invite_status(p_token_hash text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN i.used_at IS NOT NULL OR u.status <> 'invited' OR u.auth_user_id IS NOT NULL THEN 'used'
    WHEN i.revoked_at IS NOT NULL THEN 'revoked'
    WHEN i.expires_at <= now() THEN 'expired'
    ELSE 'valid'
  END
  FROM public.user_invites i
  JOIN public.users u ON u.id = i.user_id AND u.deleted_at IS NULL
  WHERE i.token_hash = p_token_hash AND i.deleted_at IS NULL
  LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION invite_status(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION invite_status(text) TO ariforce_app;
