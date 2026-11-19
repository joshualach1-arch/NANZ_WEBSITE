/*
# Add durable live synchronization data

1. New Tables
- `nanz_battle_point_snapshots`: timestamped NANZ battle totals for the points-development chart and points-per-hour calculation.
- `nanz_battle_member_rankings`: latest verified member contribution rows for the active battle, including Roblox IDs, usernames, points, and calculated position.

2. Modified Tables
- `nanz_battle_scan_state`: adds member count, active contributor count, points-per-hour, synchronization lock state, API health, request counters, and the next scheduled sync time.

3. Security
- Public visitors can read current live results and historical point snapshots.
- Only the server-side service role can write rankings, member rows, snapshots, and scan state.
- Adds a server-only atomic lock function so two collectors cannot run at the same time.
- Removes anonymous and authenticated write access from live-data tables; the public app only needs SELECT.

4. Data integrity
- Member rows are unique per battle and Roblox user ID.
- Snapshot rows are timestamped and tied to a specific active battle ID.
- The collector can preserve the last valid result and mark it stale when an external API request fails.
*/

CREATE TABLE IF NOT EXISTS public.nanz_battle_point_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id text NOT NULL,
  clan_name text NOT NULL,
  battle_points bigint NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  data_source text NOT NULL DEFAULT 'BIG_GAMES_LEGACY_API',
  sync_status text NOT NULL DEFAULT 'verified'
);

CREATE INDEX IF NOT EXISTS nanz_battle_point_snapshots_battle_time_idx
  ON public.nanz_battle_point_snapshots (battle_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS public.nanz_battle_member_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id text NOT NULL,
  user_id bigint NOT NULL,
  username text,
  display_name text,
  battle_points bigint NOT NULL,
  rank integer,
  captured_at timestamptz NOT NULL DEFAULT now(),
  data_source text NOT NULL DEFAULT 'BIG_GAMES_LEGACY_API',
  sync_status text NOT NULL DEFAULT 'verified',
  UNIQUE (battle_id, user_id)
);

CREATE INDEX IF NOT EXISTS nanz_battle_member_rankings_battle_points_idx
  ON public.nanz_battle_member_rankings (battle_id, battle_points DESC);

ALTER TABLE public.nanz_battle_point_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nanz_battle_member_rankings ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.nanz_battle_point_snapshots TO anon, authenticated;
GRANT SELECT ON public.nanz_battle_member_rankings TO anon, authenticated;
GRANT ALL ON public.nanz_battle_point_snapshots TO service_role;
GRANT ALL ON public.nanz_battle_member_rankings TO service_role;

DROP POLICY IF EXISTS "Public can read battle point snapshots" ON public.nanz_battle_point_snapshots;
CREATE POLICY "Public can read battle point snapshots"
  ON public.nanz_battle_point_snapshots FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public can read member rankings" ON public.nanz_battle_member_rankings;
CREATE POLICY "Public can read member rankings"
  ON public.nanz_battle_member_rankings FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.nanz_battle_scan_state
  ADD COLUMN IF NOT EXISTS member_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_contributor_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_per_hour numeric,
  ADD COLUMN IF NOT EXISTS sync_lock_until timestamptz,
  ADD COLUMN IF NOT EXISTS sync_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS api_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS successful_profile_requests integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_profile_requests integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_api_error text;

REVOKE INSERT, UPDATE, DELETE ON public.nanz_battle_rankings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.nanz_battle_scan_state FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.nanz_battle_rewards FROM anon, authenticated;
GRANT ALL ON public.nanz_battle_rankings TO service_role;
GRANT ALL ON public.nanz_battle_scan_state TO service_role;
GRANT ALL ON public.nanz_battle_rewards TO service_role;

CREATE OR REPLACE FUNCTION public.claim_nanz_sync_lock(p_lock_until timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed boolean;
BEGIN
  UPDATE public.nanz_battle_scan_state
  SET sync_lock_until = p_lock_until,
      sync_started_at = now(),
      api_status = 'syncing',
      last_api_error = null,
      updated_at = now()
  WHERE id = true
    AND (sync_lock_until IS NULL OR sync_lock_until < now())
  RETURNING true INTO claimed;
  RETURN COALESCE(claimed, false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_nanz_sync_lock(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_nanz_sync_lock(timestamptz) TO service_role;
