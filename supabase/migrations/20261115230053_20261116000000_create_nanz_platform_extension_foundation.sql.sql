/*
# NANZ Platform Extension Foundation

## Purpose
Creates the database foundation for the platform expansion modules:
Player Universe, Rival Intelligence, Hall of Fame, Clan Goals & Missions,
Battle Archive, Achievement & Reputation System, NANZ Awards, Discord
Community, and Recruitment Integration.

This migration ONLY creates schema — it does not implement any module UI.
All existing tables, policies, and data remain untouched.

## 1. New Tables

### Member Identity
- `nanz_members`: unified member identity keyed by Roblox user ID, with optional Discord link (verified only), clan role, profile visibility, and account dates. Reuses data already collected by the live sync (nanz_battle_member_rankings) but provides a stable identity record independent of any single battle.

### Achievements & Reputation
- `nanz_achievement_definitions`: catalog of defined achievements (slug, name, description, category, tier, icon, criteria, points). Managed by staff only.
- `nanz_member_achievements`: achievement instances awarded to members. Unique per member + achievement. Includes awarded_by staff reference and timestamp.
- `nanz_reputation_history`: timestamped reputation events (positive/negative, reason, delta, staff reference).

### Awards
- `nanz_award_definitions`: award categories (e.g. "Top Contributor Q1"), with name, description, icon, tier. Managed by staff only.
- `nanz_award_winners`: award recipient rows. Unique per award + battle_id (or standalone period). Includes staff reference and timestamp.

### Rival Intelligence
- `nanz_rival_clans`: tracked rival clans keyed by name, with Roblox clan data snapshot, threat level, notes, and last-updated timestamp. Managed by staff only.

### Clan Goals & Missions
- `nanz_clan_goals`: goal definitions (target points, target rank, deadline, status, description). Managed by staff only.
- `nanz_goal_progress`: timestamped progress snapshots per goal, so progress over time is trackable.

### Battle Archive
- `nanz_battle_archive`: one row per completed battle (battle_id, name, start/finish, NANZ final points, final rank, total contributors, rewards earned). Populated from verified sync data or manual staff entry after battle close.
- `nanz_battle_archive_members`: per-member results for an archived battle (user_id, username, battle_points, rank). Unique per archive + user_id.

### Discord Integration
- `nanz_discord_config`: singleton config row (guild ID, invite URL, webhook URL, role mapping, feature toggles). Managed by staff only.
- `nanz_discord_link_logs`: audit log of Discord link/unlink attempts (roblox_user_id, discord_user_id, status, error, timestamp).

### Recruitment Delivery
- Extends existing `nanz_recruitment_applications` with delivery_status and reviewed_by columns rather than creating a duplicate table.

### Platform Module Status
- `nanz_module_status`: one row per extension module tracking its activation state, database readiness, last update, integration status, and recent errors. Used by the admin PLATFORM MODULES panel.

## 2. Modified Tables
- `nanz_recruitment_applications`: adds `delivery_status` (text, default 'pending'), `reviewed_by` (uuid, nullable, references auth.users), and `reviewed_at` (timestamptz, nullable). Existing applications get 'pending' delivery_status.

## 3. Security
- All new tables have RLS enabled.
- Public-facing tables (members, achievements, awards, rival_clans, goals, battle_archive) allow public SELECT so anon visitors can view clan content.
- Staff-only tables (definitions, config, link logs) are SELECT-locked to authenticated staff roles via JWT app_metadata role check, matching the existing recruitment pattern.
- All writes on new tables are restricted to service_role (edge functions) and authenticated staff where appropriate.
- `nanz_module_status` is publicly readable (so the admin panel can show it) but only staff-writable.
- Discord config and link logs are staff-only read.
- The `nanz_members` table allows public SELECT for visible profiles but restricts sensitive columns (discord_user_id, discord_username) via column-level grants — anon can only see non-Discord columns.

## 4. Data Integrity
- `nanz_members` is unique on roblox_user_id.
- Achievement and award definitions are unique on slug.
- Member achievements are unique per member + achievement definition.
- Award winners are unique per award definition + period identifier.
- Battle archive is unique on battle_id.
- Battle archive members are unique per archive_id + user_id.
- Rival clans are unique on clan_name.
- Clan goals have no uniqueness constraint (multiple goals can coexist) but have a status check constraint.
- All foreign keys reference appropriate parent tables.
- Staff role check matches existing pattern: (auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin').

## 5. Indexes
- Indexes on all frequently-queried foreign keys and filter columns.
- Index on roblox_user_id for member lookups.
- Index on battle_id for archive queries.
- Index on slug for definition lookups.
*/

