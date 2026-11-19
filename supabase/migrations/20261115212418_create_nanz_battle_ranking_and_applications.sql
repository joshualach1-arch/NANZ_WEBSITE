/*
# Create NANZ live battle ranking and recruitment storage

1. New Tables
- `nanz_battle_rankings`: one verified or partial current-battle score per clan, including the battle identifier, points, scan timestamp, provenance, and validation status.
- `nanz_battle_scan_state`: durable collector checkpoints for the active battle, candidate cursor, coverage, errors, and timestamps. This prevents multiple browser sessions from creating duplicate API scans.
- `nanz_recruitment_applications`: public recruitment submissions awaiting management review.

2. Data integrity
- Ranking rows are unique per battle and clan name.
- Battle points are stored separately from all-time clan points.
- Scan coverage and completeness are explicit fields; a partial scan cannot be presented as a verified global rank.
- Applications default to `pending` and are not readable by anonymous visitors.

3. Security
- RLS is enabled on every new table.
- Public visitors may read published ranking rows only.
- The collector uses the service role server-side for writes and checkpoint updates.
- Anonymous visitors may submit recruitment applications but cannot read, update, or delete them.
- Authenticated management tooling may read and update applications after the staff authorization layer is added.

4. Important notes
- The ranking collector stores legacy API provenance and active battle IDs so old battle data cannot be mixed with current results.
- No current rank or point total is seeded here; all values must come from the external collector.
*/

CREATE TABLE IF NOT EXISTS public.nanz_battle_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id text NOT NULL,
  battle_name text,
  clan_name text NOT NULL,
  battle_points bigint,
  rank_within_scanned_clans integer,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'BIG_GAMES_LEGACY_API',
  status text NOT NULL DEFAULT 'verified',
  error_message text,
  UNIQUE (battle_id, clan_name)
);

CREATE INDEX IF NOT EXISTS nanz_battle_rankings_battle_points_idx
  ON public.nanz_battle_rankings (battle_id, battle_points DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS nanz_battle_rankings_scanned_at_idx
  ON public.nanz_battle_rankings (scanned_at DESC);

ALTER TABLE public.nanz_battle_rankings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.nanz_battle_rankings TO anon, authenticated;
DROP POLICY IF EXISTS "Public can read verified ranking rows" ON public.nanz_battle_rankings;
CREATE POLICY "Public can read verified ranking rows"
  ON public.nanz_battle_rankings FOR SELECT
  TO anon, authenticated
  USING (status = 'verified');

CREATE TABLE IF NOT EXISTS public.nanz_battle_scan_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  battle_id text,
  battle_name text,
  nanz_clan_name text,
  nanz_battle_points bigint,
  rank_within_scanned_clans integer,
  scanned_clan_count integer NOT NULL DEFAULT 0,
  candidate_clan_count integer NOT NULL DEFAULT 0,
  scan_depth integer NOT NULL DEFAULT 1000,
  candidate_cursor integer NOT NULL DEFAULT 0,
  scan_coverage numeric(6,3) NOT NULL DEFAULT 0,
  last_successful_scan_at timestamptz,
  last_nanz_profile_fetch_at timestamptz,
  ranking_source text NOT NULL DEFAULT 'BIG_GAMES_LEGACY_API',
  is_complete boolean NOT NULL DEFAULT false,
  is_stale boolean NOT NULL DEFAULT true,
  last_scan_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nanz_battle_scan_state ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.nanz_battle_scan_state TO anon, authenticated;
DROP POLICY IF EXISTS "Public can read ranking scan state" ON public.nanz_battle_scan_state;
CREATE POLICY "Public can read ranking scan state"
  ON public.nanz_battle_scan_state FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TABLE IF NOT EXISTS public.nanz_recruitment_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roblox_username text NOT NULL,
  roblox_user_id text,
  discord_username text NOT NULL,
  daily_playtime text NOT NULL,
  daily_points_potential text NOT NULL,
  previous_clan text,
  experience text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  staff_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nanz_recruitment_applications_created_at_idx
  ON public.nanz_recruitment_applications (created_at DESC);

ALTER TABLE public.nanz_recruitment_applications ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.nanz_recruitment_applications TO anon, authenticated;
GRANT SELECT, UPDATE ON public.nanz_recruitment_applications TO authenticated;
DROP POLICY IF EXISTS "Public can submit recruitment applications" ON public.nanz_recruitment_applications;
CREATE POLICY "Public can submit recruitment applications"
  ON public.nanz_recruitment_applications FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    length(trim(roblox_username)) BETWEEN 2 AND 32
    AND length(trim(discord_username)) BETWEEN 2 AND 64
    AND length(trim(daily_playtime)) BETWEEN 1 AND 40
    AND length(trim(daily_points_potential)) BETWEEN 1 AND 40
    AND length(trim(experience)) BETWEEN 20 AND 4000
    AND status = 'pending'
  );
DROP POLICY IF EXISTS "Staff can read recruitment applications" ON public.nanz_recruitment_applications;
CREATE POLICY "Staff can read recruitment applications"
  ON public.nanz_recruitment_applications FOR SELECT
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'recruiter', 'admin'));
DROP POLICY IF EXISTS "Staff can update recruitment applications" ON public.nanz_recruitment_applications;
CREATE POLICY "Staff can update recruitment applications"
  ON public.nanz_recruitment_applications FOR UPDATE
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'recruiter', 'admin'))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'recruiter', 'admin'));
