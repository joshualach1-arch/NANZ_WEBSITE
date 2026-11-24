const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function errorResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { ...corsHeaders, "Cache-Control": "public, max-age=60" },
  });
}

function parseAllowedImageUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    const allowed =
      host === "ps99.biggamesapi.io" ||
      host === "biggames.io" || host.endsWith(".biggames.io") ||
      host === "petsimulatorvalues.com" || host.endsWith(".petsimulatorvalues.com") ||
      host === "rbxcdn.com" || host.endsWith(".rbxcdn.com") ||
      host === "roblox.com" || host.endsWith(".roblox.com");
    return allowed ? url : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return errorResponse("Method not allowed", 405);

  const requestUrl = new URL(req.url);
  const assetId = requestUrl.searchParams.get("assetId") ?? "";
  const rawUrl = requestUrl.searchParams.get("url");
  let upstreamUrl: URL;

  if (assetId) {
    if (!/^\d{6,20}$/.test(assetId)) return errorResponse("Invalid Roblox asset id", 400);
    upstreamUrl = new URL("https://ps99.biggamesapi.io/image/" + assetId);
  } else if (rawUrl) {
    const parsed = parseAllowedImageUrl(rawUrl);
    if (!parsed) return errorResponse("Image host is not allowed", 400);
    upstreamUrl = parsed;
  } else {
    return errorResponse("Missing assetId or url", 400);
  }

  try {
    const requestHeaders = {
      Accept: "image/avif,image/webp,image/png,image/*;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 NANZO Signed Vault image proxy",
    };
    let currentUrl = upstreamUrl;
    let upstream: Response | null = null;
    // Follow only a few redirects and re-check every destination host.
    for (let hop = 0; hop < 4; hop++) {
      upstream = await fetch(currentUrl.toString(), {
        headers: requestHeaders,
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      const location = upstream.headers.get("location");
      if (!location) break;
      const redirected = parseAllowedImageUrl(new URL(location, currentUrl).toString());
      if (!redirected) return errorResponse("Image redirect host is not allowed", 502);
      currentUrl = redirected;
    }
    if (!upstream) return errorResponse("Image source unavailable", 502);
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      return errorResponse("Too many image redirects", 502);
    }
    if (!upstream.ok) {
      return errorResponse("Image source unavailable", upstream.status === 404 ? 404 : 502);
    }
    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return errorResponse("Image source returned a non-image response", 502);
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
    console.error("[vault-image] upstream fetch failed", upstreamUrl.toString(), error);
    return errorResponse("Image proxy failed", 502);
  }
});
