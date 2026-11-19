import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const apiBase = "https://ps99.biggamesapi.io";
const defaultDepth = 1000;
const batchSize = 40;
const workerCount = 8;
const lockDurationMs = 55_000;
const syncIntervalMs = 60_000;

type JsonRecord = Record<string, unknown>;
type ClanCandidate = { name: string; points: number | null };
type Contribution = { userId: number; points: number };
type ScanState = { battle_id: string | null; battle_name: string | null; candidate_cursor: number; scan_depth: number };
type PlacementReward = { reward_item_name: string; best_place: number; worst_place: number };
type RobloxUser = { id: number; name: string; displayName: string };

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function firstRecord(value: unknown): JsonRecord {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

function readString(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readNumber(record: JsonRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    const number = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function extractPayload(payload: unknown): unknown {
  const record = asRecord(payload);
  return record.data ?? payload;
}

function getBattleId(payload: unknown): string | null {
  return readString(firstRecord(extractPayload(payload)), ["configName", "ConfigName", "battleId", "BattleId", "id", "Id"]);
}

function getBattleName(payload: unknown): string | null {
  return readString(firstRecord(extractPayload(payload)), ["displayName", "DisplayName", "name", "Name", "configName", "ConfigName"]);
}

function getBattleTiming(payload: unknown): { startTime: number | null; finishTime: number | null } {
  const root = firstRecord(extractPayload(payload));
  const config = asRecord(root.configData ?? root.ConfigData ?? root);
  return {
    startTime: readNumber(config, ["StartTime", "startTime"]),
    finishTime: readNumber(config, ["FinishTime", "finishTime"]),
  };
}

function getPlacementRewards(payload: unknown): PlacementReward[] {
  const root = firstRecord(extractPayload(payload));
  const config = asRecord(root.configData ?? root.ConfigData);
  const raw = config.PlacementRewards ?? config.placementRewards;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const entry = asRecord(item);
    const itemData = asRecord(entry.Item ?? entry.item);
    const innerData = asRecord(itemData._data ?? itemData);
    return {
      reward_item_name: readString(innerData, ["id", "name", "Name"]) ?? "Unknown Reward",
      best_place: readNumber(entry, ["Best", "best"]) ?? 0,
      worst_place: readNumber(entry, ["Worst", "worst"]) ?? 0,
    };
  }).filter((reward) => reward.best_place > 0 && reward.worst_place > 0);
}

function getCandidates(payload: unknown): ClanCandidate[] {
  const record = asRecord(payload);
  const raw = Array.isArray(record.data) ? record.data : [];
  return raw.map((item) => {
    const clan = asRecord(item);
    return {
      name: readString(clan, ["Name", "name", "ConfigName", "configName"]) ?? "",
      points: readNumber(clan, ["Points", "points"]),
    };
  }).filter((candidate) => candidate.name.length > 0);
}

function getBattleRecord(payload: unknown, battleId: string): JsonRecord {
  const root = firstRecord(extractPayload(payload));
  const battles = asRecord(root.Battles ?? root.battles);
  return asRecord(battles[battleId]);
}

function getContributions(payload: unknown, battleId: string): Contribution[] {
  const battle = getBattleRecord(payload, battleId);
  const raw = battle.PointContributions ?? battle.pointContributions;
  if (!Array.isArray(raw)) return [];
  const byUser = new Map<number, number>();
  for (const item of raw) {
    const entry = asRecord(item);
    const userId = readNumber(entry, ["UserID", "userId", "UserId"]);
    const points = readNumber(entry, ["Points", "points"]);
    if (userId === null || points === null || userId <= 0 || points < 0) continue;
    const previous = byUser.get(userId) ?? 0;
    byUser.set(userId, Math.max(previous, points));
  }
  return [...byUser.entries()].map(([userId, points]) => ({ userId, points }));
}

function getRosterIds(payload: unknown): number[] {
  const root = firstRecord(extractPayload(payload));
  const raw = root.Members ?? root.members;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => readNumber(asRecord(item), ["UserID", "userId", "UserId"]) ?? 0).filter((id) => id > 0);
}

