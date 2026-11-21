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

const AUTHORIZE_URL = "https://db.biggames.io/oauth/authorize";
const TOKEN_URL = "https://db.biggames.io/oauth/token";
const API_BASE = "https://ps99.biggamesapi.io";
const SCOPES = [
  "player-data:pet-simulator-99:inventory:read",
  "player-data:pet-simulator-99:trades:read",
  "player-data:pet-simulator-99:booth:read",
];

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(input: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
}

// Pet taxonomy (Part 1): Huge, Exclusive, Titanic, Gargantuan, Golden,
// Rainbow, Shiny, Rainbow Shiny, other — Golden/Rainbow/Shiny are variants.
function petCategory(petName: string): string {
  const n = petName.toLowerCase();
  if (n.includes("titanic")) return "titanic";
  if (n.includes("gargantua")) return "gargantuan";
  if (n.startsWith("huge ") || n.includes(" huge ")) return "huge";
  if (n.startsWith("exclusive ") || n.includes(" exclusive ")) return "exclusive";
  return "other";
}

// Full inventory parse: EVERY Pet-class item is scanned (not only signed ones).
// A "Signed <PetName>" config id marks a signed pet, but the prefix alone never
// proves verification — signed_status stays manual_review and the database only
// upgrades it on reliable identifiers or a verified signature record.
function parsePet(item: Record<string, unknown>): Record<string, unknown> | null {
  const id = typeof item.id === "string" ? item.id : "";
  if (!id || String(item.class ?? "") !== "Pet") return null;

  const isSigned = id.startsWith("Signed ");
  const petName = (isSigned ? id.slice("Signed ".length) : id).trim();
  if (!petName) return null;

  const raw = asRecord(item.rawData);
  const pt = Number(raw.pt ?? 0);
  const sh = Boolean(raw.sh);
  const variant = pt === 1 ? "golden" : pt === 2 ? (sh ? "rainbow_shiny" : "rainbow") : sh ? "shiny" : "normal";
  const amount = Number(raw.a ?? item.amount ?? 1);
  const stackKey = typeof item.stackKey === "string" && item.stackKey ? item.stackKey : null;
  const instanceId = typeof raw.uid === "string" ? raw.uid : typeof item.uid === "string" ? item.uid : null;
  const uidSource = stackKey ?? `inst:${instanceId ?? JSON.stringify(raw)}`;

  return {
    external_pet_id: id,
    pet_name: petName,
    category: petCategory(petName),
    variant,
    is_golden: pt === 1,
    is_rainbow: pt === 2,
    is_shiny: sh,
    is_rainbow_shiny: pt === 2 && sh,
    stack_key: stackKey,
    instance_id: instanceId,
    quantity: Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 1,
    inventory_uid: `bg:${uidSource}`,
    // BIG Games strips the internal signature/ownership fields before exposing inventory.
    // Absence of those fields is NOT proof that a pet is unsigned.
    signed_status: "manual_review",
    signature_data: isSigned
      ? { signed_prefix_detected: true, source: "biggames_oauth" }
      : { detection_status: "unavailable", reason: "biggames_api_redacts_signature_metadata", source: "biggames_oauth" },
    owner_label: null,
    rap: item.rap ?? null,
    exists: item.exists ?? null,
    rarity: item.rarity ?? null,
    created_at_save: raw.createdAt ?? null,
    raw_data: item,
  };
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return asRecord(await req.json());
  } catch {
    return {};
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const body = await readBody(req);
    const action = String(body.action ?? "");
    const token = String(body.token ?? "");
    const clientId = Deno.env.get("BIG_GAMES_CLIENT_ID") ?? "";

    // ── start OAuth: build authorize URL with PKCE, persist state ────
    if (action === "oauth_start") {
      if (!clientId) {
        return json({ error: "oauth_not_configured" }, 400);
      }
      const scopeCheck = await supabase.rpc("vault_assert_session", { p_token: token });
      if (scopeCheck.error) return json({ error: "vault_access_denied" }, 401);
      const collectorNo = Number(scopeCheck.data);
      if (!Number.isFinite(collectorNo)) return json({ error: "vault_access_denied" }, 401);

      // Fixed, canonical production callback. This exact URI must also be
      // registered in the BIG Games developer app. Never trust a browser-
      // supplied origin for an OAuth redirect URI.
      const redirectUri = "https://nanz-clan.com/signed-vault/callback";

      const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
      const codeVerifier = b64url(verifierBytes);
      const challenge = b64url(await sha256(codeVerifier));
      const state = b64url(crypto.getRandomValues(new Uint8Array(24)));

      await supabase.rpc("vault_oauth_state_set", {
        p_collector_no: collectorNo,
        p_state: state,
        p_code_verifier: codeVerifier,
        p_redirect_uri: redirectUri,
      });

      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", SCOPES.join(" "));
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("state", state);

      return json({ status: "ok", authorize_url: url.toString() });
    }

    // ── OAuth callback: exchange code, store token ───────────────────
    if (action === "oauth_callback") {
      const clientSecret = Deno.env.get("BIG_GAMES_CLIENT_SECRET") ?? "";
      if (!clientId || !clientSecret) return json({ error: "oauth_not_configured" }, 400);

      const code = String(body.code ?? "");
      const state = String(body.state ?? "");
      if (!code || !state) return json({ error: "oauth_callback_invalid" }, 400);

      const claimRes = await supabase.rpc("vault_oauth_state_claim", { p_state: state });
      if (claimRes.error) return json({ error: "oauth_state_invalid" }, 400);
      const claimRow = (Array.isArray(claimRes.data) ? claimRes.data[0] : claimRes.data) as Record<string, unknown> | null;
      if (!claimRow) return json({ error: "oauth_state_invalid" }, 400);

      const basic = btoa(`${clientId}:${clientSecret}`);
      const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basic}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: String(claimRow.out_redirect_uri ?? ""),
          code_verifier: String(claimRow.out_code_verifier ?? ""),
        }),
        signal: AbortSignal.timeout(15000),
      });
      const tokenPayload = asRecord(await tokenRes.json().catch(() => ({})));
      if (!tokenRes.ok || !tokenPayload.access_token) {
        return json({ error: "oauth_exchange_failed" }, 400);
      }

      const accessToken = String(tokenPayload.access_token);
      const expiresIn = Number(tokenPayload.expires_in ?? 2592000);
      const scope = String(tokenPayload.scope ?? SCOPES.join(" "));

      // identify the Roblox account behind the token via the profile view
      let robloxUserId: number | null = null;
      try {
        const profileRes = await fetch(`${API_BASE}/v1/account/profile`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(15000),
        });
        if (profileRes.ok) {
          const profile = asRecord(await profileRes.json().catch(() => ({})));
          const data = asRecord(profile.data);
          const candidate = Number(data.PlayerId ?? data.playerId ?? 0);
          if (Number.isFinite(candidate) && candidate > 0) robloxUserId = candidate;
        }
      } catch {
        // profile view is optional; scope may not include it
      }

      await supabase.rpc("vault_oauth_save", {
        p_collector_no: Number(claimRow.out_collector_no),
        p_access_token: accessToken,
        p_scope: scope,
        p_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        p_roblox_user_id: robloxUserId,
      });

    return json({ status: "ok", connected: true, roblox_user_id: robloxUserId });
    }

    // ── roblox lookup: resolve a username via official Roblox endpoints ──
    if (action === "roblox_lookup") {
      const tokenRes = await supabase.rpc("vault_assert_session", { p_token: token });
      if (tokenRes.error) return json({ error: "vault_access_denied" }, 401);

      const username = String(body.username ?? "").trim();
      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return json({ error: "roblox_input_invalid" }, 400);

      let userId: number | null = null;
      let displayName: string | null = null;
      try {
        const resolveRes = await fetch("https://users.roblox.com/v1/usernames/users", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
          signal: AbortSignal.timeout(8000),
        });
        if (resolveRes.ok) {
          const payload = asRecord(await resolveRes.json().catch(() => ({})));
          const rows = Array.isArray(payload.data) ? payload.data : [];
          const first = asRecord(rows[0]);
          const id = Number(first.id);
          if (Number.isFinite(id) && id > 0) {
            userId = id;
            displayName = typeof first.displayName === "string" ? first.displayName : username;
          }
        } else if (resolveRes.status === 429) {
          return json({ error: "roblox_rate_limited" }, 429);
        }
      } catch {
        return json({ error: "roblox_unreachable" }, 502);
      }
      if (userId === null) return json({ error: "roblox_not_found" }, 404);

      let avatarUrl: string | null = null;
      try {
        const thumbRes = await fetch(
          `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`,
          { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) },
        );
        if (thumbRes.ok) {
          const payload = asRecord(await thumbRes.json().catch(() => ({})));
          const rows = Array.isArray(payload.data) ? payload.data : [];
          const thumb = asRecord(rows[0]);
          if (typeof thumb.imageUrl === "string") avatarUrl = thumb.imageUrl;
        }
      } catch {
        // thumbnail is optional; the connection itself still succeeds
      }

      return json({
        status: "ok",
        roblox_user_id: userId,
        roblox_username: username,
        display_name: displayName,
        avatar_url: avatarUrl,
        profile_url: `https://www.roblox.com/users/${userId}/profile`,
      });
    }

    // ── import historical trades and booth transactions ─────────────
    if (action === "history_sync") {
      const tokenRes = await supabase.rpc("vault_assert_session", { p_token: token });
      if (tokenRes.error) return json({ error: "vault_access_denied" }, 401);
      const collectorNo = Number(tokenRes.data);
      const requested = body.collector_no != null ? Number(body.collector_no) : collectorNo;
      const scope = collectorNo === 1 ? (requested === 2 ? 2 : 1) : collectorNo;

      const storedRes = await supabase
        .from("vault_oauth_tokens")
        .select("access_token, expires_at, roblox_user_id")
        .eq("collector_no", scope)
        .maybeSingle();
      const stored = storedRes.data as { access_token: string; expires_at: string; roblox_user_id: number | null } | null;
      if (!stored?.access_token) return json({ error: "oauth_not_connected" }, 400);
      if (new Date(stored.expires_at).getTime() < Date.now()) return json({ error: "oauth_token_expired" }, 400);

      const headers = { Authorization: `Bearer ${stored.access_token}`, Accept: "application/json" };
      const [tradesRes, boothRes] = await Promise.all([
        fetch(`${API_BASE}/v1/account/trades`, { headers, signal: AbortSignal.timeout(20000) }),
        fetch(`${API_BASE}/v1/account/booth`, { headers, signal: AbortSignal.timeout(20000) }),
      ]);
      if (tradesRes.status === 403 || boothRes.status === 403) {
        return json({ error: "oauth_history_scope_missing", required_scopes: [
          "player-data:pet-simulator-99:trades:read",
          "player-data:pet-simulator-99:booth:read"
        ] }, 400);
      }
      if (tradesRes.status === 401 || boothRes.status === 401) return json({ error: "oauth_token_expired" }, 400);
      if (tradesRes.status === 429 || boothRes.status === 429) {
        const retryAfter = Math.max(Number(tradesRes.headers.get("Retry-After") ?? 0), Number(boothRes.headers.get("Retry-After") ?? 0), 60);
        return json({ error: "rate_limited", retry_after: retryAfter }, 429);
      }
      if (!tradesRes.ok || !boothRes.ok) return json({ error: "history_fetch_failed" }, 502);

      const tradesPayload = asRecord(await tradesRes.json().catch(() => ({})));
      const boothPayload = asRecord(await boothRes.json().catch(() => ({})));
      const tradeData = asRecord(tradesPayload.data);
      const boothData = asRecord(boothPayload.data);
      const tradeEntries = Array.isArray(tradeData.entries) ? tradeData.entries as Record<string, unknown>[] : [];
      const boothEntries = Array.isArray(boothData.entries) ? boothData.entries as Record<string, unknown>[] : [];

      const catalogRes = await supabase.from("vault_pet_catalog").select("id, pet_name, display_name, external_id, category");
      if (catalogRes.error) return json({ error: "catalog_lookup_failed" }, 500);
      const catalog = new Map<string, Record<string, unknown>>();
      for (const row of (catalogRes.data ?? []) as Record<string, unknown>[]) {
        for (const alias of [row.pet_name, row.display_name, row.external_id]) {
          const key = String(alias ?? "").trim().toLowerCase();
          if (key) catalog.set(key, row);
        }
      }
      const isTrackedPet = (item: Record<string, unknown>) => {
        const candidates = [item.displayName, item.id, item.name].map((v) => String(v ?? "").trim().toLowerCase()).filter(Boolean);
        const row = candidates.map((name) => catalog.get(name)).find(Boolean);
        if (!row) return null;
        const category = String(row.category ?? "");
        return ["Huge", "Exclusive", "Titanic", "Gargantuan"].includes(category) ? row : null;
      };
      const itemName = (item: Record<string, unknown>) => String(item.id ?? item.displayName ?? "Unknown Pet");
      const itemVariant = (item: Record<string, unknown>) => {
        const v = String(item.variant ?? "Regular").toLowerCase().replace(/[\s-]+/g, "_");
        return ({ regular: "normal", normal: "normal", shiny: "shiny", golden: "golden", rainbow: "rainbow", shiny_golden: "golden_shiny", golden_shiny: "golden_shiny", shiny_rainbow: "rainbow_shiny", rainbow_shiny: "rainbow_shiny" } as Record<string,string>)[v] ?? "normal";
      };
      const diamondAmount = (items: unknown[]) => items.reduce((sum, raw) => {
        const item = asRecord(raw);
        const id = String(item.id ?? item.displayName ?? "").toLowerCase();
        if (id !== "diamonds" && id !== "diamond") return sum;
        const amount = Number(item.count ?? item.amount ?? asRecord(item.rawData)._am ?? 0);
        return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
      }, 0);
      const records: Record<string, unknown>[] = [];
      const addRecords = async (entries: Record<string, unknown>[], source: "trade" | "booth") => {
        for (const entry of entries) {
          const timestamp = Number(entry.timestamp ?? 0);
          if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
          const received = Array.isArray(entry.received) ? entry.received.map(asRecord) : [];
          const given = Array.isArray(entry.given) ? entry.given.map(asRecord) : [];
          const pets = received.filter((item) => isTrackedPet(item));
          if (!pets.length) continue;
          const otherParty = asRecord(entry.otherParty);
          const keyMaterial = JSON.stringify({ source, timestamp, other: otherParty.uid ?? null, given, received });
          const key = Array.from(await sha256(keyMaterial)).map((b) => b.toString(16).padStart(2, "0")).join("");
          const diamonds = source === "trade" ? diamondAmount(given) : 0;
          const groupRes = await supabase.from("vault_trade_groups").upsert({
            collector_no: scope, external_transaction_key: key, source,
            transaction_at: new Date(timestamp * 1000).toISOString(),
            total_gems: diamonds > 0 ? diamonds : null,
            counterparty: otherParty.displayName ? String(otherParty.displayName) : null,
            given_items: given, received_items: received,
          }, { onConflict: "collector_no,external_transaction_key" }).select("id").single();
          if (groupRes.error || !groupRes.data?.id) throw new Error("trade_group_store_failed");
          const tradeGroupId = groupRes.data.id as string;
          for (const pet of pets) {
            const catalogPet = isTrackedPet(pet)!;
            const price = diamonds > 0 && pets.length === 1 ? diamonds : null;
            records.push({
              collector_no: scope,
              pet_id: catalogPet.id,
              variant: itemVariant(pet),
              acquired_at: new Date(timestamp * 1000).toISOString().slice(0, 10),
              purchase_price: price,
              currency: "gems",
              source: "trade",
              acquisition_type: source === "booth" ? "booth_purchase" : "trade",
              verification_status: "unverified",
              external_transaction_key: key,
              trade_group_id: tradeGroupId,
              notes: [
                source === "booth" ? "Imported from BIG Games booth history." : "Imported from BIG Games trade history.",
                otherParty.displayName ? `Other party: ${String(otherParty.displayName)}` : "",
                price == null ? "Exact purchase price unavailable from this transaction record." : "Diamond amount explicitly present in trade record."
              ].filter(Boolean).join(" "),
            });
          }
        }
      };
      await addRecords(tradeEntries, "trade");
      await addRecords(boothEntries, "booth");

      let imported = 0;
      if (records.length) {
        const { data: upserted, error: upsertError } = await supabase
          .from("vault_acquisitions")
          .upsert(records, { onConflict: "collector_no,external_transaction_key,pet_id,variant", ignoreDuplicates: true })
          .select("id");
        if (upsertError) return json({ error: "history_store_failed", detail: upsertError.message }, 500);
        imported = upserted?.length ?? 0;
        // Existing imports are retained unchanged; attach them to the newly refreshed transaction groups.
        for (const group of [...new Map(records.map((r) => [String(r.external_transaction_key), r])).values()]) {
          await supabase.from("vault_acquisitions").update({ trade_group_id: group.trade_group_id })
            .eq("collector_no", scope).eq("external_transaction_key", group.external_transaction_key);
        }
      }
      return json({
        status: "ok",
        trades_scanned: tradeEntries.length,
        booth_transactions_scanned: boothEntries.length,
        pet_acquisitions_found: records.length,
        newly_imported: imported,
        note: "BIG Games trade/booth history does not always expose the diamond price. Unknown prices remain blank."
      });
    }

    // ── inventory scan: snapshot lifecycle → full parse → apply ──────
    if (action === "sync") {
      const tokenRes = await supabase.rpc("vault_assert_session", { p_token: token });
      if (tokenRes.error) return json({ error: "vault_access_denied" }, 401);
      const collectorNo = Number(tokenRes.data);
      const requested = body.collector_no != null ? Number(body.collector_no) : collectorNo;
      const scope = collectorNo === 1 ? (requested === 2 ? 2 : 1) : collectorNo;

      const storedRes = await supabase
        .from("vault_oauth_tokens")
        .select("access_token, expires_at, roblox_user_id")
        .eq("collector_no", scope)
        .maybeSingle();
      const stored = storedRes.data as { access_token: string; expires_at: string; roblox_user_id: number | null } | null;
      if (!stored?.access_token) return json({ error: "oauth_not_connected" }, 400);
      if (new Date(stored.expires_at).getTime() < Date.now()) {
        return json({ error: "oauth_token_expired" }, 400);
      }

      const syncId = crypto.randomUUID();
      const snapRes = await supabase.rpc("vault_snapshot_start", {
        p_collector_no: scope, p_sync_id: syncId, p_roblox_user_id: stored.roblox_user_id,
      });

      const fail = async (errorCode: string, httpStatus: number, extra?: Record<string, unknown>) => {
        await supabase.rpc("vault_snapshot_fail", { p_sync_id: syncId, p_collector_no: scope, p_error_code: errorCode });
        await supabase.rpc("vault_sync_log_add", { p_collector_no: scope, p_status: "error", p_error_code: errorCode, ...(extra ?? {}) });
        await supabase.rpc("vault_audit_scan_add", { p_collector_no: scope, p_status: "error", p_detail: { error_code: errorCode } });
        return json({ error: errorCode, ...(extra ?? {}) }, httpStatus);
      };

      let invRes: Response;
      try {
        invRes = await fetch(`${API_BASE}/v1/account/inventory`, {
          headers: { Authorization: `Bearer ${stored.access_token}` },
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        return fail("inventory_unreachable", 502);
      }

      if (invRes.status === 401) return fail("oauth_token_expired", 400, { p_http_status: 401 });
      if (invRes.status === 403) return fail("oauth_scope_missing", 400, { p_http_status: 403 });
      if (invRes.status === 429) {
        const retryAfter = Number(invRes.headers.get("Retry-After") ?? "60");
        return fail("rate_limited", 429, { p_http_status: 429, p_retry_after: retryAfter, retry_after: retryAfter });
      }
      if (!invRes.ok) return fail("inventory_fetch_failed", 502, { p_http_status: invRes.status });

      const payload = asRecord(await invRes.json().catch(() => ({})));
      const data = asRecord(payload.data);
      const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
      const parsed = items
        .map(parsePet)
        .filter((entry): entry is Record<string, unknown> => entry !== null);
      const signedFound = parsed.filter((p) =>
        asRecord(p.signature_data).signed_prefix_detected === true ||
        (typeof p.signer_id === "string" && p.signer_id.length > 0)
      ).length;

      const applyRes = await supabase.rpc("vault_inventory_apply", {
        p_collector_no: scope,
        p_items: parsed,
        p_sync_id: syncId,
        p_roblox_user_id: stored.roblox_user_id,
      });
      if (applyRes.error) return fail("sync_apply_failed", 500, { p_scanned_items: items.length, p_signed_found: signedFound });
      const applyRow = (Array.isArray(applyRes.data) ? applyRes.data[0] : applyRes.data) as Record<string, unknown> | null;

      // Premium notification for newly detected VERIFIED Signed Pets only.
      // Dedupe lives in the database (never repeats for the same pet).
      const verifiedUids = Array.isArray(applyRow?.verified_uids) ? (applyRow!.verified_uids as string[]) : [];
      let notified = 0;
      if (verifiedUids.length > 0) {
        const petRes = await supabase
          .from("vault_pets")
          .select("id, inventory_uid, pet_id, signer_id, variant, quantity, vault_pet_catalog(pet_name), vault_signers(signer_name)")
          .eq("collector_no", scope)
          .in("inventory_uid", verifiedUids);
        for (const row of (petRes.data ?? []) as Array<Record<string, unknown>>) {
          const catalog = asRecord(row.vault_pet_catalog);
          const signer = asRecord(row.vault_signers);
          const petName = String(catalog.pet_name ?? "Signed Pet");
          const signerName = row.signer_id && signer.signer_name ? String(signer.signer_name) : null;
          await supabase.rpc("vault_notification_add", {
            p_collector_no: scope,
            p_kind: "new_acquisition",
            p_dedupe_key: `signed:${String(row.pet_id ?? row.id)}`,
            p_title: `New verified Signed Pet: ${petName}`,
            p_body_lines: [
              `Pet: ${petName}`,
              `Variant: ${String(row.variant)}`, `Quantity: ${String(row.quantity ?? 1)}`,
              signerName ? `Signer: ${signerName}` : "Signer: Unknown Signer – Needs Review",
              "Detected via inventory scan.",
            ],
            p_pet_entry_id: String(row.id),
          });
          notified += 1;
        }
      }

      await supabase.rpc("vault_sync_log_add", {
        p_collector_no: scope,
        p_status: "ok",
        p_source: "biggames_oauth",
        p_scanned_items: items.length,
        p_signed_found: signedFound,
        p_added: Number(applyRow?.added ?? 0),
        p_updated: Number(applyRow?.updated ?? 0),
        p_removed: Number(applyRow?.removed ?? 0),
      });
      await supabase.rpc("vault_audit_scan_add", {
        p_collector_no: scope, p_status: "ok",
        p_detail: { added: Number(applyRow?.added ?? 0), removed: Number(applyRow?.removed ?? 0), acquisitions: Number(applyRow?.acquisitions ?? 0), signed_found: signedFound },
      });
      await supabase.rpc("vault_roblox_mark_synced", { p_collector_no: scope });

      return json({
        status: "ok",
        sync_id: syncId,
        scanned_items: items.length,
        parsed_pets: parsed.length,
        signed_found: signedFound,
        added: Number(applyRow?.added ?? 0),
        updated: Number(applyRow?.updated ?? 0),
        removed: Number(applyRow?.removed ?? 0),
        acquisitions: Number(applyRow?.acquisitions ?? 0),
        verified_notifications: notified,
      });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (err) {
    console.error("[vault-biggames] unhandled", err);
    return json({ error: "integration_error" }, 500);
  }
});
