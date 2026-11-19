// NANZ Discord bridge — server-side dispatch to the NANZ CORE bot.
//
// Routes (all under /functions/v1/nanz-discord-bridge):
//   POST { action: "dispatch", applicationId }        → send pending application to the bot
//   POST { action: "health" }                         → probe the bot endpoint, record health
//   POST { action: "retry", applicationId }           → re-dispatch a failed/pending delivery
//   POST { action: "callback", secret, event }        → NANZ CORE calls this back (ticket created,
//                                                       status change, close). Authenticated by a
//                                                       shared secret from the config row.
//   POST { action: "status", reference }              → applicant status lookup (safe fields only)
//
// Secrets and endpoints live in nanz_discord_config (service_role only).
// The browser never sees the bot token, API key or private channel ids.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALLOWED_STATUSES = [
  "pending", "under_review", "accepted", "rejected",
  "more_info_required", "ticket_closed", "discord_delivery_failed",
];

const VALID_PLAYTIME = ["1–2 hours", "3–4 hours", "5+ hours"];
const VALID_POTENTIAL = ["1,000–2,000", "2,000–5,000", "5,000+"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: cfgRow, error: cfgErr } = await supabase
      .from("nanz_discord_config")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (cfgErr) throw new Error("config_read_failed");
    const cfg = cfgRow ?? {};

    if (action === "status") {
      const reference = String(body?.reference ?? "").trim().toUpperCase();
      if (!reference) return json({ error: "reference_required" }, 400);
      const { data, error } = await supabase.rpc("application_status_lookup", { p_reference: reference });
      if (error) return json({ error: "lookup_failed" }, 500);
      if (!data || data.length === 0) return json({ found: false }, 200);
      const row = data[0];
      return json({
        found: true,
        application_id: row.application_id,
        reference_code: row.reference_code,
        roblox_username: row.roblox_username,
        submitted_at: row.submitted_at,
        status: row.status,
        updated_at: row.updated_at,
        next_steps: row.next_steps,
      });
    }

    if (action === "health") {
      if (!cfg.bot_endpoint) {
        return json({ connected: false, reason: "bot_endpoint_not_configured" });
      }
      const started = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(`${cfg.bot_endpoint.replace(/\/$/, "")}/health`, {
          method: "GET",
          headers: cfg.bot_api_key ? { Authorization: `Bearer ${cfg.bot_api_key}` } : {},
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const connected = res.ok;
        const detail = `HTTP ${res.status} · ${Date.now() - started}ms`;
        // Keep guild_name / server_icon_url current: resolve fresh values from
        // the public invite when possible, so a changed icon never goes stale.
        let freshName: string | null = null;
        let freshIcon: string | null = null;
        if (cfg.invite_url) {
          try {
            const code = String(cfg.invite_url).split(/discord\.gg\//)[1]?.split(/[?/]/)[0];
            if (code) {
              const invRes = await fetch(`https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=true`, {
                signal: AbortSignal.timeout(5000),
              });
              if (invRes.ok) {
                const inv = (await invRes.json()) as { guild?: { name?: string; icon?: string } };
                if (inv.guild?.name) freshName = inv.guild.name;
                if (inv.guild?.icon && cfg.guild_id) {
                  const ext = inv.guild.icon.startsWith("a_") ? "gif" : "png";
                  freshIcon = `https://cdn.discordapp.com/icons/${cfg.guild_id}/${inv.guild.icon}.${ext}?size=256`;
                }
              }
            }
          } catch {
            // Invite lookup is best-effort; health result is unaffected.
          }
        }
        await supabase.from("nanz_discord_config").update({
          bot_health_status: connected ? "connected" : "error",
          bot_last_health_check_at: new Date().toISOString(),
          bot_health_detail: detail,
          ...(freshName ? { server_name: freshName } : {}),
          ...(freshIcon ? { server_icon_url: freshIcon } : {}),
        }).eq("id", true);
        return json({ connected, status: res.status, detail });
      } catch (err) {
        const detail = err instanceof Error ? err.message : "unreachable";
        await supabase.from("nanz_discord_config").update({
          bot_health_status: "error",
          bot_last_health_check_at: new Date().toISOString(),
          bot_health_detail: detail.slice(0, 300),
        }).eq("id", true);
        return json({ connected: false, detail });
      }
    }

    if (action === "staff_passkey_set") {
      // Owner bootstrap: only callable with the NANZ_STAFF_PASSKEY secret from
      // the Bolt/Supabase edge environment. Never sent from the browser.
      const expected = Deno.env.get("NANZ_STAFF_PASSKEY") ?? "";
      if (!expected) return json({ error: "owner_secret_not_configured" }, 503);
      if (expected.length < 20) return json({ error: "owner_secret_too_short", observed_length: expected.length }, 503);
      const presented = String(body?.secret ?? "");
      if (presented !== expected) return json({ error: "unauthorized" }, 401);
      const newKey = String(body?.passkey ?? "").trim();
      if (newKey.length < 20 || newKey.length > 128) return json({ error: "passkey_too_short" }, 400);
      const { error: setErr } = await supabase.rpc("staff_passkey_replace", { p_passkey: newKey });
      if (setErr) return json({ error: "passkey_set_failed" }, 500);
      return json({ ok: true });
    }

    if (action === "integration_health") {
      // Admin panel health data via passkey; runs as service role here so the
      // SECURITY DEFINER RPC stays locked down to service_role.
      const passkey = String(body?.passkey ?? "");
      const { data, error } = await supabase.rpc("staff_discord_integration_health", { p_passkey: passkey });
      if (error) {
        const msg = error.message.includes("staff_key_invalid") ? "staff_key_invalid" : "lookup_failed";
        return json({ error: msg }, 401);
      }
      return json(data as object);
    }

    if (action === "callback") {
      // Authenticated by the shared callback secret stored in the config row.
      const secret = String(body?.secret ?? "");
      const expected = String(cfg.bot_api_key ?? "");
      if (!expected || secret !== expected) return json({ error: "unauthorized" }, 401);

      const event = body?.event ?? {};
      const applicationId = typeof event.application_id === "string" ? event.application_id : "";
      const eventType = String(event.type ?? "");
      const eventKey = String(event.event_key ?? "") || `${applicationId}:${eventType}:${event.status ?? ""}:${event.actor ?? ""}`;
      if (!applicationId || !eventType) return json({ error: "invalid_event" }, 400);

      const { data: exists } = await supabase
        .from("nanz_recruitment_applications")
        .select("id")
        .eq("id", applicationId)
        .maybeSingle();
      if (!exists) return json({ error: "unknown_application" }, 404);

      // Idempotency: unique event_key rejects replays at the DB level.
      if (eventKey) {
        const { error: evErr } = await supabase.from("nanz_application_events").insert({
          application_id: applicationId,
          event_type: eventType,
          actor: String(event.actor ?? "NANZ CORE"),
          detail: typeof event.detail === "string" ? event.detail : null,
          event_key: eventKey,
        });
        if (evErr && evErr.code !== "23505") return json({ error: "event_insert_failed" }, 500);
        if (evErr) return json({ ok: true, duplicate: true });
      }

      // Ticket-confirmed event: store guild/channel/message references.
      if (eventType === "ticket_created") {
        await supabase.from("nanz_recruitment_applications").update({
          discord_ticket_channel_id: event.ticket_channel_id ?? null,
          discord_ticket_message_id: event.ticket_message_id ?? null,
          discord_guild_id: event.guild_id ?? cfg.guild_id ?? null,
          discord_delivered_at: new Date().toISOString(),
          discord_delivery_status: "sent",
          discord_delivery_error: null,
          status: "pending",
        }).eq("id", applicationId);
        return json({ ok: true });
      }

      if (eventType === "status_change") {
        const nextStatus = String(event.status ?? "");
        if (!ALLOWED_STATUSES.includes(nextStatus)) return json({ error: "invalid_status" }, 400);
        // Idempotent + loop-safe: skip when the row already shows this status.
        const { data: current } = await supabase
          .from("nanz_recruitment_applications")
          .select("status, discord_delivery_status")
          .eq("id", applicationId)
          .maybeSingle();
        if (current?.status === nextStatus) return json({ ok: true, duplicate: true });
        await supabase.from("nanz_recruitment_applications").update({
          status: nextStatus,
          updated_at: new Date().toISOString(),
          reviewed_at: new Date().toISOString(),
        }).eq("id", applicationId);
        return json({ ok: true });
      }

      if (eventType === "ticket_closed") {
        await supabase.from("nanz_recruitment_applications").update({
          status: "ticket_closed",
          updated_at: new Date().toISOString(),
        }).eq("id", applicationId);
        return json({ ok: true });
      }

      return json({ ok: true, ignored: eventType });
    }

    // dispatch / retry — validate the applicant payload server-side.
    const applicationId = String(body?.applicationId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(applicationId)) return json({ error: "invalid_application_id" }, 400);

    const { data: app, error: appErr } = await supabase
      .from("nanz_recruitment_applications")
      .select("id, reference_code, roblox_username, roblox_user_id, discord_username, daily_playtime, daily_points_potential, previous_clan, experience, created_at, discord_delivery_status, discord_delivery_attempts")
      .eq("id", applicationId)
      .maybeSingle();
    if (appErr || !app) return json({ error: "application_not_found" }, 404);
    if (app.discord_delivery_status === "sent") return json({ ok: true, duplicate: true, reference: app.reference_code });

    // Server-side validation before dispatch (the browser is untrusted).
    if (
      typeof app.roblox_username !== "string" || app.roblox_username.trim().length < 3 ||
      typeof app.discord_username !== "string" || app.discord_username.trim().length < 2 ||
      !VALID_PLAYTIME.includes(app.daily_playtime) ||
      !VALID_POTENTIAL.includes(app.daily_points_potential) ||
      typeof app.experience !== "string" || app.experience.trim().length < 20
    ) {
      await supabase.from("nanz_recruitment_applications").update({
        discord_delivery_status: "failed",
        discord_delivery_error: "validation_failed",
      }).eq("id", applicationId);
      return json({ error: "validation_failed" }, 422);
    }

    if (!cfg.bot_endpoint) {
      // Nothing configured yet — keep the application, mark pending.
      return json({ ok: false, reason: "bot_endpoint_not_configured", reference: app.reference_code }, 200);
    }

    if (!app.reference_code) {
      const { data: refCode, error: refErr } = await supabase.rpc("application_generate_reference");
      if (refErr || !refCode) return json({ error: "reference_generation_failed" }, 500);
      const { error: refUpdErr } = await supabase
        .from("nanz_recruitment_applications")
        .update({ reference_code: refCode })
        .eq("id", applicationId)
        .is("reference_code", null);
      if (refUpdErr) return json({ error: "reference_assignment_failed" }, 500);
      const { data: refCheck } = await supabase
        .from("nanz_recruitment_applications")
        .select("reference_code")
        .eq("id", applicationId)
        .maybeSingle();
      if (!refCheck?.reference_code) return json({ error: "reference_assignment_failed" }, 500);
      app.reference_code = refCheck.reference_code;
    }

    const payload = {
      type: "recruitment_application",
      application_id: app.id,
      reference: app.reference_code,
      idempotency_key: app.id, // NANZ CORE must dedupe on this key
      // Flat aliases: newer NANZ CORE builds validate top-level
      // roblox_username/reason; nested applicant kept for older builds.
      roblox_username: app.roblox_username,
      reason: app.experience,
      discord_username: app.discord_username,
      applicant: {
        roblox_username: app.roblox_username,
        roblox_user_id: app.roblox_user_id ?? null,
        discord_username: app.discord_username,
        daily_playtime: app.daily_playtime,
        daily_points_potential: app.daily_points_potential,
        previous_clan: app.previous_clan ?? null,
        application_message: app.experience,
        submitted_at: app.created_at,
        website_reference: app.reference_code,
      },
      recruitment_category_id: cfg.recruitment_category_id ?? null,
      guild_id: cfg.guild_id ?? null,
      notify_channel_ids: cfg.notify_channel_ids ?? {},
      requested_embed: {
        title: "NANZ ELITE — NEW RECRUITMENT APPLICATION",
        fields: [
          { name: "Application ID", value: String(app.id) },
          { name: "Reference", value: app.reference_code },
          { name: "Roblox Username", value: app.roblox_username },
          { name: "Roblox User ID", value: app.roblox_user_id ?? "Not provided" },
          { name: "Discord Username", value: app.discord_username },
          { name: "Daily Playtime", value: app.daily_playtime },
          { name: "Daily Points Potential", value: app.daily_points_potential },
          { name: "Previous Clan", value: app.previous_clan ?? "None" },
          { name: "Application Message", value: app.experience },
          { name: "Submitted", value: app.created_at },
          { name: "Website Application Reference", value: app.reference_code },
        ],
        action_labels: ["ACCEPT", "REJECT", "REQUEST MORE INFORMATION", "MARK AS UNDER REVIEW"],
      },
    };

    let delivered = false;
    let deliverError: string | null = null;
    let botResponseBody: string | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${String(cfg.bot_endpoint).replace(/\/$/, "")}/applications`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cfg.bot_api_key ? { Authorization: `Bearer ${cfg.bot_api_key}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      delivered = res.ok;
      if (!delivered) {
        deliverError = `bot_responded_${res.status}`;
        botResponseBody = (await res.text().catch(() => null))?.slice(0, 300) ?? null;
      }
    } catch (err) {
      deliverError = err instanceof Error ? err.message.slice(0, 200) : "network_error";
    }

    if (!delivered) {
      console.error(JSON.stringify({
        event: "discord_dispatch_failed",
        application_id: applicationId,
        error: deliverError,
        bot_response: botResponseBody,
        attempts: (app.discord_delivery_attempts ?? 0) + 1,
      }));
    }

    await supabase.from("nanz_recruitment_applications").update({
      discord_delivery_status: delivered ? "sent" : "failed",
      discord_delivery_attempts: (app.discord_delivery_attempts ?? 0) + 1,
      discord_delivery_error: deliverError,
      discord_last_dispatch_at: new Date().toISOString(),
      status: delivered ? "pending" : "discord_delivery_failed",
    }).eq("id", applicationId);

    await supabase.from("nanz_application_events").insert({
      application_id: applicationId,
      event_type: delivered ? "dispatch_ok" : "dispatch_failed",
      actor: "discord-bridge",
      detail: botResponseBody ? `${deliverError}: ${botResponseBody}` : deliverError ?? "Delivered to NANZ CORE",
    });

    if (!delivered) return json({ ok: false, error: "delivery_failed", detail: deliverError, reference: app.reference_code }, 502);
    return json({ ok: true, reference: app.reference_code });
  } catch (_err) {
    return json({ error: "internal_error" }, 500);
  }
});
