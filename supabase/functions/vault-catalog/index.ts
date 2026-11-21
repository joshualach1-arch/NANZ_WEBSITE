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

function normalizePetCategory(pet: PetRow): string | null {
  const raw = String(pet.category ?? "").trim().toLowerCase();
  const config = asRecord(pet.configData);

  // The API can mark Exclusive pets with additional capability flags (including
  // huge=true). Prefer the explicit category from the collection record first,
  // otherwise the generic huge flag incorrectly swallows Exclusive pets.
  if (raw.includes("gargantuan")) return "Gargantuan";
  if (raw.includes("titanic")) return "Titanic";
  if (raw.includes("exclusive")) return "Exclusive";
  if (raw.includes("huge")) return "Huge";

  if (config.gargantuan === true) return "Gargantuan";
  if (config.titanic === true) return "Titanic";
  if (config.exclusive === true) return "Exclusive";
  if (config.huge === true) return "Huge";
  return null;
}

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
  const category = normalizePetCategory(pet) ?? "Other";
  const isHuge = category === "Huge";
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
  // Parse Cosmic's AJAX feed, whose records have an explicit
  // "Variant ... Value ..." sequence. Do not parse the rendered values.php
  // page: its adjacent change/RAP numbers can be mistaken for the actual value.
  const text = html
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&#x2F;/g, "/").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(new RegExp("<script[\\s\\S]*?</script>", "gi"), " ")
    .replace(new RegExp("<style[\\s\\S]*?</style>", "gi"), " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const pattern = /((?:(?:GOLDEN|RAINBOW|SHINY)\s+)*(?:HUGE|TITANIC|EXCLUSIVE|GARGANTUAN)\b[A-Z0-9 .,'’&()\-]{0,100}?)\s+Variant\s+(NORMAL|GOLDEN|RAINBOW|SHINY|GOLDEN\s+SHINY|SHINY\s+GOLDEN|RAINBOW\s+SHINY|SHINY\s+RAINBOW)\s+Value\s+([\d,.]+\s*[KMBT]?|SOON|N\/?A|O\/?C)\b/gi;

  for (const match of text.matchAll(pattern)) {
    const sourceName = match[1].replace(/\s+/g, " ").trim();
    const variantText = match[2].replace(/\s+/g, " ").toLowerCase();
    const variant = variantText === "normal" ? "normal"
      : variantText === "golden" ? "golden"
      : variantText === "rainbow" ? "rainbow"
      : variantText === "shiny" ? "shiny"
      : variantText === "golden shiny" || variantText === "shiny golden" ? "golden_shiny"
      : "rainbow_shiny";

    // Cosmic prefixes variant labels to the base pet name. The catalog stores
    // the base identity, so remove every leading variant prefix before matching.
    const petName = sourceName.replace(/^(?:(?:GOLDEN|RAINBOW|SHINY)\s+)+/i, "").trim();
    const valueText = match[3].trim();
    const value = parseCosmicValue(valueText);
    const compactStatus = valueText.toUpperCase().replaceAll("/", "").replaceAll(" ", "");
    const status = parseCosmicStatus(valueText) ?? (compactStatus === "OC" ? "oc" : null);
    const key = `${petName.toLowerCase()}::${variant}`;
    if (!petName || seen.has(key) || (value == null && status == null)) continue;
    seen.add(key);
    rows.push({ pet_name: petName, variant, value, status, source_name: sourceName });
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


    if (action === "cosmic_pet_values_progress") {
      const session = await supabase.rpc("vault_assert_session", { p_token: token });
      if (session.error) return json({ error: "vault_access_denied" }, 401);
      const collectorNo = Number(Array.isArray(session.data) ? session.data[0] : session.data);
      if (collectorNo !== 1) return json({ error: "vault_owner_only" }, 403);
      const { data, error } = await supabase.from("vault_cosmic_import_progress").select("*").eq("id", 1).maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ progress: data ?? { status: "idle", category_index: 0, category_total: 4, page: 0, source_rows: 0 } });
    }

    if (action === "cosmic_pet_values_import") {
      const session = await supabase.rpc("vault_assert_session", { p_token: token });
      if (session.error) return json({ error: "vault_access_denied" }, 401);
      const collectorNo = Number(Array.isArray(session.data) ? session.data[0] : session.data);
      if (collectorNo !== 1) return json({ error: "vault_owner_only" }, 403);

      // One page per Edge Function invocation. The browser orchestrates pages
      // sequentially, keeping every request short and resumable after failures.
      const categories = ["Huges", "Exclusives", "Titanics", "Gargantuans"];
      const category = String(body.category ?? "");
      const categoryIndex = categories.indexOf(category);
      const page = Math.max(1, Math.min(200, Number(body.page ?? 1)));
      if (categoryIndex < 0) return json({ error: "invalid_cosmic_category", allowed: categories }, 400);

      const writeProgress = async (patch: Record<string, unknown>) => {
        const result = await supabase.from("vault_cosmic_import_progress").upsert({
          id: 1, updated_at: new Date().toISOString(), ...patch,
        });
        if (result.error) throw new Error("progress_write_failed: " + result.error.message);
      };

      try {
        const url = new URL("https://petsimulatorvalues.com/ajax_load_items.php");
        url.searchParams.set("category", category);
        url.searchParams.set("page", String(page));
        await writeProgress({
          status: "running", stage: "fetching", category,
          category_index: categoryIndex * 20, category_total: 100,
          page, source_rows: 0,
          message: `Downloading ${category}, page ${page}`, error: null,
        });

        const res = await fetch(url.toString(), {
          headers: { Accept: "text/html", "User-Agent": "NANZO Signed Vault pet values refresh" },
          signal: AbortSignal.timeout(18000),
        });
        if (!res.ok) throw new Error(`Cosmic source returned HTTP ${res.status} for ${category}, page ${page}`);
        const html = await res.text();
        const rows = parseCosmicPetRows(html);
        // Cosmic's AJAX feed returns up to 50 records per page and does not
        // reliably include the HTML pager markup.
        const hasMore = rows.length >= 50;

        if (rows.length > 0) {
          const unique = new Map<string, Record<string, unknown>>();
          for (const row of rows) unique.set(`${String(row.pet_name).toLowerCase()}::${String(row.variant)}`, row);
          const values = [...unique.values()];
          await writeProgress({
            status: "running", stage: "saving", category,
            category_index: categoryIndex * 20 + 5, category_total: 100,
            page, source_rows: rows.length,
            message: `Saving ${category}, page ${page}: ${values.length} variants`, error: null,
          });
          const batchSize = 40;
          for (let offset = 0; offset < values.length; offset += batchSize) {
            const batch = values.slice(offset, offset + batchSize);
            const saved = await supabase.rpc("vault_cosmic_pet_values_import", { p_token: token, p_values: batch });
            if (saved.error) throw new Error(`Database save failed for ${category}, page ${page}, batch ${Math.floor(offset / batchSize) + 1}: ${saved.error.message}`);
          }
        }

        const finishedCategory = rows.length === 0 || !hasMore;
        const progressIndex = finishedCategory
          ? Math.min(99, (categoryIndex + 1) * 20)
          : Math.min(99, categoryIndex * 20 + 5 + Math.min(14, page));
        const allFinished = categoryIndex === categories.length - 1 && finishedCategory;
        await writeProgress({
          status: allFinished ? "completed" : "running",
          stage: allFinished ? "completed" : finishedCategory ? "category_complete" : "fetching",
          category, category_index: allFinished ? 100 : progressIndex, category_total: 100,
          page, source_rows: rows.length,
          message: allFinished
            ? "Cosmic Values import completed successfully"
            : rows.length === 0
              ? `No more rows in ${category}; category finished`
              : finishedCategory
                ? `Finished ${category}; saved ${rows.length} rows from final page`
                : `Saved ${category}, page ${page} (${rows.length} rows)`,
          error: null,
        });
        return json({ status: "ok", category, page, source_rows: rows.length, has_more: hasMore, category_finished: finishedCategory, all_finished: allFinished });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await writeProgress({
          status: "failed", stage: "failed", category,
          category_index: categoryIndex * 20, category_total: 100,
          page, source_rows: 0, message: "Cosmic Values import failed", error: message,
        });
        return json({ error: message, category, page }, 500);
      }
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
      const categoryCounts: Record<string, number> = { Huge: 0, Exclusive: 0, Titanic: 0, Gargantuan: 0 };
      const items = data.flatMap((pet) => {
        if (!pet.configName) return [];
        const category = normalizePetCategory(pet);
        if (!category || !IMPORT_CATEGORIES.has(category)) return [];
        categoryCounts[category] += 1;
        return [buildItem(pet)];
      });

      if (items.length === 0) {
        return json({ error: "catalog_empty_after_category_filter", total_in_source: data.length, source_categories: [...new Set(data.map((pet) => String(pet.category ?? "unknown")))] }, 502);
      }

      const importRes = await supabase.rpc("vault_catalog_import", {
        p_token: token,
        p_items: items,
      });
      if (importRes.error) return json({ error: importRes.error.message ?? "import_failed", total_in_source: data.length, selected_for_import: items.length, category_counts: categoryCounts }, 500);

      return json({ status: "ok", total_in_source: data.length, selected_for_import: items.length, category_counts: categoryCounts, ...asRecord(importRes.data) });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (err) {
    console.error("[vault-catalog] unhandled", err);
    return json({ error: "integration_error" }, 500);
  }
});
