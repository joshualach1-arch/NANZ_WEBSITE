import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "GEMINI_API_KEY is not configured in Supabase Edge Function secrets." }, 503);
    const body = record(await req.json());
    const token = String(body.token ?? "");
    const images = Array.isArray(body.images) ? body.images : [];
    if (!token) return json({ error: "vault_session_required" }, 401);
    if (!images.length || images.length > 10) return json({ error: "Upload between 1 and 10 screenshots." }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: sessionRows, error: sessionError } = await supabase.rpc("vault_session", { p_token: token });
    const session = Array.isArray(sessionRows) ? sessionRows[0] : null;
    if (sessionError || !session) return json({ error: "Your vault session expired. Please sign in again." }, 401);

    const content: Array<Record<string, unknown>> = [{
      text: `You are the screenshot parser for a Pet Simulator 99 trade calculator. Analyze all screenshots as ONE evidence set, not as separate trades.
Return ONLY valid JSON with this exact top-level shape:
{"screenshots":[{"index":0,"kind":"trade_overview|signature_closeup|gems|unknown","side":"give|get|unknown","notes":"short"}],"items":[{"pet_name":"exact visible or best catalog pet name","catalog_match":"exact candidate name or empty","variant":"normal|golden|rainbow|shiny|golden_shiny|rainbow_shiny|unknown","side":"give|get|unknown","signer_name":"visible signer/creator name or empty","signature_present":true,"signature_screenshot_indices":[1],"source_screenshot_indices":[0],"confidence":0.0,"needs_review":false,"review_reason":""}],"gems":[{"side":"give|get|unknown","amount":0,"screenshot_indices":[0],"confidence":0.0}],"warnings":["..."]}.
Rules:
- A screenshot showing the whole trade window is primary evidence. Count each visible pet in that overview once.
- A close-up of a signature, signed pet, or designer mark is supporting evidence. It MUST NOT create another pet if it matches a pet already visible in an overview. Attach it to that existing item using signature_screenshot_indices.
- If a close-up cannot confidently be matched to an overview pet, include a separate item only if a distinct pet is clearly shown; set needs_review=true and explain why.
- Detect both sides from trade UI labels and layout. Never guess side: use unknown if unclear.
- Read the exact pet name, variant and signer text when legible. Never invent a signer. If text is uncertain, return best reading but needs_review=true.
- Gems are amounts shown in the trade UI. Convert suffixes K/M/B/T to absolute integer values (M=1,000,000; B=1,000,000,000). Do not treat 800M as 800 billion.
- The provided catalog and signer lists are the ONLY allowed matching candidates. Keep catalog_match/signer_name empty when no confident match exists.
- confidence is 0..1. Mark uncertain results needs_review.
PET CATALOG (match candidates): ${JSON.stringify(body.petCatalog ?? [])}
DESIGNER CATALOG (match candidates): ${JSON.stringify(body.signerCatalog ?? [])}
There are ${images.length} uploaded screenshots. Image index is their order, starting at 0.`
    }];
    let totalBytes = 0;
    for (let i = 0; i < images.length; i++) {
      const img = record(images[i]);
      const data = String(img.data ?? "");
      if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(data)) return json({ error: `Screenshot ${i + 1} is not a supported image.` }, 400);
      totalBytes += Math.floor(data.length * 0.75);
      content.push({ text: `Screenshot ${i} — ${String(img.name ?? `image-${i+1}`)}` });
      content.push({ inlineData: { mimeType: "image/jpeg", data: data.split(",")[1] } });
    }
    if (totalBytes > 4.5 * 1024 * 1024) return json({ error: "The combined screenshots are too large for one request. Try fewer or smaller images (maximum 4.5 MB combined)." }, 413);

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: content }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } }),
    });
    const payload = await response.json();
    if (!response.ok) {
      console.error("Gemini vision request failed", response.status, payload);
      return json({ error: "Gemini screenshot analysis failed. Check the Gemini API key, API access and free-tier quota." }, 502);
    }
    const text = Array.isArray(payload.candidates?.[0]?.content?.parts) ? payload.candidates[0].content.parts.map((part: Record<string, unknown>) => String(part.text ?? "")).join("\n") : "";
    let result: Record<string, unknown>;
    try { result = JSON.parse(text.trim()); } catch {
      console.error("Gemini vision output was not valid JSON", text.slice(0, 2000));
      return json({ error: "Gemini returned an unreadable result. Please try again with clearer screenshots." }, 502);
    }
    return json({ status: "ok", analysis: result });
  } catch (error) {
    console.error("screenshot-trade-analyzer error", error);
    return json({ error: "Unexpected screenshot analysis error." }, 500);
  }
});