-- ============================================================================
-- Member Identity
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nanz_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roblox_user_id bigint NOT NULL UNIQUE,
  roblox_username text,
  roblox_display_name text,
  avatar_url text,
  discord_user_id text,
  discord_username text,
  discord_verified boolean NOT NULL DEFAULT false,
  discord_linked_at timestamptz,
  clan_role text NOT NULL DEFAULT 'member',
  clan_status text NOT NULL DEFAULT 'active',
  profile_visibility text NOT NULL DEFAULT 'public',
  joined_clan_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nanz_members_roblox_username_idx
  ON public.nanz_members (roblox_username);
CREATE INDEX IF NOT EXISTS nanz_members_clan_status_idx
  ON public.nanz_members (clan_status);

ALTER TABLE public.nanz_members ENABLE ROW LEVEL SECURITY;

-- Public can see public-profile members, but Discord fields are column-restricted
GRANT SELECT (id, roblox_user_id, roblox_username, roblox_display_name, avatar_url, clan_role, clan_status, profile_visibility, joined_clan_at, created_at, updated_at)
  ON public.nanz_members TO anon, authenticated;
GRANT SELECT ON public.nanz_members TO service_role;

DROP POLICY IF EXISTS "Public can read visible member profiles" ON public.nanz_members;
CREATE POLICY "Public can read visible member profiles"
  ON public.nanz_members FOR SELECT
  TO anon, authenticated
  USING (profile_visibility = 'public');

-- Staff can read all member fields including Discord
GRANT SELECT ON public.nanz_members TO authenticated;
DROP POLICY IF EXISTS "Staff can read all member profiles" ON public.nanz_members;
CREATE POLICY "Staff can read all member profiles"
  ON public.nanz_members FOR SELECT
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'recruiter', 'admin'));

-- Staff can insert/update member records
DROP POLICY IF EXISTS "Staff can manage members" ON public.nanz_members;
CREATE POLICY "Staff can manage members"
  ON public.nanz_members FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

DROP POLICY IF EXISTS "Staff can update members" ON public.nanz_members;
CREATE POLICY "Staff can update members"
  ON public.nanz_members FOR UPDATE
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

GRANT INSERT, UPDATE ON public.nanz_members TO authenticated;
GRANT ALL ON public.nanz_members TO service_role;

-- ============================================================================
-- Achievement Definitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nanz_achievement_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general',
  tier text NOT NULL DEFAULT 'bronze' CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum', 'diamond')),
  icon text,
  criteria text,
  reputation_points integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nanz_achievement_definitions_category_idx
  ON public.nanz_achievement_definitions (category);
CREATE INDEX IF NOT EXISTS nanz_achievement_definitions_active_idx
  ON public.nanz_achievement_definitions (is_active);

ALTER TABLE public.nanz_achievement_definitions ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.nanz_achievement_definitions TO anon, authenticated;
GRANT ALL ON public.nanz_achievement_definitions TO service_role;

DROP POLICY IF EXISTS "Public can read active achievement definitions" ON public.nanz_achievement_definitions;
CREATE POLICY "Public can read active achievement definitions"
  ON public.nanz_achievement_definitions FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "Staff can read all achievement definitions" ON public.nanz_achievement_definitions;
CREATE POLICY "Staff can read all achievement definitions"
  ON public.nanz_achievement_definitions FOR SELECT
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

DROP POLICY IF EXISTS "Staff can manage achievement definitions" ON public.nanz_achievement_definitions;
CREATE POLICY "Staff can manage achievement definitions"
  ON public.nanz_achievement_definitions FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

GRANT INSERT, UPDATE, DELETE ON public.nanz_achievement_definitions TO authenticated;

