/*
# Signed Vault — token-hash fix for Task-02 functions

`vault_resolve_target` (and the two roblox entry points that call it) compared the session
token against `extensions.digest(...)` (bytea) while `vault_sessions.token_hash` is a hex
text column. All lookups now go through the existing `vault_hash_secret(p_token)` helper,
matching the rest of the vault RPCs. Logic unchanged.
*/

CREATE OR REPLACE FUNCTION vault_resolve_target(
  p_token text,
  p_collector_no smallint
) RETURNS smallint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_session public.vault_sessions;
  v_is_owner boolean;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RAISE EXCEPTION 'vault_access_denied';
  END IF;
  SELECT * INTO v_session FROM vault_sessions
   WHERE token_hash = public.vault_hash_secret(p_token)
     AND revoked_at IS NULL AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'vault_access_denied'; END IF;
  UPDATE vault_sessions SET last_seen_at = now() WHERE token_hash = v_session.token_hash;

  SELECT is_owner INTO v_is_owner FROM vault_collectors WHERE collector_no = v_session.collector_no;
  IF p_collector_no IS NULL THEN
    RETURN v_session.collector_no;
  END IF;
  IF NOT v_is_owner THEN RAISE EXCEPTION 'vault_owner_only'; END IF;
  IF p_collector_no NOT IN (1, 2) THEN RAISE EXCEPTION 'vault_invalid_collector'; END IF;
  RETURN p_collector_no;
END;
$$;