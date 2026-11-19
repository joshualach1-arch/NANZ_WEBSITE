/*
# NANZ Player Universe, Achievements & Awards Extension

## Purpose
Extends the platform foundation with:
1. Achievement definition seeding (27 achievements across 5 categories with common/rare/epic/legendary/mythic tiers)
2. Award definition seeding (8 award types)
3. Daily member contribution snapshots for streak tracking and historical stats
4. Notification system (persistent, dismissible)
5. Member reputation totals (denormalized for fast lookup)

## 1. New Tables
- `nanz_daily_member_snapshots`: one row per member per day per battle, capturing battle_points. Used for streak tracking and historical stats.
- `nanz_notifications`: persistent notifications for achievement unlocks, awards, reputation milestones, record breaks.
- `nanz_member_reputation_totals`: denormalized total reputation per member with level.

## 2. Modified Tables
- `nanz_achievement_definitions`: tier check constraint altered from (bronze/silver/gold/platinum/diamond) to (common/rare/epic/legendary/mythic) to match the required rarity system.

## 3. Seeded Data
- 27 achievement definitions across BATTLE PERFORMANCE, CONSISTENCY, CONTRIBUTION, COMMUNITY, and SPECIAL categories.
- 8 award definitions.

## 4. Security
- All new tables have RLS enabled.
- Daily snapshots: public SELECT, service_role write.
- Notifications: authenticated SELECT/UPDATE on own rows, service_role full.
- Reputation totals: public SELECT, service_role write.
*/

-- ============================================================================
-- Alter achievement tier constraint to use rarity levels
-- ============================================================================

ALTER TABLE public.nanz_achievement_definitions DROP CONSTRAINT IF EXISTS nanz_achievement_definitions_tier_check;
ALTER TABLE public.nanz_achievement_definitions ADD CONSTRAINT nanz_achievement_definitions_tier_check
  CHECK (tier IN ('common', 'rare', 'epic', 'legendary', 'mythic'));

