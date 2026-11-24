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

type RpcResult = { data: unknown; error: { message?: string } | null };

function rpcError(res: RpcResult): Response | null {
  if (res.error) {
    const message = res.error.message ?? "vault_error";
    const status = message.includes("vault_access_denied")
      ? 401
      : message.includes("vault_owner_only")
        ? 403
        : 400;
    return json({ error: message }, status);
  }
  return null;
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return asRecord(await req.json());
  } catch {
    return {};
  }
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const body = await readBody(req);
    const action = String(body.action ?? "");

    // Backward compatibility for already-published frontends that still send
    // the egg import action to vault-bridge instead of vault-catalog.
    if (action === "cosmic-egg-import" || action === "cosmic_egg_import") {
      const token = String(body.token ?? "");
      const baseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const response = await fetch(`${baseUrl}/functions/v1/vault-catalog`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
        body: JSON.stringify({ action: "cosmic_egg_import", token }),
        signal: AbortSignal.timeout(120000),
      });
      const result = await response.json().catch(() => ({ error: "egg_catalog_response_invalid" }));
      return json(result, response.status);
    }

    // ── status: is the vault configured? (no auth needed) ────────────
    if (action === "status") {
      const { data, error } = await supabase.rpc("vault_status");
      const err = rpcError({ data, error });
      if (err) return err;
      return json({ status: "ok", ...(data as Record<string, unknown>) });
    }

    // ── first-time setup / passkey rotation, gated by server secret ──
    if (action === "setup") {
      const setupKey = Deno.env.get("VAULT_SETUP_KEY") ?? "";
      if (!setupKey) {
        return json({ error: "vault_setup_key_missing" }, 400);
      }
      const { data, error } = await supabase.rpc("vault_setup", {
        p_setup_key: setupKey,
        p_owner_passkey: String(body.owner_passkey ?? ""),
        p_collector2_passkey: String(body.collector2_passkey ?? ""),
      });
      const err = rpcError({ data, error });
      if (err) return err;
      return json({ status: "ok", result: data });
    }

    // ── login: exchange passkey for session token ────────────────────
    if (action === "login") {
      const { data, error } = await supabase.rpc("vault_login", {
        p_passkey: String(body.passkey ?? ""),
      });
      if (error) return json({ error: "vault_access_denied" }, 401);
      const rows = Array.isArray(data) ? data : [];
      const row = (rows[0] ?? null) as Record<string, unknown> | null;
      if (!row) return json({ error: "vault_access_denied" }, 401);
      return json({
        status: "ok",
        token: row.out_token ?? null,
        collector_no: row.out_collector_no ?? null,
        is_owner: row.out_is_owner ?? false,
      });
    }

    // ── session check ─────────────────────────────────────────────────
    if (action === "session") {
      const token = String(body.token ?? "");
      const { data, error } = await supabase.rpc("vault_session", { p_token: token });
      if (error) return json({ error: "vault_access_denied" }, 401);
      const rows = Array.isArray(data) ? data : [];
      const row = (rows[0] ?? null) as Record<string, unknown> | null;
      if (!row) return json({ error: "vault_access_denied" }, 401);
      return json({
        status: "ok",
        collector_no: row.out_collector_no ?? null,
        is_owner: row.out_is_owner ?? false,
        expires_at: row.out_expires_at ?? null,
      });
    }

    // ── logout ────────────────────────────────────────────────────────
    if (action === "logout") {
      await supabase.rpc("vault_logout", { p_token: String(body.token ?? "") });
      return json({ status: "ok" });
    }

    // ── data read ─────────────────────────────────────────────────────
    if (action === "data") {
      const token = String(body.token ?? "");
      const { data, error } = await supabase.rpc("vault_data_get", { p_token: token });
      const err = rpcError({ data, error });
      if (err) return err;
      // Egg data is isolated in its own RPC; merge it into the regular payload.
      const eggResult = await supabase.rpc("vault_egg_data_get", { p_token: token });
      if (eggResult.error) {
        const eggErr = rpcError({ data: null, error: eggResult.error });
        if (eggErr) return eggErr;
      }
      return json({ status: "ok", data: { ...asRecord(data), ...asRecord(eggResult.data) } });
    }

    // ── generic data-management dispatch ──────────────────────────────
    const rpcName = String(body.rpc ?? "");
    const token = String(body.token ?? "");
    const params = asRecord(body.params ?? {});
    const allowed: Record<string, string[]> = {
      vault_catalog_manage: ["token", "p_action", "p_pet_id", "p_pet_name", "p_category", "p_image_url", "p_notes", "p_cosmic_value", "p_demand"],
      vault_signer_manage: ["token", "p_action", "p_signer_id", "p_signer_name", "p_roblox_username", "p_roblox_user_id", "p_notes", "p_pet_id", "p_variant"],
      vault_collection_manage: ["token", "p_action", "p_collector_no", "p_pet_entry_id", "p_pet_id", "p_signer_id", "p_variant", "p_nickname", "p_acquired_at", "p_purchase_price", "p_currency", "p_notes", "p_evidence_url", "p_request_id", "p_request_status"],
      vault_settings_manage: ["token", "p_settings", "p_collector_no", "p_label", "p_roblox_username", "p_roblox_user_id"],
      vault_roblox_manage: ["token", "p_action", "p_roblox_username", "p_roblox_user_id", "p_display_name", "p_avatar_url", "p_profile_url"],
      vault_roblox_admin: ["token", "p_collector_no", "p_action", "p_roblox_username", "p_roblox_user_id", "p_display_name", "p_avatar_url", "p_profile_url"],
      vault_oauth_status: ["token"],
      vault_oauth_disconnect: ["token"],
      vault_sync_log_get: ["token", "p_collector_no"],
      vault_unknown_signer_assign: ["token", "p_pet_entry_id", "p_roblox_username", "p_variant", "p_signature_value", "p_notes"],
      vault_cosmic_values_manage: ["token", "p_pet_id", "p_in_game_value", "p_in_game_value_source"],
      vault_signability_manage: ["token", "p_pet_id", "p_signability", "p_source"],
      vault_signer_manage_v2: ["token", "p_action", "p_signer_id", "p_signer_name", "p_roblox_username", "p_roblox_user_id", "p_display_name", "p_avatar_url", "p_profile_url", "p_roles", "p_is_developer", "p_is_partner", "p_is_creator", "p_youtube_channel_id", "p_youtube_channel_name", "p_youtube_channel_url", "p_youtube_avatar_url", "p_youtube_subscribers", "p_verification_status", "p_source", "p_merge_target_id", "p_notes"],
      vault_signature_manage: ["token", "p_action", "p_signature_id", "p_pet_id", "p_signer_id", "p_variant", "p_cosmic_signature_id", "p_signature_name", "p_signature_value", "p_verification_status", "p_source", "p_notes"],
      vault_values_manage: ["token", "p_action", "p_pet_id", "p_signature_id", "p_pet_value", "p_signature_value", "p_combined_value", "p_calculation_method"],
      vault_import_history_get: ["token"],
      vault_audit_get: ["token"],
      vault_value_history_get: ["token", "p_pet_id"],
      vault_passkey_change: ["token", "p_old_passkey", "p_new_passkey"],
      vault_scanner_data_get: ["token", "p_collector_no"],
      vault_checklist_get: ["token", "p_collector_no"],
      vault_notifications_manage: ["token", "p_action", "p_notification_id"],
      vault_acquisition_manage: ["token", "p_acquisition_id", "p_purchase_price", "p_currency", "p_acquisition_type", "p_acquired_at", "p_notes"],
      vault_acquisitions_get: ["token", "p_collector_no"],
      vault_trade_groups_get: ["token", "p_collector_no"],
      vault_trade_group_update: ["token", "p_group_id", "p_total_gems", "p_allocations"],
      vault_activity_feed: ["token", "p_collector_no", "p_limit"],
      vault_stats_get: ["token", "p_collector_no"],
      vault_snapshots_get: ["token", "p_collector_no"],
      // Egg collection reads and writes use the same authenticated bridge.
      vault_egg_data_get: ["token"],
      vault_egg_collection_manage: ["token", "p_egg_id", "p_owned", "p_quantity", "p_notes", "p_acquired_at", "p_collector_no"],
    };

    // Route signer assignment through the dedicated SECURITY DEFINER dispatcher.
    // This also supports clients still sending the legacy { action: "manage", rpc, params } envelope.
    if (rpcName === "vault_unknown_signer_assign") {
      const petEntryId = String(params.p_pet_entry_id ?? "").trim();
      const robloxUsername = String(params.p_roblox_username ?? "").trim().replace(/^@/, "");
      if (!petEntryId || !robloxUsername) {
        return json({ error: "signer_assignment_invalid" }, 400);
      }
      const { data, error } = await supabase.rpc("vault_manage", {
        p_token: token,
        p_rpc: "vault_unknown_signer_assign",
        p_params: {
          p_pet_entry_id: petEntryId,
          p_roblox_username: robloxUsername,
          p_variant: params.p_variant ?? null,
          p_signature_value: params.p_signature_value ?? null,
          p_notes: params.p_notes ?? null,
        },
      });
      const err = rpcError({ data, error });
      if (err) return err;
      return json({ status: "ok", result: data });
    }

    if (!(rpcName in allowed)) return json({ error: "unknown_rpc" }, 400);

    const args: Record<string, unknown> = { p_token: token };
    for (const key of allowed[rpcName]) {
      if (key === "token") continue;
      if (key in params) args[key] = params[key];
    }

    const { data, error } = await supabase.rpc(rpcName, args);
    const err = rpcError({ data, error });
    if (err) return err;
    return json({ status: "ok", result: data });
  } catch (err) {
    console.error("[vault-bridge] unhandled", err);
    return json({ error: "vault_error" }, 500);
  }
});
