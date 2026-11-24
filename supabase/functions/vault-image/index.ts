const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const url = new URL(req.url);
  const assetId = url.searchParams.get("assetId") ?? "";
  if (!/^\d{6,20}$/.test(assetId)) {
    return new Response("Invalid Roblox asset id", { status: 400, headers: corsHeaders });
  }

  try {
    const upstream = await fetch(`https://ps99.biggamesapi.io/image/${assetId}`, {
      headers: { Accept: "image/avif,image/webp,image/png,image/*;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) {
      return new Response("Image source unavailable", {
        status: upstream.status === 404 ? 404 : 502,
        headers: { ...corsHeaders, "Cache-Control": "public, max-age=60" },
      });
    }
    const contentType = upstream.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) {
      return new Response("Image source returned a non-image response", { status: 502, headers: corsHeaders });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[vault-image] upstream fetch failed", error);
    return new Response("Image proxy failed", { status: 502, headers: corsHeaders });
  }
});