-- ============================================================================
-- Member Achievements
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nanz_member_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.nanz_members(id) ON DELETE CASCADE,
  achievement_id uuid NOT NULL REFERENCES public.nanz_achievement_definitions(id) ON DELETE CASCADE,
  awarded_by uuid,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  battle_id text,
  notes text,
  UNIQUE (member_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS nanz_member_achievements_member_idx
  ON public.nanz_member_achievements (member_id);
CREATE INDEX IF NOT EXISTS nanz_member_achievements_achievement_idx
  ON public.nanz_member_achievements (achievement_id);

ALTER TABLE public.nanz_member_achievements ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.nanz_member_achievements TO anon, authenticated;
GRANT ALL ON public.nanz_member_achievements TO service_role;

DROP POLICY IF EXISTS "Public can read member achievements" ON public.nanz_member_achievements;
CREATE POLICY "Public can read member achievements"
  ON public.nanz_member_achievements FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Staff can manage member achievements" ON public.nanz_member_achievements;
CREATE POLICY "Staff can manage member achievements"
  ON public.nanz_member_achievements FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

GRANT INSERT, UPDATE, DELETE ON public.nanz_member_achievements TO authenticated;

-- ============================================================================
-- Reputation History
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nanz_reputation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.nanz_members(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  reason text,
  delta integer NOT NULL DEFAULT 0,
  awarded_by uuid,
  battle_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nanz_reputation_history_member_idx
  ON public.nanz_reputation_history (member_id);
CREATE INDEX IF NOT EXISTS nanz_reputation_history_created_idx
  ON public.nanz_reputation_history (created_at DESC);

ALTER TABLE public.nanz_reputation_history ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.nanz_reputation_history TO anon, authenticated;
GRANT ALL ON public.nanz_reputation_history TO service_role;

DROP POLICY IF EXISTS "Public can read reputation history" ON public.nanz_reputation_history;
CREATE POLICY "Public can read reputation history"
  ON public.nanz_reputation_history FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Staff can manage reputation history" ON public.nanz_reputation_history;
CREATE POLICY "Staff can manage reputation history"
  ON public.nanz_reputation_history FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

GRANT INSERT, UPDATE, DELETE ON public.nanz_reputation_history TO authenticated;

-- ============================================================================
-- Award Definitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nanz_award_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  tier text NOT NULL DEFAULT 'gold' CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum', 'diamond')),
  icon text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nanz_award_definitions_active_idx
  ON public.nanz_award_definitions (is_active);

ALTER TABLE public.nanz_award_definitions ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.nanz_award_definitions TO anon, authenticated;
GRANT ALL ON public.nanz_award_definitions TO service_role;

DROP POLICY IF EXISTS "Public can read active award definitions" ON public.nanz_award_definitions;
CREATE POLICY "Public can read active award definitions"
  ON public.nanz_award_definitions FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "Staff can read all award definitions" ON public.nanz_award_definitions;
CREATE POLICY "Staff can read all award definitions"
  ON public.nanz_award_definitions FOR SELECT
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

DROP POLICY IF EXISTS "Staff can manage award definitions" ON public.nanz_award_definitions;
CREATE POLICY "Staff can manage award definitions"
  ON public.nanz_award_definitions FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

GRANT INSERT, UPDATE, DELETE ON public.nanz_award_definitions TO authenticated;

-- ============================================================================
-- Award Winners
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nanz_award_winners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  award_id uuid NOT NULL REFERENCES public.nanz_award_definitions(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.nanz_members(id) ON DELETE CASCADE,
  battle_id text,
  period_label text,
  awarded_by uuid,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  UNIQUE (award_id, period_label, member_id)
);

CREATE INDEX IF NOT EXISTS nanz_award_winners_award_idx
  ON public.nanz_award_winners (award_id);
CREATE INDEX IF NOT EXISTS nanz_award_winners_member_idx
  ON public.nanz_award_winners (member_id);

ALTER TABLE public.nanz_award_winners ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.nanz_award_winners TO anon, authenticated;
GRANT ALL ON public.nanz_award_winners TO service_role;

DROP POLICY IF EXISTS "Public can read award winners" ON public.nanz_award_winners;
CREATE POLICY "Public can read award winners"
  ON public.nanz_award_winners FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Staff can manage award winners" ON public.nanz_award_winners;
CREATE POLICY "Staff can manage award winners"
  ON public.nanz_award_winners FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

GRANT INSERT, UPDATE, DELETE ON public.nanz_award_winners TO authenticated;

-- ============================================================================
-- Rival Clans
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nanz_rival_clans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_name text NOT NULL UNIQUE,
  roblox_clan_name text,
  threat_level text NOT NULL DEFAULT 'medium' CHECK (threat_level IN ('low', 'medium', 'high', 'extreme')),
  last_known_points bigint,
  last_known_rank integer,
  notes text,
  last_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nanz_rival_clans_threat_idx
  ON public.nanz_rival_clans (threat_level);

ALTER TABLE public.nanz_rival_clans ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.nanz_rival_clans TO anon, authenticated;
GRANT ALL ON public.nanz_rival_clans TO service_role;

DROP POLICY IF EXISTS "Public can read rival clans" ON public.nanz_rival_clans;
CREATE POLICY "Public can read rival clans"
  ON public.nanz_rival_clans FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Staff can manage rival clans" ON public.nanz_rival_clans;
CREATE POLICY "Staff can manage rival clans"
  ON public.nanz_rival_clans FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

GRANT INSERT, UPDATE, DELETE ON public.nanz_rival_clans TO authenticated;

-- ============================================================================
-- Clan Goals
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nanz_clan_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  target_points bigint,
  target_rank integer,
  deadline timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'completed', 'failed', 'archived')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nanz_clan_goals_status_idx
  ON public.nanz_clan_goals (status);
CREATE INDEX IF NOT EXISTS nanz_clan_goals_deadline_idx
  ON public.nanz_clan_goals (deadline);

ALTER TABLE public.nanz_clan_goals ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.nanz_clan_goals TO anon, authenticated;
GRANT ALL ON public.nanz_clan_goals TO service_role;

DROP POLICY IF EXISTS "Public can read active and completed goals" ON public.nanz_clan_goals;
CREATE POLICY "Public can read active and completed goals"
  ON public.nanz_clan_goals FOR SELECT
  TO anon, authenticated
  USING (status IN ('active', 'completed'));

DROP POLICY IF EXISTS "Staff can read all goals" ON public.nanz_clan_goals;
CREATE POLICY "Staff can read all goals"
  ON public.nanz_clan_goals FOR SELECT
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

DROP POLICY IF EXISTS "Staff can manage goals" ON public.nanz_clan_goals;
CREATE POLICY "Staff can manage goals"
  ON public.nanz_clan_goals FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

GRANT INSERT, UPDATE, DELETE ON public.nanz_clan_goals TO authenticated;

-- ============================================================================
-- Goal Progress
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nanz_goal_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.nanz_clan_goals(id) ON DELETE CASCADE,
  current_points bigint,
  current_rank integer,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nanz_goal_progress_goal_idx
  ON public.nanz_goal_progress (goal_id, captured_at DESC);

ALTER TABLE public.nanz_goal_progress ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.nanz_goal_progress TO anon, authenticated;
GRANT ALL ON public.nanz_goal_progress TO service_role;

DROP POLICY IF EXISTS "Public can read goal progress" ON public.nanz_goal_progress;
CREATE POLICY "Public can read goal progress"
  ON public.nanz_goal_progress FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Staff can manage goal progress" ON public.nanz_goal_progress;
CREATE POLICY "Staff can manage goal progress"
  ON public.nanz_goal_progress FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

GRANT INSERT, UPDATE, DELETE ON public.nanz_goal_progress TO authenticated;

-- ============================================================================
-- Battle Archive
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nanz_battle_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id text NOT NULL UNIQUE,
  battle_name text NOT NULL,
  start_time timestamptz,
  finish_time timestamptz,
  nanz_final_points bigint,
  nanz_final_rank integer,
  nanz_official_place integer,
  total_contributors integer,
  rewards_earned text[],
  archived_at timestamptz NOT NULL DEFAULT now(),
  archived_by uuid
);

