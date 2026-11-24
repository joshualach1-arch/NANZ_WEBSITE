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

  const rarity = String(config.rarity ?? config.type ?? config.petType ?? "").toLowerCase();
  const exclusiveFlag = config.exclusive === true || config.isExclusive === true
    || rarity.includes("exclusive");
  if (config.gargantuan === true || rarity.includes("gargantuan")) return "Gargantuan";
  if (config.titanic === true || rarity.includes("titanic")) return "Titanic";
  if (exclusiveFlag) return "Exclusive";
  if (config.huge === true || rarity.includes("huge")) return "Huge";
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

function assetImageUrl(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return `${API_BASE}/image/${value}`;
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const assetId = raw.match(/rbxassetid:\/\/(\d+)/i)
    ?? raw.match(/[?&](?:id|assetId|asset_id)=(\d+)/i)
    ?? raw.match(/\/(?:image|asset)\/(\d{6,})(?:[/?#]|$)/i)
    ?? raw.match(/(?:assetid|image|thumbnail)[=:/" ]+(\d{6,})/i);
  if (assetId) return `${API_BASE}/image/${assetId[1]}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\/\//.test(raw)) return `https:${raw}`;
  return null;
}

function normalizePetImageKey(value: string): string {
  return value.toLowerCase()
    .replace(/^(?:exclusive|huge|titanic|gargantuan)\s+/i, "")
    .replace(/\s+(?:exclusive|huge|titanic|gargantuan)$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

function thumbnailUrl(pet: PetRow): string | null {
  const configData = asRecord(pet.configData);
  for (const candidate of [
    configData.thumbnail, configData.icon, configData.image, configData.imageUrl,
    configData.thumbnailUrl, configData.assetId, configData.imageId, configData.goldenThumbnail,
  ]) {
    const url = assetImageUrl(candidate);
    if (url) return url;
  }
  return null;
}

function buildItem(pet: PetRow): Record<string, unknown> {
  const configData = asRecord(pet.configData);
  const category = normalizePetCategory(pet) ?? "Other";
  const isHuge = category === "Huge";
  const isExclusive = category === "Exclusive";
  return {
    external_id: pet.configName,
    pet_name: pet.configName,
    display_name: typeof configData.name === "string" ? configData.name : pet.configName,
    category,
    image_url: thumbnailUrl(pet),
    is_huge: isHuge,
    is_exclusive: isExclusive,
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
  const pattern = new RegExp(String.raw`((?:(?:GOLDEN|RAINBOW|SHINY)\s+)*(?:HUGE|TITANIC|EXCLUSIVE|GARGANTUAN)\b[A-Z0-9 .,'’&()\-]{0,100}?)\s+Variant\s+(NORMAL|GOLDEN|RAINBOW|SHINY|GOLDEN\s+SHINY|SHINY\s+GOLDEN|RAINBOW\s+SHINY|SHINY\s+RAINBOW)\s+Value\s+([\d,.]+\s*[KMBT]?|SOON|N\/?A|O\/?C)\b`, "gi");

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
function parseCosmicEggRows(html: string): Record<string, unknown>[] {
  const decode = (value: string) => value
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&#x2F;/g, "/").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const strip = (value: string) => decode(value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
  const imageFrom = (markup: string): string | null => {
    const tags = [...markup.matchAll(/<(?:img|source)\b[^>]*>/gi)].map((m) => m[0]);
    for (const tag of tags) {
      const match = tag.match(/(?:src|data-src|data-lazy-src|data-original)=["']([^"']+)/i);
      const raw = match?.[1];
      if (!raw || /^data:/i.test(raw)) continue;
      try { return new URL(decode(raw), "https://petsimulatorvalues.com").toString(); } catch { /* ignore invalid URL */ }
    }
    const bg = markup.match(/background-image\s*:\s*url\((["']?)([^)"']+)\1\)/i)?.[2];
    if (bg) {
      try { return new URL(decode(bg), "https://petsimulatorvalues.com").toString(); } catch { /* ignore invalid URL */ }
    }
    return null;
  };
  const links = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const match of links) {
    const blockHtml = match[1];
    const text = strip(blockHtml);
    const marker = text.match(/\bN\/?A\b/i);
    if (!marker || marker.index == null) continue;
    const eggName = text.slice(0, marker.index).replace(/^[^A-Za-z0-9]*/, "").trim();
    if (!eggName || !/\b(Egg|Gift|Present)\b/i.test(eggName)) continue;
    const tail = text.slice(marker.index + marker[0].length);
    const valueText = tail.match(/^\s*([\d,.]+\s*[KMBT]?)/i)?.[1] ?? null;
    const demand = text.match(/(\d+)\s*\/\s*10/);
    const rapText = text.match(/RAP\s*([\d,.]+\s*[KMBT]?)/i)?.[1] ?? null;
    const nearby = html.slice(Math.max(0, match.index! - 900), Math.min(html.length, match.index! + match[0].length + 500));
    const image = imageFrom(blockHtml) ?? imageFrom(nearby);
    const key = eggName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      egg_name: eggName,
      cosmic_value: valueText ? parseCosmicValue(valueText) : null,
      rap_value: rapText ? parseCosmicValue(rapText) : null,
      demand: demand ? Number(demand[1]) : null,
      image_url: image,
      value_source: "cosmic_values",
    });
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


    if (action === "cosmic_egg_import") {
      const session = await supabase.rpc("vault_assert_session", { p_token: token });
      if (session.error) return json({ error: "vault_access_denied" }, 401);
      const collectorNo = Number(Array.isArray(session.data) ? session.data[0] : session.data);
      if (collectorNo !== 1) return json({ error: "vault_owner_only" }, 403);
      const all = new Map<string, Record<string, unknown>>();
      for (let page = 1; page <= 10; page++) {
        const urls = [
          new URL("https://petsimulatorvalues.com/valuesnew.php"),
          new URL("https://petsimulatorvalues.com/values.php"),
        ];
        for (const url of urls) {
          url.searchParams.set("category", "Eggs");
          url.searchParams.set("page", String(page));
        }
        let html: string | null = null;
        const failures: Array<{ url: string; status: number | string }> = [];
        for (const url of urls) {
          try {
            const response = await fetch(url.toString(), {
              headers: {
                Accept: "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
                "User-Agent": "Mozilla/5.0 (compatible; NANZO Signed Vault/1.0)",
                Referer: "https://petsimulatorvalues.com/values.php?category=Eggs",
              },
              signal: AbortSignal.timeout(20000),
            });
            if (response.ok) { html = await response.text(); break; }
            failures.push({ url: url.toString(), status: response.status });
          } catch (error) {
            failures.push({ url: url.toString(), status: error instanceof Error ? error.message : String(error) });
          }
        }
        if (html === null) return json({ error: "cosmic_egg_fetch_failed", page, attempts: failures }, 502);
        const rows = parseCosmicEggRows(html);
        for (const row of rows) all.set(String(row.egg_name).toLowerCase(), row);
        const pageText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        const range = pageText.match(/(\d+)\s*[–-]\s*(\d+)\s+of\s+(\d+)/i);
        const end = range ? Number(range[2]) : 0;
        const total = range ? Number(range[3]) : 0;
        if (range ? end >= total : (!/\bNext\b/i.test(pageText) || rows.length === 0)) break;
      }
      const rows = [...all.values()];
      if (!rows.length) return json({ error: "cosmic_egg_parse_empty" }, 502);

      const normalizeEggKey = (value: string) => value.toLowerCase()
        .replace(/^(?:exclusive|huge|titanic|gargantuan)\s+/i, "")
        .replace(/[^a-z0-9]+/g, "");
      const gameImages = new Map<string, string>();
      try {
        const eggRes = await fetch(`${API_BASE}/api/collection/Eggs`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(20000),
        });
        if (eggRes.ok) {
          const eggPayload = asRecord(await eggRes.json().catch(() => ({})));
          const gameEggs = Array.isArray(eggPayload.data) ? eggPayload.data as PetRow[] : [];
          for (const egg of gameEggs) {
            const config = asRecord(egg.configData);
            const image = thumbnailUrl({ configName: egg.configName, configData: config });
            if (image && egg.configName) gameImages.set(normalizeEggKey(egg.configName), image);
            const displayName = typeof config.name === "string" ? config.name : "";
            if (image && displayName) gameImages.set(normalizeEggKey(displayName), image);
          }
        }
      } catch (error) {
        console.warn("[vault-catalog] BIG Games egg artwork lookup failed", error);
      }
      const existing = await supabase.from("vault_egg_catalog").select("egg_name,image_url");
      const existingImages = new Map<string, string>();
      for (const row of existing.data ?? []) {
        if (row.image_url) existingImages.set(String(row.egg_name).toLowerCase(), String(row.image_url));
      }
      const saved = await supabase.from("vault_egg_catalog").upsert(rows.map((row) => {
        const eggName = String(row.egg_name);
        const gameImage = gameImages.get(normalizeEggKey(eggName));
        return {
          egg_name: eggName,
          image_url: gameImage ?? assetImageUrl(row.image_url) ?? existingImages.get(eggName.toLowerCase()) ?? null,
          cosmic_value: row.cosmic_value,
          rap_value: row.rap_value,
          demand: row.demand,
          value_source: "cosmic_values",
          source_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }), { onConflict: "egg_name" });
      if (saved.error) return json({ error: saved.error.message }, 500);
      const count = await supabase.from("vault_egg_catalog").select("id", { count: "exact", head: true });
      const imageCount = rows.filter((row) => row.image_url || gameImages.has(normalizeEggKey(String(row.egg_name)))).length;
      return json({ status: "ok", added_or_updated: rows.length, imported_pages: Math.min(10, Math.ceil(rows.length / 50)), images_resolved: imageCount, total_catalog: count.count ?? rows.length });
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
        // Cosmic returns 24 cards per AJAX page; the parsed row count is therefore not a 50-row page size.
        // Continue while the source page is full, and stop only on an empty/short source page.
        const sourceCardCount = (html.match(/class=["\']card-box["\']/gi) ?? []).length;
        const hasMore = sourceCardCount >= 24;

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

    if (action === "trade_hub_exclusive_import") {
      const session = await supabase.rpc("vault_assert_session", { p_token: token });
      if (session.error) return json({ error: "vault_access_denied" }, 401);
      const collectorNo = Number(Array.isArray(session.data) ? session.data[0] : session.data);
      if (collectorNo !== 1) return json({ error: "vault_owner_only" }, 403);

      const sourceUrl = "https://ps99.trade/values/exclusive";
      const officialPetImages = new Map<string, string>();
      try {
        const petRes = await fetch(`${API_BASE}/api/collection/Pets`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(20000),
        });
        if (petRes.ok) {
          const petPayload = asRecord(await petRes.json().catch(() => ({})));
          const gamePets = Array.isArray(petPayload.data) ? petPayload.data as PetRow[] : [];
          for (const pet of gamePets) {
            const image = thumbnailUrl(pet);
            if (image && pet.configName) officialPetImages.set(normalizePetImageKey(pet.configName), image);
            const displayName = asRecord(pet.configData).name;
            if (image && typeof displayName === "string") officialPetImages.set(normalizePetImageKey(displayName), image);
          }
        }
      } catch (error) {
        console.warn("[vault-catalog] BIG Games pet artwork lookup failed", error);
      }
      const response = await fetch(sourceUrl, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Mozilla/5.0 (compatible; NANZO Signed Vault/1.0)",
        },
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) return json({ error: "trade_hub_fetch_failed", status: response.status }, 502);
      const html = await response.text();
      const decode = (value: string) => value
        .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ").replace(/&#x2F;/g, "/").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      const strip = (value: string) => decode(value
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
      const anchors = [...html.matchAll(/<a\b[^>]*href=["'](?:https?:\/\/ps99\.trade)?\/(?:de\/)?item\/([^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
      const candidates: Array<{ slug: string; name: string; rap: number | null; image: string | null; detailUrl: string }> = [];
      const seen = new Set<string>();
      const parseValue = (value: string | null): number | null => {
        if (!value) return null;
        const normalized = value.replace(/,/g, "").replace(/\s+/g, "").toUpperCase();
        const parsed = normalized.match(/^([\d.]+)([KMBT])$/);
        if (!parsed) return null;
        return Number(parsed[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 } as Record<string, number>)[parsed[2]];
      };
      for (const match of anchors) {
        const slug = match[1].replace(/\/$/, "");
        const anchorHtml = match[2];
        const anchorText = strip(anchorHtml);
        const name = anchorText
          .replace(/^Exclusive\s+/i, "")
          .replace(/\s+Exclusive$/i, "")
          .replace(/\s*[—–-]\s*[\d,.]+\s*[KMBT].*$/i, "")
          .trim() || slug.split("/").pop()!.replace(/-/g, " ");
        if (!name || seen.has(name.toLowerCase())) continue;
        // On the current Trade Hub list, the value is rendered next to the
        // linked pet name (not followed by an "Exist" label in the same card).
        const afterAnchor = strip(html.slice(match.index! + match[0].length, match.index! + match[0].length + 700));
        const rapText = anchorText.match(/[—–-]\s*([\d,.]+\s*[KMBT])/i)?.[1]
          ?? afterAnchor.match(/^[\s|·:]*([\d,.]+\s*[KMBT])/i)?.[1]
          ?? anchorText.match(/([\d,.]+\s*[KMBT])/i)?.[1]
          ?? null;
        const image = anchorHtml.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i)?.[1] ?? null;
        seen.add(name.toLowerCase());
        candidates.push({
          slug, name, rap: parseValue(rapText), image,
          detailUrl: `https://ps99.trade/item/${encodeURIComponent(slug)}`,
        });
      }
      if (!candidates.length) {
        return json({ error: "trade_hub_parse_empty", source_url: sourceUrl, html_length: html.length, item_links_found: anchors.length }, 502);
      }

      // The list page contains RAP; each item detail page contains its exact
      // copy count. Fetch details with bounded concurrency and preserve RAP
      // and exist_count as separate source fields.
      const rows: Record<string, unknown>[] = [];
      const concurrency = 12;
      for (let offset = 0; offset < candidates.length; offset += concurrency) {
        const batch = candidates.slice(offset, offset + concurrency);
        const details = await Promise.all(batch.map(async (item) => {
          let existCount: number | null = null;
          let imageUrl = item.image;
          try {
            const detailResponse = await fetch(item.detailUrl, {
              headers: {
                Accept: "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
                "User-Agent": "Mozilla/5.0 (compatible; NANZO Signed Vault/1.0)",
              },
              signal: AbortSignal.timeout(12000),
            });
            if (detailResponse.ok) {
              const detailHtml = await detailResponse.text();
              const detailText = strip(detailHtml);
              const copies = detailText.match(/(?:Copies\s*([\d,]+)|([\d,]+)\s+in the game|Exist\s*:?\s*([\d,]+))/i);
              const rawCount = copies?.[1] ?? copies?.[2] ?? copies?.[3] ?? null;
              if (rawCount) existCount = Number(rawCount.replace(/,/g, ""));
              if (!imageUrl) imageUrl = detailHtml.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i)?.[1] ?? null;
            }
          } catch {
            // Keep the RAP row even if one detail page is temporarily unavailable.
          }
          imageUrl = officialPetImages.get(normalizePetImageKey(item.name)) ?? assetImageUrl(imageUrl) ?? null;
          return {
            pet_name: item.name,
            rap: item.rap,
            exist_count: existCount,
            image_url: imageUrl,
          };
        }));
        rows.push(...details);
      }

      const saved = await supabase.rpc("vault_trade_hub_exclusive_import", { p_token: token, p_items: rows });
      if (saved.error) return json({ error: saved.error.message ?? "trade_hub_import_failed", parsed: rows.length }, 500);
      return json({
        status: "ok",
        source: "ps99_trade_hub",
        source_url: sourceUrl,
        source_rows: rows.length,
        rows_with_rap: rows.filter((row) => row.rap != null).length,
        rows_with_exist_count: rows.filter((row) => row.exist_count != null).length,
        ...asRecord(saved.data),
      });
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
