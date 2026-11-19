import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type Contribution = { userId: number; points: number };
type DailySnapshot = { user_id: number; username: string | null; battle_points: number; snapshot_date: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function main(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase service configuration is unavailable");
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const nowIso = new Date().toISOString();

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "calculate";
  const period = url.searchParams.get("period") ?? "week";

  try {
    const { data: scanState } = await supabase.from("nanz_battle_scan_state").select("battle_id, battle_name, battle_finish_time, official_battle_place").eq("id", true).maybeSingle();
    const state = scanState as { battle_id: string | null; battle_name: string | null; battle_finish_time: string | null; official_battle_place: number | null } | null;
    if (!state?.battle_id) {
      return new Response(JSON.stringify({ status: "no_battle" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const battleId = state.battle_id;

    const { data: awardDefs } = await supabase.from("nanz_award_definitions").select("id, slug, name, icon, tier").eq("is_active", true);
    if (!awardDefs || awardDefs.length === 0) {
      return new Response(JSON.stringify({ status: "no_award_definitions" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: memberRows } = await supabase.from("nanz_battle_member_rankings").select("user_id, username, battle_points, rank").eq("battle_id", battleId).order("battle_points", { ascending: false });
    const members = (memberRows ?? []) as { user_id: number; username: string | null; battle_points: number; rank: number | null }[];
    if (members.length === 0) {
      return new Response(JSON.stringify({ status: "no_members" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: nanzMembers } = await supabase.from("nanz_members").select("id, roblox_user_id").in("roblox_user_id", members.map((m) => m.user_id));
    const memberByRobloxId = new Map<number, string>();
    for (const m of (nanzMembers ?? [])) memberByRobloxId.set(m.roblox_user_id, m.id);

    const { data: existingWinners } = await supabase.from("nanz_award_winners").select("award_id, period_label, member_id");
    const existingSet = new Set<string>();
    for (const w of (existingWinners ?? [])) existingSet.add(`${w.award_id}:${w.period_label}:${w.member_id}`);

    const periodLabel = period === "week" ? getWeekLabel() : period === "month" ? getMonthLabel() : battleId;
    const newWinners: { award_id: string; member_id: string; battle_id: string; period_label: string; awarded_at: string; notes: string }[] = [];
    const newNotifications: { roblox_user_id: number; type: string; title: string; body: string; icon: string; created_at: string }[] = [];

    const awardBySlug = new Map(awardDefs.map((a) => [a.slug, a]));

    function tryAward(slug: string, winner: { user_id: number; username: string | null; battle_points: number }, notes: string) {
      const def = awardBySlug.get(slug);
      if (!def) return;
      const memberId = memberByRobloxId.get(winner.user_id);
      if (!memberId) return;
      const key = `${def.id}:${periodLabel}:${memberId}`;
      if (existingSet.has(key)) return;
      newWinners.push({ award_id: def.id, member_id: memberId, battle_id: battleId, period_label: periodLabel, awarded_at: nowIso, notes });
      newNotifications.push({ roblox_user_id: winner.user_id, type: "award", title: `Award: ${def.name}`, body: notes, icon: def.icon ?? "Trophy", created_at: nowIso });
      existingSet.add(key);
    }

    if (action === "calculate") {
      // Player of the Week / Month / Top Contributor — highest contribution
      if (members.length > 0) {
        const top = members[0];
        const slug = period === "month" ? "player_of_the_month" : "player_of_the_week";
        tryAward(slug, top, `Highest verified contribution: ${top.battle_points.toLocaleString()} battle points`);
        tryAward("top_contributor", top, `Top contributor for ${periodLabel}: ${top.battle_points.toLocaleString()} points`);
      }

      // Battle MVP — best battle performance (highest points, only if battle has enough data)
      if (members.length >= 3) {
        const mvp = members[0];
        tryAward("battle_mvp", mvp, `Best verified battle performance: ${mvp.battle_points.toLocaleString()} points`);
      }

      // Most Consistent Player — from daily snapshots
      const { data: dailySnaps } = await supabase.from("nanz_daily_member_snapshots").select("user_id, username, battle_points, snapshot_date").eq("battle_id", battleId).order("user_id, snapshot_date", { ascending: true });
      if (dailySnaps && dailySnaps.length >= 3) {
        const consistency = calculateConsistency(dailySnaps as DailySnapshot[]);
        if (consistency.winner) {
          tryAward("most_consistent_player", consistency.winner, consistency.reason);
        }
      }

      // Most Improved Player — compare first half vs second half of snapshots
      if (dailySnaps && dailySnaps.length >= 4) {
        const improved = calculateMostImproved(dailySnaps as DailySnapshot[]);
        if (improved.winner) {
          tryAward("most_improved_player", improved.winner, improved.reason);
        }
      }
    }

    if (newWinners.length > 0) {
      await supabase.from("nanz_award_winners").insert(newWinners);
    }
    if (newNotifications.length > 0) {
      await supabase.from("nanz_notifications").insert(newNotifications);
    }

    // Update module status
    await supabase.from("nanz_module_status").update({ is_active: true, last_successful_update: nowIso, integration_status: "connected", last_error: null, updated_at: nowIso }).eq("id", "nanz_awards");

    return new Response(JSON.stringify({ status: "ok", awardsCalculated: newWinners.length, period: periodLabel }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Award calculation failed";
    await supabase.from("nanz_module_status").update({ integration_status: "error", last_error: message, updated_at: nowIso }).eq("id", "nanz_awards");
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}

function getWeekLabel(): string {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const week = Math.ceil(((now.getTime() - start.getTime()) / 86_400_000 + start.getDay() + 1) / 7);
  return `${year}-W${week}`;
}

function getMonthLabel(): string {
  return new Date().toISOString().slice(0, 7);
}

function calculateConsistency(snapshots: DailySnapshot[]): { winner: { user_id: number; username: string | null; battle_points: number } | null; reason: string } {
  const byUser = new Map<number, DailySnapshot[]>();
  for (const snap of snapshots) {
    const list = byUser.get(snap.user_id) ?? [];
    list.push(snap);
    byUser.set(snap.user_id, list);
  }
  let bestUserId: number | null = null;
  let bestScore = -1;
  let bestSnap: DailySnapshot | null = null;
  for (const [userId, snaps] of byUser) {
    if (snaps.length < 2) continue;
    const contributingDays = snaps.filter((s) => s.battle_points > 0).length;
    const score = contributingDays / snaps.length;
    if (score > bestScore) {
      bestScore = score;
      bestUserId = userId;
      bestSnap = snaps[snaps.length - 1];
    }
  }
  if (bestUserId === null || !bestSnap) return { winner: null, reason: "" };
  return { winner: { user_id: bestUserId, username: bestSnap.username, battle_points: bestSnap.battle_points }, reason: `Consistency rate: ${Math.round(bestScore * 100)}% contributing days` };
}

function calculateMostImproved(snapshots: DailySnapshot[]): { winner: { user_id: number; username: string | null; battle_points: number } | null; reason: string } {
  const byUser = new Map<number, DailySnapshot[]>();
  for (const snap of snapshots) {
    const list = byUser.get(snap.user_id) ?? [];
    list.push(snap);
    byUser.set(snap.user_id, list);
  }
  let bestUserId: number | null = null;
  let bestImprovement = 0;
  let bestSnap: DailySnapshot | null = null;
  for (const [userId, snaps] of byUser) {
    if (snaps.length < 4) continue;
    const midPoint = Math.floor(snaps.length / 2);
    const firstHalfAvg = snaps.slice(0, midPoint).reduce((sum, s) => sum + s.battle_points, 0) / midPoint;
    const secondHalfAvg = snaps.slice(midPoint).reduce((sum, s) => sum + s.battle_points, 0) / (snaps.length - midPoint);
    const improvement = secondHalfAvg - firstHalfAvg;
    if (improvement > bestImprovement) {
      bestImprovement = improvement;
      bestUserId = userId;
      bestSnap = snaps[snaps.length - 1];
    }
  }
  if (bestUserId === null || !bestSnap || bestImprovement <= 0) return { winner: null, reason: "" };
  return { winner: { user_id: bestUserId, username: bestSnap.username, battle_points: bestSnap.battle_points }, reason: `Improvement of +${Math.round(bestImprovement).toLocaleString()} avg daily points` };
}

Deno.serve(async (req) => {
  try {
    return await main(req);
  } catch {
    return new Response(JSON.stringify({ error: "Award calculation failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
