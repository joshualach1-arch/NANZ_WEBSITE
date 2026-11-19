/*
# Player Profile 2.0 — data foundation

1. New Table: `nanz_clan_config` (singleton, id=true)
   - `owner_user_id bigint` — the configured NANZ ELITE clan owner (Roblox user ID).
     Single source of truth for owner recognition everywhere (profiles, roster).
   - `timezone text NOT NULL DEFAULT 'UTC'` — clan timezone for calendar-day based
     statistics (activity streaks, daily records). Stored as IANA name.
   - RLS enabled. SELECT granted to anon+authenticated (public read of owner id only —
     no secrets in this table). UPDATE via service_role only (edge functions).
   - Seeded with owner_user_id = 4616447639 (NodaBoda 01 / nodaboda01).

2. New Table: `nanz_reward_payouts` (reward ledger going forward)
   - `id uuid PK`, `roblox_user_id bigint NOT NULL`, `username text`,
     `gems bigint NOT NULL CHECK (gems >= 0)`, `reward_type text NOT NULL
     DEFAULT 'gems'`, `battle_id text`, `period_label text`, `notes text`,
     `awarded_by text`, `status text NOT NULL DEFAULT 'paid'
     CHECK (status IN ('paid','completed'))` — only actually paid/completed
     payouts are rows here; pending/unclaimed rewards are NEVER inserted.
   - UNIQUE `(roblox_user_id, battle_id, period_label, gems, reward_type)` where
     battle_id/period_label may be null — dedupe guard for idempotent inserts.
   - RLS enabled; SELECT for anon+authenticated (public profile stats read);
     INSERT/UPDATE/DELETE only via service_role (staff actions go through the
     passkey-checked edge function later; browser can never fabricate payouts).

3. New Table: `nanz_battle_results` (confirmed clan-level battle outcomes)
   - `battle_id text UNIQUE NOT NULL`, `battle_name text`,
     `finish_time timestamptz`, `nanz_final_points bigint`,
     `nanz_final_rank int`, `nanz_official_place int`,
     `result text NOT NULL CHECK (result IN ('win','loss'))`,
     `confirmed_at timestamptz NOT NULL DEFAULT now()`.
   - Only rows explicitly confirmed by staff count as finished battles for
     "Battle Wins" statistics. RLS enabled; SELECT public; writes service_role only.

4. Alter: `nanz_members`
   - `clan_role` CHECK widened to include the platform role ladder:
     'owner','admin','elite_member','veteran','member','recruit'
     (existing 'member' rows stay valid).
   - New column `role_source text DEFAULT 'sync'` — distinguishes staff-confirmed
     roles from sync defaults.

5. New SECURITY DEFINER function: `staff_set_member_role(p_passkey text,
   p_roblox_user_id bigint, p_role text)`
   - Server-side privileged role assignment, passkey-checked like the other
     staff RPCs (staff_verify). Validates p_role against the allowed ladder.
   - Keeps `joined_clan_at` untouched; sets role_source='staff_confirmed'.
   - EXECUTE granted ONLY to service_role (called via edge function), revoked
     from PUBLIC/anon/authenticated.

6. New view: `nanz_player_profile_stats` (SECURITY INVOKER)
   - Per-roblox-user aggregation over EXISTING tables only — no data duplication:
     * current battle points, contribution rank (from nanz_battle_member_rankings
       for the active battle in nanz_battle_scan_state)
     * total points across recorded battles (daily snapshots distinct days +
       archive member totals), avg/highest daily points, best battle contribution,
       contributing-day count (participation), active-day dates list basis
     * all computed from nanz_daily_member_snapshots + nanz_battle_archive_members
   - SELECT granted to anon+authenticated; view runs as invoker and only reads
     tables anon can already read.
*/

