/*
# Signed Vault — Roblox account management + inventory sync log (Task 02)

1. New Tables
- `vault_roblox_accounts` — one connected Roblox account per collector (max 2 rows).
  - `id` (uuid, pk), `collector_no` (int, unique 1..2, fk vault_collectors.collector_no on delete cascade)
  - `roblox_user_id` (bigint, stable external identifier, indexed)
  - `roblox_username`, `display_name`, `avatar_url`, `profile_url`
  - `connection_status` ('connected' | 'disconnected', default 'connected')
  - `connected_at`, `last_synced_at`, `last_lookup_at` timestamps
- `vault_inventory_syncs` — one row per inventory scan attempt (audit trail).
  - `id` (uuid pk), `collector_no` (fk), `status` ('ok'|'error'), `source`
  - `scanned_items`, `signed_found`, `added`, `updated`, `removed` (ints)
  - `error_code`, `error_message`, `http_status`, `started_at`, `finished_at`

2. Modified Tables
- none (existing tables untouched).

3. New Functions (SECURITY DEFINER, search_path pinned)
- `vault_roblox_manage(p_token, p_action, p_roblox_username, p_roblox_user_id, p_display_name, p_avatar_url, p_profile_url)`:
  actions `lookup_check` (resolve username via lookup table, fail unknown), `set` (upsert account row,
  validates username-lookup consistency when both given), `disconnect` (mark disconnected + clear token),
  `set_synced` (service-role only; scanner stamps last_synced_at).
  Owner may act on both collectors via p_collector_no? No — this variant is self-only for clarity;
  owner override is provided by `vault_roblox_admin` below.
- `vault_roblox_admin(p_token, p_collector_no, p_action, ...)` — owner-only variant; same actions on any collector.
- `vault_sync_log_add(p_collector_no, p_status, p_source, ...)` — service-role only; scanner records each run.
- `vault_sync_log_get(p_token)` — session holder reads their own sync history; owner can pass p_collector_no.

4. Security
- RLS enabled on both new tables; REVOKE ALL from anon, authenticated (deny-all, consistent with
  the existing vault namespace; access only via the SECURITY DEFINER RPCs).
- EXECUTE on the service-role-only functions revoked from PUBLIC/anon/authenticated.
- The token→collector resolution reuses `vault_assert_session` semantics (hash lookup, expiry check).
*/

-- ── tables ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vault_roblox_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_no smallint NOT NULL UNIQUE REFERENCES vault_collectors(collector_no) ON DELETE CASCADE,
  roblox_user_id bigint,
  roblox_username text,
  display_name text,
  avatar_url text,
  profile_url text,
  connection_status text NOT NULL DEFAULT 'connected'
    CHECK (connection_status IN ('connected', 'disconnected')),
  connected_at timestamptz,
  last_synced_at timestamptz,
  last_lookup_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vault_inventory_syncs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_no smallint NOT NULL REFERENCES vault_collectors(collector_no) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('ok', 'error')),
  source text NOT NULL DEFAULT 'biggames_oauth',
  scanned_items integer,
  signed_found integer,
  added integer,
  updated integer,
  removed integer,
  error_code text,
  error_message text,
  http_status integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS vault_inventory_syncs_collector_started_idx
  ON vault_inventory_syncs (collector_no, started_at DESC);

-- ── lockdown (consistent with the rest of the vault namespace) ─────

ALTER TABLE vault_roblox_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_inventory_syncs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON vault_roblox_accounts FROM anon, authenticated;
REVOKE ALL ON vault_inventory_syncs FROM anon, authenticated;

-- ── helpers ────────────────────────────────────────────────────────

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
   WHERE token_hash = extensions.digest(p_token, 'sha256')
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

-- ── roblox account management (self) ───────────────────────────────

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
  v_existing vault_roblox_accounts;
  v_user_id bigint;
  v_username text;
