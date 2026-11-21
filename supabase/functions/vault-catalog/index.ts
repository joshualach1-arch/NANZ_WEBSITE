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


function parseCosmicValue(value: string | null): number | null {
  if (!value || /^SOON$/i.test(value.trim()) || /^N\/?A$/i.test(value.trim())) return null;
  // Cosmic sometimes renders a space between the number and suffix (e.g. "800 M").
  const normalized = value.trim().replace(/,/g, "").replace(/\s+/g, "").toUpperCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)([KMBT])?$/);
  if (!match) return null;
  const factor: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  return Number(match[1]) * (factor[match[2] ?? ""] ?? 1);
}

function parseCosmicDemand(value: string): number | null {
  const match = value.trim().match(/^(\d+)\s*(?:\/\s*10|out\s+of\s+10)$/i);
  return match ? Number(match[1]) : null;
}

function parseCosmicStatus(value: string): string | null {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "SOON") return "soon";
  if (normalized === "N/A" || normalized === "NA") return "na";
  return null;
}


function parseCosmicPetRows(html: string): Record<string, unknown>[] {
  const decode = (s: string) => s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const text = decode(html);
  const rows: Record<string, unknown>[] = [];

  // Verified Cosmic HTML text format:
  // "HUGE CAT Variant Normal Value ▲ 20.5% | 6.75B Demand 7/10"
  // The percentage is the change indicator; the value after "|" is the pet value.
  const pattern = /((?:(?:RAINBOW\s+SHINY|SHINY\s+RAINBOW|GOLDEN|RAINBOW|SHINY)\s+)*(?:HUGE|TITANIC|EXCLUSIVE|GARGANTUAN)\b[A-Z0-9 .,'’&()\-]{0,90}?)\s+VARIANT\s+(NORMAL|GOLDEN|RAINBOW|SHINY|RAINBOW\s+SHINY|SHINY\s+RAINBOW)\s+VALUE\s+(?:(?:[▲▼=]\s*)?[\d,.]+\s*%?\s*\|\s*)?([\d,.]+\s*[KMBT]?|SOON|N\/?A|O\/?C)\s+DEMAND\s+(?:N\/?A|\d+\s*(?:\/\s*10|OUT\s+OF\s+10))/gi;

  for (const match of text.matchAll(pattern)) {
    const fullName = match[1].replace(/\s+/g, " ").trim();
    const variantRaw = match[2].replace(/\s+/g, " ").toLowerCase();
    const variant = variantRaw === "normal" ? "normal" : variantRaw === "golden" ? "golden"
      : variantRaw === "rainbow" ? "rainbow" : variantRaw === "shiny" ? "shiny" : "rainbow_shiny";
    const baseName = fullName.replace(/^(?:RAINBOW\s+SHINY|SHINY\s+RAINBOW|GOLDEN|RAINBOW|SHINY)\s+/i, "").trim();
    const rawValue = match[3].trim();
    const value = parseCosmicValue(rawValue);
    const status = parseCosmicStatus(rawValue) ?? (/^O\/?C$/i.test(rawValue) ? "oc" : null);
    if (baseName && (value != null || status != null)) {
      rows.push({ pet_name: baseName, variant, value, status, source_name: fullName });
    }
  }
  return rows;
}
function parseCosmicSignerRows(html: string, role: string): Record<string, unknown>[] {
  const decode = (s: string) => s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const rows: Record<string, unknown>[] = [];
  // Parse the rendered signer text without depending on the site's CSS classes.
  const text = decode(html);
  const pattern = /(?:Staff|Partner|Dev)\s+(.{1,60}?)\s+@([A-Za-z0-9_]{3,20})\s+Exclusive\s+([\d,.]+\s*[KMBT]?|SOON|N\/?A)\s+Huge\s+([\d,.]+\s*[KMBT]?|SOON|N\/?A)\s+Titanic\s+([\d,.]+\s*[KMBT]?|SOON|N\/?A)\s+Demand\s+(N\/?A|\d+\s*(?:\/\s*10|out\s+of\s+10))/gi;
  for (const match of text.matchAll(pattern)) {
    const signerName = match[1].replace(/\s+/g, " ").trim();
    const username = match[2];
    if (!signerName || !username) continue;
    rows.push({
      signer_name: signerName,
      roblox_username: username,
      roles: [role],
      exclusive_value: parseCosmicValue(match[3]),
      huge_value: parseCosmicValue(match[4]),
      titanic_value: parseCosmicValue(match[5]),
      demand: parseCosmicDemand(match[6]),
      exclusive_status: parseCosmicStatus(match[3]),
      huge_status: parseCosmicStatus(match[4]),
      titanic_status: parseCosmicStatus(match[5]),
      demand_status: parseCosmicStatus(match[6]),
      source: "cosmic_values",
      profile_url: null,
      avatar_url: null,
    });
  }
  return rows;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const body = asRecord(await req.json().catch(() => ({})));
    const action = String(body.action ?? "");
    const token = String(body.token ?? "");


    if (action === "cosmic_signer_import") {
      // Values-only refresh: signer records are already imported. Never create,
      // rename, merge, or change signer roles/identity in this workflow.
      const session = await supabase.rpc("vault_assert_session", { p_token: token });
      if (session.error) return json({ error: "vault_access_denied" }, 401);
      const collectorNo = Number(Array.isArray(session.data) ? session.data[0] : session.data);
      if (collectorNo !== 1) return json({ error: "vault_owner_only" }, 403);

      const categories = [
        { type: "BIG Games Staff", role: "big_games_developer" },
        { type: "BIG Games Dev", role: "big_games_developer" },
        { type: "Partner", role: "big_games_partner" },
      ];
      const allRows: Record<string, unknown>[] = [];
      for (const group of categories) {
        for (let page = 1; page <= 20; page++) {
          const url = new URL("https://petsimulatorvalues.com/values.php");
          url.searchParams.set("category", "Signatures");
          url.searchParams.set("sigtype", group.type);
          url.searchParams.set("page", String(page));
          const res = await fetch(url.toString(), {
            headers: { Accept: "text/html", "User-Agent": "NANZO Signed Vault values refresh" },
            signal: AbortSignal.timeout(20000),
          });
          if (!res.ok) return json({ error: "cosmic_signer_fetch_failed", type: group.type, page }, 502);
          const html = await res.text();
          const rows = parseCosmicSignerRows(html, group.role);
          if (rows.length === 0) break;
          allRows.push(...rows);
          if (!html.includes("Next")) break;
        }
      }

      // Combine role duplicates by Roblox username only. Different usernames
      // with identical signer names remain separate records.
      const byUsername = new Map<string, Record<string, unknown>>();
      for (const row of allRows) {
        const username = String(row.roblox_username ?? "").replace(/^@/, "").trim();
        const key = username.toLowerCase();
        if (!key) continue;
        const existing = byUsername.get(key);
        if (existing) {
          const roles = new Set([...(existing.roles as string[]), ...(row.roles as string[])]);
          existing.roles = [...roles];
          for (const field of ["exclusive_value", "huge_value", "titanic_value", "demand",
            "exclusive_status", "huge_status", "titanic_status", "demand_status"]) {
            if (existing[field] == null && row[field] != null) existing[field] = row[field];
          }
        } else byUsername.set(key, { ...row });
      }

      const signerRows = [...byUsername.values()];
      const robloxIds = new Map<string, number>();
      for (let offset = 0; offset < signerRows.length; offset += 100) {
        const batch = signerRows.slice(offset, offset + 100);
        try {
          const resolveRes = await fetch("https://users.roblox.com/v1/usernames/users", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              usernames: batch.map((row) => String(row.roblox_username)),
              excludeBannedUsers: false,
            }),
            signal: AbortSignal.timeout(12000),
          });
          if (resolveRes.ok) {
            const payload = asRecord(await resolveRes.json().catch(() => ({})));
            for (const raw of (Array.isArray(payload.data) ? payload.data : [])) {
              const user = asRecord(raw);
              const id = Number(user.id);
              const username = String(user.name ?? "").toLowerCase();
              if (Number.isFinite(id) && id > 0 && username) robloxIds.set(username, id);
            }
          }
        } catch {
          // Username matching remains available if Roblox resolution is offline.
        }
      }

      for (const row of signerRows) {
        const username = String(row.roblox_username ?? "").toLowerCase();
        const userId = robloxIds.get(username);
        if (userId) row.roblox_user_id = userId;
      }

      const updateRes = await supabase.rpc("vault_cosmic_signer_values_import", {
        p_token: token,
        p_signers: signerRows,
      });
      if (updateRes.error) return json({ error: updateRes.error.message ?? "cosmic_signer_values_import_failed" }, 500);
      return json({
        status: "ok",
        source_rows: allRows.length,
        unique_signers: signerRows.length,
        ...asRecord(updateRes.data),
      });
    }


    if (action === "cosmic_pet_values_import") {
      const session = await supabase.rpc("vault_assert_session", { p_token: token });
      if (session.error) return json({ error: "vault_access_denied" }, 401);
      const collectorNo = Number(Array.isArray(session.data) ? session.data[0] : session.data);
      if (collectorNo !== 1) return json({ error: "vault_owner_only" }, 403);
      const categories = ["Huges", "Exclusives", "Titanics", "Gargantuans"];
      const allRows: Record<string, unknown>[] = [];
      for (const category of categories) {
        for (let page = 1; page <= 200; page++) {
          const url = new URL("https://petsimulatorvalues.com/values.php");
          url.searchParams.set("category", category);
          url.searchParams.set("page", String(page));
          const res = await fetch(url.toString(), {
            headers: { Accept: "text/html", "User-Agent": "NANZO Signed Vault pet values refresh" },
            signal: AbortSignal.timeout(20000),
          });
          if (!res.ok) return json({ error: "cosmic_pet_values_fetch_failed", category, page }, 502);
          const html = await res.text();
          const rows = parseCosmicPetRows(html);
          if (rows.length === 0) break;
          allRows.push(...rows);
          if (!html.includes("Next")) break;
        }
      }
      const byKey = new Map<string, Record<string, unknown>>();
      for (const row of allRows) byKey.set(`${String(row.pet_name).toLowerCase()}::${String(row.variant)}`, row);
      const values = [...byKey.values()];
      const importRes = await supabase.rpc("vault_cosmic_pet_values_import", { p_token: token, p_values: values });
      if (importRes.error) return json({ error: importRes.error.message ?? "cosmic_pet_values_import_failed" }, 500);
      return json({ status: "ok", source_rows: allRows.length, unique_values: values.length, ...asRecord(importRes.data) });
    }

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