-- ── 1. Clan config (owner + timezone) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nanz_clan_config (
  id boolean PRIMARY KEY DEFAULT true,
  owner_user_id bigint,
  timezone text NOT NULL DEFAULT 'UTC',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.nanz_clan_config (id, owner_user_id, timezone)
VALUES (true, 4616447639, 'UTC')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.nanz_clan_config ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.nanz_clan_config TO anon, authenticated;

DROP POLICY IF EXISTS "Public read clan config" ON public.nanz_clan_config;
CREATE POLICY "Public read clan config"
ON public.nanz_clan_config FOR SELECT
TO anon, authenticated
USING (true);

-- ── 2. Reward payout ledger ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nanz_reward_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roblox_user_id bigint NOT NULL,
  username text,
  gems bigint NOT NULL CHECK (gems >= 0),
  reward_type text NOT NULL DEFAULT 'gems',
  battle_id text,
  period_label text,
  notes text,
  awarded_by text,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','completed')),
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS nanz_reward_payouts_dedupe_idx
ON public.nanz_reward_payouts (roblox_user_id, COALESCE(battle_id,''), COALESCE(period_label,''), gems, reward_type);
CREATE INDEX IF NOT EXISTS nanz_reward_payouts_user_idx ON public.nanz_reward_payouts (roblox_user_id, paid_at DESC);

ALTER TABLE public.nanz_reward_payouts ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.nanz_reward_payouts TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.nanz_reward_payouts TO service_role;

DROP POLICY IF EXISTS "Public read reward payouts" ON public.nanz_reward_payouts;
CREATE POLICY "Public read reward payouts"
ON public.nanz_reward_payouts FOR SELECT
TO anon, authenticated
USING (true);

-- ── 3. Confirmed battle results (clan wins) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.nanz_battle_results (
  battle_id text PRIMARY KEY,
  battle_name text,
  finish_time timestamptz,
  nanz_final_points bigint,
  nanz_final_rank int,
  nanz_official_place int,
  result text NOT NULL CHECK (result IN ('win','loss')),
  confirmed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nanz_battle_results ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.nanz_battle_results TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.nanz_battle_results TO service_role;

DROP POLICY IF EXISTS "Public read battle results" ON public.nanz_battle_results;
CREATE POLICY "Public read battle results"
ON public.nanz_battle_results FOR SELECT
TO anon, authenticated
USING (true);

-- ── 4. Member role ladder ──────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nanz_members_clan_role_check'
  ) THEN
    ALTER TABLE public.nanz_members DROP CONSTRAINT IF EXISTS nanz_members_clan_role_check;
    ALTER TABLE public.nanz_members ADD CONSTRAINT nanz_members_clan_role_check
      CHECK (clan_role IN ('owner','admin','elite_member','veteran','member','recruit'));
  END IF;
END $$;

ALTER TABLE public.nanz_members ADD COLUMN IF NOT EXISTS role_source text NOT NULL DEFAULT 'sync';

-- Seed the owner's member row role (idempotent; sync may reset clan_role,
-- so also run this on each deploy of the ranking function — see edge fn).
UPDATE public.nanz_members SET clan_role = 'owner', role_source = 'staff_confirmed'
WHERE roblox_user_id = 4616447639 AND clan_role <> 'owner';

-- ── 5. Staff role assignment (server-side only) ────────────────────────
CREATE OR REPLACE FUNCTION public.staff_set_member_role(p_passkey text, p_roblox_user_id bigint, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT staff_verify(p_passkey) THEN
    RAISE EXCEPTION 'staff_key_invalid';
  END IF;
  IF p_role NOT IN ('owner','admin','elite_member','veteran','member','recruit') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;
  UPDATE nanz_members
  SET clan_role = p_role, role_source = 'staff_confirmed', updated_at = now()
  WHERE roblox_user_id = p_roblox_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.staff_set_member_role(text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_set_member_role(text, bigint, text) TO service_role;

-- ── 6. Player profile stats view (existing tables only) ───────────────
CREATE OR REPLACE VIEW public.nanz_player_profile_stats
WITH (security_invoker = true) AS
WITH current_battle AS (
  SELECT battle_id FROM nanz_battle_scan_state WHERE id = true
),
current_rankings AS (
  SELECT r.user_id, r.username, r.battle_points,
         ROW_NUMBER() OVER (ORDER BY r.battle_points DESC) AS contribution_rank
  FROM nanz_battle_member_rankings r
  WHERE r.battle_id = (SELECT battle_id FROM current_battle)
),
daily AS (
  SELECT user_id,
         COUNT(*) AS contributing_days,
         SUM(battle_points) AS daily_total_points,
         MAX(battle_points) AS highest_daily_points,
         AVG(battle_points) AS avg_daily_points,
         MAX(snapshot_date) AS last_active_date
  FROM nanz_daily_member_snapshots
  GROUP BY user_id
),
archived AS (
  SELECT user_id,
         COUNT(*) AS archived_battles,
         SUM(battle_points) AS archived_points,
         MAX(battle_points) AS best_archived_battle
  FROM nanz_battle_archive_members
  GROUP BY user_id
)
SELECT m.roblox_user_id,
       m.roblox_username,
       m.clan_role,
       m.clan_status,
       m.discord_user_id,
       m.discord_verified,
       m.joined_clan_at,
       cr.battle_points AS current_battle_points,
       cr.contribution_rank,
       COALESCE(d.daily_total_points, 0) + COALESCE(a.archived_points, 0) AS total_recorded_points,
       d.contributing_days,
       a.archived_battles,
       d.highest_daily_points,
       d.avg_daily_points,
       d.last_active_date,
       a.best_archived_battle
FROM nanz_members m
LEFT JOIN current_rankings cr ON cr.user_id = m.roblox_user_id
LEFT JOIN daily d ON d.user_id = m.roblox_user_id
LEFT JOIN archived a ON a.user_id = m.roblox_user_id;

GRANT SELECT ON public.nanz_player_profile_stats TO anon, authenticated;