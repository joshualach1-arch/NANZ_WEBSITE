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


function normalizeEggKey(value: string): string {
  return value.toLowerCase()
    .replace(/^exclusive\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

function parseBigGamesExclusiveEggs(html: string, petImages: Map<string, string>): Record<string, unknown>[] {
  const decode = (value: string) => value
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/&#x2F;/g, "/")
    .replace(/&lt;/g, "<").replace(/&gt;/g, " ");
  const plain = decode(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " "));
  const ranks = [...plain.matchAll(/#(\d{1,2})\s+([\s\S]*?)(?=#\d{1,2}\s+|More Pet Simulator 99|$)/g)];
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const match of ranks) {
    const block = match[2].trim();
    const eggMatch = block.match(/((?:Exclusive\s+)?[A-Za-z0-9'’& -]+?\bEgg)\b/i);
    if (!eggMatch) continue;
    const shortName = eggMatch[1].replace(/^Exclusive\s+/i, "").trim();
    const eggName = /^exclusive\s/i.test(eggMatch[1]) ? eggMatch[1] : `Exclusive ${shortName}`;
    const key = normalizeEggKey(eggName);
    if (seen.has(key)) continue;
    seen.add(key);
    const contentsText = block.slice(eggMatch.index! + eggMatch[0].length);
    const contents: Array<{ pet_name: string; odds: string; image_url: string | null }> = [];
    const oddsRegex = /([^,]+?)\s*\(([0-9]+(?:\.[0-9]+)?%)\)/g;
    let oddsMatch: RegExpExecArray | null;
    while ((oddsMatch = oddsRegex.exec(contentsText)) !== null) {
      const petName = oddsMatch[1].replace(/[•·|]/g, " ").replace(/\s+/g, " ").trim();
      if (!petName || petName.length > 90) continue;
      const petKey = petName.toLowerCase().replace(/[^a-z0-9]+/g, "");
      contents.push({
        pet_name: petName,
        odds: oddsMatch[2],
        image_url: petImages.get(petKey) ?? petImages.get(normalizePetImageKey(petName)) ?? null,
      });
    }
    const rawIndex = html.toLowerCase().indexOf(shortName.toLowerCase());
    const nearby = rawIndex >= 0 ? html.slice(Math.max(0, rawIndex - 2400), Math.min(html.length, rawIndex + 4200)) : "";
    let imageUrl: string | null = null;
    const imageTags = [...nearby.matchAll(/<(?:img|source)\b[^>]*>/gi)].map((m) => m[0]);
    for (const tag of imageTags) {
      const src = tag.match(/(?:src|data-src|data-lazy-src|data-original)=["']([^"']+)/i)?.[1];
      if (!src || /^data:/i.test(src)) continue;
      try {
        const parsed = new URL(decode(src), "https://www.biggames.io");
        const nested = parsed.searchParams.get("url");
        imageUrl = nested ? decodeURIComponent(nested) : parsed.toString();
        if (imageUrl.startsWith("//")) imageUrl = `https:${imageUrl}`;
        break;
      } catch { /* continue */ }
    }
    rows.push({
      egg_name: eggName,
      image_url: imageUrl,
      contents,
      rarity: "Exclusive",
      source: "big_games_official",
      official_rank: Number(match[1]),
    });
  }
  return rows;
}


const OFFICIAL_EGG_IMAGE_IDS: Record<string, string> = {
  "Mythical Egg": "82696306737384",
  "Chrome Egg": "94815310294716",
  "Remix Egg": "100040974811220",
  "Lost Hero Egg": "96905846001617",
  "Forcefield Egg": "84171538973941",
  "Ornate Egg": "105915558923585",
  "Cardboard Egg": "109259071091561",
  "Tokusatsu Egg": "72627847337184",
  "Holofoil Egg": "78134780438407",
  "Super Fluffy Egg": "81877004234057",
  "Vapor Egg": "140604314646557",
  "Space Egg": "96530605023559",
  "Origami Egg": "75203419198563",
  "Special Ops Egg": "73621348462405",
  "Glass Egg": "132891272688100",
  "Ice Cube Egg": "135060964483981",
  "Harvest Egg": "103334132797001",
  "Brainrot Egg": "89468892055847",
  "Treasure Egg": "112984138677487",
  "Super Coral Egg": "110937441567661",
  "Totem Egg": "95622991998696",
  "Yin-Yang Egg": "71800431354706",
  "Spirit Egg": "92009010203013",
  "Aura Egg": "121397272180623",
  "Patchwork Egg": "76237149926893",
  "Beast Egg": "95913164974324",
  "Kaiju Egg": "129455545171389",
  "Dot Matrix Egg": "110505952197309",
  "Jurassic Egg": "88086887334640",
  "Matryoshka Egg": "127054123305927",
  "Googly Egg": "87034502118666",
  "Hypnotic Egg": "99979001566139",
  "Snowflake Egg": "105703918956378",
  "Snow Globe Egg": "78055889793752",
  "Midnight Egg": "120489631271296",
  "Chad Egg": "134908672851123",
  "Cartoon Egg": "92993491169749",
  "Horror Egg": "133438295958475",
  "Soul Egg": "72844454700436",
  "Sad Egg": "137130517995200",
  "Luchador Egg": "72200617710757",
  "Classic Egg": "18883126241",
  "SpongeBob Egg": "18673507287",
  "Valkyrie Egg": "18465449444",
  "Flex Egg": "18101456848",
  "Blazing Egg": "17775083088",
  "Stargazing Egg": "17604555124",
  "Bejeweled Egg": "17454584246",
  "Black Hole Egg": "17285382732",
  "Sketch Egg": "17014122346",
  "Superhero Egg": "16756520769",
  "Super Jelly Egg": "16290865780",
  "Valentine's Egg": "16302977915",
  "Emoji Egg": "16011773627",
  "Xmas Egg": "15698454434",
  "Fruit Egg": "15628887305",
  "Dragon Egg": "15163625617",
  "Cosmic Egg": "14146204107",
  "Atlantean Egg": "13845602539",
  "Nightmare Egg": "13565042806",
  "Jelly Egg": "13356892618",
  "Crystal Egg": "13133002135",
  "Hologram Egg": "12887279401",
  "Dominus Egg": "12673924707",
  "Meme Egg": "12444268861",
  "Neon Egg": "12219464453",
  "Balloon Egg": "15187935684",
  "Jolly Egg": "15187935808",
  "Anime Egg": "11725479537",
  "Neon Twilight Egg": "15187935249",
  "Elemental Egg": "15187935439",
  "Capybara Egg": "15187935566",
  "Original Egg": "15187934902"
};

function buildOfficialEggFallback(petImages: Map<string, string>, eggImages: Map<string, string>): Record<string, unknown>[] {
  const source = "Mythical Egg|Gargantuan Mythical Pixiu (0.02%),Titanic Mythical Leviathan (0.2%),Huge Mythical Manticore (0.78%),Huge Mythical Behemoth (3%)\nChrome Egg|Gargantuan Chrome Unicorn (0.02%),Titanic Chrome Panda (0.2%),Huge Chrome Monkey (0.78%),Huge Chrome Axolotl (3%)\nRemix Egg|Gargantuan Domino Dominus (0.02%),Titanic Bingus Cat (0.2%),Huge Betta Fish (0.78%),Huge Fennec Fox (3%)\nLost Hero Egg|Gargantuan Lost Hero Bulldog (0.02%),Titanic Lost Hero Butterfly (0.2%),Huge Lost Hero Rabbit (0.78%),Huge Lost Hero Cat (3%)\nForcefield Egg|Gargantuan Forcefield Chimera (0.02%),Titanic Forcefield Giraffe (0.2%),Huge Forcefield Jaguar (0.78%),Huge Forcefield Gorilla (3%)\nOrnate Egg|Gargantuan Ornate Dragon (0.02%),Titanic Ornate Cat (0.2%),Huge Ornate Koi Fish (0.78%),Huge Ornate Phoenix (3%)\nCardboard Egg|Gargantuan Cardboard Dominus Astra (0.02%),Titanic Cardboard Floppa (0.2%),Huge Cardboard Blobfish (0.78%),Huge Cardboard Shark (3%)\nTokusatsu Egg|Gargantuan Tokusatsu Spider (0.02%),Titanic Tokusatsu Wolf (0.2%),Huge Tokusatsu Crab (0.78%),Huge Tokusatsu Sabertooth (3%)\nHolofoil Egg|Gargantuan Holofoil Agony (0.02%),Titanic Holofoil Hippomelon (0.2%),Huge Holofoil Tiger (0.78%),Huge Holofoil Axolotl (3%)\nSuper Fluffy Egg|Gargantuan Super Fluffy Cat (0.01%),Titanic Super Fluffy Corgi (0.1%),Huge Super Fluffy Unicorn (0.39%),Huge Super Fluffy Panda (1.5%)\nVapor Egg|Gargantuan Vapor Phoenix (0.01%),Titanic Vapor Dragon (0.1%),Huge Vapor Wolf (0.39%),Huge Vapor Cat (1.5%)\nSpace Egg|Gargantuan Solar Lion (0.01%),Titanic Space Bat (0.1%),Huge Mars Monkey (0.39%),Huge Earth Dog (1.5%)\nOrigami Egg|Gargantuan Origami Kitsune (0.01%),Titanic Origami Crane (0.1%),Huge Origami Shark (0.39%),Huge Origami Bunny (1.5%)\nSpecial Ops Egg|Gargantuan Special Ops Moth (0.01%),Titanic Special Ops Goat (0.1%),Huge Special Ops Dog (0.39%),Huge Special Ops Ram (1.5%)\nGlass Egg|Gargantuan Glass Squid (0.01%),Titanic Glass Blobfish (0.1%),Huge Glass Dominus (0.39%),Huge Glass Crocodile (1.5%)\nIce Cube Egg|Gargantuan Cookie Cut Cat (0.01%),Titanic Snow Globe Snowman (0.1%),Huge Sleigh Axolotl (0.39%),Huge Ice Cube Penguin (1.5%)\nHarvest Egg|Gargantuan Evil Scarecrow Pumpkin (0.01%),Titanic Spirit Mushroom (0.1%),Huge Leafstorm Wolf (0.39%),Huge Honey Bear (1.5%)\nBrainrot Egg|Gargantuan Cappuccino Brainrot (0.01%),Titanic Crocodilo Brainrot (0.1%),Huge Tralala Brainrot (0.39%),Huge Cappuccina Brainrot (1.5%)\nTreasure Egg|Gargantuan Treasure Angelus (0.01%),Titanic Treasure Mimic (0.1%),Huge Treasure Golem (0.39%),Huge Treasure Scorpion (1.5%)\nSuper Coral Egg|Gargantuan Super Coral Kraken (0.01%),Titanic Super Coral Stingray (0.1%),Huge Super Coral Hydra (0.39%),Huge Super Coral Axolotl (1.5%)\nTotem Egg|Gargantuan Totem Monkey (0.01%),Titanic Totem Owl (0.1%),Huge Totem Cat (0.39%),Huge Totem Wolf (1.5%)\nYin-Yang Egg|Gargantuan Yin-Yang Kitsune (0.01%),Titanic Yin-Yang Grim Reaper (0.1%),Huge Yin-Yang Bunny (0.39%),Huge Yin-Yang Dragon (1.5%)\nSpirit Egg|Gargantuan Magma Spirit (0.01%),Titanic Wood Spirit (0.1%),Huge Wave Spirit (0.39%),Huge Blossom Spirit (1.5%)\nAura Egg|Gargantuan Aura Cat (0.01%),Titanic Aura Kitsune (0.1%),Huge Aura Dominus (0.39%),Huge Aura Fox (1.5%)\nPatchwork Egg|Gargantuan Patchwork Agony (0.01%),Titanic Patchwork Capybara (0.1%),Huge Patchwork Teddy Bear (0.39%),Huge Patchwork Bunny (1.5%)\nBeast Egg|Gargantuan Royal Beast (0.01%),Titanic Warrior Beast (0.1%),Huge Claw Beast (0.39%),Huge Snuggle Beast (1.5%)\nKaiju Egg|Gargantuan Kaiju King (0.01%),Titanic Kaiju Moth (0.1%),Huge Kaiju Hydra (0.39%),Huge Kaiju Sea Dragon (1.5%)\nDot Matrix Egg|Gargantuan Dot Matrix Pegasus (0.01%),Titanic Dot Matrix Kitsune (0.1%),Huge Dot Matrix Axolotl (0.39%),Huge Dot Matrix Cat (1.5%)\nJurassic Egg|Gargantuan Jurassic Dragon (0.01%),Titanic Jurassic Feline (0.1%),Huge Jurassic Beaver (0.39%),Huge Jurassic Crocodile (1.5%)\nMatryoshka Egg|Gargantuan Matryoshka Bear (0.01%),Titanic Matryoshka Cat (0.1%),Huge Matryoshka Dino (0.39%),Huge Matryoshka Capybara (1.5%)\nGoogly Egg|Gargantuan Googly Agony (0.01%),Titanic Googly Blobfish (0.1%),Huge Googly Shark (0.39%),Huge Googly Corgi (1.5%)\nHypnotic Egg|Gargantuan Hypnotic Kitsune (0.01%),Titanic Hypnotic Monkey (0.1%),Huge Hypnotic Dragon (0.39%),Huge Hypnotic Cat (1.5%)\nSnowflake Egg|Gargantuan Santa Paws (0.01%),Titanic Snowflake Angelus (0.1%),Huge Naughty Dominus (0.39%),Huge Holiday Bearserker (1.5%)\nSnow Globe Egg|Titanic Snow Globe Cat (0.05%),Huge Snow Globe Hamster (0.7%),Huge Snow Globe Corgi (1.3%)\nMidnight Egg|Titanic Midnight Lion (0.05%),Huge Midnight Zebra (0.7%),Huge Midnight Cat (1.3%)\nChad Egg|Titanic Chad Gorilla (0.05%),Huge Chad Bunny (0.7%),Huge Chad Elephant (1.3%)\nCartoon Egg|Titanic Cartoon Cat (0.05%),Huge Cartoon Demon (0.7%),Huge Cartoon Bunny (1.3%)\nHorror Egg|Titanic Ghostface Cat (0.05%),Huge Machete Dog (0.7%),Huge Slasher Sloth (1.3%)\nSoul Egg|Titanic Soul Owl (0.05%),Huge Soul Dragon (0.7%),Huge Soul Cat (1.3%)\nSad Egg|Titanic Sad Cat (0.05%),Huge Sad Hamster (0.7%),Huge Sad Doge (1.3%)\nLuchador Egg|Titanic Luchador Cat (0.05%),Huge Luchador Eagle (0.7%),Huge Luchador Coyote (1.3%)\nClassic Egg|Titanic Classic Cat (0.05%),Huge Classic Dragon (0.7%),Huge Classic Dog (1.3%)\nSpongeBob Egg|Titanic SpongeBob SquarePants (0.05%),Huge Patrick Star (0.7%),Huge Mr Krabs (1.3%)\nValkyrie Egg|Titanic Valkyrie Pegasus (0.05%),Huge Valkyrie Wolf (0.7%),Huge Valkyrie Dog (1.3%)\nFlex Egg|Titanic Flex Cat (0.05%),Huge Flex Tiger (0.7%),Huge Flex Fluffy Cat (1.3%)\nBlazing Egg|Titanic Blazing Dragon (0.05%),Huge Blazing Bat (0.7%),Huge Blazing Shark (1.3%)\nStargazing Egg|Titanic Stargazing Bull (0.05%),Huge Stargazing Axolotl (0.7%),Huge Stargazing Wolf (1.3%)\nBejeweled Egg|Titanic Bejeweled Griffin (0.05%),Huge Bejeweled Lion (0.7%),Huge Bejeweled Unicorn (1.3%)\nBlack Hole Egg|Titanic Black Hole Angelus (0.05%),Huge Black Hole Kitsune (0.7%),Huge Black Hole Axolotl (1.3%)\nSketch Egg|Titanic Sketch Cat (0.05%),Huge Sketch Dragon (0.7%),Huge Sketch Corgi (1.3%)\nSuperhero Egg|Titanic Bat Cat (0.05%),Huge Super Tiger (0.7%),Huge Jester Dog (1.3%)\nSuper Jelly Egg|Titanic Jelly Dragon (0.05%),Huge Jelly Monkey (0.7%),Huge Jelly Axolotl (1.3%)\nValentine's Egg|Titanic Lovemelon (0.05%),Huge Heart Balloon Cat (0.7%),Huge Valentines Cat (1.3%)\nEmoji Egg|Titanic Emoji Corgi (0.05%),Huge Emoji Monkey (0.7%),Huge Emoji Cat (1.3%)\nXmas Egg|Titanic Silver Dragon (0.05%),Huge Peppermint Angelus (0.7%),Huge Holiday Pegasus (1.3%)\nFruit Egg|Titanic Banana Cat (0.05%),Huge Hippomelon (0.7%),Huge Strawberry Corgi (1.3%)\nDragon Egg|Titanic Fire Dragon (0.05%),Huge Celestial Dragon (0.7%),Huge Unicorn Dragon (1.3%)\nCosmic Egg|Titanic Cosmic Pegasus (0.05%),Huge Cosmic Agony (0.7%),Huge Cosmic Axolotl (1.3%)\nAtlantean Egg|Titanic Atlantean Jellyfish (0.05%),Huge Atlantean Dolphin (0.7%),Huge Atlantean Orca (1.3%)\nNightmare Egg|Titanic Nightmare Cat (0.05%),Huge Nightmare Kraken (0.7%),Huge Nightmare Spirit (1.3%)\nJelly Egg|Titanic Jelly Cat (0.05%),Huge Jelly Piggy (0.7%),Huge Jelly Corgi (1.3%)\nCrystal Egg|Titanic Mystic Corgi (0.05%),Huge Amethyst Dragon (0.7%),Huge Redstone Cat (1.3%)\nHologram Egg|Titanic Hologram Cat (0.05%),Huge Hologram Axolotl (0.7%),Huge Hologram Shark (1.3%)\nDominus Egg|Titanic Dominus Astra (0.05%),Huge Inferno Dominus (0.7%),Huge Storm Dominus (1.3%)\nMeme Egg|Titanic Hubert (0.05%),Huge Pop Cat (0.7%),Huge Knife Cat (1.3%)\nNeon Egg|Titanic Neon Agony (0.05%),Huge Neon Griffin (0.7%),Huge Neon Cat (1.3%)\nBalloon Egg|Titanic Balloon Monkey (0.05%),Huge Balloon Axolotl (0.7%),Huge Balloon Dragon (1.3%)\nJolly Egg|Titanic Jolly Cat (0.05%),Huge Present Chest Mimic (0.7%),Huge Grinch Cat (1.3%)\nAnime Egg|Huge Anime Agony (0.5%),Huge Anime Unicorn (1.5%)\nNeon Twilight Egg|Huge Neon Twilight Dragon (0.25%),Huge Neon Twilight Wolf (0.75%)\nElemental Egg|Huge Inferno Cat (0.5%),Huge Prickly Panda (1.5%)\nCapybara Egg|Huge Cyborg Capybara (0.5%),Huge Capybara (1.5%)\nOriginal Egg|Huge Sleipnir (0.5%),Huge Floppa (1.5%)";
  return source.split("\n").map((line, index) => {
    const [shortName, contentText] = line.split("|");
    const eggName = "Exclusive " + shortName;
    const contents = [...(contentText ?? "").matchAll(/([^,]+?)\\s*\\(([0-9]+(?:\\.[0-9]+)?%)\\)/g)].map((match) => {
      const petName = match[1].trim();
      return {
        pet_name: petName,
        odds: match[2],
        image_url: petImages.get(normalizePetImageKey(petName)) ?? null,
      };
    });
    const key = normalizeEggKey(eggName);
    return {
      egg_name: eggName,
      image_url: eggImages.get(key) ?? eggImages.get(normalizeEggKey(shortName)) ?? (OFFICIAL_EGG_IMAGE_IDS[shortName] ? `${API_BASE}/image/${OFFICIAL_EGG_IMAGE_IDS[shortName]}` : null),
      contents,
      rarity: "Exclusive",
      source: "big_games_official",
      official_rank: 73 - index,
    };
  });
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

      const normalize = normalizeEggKey;
      const cosmicRows = new Map<string, Record<string, unknown>>();
      const failures: Array<{ url: string; status: number | string }> = [];
      for (let page = 1; page <= 20; page++) {
        const urls = [
          new URL("https://petsimulatorvalues.com/valuesnew.php"),
          new URL("https://petsimulatorvalues.com/values.php"),
        ];
        for (const url of urls) {
          url.searchParams.set("category", "Eggs");
          url.searchParams.set("page", String(page));
        }
        let html: string | null = null;
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
        if (html === null) break;
        const rows = parseCosmicEggRows(html);
        for (const row of rows) cosmicRows.set(normalize(String(row.egg_name)), row);
        const pageText = html.replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ");
        const range = pageText.match(/(\\d+)\\s*[–-]\\s*(\\d+)\\s+of\\s+(\\d+)/i);
        const endIndex = range ? Number(range[2]) : 0;
        const total = range ? Number(range[3]) : 0;
        if (range ? endIndex >= total : (!/\\bNext\\b/i.test(pageText) || rows.length === 0)) break;
      }

      const petImages = new Map<string, string>();
      try {
        const petRes = await fetch(`${API_BASE}/api/collection/Pets`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(20000),
        });
        if (petRes.ok) {
          const payload = asRecord(await petRes.json().catch(() => ({})));
          const pets = Array.isArray(payload.data) ? payload.data as PetRow[] : [];
          for (const pet of pets) {
            const image = thumbnailUrl(pet);
            if (!image) continue;
            const configName = String(pet.configName ?? "");
            const displayName = String(asRecord(pet.configData).name ?? "");
            for (const name of [configName, displayName]) {
              if (!name) continue;
              petImages.set(name.toLowerCase().replace(/[^a-z0-9]+/g, ""), image);
              petImages.set(normalizePetImageKey(name), image);
            }
          }
        }
      } catch (error) {
        console.warn("[vault-catalog] BIG Games pet artwork lookup failed", error);
      }

      let officialEggRows: Record<string, unknown>[] = [];
      try {
        const officialResponse = await fetch("https://www.biggames.io/ps99-exclusives", {
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": "Mozilla/5.0 (compatible; NANZO Signed Vault/1.0)",
          },
          signal: AbortSignal.timeout(25000),
        });
        if (officialResponse.ok) {
          officialEggRows = parseBigGamesExclusiveEggs(await officialResponse.text(), petImages);
        } else {
          console.warn("[vault-catalog] official BIG Games exclusive egg page returned", officialResponse.status);
        }
      } catch (error) {
        console.warn("[vault-catalog] official BIG Games exclusive egg import failed", error);
      }

      const officialEggImages = new Map<string, string>();
      try {
        const eggRes = await fetch(`${API_BASE}/api/collection/Eggs`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(20000),
        });
        if (eggRes.ok) {
          const payload = asRecord(await eggRes.json().catch(() => ({})));
          const gameEggs = Array.isArray(payload.data) ? payload.data as PetRow[] : [];
          for (const egg of gameEggs) {
            const image = thumbnailUrl(egg);
            if (!image) continue;
            const configName = String(egg.configName ?? "");
            const displayName = String(asRecord(egg.configData).name ?? "");
            for (const name of [configName, displayName]) {
              if (name) officialEggImages.set(normalize(name), image);
            }
          }
        }
      } catch (error) {
        console.warn("[vault-catalog] BIG Games egg config artwork lookup failed", error);
      }

      // BIG Games' official page is sometimes served without its client-rendered
      // egg list to server-side fetchers. Use the official 73-egg dataset as a
      // deterministic fallback, retaining live artwork from the BIG Games API.
      if (officialEggRows.length === 0) {
        officialEggRows = buildOfficialEggFallback(petImages, officialEggImages);
      }

      // BIG Games' official index is the canonical source for all current
      // Exclusive Eggs. Keep Cosmic Values data where it exists and append
      // official-only eggs such as Mythical and Chrome.
      const merged = new Map<string, Record<string, unknown>>();
      for (const row of cosmicRows.values()) merged.set(normalize(String(row.egg_name)), row);
      for (const official of officialEggRows) {
        const key = normalize(String(official.egg_name));
        const previous = merged.get(key) ?? {};
        merged.set(key, {
          ...previous,
          ...official,
          cosmic_value: previous.cosmic_value ?? null,
          rap_value: previous.rap_value ?? null,
          demand: previous.demand ?? null,
          image_url: official.image_url ?? officialEggImages.get(key) ?? previous.image_url ?? null,
          contents: official.contents ?? [],
        });
      }
      const rows = [...merged.values()];
      if (!rows.length) return json({
        error: "egg_sources_empty",
        cosmic_pages_failed: failures.length,
        official_source: "https://www.biggames.io/ps99-exclusives",
      }, 502);

      const existing = await supabase.from("vault_egg_catalog")
        .select("egg_name,image_url,cosmic_value,rap_value,demand,contents");
      const existingByKey = new Map<string, Record<string, unknown>>();
      for (const row of existing.data ?? []) existingByKey.set(normalize(String(row.egg_name)), row as Record<string, unknown>);
      const saved = await supabase.from("vault_egg_catalog").upsert(rows.map((row) => {
        const eggName = String(row.egg_name);
        const previous = existingByKey.get(normalize(eggName)) ?? {};
        return {
          egg_name: eggName,
          image_url: row.image_url ?? officialEggImages.get(normalize(eggName)) ?? previous.image_url ?? null,
          cosmic_value: row.cosmic_value ?? previous.cosmic_value ?? null,
          rap_value: row.rap_value ?? previous.rap_value ?? null,
          demand: row.demand ?? previous.demand ?? null,
          contents: row.contents ?? previous.contents ?? [],
          rarity: row.rarity ?? previous.rarity ?? null,
          source_rank: row.official_rank ?? previous.source_rank ?? null,
          value_source: row.value_source ?? (row.source === "big_games_official" ? "big_games_official" : "cosmic_values"),
          source_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }), { onConflict: "egg_name" });
      if (saved.error) return json({ error: saved.error.message }, 500);
      const count = await supabase.from("vault_egg_catalog").select("id", { count: "exact", head: true });
      const imagesResolved = rows.filter((row) => Boolean(row.image_url)).length;
      const withContents = rows.filter((row) => Array.isArray(row.contents) && (row.contents as unknown[]).length > 0).length;
      return json({
        status: "ok",
        cosmic_eggs: cosmicRows.size,
        official_exclusive_eggs: officialEggRows.length,
        added_or_updated: rows.length,
        images_resolved: imagesResolved,
        eggs_with_contents: withContents,
        total_catalog: count.count ?? rows.length,
        source_failures: failures.length,
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
