/*
# Signed Vault — fix vault_roblox_admin delegation (Task 02 follow-up)

The previous migration left `vault_roblox_admin` calling `vault_roblox_manage` with a
placeholder token, which would always fail. This migration restructures:

1. New internal function `vault_roblox_apply(v_collector_no, p_action, ...)` containing the
   connect/disconnect logic (shared by both entry points; NOT executable by any client role).
2. `vault_roblox_manage` now validates the session and delegates to the core.
3. `vault_roblox_admin` validates an OWNER session (via vault_resolve_target with explicit
   collector number, which raises vault_owner_only for non-owners) and delegates to the core.

Security: unchanged grants; the core helper is revoked from every role.
*/

CREATE OR REPLACE FUNCTION vault_roblox_apply(
  v_me smallint,
  p_action text,
  p_roblox_username text,
  p_roblox_user_id bigint,
  p_display_name text,
  p_avatar_url text,
  p_profile_url text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_user_id bigint;
  v_username text;
BEGIN
  IF p_action NOT IN ('set', 'disconnect') THEN
    RAISE EXCEPTION 'vault_invalid_action';
  END IF;

  IF p_action = 'disconnect' THEN
    UPDATE vault_roblox_accounts
       SET connection_status = 'disconnected', updated_at = now()
     WHERE collector_no = v_me;
    UPDATE vault_oauth_tokens SET access_token = NULL, updated_at = now() WHERE collector_no = v_me;
    INSERT INTO vault_audit_log (collector_no, actor, action, detail)
    VALUES (v_me, 'collector', 'roblox_disconnect', NULL);
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF p_roblox_user_id IS NULL AND (p_roblox_username IS NULL OR length(trim(p_roblox_username)) < 3) THEN
    RAISE EXCEPTION 'vault_roblox_input_invalid';
  END IF;
  IF p_roblox_user_id IS NOT NULL AND (p_roblox_user_id < 1 OR p_roblox_user_id > 99999999999) THEN
    RAISE EXCEPTION 'vault_roblox_input_invalid';
  END IF;

  v_username := NULLIF(trim(coalesce(p_roblox_username, '')), '');
  v_user_id := p_roblox_user_id;

  IF v_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM vault_roblox_accounts
     WHERE roblox_user_id = v_user_id AND collector_no <> v_me
       AND connection_status = 'connected'
  ) THEN
    RAISE EXCEPTION 'vault_roblox_already_bound';
  END IF;

  INSERT INTO vault_roblox_accounts
    (collector_no, roblox_user_id, roblox_username, display_name, avatar_url, profile_url,
     connection_status, connected_at)
  VALUES
    (v_me, v_user_id, v_username, coalesce(p_display_name, v_username), p_avatar_url, p_profile_url,
     'connected', coalesce((SELECT connected_at FROM vault_roblox_accounts WHERE collector_no = v_me), now()))
  ON CONFLICT (collector_no) DO UPDATE
    SET roblox_user_id   = coalesce(excluded.roblox_user_id, vault_roblox_accounts.roblox_user_id),
        roblox_username  = coalesce(excluded.roblox_username, vault_roblox_accounts.roblox_username),
        display_name     = coalesce(excluded.display_name, vault_roblox_accounts.display_name),
        avatar_url       = coalesce(excluded.avatar_url, vault_roblox_accounts.avatar_url),
        profile_url      = coalesce(excluded.profile_url, vault_roblox_accounts.profile_url),
        connection_status = 'connected',
        connected_at     = vault_roblox_accounts.connected_at,
        last_lookup_at   = now(),
        updated_at       = now();

  INSERT INTO vault_audit_log (collector_no, actor, action, detail)
  VALUES (v_me, 'collector', 'roblox_connect', jsonb_build_object('username', v_username, 'user_id', v_user_id));

  RETURN jsonb_build_object('ok', true, 'collector_no', v_me);
END;
$$;

CREATE OR REPLACE FUNCTION vault_roblox_manage(
  p_token text,
  p_action text,
  p_roblox_username text DEFAULT NULL,
  p_roblox_user_id bigint DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL,
  p_profile_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_me smallint;
BEGIN
  v_me := vault_resolve_target(p_token, NULL);
  RETURN vault_roblox_apply(v_me, p_action, p_roblox_username, p_roblox_user_id,
                            p_display_name, p_avatar_url, p_profile_url);
END;
$$;

CREATE OR REPLACE FUNCTION vault_roblox_admin(
  p_token text,
  p_collector_no smallint,
  p_action text,
  p_roblox_username text DEFAULT NULL,
  p_roblox_user_id bigint DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL,
  p_profile_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_target smallint;
BEGIN
  v_target := vault_resolve_target(p_token, p_collector_no);
  RETURN vault_roblox_apply(v_target, p_action, p_roblox_username, p_roblox_user_id,
                            p_display_name, p_avatar_url, p_profile_url);
END;
$$;

REVOKE ALL ON FUNCTION vault_roblox_apply(smallint, text, text, bigint, text, text, text)
  FROM PUBLIC, anon, authenticated;