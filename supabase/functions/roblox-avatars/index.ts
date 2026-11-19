import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type AvatarEntry = {
  username: string;
  roblox_user_id: number | null;
  avatar_url: string | null;
  display_name: string | null;
  status: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRobloxJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": "NANZ-Elite-Avatar-Sync/1.0",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Roblox API returned ${response.status}`);
  return response.json();
}

async function resolveUserIds(usernames: string[]): Promise<Map<string, { id: number; displayName: string }>> {
  const result = new Map<string, { id: number; displayName: string }>();
  const payload = await fetchRobloxJson("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: usernames, excludeBannedUsers: false }),
  } as RequestInit);

  const record = asRecord(payload);
  const data = Array.isArray(record.data) ? record.data : [];
  for (const item of data) {
    const user = asRecord(item);
    const name = typeof user.name === "string" ? user.name : "";
    const id = typeof user.id === "number" ? user.id : Number(user.id);
    const displayName = typeof user.displayName === "string" ? user.displayName : name;
    if (name && Number.isFinite(id)) {
      result.set(name.toLowerCase(), { id, displayName });
    }
  }
  return result;
}

async function resolveAvatarUrls(userIds: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (userIds.length === 0) return result;

  const batchSize = 50;
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);
    const params = new URLSearchParams();
    for (const id of batch) params.append("userIds", String(id));
    params.append("size", "150x150");
    params.append("format", "Png");
    params.append("isCircular", "false");

    const payload = await fetchRobloxJson(`https://thumbnails.roblox.com/v1/users/avatar-headshot?${params}`);
    const record = asRecord(payload);
    const data = Array.isArray(record.data) ? record.data : [];
    for (const item of data) {
      const thumb = asRecord(item);
      const id = typeof thumb.targetId === "number" ? thumb.targetId : Number(thumb.targetId);
      const url = typeof thumb.imageUrl === "string" ? thumb.imageUrl : null;
      if (Number.isFinite(id) && url) result.set(id, url);
    }
    if (i + batchSize < userIds.length) await sleep(400);
  }
  return result;
}

async function main(req: Request): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase service configuration is unavailable");
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const url = new URL(req.url);
  const queryParam = url.searchParams.get("usernames");
  const usernamesParam = queryParam ?? "";

  let usernames: string[];
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const fromBody = Array.isArray(body?.usernames) ? body.usernames : [];
    usernames = fromBody.map((u: unknown) => String(u).trim()).filter(Boolean);
  } else if (usernamesParam) {
    usernames = usernamesParam.split(",").map((u) => u.trim()).filter(Boolean);
  } else {
    return new Response(JSON.stringify({ error: "Provide usernames via query param or POST body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (usernames.length === 0) {
    return new Response(JSON.stringify({ avatars: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const lowerNames = usernames.map((u) => u.toLowerCase());
  const now = new Date().toISOString();
  const refreshMs = 1000 * 60 * 60 * 24 * 7; // 7 days

  const { data: cached } = await supabase
    .from("nanz_roblox_avatars")
    .select("username, roblox_user_id, avatar_url, display_name, status, fetched_at")
    .in("username", lowerNames);

  const cacheMap = new Map<string, AvatarEntry>();
  for (const row of cached ?? []) {
    cacheMap.set(String(row.username).toLowerCase(), row as AvatarEntry);
  }

  const stale: string[] = [];
  const missing: string[] = [];
  for (const name of lowerNames) {
    const entry = cacheMap.get(name);
    if (!entry || entry.status === "error") {
      missing.push(name);
    } else if (entry.status === "not_found") {
      continue;
    } else {
      const fetchedAt = entry.fetched_at ? new Date(entry.fetched_at).getTime() : 0;
      if (Date.now() - fetchedAt > refreshMs) stale.push(name);
    }
  }

  const toResolve = [...new Set([...missing, ...stale])];
  let resolvedIds: Map<string, { id: number; displayName: string }> = new Map();
  let avatarUrls: Map<number, string> = new Map();

  if (toResolve.length > 0) {
    try {
      resolvedIds = await resolveUserIds(toResolve);
      const ids: number[] = [];
      for (const [, info] of resolvedIds) ids.push(info.id);

      const notFound = toResolve.filter((name) => !resolvedIds.has(name));
      for (const name of notFound) {
        await supabase.from("nanz_roblox_avatars").upsert({
          username: name,
          roblox_user_id: null,
          avatar_url: null,
          display_name: null,
          fetched_at: now,
          status: "not_found",
        }, { onConflict: "username" });
        cacheMap.set(name, { username: name, roblox_user_id: null, avatar_url: null, display_name: null, status: "not_found" });
      }

      if (ids.length > 0) {
        avatarUrls = await resolveAvatarUrls(ids);
      }
    } catch (error) {
      // If Roblox is unreachable, still serve cached data
      console.error("Roblox resolution failed:", error instanceof Error ? error.message : "unknown");
    }
  }

  for (const [name, info] of resolvedIds) {
    const avatarUrl = avatarUrls.get(info.id) ?? null;
    await supabase.from("nanz_roblox_avatars").upsert({
      username: name,
      roblox_user_id: info.id,
      avatar_url: avatarUrl,
      display_name: info.displayName,
      fetched_at: now,
      status: avatarUrl ? "verified" : "error",
    }, { onConflict: "username" });
    cacheMap.set(name, { username: name, roblox_user_id: info.id, avatar_url: avatarUrl, display_name: info.displayName, status: avatarUrl ? "verified" : "error" });
  }

  const avatars: { username: string; avatar_url: string | null; display_name: string | null }[] = [];
  for (const name of lowerNames) {
    const entry = cacheMap.get(name);
    avatars.push({
      username: name,
      avatar_url: entry?.avatar_url ?? null,
      display_name: entry?.display_name ?? null,
    });
  }

  return new Response(JSON.stringify({ avatars }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  try {
    return await main(req);
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Avatar resolver failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
