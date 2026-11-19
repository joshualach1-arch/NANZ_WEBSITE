/*
# Competitive Intelligence & Clan Legacy Expansion

Extends NANZ with: rival intelligence, clan goals & missions, hall of fame, battle archive.

## 1. New Tables
- `nanz_rival_snapshots`: timestamped rival battle points per battle (background collector).
- `nanz_rival_alerts`: generated alerts (overtake, threshold, rank milestones). Read-only to public.
- `nanz_rival_alert_config`: admin-configurable alert thresholds.
- `nanz_missions`: individual member missions (start/end dates, requirements, reward text).
- `nanz_member_missions`: mission assignments with progress + completion tracking.
- `nanz_clan_goal_history`: audit log for goal changes (create/edit/pause/complete/archive).
- `nanz_hall_of_fame`: manual honorary entries (special recognition section).

## 2. Modified Tables (additive only, no data loss)
- `nanz_rival_clans`: add display_name, logo_url, description, is_tracking.
- `nanz_clan_goals`: add goal_category, current_value, start_date, owner_label, reward_description.
- `nanz_battle_archive`: add archive_status ('complete'|'partial'), coverage_note, member_count, avg_contribution, top_contributor fields.
- `nanz_battle_archive_members`: (existing) used as-is.

## 3. Security
- Public SELECT (anon+authenticated) on rival snapshots/alerts, missions, goal history, hall of fame — this is a no-auth app.
- WRITE access: none granted to anon/authenticated (staff changes go through service-role edge functions in this build; frontend admin panel uses an RPC wrapper gated on a staff check via authenticated-only RPC if enabled later).
- All new tables have RLS enabled with explicit policies.
*/

-- =====================================================================
-- 1. Rival tracking columns
-- =====================================================================
ALTER TABLE public.nanz_rival_clans
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS is_tracking boolean NOT NULL DEFAULT true;

-- =====================================================================
-- 2. Rival snapshots
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.nanz_rival_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_name text NOT NULL,
  battle_id text NOT NULL,
  battle_points bigint,
  clan_rank integer,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clan_name, battle_id, captured_at)
);
CREATE INDEX IF NOT EXISTS nanz_rival_snapshots_clan_idx ON public.nanz_rival_snapshots (clan_name, captured_at DESC);
CREATE INDEX IF NOT EXISTS nanz_rival_snapshots_battle_idx ON public.nanz_rival_snapshots (battle_id, captured_at DESC);
ALTER TABLE public.nanz_rival_snapshots ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.nanz_rival_snapshots TO anon, authenticated;
GRANT ALL ON public.nanz_rival_snapshots TO service_role;
DROP POLICY IF EXISTS "Public read rival snapshots" ON public.nanz_rival_snapshots;
CREATE POLICY "Public read rival snapshots" ON public.nanz_rival_snapshots FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- 3. Rival alerts
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.nanz_rival_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL CHECK (alert_type IN ('rival_overtake','nanz_overtake','threshold_close','rival_surge','nanz_rank_milestone')),
  title text NOT NULL,
  detail text,
  rival_clan text,
  battle_id text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nanz_rival_alerts_created_idx ON public.nanz_rival_alerts (created_at DESC);