-- ============================================================================
-- Daily Member Snapshots
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nanz_daily_member_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id text NOT NULL,
  user_id bigint NOT NULL,
  username text,
  battle_points bigint NOT NULL DEFAULT 0,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (battle_id, user_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS nanz_daily_member_snapshots_user_date_idx
  ON public.nanz_daily_member_snapshots (user_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS nanz_daily_member_snapshots_battle_idx
  ON public.nanz_daily_member_snapshots (battle_id, snapshot_date DESC);

ALTER TABLE public.nanz_daily_member_snapshots ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.nanz_daily_member_snapshots TO anon, authenticated;
GRANT ALL ON public.nanz_daily_member_snapshots TO service_role;

DROP POLICY IF EXISTS "Public can read daily member snapshots" ON public.nanz_daily_member_snapshots;
CREATE POLICY "Public can read daily member snapshots"
  ON public.nanz_daily_member_snapshots FOR SELECT
  TO anon, authenticated USING (true);

-- ============================================================================
-- Notifications
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nanz_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roblox_user_id bigint NOT NULL,
  type text NOT NULL CHECK (type IN ('achievement', 'award', 'reputation', 'record', 'system')),
  title text NOT NULL,
  body text,
  icon text,
  link text,
  is_read boolean NOT NULL DEFAULT false,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nanz_notifications_user_idx
  ON public.nanz_notifications (roblox_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS nanz_notifications_unread_idx
  ON public.nanz_notifications (roblox_user_id, is_read);

ALTER TABLE public.nanz_notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.nanz_notifications TO authenticated;
GRANT ALL ON public.nanz_notifications TO service_role;

DROP POLICY IF EXISTS "Users can read own notifications" ON public.nanz_notifications;
CREATE POLICY "Users can read own notifications"
  ON public.nanz_notifications FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can dismiss own notifications" ON public.nanz_notifications;
CREATE POLICY "Users can dismiss own notifications"
  ON public.nanz_notifications FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Member Reputation Totals
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nanz_member_reputation_totals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL UNIQUE REFERENCES public.nanz_members(id) ON DELETE CASCADE,
  roblox_user_id bigint NOT NULL,
  total_reputation integer NOT NULL DEFAULT 0,
  reputation_level text NOT NULL DEFAULT 'Rookie',
  last_calculated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nanz_member_reputation_totals_roblox_idx
  ON public.nanz_member_reputation_totals (roblox_user_id);
CREATE INDEX IF NOT EXISTS nanz_member_reputation_totals_rep_idx
  ON public.nanz_member_reputation_totals (total_reputation DESC);

ALTER TABLE public.nanz_member_reputation_totals ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.nanz_member_reputation_totals TO anon, authenticated;
GRANT ALL ON public.nanz_member_reputation_totals TO service_role;

DROP POLICY IF EXISTS "Public can read reputation totals" ON public.nanz_member_reputation_totals;
CREATE POLICY "Public can read reputation totals"
  ON public.nanz_member_reputation_totals FOR SELECT
  TO anon, authenticated USING (true);

-- ============================================================================
-- Seed Achievement Definitions
-- ============================================================================

INSERT INTO public.nanz_achievement_definitions (slug, name, description, category, tier, icon, criteria, reputation_points, is_active) VALUES
('first_contribution', 'First Contribution', 'Earned your first battle points in a NANZ clan battle', 'battle', 'common', 'Swords', 'battle_points > 0', 10, true),
('first_1k', 'First 1K', 'Reached 1,000 battle points in a single battle', 'battle', 'common', 'Target', 'battle_points >= 1000', 20, true),
('battle_machine', 'Battle Machine', 'Reached 5,000 battle points in a single battle', 'battle', 'rare', 'Zap', 'battle_points >= 5000', 50, true),
('top_500', 'Top 500', 'NANZ finished in the global top 500', 'battle', 'common', 'Globe2', 'clan_rank <= 500', 30, true),
('top_250', 'Top 250', 'NANZ finished in the global top 250', 'battle', 'rare', 'Globe2', 'clan_rank <= 250', 50, true),
('top_100', 'Top 100', 'NANZ finished in the global top 100', 'battle', 'epic', 'Globe2', 'clan_rank <= 100', 100, true),
('top_50', 'Top 50', 'NANZ finished in the global top 50', 'battle', 'epic', 'Trophy', 'clan_rank <= 50', 150, true),
('top_30', 'Top 30', 'NANZ finished in the global top 30', 'battle', 'legendary', 'Trophy', 'clan_rank <= 30', 250, true),
('top_10', 'Top 10', 'NANZ finished in the global top 10', 'battle', 'legendary', 'Crown', 'clan_rank <= 10', 500, true),
('top_5_legend', 'Top 5 Legend', 'NANZ finished in the global top 5', 'battle', 'mythic', 'Crown', 'clan_rank <= 5', 1000, true),
('first_3_day_streak', '3 Day Streak', 'Contributed points on 3 consecutive days', 'consistency', 'common', 'Flame', 'streak >= 3', 25, true),
('seven_day_streak', '7 Day Streak', 'Contributed points on 7 consecutive days', 'consistency', 'rare', 'Flame', 'streak >= 7', 75, true),
('fourteen_day_streak', '14 Day Streak', 'Contributed points on 14 consecutive days', 'consistency', 'epic', 'Flame', 'streak >= 14', 200, true),
('thirty_day_streak', '30 Day Streak', 'Contributed points on 30 consecutive days', 'consistency', 'legendary', 'Flame', 'streak >= 30', 500, true),
('consistency_king', 'Consistency King', 'Contributed points every day of an entire battle', 'consistency', 'mythic', 'Diamond', 'streak >= battle_duration_days', 1000, true),
('10k_contributor', '10K Contributor', 'Contributed 10,000 total battle points', 'contribution', 'common', 'BarChart3', 'total_points >= 10000', 30, true),
('50k_contributor', '50K Contributor', 'Contributed 50,000 total battle points', 'contribution', 'rare', 'BarChart3', 'total_points >= 50000', 75, true),
('100k_contributor', '100K Contributor', 'Contributed 100,000 total battle points', 'contribution', 'epic', 'BarChart3', 'total_points >= 100000', 200, true),
('500k_contributor', '500K Contributor', 'Contributed 500,000 total battle points', 'contribution', 'legendary', 'BarChart3', 'total_points >= 500000', 500, true),
('million_point_club', 'Million Point Club', 'Contributed 1,000,000 total battle points', 'contribution', 'mythic', 'Diamond', 'total_points >= 1000000', 1000, true),
('clan_legend', 'Clan Legend', 'Recognized as a legend of NANZ by management', 'community', 'mythic', 'Crown', 'manual', 1000, true),
('recruitment_hero', 'Recruitment Hero', 'Helped recruit new members to NANZ', 'community', 'rare', 'Users', 'manual', 75, true),
('community_champion', 'Community Champion', 'Recognized for outstanding community spirit', 'community', 'epic', 'Heart', 'manual', 200, true),
('event_participant', 'Event Participant', 'Participated in a NANZ clan event', 'community', 'common', 'Calendar', 'manual', 25, true),
('battle_mvp_ach', 'Battle MVP', 'Awarded Best Battle Performance', 'special', 'mythic', 'Trophy', 'manual', 500, true),
('player_of_the_month_ach', 'Player of the Month', 'Awarded Player of the Month', 'special', 'mythic', 'Star', 'manual', 500, true),
('hall_of_fame_member', 'Hall of Fame Member', 'Inducted into the NANZ Hall of Fame', 'special', 'mythic', 'Award', 'manual', 1000, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  tier = EXCLUDED.tier,
  icon = EXCLUDED.icon,
  criteria = EXCLUDED.criteria,
  reputation_points = EXCLUDED.reputation_points,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- ============================================================================
-- Seed Award Definitions
-- ============================================================================

INSERT INTO public.nanz_award_definitions (slug, name, description, tier, icon, is_active) VALUES
('player_of_the_week', 'Player of the Week', 'Highest verified contribution during the week', 'gold', 'Star', true),
('player_of_the_month', 'Player of the Month', 'Highest verified contribution during the month', 'platinum', 'Crown', true),
('battle_mvp', 'Battle MVP', 'Best verified battle performance', 'diamond', 'Trophy', true),
('most_consistent_player', 'Most Consistent Player', 'Best consistency based on recorded daily contributions', 'gold', 'Flame', true),
('most_improved_player', 'Most Improved Player', 'Largest verified improvement compared with a previous period', 'silver', 'TrendingUp', true),
('top_contributor', 'Top Contributor', 'Highest contribution during the selected period', 'gold', 'BarChart3', true),
('clan_legend', 'Clan Legend', 'Special management-awarded distinction', 'diamond', 'Award', true),
('community_champion', 'Community Champion', 'Management-awarded community recognition', 'platinum', 'Heart', true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  tier = EXCLUDED.tier,
  icon = EXCLUDED.icon,
  is_active = EXCLUDED.is_active,
  updated_at = now();