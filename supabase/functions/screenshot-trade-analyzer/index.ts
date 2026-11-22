import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function streamResponse(run: (send: (value: Record<string, unknown>) => void) => Promise<void>) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: Record<string, unknown>) => controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(value) + "\n\n"));
      void run(send).catch((error) => {
        console.error("screenshot-trade-analyzer stream error", error);
        const message = error instanceof Error ? error.message : "Something went wrong while analyzing your screenshots. Please try again.";
        const code = String((error as Error & { code?: string }).code ?? "unexpected_error");
        send({ type: "error", code, error: message });
      }).finally(() => controller.close());
    },
  });
  return new Response(body, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
}

async function callGroq(apiKey: string, prompt: string, images: Array<{ index: number; name: string; data: string }>) {
  const parts: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  for (const image of images) {
    parts.push({ type: "text", text: "Screenshot " + image.index + ": " + image.name });
    parts.push({ type: "image_url", image_url: { url: image.data } });
  }
  let response: Response | null = null;
  let payload: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        messages: [{ role: "user", content: parts }],
        temperature: 0.1,
        max_completion_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });
    payload = record(await response.json().catch(() => ({})));
    if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
    const retryAfter = Number(response.headers.get("retry-after") ?? 0);
    await sleep(Math.max(retryAfter * 1000, 1200 * (attempt + 1)));
  }
  if (!response?.ok) {
    const status = response?.status ?? 502;
    const err = record(payload.error);
    const detail = String(err.message ?? "");
    const message = status === 429
      ? "Groq's free request limit has been reached. Please wait a little and try again."
      : status === 503 || status === 502 || status === 504
        ? "Groq's vision service is temporarily at capacity or unavailable. Please try again in a moment."
        : status === 401 || status === 403
          ? "The Groq API key is invalid or does not have access. Check the GROQ_API_KEY secret in Supabase."
          : "Groq could not analyze these screenshots (HTTP " + status + "). " + detail.slice(0, 220);
    const error = new Error(message) as Error & { status?: number; code?: string };
    error.status = status;
    error.code = status === 429 ? "rate_limited" : status >= 500 ? "provider_unavailable" : "provider_error";
    throw error;
  }
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = record(record(choices[0]).message);
  const text = typeof message.content === "string" ? message.content : "";
  try { return JSON.parse(text.trim()) as Record<string, unknown>; }
  catch {
    console.error("Groq returned invalid JSON", text.slice(0, 1500));
    throw new Error("The vision model returned an unreadable result. Try clearer screenshots or fewer images.");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: Record<string, unknown>;
  try { body = record(await req.json()); }
  catch { return new Response(JSON.stringify({ error: "Invalid request body." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

  return streamResponse(async (send) => {
    const apiKey = Deno.env.get("GROQ_API_KEY");
    if (!apiKey) {
      send({ type: "error", code: "missing_secret", error: "Groq is not configured yet. Add GROQ_API_KEY under Supabase → Edge Functions → Secrets." });
      return;
    }
    const token = String(body.token ?? "");
    const images = Array.isArray(body.images) ? body.images.map((v) => record(v)) : [];
    if (!token) { send({ type: "error", code: "vault_session_required", error: "Your Signed Vault session expired. Sign in again." }); return; }
    if (!images.length || images.length > 10) { send({ type: "error", code: "invalid_image_count", error: "Upload between 1 and 10 screenshots." }); return; }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: sessionRows, error: sessionError } = await supabase.rpc("vault_session", { p_token: token });
    const session = Array.isArray(sessionRows) ? sessionRows[0] : null;
    if (sessionError || !session) { send({ type: "error", code: "vault_session_required", error: "Your Signed Vault session expired. Please sign in again." }); return; }

    const prepared: Array<{ index: number; name: string; data: string }> = [];
    let totalBytes = 0;
    for (let i = 0; i < images.length; i++) {
      const data = String(images[i].data ?? "");
      if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(data)) {
        send({ type: "error", code: "invalid_image", error: "Screenshot " + (i + 1) + " is not a supported image." }); return;
      }
      totalBytes += Math.floor(data.length * 0.75);
      prepared.push({ index: i, name: String(images[i].name ?? ("image-" + (i + 1))), data });
    }
    if (totalBytes > 4.5 * 1024 * 1024) { send({ type: "error", code: "payload_too_large", error: "The combined screenshots are too large. Remove a few images or upload smaller screenshots (maximum 4.5 MB combined)." }); return; }

    send({ type: "progress", percent: 8, stage: "Preparing screenshots", detail: "Checking image quality and organizing your trade evidence." });
    const petCatalog = Array.isArray(body.petCatalog) ? body.petCatalog : [];
    const signerCatalog = Array.isArray(body.signerCatalog) ? body.signerCatalog : [];
    const prompt = [
      "You are a precise OCR and image parser for Pet Simulator 99 trade screenshots. Analyze ONLY the single screenshot attached to this request. The screenshot index is supplied in its label.",
      "Return ONLY valid JSON with this exact shape:",
      '{"screenshots":[{"index":0,"kind":"trade_overview|signature_closeup|gems|unknown","side":"give|get|unknown","notes":"short"}],"items":[{"pet_name":"exact visible or best catalog pet name","catalog_match":"exact candidate name or empty","variant":"normal|golden|rainbow|shiny|golden_shiny|rainbow_shiny|unknown","side":"give|get|unknown","signer_name":"visible signer/creator name or empty","signature_present":true,"signature_screenshot_indices":[1],"source_screenshot_indices":[0],"confidence":0.0,"needs_review":false,"review_reason":""}],"gems":[{"side":"give|get|unknown","amount":0,"screenshot_indices":[0],"confidence":0.0}],"warnings":[]}.',
      "Rules: full trade overview is primary evidence; count each pet visible in an overview once.",
      "If this is a signature close-up, report the visible pet and signer if readable. Do not invent missing context. Set needs_review=true if the trade side or pet identity cannot be determined from this image alone.",
      "Do not assume other screenshots exist. Report only what is visible in this screenshot.",
      "Determine trade side from UI labels/layout. Never guess; use unknown if unclear.",
      "Read visible pet names, variants and signer text. Never invent signer names. Mark uncertain readings for review.",
      "Convert Gems K/M/B/T suffixes to absolute integers.",
      "Transcribe pet and signer names as visibly written. Do not guess or normalize uncertain text.",
      "Confidence is 0..1. Set needs_review for uncertain results.",
      "Use the exact screenshot index from the image label. Return an empty array when no pets or Gems are visible."
    ].join("\n");
    const chunks: Array<Array<{ index: number; name: string; data: string }>> = [];
    for (let i = 0; i < prepared.length; i += 1) chunks.push(prepared.slice(i, i + 1));
    const combined: Record<string, unknown> = { screenshots: [], items: [], gems: [], warnings: [] };
    for (let i = 0; i < chunks.length; i++) {
      const start = chunks[i][0].index + 1;
      const end = chunks[i][chunks[i].length - 1].index + 1;
      const percent = 12 + Math.round(((i + 1) / chunks.length) * 48);
      send({ type: "progress", percent, stage: "Searching for pets", detail: "Reading pet names, variants, trade sides and Gems in screenshot " + start + " of " + prepared.length + "." });
      const result = await callGroq(apiKey, prompt, chunks[i]);
      for (const key of ["screenshots", "items", "gems", "warnings"]) {
        const target = Array.isArray(combined[key]) ? combined[key] as unknown[] : [];
        const incoming = Array.isArray(result[key]) ? result[key] as unknown[] : [];
        target.push(...incoming);
        combined[key] = target;
      }
    }
    send({ type: "progress", percent: 66, stage: "Analyzing signatures", detail: "Checking signer names and linking signature close-ups to the correct pets." });

    const signers = signerCatalog.map((v) => record(v));
    const pets = petCatalog.map((v) => record(v));
    const items = (Array.isArray(combined.items) ? combined.items : []).map((v) => {
      const item = record(v);
      const signerName = String(item.signer_name ?? "").trim().toLowerCase();
      const signer = signers.find((s) => String(s.display_name ?? s.signer_name ?? "").trim().toLowerCase() === signerName
        || String(s.signer_name ?? "").trim().toLowerCase() === signerName);
      const petName = String(item.catalog_match || item.pet_name || "").trim().toLowerCase();
      const pet = pets.find((p) => String(p.name ?? p.display_name ?? p.pet_name ?? "").trim().toLowerCase() === petName);
      const category = String(pet?.category ?? "").toLowerCase();
      const value = !signer ? null : category.includes("titanic") ? signer.cosmic_titanic_value
        : category.includes("huge") ? signer.cosmic_huge_value
        : category.includes("exclusive") ? signer.cosmic_exclusive_value : null;
      return { ...item, catalog_match: pet ? String(pet.display_name ?? pet.name ?? pet.pet_name ?? item.pet_name ?? "") : String(item.catalog_match ?? ""), signer_value: value ?? null, signer_value_category: category || null, signer_value_source: value != null ? "NANZO signer catalog" : null };
    });
    combined.items = items;
    send({ type: "progress", percent: 82, stage: "Looking up signer values", detail: "Matching detected signers to NANZO's stored Huge, Exclusive and Titanic signature values." });
    send({ type: "progress", percent: 94, stage: "Finalizing trade", detail: "Combining screenshots, removing duplicate evidence and preparing your review." });
    send({ type: "complete", percent: 100, analysis: { screenshots: combined.screenshots, items, gems: combined.gems, warnings: combined.warnings } });
  });
});
