/*
# Player Connections (admin-managed Discord links) + real clan join dates

1. Plain-English explanation
   - Admins manually connect Roblox clan members to Discord accounts in a new
     management section. Connections live in a dedicated table so the player
     profile can show a real "Message on Discord" button and a verified
     "Discord Member" indicator.
   - The BIG Games clan API exposes `Members[].JoinTime` (unix seconds).
     The live sync now persists it on `nanz_members.joined_clan_at`, so player
     profiles show the REAL clan join date instead of "Join date unavailable".

2. New Tables
   - `nanz_player_connections`
     - `id` (uuid, primary key)
     - `roblox_user_id` (bigint, not null, unique — the stable player identifier)
     - `roblox_username` (text, display only)
     - `discord_user_id` (text, not null — Discord snowflake stored as string, unique)
     - `discord_username` (text, display only)
     - `discord_in_server` (boolean, default false — best-effort membership flag,
       refreshed by verification tooling; never treated as proof on its own)
     - `discord_checked_at` (timestamptz, nullable — last membership check)
     - `created_at` / `updated_at` (timestamptz)

3. Modified Tables
   - none (the sync writes `joined_clan_at` directly; column already exists).

4. Security changes
   - RLS enabled on `nanz_player_connections` with NO public policies: the table
     is fully closed to anon/authenticated browsing. All admin access happens
     through passkey-checked SECURITY DEFINER RPCs, and profile reads go through
     a narrow RPC that only exposes the linked Discord user id + display name.
   - `REVOKE ALL ... FROM PUBLIC, anon, authenticated` on the table; nothing is
     granted to Data API roles.
   - New RPCs (all passkey-checked, SECURITY DEFINER):
     - `staff_player_connection_list(p_passkey)` — full rows for the admin table.
     - `staff_player_connection_upsert(p_passkey, p_roblox_user_id, p_roblox_username,
       p_discord_user_id, p_discord_username)` — create/edit; validates the
       Roblox ID (positive bigint) and Discord snowflake (numeric string,
       17-20 digits) server-side; overwrites an existing connection for the
       same Roblox user or Discord account.
     - `staff_player_connection_delete(p_passkey, p_roblox_user_id)` — remove.
     - `player_discord_connection(p_roblox_user_id)` — public SECURITY DEFINER
       lookup returning ONLY (discord_user_id, discord_username, discord_in_server,
       discord_checked_at) for one Roblox ID; used by the player profile.

5. Important notes
   - Discord username is display-only; Discord user id is the identity.
   - Roblox User ID is the stable key; username changes do not break links.
   - The connection row alone is NOT proof of current server membership;
     `discord_in_server` is advisory and separately refreshed.
*/

-- ── 1. Connections table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nanz_player_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roblox_user_id bigint NOT NULL UNIQUE CHECK (roblox_user_id > 0),
  roblox_username text,
  discord_user_id text NOT NULL UNIQUE CHECK (discord_user_id ~ '^[0-9]{17,20}$'),
  discord_username text,
  discord_in_server boolean NOT NULL DEFAULT false,
  discord_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nanz_player_connections_discord_idx
  ON public.nanz_player_connections (discord_user_id);

ALTER TABLE public.nanz_player_connections ENABLE ROW LEVEL SECURITY;

-- Fully closed to the Data API: no anon/authenticated grants or policies.
REVOKE ALL ON public.nanz_player_connections FROM PUBLIC, anon, authenticated;

-- ── 2. Admin RPCs (passkey-checked) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.staff_player_connection_list(p_passkey text)
RETURNS TABLE (
  roblox_user_id bigint,
  roblox_username text,
  discord_user_id text,
  discord_username text,
  discord_in_server boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.staff_verify(p_passkey) THEN
    RAISE EXCEPTION 'staff_key_invalid';
  END IF;
  RETURN QUERY
    SELECT c.roblox_user_id, c.roblox_username, c.discord_user_id, c.discord_username,
           c.discord_in_server, c.created_at, c.updated_at
    FROM public.nanz_player_connections c
    ORDER BY c.updated_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_player_connection_upsert(
  p_passkey text,
  p_roblox_user_id bigint,
  p_roblox_username text,
  p_discord_user_id text,
  p_discord_username text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.staff_verify(p_passkey) THEN
    RAISE EXCEPTION 'staff_key_invalid';
  END IF;
  IF p_roblox_user_id IS NULL OR p_roblox_user_id <= 0 THEN
    RAISE EXCEPTION 'invalid_roblox_user_id';
  END IF;
  IF p_discord_user_id IS NULL OR p_discord_user_id !~ '^[0-9]{17,20}$' THEN
    RAISE EXCEPTION 'invalid_discord_user_id';
  END IF;

  -- One connection per Roblox user; also free the Discord account if it was
  -- previously connected to a different player.
  DELETE FROM public.nanz_player_connections
  WHERE discord_user_id = p_discord_user_id
    AND roblox_user_id <> p_roblox_user_id;

  INSERT INTO public.nanz_player_connections
    (roblox_user_id, roblox_username, discord_user_id, discord_username, updated_at)
  VALUES
    (p_roblox_user_id, NULLIF(trim(p_roblox_username), ''), p_discord_user_id, NULLIF(trim(p_discord_username), ''), now())
  ON CONFLICT (roblox_user_id) DO UPDATE
    SET roblox_username = EXCLUDED.roblox_username,
        discord_user_id = EXCLUDED.discord_user_id,
        discord_username = EXCLUDED.discord_username,
        discord_in_server = false,
        discord_checked_at = NULL,
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_player_connection_delete(p_passkey text, p_roblox_user_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.staff_verify(p_passkey) THEN
    RAISE EXCEPTION 'staff_key_invalid';
  END IF;
  DELETE FROM public.nanz_player_connections WHERE roblox_user_id = p_roblox_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.staff_player_connection_list(text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_player_connection_upsert(text, bigint, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_player_connection_delete(text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_player_connection_list(text)
  TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_player_connection_upsert(text, bigint, text, text, text)
  TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_player_connection_delete(text, bigint)
  TO service_role, authenticated;

-- ── 3. Public profile lookup (narrow, id-keyed only) ───────────────────
CREATE OR REPLACE FUNCTION public.player_discord_connection(p_roblox_user_id bigint)
RETURNS TABLE (
  discord_user_id text,
  discord_username text,
  discord_in_server boolean,
  discord_checked_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.discord_user_id, c.discord_username, c.discord_in_server, c.discord_checked_at
  FROM public.nanz_player_connections c
  WHERE c.roblox_user_id = p_roblox_user_id;
$$;

REVOKE EXECUTE ON FUNCTION public.player_discord_connection(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.player_discord_connection(bigint) TO anon, authenticated;