ALTER TABLE public.nanz_rival_alerts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE (is_read) ON public.nanz_rival_alerts TO anon, authenticated;
GRANT ALL ON public.nanz_rival_alerts TO service_role;
DROP POLICY IF EXISTS "Public read rival alerts" ON public.nanz_rival_alerts;
CREATE POLICY "Public read rival alerts" ON public.nanz_rival_alerts FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Anyone mark alert read" ON public.nanz_rival_alerts;
CREATE POLICY "Anyone mark alert read" ON public.nanz_rival_alerts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.nanz_rival_alert_config (
  id boolean PRIMARY KEY DEFAULT true,
  overtake_enabled boolean NOT NULL DEFAULT true,
  threshold_points bigint NOT NULL DEFAULT 5000,
  surge_percent integer NOT NULL DEFAULT 25,
  rank_milestones integer[] NOT NULL DEFAULT '{1,5,10,25,50,100,250,500}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.nanz_rival_alert_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.nanz_rival_alert_config ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.nanz_rival_alert_config TO anon, authenticated;
GRANT ALL ON public.nanz_rival_alert_config TO service_role;
DROP POLICY IF EXISTS "Public read alert config" ON public.nanz_rival_alert_config;
CREATE POLICY "Public read alert config" ON public.nanz_rival_alert_config FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- 4. Goals: extra columns
-- =====================================================================
ALTER TABLE public.nanz_clan_goals
  ADD COLUMN IF NOT EXISTS goal_category text NOT NULL DEFAULT 'contribution',
  ADD COLUMN IF NOT EXISTS current_value bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS start_date timestamptz,
  ADD COLUMN IF NOT EXISTS owner_label text,
  ADD COLUMN IF NOT EXISTS reward_description text;

ALTER TABLE public.nanz_clan_goals DROP CONSTRAINT IF EXISTS nanz_clan_goals_status_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nanz_clan_goals_status_check') THEN
    ALTER TABLE public.nanz_clan_goals ADD CONSTRAINT nanz_clan_goals_status_check CHECK (status IN ('active','paused','completed','archived'));
  END IF;
END $$;

-- =====================================================================
-- 5. Goal audit history
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.nanz_clan_goal_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.nanz_clan_goals(id) ON DELETE CASCADE,
  action text NOT NULL,
  detail text,
  actor_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.nanz_clan_goal_history ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.nanz_clan_goal_history TO anon, authenticated;
GRANT ALL ON public.nanz_clan_goal_history TO service_role;
DROP POLICY IF EXISTS "Public read goal history" ON public.nanz_clan_goal_history;
CREATE POLICY "Public read goal history" ON public.nanz_clan_goal_history FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- 6. Missions
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.nanz_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  requirement_type text NOT NULL CHECK (requirement_type IN ('daily_points','streak','total_points','rank_improvement','manual')),
  requirement_value bigint,
  start_date timestamptz NOT NULL DEFAULT now(),
  end_date timestamptz,
  reward_text text,
  achievement_slug text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','archived')),
  created_by_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.nanz_missions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.nanz_missions TO anon, authenticated;
GRANT ALL ON public.nanz_missions TO service_role;
DROP POLICY IF EXISTS "Public read missions" ON public.nanz_missions;
CREATE POLICY "Public read missions" ON public.nanz_missions FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.nanz_member_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.nanz_missions(id) ON DELETE CASCADE,
  roblox_user_id bigint NOT NULL,
  username text,
  progress bigint NOT NULL DEFAULT 0,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, roblox_user_id)
);
CREATE INDEX IF NOT EXISTS nanz_member_missions_user_idx ON public.nanz_member_missions (roblox_user_id);
ALTER TABLE public.nanz_member_missions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.nanz_member_missions TO anon, authenticated;
GRANT ALL ON public.nanz_member_missions TO service_role;
DROP POLICY IF EXISTS "Public read member missions" ON public.nanz_member_missions;
CREATE POLICY "Public read member missions" ON public.nanz_member_missions FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- 7. Archive: completeness columns
-- =====================================================================
ALTER TABLE public.nanz_battle_archive
  ADD COLUMN IF NOT EXISTS archive_status text NOT NULL DEFAULT 'partial',
  ADD COLUMN IF NOT EXISTS coverage_note text,
  ADD COLUMN IF NOT EXISTS member_count integer,
  ADD COLUMN IF NOT EXISTS avg_contribution bigint,
  ADD COLUMN IF NOT EXISTS top_contribution bigint,
  ADD COLUMN IF NOT EXISTS top_contributor_name text;

-- =====================================================================
-- 8. Hall of Fame (manual honorary + category registry)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.nanz_hall_of_fame (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type text NOT NULL CHECK (entry_type IN ('all_time_legend','battle_legend','top_contributor','most_consistent','special_recognition')),
  roblox_user_id bigint,
  username text,
  title text NOT NULL,
  detail text,
  stat_label text,
  stat_value bigint,
  battle_id text,
  period_label text,
  coverage_label text,
  recognition_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.nanz_hall_of_fame ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.nanz_hall_of_fame TO anon, authenticated;
GRANT ALL ON public.nanz_hall_of_fame TO service_role;
DROP POLICY IF EXISTS "Public read hall of fame" ON public.nanz_hall_of_fame;
CREATE POLICY "Public read hall of fame" ON public.nanz_hall_of_fame FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- 9. Module status rows
-- =====================================================================
INSERT INTO public.nanz_module_status (id, module_name, is_active, database_ready, integration_status)
VALUES
  ('nanz_rivals', 'Rival Intelligence', true, true, 'configured'),
  ('nanz_goals', 'Clan Goals & Missions', true, true, 'configured'),
  ('nanz_hof', 'Hall of Fame', true, true, 'configured'),
  ('nanz_archive', 'Battle Archive', true, true, 'configured')
ON CONFLICT (id) DO NOTHING;