import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type BattleScanState = {
  battle_id: string | null;
  battle_name: string | null;
  nanz_battle_points: number | null;
  rank_within_scanned_clans: number | null;
  official_battle_place: number | null;
  scanned_clan_count: number;
  candidate_clan_count: number;
  scan_coverage: number;
  last_successful_scan_at: string | null;
  ranking_source: string;
  is_complete: boolean;
  is_stale: boolean;
  last_scan_error: string | null;
  battle_start_time: string | null;
  battle_finish_time: string | null;
  member_count: number;
  active_contributor_count: number;
  points_per_hour: number | null;
  sync_completed_at: string | null;
  next_sync_at: string | null;
  api_status: string;
  successful_profile_requests: number;
  failed_profile_requests: number;
  last_api_error: string | null;
  candidate_cursor: number;
  scan_depth: number;
};

export type BattleReward = {
  battle_id: string;
  reward_item_name: string;
  best_place: number;
  worst_place: number;
};

export type AvatarMap = Record<string, { avatar_url: string | null; display_name: string | null }>;

export type BattleMemberRanking = {
  battle_id: string;
  user_id: number;
  username: string | null;
  display_name: string | null;
  battle_points: number;
  rank: number | null;
  captured_at: string;
};

export type BattlePointSnapshot = {
  battle_id: string;
  battle_points: number;
  captured_at: string;
};

// ============================================================================
// Platform Extension Foundation Types
// ============================================================================

export type NanzMember = {
  id: string;
  roblox_user_id: number;
  roblox_username: string | null;
  roblox_display_name: string | null;
  avatar_url: string | null;
  discord_user_id: string | null;
  discord_username: string | null;
  discord_verified: boolean;
  clan_role: string;
  clan_status: string;
  profile_visibility: string;
  joined_clan_at: string | null;
  created_at: string;
};

export type AchievementDefinition = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  tier: string;
  icon: string | null;
  reputation_points: number;
  is_active: boolean;
};

export type MemberAchievement = {
  id: string;
  member_id: string;
  achievement_id: string;
  awarded_at: string;
  battle_id: string | null;
  notes: string | null;
};

export type AwardDefinition = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  tier: string;
  icon: string | null;
  is_active: boolean;
};

export type AwardWinner = {
  id: string;
  award_id: string;
  member_id: string;
  battle_id: string | null;
  period_label: string | null;
  awarded_at: string;
  notes: string | null;
};

export type RivalClan = {
  id: string;
  clan_name: string;
  threat_level: string;
  last_known_points: number | null;
  last_known_rank: number | null;
  notes: string | null;
  last_updated_at: string | null;
};

export type ClanGoal = {
  id: string;
  title: string;
  description: string | null;
  target_points: number | null;
  target_rank: number | null;
  deadline: string | null;
  status: string;
  created_at: string;
};

export type BattleArchive = {
  id: string;
  battle_id: string;
  battle_name: string;
  start_time: string | null;
  finish_time: string | null;
  nanz_final_points: number | null;
  nanz_final_rank: number | null;
  nanz_official_place: number | null;
  total_contributors: number | null;
  rewards_earned: string[] | null;
  archived_at: string;
};

export type ModuleStatus = {
  id: string;
  module_name: string;
  is_active: boolean;
  database_ready: boolean;
  last_successful_update: string | null;
  integration_status: string;
  last_error: string | null;
};

// ============================================================================
// Player Universe, Achievements & Awards Types
// ============================================================================

export type DailyMemberSnapshot = {
  battle_id: string;
  user_id: number;
  username: string | null;
  battle_points: number;
  snapshot_date: string;
  captured_at: string;
};

export type NanzNotification = {
  id: string;
  roblox_user_id: number;
  type: string;
  title: string;
  body: string | null;
  icon: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

export type ReputationTotal = {
  member_id: string;
  roblox_user_id: number;
  total_reputation: number;
  reputation_level: string;
  last_calculated_at: string;
};

export type AchievementWithDef = MemberAchievement & {
  achievement: AchievementDefinition;
};

export type AwardWinnerWithDef = AwardWinner & {
  award: AwardDefinition;
  member: { roblox_username: string | null; roblox_user_id: number; avatar_url: string | null } | null;
};

export type PlayerDirectoryEntry = {
  roblox_user_id: number;
  username: string | null;
  display_name: string | null;
  battle_points: number;
  rank: number | null;
  avatar_url: string | null;
  achievement_count: number;
  reputation: number;
  reputation_level: string;
  is_active: boolean;
};

export async function fetchRobloxAvas(usernames: string[]): Promise<AvatarMap> {
  if (usernames.length === 0) return {};
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/roblox-avatars`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
  };
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ usernames }),
    });
    if (!response.ok) return {};
    const data = await response.json();
    if (!data || !Array.isArray(data.avatars)) return {};
    const map: AvatarMap = {};
    for (const entry of data.avatars) {
      map[String(entry.username).toLowerCase()] = {
        avatar_url: entry.avatar_url ?? null,
        display_name: entry.display_name ?? null,
      };
    }
    return map;
  } catch {
    return {};
  }
}