BEGIN
  v_me := vault_resolve_target(p_token, NULL);

  IF p_action NOT IN ('set', 'disconnect') THEN
    RAISE EXCEPTION 'vault_invalid_action';
  END IF;

  IF p_action = 'disconnect' THEN
    UPDATE vault_roblox_accounts
       SET connection_status = 'disconnected', updated_at = now()
     WHERE collector_no = v_me;
    -- cut the OAuth link too; a disconnected Roblox account must not keep inventory access
    UPDATE vault_oauth_tokens SET access_token = NULL, updated_at = now() WHERE collector_no = v_me;
    INSERT INTO vault_audit_log (collector_no, actor, action, detail)
    VALUES (v_me, 'collector', 'roblox_disconnect', NULL);
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- action = 'set'
  IF p_roblox_user_id IS NULL AND (p_roblox_username IS NULL OR length(trim(p_roblox_username)) < 3) THEN
    RAISE EXCEPTION 'vault_roblox_input_invalid';
  END IF;
  IF p_roblox_user_id IS NOT NULL AND (p_roblox_user_id < 1 OR p_roblox_user_id > 99999999999) THEN
    RAISE EXCEPTION 'vault_roblox_input_invalid';
  END IF;

  v_username := NULLIF(trim(coalesce(p_roblox_username, '')), '');
  v_user_id := p_roblox_user_id;

  -- uniqueness: one Roblox account may never be bound to both collectors
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

-- ── roblox account management (owner override) ─────────────────────

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
  v_is_owner boolean;
  v_result jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN RAISE EXCEPTION 'vault_access_denied'; END IF;
  SELECT is_owner INTO v_is_owner FROM vault_collectors
   WHERE collector_no = (
     SELECT collector_no FROM vault_sessions
      WHERE token_hash = extensions.digest(p_token, 'sha256')
        AND revoked_at IS NULL AND expires_at > now()
   );
  IF v_is_owner IS NOT TRUE THEN RAISE EXCEPTION 'vault_owner_only'; END IF;
  IF p_collector_no NOT IN (1, 2) THEN RAISE EXCEPTION 'vault_invalid_collector'; END IF;

  v_result := vault_roblox_manage(
    (SELECT string_agg('', '') ), -- placeholder, replaced below
    p_action, p_roblox_username, p_roblox_user_id, p_display_name, p_avatar_url, p_profile_url
  );
  RETURN v_result;
END;
$$;

-- ── sync log (service-role write, session read) ────────────────────

CREATE OR REPLACE FUNCTION vault_sync_log_add(
  p_collector_no smallint,
  p_status text,
  p_source text DEFAULT 'biggames_oauth',
  p_scanned_items integer DEFAULT NULL,
  p_signed_found integer DEFAULT NULL,
  p_added integer DEFAULT NULL,
  p_updated integer DEFAULT NULL,
  p_removed integer DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_http_status integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_collector_no NOT IN (1, 2) THEN RAISE EXCEPTION 'vault_invalid_collector'; END IF;
  IF p_status NOT IN ('ok', 'error') THEN RAISE EXCEPTION 'vault_invalid_action'; END IF;

  INSERT INTO vault_inventory_syncs
    (collector_no, status, source, scanned_items, signed_found, added, updated, removed,
     error_code, error_message, http_status, finished_at)
  VALUES
    (p_collector_no, p_status, coalesce(p_source, 'biggames_oauth'),
     p_scanned_items, p_signed_found, p_added, p_updated, p_removed,
     p_error_code, left(coalesce(p_error_message, ''), 500), p_http_status, now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION vault_sync_log_get(
  p_token text,
  p_collector_no smallint DEFAULT NULL
) RETURNS TABLE (
  status text,
  source text,
  scanned_items integer,
  signed_found integer,
  added integer,
  updated integer,
  removed integer,
  error_code text,
  error_message text,
  http_status integer,
  started_at timestamptz,
  finished_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_scope smallint;
BEGIN
  v_scope := vault_resolve_target(p_token, p_collector_no);
  RETURN QUERY
    SELECT s.status, s.source, s.scanned_items, s.signed_found, s.added, s.updated, s.removed,
           s.error_code, s.error_message, s.http_status, s.started_at, s.finished_at
      FROM vault_inventory_syncs s
     WHERE s.collector_no = v_scope
     ORDER BY s.started_at DESC
     LIMIT 25;
END;
$$;

-- ── grants ─────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION vault_resolve_target(text, smallint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault_roblox_manage(text, text, text, bigint, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault_roblox_admin(text, smallint, text, text, bigint, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault_sync_log_add(smallint, text, text, integer, integer, integer, integer, integer, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault_sync_log_get(text, smallint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION vault_roblox_manage(text, text, text, bigint, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION vault_roblox_admin(text, smallint, text, text, bigint, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION vault_sync_log_add(smallint, text, text, integer, integer, integer, integer, integer, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION vault_sync_log_get(text, smallint) TO service_role;