// BIG Games clan profile exposes Members[].JoinTime as unix seconds per UserID.
function getRosterJoinTimes(payload: unknown): Map<number, number> {
  const root = firstRecord(extractPayload(payload));
  const raw = root.Members ?? root.members;
  const result = new Map<number, number>();
  if (!Array.isArray(raw)) return result;
  for (const item of raw) {
    const entry = asRecord(item);
    const userId = readNumber(entry, ["UserID", "userId", "UserId"]);
    const joinTime = readNumber(entry, ["JoinTime", "joinTime", "join_time"]);
    if (userId !== null && userId > 0 && joinTime !== null && joinTime > 0) result.set(userId, joinTime);
  }
  return result;
}

async function fetchJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": "NANZ-Elite-Live-Sync/1.0",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`BIG Games API returned ${response.status}`);
  return response.json();
}

async function fetchRobloxUsers(ids: number[]): Promise<Map<number, RobloxUser>> {
  const result = new Map<number, RobloxUser>();
  for (let start = 0; start < ids.length; start += 50) {
    const batch = ids.slice(start, start + 50);
    const response = await fetch("https://users.roblox.com/v1/users", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "NANZ-Elite-Live-Sync/1.0" },
      body: JSON.stringify({ userIds: batch }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) continue;
    const body = asRecord(await response.json());
    const users = Array.isArray(body.data) ? body.data : [];
    for (const item of users) {
      const user = asRecord(item);
      const id = readNumber(user, ["id"]);
      const name = readString(user, ["name"]);
      const displayName = readString(user, ["displayName"]) ?? name;
      if (id && name && displayName) result.set(id, { id, name, displayName });
    }
  }
  return result;
}

async function runConcurrent<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(workerCount, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
}

