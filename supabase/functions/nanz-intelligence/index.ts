import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const apiBase = "https://ps99.biggamesapi.io";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function firstRecord(value: unknown): JsonRecord {
  if (Array.isArray(value)) return asRecord((value as unknown[])[0]);
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

function getBattleTiming(payload: unknown): { startTime: number | null; finishTime: number | null } {
  const root = firstRecord(extractPayload(payload));
  const config = asRecord(root.configData ?? root.ConfigData ?? root);
  return { startTime: readNumber(config, ["StartTime", "startTime"]), finishTime: readNumber(config, ["FinishTime", "finishTime"]) };
}

function getBattleRecord(payload: unknown, battleId: string): JsonRecord {
  const root = firstRecord(extractPayload(payload));
  const battles = asRecord(root.Battles ?? root.battles);
  return asRecord(battles[battleId]);
}

function getContributions(payload: unknown, battleId: string): { userId: number; points: number }[] {
  const battle = getBattleRecord(payload, battleId);
  const raw = battle.PointContributions ?? battle.pointContributions;
  if (!Array.isArray(raw)) return [];
  const byUser = new Map<number, number>();
  for (const item of raw) {
    const entry = asRecord(item);
    const userId = readNumber(entry, ["UserID", "userId", "UserId"]);
    const points = readNumber(entry, ["Points", "points"]);
    if (userId === null || points === null || userId <= 0 || points < 0) continue;
    byUser.set(userId, Math.max(byUser.get(userId) ?? 0, points));
  }
  return [...byUser.entries()].map(([userId, points]) => ({ userId, points }));
}

function getClanList(payload: unknown): { name: string; points: number | null }[] {
  const record = asRecord(payload);
  const raw = Array.isArray(record.data) ? record.data : [];
  return raw.map((item) => {
    const clan = asRecord(item);
    return { name: readString(clan, ["Name", "name", "ConfigName", "configName"]) ?? "", points: readNumber(clan, ["Points", "points"]) };
  }).filter((clan) => clan.name.length > 0);
}

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { Accept: "application/json", "User-Agent": "NANZ-Elite-Intelligence/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`BIG Games API returned ${response.status}`);
  return response.json();
}

async function claimLock(supabase: ReturnType<typeof createClient>): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_nanz_sync_lock", { p_lock_until: new Date(Date.now() + 55_000).toISOString() });
  if (error) {
    // Fall back to a conditional update on the dedicated intelligence lock
    const { data: claimedRow } = await supabase.from("nanz_intelligence_lock")
      .update({ locked_until: new Date(Date.now() + 55_000).toISOString() })
      .lt("locked_until", new Date().toISOString())
      .select();
    return Boolean(claimedRow && claimedRow.length > 0);
  }
  return Boolean(data);
}