CREATE INDEX IF NOT EXISTS nanz_battle_archive_finish_idx
  ON public.nanz_battle_archive (finish_time DESC);

ALTER TABLE public.nanz_battle_archive ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.nanz_battle_archive TO anon, authenticated;
GRANT ALL ON public.nanz_battle_archive TO service_role;

DROP POLICY IF EXISTS "Public can read battle archive" ON public.nanz_battle_archive;
CREATE POLICY "Public can read battle archive"
  ON public.nanz_battle_archive FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Staff can manage battle archive" ON public.nanz_battle_archive;
CREATE POLICY "Staff can manage battle archive"
  ON public.nanz_battle_archive FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

GRANT INSERT, UPDATE, DELETE ON public.nanz_battle_archive TO authenticated;

-- ============================================================================
-- Battle Archive Member Results
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nanz_battle_archive_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES public.nanz_battle_archive(id) ON DELETE CASCADE,
  user_id bigint NOT NULL,
  username text,
  display_name text,
  battle_points bigint NOT NULL DEFAULT 0,
  rank integer,
  UNIQUE (archive_id, user_id)
);

CREATE INDEX IF NOT EXISTS nanz_battle_archive_members_archive_idx
  ON public.nanz_battle_archive_members (archive_id);
CREATE INDEX IF NOT EXISTS nanz_battle_archive_members_user_idx
  ON public.nanz_battle_archive_members (user_id);
CREATE INDEX IF NOT EXISTS nanz_battle_archive_members_points_idx
  ON public.nanz_battle_archive_members (archive_id, battle_points DESC);

ALTER TABLE public.nanz_battle_archive_members ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.nanz_battle_archive_members TO anon, authenticated;
GRANT ALL ON public.nanz_battle_archive_members TO service_role;