async function evaluateAchievements(
  supabase: ReturnType<typeof createClient>,
  battleId: string,
  contributions: Contribution[],
  officialPlace: number | null,
  computedRank: number,
  nowIso: string,
): Promise<void> {
  const { data: achievementDefs } = await supabase.from("nanz_achievement_definitions").select("id, slug, name, criteria, reputation_points, icon").eq("is_active", true);
  if (!achievementDefs || achievementDefs.length === 0) return;

  const { data: members } = await supabase.from("nanz_members").select("id, roblox_user_id").in("roblox_user_id", contributions.map((item) => item.userId));
  if (!members || members.length === 0) return;

  const memberByUserId = new Map<number, string>();
  for (const member of members) memberByUserId.set(member.roblox_user_id, member.id);

  const { data: existingAchievements } = await supabase.from("nanz_member_achievements").select("member_id, achievement_id");

  const existingSet = new Set<string>();
  if (existingAchievements) {
    for (const item of existingAchievements) existingSet.add(`${item.member_id}:${item.achievement_id}`);
  }

  // Calculate streaks from daily snapshots
  const todayDate = nowIso.slice(0, 10);
  const { data: allSnapshots } = await supabase.from("nanz_daily_member_snapshots").select("user_id, snapshot_date, battle_points").eq("battle_id", battleId).order("user_id, snapshot_date", { ascending: true });
  const streakMap = new Map<number, number>();
  if (allSnapshots) {
    const byUser = new Map<number, string[]>();
    for (const snap of allSnapshots) {
      const dates = byUser.get(snap.user_id) ?? [];
      if (snap.battle_points > 0) dates.push(snap.snapshot_date);
      byUser.set(snap.user_id, dates);
    }
    for (const [userId, dates] of byUser) {
      let streak = 0;
      const sorted = dates.sort();
      let prev: string | null = null;
      for (const date of sorted) {
        if (prev === null) { streak = 1; }
        else {
          const diff = Math.round((new Date(date).getTime() - new Date(prev).getTime()) / 86_400_000);
          streak = diff === 1 ? streak + 1 : 1;
        }
        prev = date;
      }
      streakMap.set(userId, streak);
    }
  }

  const newAchievements: { member_id: string; achievement_id: string; awarded_at: string; battle_id: string }[] = [];
  const newNotifications: { roblox_user_id: number; type: string; title: string; body: string; icon: string; created_at: string }[] = [];
  const reputationDeltas = new Map<string, number>();

  for (const contribution of contributions) {
    const memberId = memberByUserId.get(contribution.userId);
    if (!memberId) continue;
    const userStreak = streakMap.get(contribution.userId) ?? 0;
    const userTotalPoints = contribution.points;

    for (const def of achievementDefs) {
      if (def.criteria === "manual") continue;
      const key = `${memberId}:${def.id}`;
      if (existingSet.has(key)) continue;

      let earned = false;
      if (def.criteria === "battle_points > 0" && userTotalPoints > 0) earned = true;
      else if (def.criteria === "battle_points >= 1000" && userTotalPoints >= 1000) earned = true;
      else if (def.criteria === "battle_points >= 5000" && userTotalPoints >= 5000) earned = true;
      else if (def.criteria === "streak >= 3" && userStreak >= 3) earned = true;
      else if (def.criteria === "streak >= 7" && userStreak >= 7) earned = true;
      else if (def.criteria === "streak >= 14" && userStreak >= 14) earned = true;
      else if (def.criteria === "streak >= 30" && userStreak >= 30) earned = true;
      else if (def.criteria === "total_points >= 10000" && userTotalPoints >= 10000) earned = true;
      else if (def.criteria === "total_points >= 50000" && userTotalPoints >= 50000) earned = true;
      else if (def.criteria === "total_points >= 100000" && userTotalPoints >= 100000) earned = true;
      else if (def.criteria === "total_points >= 500000" && userTotalPoints >= 500000) earned = true;
      else if (def.criteria === "total_points >= 1000000" && userTotalPoints >= 1000000) earned = true;
      else if (def.criteria === "clan_rank <= 500" && officialPlace !== null && officialPlace <= 500) earned = true;
      else if (def.criteria === "clan_rank <= 250" && officialPlace !== null && officialPlace <= 250) earned = true;
      else if (def.criteria === "clan_rank <= 100" && officialPlace !== null && officialPlace <= 100) earned = true;
      else if (def.criteria === "clan_rank <= 50" && officialPlace !== null && officialPlace <= 50) earned = true;
      else if (def.criteria === "clan_rank <= 30" && officialPlace !== null && officialPlace <= 30) earned = true;
      else if (def.criteria === "clan_rank <= 10" && officialPlace !== null && officialPlace <= 10) earned = true;
      else if (def.criteria === "clan_rank <= 5" && officialPlace !== null && officialPlace <= 5) earned = true;

      if (earned) {
        newAchievements.push({ member_id: memberId, achievement_id: def.id, awarded_at: nowIso, battle_id: battleId });
        newNotifications.push({ roblox_user_id: contribution.userId, type: "achievement", title: `Achievement Unlocked: ${def.name}`, body: `You earned ${def.reputation_points} reputation points.`, icon: def.icon ?? "Trophy", created_at: nowIso });
        reputationDeltas.set(memberId, (reputationDeltas.get(memberId) ?? 0) + (def.reputation_points ?? 0));
      }
    }
  }

  if (newAchievements.length > 0) {
    await supabase.from("nanz_member_achievements").insert(newAchievements);
  }
  if (newNotifications.length > 0) {
    await supabase.from("nanz_notifications").insert(newNotifications);
  }

  // Update reputation totals
  for (const [memberId, delta] of reputationDeltas) {
    const member = members.find((item) => item.id === memberId);
    if (!member) continue;
    const { data: existing } = await supabase.from("nanz_member_reputation_totals").select("id, total_reputation").eq("member_id", memberId).maybeSingle();
    const newTotal = (existing?.total_reputation ?? 0) + delta;
    const level = reputationLevel(newTotal);
    if (existing) {
      await supabase.from("nanz_member_reputation_totals").update({ total_reputation: newTotal, reputation_level: level, last_calculated_at: nowIso }).eq("id", existing.id);
    } else {
      await supabase.from("nanz_member_reputation_totals").insert({ member_id: memberId, roblox_user_id: member.roblox_user_id, total_reputation: newTotal, reputation_level: level, last_calculated_at: nowIso });
    }
  }
}

