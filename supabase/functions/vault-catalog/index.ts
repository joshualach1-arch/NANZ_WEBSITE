import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const API_BASE = "https://ps99.biggamesapi.io";

// The BIG Games PS99 Public API serves the complete in-game pet collection
// at /api/collection/Pets (verified, no auth). Only pets that can plausibly
// carry signatures are imported: Huge, Exclusive, Titanic, Gargantuan.
const IMPORT_CATEGORIES = new Set(["Huge", "Exclusive", "Titanic", "Gargantuan"]);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type PetRow = {
  configName: string;
  category?: string | null;
  configData?: Record<string, unknown>;
};

function thumbnailUrl(pet: PetRow): string | null {
  const configData = asRecord(pet.configData);
  const thumb = typeof configData.thumbnail === "string" ? configData.thumbnail : "";
  // rbxassetid://123456 -> https://ps99.biggamesapi.io/image/123456
  const match = thumb.match(/rbxassetid:\/\/(\d+)/);
  return match ? `${API_BASE}/image/${match[1]}` : null;
}

function buildItem(pet: PetRow): Record<string, unknown> {
  const configData = asRecord(pet.configData);
  const category = pet.category ?? "Other";
  const isHuge = category === "Huge" || Boolean(configData.huge);
  return {
    external_id: pet.configName,
    pet_name: pet.configName,
    display_name: typeof configData.name === "string" ? configData.name : pet.configName,
    category,
    image_url: thumbnailUrl(pet),
    is_huge: isHuge,
    is_exclusive: category === "Exclusive",
    is_titanic: category === "Titanic",
    is_gargantuan: category === "Gargantuan",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const body = asRecord(await req.json().catch(() => ({})));
    const action = String(body.action ?? "");
    const token = String(body.token ?? "");

    if (action === "catalog_import") {
      // owner session required (validated against vault sessions server-side)
      const session = await supabase.rpc("vault_assert_session", { p_token: token });
      if (session.error) return json({ error: "vault_access_denied" }, 401);
      const collectorNo = Number(Array.isArray(session.data) ? session.data[0] : session.data);
      if (collectorNo !== 1) return json({ error: "vault_owner_only" }, 403);

      const res = await fetch(`${API_BASE}/api/collection/Pets`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 429) return json({ error: "rate_limited" }, 429);
      if (!res.ok) return json({ error: "catalog_fetch_failed" }, 502);

      const payload = asRecord(await res.json().catch(() => ({})));
      if (payload.status !== "ok") return json({ error: "catalog_fetch_failed" }, 502);
      const data = Array.isArray(payload.data) ? (payload.data as PetRow[]) : [];
      const items = data
        .filter((pet) => pet.configName && IMPORT_CATEGORIES.has(pet.category ?? ""))
        .map(buildItem);

      const importRes = await supabase.rpc("vault_catalog_import", {
        p_token: token,
        p_items: items,
      });
      if (importRes.error) return json({ error: importRes.error.message ?? "import_failed" }, 500);

      return json({ status: "ok", total_in_source: data.length, ...importRes.data });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (err) {
    console.error("[vault-catalog] unhandled", err);
    return json({ error: "integration_error" }, 500);
  }
});