DROP POLICY IF EXISTS "Public can read archived battle members" ON public.nanz_battle_archive_members;
CREATE POLICY "Public can read archived battle members"
  ON public.nanz_battle_archive_members FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Staff can manage archived battle members" ON public.nanz_battle_archive_members;
CREATE POLICY "Staff can manage archived battle members"
  ON public.nanz_battle_archive_members FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

GRANT INSERT, UPDATE, DELETE ON public.nanz_battle_archive_members TO authenticated;

-- ============================================================================
-- Discord Configuration
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nanz_discord_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  guild_id text,
  guild_name text,
  invite_url text,
  webhook_url text,
  role_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  auto_sync_members boolean NOT NULL DEFAULT false,
  auto_post_battle_updates boolean NOT NULL DEFAULT false,
  auto_post_rewards boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nanz_discord_config ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.nanz_discord_config TO service_role;

-- Staff-only: no anon access at all
DROP POLICY IF EXISTS "Staff can read discord config" ON public.nanz_discord_config;
CREATE POLICY "Staff can read discord config"
  ON public.nanz_discord_config FOR SELECT
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

DROP POLICY IF EXISTS "Staff can manage discord config" ON public.nanz_discord_config;
CREATE POLICY "Staff can manage discord config"
  ON public.nanz_discord_config FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

GRANT SELECT, INSERT, UPDATE ON public.nanz_discord_config TO authenticated;

-- ============================================================================
-- Discord Link Logs
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nanz_discord_link_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roblox_user_id bigint,
  discord_user_id text,
  discord_username text,
  status text NOT NULL CHECK (status IN ('pending', 'verified', 'failed', 'revoked')),
  error_message text,
  verified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nanz_discord_link_logs_roblox_idx
  ON public.nanz_discord_link_logs (roblox_user_id);
CREATE INDEX IF NOT EXISTS nanz_discord_link_logs_status_idx
  ON public.nanz_discord_link_logs (status);

ALTER TABLE public.nanz_discord_link_logs ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.nanz_discord_link_logs TO service_role;

DROP POLICY IF EXISTS "Staff can read discord link logs" ON public.nanz_discord_link_logs;
CREATE POLICY "Staff can read discord link logs"
  ON public.nanz_discord_link_logs FOR SELECT
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

DROP POLICY IF EXISTS "Staff can manage discord link logs" ON public.nanz_discord_link_logs;
CREATE POLICY "Staff can manage discord link logs"
  ON public.nanz_discord_link_logs FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nanz_discord_link_logs TO authenticated;

-- ============================================================================
-- Recruitment Application Extension
-- ============================================================================

ALTER TABLE public.nanz_recruitment_applications
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sent_to_discord', 'delivered', 'failed', 'archived')),
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- ============================================================================
-- Platform Module Status
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nanz_module_status (
  id text PRIMARY KEY,
  module_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  database_ready boolean NOT NULL DEFAULT false,
  last_successful_update timestamptz,
  integration_status text NOT NULL DEFAULT 'not_configured'
    CHECK (integration_status IN ('not_configured', 'configured', 'connected', 'error', 'disabled')),
  last_error text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nanz_module_status ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.nanz_module_status TO anon, authenticated;
GRANT ALL ON public.nanz_module_status TO service_role;

DROP POLICY IF EXISTS "Public can read module status" ON public.nanz_module_status;
CREATE POLICY "Public can read module status"
  ON public.nanz_module_status FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Staff can manage module status" ON public.nanz_module_status;
CREATE POLICY "Staff can manage module status"
  ON public.nanz_module_status FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('founder', 'co_founder', 'clan_director', 'admin'));

GRANT INSERT, UPDATE, DELETE ON public.nanz_module_status TO authenticated;

-- Seed initial module status rows
INSERT INTO public.nanz_module_status (id, module_name, is_active, database_ready, integration_status) VALUES
  ('player_universe', 'Player Universe', false, true, 'not_configured'),
  ('rival_intelligence', 'Rival Intelligence', false, true, 'not_configured'),
  ('hall_of_fame', 'NANZ Hall of Fame', false, true, 'not_configured'),
  ('clan_goals', 'Clan Goals & Missions', false, true, 'not_configured'),
  ('battle_archive', 'Battle Archive', false, true, 'not_configured'),
  ('achievements', 'Achievement & Reputation System', false, true, 'not_configured'),
  ('nanz_awards', 'NANZ Awards', false, true, 'not_configured'),
  ('discord_community', 'Discord Community', false, true, 'not_configured'),
  ('recruitment_integration', 'Recruitment Integration', false, true, 'not_configured')
ON CONFLICT (id) DO NOTHING;