function reputationLevel(total: number): string {
  if (total >= 5000) return "Mythic";
  if (total >= 2500) return "Legendary";
  if (total >= 1000) return "Epic";
  if (total >= 500) return "Rare";
  if (total >= 150) return "Uncommon";
  if (total >= 25) return "Common";
  return "Rookie";
}

async function main(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase service configuration is unavailable");
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const url = new URL(req.url);
  const requestedDepth = Number(url.searchParams.get("scanDepth") ?? defaultDepth);
  const scanDepth = [1000, 2000, 5000, 10000].includes(requestedDepth) ? requestedDepth : defaultDepth;
  const now = new Date();
  const nowIso = now.toISOString();
  const lockUntil = new Date(now.getTime() + lockDurationMs).toISOString();

  const { data: claimed, error: claimError } = await supabase.rpc("claim_nanz_sync_lock", { p_lock_until: lockUntil });
  if (claimError) throw new Error("Could not claim synchronization lock");
  if (!claimed) {
    return new Response(JSON.stringify({ status: "busy" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const { data: existingState } = await supabase.from("nanz_battle_scan_state").select("battle_id, battle_name, candidate_cursor, scan_depth").eq("id", true).maybeSingle();
    const state = existingState as ScanState | null;
    const activeBattle = await fetchJson("/api/activeClanBattle");
    const battleId = getBattleId(activeBattle);
    if (!battleId) throw new Error("Active battle response did not contain a battle identifier");
    const battleName = "⚔️ Nine Eyed Clan Battle";
    const timing = getBattleTiming(activeBattle);
    const placementRewards = getPlacementRewards(activeBattle);
    const battleChanged = state?.battle_id !== battleId;
    const cursor = battleChanged || state?.scan_depth !== scanDepth ? 0 : state?.candidate_cursor ?? 0;

    const candidatesPayload = await fetchJson(`/api/clans?page=1&pageSize=${scanDepth}&sort=Points&sortOrder=desc`);
    const candidates = getCandidates(candidatesPayload).slice(0, scanDepth);
    const nanzProfile = await fetchJson("/api/clan/NANZ");
    const contributions = getContributions(nanzProfile, battleId);
    const nanzPoints = contributions.reduce((total, item) => total + item.points, 0);
    const officialBattlePlace = readNumber(getBattleRecord(nanzProfile, battleId), ["Place", "place"]);
    const rosterIds = getRosterIds(nanzProfile);
    const rosterJoinTimes = getRosterJoinTimes(nanzProfile);
    const robloxUsers = await fetchRobloxUsers([...new Set([...rosterIds, ...contributions.map((item) => item.userId)])]);
    const memberRows = contributions.slice().sort((a, b) => b.points - a.points).map((item, index) => {
      const user = robloxUsers.get(item.userId);
      return {
        battle_id: battleId,
        user_id: item.userId,
        username: user?.name ?? null,
        display_name: user?.displayName ?? null,
        battle_points: item.points,
        rank: index + 1,
        captured_at: nowIso,
        data_source: "BIG_GAMES_LEGACY_API",
        sync_status: "verified",
      };
    });

    if (battleChanged) {
      await supabase.from("nanz_battle_rankings").delete().neq("battle_id", battleId);
      await supabase.from("nanz_battle_member_rankings").delete().neq("battle_id", battleId);
    }
    await supabase.from("nanz_battle_member_rankings").delete().eq("battle_id", battleId);
    if (memberRows.length > 0) await supabase.from("nanz_battle_member_rankings").insert(memberRows);

    // Sync nanz_members table with latest roster + contributor data
    const { data: ownerConfig } = await supabase.from("nanz_clan_config").select("owner_user_id, timezone").eq("id", true).maybeSingle();
    const ownerUserId = ownerConfig?.owner_user_id ?? null;
    const allUserIds = [...new Set([...rosterIds, ...contributions.map((item) => item.userId)])];
    const { data: existingMemberRows } = await supabase.from("nanz_members").select("roblox_user_id, clan_role, role_source, joined_clan_at").in("roblox_user_id", allUserIds.length > 0 ? allUserIds : [0]);
    const existingMembers = new Map((existingMemberRows ?? []).map((row) => [row.roblox_user_id as number, row]));
    const memberUpserts = allUserIds.map((uid) => {
      const user = robloxUsers.get(uid);
      const existing = existingMembers.get(uid);
      const role = uid === ownerUserId ? 'owner' : (existing?.clan_role ?? 'member');
      // Persist the real clan join date from Members[].JoinTime. Never overwrite
      // an already-stored date (rejoin timestamps only move forward; an admin
      // backfill must not be clobbered by a transient API blip).
      const joinSeconds = rosterJoinTimes.get(uid) ?? null;
      const joinedAt = existing?.joined_clan_at
        ? existing.joined_clan_at
        : joinSeconds
          ? new Date(joinSeconds * 1000).toISOString()
          : null;
      return {
        roblox_user_id: uid,
        roblox_username: user?.name ?? null,
        roblox_display_name: user?.displayName ?? null,
        clan_role: role,
        role_source: role === 'owner' ? 'seed' : (existing?.role_source ?? 'sync'),
        clan_status: 'active',
        ...(joinedAt ? { joined_clan_at: joinedAt } : {}),
        updated_at: nowIso,
      };
    });
    if (memberUpserts.length > 0) {
      await supabase.from("nanz_members").upsert(memberUpserts, { onConflict: "roblox_user_id", ignoreDuplicates: false });
    }

    // Store daily member snapshots for streak tracking
    const todayDate = now.toISOString().slice(0, 10);
    const dailySnapshotRows = contributions.map((item) => ({
      battle_id: battleId,
      user_id: item.userId,
      username: robloxUsers.get(item.userId)?.name ?? null,
      battle_points: item.points,
      snapshot_date: todayDate,
      captured_at: nowIso,
    }));
    if (dailySnapshotRows.length > 0) {
      await supabase.from("nanz_daily_member_snapshots").upsert(dailySnapshotRows, { onConflict: "battle_id,user_id,snapshot_date" });
    }

    const { data: latestSnapshot } = await supabase.from("nanz_battle_point_snapshots").select("battle_points, captured_at").eq("battle_id", battleId).eq("clan_name", "NANZ").order("captured_at", { ascending: false }).limit(1).maybeSingle();
    const snapshotAge = latestSnapshot?.captured_at ? now.getTime() - new Date(latestSnapshot.captured_at).getTime() : Number.POSITIVE_INFINITY;
    if (!latestSnapshot || latestSnapshot.battle_points !== nanzPoints || snapshotAge >= 300_000) {
      await supabase.from("nanz_battle_point_snapshots").insert({ battle_id: battleId, clan_name: "NANZ", battle_points: nanzPoints, captured_at: nowIso, data_source: "BIG_GAMES_LEGACY_API", sync_status: "verified" });
    }

    const batch = battleChanged ? candidates.slice(0, batchSize) : candidates.slice(cursor, cursor + batchSize);
    let successfulProfileRequests = 0;
    let failedProfileRequests = 0;
    await runConcurrent(batch, async (candidate) => {
      try {
        const profile = await fetchJson(`/api/clan/${encodeURIComponent(candidate.name)}`);
        const points = getContributions(profile, battleId).reduce((total, item) => total + item.points, 0);
        await supabase.from("nanz_battle_rankings").upsert({ battle_id: battleId, battle_name: battleName, clan_name: candidate.name, battle_points: points, scanned_at: nowIso, source: "BIG_GAMES_LEGACY_API", status: "verified", error_message: null }, { onConflict: "battle_id,clan_name" });
        successfulProfileRequests += 1;
      } catch (error) {
        failedProfileRequests += 1;
        await supabase.from("nanz_battle_rankings").upsert({ battle_id: battleId, battle_name: battleName, clan_name: candidate.name, battle_points: null, scanned_at: nowIso, source: "BIG_GAMES_LEGACY_API", status: "error", error_message: error instanceof Error ? error.message : "Clan profile fetch failed" }, { onConflict: "battle_id,clan_name" });
      }
    });

    const nextCursor = Math.min((battleChanged ? 0 : cursor) + batch.length, candidates.length);
    const { count: higherCount } = await supabase.from("nanz_battle_rankings").select("id", { count: "exact", head: true }).eq("battle_id", battleId).eq("status", "verified").gt("battle_points", nanzPoints);
    const { count: scannedCount } = await supabase.from("nanz_battle_rankings").select("id", { count: "exact", head: true }).eq("battle_id", battleId).eq("status", "verified");
    const complete = nextCursor >= candidates.length;
    const computedRank = (higherCount ?? 0) + 1;
    const coverage = candidates.length ? Number(((scannedCount ?? 0) / candidates.length * 100).toFixed(3)) : 0;

    // Evaluate automatic achievements after computedRank is available
    await evaluateAchievements(supabase, battleId, contributions, officialBattlePlace, computedRank, nowIso);

    const { data: previousSnapshots } = await supabase.from("nanz_battle_point_snapshots").select("battle_points, captured_at").eq("battle_id", battleId).eq("clan_name", "NANZ").order("captured_at", { ascending: false }).limit(2);
    let pointsPerHour: number | null = null;
    if (previousSnapshots && previousSnapshots.length >= 2) {
      const latest = previousSnapshots[0];
      const previous = previousSnapshots[1];
      const elapsedHours = (new Date(latest.captured_at).getTime() - new Date(previous.captured_at).getTime()) / 3_600_000;
      const gained = Number(latest.battle_points) - Number(previous.battle_points);
      if (elapsedHours > 0 && gained >= 0) pointsPerHour = Math.round(gained / elapsedHours);
    }

    await supabase.from("nanz_battle_rewards").delete().eq("battle_id", battleId);
    if (placementRewards.length > 0) {
      await supabase.from("nanz_battle_rewards").insert(placementRewards.map((reward) => ({ battle_id: battleId, ...reward, fetched_at: nowIso })));
    }

    await supabase.from("nanz_battle_scan_state").upsert({
      id: true,
      battle_id: battleId,
      battle_name: battleName,
      nanz_clan_name: "NANZ",
      nanz_battle_points: nanzPoints,
      rank_within_scanned_clans: computedRank,
      official_battle_place: officialBattlePlace,
      scanned_clan_count: scannedCount ?? 0,
      candidate_clan_count: candidates.length,
      scan_depth: scanDepth,
      candidate_cursor: nextCursor,
      scan_coverage: coverage,
      battle_start_time: timing.startTime ? new Date(timing.startTime * 1000).toISOString() : null,
      battle_finish_time: timing.finishTime ? new Date(timing.finishTime * 1000).toISOString() : null,
      member_count: rosterIds.length,
      active_contributor_count: contributions.filter((item) => item.points > 0).length,
      points_per_hour: pointsPerHour,
      last_successful_scan_at: nowIso,
      last_nanz_profile_fetch_at: nowIso,
      ranking_source: "BIG_GAMES_LEGACY_API",
      is_complete: complete,
      is_stale: false,
      api_status: "connected",
      successful_profile_requests: successfulProfileRequests,
      failed_profile_requests: failedProfileRequests,
      last_api_error: null,
      sync_lock_until: null,
      sync_completed_at: nowIso,
      next_sync_at: new Date(now.getTime() + syncIntervalMs).toISOString(),
      last_scan_error: null,
      updated_at: nowIso,
    });

    return new Response(JSON.stringify({ status: "ok", battleId, battleName, nanzBattlePoints: nanzPoints, computedRank, officialBattlePlace, scanCoverage: coverage, candidateCursor: nextCursor, memberCount: rosterIds.length, activeContributorCount: contributions.filter((item) => item.points > 0).length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live synchronization failed";
    await supabase.from("nanz_battle_scan_state").update({ sync_lock_until: null, is_stale: true, api_status: "error", last_api_error: message, last_scan_error: message, sync_completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", true);
    return new Response(JSON.stringify({ error: "Live synchronization failed" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}

Deno.serve(async (req) => {
  try {
    return await main(req);
  } catch {
    return new Response(JSON.stringify({ error: "Live synchronization failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