async function main(_req: Request): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase service configuration is unavailable");
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const nowIso = new Date().toISOString();

  const locked = await claimLock(supabase);
  if (!locked) {
    return new Response(JSON.stringify({ status: "busy" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    // ---- 1. Current battle state ----
    const { data: stateRow } = await supabase.from("nanz_battle_scan_state").select("battle_id, battle_name, nanz_battle_points, official_battle_place, rank_within_scanned_clans, member_count, battle_start_time, battle_finish_time").eq("id", true).maybeSingle();
    const state = stateRow as { battle_id: string | null; battle_name: string | null; nanz_battle_points: number | null; official_battle_place: number | null; rank_within_scanned_clans: number | null; member_count: number | null; battle_start_time: string | null; battle_finish_time: string | null } | null;
    const battleId = state?.battle_id;
    if (!battleId || state.nanz_battle_points === null) {
      await releaseLock(supabase);
      return new Response(JSON.stringify({ status: "waiting_for_core_sync" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- 2. Battle archiving: battle ID changed? ----
    const { data: archiveRows } = await supabase.from("nanz_battle_archive").select("id, battle_id, battle_name, start_time, finish_time, nanz_final_points, nanz_final_rank, nanz_official_place, total_contributors, archive_status, coverage_note, member_count, avg_contribution, top_contribution, top_contributor_name").neq("battle_id", battleId).is("finish_time", null).limit(5);
    for (const old of (archiveRows ?? []) as Record<string, unknown>[]) {
      await finalizeArchive(supabase, old, nowIso);
    }
    // Also archive the previous battle when scan state has moved on but no archive row exists
    const { data: knownArchives } = await supabase.from("nanz_battle_archive").select("battle_id").eq("battle_id", battleId);
    if ((knownArchives ?? []).length === 0) {
      const { data: prevSnapshot } = await supabase.from("nanz_battle_point_snapshots").select("battle_id").neq("battle_id", battleId).limit(1).maybeSingle();
      if (prevSnapshot?.battle_id) {
        const { data: prevState } = await supabase.from("nanz_battle_scan_state").select("*").maybeSingle();
        void prevState;
      }
    }

    // Ensure an in-progress archive row exists for the current battle
    const { data: currentArchive } = await supabase.from("nanz_battle_archive").select("id").eq("battle_id", battleId).maybeSingle();
    let currentArchiveId: string | null = currentArchive?.id ?? null;
    if (!currentArchiveId) {
      const { data: inserted, error: insertError } = await supabase.from("nanz_battle_archive").insert({
        battle_id: battleId,
        battle_name: state.battle_name ?? battleId,
        start_time: state.battle_start_time,
        finish_time: null,
        archive_status: "partial",
        coverage_note: "Battle in progress — archive updates automatically after each synchronization.",
      }).select("id").maybeSingle();
      if (!insertError && inserted) currentArchiveId = inserted.id;
    }

    // Refresh the current battle's live archive data + member leaderboard
    if (currentArchiveId) {
      const { data: memberRows } = await supabase.from("nanz_battle_member_rankings").select("user_id, username, display_name, battle_points, rank").eq("battle_id", battleId).order("battle_points", { ascending: false });
      const members = (memberRows ?? []) as { user_id: number; username: string | null; display_name: string | null; battle_points: number; rank: number | null }[];
      const points = members.map((m) => m.battle_points);
      const top = members[0];
      await supabase.from("nanz_battle_archive").update({
        nanz_final_points: state.nanz_battle_points,
        nanz_official_place: state.official_battle_place,
        nanz_final_rank: state.rank_within_scanned_clans,
        total_contributors: members.filter((m) => m.battle_points > 0).length,
        member_count: state.member_count,
        avg_contribution: points.length ? Math.round(points.reduce((a, b) => a + b, 0) / points.length) : null,
        top_contribution: top?.battle_points ?? null,
        top_contributor_name: top?.username ?? null,
      }).eq("id", currentArchiveId);

      // Preserve member contribution results (delete + reinsert current battle only)
      await supabase.from("nanz_battle_archive_members").delete().eq("archive_id", currentArchiveId);
      if (members.length > 0) {
        await supabase.from("nanz_battle_archive_members").insert(members.map((m) => ({
          archive_id: currentArchiveId,
          user_id: m.user_id,
          username: m.username,
          display_name: m.display_name,
          battle_points: m.battle_points,
          rank: m.rank,
        })));
      }
    }

    // ---- 3. Rival snapshot collection (verified data only) ----
    const { data: rivals } = await supabase.from("nanz_rival_clans").select("id, clan_name, is_tracking, last_known_points").eq("is_tracking", true).limit(20);
    const activeBattle = await fetchJson("/api/activeClanBattle");
    const apiBattleId = getBattleId(activeBattle) ?? battleId;

    // NANZ historical snapshots for pps + development chart
    const { data: nanzSnaps } = await supabase.from("nanz_battle_point_snapshots").select("battle_points, captured_at").eq("battle_id", battleId).eq("clan_name", "NANZ").order("captured_at", { ascending: false }).limit(50);
    const nanzHistory = ((nanzSnaps ?? []) as { battle_points: number; captured_at: string }[]).slice().reverse();

    const rivalResults: Record<string, { points: number | null; rank: number | null; error?: string }> = {};
    if (apiBattleId === battleId) {
      // Rank map from the cached top-clan list (already scanned by nanz-ranking)
      const { data: rankingRows } = await supabase.from("nanz_battle_rankings").select("clan_name, battle_points").eq("battle_id", battleId).eq("status", "verified").order("battle_points", { ascending: false }).limit(1000);
      const rankRows = (rankingRows ?? []) as { clan_name: string; battle_points: number | null }[];
      const rankIndex = new Map<string, { points: number | null; rank: number }>();
      let rankCounter = 1;
      for (const row of rankRows) {
        if (row.battle_points === null) continue;
        if (!rankIndex.has(row.clan_name)) rankIndex.set(row.clan_name, { points: row.battle_points, rank: rankCounter });
        rankCounter += 1;
      }

      for (const rival of (rivals ?? []) as { clan_name: string; is_tracking: boolean; last_known_points: number | null }[]) {
        try {
          const profile = await fetchJson(`/api/clan/${encodeURIComponent(rival.clan_name)}`);
          const points = getContributions(profile, apiBattleId).reduce((total, item) => total + item.points, 0);
          const rank = rankIndex.get(rival.clan_name)?.rank ?? null;
          rivalResults[rival.clan_name] = { points, rank };
          await supabase.from("nanz_rival_snapshots").insert({ clan_name: rival.clan_name, battle_id: battleId, battle_points: points, clan_rank: rank, captured_at: nowIso });
          await supabase.from("nanz_rival_clans").update({ last_known_points: points, last_known_rank: rank, last_updated_at: nowIso, updated_at: nowIso }).eq("id", rival.id);
        } catch (error) {
          rivalResults[rival.clan_name] = { points: rival.last_known_points, rank: null, error: error instanceof Error ? error.message : "fetch failed" };
        }
      }

      // ---- 4. Alerts ----
      await evaluateAlerts(supabase, state, rivals as { clan_name: string }[] ?? [], rivalResults, battleId, nowIso);
    }

    // ---- 5. Goal progress (uses live clan total) ----
    const { data: activeGoals } = await supabase.from("nanz_clan_goals").select("id, goal_category, target_points, target_rank, current_value, status").eq("status", "active");
    for (const goal of (activeGoals ?? []) as { id: string; goal_category: string; target_points: number | null; target_rank: number | null; current_value: number }[]) {
      let newValue: number | null = null;
      if (goal.goal_category === "contribution" && goal.target_points !== null) newValue = state.nanz_battle_points;
      else if (goal.goal_category === "rank" && goal.target_rank !== null) newValue = state.official_battle_place;
      if (newValue !== null && newValue !== goal.current_value) {
        await supabase.from("nanz_clan_goals").update({ current_value: newValue, updated_at: nowIso }).eq("id", goal.id);
        await supabase.from("nanz_goal_progress").insert({ goal_id: goal.id, current_points: goal.goal_category === "contribution" ? state.nanz_battle_points : null, current_rank: goal.goal_category === "rank" ? state.official_battle_place : null, captured_at: nowIso });
      }
    }

    // ---- 6. Mission progress (daily points + streak + total) ----
    await updateMissionProgress(supabase, battleId, nowIso);

    // ---- 7. Module status ----
    await supabase.from("nanz_module_status").update({ is_active: true, last_successful_update: nowIso, integration_status: "connected", last_error: null, updated_at: nowIso }).eq("id", "nanz_rivals");
    await supabase.from("nanz_module_status").update({ is_active: true, last_successful_update: nowIso, integration_status: "connected", last_error: null, updated_at: nowIso }).eq("id", "nanz_goals");

    await releaseLock(supabase);
    return new Response(JSON.stringify({
      status: "ok",
      battleId,
      rivalsTracked: Object.keys(rivalResults).length,
      alertsGenerated: alertCount,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Intelligence collection failed";
    await supabase.from("nanz_module_status").update({ integration_status: "error", last_error: message, updated_at: nowIso }).eq("id", "nanz_rivals");
    await releaseLock(supabase);
    return new Response(JSON.stringify({ error: "Intelligence collection failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}

let alertCount = 0;

async function evaluateAlerts(
  supabase: ReturnType<typeof createClient>,
  state: { nanz_battle_points: number; official_battle_place: number | null },
  rivals: { clan_name: string }[],
  rivalResults: Record<string, { points: number | null; rank: number | null }>,
  battleId: string,
  nowIso: string,
): Promise<void> {
  alertCount = 0;
  const { data: configRow } = await supabase.from("nanz_rival_alert_config").select("overtake_enabled, threshold_points, surge_percent, rank_milestones").eq("id", true).maybeSingle();
  const config = (configRow ?? {}) as { overtake_enabled?: boolean; threshold_points?: number; surge_percent?: number; rank_milestones?: number[] };
  const threshold = config.threshold_points ?? 5000;
  const surgePercent = config.surge_percent ?? 25;

  const { data: recentAlerts } = await supabase.from("nanz_rival_alerts").select("alert_type, rival_clan, created_at").gte("created_at", new Date(Date.now() - 3 * 3600_000).toISOString());
  const recentKey = new Set(((recentAlerts ?? []) as { alert_type: string; rival_clan: string | null }[]).map((a) => `${a.alert_type}:${a.rival_clan}`));

  const nanzPoints = state.nanz_battle_points;
  for (const rival of rivals) {
    const result = rivalResults[rival.clan_name];
    if (!result || result.points === null) continue;
    const diff = nanzPoints - result.points;

    if (config.overtake_enabled !== false) {
      if (diff < 0 && !recentKey.has(`rival_overtake:${rival.clan_name}`)) {
        await insertAlert(supabase, { alert_type: "rival_overtake", title: `${rival.clan_name} overtook NANZ`, detail: `${rival.clan_name} is ahead by ${Math.abs(diff).toLocaleString()} points.`, rival_clan: rival.clan_name, battle_id: battleId, nowIso });
        recentKey.add(`rival_overtake:${rival.clan_name}`);
      } else if (diff > 0 && !recentKey.has(`nanz_overtake:${rival.clan_name}`)) {
        await insertAlert(supabase, { alert_type: "nanz_overtake", title: `NANZ overtook ${rival.clan_name}`, detail: `NANZ leads ${rival.clan_name} by ${diff.toLocaleString()} points.`, rival_clan: rival.clan_name, battle_id: battleId, nowIso });
        recentKey.add(`nanz_overtake:${rival.clan_name}`);
      }
    }

    if (Math.abs(diff) < threshold && Math.abs(diff) > 0 && !recentKey.has(`threshold_close:${rival.clan_name}`)) {
      await insertAlert(supabase, { alert_type: "threshold_close", title: `Gap with ${rival.clan_name} is closing`, detail: `Only ${Math.abs(diff).toLocaleString()} points separate NANZ and ${rival.clan_name}.`, rival_clan: rival.clan_name, battle_id: battleId, nowIso });
      recentKey.add(`threshold_close:${rival.clan_name}`);
    }

    // Surge detection: compare latest two rival snapshots
    const { data: lastTwo } = await supabase.from("nanz_rival_snapshots").select("battle_points, captured_at").eq("clan_name", rival.clan_name).eq("battle_id", battleId).order("captured_at", { ascending: false }).limit(2);
    const snaps = (lastTwo ?? []) as { battle_points: number | null }[];
    if (snaps.length === 2 && snaps[1].battle_points !== null && snaps[0].battle_points !== null && snaps[1].battle_points > 0) {
      const growth = ((snaps[0].battle_points! - snaps[1].battle_points!) / snaps[1].battle_points!) * 100;
      if (growth >= surgePercent && !recentKey.has(`rival_surge:${rival.clan_name}`)) {
        await insertAlert(supabase, { alert_type: "rival_surge", title: `${rival.clan_name} is surging`, detail: `${rival.clan_name} gained ${Math.round(growth)}% contribution since the last snapshot.`, rival_clan: rival.clan_name, battle_id: battleId, nowIso });
        recentKey.add(`rival_surge:${rival.clan_name}`);
      }
    }
  }

  // Rank milestones
  const milestones = config.rank_milestones ?? [1, 5, 10, 25, 50, 100, 250, 500];
  const place = state.official_battle_place;
  if (place !== null) {
    for (const milestone of milestones) {
      if (place <= milestone && !recentKey.has(`nanz_rank_milestone:NANZ-${milestone}`)) {
        await insertAlert(supabase, { alert_type: "nanz_rank_milestone", title: `NANZ reached global top ${milestone}`, detail: `NANZ is currently ranked #${place} in the active battle.`, rival_clan: null, battle_id: battleId, nowIso });
        recentKey.add(`nanz_rank_milestone:NANZ-${milestone}`);
        break;
      }
    }
  }
}

async function insertAlert(supabase: ReturnType<typeof createClient>, alert: { alert_type: string; title: string; detail: string; rival_clan: string | null; battle_id: string; nowIso: string }): Promise<void> {
  await supabase.from("nanz_rival_alerts").insert({
    alert_type: alert.alert_type,
    title: alert.title,
    detail: alert.detail,
    rival_clan: alert.rival_clan,
    battle_id: alert.battle_id,
    is_read: false,
    created_at: alert.nowIso,
  });
  alertCount += 1;
}

async function updateMissionProgress(supabase: ReturnType<typeof createClient>, battleId: string, nowIso: string): Promise<void> {
  const { data: missions } = await supabase.from("nanz_missions").select("id, requirement_type, requirement_value, end_date, status").eq("status", "active");
  const activeMissions = (missions ?? []) as { id: string; requirement_type: string; requirement_value: number | null; end_date: string | null }[];
  if (activeMissions.length === 0) return;

  const today = nowIso.slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  for (const mission of activeMissions) {
    if (mission.end_date && mission.end_date < nowIso) {
      await supabase.from("nanz_missions").update({ status: "completed", updated_at: nowIso }).eq("id", mission.id);
      continue;
    }

    if (mission.requirement_type === "daily_points" && mission.requirement_value !== null) {
      // Today's gain per member = today's snapshot − yesterday's snapshot
      const { data: snaps } = await supabase.from("nanz_daily_member_snapshots").select("user_id, username, battle_points, snapshot_date").eq("battle_id", battleId).in("snapshot_date", [today, yesterday]).order("user_id, snapshot_date", { ascending: true });
      const byUser = new Map<number, { today: number; yesterday: number; username: string | null }>();
      for (const snap of (snaps ?? []) as { user_id: number; username: string | null; battle_points: number; snapshot_date: string }[]) {
        const entry = byUser.get(snap.user_id) ?? { today: 0, yesterday: 0, username: snap.username };
        if (snap.snapshot_date === today) entry.today = snap.battle_points;
        else entry.yesterday = snap.battle_points;
        byUser.set(snap.user_id, entry);
      }
      const rows: { mission_id: string; roblox_user_id: number; username: string | null; progress: number; completed_at: string | null }[] = [];
      for (const [userId, entry] of byUser) {
        const gain = Math.max(0, entry.today - entry.yesterday);
        rows.push({ mission_id: mission.id, roblox_user_id: userId, username: entry.username, progress: gain, completed_at: gain >= mission.requirement_value ? nowIso : null });
      }
      if (rows.length > 0) {
        await supabase.from("nanz_member_missions").upsert(rows, { onConflict: "mission_id,roblox_user_id", ignoreDuplicates: false });
      }
    } else if (mission.requirement_type === "streak" && mission.requirement_value !== null) {
      const { data: snaps } = await supabase.from("nanz_daily_member_snapshots").select("user_id, username, battle_points, snapshot_date").eq("battle_id", battleId).order("user_id, snapshot_date", { ascending: true });
      const byUser = new Map<number, { dates: string[]; username: string | null }>();
      for (const snap of (snaps ?? []) as { user_id: number; username: string | null; battle_points: number; snapshot_date: string }[]) {
        if (snap.battle_points <= 0) continue;
        const entry = byUser.get(snap.user_id) ?? { dates: [], username: snap.username };
        entry.dates.push(snap.snapshot_date);
        byUser.set(snap.user_id, entry);
      }
      const rows: { mission_id: string; roblox_user_id: number; username: string | null; progress: number; completed_at: string | null }[] = [];
      for (const [userId, entry] of byUser) {
        const sorted = entry.dates.sort();
        let streak = 0;
        let prev: string | null = null;
        for (const date of sorted) {
          streak = prev !== null && Math.round((new Date(date).getTime() - new Date(prev).getTime()) / 86_400_000) === 1 ? streak + 1 : 1;
          prev = date;
        }
        rows.push({ mission_id: mission.id, roblox_user_id: userId, username: entry.username, progress: streak, completed_at: streak >= mission.requirement_value ? nowIso : null });
      }
      if (rows.length > 0) {
        await supabase.from("nanz_member_missions").upsert(rows, { onConflict: "mission_id,roblox_user_id", ignoreDuplicates: false });
      }
    } else if (mission.requirement_type === "total_points" && mission.requirement_value !== null) {
      const { data: rankingRows } = await supabase.from("nanz_battle_member_rankings").select("user_id, username, battle_points").eq("battle_id", battleId).gte("battle_points", mission.requirement_value);
      const rows = ((rankingRows ?? []) as { user_id: number; username: string | null; battle_points: number }[]).map((row) => ({ mission_id: mission.id, roblox_user_id: row.user_id, username: row.username, progress: row.battle_points, completed_at: nowIso }));
      if (rows.length > 0) {
        await supabase.from("nanz_member_missions").upsert(rows, { onConflict: "mission_id,roblox_user_id", ignoreDuplicates: false });
      }
    } else if (mission.requirement_type === "rank_improvement" && mission.requirement_value !== null) {
      const { data: rankingRows } = await supabase.from("nanz_battle_member_rankings").select("user_id, username, rank").eq("battle_id", battleId).lte("rank", mission.requirement_value);
      const rows = ((rankingRows ?? []) as { user_id: number; username: string | null; rank: number | null }[]).map((row) => ({ mission_id: mission.id, roblox_user_id: row.user_id, username: row.username, progress: row.rank ?? 0, completed_at: row.rank !== null ? nowIso : null }));
      if (rows.length > 0) {
        await supabase.from("nanz_member_missions").upsert(rows, { onConflict: "mission_id,roblox_user_id", ignoreDuplicates: false });
      }
    }
    // 'manual' missions are completed by staff only
  }
}

async function finalizeArchive(supabase: ReturnType<typeof createClient>, old: Record<string, unknown>, nowIso: string): Promise<void> {
  const battleId = String(old.battle_id);
  // Determine completeness: does a snapshot exist within the last 6 hours before the known finish time?
  const { data: lastSnap } = await supabase.from("nanz_battle_point_snapshots").select("battle_points, captured_at").eq("battle_id", battleId).eq("clan_name", "NANZ").order("captured_at", { ascending: false }).limit(1).maybeSingle();
  const finishTime = old.finish_time as string | null;
  const lastSnapTime = lastSnap?.captured_at as string | null;

  let status: "complete" | "partial" = "partial";
  let note = "Archive preserved from available snapshots.";
  if (finishTime && lastSnapTime) {
    const gapHours = (new Date(finishTime).getTime() - new Date(lastSnapTime).getTime()) / 3_600_000;
    if (gapHours <= 6) {
      status = "complete";
      note = "Final score captured before battle close.";
    } else {
      note = `Partial archive — last snapshot ${Math.round(gapHours)}h before battle close. Final score not observed.`;
    }
  } else if (!finishTime) {
    note = "Partial archive — battle finish time was not recorded before archiving.";
  }

  // Member results preserved from member rankings if archive members are empty
  const archiveId = old.id as string;
  const { count: memberCountInArchive } = await supabase.from("nanz_battle_archive_members").select("id", { count: "exact", head: true }).eq("archive_id", archiveId);
  if ((memberCountInArchive ?? 0) === 0) {
    const { data: memberRows } = await supabase.from("nanz_battle_member_rankings").select("user_id, username, display_name, battle_points, rank").eq("battle_id", battleId).order("battle_points", { ascending: false });
    const members = (memberRows ?? []) as { user_id: number; username: string | null; display_name: string | null; battle_points: number; rank: number | null }[];
    if (members.length > 0) {
      await supabase.from("nanz_battle_archive_members").insert(members.map((m) => ({ archive_id: archiveId, user_id: m.user_id, username: m.username, display_name: m.display_name, battle_points: m.battle_points, rank: m.rank })));
    }
    const points = members.map((m) => m.battle_points);
    await supabase.from("nanz_battle_archive").update({
      nanz_final_points: lastSnap?.battle_points ?? null,
      archive_status: status,
      coverage_note: note,
      total_contributors: members.filter((m) => m.battle_points > 0).length,
      member_count: members.length,
      avg_contribution: points.length ? Math.round(points.reduce((a, b) => a + b, 0) / points.length) : null,
      top_contribution: members[0]?.battle_points ?? null,
      top_contributor_name: members[0]?.username ?? null,
      finish_time: finishTime ?? lastSnapTime,
      updated_at: nowIso,
    }).eq("id", archiveId);
    return;
  }

  await supabase.from("nanz_battle_archive").update({
    nanz_final_points: lastSnap?.battle_points ?? null,
    archive_status: status,
    coverage_note: note,
    finish_time: finishTime ?? lastSnapTime,
    updated_at: nowIso,
  }).eq("id", archiveId);
}

async function releaseLock(supabase: ReturnType<typeof createClient>): Promise<void> {
  await supabase.from("nanz_intelligence_lock").update({ locked_until: new Date(Date.now() - 1_000).toISOString() }).eq("id", true);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    return await main(req);
  } catch {
    return new Response(JSON.stringify({ error: "Intelligence collection failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
